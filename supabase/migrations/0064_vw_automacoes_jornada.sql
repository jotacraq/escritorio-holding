-- 0064_vw_automacoes_jornada.sql — Fase 5 · M2 (`docs/ARQUITETURA-FASE-5.md` §8.2).
-- Aplicar depois da 0063. ADITIVO e IDEMPOTENTE: cria UMA view e UM índice de
-- chave estrangeira. Nenhum DELETE, nenhum UPDATE, nenhuma coluna nova em
-- tabela de cliente.
--
-- O QUE É: "o que o sistema fez" na jornada, uma linha por automação, com
-- RESULTADO humano — não o log cru. Hoje o advogado vê a régua de mensagens numa
-- tela, a ligação por IA em outra, a confirmação de presença numa terceira, e o
-- pagamento em lugar nenhum. A view junta as quatro fontes na mesma gramática
-- (`tipo · rotulo_fonte · estado · quando · resultado`), para a Ficha mostrar
-- uma lista, não quatro cartões.
--
-- O QUE ELA NÃO LÊ, DE PROPÓSITO:
--   * `webhooks_eventos.bruto` — payload cru com PII do comprador; leitura de
--     admin, nunca de tela de jornada (§11.5, CONFLITO 10). O marco "pagou" vem
--     de `pagamentos`.
--   * `pagamentos.valor`, `comprador_email/nome/telefone`, `bruto` — dinheiro e
--     contato do comprador não são "resultado de automação".
--   * `ligacoes_ia.transcricao`, `.gravacao_url`, `.custo_usd`, `.telefone` —
--     PII e custo interno (§8.2).
--   * `mensagens_agendadas.destinatario`, `.corpo_renderizado`, `.erro` — o
--     e-mail/telefone do cliente e o texto enviado não entram; `erro` do
--     provedor costuma ecoar o destinatário.
--
-- `security_invoker = true` (0047 é lei neste projeto): a view herda a RLS de
-- quem consulta. `relacionamento` vê mensagens, ligações e confirmações porque
-- as policies de origem são `eh_interno()`; nenhuma linha traz valor.
--
-- Linhas `cancelada` (mensagem cancelada por remarcação, ligação cancelada pela
-- equipe) FICAM DE FORA: o vocabulário congelado de `estado` não tem
-- "cancelado", e empurrá-las para `falhou` diria ao advogado que algo quebrou
-- quando nada quebrou. O cancelamento continua registrado na tabela e na
-- timeline.
--
-- ===========================================================================
-- ROTEIRO DE VERIFICAÇÃO (rodar como admin e como relacionamento)
--
--  0. PRÉ: select count(*) from pg_views where viewname = 'vw_automacoes_jornada';  → 0
--
--  1. security_invoker ligado:
--       select reloptions from pg_class where relname = 'vw_automacoes_jornada';
--     → {security_invoker=true}
--
--  2. Como ANÔNIMO (sem JWT):
--       set local role anon; select count(*) from vw_automacoes_jornada;  → 0 linhas
--
--  3. Jornada :j com mensagem enviada + ligação por IA + agendamento confirmado
--     + pagamento aprovado (a fixture da 0016 serve):
--       select tipo, chave, estado, resultado, ordem from vw_automacoes_jornada
--        where jornada_id = :j order by ordem;
--     → 4 tipos distintos; `ordem` começa em 1 e cresce sem buraco; a linha mais
--       recente é a ordem 1.
--
--  4. Nenhum valor de pagamento escapa (como relacionamento E como admin):
--       select * from vw_automacoes_jornada where tipo = 'marco' limit 5;
--     → as colunas são só as 9 do contrato; `resultado` não contém dígito de valor.
--       Conferência dura: select count(*) from vw_automacoes_jornada
--         where resultado ~ 'R\$';  → 0
--
--  5. Cancelada não aparece:
--       select count(*) from vw_automacoes_jornada a
--         join mensagens_agendadas m on m.jornada_id = a.jornada_id
--        where m.status = 'cancelada' and a.quando = coalesce(m.enviada_em, m.agendada_para)
--          and a.chave = (select chave from mensagens_templates where id = m.template_id);
--     → 0
--
--  6. Reaplicar a migration não duplica nada (`create or replace` + `if not exists`).
--
--  7. Plano da consulta da Ficha (uma jornada por vez):
--       explain (analyze, buffers) select * from vw_automacoes_jornada where jornada_id = :j;
--     → sem Seq Scan em `mensagens_agendadas` (idx_mensagens_jornada),
--       `ligacoes_ia` (idx_ligacoes_ia_jornada), `pagamentos` (idx_pagamentos_jornada)
--       nem `agendamentos` (idx_agendamentos_sessao, criado aqui).
--
-- REVERSÃO:
--   drop view if exists vw_automacoes_jornada;
--   drop index if exists idx_agendamentos_sessao;
-- ===========================================================================

-- Chave estrangeira sem índice: o join da view e o ON DELETE CASCADE de
-- `sessoes_viabilidade` varriam a tabela inteira. A única cobertura de hoje é
-- um índice PARCIAL (`uniq_agendamento_confirmado ... where status='confirmado'`),
-- que não serve para o join.
create index if not exists idx_agendamentos_sessao on agendamentos (sessao_id);

