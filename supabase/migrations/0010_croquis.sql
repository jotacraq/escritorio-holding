-- 0010_croquis.sql
-- Croqui em modo apresentação. Nasce com os 13 slides tipados da "Estrutura
-- universal do croqui" (Agente do Croqui, §42): Legado, Controle, Família,
-- Patrimônio, Risco, Alternativas, 1 célula, 2 células, 3 células, Controle na
-- arquitetura, Economia, Implementação, Investimento.
--
-- NOTA: os 13 tipos são impostos pela API (zod, src/server/ia/schema-croqui-slides.ts),
-- não por CHECK no banco — o corpo de cada slide é editável pela advogada e o schema
-- pode evoluir mais rápido que uma migration. O banco garante o essencial: um croqui
-- pronto/apresentado por jornada, e RLS por quem vê patrimônio.

create table croquis (
  id         uuid primary key default gen_random_uuid(),
  jornada_id uuid not null references jornadas(id) on delete cascade,
  versao     smallint not null,
  titulo     text not null,
  status     status_croqui not null default 'rascunho',
  -- {slides:[{id, ordem, tipo, titulo, objetivo, pergunta_ao_cliente, conteudo}]} —
  -- nomes de campo espelham `CroquiSlide` em src/lib/api.ts (contrato do front).
  conteudo   jsonb not null default '{"slides":[]}'::jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  criado_por     uuid references perfis_equipe(id),
  atualizado_por uuid references perfis_equipe(id),
  unique (jornada_id, versao)
);
create unique index uniq_croqui_pronto on croquis (jornada_id) where status in ('pronto','apresentado');
create index idx_croquis_jornada on croquis (jornada_id, versao desc);

create trigger trg_croquis_atualizado_em before update on croquis
for each row execute function app.set_atualizado_em();

create table croqui_apresentacoes (
  id               uuid primary key default gen_random_uuid(),
  croqui_id        uuid not null references croquis(id) on delete cascade,
  iniciada_em      timestamptz not null default now(),
  encerrada_em     timestamptz,
  slides_vistos    int,
  apresentador_id  uuid references perfis_equipe(id)
);
create index idx_croqui_apresentacoes_croqui on croqui_apresentacoes (croqui_id, iniciada_em desc);

-- Análise do Agente do Croqui (a SEGUNDA IA, pós-SV) fica anexada ao croqui —
-- é o insumo que a advogada usa para montar/ajustar os slides. Imutável, como o briefing.
create table croqui_analises (
  id             uuid primary key default gen_random_uuid(),
  croqui_id      uuid not null references croquis(id) on delete cascade,
  execucao_id    uuid not null references execucoes_ia(id),
  versao         smallint not null,
  conteudo       jsonb not null,        -- 14 seções do §45, cada afirmação carimbada (§2)
  grau_confianca smallint check (grau_confianca between 0 and 100),
  atual          boolean not null default true,
  criado_em      timestamptz not null default now(),
  unique (croqui_id, versao)
);
create unique index uniq_croqui_analise_atual on croqui_analises (croqui_id) where atual;

-- Mesmo padrão de public.registrar_briefing (0009): troca o "atual" numa
-- transação só. Vive em public (não app) para ser chamável via `.rpc()`.
create or replace function public.registrar_croqui_analise(
  p_croqui_id uuid, p_execucao_id uuid, p_conteudo jsonb, p_grau_confianca smallint
) returns croqui_analises
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_versao smallint; v_linha croqui_analises;
begin
  update croqui_analises set atual = false where croqui_id = p_croqui_id and atual;
  select coalesce(max(versao), 0) + 1 into v_versao from croqui_analises where croqui_id = p_croqui_id;
  insert into croqui_analises (croqui_id, execucao_id, versao, conteudo, grau_confianca, atual)
  values (p_croqui_id, p_execucao_id, v_versao, p_conteudo, p_grau_confianca, true)
  returning * into v_linha;
  return v_linha;
end $$;
revoke execute on function public.registrar_croqui_analise from public, anon, authenticated;
grant  execute on function public.registrar_croqui_analise to service_role;

alter table croquis enable row level security;
alter table croquis force row level security;
alter table croqui_apresentacoes enable row level security;
alter table croqui_apresentacoes force row level security;
alter table croqui_analises enable row level security;
alter table croqui_analises force row level security;

-- Croqui carrega números de patrimônio e arquitetura societária: mesmo recorte do
-- patrimônio (admin/advogada).
create policy cro_sel on croquis for select to authenticated using ((select app.ve_patrimonio()));
create policy cro_wr  on croquis for all to authenticated
  using ((select app.ve_patrimonio())) with check ((select app.ve_patrimonio()));
create policy cap_sel on croqui_apresentacoes for select to authenticated using ((select app.eh_interno()));
create policy cap_ins on croqui_apresentacoes for insert to authenticated with check ((select app.ve_patrimonio()));
create policy cap_upd on croqui_apresentacoes for update to authenticated
  using ((select app.ve_patrimonio())) with check ((select app.ve_patrimonio()));
create policy cran_sel on croqui_analises for select to authenticated using ((select app.ve_patrimonio()));
-- Sem policy de INSERT/UPDATE para authenticated em croqui_analises: gravado pela
-- rota de IA com service_role, mesmo motivo de execucoes_ia/briefings (0009).
