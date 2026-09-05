-- 0052_sinais_kanban_cron_onboarding.sql
-- Fase 4 · F1/F6 (agente A). Depende de 0051.
--
-- O que entra (aditivo; nenhum DELETE, nenhum UPDATE de valor de cliente):
--   (a) configuracoes: regua.ultimo_cron_em (prova de vida do cron, UPDATE por
--       passagem — nunca linha nova) e sala.provedor ('manual' | 'n8n').
--   (b) perfis_equipe.onboarding_visto_em + RPC marcar_onboarding_visto()
--       (pe_admin_write só deixa admin escrever; a pessoa marca o PRÓPRIO tour).
--   (c) vw_sessoes_do_dia + presenca_confirmada_em/_via, agendamento_id, sessao_id.
--   (d) vw_jornada_kanban + presenca_confirmada_em, sessao_realizada_em,
--       tem_relatorio, croqui_status, material_estado, tarefas_abertas (F6 §6.2).
--   (e) vw_pendencias_sistema + sessao_sem_sala (janela 24h) + cron_parado
--       (> 15 min ou nunca).
--
-- ROTEIRO DE VERIFICAÇÃO (orquestrador, via MCP):
--   1) select chave, valor from configuracoes where chave in ('regua.ultimo_cron_em','sala.provedor');
--      -- esperado: 'null'::jsonb e '"manual"'
--   2) select * from vw_pendencias_sistema where tipo = 'cron_parado';
--      -- esperado: 1 linha ("Última passagem registrada: nunca") enquanto o cron não roda;
--      -- depois de um POST /api/cron/regua bem-sucedido: 0 linhas por 15 min.
--   3) select jornada_id, presenca_confirmada_em, tem_relatorio, croqui_status, material_estado, tarefas_abertas
--        from vw_jornada_kanban limit 5;
--      -- campos novos nulos/false/'nenhum'/'[]' onde não há dado — nunca inventados.
--   4) explain (analyze, buffers) select * from vw_jornada_kanban where desfecho = 'aberta';
--      -- esperado: subplans com Index Scan (idx_agendamentos_proximos / sessoes_viabilidade_jornada_id_key /
--      -- idx_croquis_jornada / uniq_material_atual / idx_tarefas_jornada); sem Seq Scan em agendamentos.
--   5) select relname, reloptions from pg_class where relname in ('vw_sessoes_do_dia','vw_jornada_kanban','vw_pendencias_sistema');
--      -- esperado: {security_invoker=true} nas três (armadilha da 0041b/0047).
--   6) Com JWT de relacionamento: select public.marcar_onboarding_visto();
--      select onboarding_visto_em from perfis_equipe where auth_user_id = auth.uid();  -- preenchido
--
-- REVERSÃO:
--   drop function public.marcar_onboarding_visto();
--   alter table perfis_equipe drop column onboarding_visto_em;
--   delete from configuracoes where chave in ('regua.ultimo_cron_em','sala.provedor');
--   -- vw_pendencias_sistema: recriar pelo texto da 0031:532-599 (4 tipos).
--   -- vw_sessoes_do_dia: `drop view` + recriar pelo texto da 0034:23-42.
--   -- vw_jornada_kanban: `drop view` + recriar pelo texto da 0023:12-29.

-- ===========================================================================
-- (a) configuracoes
-- ===========================================================================
insert into configuracoes (chave, valor, descricao) values
 ('regua.ultimo_cron_em', 'null'::jsonb,
  'Prova de vida do cron: POST /api/cron/regua grava now() a cada passagem (UPDATE, nunca linha nova). null = nunca rodou.'),
 ('sala.provedor', '"manual"'::jsonb,
  'Como o link da sala nasce: "manual" (colado na Ficha → Sessão) ou "n8n" (cron pede ao N8N_WEBHOOK_SALA_URL e o webhook /api/webhooks/n8n/sala grava).')
on conflict (chave) do nothing;

