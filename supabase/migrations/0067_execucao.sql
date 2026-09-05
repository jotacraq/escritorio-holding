-- 0067_execucao.sql — Fase 5 · M2 (`docs/ARQUITETURA-FASE-5.md` §5.3 e §8.1).
-- Aplicar depois da 0065. ADITIVO e IDEMPOTENTE. Nenhum DELETE, nenhum UPDATE
-- de dado de cliente, nenhum backfill.
--
-- O QUE É: a SUB-ESTEIRA da execução — o que acontece entre a assinatura do
-- contrato e a entrega da holding. Hoje isso é um PDF estático entregue ao
-- cliente ("CRONOGRAMA — HOLDING DA FAMÍLIA") e não existe em lugar nenhum do
-- sistema: o trilho comercial acaba em "holding contratada" e os 60 dias
-- seguintes são invisíveis
-- (`brain/06 - Materiais/Processo real do escritorio (Drive).md` §1 e §7).
--
-- Esta migration entrega SÓ O SCHEMA E O CATÁLOGO. Sem UI (é da Onda 3) e sem
-- nenhuma linha por jornada: `execucao_jornada_marcos` nasce VAZIA. O trilho
-- (`derivarTrilho`) usa a contagem para mostrar "4 de 19"; enquanto ninguém
-- marcar nada, o passo Execução fica "sem informação" — nunca "0%".
--
-- CONTAGEM DO SEED — o §5.3 fala em "15 marcos", e é exatamente o que a cadeia
-- principal tem: 4 de Contratações + 11 da Fase Executória. O cronograma real
-- traz ainda 3 etapas PARALELAS de ITBI (30/30/15 dias) e o marco final de
-- entrega (60 dias). Semear as 19 linhas é mais fiel ao processo do que
-- arredondar para 15 e perder o ITBI — que é justamente onde a execução
-- costuma travar. `paralelo = true` distingue quem não bloqueia a cadeia.
--
-- ===========================================================================
-- ROTEIRO DE VERIFICAÇÃO
--
--  0. PRÉ: select count(*) from pg_tables where tablename like 'execucao_%';  → 0
--
--  1. Catálogo semeado (como admin):
--       select fase, count(*), min(prazo_dias), max(prazo_dias)
--         from execucao_marcos m join execucao_modelos o on o.id = m.modelo_id
--        where o.chave = 'holding_3_celulas' group by 1 order by 1;
--     → contratacoes 4 · entrega 1 (60) · executoria 11 · paralela 3 (15..30)
--       select count(*) from execucao_marcos;  → 19
--
--  2. Dependência coerente (nenhum marco depende de si nem de outro modelo):
--       select count(*) from execucao_marcos m
--        where exists (select 1 from unnest(m.depende_de) d where d = m.id);           → 0
--       select count(*) from execucao_marcos m, unnest(m.depende_de) d
--        join execucao_marcos p on p.id = d where p.modelo_id <> m.modelo_id;          → 0
--       select count(*) from execucao_marcos m, unnest(m.depende_de) d
--        join execucao_marcos p on p.id = d where p.ordem >= m.ordem;                  → 0
--
--  3. RLS (como `relacionamento`):
--       select count(*) from execucao_marcos;            → 19 (catálogo é interno, não é PII)
--       select count(*) from execucao_jornada_marcos;    → 0 linhas (RLS ve_patrimonio)
--       insert into execucao_jornada_marcos (jornada_id, marco_id) values (:j, :m);   → 42501
--       insert into execucao_marcos (...)                                             → 42501 (só admin)
--
--  4. Como `advogada`:
--       insert into execucao_jornada_marcos (jornada_id, marco_id, concluido_em, concluido_por)
--         values (:j, :m, '2000-01-01', :outro);
--       → ok, `concluido_em` ≈ now(), `concluido_por` = perfil de auth.uid()
--       mesmo (jornada_id, marco_id) de novo                    → 23505
--       update ... set concluido_em = null                      → 23514 marco_imutavel
--       delete from execucao_jornada_marcos where ...           → 42501 (sem grant)
--       select count(*) from eventos_timeline where jornada_id = :j and tipo = 'execucao'; → 1
--
--  5. Progresso (a consulta que a rota faz):
--       select count(*) filter (where jm.concluido_em is not null), count(*)
--         from execucao_marcos m
--         left join execucao_jornada_marcos jm on jm.marco_id = m.id and jm.jornada_id = :j
--        where m.modelo_id = :modelo;                            → 1, 19
--
--  6. Reaplicar não duplica (o seed é `on conflict (modelo_id, ordem) do nothing`).
--
-- REVERSÃO:
--   drop trigger if exists trg_execucao_marco_timeline on execucao_jornada_marcos;
--   drop trigger if exists trg_execucao_marco_protege on execucao_jornada_marcos;
--   drop function if exists app.execucao_marco_timeline();
--   drop function if exists app.protege_execucao_marco();
--   drop table if exists execucao_jornada_marcos;
--   drop table if exists execucao_marcos;
--   drop table if exists execucao_modelos;
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Catálogo: modelo (quantas células) → marcos (o cronograma)
-- ---------------------------------------------------------------------------
create table if not exists execucao_modelos (
  id          uuid primary key default gen_random_uuid(),
  chave       text not null unique,
  rotulo      text not null,
  celulas     smallint not null check (celulas between 1 and 3),
  ativo       boolean not null default true,
  -- 'real' = veio do cronograma do escritório; 'exemplo' = fixture de dev.
  origem_dado text not null default 'real' check (origem_dado in ('real', 'exemplo')),
  criado_em   timestamptz not null default now()
);

