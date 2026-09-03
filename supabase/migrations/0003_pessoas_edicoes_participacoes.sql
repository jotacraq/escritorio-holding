-- 0003_pessoas_edicoes_participacoes.sql
-- Identidade da pessoa (permanente) e origem (edição do seminário / participação = evento).

create table pessoas (
  id           uuid primary key default gen_random_uuid(),
  nome         text not null,
  email        text,
  telefone     text,                     -- E.164 normalizado pelo app
  cidade       text,
  uf           char(2),
  profissao    text,
  faixa_etaria text,                     -- espelha o POP 02 pergunta 4
  estado_civil text,
  observacoes  text,
  ativo        boolean not null default true,
  auth_user_id uuid unique references auth.users(id), -- FUTURO portal do cliente. Hoje sempre NULL.
  -- Carimbo de dado fictício de seed (0016). A UI usa isto para marcar a linha na tela.
  origem_dado text not null default 'real' check (origem_dado in ('real','exemplo')),
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
  criado_por uuid references perfis_equipe(id), atualizado_por uuid references perfis_equipe(id)
);
-- Deduplicação: e-mail e telefone são únicos quando presentes, nunca obrigatórios.
create unique index uniq_pessoas_email    on pessoas (lower(email)) where email is not null;
create unique index uniq_pessoas_telefone on pessoas (telefone)     where telefone is not null;
create index idx_pessoas_nome_busca on pessoas using gin (to_tsvector('pt_unaccent', nome));

create trigger trg_pessoas_atualizado_em before update on pessoas
for each row execute function app.set_atualizado_em();

create table edicoes_seminario (
  id        uuid primary key default gen_random_uuid(),
  codigo    text not null unique,          -- ex.: 'SEM-2026-09'
  nome      text not null,                 -- 'Seminário Setembro/2026'
  inicio_em date not null,
  fim_em    date not null,
  ativa     boolean not null default true,
  origem_dado text not null default 'real' check (origem_dado in ('real','exemplo')),
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
  constraint ck_edicao_janela check (fim_em >= inicio_em)
);

create trigger trg_edicoes_seminario_atualizado_em before update on edicoes_seminario
for each row execute function app.set_atualizado_em();

-- Participação é EVENTO, não atributo. Pessoa que volta em outra edição ganha linha nova.
create table participacoes_seminario (
  id         uuid primary key default gen_random_uuid(),
  pessoa_id  uuid not null references pessoas(id) on delete restrict,
  edicao_id  uuid not null references edicoes_seminario(id) on delete restrict,
  origem     origem_lead not null default 'seminario',
  dias_assistidos smallint check (dias_assistidos between 0 and 3),
  registrado_em timestamptz not null default now(),
  criado_em timestamptz not null default now(),
  unique (pessoa_id, edicao_id)
);
create index idx_participacoes_edicao on participacoes_seminario (edicao_id);

alter table pessoas                enable row level security;
alter table edicoes_seminario      enable row level security;
alter table participacoes_seminario enable row level security;
alter table pessoas                 force row level security;
alter table edicoes_seminario       force row level security;
alter table participacoes_seminario force row level security;

-- Toda a equipe lê pessoa (nome/contato). Valor de patrimônio NÃO mora aqui.
create policy pessoas_sel on pessoas for select to authenticated using ((select app.eh_interno()));
create policy pessoas_ins on pessoas for insert to authenticated with check ((select app.eh_interno()));
create policy pessoas_upd on pessoas for update to authenticated
  using ((select app.eh_interno())) with check ((select app.eh_interno()));
-- NOTA: não existe policy de DELETE em lugar nenhum deste schema. Baixa é ativo=false.

create policy edicoes_sel on edicoes_seminario for select to authenticated using ((select app.eh_interno()));
create policy edicoes_wr  on edicoes_seminario for all to authenticated
  using ((select app.eh_admin())) with check ((select app.eh_admin()));

create policy part_sel on participacoes_seminario for select to authenticated using ((select app.eh_interno()));
create policy part_ins on participacoes_seminario for insert to authenticated with check ((select app.eh_interno()));