-- ===========================================================================
-- (b) Onboarding: coluna, não localStorage (§6.3 — "dispensei" é fato sobre a
-- pessoa, não sobre o navegador).
-- ===========================================================================
alter table perfis_equipe add column onboarding_visto_em timestamptz;
comment on column perfis_equipe.onboarding_visto_em is 'Quando a pessoa dispensou o tour de primeira vez. null = ainda não viu/dispensou.';

create or replace function public.marcar_onboarding_visto() returns perfis_equipe
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_perfil perfis_equipe%rowtype;
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado' using errcode = '42501';
  end if;
  update perfis_equipe
     set onboarding_visto_em = coalesce(onboarding_visto_em, now())
   where auth_user_id = auth.uid() and ativo
  returning * into v_perfil;
  if not found then
    raise exception 'sem_permissao: sem convite ativo' using errcode = '42501';
  end if;
  return v_perfil;
end $$;
revoke execute on function public.marcar_onboarding_visto() from public, anon;
grant  execute on function public.marcar_onboarding_visto() to authenticated;

-- ===========================================================================
-- (c) vw_sessoes_do_dia (0034:23-42) + colunas de presença. `create or replace
-- view` só ACRESCENTA colunas no fim — as 9 originais ficam na mesma ordem.
-- ===========================================================================
create or replace view vw_sessoes_do_dia with (security_invoker = true) as
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
  and a.inicio_em >= (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')
  and a.inicio_em <  (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') + interval '2 days'
order by a.inicio_em;

-- ===========================================================================
-- (d) vw_jornada_kanban (0023:12-29) + sinais de F6. Todas as colunas novas
-- são exists/min/subselect sobre índices que já existem; nenhuma tabela de
-- outro agente (ligacoes_ia, diagnosticos_sv) entra aqui — a view não pode
-- depender de migration que talvez não exista.
-- ===========================================================================
create or replace view vw_jornada_kanban with (security_invoker = true) as
select j.id, j.etapa, j.desfecho, j.origem, j.trilha, j.edicao_id, e.codigo as edicao_codigo,
       j.faixa_patrimonio_declarada, j.nivel_pago, j.responsavel_id,
       j.origem_dado,
       p.id as pessoa_id, p.nome, p.cidade, p.uf, p.telefone, p.email,
       j.entrou_na_etapa_em,
       extract(day from now() - j.entrou_na_etapa_em)::int as dias_na_etapa,
       exists (select 1 from formularios_respostas f where f.jornada_id = j.id) as tem_formulario,
       exists (select 1 from ligacoes_estrategicas l where l.jornada_id = j.id) as tem_ligacao,
       exists (select 1 from briefings b where b.jornada_id = j.id and b.atual)  as tem_briefing,
       (select min(a.inicio_em) from agendamentos a
          join sessoes_viabilidade s on s.id = a.sessao_id
         where s.jornada_id = j.id and a.status in ('agendado','confirmado')
           and a.inicio_em > now()) as proxima_sessao_em,
       -- presença do PRÓXIMO agendamento ativo (o mesmo de proxima_sessao_em)
       (select a.presenca_confirmada_em from agendamentos a
          join sessoes_viabilidade s on s.id = a.sessao_id
         where s.jornada_id = j.id and a.status in ('agendado','confirmado')
           and a.inicio_em > now()
         order by a.inicio_em limit 1) as presenca_confirmada_em,
       (select sv.realizada_em from sessoes_viabilidade sv where sv.jornada_id = j.id) as sessao_realizada_em,
       exists (select 1 from relatorios_sessao r
                 join sessoes_viabilidade sv on sv.id = r.sessao_id
                where sv.jornada_id = j.id) as tem_relatorio,
       (select c.status::text from croquis c where c.jornada_id = j.id order by c.versao desc limit 1) as croqui_status,
       coalesce((select case when mg.aprovado_em is not null then 'aprovado' else 'rascunho' end
                   from materiais_gerados mg where mg.jornada_id = j.id and mg.atual limit 1), 'nenhum') as material_estado,
       coalesce((select jsonb_agg(jsonb_build_object('tipo', t.tipo, 'responsavel_papel', pe.papel) order by t.vence_em nulls last)
                   from tarefas t left join perfis_equipe pe on pe.id = t.responsavel_id
                  where t.jornada_id = j.id and t.concluida_em is null), '[]'::jsonb) as tarefas_abertas
  from jornadas j
  join pessoas p on p.id = j.pessoa_id
  left join edicoes_seminario e on e.id = j.edicao_id;

comment on view vw_jornada_kanban is
  'Esteira/kanban. Desde a 0052 carrega os sinais de "próximo passo" (F6): presença, sessão realizada, relatório, croqui, material, tarefas abertas.';

-- ===========================================================================
-- (e) vw_pendencias_sistema (0031:532-599) + sessao_sem_sala + cron_parado.
-- Os 4 blocos anteriores são copiados idênticos; só os dois `union all` novos
-- e o `comment` mudam.
-- ===========================================================================
create or replace view vw_pendencias_sistema with (security_invoker = true) as
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
union all
select
  mg.id::text,
  'material_aguardando_aprovacao'::text,
  'Material pós-sessão aguardando aprovação'::text,
  case
    when mg.fonte_dor = 'nenhuma' then 'Material padrão (sem dor identificada) — revisar antes de aprovar.'
    else 'Personalizado pela dor declarada — revisar antes de aprovar.'
  end,
  mg.jornada_id,
  p.nome,
  mg.criado_em
from materiais_gerados mg
join jornadas j on j.id = mg.jornada_id
join pessoas p on p.id = j.pessoa_id
where mg.atual and mg.aprovado_em is null
union all
-- Sessão nas próximas 24h sem link da sala: o e-mail do dia fica em hold
-- (reivindicar_mensagens_pendentes, 0051) até alguém colar o link ou a
-- integração responder. Texto exato do §1.9.
select
  a.id::text,
  'sessao_sem_sala'::text,
  'Sessão sem link da sala'::text,
  'Sessão em ' || greatest(0, floor(extract(epoch from (a.inicio_em - now())) / 3600))::int
    || ' h sem link da sala — cole o link ou ligue a integração (N8N_WEBHOOK_SALA_URL, Admin → Integrações).',
  j.id,
  p.nome,
  a.inicio_em
from agendamentos a
join sessoes_viabilidade s on s.id = a.sessao_id
join jornadas j on j.id = s.jornada_id
join pessoas p on p.id = j.pessoa_id
where a.status in ('agendado', 'confirmado')
  and s.link_sala is null
  and a.inicio_em > now() - interval '1 hour'
  and a.inicio_em <= now() + interval '24 hours'
union all
-- Cron parado: nenhuma passagem há mais de 15 min (ou nunca). Uma linha só.
select
  'cron'::text,
  'cron_parado'::text,
  'A régua não está rodando'::text,
  'A régua ainda não roda sozinha: falta o cron da Hostinger chamar /api/cron/regua a cada 5 minutos com o CRON_SECRET de produção. Última passagem registrada: '
    || case
         when c.valor = 'null'::jsonb then 'nunca'
         else 'há ' || greatest(0, floor(extract(epoch from (now() - (c.valor #>> '{}')::timestamptz)) / 60))::int || ' min'
       end || '.',
  null::uuid,
  null::text,
  case when c.valor = 'null'::jsonb then null else (c.valor #>> '{}')::timestamptz end
from configuracoes c
where c.chave = 'regua.ultimo_cron_em'
  and (c.valor = 'null'::jsonb or (c.valor #>> '{}')::timestamptz < now() - interval '15 minutes')
order by ocorrido_em asc nulls last;

comment on view vw_pendencias_sistema is
  'Painel do dia, bloco 4: travado. Tipos: webhook_falho, mensagem_falhou, link_expirando, material_aguardando_aprovacao (0031), sessao_sem_sala e cron_parado (0052).';