create table if not exists execucao_marcos (
  id          uuid primary key default gen_random_uuid(),
  modelo_id   uuid not null references execucao_modelos(id) on delete cascade,
  ordem       smallint not null check (ordem > 0),
  rotulo      text not null check (length(rotulo) between 3 and 200),
  fase        text not null check (fase in ('contratacoes', 'executoria', 'paralela', 'entrega')),
  -- Prazo do cronograma. NULL = marco sem prazo próprio (corre junto do anterior).
  prazo_dias  smallint check (prazo_dias is null or prazo_dias between 1 and 365),
  depende_de  uuid[] not null default '{}'::uuid[],
  paralelo    boolean not null default false,
  criado_em   timestamptz not null default now(),
  constraint uniq_execucao_marco_ordem unique (modelo_id, ordem)
);
create index if not exists idx_execucao_marcos_modelo on execucao_marcos (modelo_id, ordem);

-- ---------------------------------------------------------------------------
-- A instância por jornada. NASCE VAZIA: ausência de linha = marco não
-- concluído. Nunca semeamos 19 linhas "false" por cliente — seria inventar
-- estado para quem talvez nem tenha começado a execução.
-- ---------------------------------------------------------------------------
create table if not exists execucao_jornada_marcos (
  jornada_id    uuid not null references jornadas(id) on delete cascade,
  marco_id      uuid not null references execucao_marcos(id) on delete cascade,
  concluido_em  timestamptz not null default now(),
  concluido_por uuid references perfis_equipe(id),
  nota          text check (nota is null or length(nota) <= 500),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (jornada_id, marco_id)
);
create index if not exists idx_execucao_jornada_marcos_marco on execucao_jornada_marcos (marco_id);

drop trigger if exists trg_execucao_jm_atualizado_em on execucao_jornada_marcos;
create trigger trg_execucao_jm_atualizado_em before update on execucao_jornada_marcos
for each row execute function app.set_atualizado_em();

-- Carimbo de servidor + "marco concluído não volta atrás".
create or replace function app.protege_execucao_marco() returns trigger
language plpgsql as $$
declare v_perfil uuid;
begin
  select id into v_perfil from perfis_equipe where auth_user_id = auth.uid() and ativo;

  if tg_op = 'INSERT' then
    if v_perfil is not null then
      new.concluido_em  := now();
      new.concluido_por := v_perfil;
    end if;
    return new;
  end if;

  if new.jornada_id is distinct from old.jornada_id
     or new.marco_id is distinct from old.marco_id
     or new.concluido_em is distinct from old.concluido_em
     or new.concluido_por is distinct from old.concluido_por then
    raise exception 'marco_imutavel: marco concluído só aceita mudança de nota.' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists trg_execucao_marco_protege on execucao_jornada_marcos;
