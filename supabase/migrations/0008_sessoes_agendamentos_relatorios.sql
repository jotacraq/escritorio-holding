-- 0008_sessoes_agendamentos_relatorios.sql
-- A reunião (sessão), o slot (agendamento) e o relatório da Dra. Elaine.

create table sessoes_viabilidade (
  id uuid primary key default gen_random_uuid(),
  jornada_id uuid not null unique references jornadas(id) on delete cascade,  -- 1:1 com a jornada
  advogada_id uuid references perfis_equipe(id),
  link_sala text,                        -- Zoom. MVP: colado à mão (BLOQUEIO B10).
  realizada_em timestamptz,
  gravacao_url text,                     -- URL externa; conteúdo não fica no nosso Storage no MVP
  resultado text check (resultado in ('fechou','nao_fechou','indefinido')),
  motivo_resultado text,
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now()
);

create trigger trg_sessoes_atualizado_em before update on sessoes_viabilidade
for each row execute function app.set_atualizado_em();

create table agendamentos (
  id uuid primary key default gen_random_uuid(),
  sessao_id uuid not null references sessoes_viabilidade(id) on delete cascade,
  inicio_em timestamptz not null,
  fim_em    timestamptz not null,
  status status_agendamento not null default 'agendado',
  origem  text not null default 'equipe' check (origem in ('equipe','cliente','ia')),
  observacoes text,
  advogada_id uuid references perfis_equipe(id),
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
  criado_por uuid references perfis_equipe(id),
  constraint ck_agenda_janela check (fim_em > inicio_em)
);
-- Um slot confirmado por sessão por vez.
create unique index uniq_agendamento_confirmado on agendamentos (sessao_id) where status = 'confirmado';
-- A Dra. Elaine não pode estar em duas salas ao mesmo tempo. O banco garante.
alter table agendamentos add constraint ex_agenda_sem_sobreposicao
  exclude using gist (advogada_id with =, tstzrange(inicio_em, fim_em) with &&)
  where (status in ('agendado','confirmado'));
create index idx_agendamentos_proximos on agendamentos (inicio_em) where status in ('agendado','confirmado');

create trigger trg_agendamentos_atualizado_em before update on agendamentos
for each row execute function app.set_atualizado_em();

-- Espelha 1:1 o "Relatório da Sessão de Viabilidade (template)".
-- Cabeçalho vira coluna (é consultado/filtrado); corpo narrativo vira texto.
create table relatorios_sessao (
  id uuid primary key default gen_random_uuid(),
  sessao_id uuid not null unique references sessoes_viabilidade(id) on delete cascade,
  acompanhado boolean, quem_acompanha text,
  acompanhante_decide boolean, acompanhante_assistiu boolean,
  data_contratacao date, valor_pago_sessao numeric(15,2), parcelas smallint,
  motivacao_cliente text,
  receita_familiar_mensal numeric(15,2),
  ideia_custo_inventario text, reserva_ou_seguro text,
  ciente_itcmd boolean, preocupacao_predominante text,
  como_deseja_organizar text, motiva_evitar_inventario text,
  interesse_imediato text, relacao_filhos_terceiros text,
  porque_nos_procurou text, falta_planejamento_preocupa text,
  resultado_sessao text,
  -- Bloco "Dados para início da execução do croqui" (ITCMD / ITBI / cartórios).
  -- NOTA: nenhum cálculo automático de imposto no MVP. Alíquota e link são digitados
  -- pela advogada. Inventar cálculo tributário aqui seria inventar regra de negócio.
  tributos jsonb not null default '{}'::jsonb,
  consideracoes_apresentacao_croqui text,
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
  criado_por uuid references perfis_equipe(id), atualizado_por uuid references perfis_equipe(id)
);

create trigger trg_relatorios_atualizado_em before update on relatorios_sessao
for each row execute function app.set_atualizado_em();

alter table sessoes_viabilidade enable row level security;
alter table agendamentos enable row level security;
alter table relatorios_sessao enable row level security;
alter table sessoes_viabilidade force row level security;
alter table agendamentos force row level security;
alter table relatorios_sessao force row level security;

create policy ses_sel on sessoes_viabilidade for select to authenticated using ((select app.eh_interno()));
create policy ses_wr  on sessoes_viabilidade for all to authenticated
  using ((select app.eh_interno())) with check ((select app.eh_interno()));

create policy age_sel on agendamentos for select to authenticated using ((select app.eh_interno()));
create policy age_wr  on agendamentos for all to authenticated
  using ((select app.eh_interno())) with check ((select app.eh_interno()));

-- Relatório contém valores e detalhe patrimonial: mesmo recorte do patrimônio.
create policy rel_sel on relatorios_sessao for select to authenticated using ((select app.ve_patrimonio()));
create policy rel_wr  on relatorios_sessao for all to authenticated
  using ((select app.ve_patrimonio())) with check ((select app.ve_patrimonio()));
