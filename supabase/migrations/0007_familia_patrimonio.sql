-- 0007_familia_patrimonio.sql
-- Composição familiar e patrimonial do Relatório da SV. PII SENSÍVEL.

create table familiares (
  id uuid primary key default gen_random_uuid(),
  pessoa_id uuid not null references pessoas(id) on delete restrict,
  registrado_na_jornada_id uuid references jornadas(id),
  parentesco text not null,             -- 'conjuge','filho','neto','outro'
  nome text, idade smallint check (idade between 0 and 130),
  ocupacao text,
  regime_casamento text,                -- do Relatório da SV
  ano_casamento smallint,
  dependente_financeiro boolean,
  observacoes text,
  -- Regra do projeto: nada de DELETE. Baixa é ativo=false (tabela não tem "desfecho").
  ativo boolean not null default true,
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now()
);
create index idx_familiares_pessoa on familiares (pessoa_id) where ativo;

create trigger trg_familiares_atualizado_em before update on familiares
for each row execute function app.set_atualizado_em();

-- Valor histórico E valor de mercado, como pede o template da Dra. Elaine.
create table patrimonio_itens (
  id uuid primary key default gen_random_uuid(),
  pessoa_id uuid not null references pessoas(id) on delete restrict,
  registrado_na_jornada_id uuid references jornadas(id),
  tipo tipo_bem not null,
  descricao text not null,
  ano_aquisicao smallint,
  valor_historico numeric(15,2) check (valor_historico >= 0),
  valor_mercado   numeric(15,2) check (valor_mercado   >= 0),
  destinacao text,                       -- 'residencia','locacao','uso da empresa'
  valor_locacao_mensal numeric(15,2) check (valor_locacao_mensal >= 0),
  -- campos específicos por tipo (empresa: objeto, composição societária, capital, PL, faturamento)
  detalhes jsonb not null default '{}'::jsonb,
  -- Regra do projeto: nada de DELETE. Baixa é ativo=false (tabela não tem "desfecho").
  ativo boolean not null default true,
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
  criado_por uuid references perfis_equipe(id), atualizado_por uuid references perfis_equipe(id)
);
create index idx_patrimonio_pessoa on patrimonio_itens (pessoa_id, tipo) where ativo;

create trigger trg_patrimonio_atualizado_em before update on patrimonio_itens
for each row execute function app.set_atualizado_em();

alter table familiares enable row level security;
alter table patrimonio_itens enable row level security;
alter table familiares force row level security;
alter table patrimonio_itens force row level security;

-- Composição familiar: toda a equipe (é operacional — quem participa da sessão).
create policy fam_sel on familiares for select to authenticated using ((select app.eh_interno()));
create policy fam_wr  on familiares for all to authenticated
  using ((select app.eh_interno())) with check ((select app.eh_interno()));

-- VALOR de patrimônio: SÓ admin e advogada. Relacionamento e assistente enxergam
-- apenas jornadas.faixa_patrimonio_declarada.
create policy pat_sel on patrimonio_itens for select to authenticated using ((select app.ve_patrimonio()));
create policy pat_wr  on patrimonio_itens for all to authenticated
  using ((select app.ve_patrimonio())) with check ((select app.ve_patrimonio()));
