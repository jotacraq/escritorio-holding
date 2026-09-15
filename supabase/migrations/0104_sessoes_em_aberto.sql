-- 0104_sessoes_em_aberto.sql
-- Tarefa 2 do atalho "Conduzir sessão" (15/09): sessão agendada/confirmada cuja
-- data passou e cujo agendamento nunca foi marcado como realizado (nem
-- no-show, nem remarcado) desaparecia da tela Hoje em silêncio.
-- `vw_sessoes_do_dia` (0034/0052) filtra `inicio_em >= hoje` — quem faltou
-- marcar como realizada, não compareceu ou remarcar simplesmente some da fila,
-- sem erro, sem selo, sem nada. Achado com dois exemplos reais em produção
-- (1 dia e 8 dias de atraso).
--
-- DECISÃO: view NOVA (`vw_sessoes_em_aberto`), não amplia `vw_sessoes_do_dia`.
-- `vw_sessoes_do_dia` tem contrato fechado (`src/types/painel-ui.ts` e
-- `src/types/agenda.ts`, além do rótulo "Sessões de hoje" e o cálculo de
-- "agora"/"esta semana" em `PainelDia.tsx`) e mistura os dois conceitos
-- (hoje/amanhã vs. atrasada) mudaria a semântica de "as próximas 48h" para
-- quem já depende dela. Uma view nova preserva 100% do contrato existente —
-- nenhum consumidor de `vw_sessoes_do_dia` muda de comportamento.
--
-- ESTADO NÃO É NOVO: a regra pedida pelo dono foi
--   status in ('agendado','confirmado') and realizada_em is null and inicio_em < hoje
-- só que `realizada_em` (0008) mora em `sessoes_viabilidade`, não em
-- `agendamentos` — e uma sessão pode ter mais de um agendamento (remarcação
-- preserva histórico, comentário da 0034). O EQUIVALENTE em `agendamentos` já
-- existe sem coluna nova: `status_agendamento` (0001) tem o valor
-- `'realizado'` no próprio enum, e é para esse valor que `LinhaAgendamento.tsx`
-- (`mudarStatus("realizado")`) move o agendamento quando a sessão acontece.
-- Então `status in ('agendado','confirmado')` já É "ainda não marcada como
-- realizada" — testar `sessoes_viabilidade.realizada_em is null` além disso
-- seria checar o mesmo fato duas vezes por dois caminhos que podem divergir
-- (a sessão pode ter `realizada_em` de uma tentativa antiga e um agendamento
-- novo `confirmado` para a remarcação — nesse caso ela DEVE aparecer aqui,
-- e travar por `realizada_em` a esconderia). Nenhum estado novo, nenhuma
-- coluna nova: a mesma dupla `status`/`inicio_em` que `vw_sessoes_do_dia` já
-- usa, só que olhando para trás.
--
-- JANELA: 14 dias. `vw_pendencias_preparo` olha 7 dias PARA A FRENTE; aqui o
-- cenário é "sessão que já devia ter acontecido" — normalmente resolvida
-- (remarcada/realizada/no-show) em poucos dias. 14 dias cobre com folga os
-- dois casos medidos (1 e 8 dias) sem a seção virar arquivo morto de sessões
-- de meses atrás. Fixo no SQL, não em `configuracoes`: não há hoje nenhum
-- consumidor além desta view, e criar uma chave nova de configuração para um
-- valor sem pedido de ajuste por tela é "chave fantasma" em potencial — mais
-- fácil e mais seguro trocar o `interval` aqui numa migration futura se o
-- dono pedir, do que manter um campo administrativo que ninguém mexe.
--
-- ÍNDICE: `idx_agendamentos_proximos on agendamentos (inicio_em) where status
-- in ('agendado','confirmado')` (0008) já cobre esta view — mesmo predicado de
-- status, e `inicio_em < hoje` é um range sobre a MESMA coluna indexada.
-- `explain (analyze)` PENDENTE — não tenho a ferramenta do Supabase nesta
-- sessão. Ver ROTEIRO DE VERIFICAÇÃO abaixo.
--
-- ROTEIRO DE VERIFICAÇÃO (a rodar por quem tem a ferramenta do Supabase):
--   1) select * from vw_sessoes_em_aberto limit 20;
--      -- esperado: só sessão com inicio_em < hoje, status agendado/confirmado,
--      -- dentro dos últimos 14 dias.
--   2) select relname, reloptions from pg_class where relname = 'vw_sessoes_em_aberto';
--      -- esperado: {security_invoker=true}.
--   3) explain (analyze, buffers) select * from vw_sessoes_em_aberto;
--
-- ===========================================================================
-- EXPLAIN (ANALYZE, BUFFERS) — MEDIDO EM PRODUÇÃO (fcfsnqqaphtamhrpuyoh,
-- 15/09/2026), depois de aplicar a view:
--
--   Sort  (actual time=0.207..0.209 rows=2 loops=1)
--     Sort Key: a.inicio_em DESC · Sort Method: quicksort  Memory: 25kB
--     ->  Nested Loop  (actual time=0.148..0.166 rows=2)
--           ->  Seq Scan on agendamentos a  (actual time=0.024..0.028 rows=2)
--                 Filter: status = ANY('{agendado,confirmado}') AND
--                         inicio_em < hoje AND inicio_em >= hoje - 14 days
--                 Rows Removed by Filter: 2 · Buffers: shared hit=1
--           ->  Seq Scan on sessoes_viabilidade s  (rows=2, loops=2)
--           ->  Index Scan using perfis_equipe_pkey  (rows=0, loops=2)
--           ->  Index Scan using pessoas_pkey  (rows=1, loops=2)
--           SubPlan 1 -> Index Only Scan using uniq_briefing_atual
--   Planning Time: 3.134 ms · Execution Time: 0.388 ms
--
-- Devolve as 2 sessões em aberto reais (1 e 8 dias atrás), que hoje somem da
-- tela por não caberem na janela de `vw_sessoes_do_dia`.
--
-- ⚠️ HONESTIDADE SOBRE O ÍNDICE: o plano NÃO usa
-- `idx_agendamentos_proximos` — o planner escolheu `Seq Scan` porque
-- `agendamentos` tem 4 linhas hoje. Isso é a decisão CERTA nesta escala (ler
-- 1 buffer inteiro é mais barato que descer um índice), mas significa que o
-- índice previsto no comentário acima **não está provado**. A regra da casa
-- já registra que índice pode deixar mais lento: em `etapa1_clientes(fase)`,
-- medido, Seq Scan 0,686 ms × Index Scan 0,809 ms em 1.222 linhas.
-- RE-MEDIR quando `agendamentos` passar de ~1.000 linhas: se o Seq Scan
-- persistir e o tempo subir, aí sim o índice parcial se justifica — e aí
-- tem de ser provado com `explain (analyze)`, não suposto.
-- ===========================================================================
--      -- esperado: Index Scan em idx_agendamentos_proximos, sem Seq Scan em
--      -- agendamentos. OBRIGATÓRIO colar a saída real antes de considerar
--      -- esta migration medida (PROTOCOLO-SUSTENTABILIDADE.md).
--
-- REVERSÃO:
--   drop view if exists vw_sessoes_em_aberto;
-- ===========================================================================
create view vw_sessoes_em_aberto with (security_invoker = true) as
select
  j.id as jornada_id,
  p.nome,
  a.inicio_em,
  a.fim_em,
  a.status,
  s.link_sala,
  coalesce(a.advogada_id, s.advogada_id) as advogada_id,
  pe.nome as advogada_nome,
  exists (select 1 from briefings b where b.jornada_id = j.id and b.atual) as tem_briefing,
  a.presenca_confirmada_em,
  a.presenca_confirmada_via,
  a.id as agendamento_id,
  s.id as sessao_id
from agendamentos a
join sessoes_viabilidade s on s.id = a.sessao_id
join jornadas j on j.id = s.jornada_id
join pessoas p on p.id = j.pessoa_id
left join perfis_equipe pe on pe.id = coalesce(a.advogada_id, s.advogada_id)
where a.status in ('agendado', 'confirmado')
  and a.inicio_em <  (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')
  and a.inicio_em >= (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') - interval '14 days'
order by a.inicio_em desc;

comment on view vw_sessoes_em_aberto is 'Painel do dia — sessão agendada/confirmada cujo dia passou e que não foi marcada como realizada (nem no-show, nem remarcada). Janela de 14 dias. Mesmas colunas de vw_sessoes_do_dia (0052) para reusar o mesmo componente/schema no front.';