create trigger trg_execucao_marco_protege before insert or update on execucao_jornada_marcos
for each row execute function app.protege_execucao_marco();

create or replace function app.execucao_marco_timeline() returns trigger
language plpgsql as $$
declare v_rotulo text;
begin
  select rotulo into v_rotulo from execucao_marcos where id = new.marco_id;
  perform app.registrar_evento_timeline(new.jornada_id, 'execucao',
    'Marco concluído', v_rotulo,
    jsonb_build_object('marco_id', new.marco_id, 'rotulo', v_rotulo));
  return null;
end $$;

drop trigger if exists trg_execucao_marco_timeline on execucao_jornada_marcos;
create trigger trg_execucao_marco_timeline after insert on execucao_jornada_marcos
for each row execute function app.execucao_marco_timeline();

-- ---------------------------------------------------------------------------
-- RLS. O catálogo é regra do método (leitura de qualquer papel interno; escrita
-- só de admin, como `parametros_metodo` na 0056). A instância por jornada diz
-- em que pé está o patrimônio de UMA família: `ve_patrimonio`.
-- ---------------------------------------------------------------------------
alter table execucao_modelos          enable row level security;
alter table execucao_modelos          force  row level security;
alter table execucao_marcos           enable row level security;
alter table execucao_marcos           force  row level security;
alter table execucao_jornada_marcos   enable row level security;
alter table execucao_jornada_marcos   force  row level security;

drop policy if exists em_sel on execucao_modelos;
create policy em_sel on execucao_modelos for select to authenticated using ((select app.eh_interno()));
drop policy if exists em_wr on execucao_modelos;
create policy em_wr  on execucao_modelos for all to authenticated
  using ((select app.eh_admin())) with check ((select app.eh_admin()));

drop policy if exists ex_sel on execucao_marcos;
create policy ex_sel on execucao_marcos for select to authenticated using ((select app.eh_interno()));
drop policy if exists ex_wr on execucao_marcos;
create policy ex_wr  on execucao_marcos for all to authenticated
  using ((select app.eh_admin())) with check ((select app.eh_admin()));

drop policy if exists ejm_sel on execucao_jornada_marcos;
create policy ejm_sel on execucao_jornada_marcos for select to authenticated
  using ((select app.ve_patrimonio()));
drop policy if exists ejm_ins on execucao_jornada_marcos;
create policy ejm_ins on execucao_jornada_marcos for insert to authenticated
  with check ((select app.ve_patrimonio()));
drop policy if exists ejm_upd on execucao_jornada_marcos;
create policy ejm_upd on execucao_jornada_marcos for update to authenticated
  using ((select app.ve_patrimonio())) with check ((select app.ve_patrimonio()));

revoke all on execucao_modelos, execucao_marcos, execucao_jornada_marcos from public, anon;
grant select on execucao_modelos, execucao_marcos to authenticated;
grant insert, update on execucao_modelos, execucao_marcos to authenticated;  -- só admin passa na policy; DELETE não existe para ninguém
grant select, insert on execucao_jornada_marcos to authenticated;
grant update (nota) on execucao_jornada_marcos to authenticated;
grant select, insert, update on execucao_modelos, execucao_marcos, execucao_jornada_marcos to service_role;

comment on table execucao_marcos is
  'Fase 5 §5.3 — catálogo do cronograma real de execução do escritório (contratações → fase executória → paralelas de ITBI → entrega). Regra do método, não dado de cliente.';
comment on table execucao_jornada_marcos is
  'Fase 5 §8.1 — marcos JÁ CONCLUÍDOS por jornada. Ausência de linha = não concluído; nunca semeamos "false" por cliente. RLS ve_patrimonio, sem DELETE.';

