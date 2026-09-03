-- 0034_painel_dia.sql
-- B-1B (Fase 2, ONDA 1) — as views do Painel do Dia (ARQUITETURA-FASE-2.md §4.6).
-- Cinco blocos: sessões de hoje · preparo pendente · pagou e ninguém falou com a
-- pessoa · travado · números da semana. Todas `security_invoker = true` (0015):
-- a view herda a RLS de quem consulta — sem isso vira porta dos fundos.
--
-- Contrato de saída: `src/types/painel-ui.ts` (F-1B, já escrito contra este
-- desenho) espera exatamente os nomes de coluna usados abaixo. `GET /api/painel`
-- (src/app/api/painel/route.ts, também deste agente) monta o envelope JSON.
--
-- CORREÇÃO em relação ao rascunho do plano (§4.6): o rascunho faz `left join
-- ligacoes_estrategicas`/`agendamentos` direto em `vw_indicadores_pop01`. Como
-- nenhuma das duas é 1:1 com a jornada (uma jornada pode ter mais de uma
-- ligação — remarcação de POP 03/03-B — e mais de um agendamento — remarcações
-- preservadas como histórico, 0021), um `join` direto faz FAN-OUT e conta a
-- mesma jornada mais de uma vez. Corrigido abaixo com `left join lateral ...
-- limit 1` (pega o registro mais recente de cada), o mesmo princípio que 0015/
-- 0025 já usam (`exists` em vez de `join`) para o mesmo problema.

-- ===========================================================================
-- Bloco 1 — Sessões de hoje (e amanhã: janela de 48h, desenho do plano).
-- ===========================================================================
create view vw_sessoes_do_dia with (security_invoker = true) as
select
  j.id as jornada_id,
  p.nome,
  a.inicio_em,
  a.fim_em,
  a.status,
  s.link_sala,
  coalesce(a.advogada_id, s.advogada_id) as advogada_id,
  pe.nome as advogada_nome,
  exists (select 1 from briefings b where b.jornada_id = j.id and b.atual) as tem_briefing