create or replace view vw_automacoes_jornada
with (security_invoker = true) as
with fontes as (
  -- (1) Régua de mensagens — o que foi (ou vai ser) enviado.
  select
    m.jornada_id,
    'mensagem'::text as tipo,
    t.chave          as chave,
    case t.chave
      when 'boas_vindas'       then 'Boas-vindas'
      when 'confirmacao_d7'    then 'Pedido de confirmação'
      when 'dia_da_sessao'     then 'Lembrete do dia'
      when 'pos_sessao'        then 'Material da sessão'
      when 'croqui_convite'    then 'Convite do croqui'
      when 'agendamento_link'  then 'Escolha de horário'
      when 'documentos_pedido' then 'Pedido de documentos'
      else initcap(replace(t.chave, '_', ' '))
    end              as rotulo_fonte,
    m.canal::text    as canal,
    case
      when m.status = 'enviada'  then 'enviado'
      when m.status = 'falhou'   then 'falhou'
      when m.status = 'pendente' and m.agendada_para > now() then 'agendado'
      else 'aguardando'
    end              as estado,
    coalesce(m.enviada_em, m.agendada_para) as quando,
    case
      when m.status = 'enviada' and m.marcada_manual_por is not null then 'Enviada pela equipe'
      when m.status = 'enviada' then 'Enviada'
      when m.status = 'falhou'  then 'Falhou no envio'
      else null
    end              as resultado
  from mensagens_agendadas m
  join mensagens_templates t on t.id = m.template_id
  where m.status <> 'cancelada'

  union all

  -- (2) Ligação por IA — sem transcrição, sem gravação, sem custo, sem telefone.
  select
    l.jornada_id,
    'ligacao_ia'::text,
    l.provedor,
    case when l.provedor = 'manual' then 'Ligação da equipe' else 'Ligação por IA' end,
    'telefone'::text,
    case
      when l.status = 'concluida'    then 'concluido'
      when l.status = 'sem_resposta' then 'sem_resposta'
      when l.status = 'falhou'       then 'falhou'
      when l.status = 'na_fila' and l.nao_antes_de > now() then 'agendado'
      else 'aguardando'
    end,
    coalesce(l.encerrada_em, l.disparada_em, l.criado_em),
    case l.resultado
      when 'agendou'         then 'Cliente agendou'
      when 'recusou'         then 'Cliente recusou'
      when 'pediu_retorno'   then 'Pediu retorno'
      when 'caixa_postal'    then 'Caixa postal'
      when 'numero_invalido' then 'Número inválido'
      when 'manual'          then 'Passou para a equipe'
      else case when l.status = 'sem_resposta' then 'Não atendeu' else null end
    end
  from ligacoes_ia l
  where l.status <> 'cancelada'

  union all

  -- (3) Confirmação de presença (0051) — o agendamento visto como automação.
  select
    s.jornada_id,
    'confirmacao'::text,
    'presenca'::text,
    'Confirmação de presença'::text,
    a.presenca_confirmada_via,
    case
      when a.presenca_confirmada_em is not null then 'concluido'
      when a.status = 'nao_compareceu'          then 'sem_resposta'
      when a.inicio_em > now()                  then 'agendado'
      else 'aguardando'
    end,
    coalesce(a.presenca_confirmada_em, a.inicio_em),
    case
      when a.presenca_confirmada_em is not null then 'Cliente confirmou'
      when a.status = 'nao_compareceu'          then 'Não compareceu'
      when a.inicio_em < now()                  then 'Sem confirmação'
      else null
    end
  from agendamentos a
  join sessoes_viabilidade s on s.id = a.sessao_id
  where a.status in ('agendado', 'confirmado', 'realizado', 'nao_compareceu')

  union all

  -- (4) Pagamento como MARCO — sem valor, sem comprador, sem payload.
  select
    g.jornada_id,
    'marco'::text,
    'pagamento'::text,
    coalesce(pr.nome, 'Pagamento'),
    null::text,
    case
      when g.status = 'aprovado'                          then 'concluido'
      when g.status in ('cancelado', 'estornado', 'reembolsado') then 'falhou'
      else 'aguardando'
    end,
    coalesce(g.pago_em, g.criado_em),
    case g.status
      when 'aprovado'    then 'Pagamento confirmado'
      when 'cancelado'   then 'Pagamento cancelado'
      when 'estornado'   then 'Pagamento estornado'
      when 'reembolsado' then 'Pagamento reembolsado'
      when 'em_analise'  then 'Em análise'
      else null
    end
  from pagamentos g
  left join produtos pr on pr.id = g.produto_id
  where g.jornada_id is not null
)
select
  jornada_id,
  tipo,
  chave,
  rotulo_fonte,
  canal,
  estado,
  quando,
  resultado,
  (row_number() over (partition by jornada_id order by quando desc nulls last, tipo))::int as ordem
from fontes;

comment on view vw_automacoes_jornada is
  'Fase 5 §8.2 — "o que o sistema fez" por jornada: régua de mensagens, ligação por IA, confirmação de presença e pagamento como marco. Uma linha por automação, com resultado humano. NÃO expõe valor de pagamento, payload de webhook, transcrição, gravação, custo, destinatário nem corpo de mensagem. security_invoker: herda a RLS de quem consulta.';