-- ---------------------------------------------------------------------------
-- SEED — cronograma real do modelo de 3 células (Cofre · Veículo · Destino).
-- Fonte: "CRONOGRAMA — HOLDING DA FAMÍLIA" (PDF entregue ao cliente após a
-- assinatura), lido em 05/09/2026. Nenhum dado de cliente aqui: são as etapas
-- do método. Prazos em dias, como no infográfico.
-- ---------------------------------------------------------------------------
insert into execucao_modelos (chave, rotulo, celulas)
values ('holding_3_celulas', 'Holding · 3 células', 3)
on conflict (chave) do nothing;

with modelo as (select id from execucao_modelos where chave = 'holding_3_celulas')
insert into execucao_marcos (modelo_id, ordem, rotulo, fase, prazo_dias, paralelo)
select modelo.id, v.ordem, v.rotulo, v.fase, v.prazo_dias, v.paralelo
from modelo, (values
  -- Contratações (correm em paralelo entre si)
  ( 1, 'Reunião de ajustes e assinatura do contrato',                 'contratacoes',  7::smallint, true),
  ( 2, 'Certificado digital da família',                              'contratacoes',  7::smallint, true),
  ( 3, 'Constituição das células e registro na Junta',                'contratacoes',  7::smallint, true),
  ( 4, 'Envio do cronograma',                                         'contratacoes',  null::smallint, true),
  -- Fase executória (cadeia linear: cada uma depende da anterior)
  ( 5, '1ª alteração da Destino e pagamento do imposto de doação',    'executoria',    7::smallint, false),
  ( 6, 'Acordo de sócios da Destino',                                 'executoria',    7::smallint, false),
  ( 7, '1ª alteração da Cofre e integralização do patrimônio',        'executoria',    7::smallint, false),
  ( 8, 'Acordo de sócios da Cofre',                                   'executoria',    7::smallint, false),
  ( 9, 'Conta bancária da Destino e depósito do capital',             'executoria',    7::smallint, false),
  (10, '2ª alteração da Cofre — quotas para a Veículo',               'executoria',    7::smallint, false),
  (11, 'Alteração das empresas com quotas para a Veículo',            'executoria',    null::smallint, true),
  (12, '1ª alteração da Veículo — recebe as quotas',                  'executoria',    7::smallint, false),
  (13, '2ª alteração da Veículo — compra pela Destino',               'executoria',   30::smallint, false),
  (14, 'Transferência de titularidade para a empresa',                'executoria',   30::smallint, false),
  (15, 'Registro da propriedade em nome da Cofre',                    'executoria',   30::smallint, false),
  -- Paralelas de ITBI
  (16, 'Requerimento de imunidade de ITBI',                           'paralela',     30::smallint, true),
  (17, 'Recurso do ITBI',                                             'paralela',     30::smallint, true),
  (18, 'Imunidade de ITBI aprovada',                                  'paralela',     15::smallint, true),
  -- Entrega
  (19, 'Entrega do sistema à família',                                'entrega',      60::smallint, false)
) as v(ordem, rotulo, fase, prazo_dias, paralelo)
on conflict (modelo_id, ordem) do nothing;

-- Dependências: a cadeia executória é linear (5←4, 6←5, …, 15←14), o ITBI é uma
-- cadeia própria (17←16, 18←17) e a entrega depende do último registro.
-- Resolvido por `ordem` porque os ids são gerados no insert acima.
do $$
declare v_modelo uuid;
begin
  select id into v_modelo from execucao_modelos where chave = 'holding_3_celulas';
  if v_modelo is null then return; end if;

  update execucao_marcos m
     set depende_de = array[p.id]
    from execucao_marcos p
   where m.modelo_id = v_modelo and p.modelo_id = v_modelo
     and m.depende_de = '{}'::uuid[]
     and (
       (m.ordem between 5 and 15 and p.ordem = m.ordem - 1)
       or (m.ordem in (17, 18) and p.ordem = m.ordem - 1)
       or (m.ordem = 19 and p.ordem = 15)
     );
end $$;