from agendamentos a
join sessoes_viabilidade s on s.id = a.sessao_id
join jornadas j on j.id = s.jornada_id
join pessoas p on p.id = j.pessoa_id
left join perfis_equipe pe on pe.id = coalesce(a.advogada_id, s.advogada_id)
where a.status in ('agendado', 'confirmado')
  and a.inicio_em >= (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')
  and a.inicio_em <  (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') + interval '2 days'
order by a.inicio_em;

-- ===========================================================================
-- Bloco 2 — Preparo pendente: sessão em até 7 dias e falta formulário, ligação
-- ou briefing. `join lateral ... having` (não `left join`) para só devolver
-- jornada que TEM sessão futura na janela — sem isso, toda jornada sem sessão
-- nenhuma entraria com `inicio_em = null`, o que não é "preparo pendente".
-- ===========================================================================
create view vw_pendencias_preparo with (security_invoker = true) as
select
  j.id as jornada_id,
  p.nome,
  prox.inicio_em,
  (not exists (select 1 from formularios_respostas fr where fr.jornada_id = j.id)) as falta_formulario,
  (not exists (select 1 from ligacoes_estrategicas lg where lg.jornada_id = j.id)) as falta_ligacao,
  (not exists (select 1 from briefings b where b.jornada_id = j.id and b.atual))   as falta_briefing
from jornadas j
join pessoas p on p.id = j.pessoa_id
join lateral (
  select min(a.inicio_em) as inicio_em
    from agendamentos a
    join sessoes_viabilidade s on s.id = a.sessao_id
   where s.jornada_id = j.id
     and a.status in ('agendado', 'confirmado')
     and a.inicio_em > now()
     and a.inicio_em <= now() + interval '7 days'
  having min(a.inicio_em) is not null
) prox on true
where j.desfecho = 'aberta'
  and (
       not exists (select 1 from formularios_respostas fr where fr.jornada_id = j.id)
    or not exists (select 1 from ligacoes_estrategicas lg where lg.jornada_id = j.id)
    or not exists (select 1 from briefings b where b.jornada_id = j.id and b.atual)
  )
order by prox.inicio_em asc;

-- ===========================================================================
-- Bloco 3 — "Pagou e ninguém falou com a pessoa." O furo que mais dói.
-- `join lateral (min(pago_em)...)` em vez de `join pagamentos` direto: uma
-- jornada pode ter mais de um pagamento aprovado (sessão + croqui) — pega o
-- PRIMEIRO pagamento aprovado sem contato, que é o pior caso (mais dias
-- esperando), sem duplicar a jornada na lista.
-- ===========================================================================
create view vw_pagos_sem_contato with (security_invoker = true) as
select
  j.id as jornada_id,
  p.nome,
  pg.pago_em,
  (now()::date - pg.pago_em::date)::int as dias_desde_pagamento
from jornadas j
join pessoas p on p.id = j.pessoa_id
join lateral (
  select min(pagamentos.pago_em) as pago_em
    from pagamentos
   where pagamentos.jornada_id = j.id
     and pagamentos.status = 'aprovado'
     and pagamentos.pago_em is not null
  having min(pagamentos.pago_em) is not null
) pg on true
where j.nivel_pago >= 1
  and j.desfecho = 'aberta'
  and not exists (select 1 from ligacoes_estrategicas l where l.jornada_id = j.id)
  and not exists (
    select 1 from mensagens_agendadas m where m.jornada_id = j.id and m.status = 'enviada'
  )
order by dias_desde_pagamento desc;

-- ===========================================================================
-- Bloco 4 — Travado: webhook não processado / mensagem que falhou / link
-- público expirando em 48h. Heterogêneo de propósito (`tipo` decide rótulo e
-- destino no front, `src/types/painel-ui.ts`).
--
-- GAP DOCUMENTADO: falta o 4º tipo do plano (`material_aguardando_aprovacao`),
-- porque `materiais_pos_sessao` só nasce em 0031 (ONDA 3, fora da minha
-- fronteira e não escrita ainda nesta noite). `create or replace view` é
-- aditivo — quem entregar 0031 estende esta view com um `union all` a mais,
-- sem quebrar nada que já existe.
--
-- ACHADO DE RLS que esta view expõe: `webhooks_eventos` (0011) não tinha
-- NENHUMA policy de SELECT para `authenticated` ("só service_role toca").
-- Com `security_invoker = true`, isso faria o bloco de webhook_falho voltar
-- SEMPRE vazio pra qualquer usuário — não "nada pendente" de verdade, e sim
-- RLS escondendo o dado (o oposto do que o painel promete: "vazio é vazio").
-- Corrigido abaixo com uma policy nova e estreita (léxico igual ao que o
-- próprio plano já pede pra este bloco: "só admin/advogada leem", §4.6).
-- Não mexe em 0011 — é uma policy adicional, aditiva, nesta migration.
-- ===========================================================================
create policy wh_sel_pendencias on webhooks_eventos for select to authenticated
  using ((select app.ve_patrimonio()));

create view vw_pendencias_sistema with (security_invoker = true) as
select
  w.id::text as id,
  'webhook_falho'::text as tipo,
  'Webhook não processado'::text as titulo,
  coalesce(w.erro, 'Sem detalhe de erro registrado — ver tentativas.') as descricao,
  null::uuid as jornada_id,
  null::text as pessoa_nome,
  w.recebido_em as ocorrido_em
from webhooks_eventos w
where w.processado_em is null
union all
select
  m.id::text,
  'mensagem_falhou'::text,
  'Mensagem da régua falhou'::text,
  coalesce(m.erro, 'Sem detalhe de erro registrado.'),
  m.jornada_id,
  p.nome,
  coalesce(m.enviada_em, m.criado_em)
from mensagens_agendadas m
join jornadas j on j.id = m.jornada_id
join pessoas p on p.id = j.pessoa_id
where m.status = 'falhou'
union all
select
  l.id::text,
  'link_expirando'::text,
  'Link público expirando em breve'::text,
  'Expira em ' || to_char(l.expira_em at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI'),
  l.jornada_id,
  p.nome,
  l.expira_em
from links_publicos l
join jornadas j on j.id = l.jornada_id
join pessoas p on p.id = j.pessoa_id
where l.estado = 'ativo'
  and l.expira_em <= now() + interval '48 hours'
order by ocorrido_em asc nulls last;

-- ===========================================================================
-- Bloco 5 — Números da semana (POP 01): os TRÊS indicadores que o método
-- nomeia — comparecimento, % de formulários respondidos, % de decisores
-- presentes. Numerador e denominador SEPARADOS de propósito: o percentual é
-- calculado no front e NUNCA aparece com denominador zero (campo novo nasce
-- vazio, não zero). Filtro de edição ativa: sem isso a lista cresce para
-- sempre (toda edição encerrada desde o início do projeto) — "números da
-- semana" é sobre o presente, não arquivo morto.
-- ===========================================================================
create view vw_indicadores_pop01 with (security_invoker = true) as
select
  j.edicao_id,
  e.codigo as edicao_codigo,
  e.nome   as edicao_nome,
  count(*) filter (where a.status = 'realizado')::int                        as compareceram,
  count(*) filter (where a.status in ('realizado', 'nao_compareceu'))::int   as sessoes_com_desfecho,
  count(*) filter (where fr.id is not null and j.nivel_pago >= 1)::int       as formularios_respondidos,
  count(*) filter (where j.nivel_pago >= 1)::int                            as clientes_pagantes,
  count(*) filter (where lg.decisores_presentes_na_sessao is true)::int      as com_decisores,
  count(*) filter (where lg.decisores_presentes_na_sessao is not null)::int  as com_resposta_decisores
from jornadas j
left join edicoes_seminario e on e.id = j.edicao_id
left join formularios_respostas fr on fr.jornada_id = j.id     -- 1:1 (unique(jornada_id)), sem fan-out
left join sessoes_viabilidade sv on sv.jornada_id = j.id        -- 1:1 (unique(jornada_id)), sem fan-out
left join lateral (
  select a2.status
    from agendamentos a2
   where a2.sessao_id = sv.id
     and a2.status not in ('cancelado', 'remarcado')
   order by a2.criado_em desc
   limit 1
) a on true
left join lateral (
  select l2.decisores_presentes_na_sessao
    from ligacoes_estrategicas l2
   where l2.jornada_id = j.id
   order by l2.realizada_em desc
   limit 1
) lg on true
where (e.ativa is true or j.edicao_id is null)
group by j.edicao_id, e.codigo, e.nome;

comment on view vw_sessoes_do_dia is 'Painel do dia, bloco 1: agenda de hoje e amanhã.';
comment on view vw_pendencias_preparo is 'Painel do dia, bloco 2: sessão em até 7 dias com preparo incompleto.';
comment on view vw_pagos_sem_contato is 'Painel do dia, bloco 3: pagou e ninguém falou com a pessoa (o furo que mais dói).';
comment on view vw_pendencias_sistema is 'Painel do dia, bloco 4: travado. Falta o tipo material_aguardando_aprovacao (0031, ONDA 3).';
comment on view vw_indicadores_pop01 is 'Painel do dia, bloco 5: os 3 indicadores do POP 01, por edição ativa.';
