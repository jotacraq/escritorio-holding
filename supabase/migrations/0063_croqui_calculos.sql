-- 0063_croqui_calculos.sql — Fase 5, Onda 1 (M1 · Motor do Croqui). NÃO APLICADA
-- (o orquestrador aplica). Depende da 0062. ADITIVA; nenhum DELETE, nenhum
-- UPDATE de valor de cliente, nenhum backfill.
--
-- O QUE ESTA TABELA RESOLVE
-- Hoje o croqui do escritório sai de uma planilha ligada a slides por um Apps
-- Script sem log, sem versão anterior e sem aviso de falha. O recon do Drive
-- achou o resultado disso: um deck REAL, entregue ao cliente, com "R$ 0,00" no
-- custo do inventário e a frase "a família perde aproximadamente R$ 0,00" — a
-- sincronização falhou em silêncio e ninguém viu antes de enviar. Uma segunda
-- cópia do mesmo deck traz números diferentes nas mesmas células.
--
-- `croqui_calculos` guarda os TRÊS pedaços que tornam um croqui reproduzível:
-- a entrada (patrimônio e família daquele dia), os parâmetros (com as faixas
-- de cada versão usada) e o resultado. Reproduzir um croqui de seis meses
-- atrás é `calcularCroqui(entrada_snapshot, parametros_snapshot)` e comparar
-- com `resultado`. Se der diferente, ou o motor mudou, ou alguém mexeu.
--
-- INVARIANTES QUE O BANCO GARANTE SOZINHO
--   1. Uma só versão `atual` por jornada (unique parcial).
--   2. Snapshot IMUTÁVEL: `entrada_snapshot`, `parametros_snapshot`,
--      `resultado`, `versao`, `jornada_id` e `motor_versao` não mudam nunca.
--      Só `nota` é editável, e `atual` só troca por dentro da RPC.
--   3. Sem DELETE para `authenticated`: histórico de croqui não se apaga.
--   4. RLS `app.ve_patrimonio()` + `force row level security`: `relacionamento`
--      NÃO lê (o snapshot é o patrimônio inteiro do cliente).
--   5. O resultado NUNCA vem do cliente. A rota recalcula no servidor com os
--      `parametros_metodo` vigentes e ignora qualquer `resultado` do corpo —
--      senão o simulador ao vivo viraria uma porta para gravar número forjado.
--
-- ===========================================================================
-- ROTEIRO DE VERIFICAÇÃO (como postgres/service_role; sub-blocos transacionais
-- terminando em `raise exception 'rollback_proposital'`, no molde de
-- scripts/verificacao-0061.sql, devolvendo resultado_0063(passo, ok, detalhe)).
-- :j = jornada de teste; :adv = perfil advogada; :int = auth.users sem perfil.
--
--   1. Versão e atual (como advogada):
--      select versao, atual from public.registrar_croqui_calculo(
--        :j, null, 'motor-croqui@1',
--        '{"jornada_id":"…","bens":[]}'::jsonb, '{"itens":{}}'::jsonb,
--        '{"motor_versao":"motor-croqui@1","tabelas":{}}'::jsonb, null);
--      → 1 | true.  Repetir → 2 | true, e a v1 fica atual = false.
--      select count(*) from croqui_calculos where jornada_id = :j and atual;  → 1
--
--   2. Unique parcial impede duas atuais (como postgres):
--      update croqui_calculos set atual = true where jornada_id = :j and versao = 1;
--      → ERRO 'calculo_atual_imutavel' (23514) pelo trigger; e mesmo com o flag
--        de sessão ligado, o índice uniq_croqui_calculo_atual recusa (23505).
--
--   3. Imutabilidade do snapshot:
--      update croqui_calculos set resultado = '{}'::jsonb where jornada_id = :j and atual;
--      → ERRO 'calculo_imutavel' (23514)
--      update croqui_calculos set entrada_snapshot = '{}'::jsonb …   → 23514
--      update croqui_calculos set parametros_snapshot = '{}'::jsonb … → 23514
--      update croqui_calculos set versao = 9 …                        → 23514
--      update croqui_calculos set nota = 'conferido com a Dra. Elaine' where jornada_id = :j and atual;
--      → 1 linha (nota É editável, de propósito)
--
--   4. Sem DELETE para authenticated (como advogada):
--      delete from croqui_calculos where jornada_id = :j;  → 42501 permission denied
--
--   5. RLS por papel:
--      como `relacionamento`: select count(*) from croqui_calculos where jornada_id = :j;  → 0
--      como `relacionamento`: select public.registrar_croqui_calculo(:j, …);               → 42501
--      como intruso (auth.users SEM perfis_equipe): idem → 42501, e
--        select count(*) from croqui_calculos → 0
--        (é a lição da 0061: `app.ve_patrimonio()` já devolve false, nunca NULL —
--         sem isso o `if not …` não levantaria e o intruso gravaria linha.)
--
--   6. Resultado precisa ter forma de resultado:
--      select public.registrar_croqui_calculo(:j, null, 'motor-croqui@1', '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, null);
--      → 23514 'resultado_invalido' (array não é resultado)
--      … com resultado '{"tabelas":[]}'  → 23514 (tabelas precisa ser objeto)
--
--   7. Croqui de outra jornada não cola:
--      select public.registrar_croqui_calculo(:j, :croqui_de_outra_jornada, …); → 23514 'croqui_de_outra_jornada'
--
--   8. View e índice:
--      select reloptions from pg_class where relname = 'vw_croqui_calculo_atual';  → {security_invoker=true}
--      select count(*) from vw_croqui_calculo_atual where jornada_id = :j;         → 1
--      select indexdef from pg_indexes where indexname = 'uniq_croqui_calculo_atual';
--      → CREATE UNIQUE INDEX … ON public.croqui_calculos USING btree (jornada_id) WHERE atual
--
--   9. Timeline registrada:
--      select tipo, titulo from eventos_timeline where jornada_id = :j and tipo = 'croqui'
--       order by ocorrido_em desc limit 1;  → 'Croqui calculado (v2)'
--
--  10. Reprodutibilidade (fora do banco): `npx tsx scripts/teste-motor-croqui.ts
--      --fixture <snapshot>` com `entrada_snapshot`/`parametros_snapshot` da
--      linha → o resultado tem de bater célula a célula com `resultado`.
--
--  11. Reaplicar a migration não duplica nada.
--
-- REVERSÃO (nesta ordem):
--   drop view if exists vw_croqui_calculo_atual;
--   drop function if exists public.registrar_croqui_calculo(uuid, uuid, text, jsonb, jsonb, jsonb, text);
--   drop function if exists public.fixar_croqui_calculo(uuid);
--   drop table if exists croqui_calculos;                 -- leva triggers junto
--   drop function if exists app.croqui_calculo_imutavel();
--   drop function if exists app.timeline_croqui_calculo();
--   drop function if exists app.resultado_croqui_valido(jsonb);
-- ===========================================================================

-- Forma mínima do resultado. IMMUTABLE para viver num CHECK — a rota já valida
-- em zod, mas quem escreve por PostgREST direto não passa pela rota.
create or replace function app.resultado_croqui_valido(p jsonb) returns boolean
language sql immutable
set search_path = public, pg_temp
as $$
  select jsonb_typeof(p) = 'object'
     and jsonb_typeof(p->'tabelas') = 'object'
     and (not (p ? 'faltas')      or jsonb_typeof(p->'faltas') = 'array')
     and (not (p ? 'divergencias') or jsonb_typeof(p->'divergencias') = 'array')
$$;
revoke execute on function app.resultado_croqui_valido(jsonb) from public, anon;
grant  execute on function app.resultado_croqui_valido(jsonb) to authenticated, service_role;

create table if not exists croqui_calculos (
  id                  uuid primary key default gen_random_uuid(),
  jornada_id          uuid not null references jornadas(id) on delete cascade,
  croqui_id           uuid references croquis(id) on delete set null,
  versao              smallint not null,
  motor_versao        text not null check (motor_versao ~ '^motor-croqui@[0-9]+$'),
  -- Os três pedaços que tornam o cálculo reproduzível.
  entrada_snapshot    jsonb not null,
  parametros_snapshot jsonb not null,   -- inclui as faixas de cada versão usada
  resultado           jsonb not null,
  atual               boolean not null default false,
  nota                text,
  criado_em           timestamptz not null default now(),
  criado_por          uuid references perfis_equipe(id),
  unique (jornada_id, versao),
  constraint ck_resultado_valido check (app.resultado_croqui_valido(resultado)),
  constraint ck_snapshots_objeto check (
    jsonb_typeof(entrada_snapshot) = 'object' and jsonb_typeof(parametros_snapshot) = 'object'
  )
);

comment on table croqui_calculos is
  'Versão reproduzível do cálculo do croqui: entrada + parâmetros + resultado, imutáveis. Substitui o Apps Script sem log do escritório.';

-- Uma só versão atual por jornada.
create unique index if not exists uniq_croqui_calculo_atual
  on croqui_calculos (jornada_id) where atual;
create index if not exists idx_croqui_calculos_jornada
  on croqui_calculos (jornada_id, versao desc);
-- FK sem índice = JOIN e `on delete set null` varrendo a tabela inteira.
create index if not exists idx_croqui_calculos_croqui
  on croqui_calculos (croqui_id) where croqui_id is not null;

-- ---------------------------------------------------------------------------
-- Imutabilidade. `atual` só troca com o flag de sessão que a RPC liga — é o
-- mesmo mecanismo da 0061 para `diagnosticos_sv`, e existe porque duas linhas
-- `atual` (ou uma jornada sem nenhuma) quebram silenciosamente toda tela que
-- lê "o croqui atual".
-- ---------------------------------------------------------------------------
create or replace function app.croqui_calculo_imutavel() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.jornada_id          is distinct from old.jornada_id
  or new.versao              is distinct from old.versao
  or new.motor_versao        is distinct from old.motor_versao
  or new.entrada_snapshot    is distinct from old.entrada_snapshot
  or new.parametros_snapshot is distinct from old.parametros_snapshot
  or new.resultado           is distinct from old.resultado
  or new.criado_em           is distinct from old.criado_em
  or new.criado_por          is distinct from old.criado_por then
    raise exception 'calculo_imutavel: o snapshot de um cálculo não muda — calcule de novo e grave outra versão'
      using errcode = '23514';
  end if;

  if new.atual is distinct from old.atual
     and coalesce(current_setting('app.croqui_troca_versao', true), '') <> 'on' then
    raise exception 'calculo_atual_imutavel: use registrar_croqui_calculo ou fixar_croqui_calculo'
      using errcode = '23514';
  end if;

  return new;
end $$;

drop trigger if exists trg_croqui_calculo_imutavel on croqui_calculos;
create trigger trg_croqui_calculo_imutavel before update on croqui_calculos
for each row execute function app.croqui_calculo_imutavel();

create or replace function app.timeline_croqui_calculo() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  perform app.registrar_evento_timeline(
    new.jornada_id, 'croqui', 'Croqui calculado (v' || new.versao || ')', null,
    jsonb_build_object('calculo_id', new.id, 'versao', new.versao,
                       'motor_versao', new.motor_versao, 'croqui_id', new.croqui_id));
  return new;
end $$;

drop trigger if exists trg_timeline_croqui_calculo on croqui_calculos;
create trigger trg_timeline_croqui_calculo after insert on croqui_calculos
for each row execute function app.timeline_croqui_calculo();

-- ---------------------------------------------------------------------------
-- RLS — o snapshot É o patrimônio do cliente.
-- ---------------------------------------------------------------------------
alter table croqui_calculos enable row level security;
alter table croqui_calculos force row level security;

drop policy if exists cc_sel on croqui_calculos;
create policy cc_sel on croqui_calculos for select to authenticated
  using ((select app.ve_patrimonio()));
-- UPDATE existe só para a `nota` (o trigger barra o resto).
drop policy if exists cc_upd on croqui_calculos;
create policy cc_upd on croqui_calculos for update to authenticated
  using ((select app.ve_patrimonio())) with check ((select app.ve_patrimonio()));
-- Sem policy de INSERT: versão nova entra SÓ por `registrar_croqui_calculo`,
-- que troca o `atual` na mesma transação. Sem DELETE: histórico fica.

revoke all on croqui_calculos from public, anon;
grant select, update on croqui_calculos to authenticated;
grant select, insert, update, delete on croqui_calculos to service_role;

-- ---------------------------------------------------------------------------
-- vw_croqui_calculo_atual — o que 90% das telas pedem, sem `order by/limit 1`
-- repetido em cada consumidor.
-- ---------------------------------------------------------------------------
drop view if exists vw_croqui_calculo_atual;
create view vw_croqui_calculo_atual
with (security_invoker = true) as
select id, jornada_id, croqui_id, versao, motor_versao,
       entrada_snapshot, parametros_snapshot, resultado, nota, criado_em, criado_por
  from croqui_calculos
 where atual;

revoke all on vw_croqui_calculo_atual from public, anon;
grant select on vw_croqui_calculo_atual to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- registrar_croqui_calculo — versão nova + troca do `atual` na MESMA
-- transação. `security definer` só para atravessar a ausência de policy de
-- INSERT; o gate de papel é EXPLÍCITO e vem primeiro.
--
-- `app.ve_patrimonio()` já devolve `false` (nunca NULL) para autenticado sem
-- perfil desde a 0061 — antes disso, `if not app.ve_patrimonio()` não entrava
-- no `then` e um intruso gravava linha. O `coalesce` abaixo é cinto e
-- suspensório: se alguém reescrever a função um dia, esta RPC continua fechada.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_croqui_calculo(
  p_jornada_id  uuid,
  p_croqui_id   uuid,
  p_motor_versao text,
  p_entrada     jsonb,
  p_parametros  jsonb,
  p_resultado   jsonb,
  p_nota        text default null
) returns croqui_calculos
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_versao smallint;
  v_linha  croqui_calculos;
  v_perfil uuid;
begin
  if not coalesce(app.ve_patrimonio(), false) then
    raise exception 'sem_permissao: só admin/advogada calcula o croqui' using errcode = '42501';
  end if;
  if not exists (select 1 from jornadas where id = p_jornada_id) then
    raise exception 'jornada_nao_encontrada: %', p_jornada_id using errcode = 'P0002';
  end if;
  if p_croqui_id is not null and not exists (
       select 1 from croquis c where c.id = p_croqui_id and c.jornada_id = p_jornada_id) then
    raise exception 'croqui_de_outra_jornada: %', p_croqui_id using errcode = '23514';
  end if;
  if p_motor_versao is null or p_motor_versao !~ '^motor-croqui@[0-9]+$' then
    raise exception 'motor_versao_invalida: %', p_motor_versao using errcode = '23514';
  end if;
  if not app.resultado_croqui_valido(p_resultado) then
    raise exception 'resultado_invalido: o resultado precisa ter `tabelas` como objeto' using errcode = '23514';
  end if;
  if jsonb_typeof(p_entrada) <> 'object' or jsonb_typeof(p_parametros) <> 'object' then
    raise exception 'snapshot_invalido: entrada e parâmetros precisam ser objetos' using errcode = '23514';
  end if;

  select id into v_perfil from perfis_equipe where auth_user_id = auth.uid() and ativo limit 1;

  perform set_config('app.croqui_troca_versao', 'on', true);   -- só nesta transação
  update croqui_calculos set atual = false where jornada_id = p_jornada_id and atual;

  select coalesce(max(versao), 0) + 1 into v_versao from croqui_calculos where jornada_id = p_jornada_id;

  insert into croqui_calculos (
    jornada_id, croqui_id, versao, motor_versao,
    entrada_snapshot, parametros_snapshot, resultado, atual, nota, criado_por)
  values (
    p_jornada_id, p_croqui_id, v_versao, p_motor_versao,
    p_entrada, p_parametros, p_resultado, true, nullif(btrim(coalesce(p_nota, '')), ''), v_perfil)
  returning * into v_linha;

  perform set_config('app.croqui_troca_versao', 'off', true);
  return v_linha;
end $$;

revoke execute on function public.registrar_croqui_calculo(uuid, uuid, text, jsonb, jsonb, jsonb, text) from public, anon;
grant  execute on function public.registrar_croqui_calculo(uuid, uuid, text, jsonb, jsonb, jsonb, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- fixar_croqui_calculo — volta para uma versão anterior sem apagar nada.
-- Mesmo molde de `ativar_parametro_metodo` (0056): desativa a corrente e ativa
-- a escolhida na mesma transação, porque a unique parcial proíbe duas atuais e
-- dois `.update()` do supabase-js deixariam uma janela sem nenhuma.
-- ---------------------------------------------------------------------------
create or replace function public.fixar_croqui_calculo(p_id uuid) returns croqui_calculos
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_alvo  croqui_calculos;
  v_linha croqui_calculos;
begin
  if not coalesce(app.ve_patrimonio(), false) then
    raise exception 'sem_permissao: só admin/advogada fixa a versão do croqui' using errcode = '42501';
  end if;

  select * into v_alvo from croqui_calculos where id = p_id;
  if v_alvo.id is null then
    raise exception 'calculo_nao_encontrado: %', p_id using errcode = 'P0002';
  end if;

  perform set_config('app.croqui_troca_versao', 'on', true);
  update croqui_calculos set atual = false
   where jornada_id = v_alvo.jornada_id and atual and id <> p_id;
  update croqui_calculos set atual = true where id = p_id returning * into v_linha;
  perform set_config('app.croqui_troca_versao', 'off', true);

  return v_linha;
end $$;

revoke execute on function public.fixar_croqui_calculo(uuid) from public, anon;
grant  execute on function public.fixar_croqui_calculo(uuid) to authenticated, service_role;
