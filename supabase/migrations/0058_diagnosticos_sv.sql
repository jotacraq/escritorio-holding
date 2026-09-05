-- 0058_diagnosticos_sv.sql — Fase 4, F4 (agente D). NÃO APLICADA. Depende da 0057.
--
-- Diagnóstico da Sessão de Viabilidade como peça apresentável — a peça
-- ANTERIOR ao Croqui. Deriva de dados que já existem (familiares, patrimônio,
-- relatório da SV, análise do Agente do Croqui quando houver, grade do
-- Cenário Patrimonial) por FUNÇÃO PURA no servidor (`montarDiagnostico`,
-- src/server/diagnostico/montar.ts). ZERO chamada de IA.
--
-- B31 no banco: cada bloco carrega `visivel_ao_cliente` e nasce `false`; o
-- bloco `o_que_falta` NUNCA pode ficar visível (é lista interna de lacunas).
-- A função `app.blocos_diagnostico_validos` é o CHECK — vale também para
-- quem escrever via PostgREST direto (armadilha 4).
--
-- Versionado como `croqui_analises`/`materiais_gerados`: montar de novo cria
-- versão nova (`registrar_diagnostico_sv`, atômica no `atual`); a advogada
-- EDITA a versão atual (texto, pontos, visibilidade) por UPDATE — o histórico
-- de versões anteriores fica intocado.
--
-- ROTEIRO DE VERIFICAÇÃO (service_role; jornada de teste :j):
--   1. select public.registrar_diagnostico_sv(:j, null,
--        '[{"chave":"situacao_familiar","titulo":"t","conteudo":"c","pontos":[],"fontes":[],"categoria":"fato_declarado","visivel_ao_cliente":false}]'::jsonb);
--      → linha com versao 1, atual true. Repetir → versao 2 atual true, versao 1 atual false.
--   2. update diagnosticos_sv set blocos = '[{"chave":"o_que_falta","titulo":"t","conteudo":"c","pontos":[],"fontes":[],"categoria":"inferencia","visivel_ao_cliente":true}]'
--        where jornada_id = :j and atual;
--      → ERRO 23514 (ck_blocos_validos: `o_que_falta` visível ao cliente).
--   3. update ... blocos = '[{"chave":"x"}]' → ERRO 23514 (bloco sem os campos obrigatórios).
--   4. select count(*) filter (where (b->>'visivel_ao_cliente')::boolean) from diagnosticos_sv d, jsonb_array_elements(d.blocos) b
--        where d.jornada_id = :j and d.atual; → 0 (default tudo oculto).
--   5. Como `relacionamento`: select count(*) from diagnosticos_sv → 0 linhas; registrar_diagnostico_sv → 42501.
--   6. select tipo, titulo from eventos_timeline where jornada_id = :j and tipo = 'diagnostico' order by ocorrido_em desc limit 1;
--      → 'Diagnóstico da SV montado (v2)'.
--   7. Limpar: delete from diagnosticos_sv where jornada_id = :j (service_role).
--   8. Reverter: drop function public.registrar_diagnostico_sv(uuid, uuid, jsonb);
--      drop table diagnosticos_sv; drop function app.blocos_diagnostico_validos(jsonb).

-- Validação estrutural dos blocos. IMMUTABLE para poder viver num CHECK.
create or replace function app.blocos_diagnostico_validos(p_blocos jsonb) returns boolean
language sql immutable
set search_path = public, pg_temp
as $$
  select jsonb_typeof(p_blocos) = 'array'
     and not exists (
       select 1 from jsonb_array_elements(p_blocos) b
        where jsonb_typeof(b) <> 'object'
           or not (b ? 'chave' and b ? 'titulo' and b ? 'conteudo' and b ? 'pontos'
                   and b ? 'fontes' and b ? 'categoria' and b ? 'visivel_ao_cliente')
           or jsonb_typeof(b->'chave') <> 'string'
           or jsonb_typeof(b->'titulo') <> 'string'
           or jsonb_typeof(b->'conteudo') <> 'string'
           or jsonb_typeof(b->'pontos') <> 'array'
           or jsonb_typeof(b->'fontes') <> 'array'
           or jsonb_typeof(b->'visivel_ao_cliente') <> 'boolean'
           or (b->>'categoria') not in ('fato_declarado','dado_documental','inferencia','ponto_a_validar')
           or (b->>'chave') !~ '^[a-z][a-z0-9_]{1,63}$'
           -- B31: lacunas internas nunca vão para o cliente.
           or ((b->>'chave') = 'o_que_falta' and (b->>'visivel_ao_cliente')::boolean)
     )
     -- chave única dentro da peça
     and (select count(*) = count(distinct b->>'chave') from jsonb_array_elements(p_blocos) b)
$$;
-- CHECK avalia com o privilégio de quem faz o DML, e o schema `app` revoga
-- EXECUTE de public por padrão (0024) — sem este grant, todo UPDATE de
-- `authenticated` em `diagnosticos_sv` cairia em "permission denied for
-- function" (armadilha 2 do CONTINUAR-AQUI).
revoke execute on function app.blocos_diagnostico_validos(jsonb) from public, anon;
grant  execute on function app.blocos_diagnostico_validos(jsonb) to authenticated, service_role;

create table diagnosticos_sv (
  id            uuid primary key default gen_random_uuid(),
  jornada_id    uuid not null references jornadas(id) on delete cascade,
  versao        smallint not null,
  analise_id    uuid references croqui_analises(id),      -- de onde vieram riscos/arquitetura (se houver)
  -- [{chave, titulo, conteudo, pontos[], fontes[], categoria, visivel_ao_cliente}]
  -- mesmo vocabulário de `SlideAnalise` (schema-analise-v2.ts) + o toggle B31.
  blocos        jsonb not null,
  atual         boolean not null default true,
  aprovado_por  uuid references perfis_equipe(id),
  aprovado_em   timestamptz,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  criado_por    uuid references perfis_equipe(id),
  atualizado_por uuid references perfis_equipe(id),
  unique (jornada_id, versao),
  constraint ck_blocos_validos check (app.blocos_diagnostico_validos(blocos)),
  constraint ck_diag_aprov check ((aprovado_em is null) = (aprovado_por is null))
);
create unique index uniq_diagnostico_atual on diagnosticos_sv (jornada_id) where atual;
create index idx_diagnosticos_jornada on diagnosticos_sv (jornada_id, versao desc);

create trigger trg_diagnosticos_atualizado_em before update on diagnosticos_sv
for each row execute function app.set_atualizado_em();

-- Versão anterior é histórico: só `atual` pode virar false nela; nada mais muda.
create or replace function app.diagnostico_so_atual_edita() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if not old.atual and (new.blocos is distinct from old.blocos
                        or new.aprovado_em is distinct from old.aprovado_em
                        or new.aprovado_por is distinct from old.aprovado_por) then
    raise exception 'diagnostico_versao_antiga: só a versão atual do diagnóstico é editável'
      using errcode = '23514';
  end if;
  if new.versao is distinct from old.versao or new.jornada_id is distinct from old.jornada_id
     or new.criado_em is distinct from old.criado_em then
    raise exception 'diagnostico_imutavel: versão/jornada/criação não mudam' using errcode = '23514';
  end if;
  new.atualizado_por := coalesce(
    (select id from perfis_equipe where auth_user_id = auth.uid() and ativo limit 1),
    new.atualizado_por);
  return new;
end $$;
create trigger trg_diagnostico_so_atual_edita before update on diagnosticos_sv
for each row execute function app.diagnostico_so_atual_edita();

create or replace function app.timeline_diagnostico() returns trigger
language plpgsql as $$
begin
  if TG_OP = 'INSERT' then
    perform app.registrar_evento_timeline(new.jornada_id, 'diagnostico',
      'Diagnóstico da SV montado (v' || new.versao || ')', null,
      jsonb_build_object('diagnostico_id', new.id, 'versao', new.versao, 'analise_id', new.analise_id));
  elsif new.aprovado_em is not null and old.aprovado_em is null then
    perform app.registrar_evento_timeline(new.jornada_id, 'diagnostico',
      'Diagnóstico da SV aprovado (v' || new.versao || ')', null,
      jsonb_build_object('diagnostico_id', new.id, 'versao', new.versao));
  end if;
  return new;
end $$;
create trigger trg_timeline_diagnostico after insert or update on diagnosticos_sv
for each row execute function app.timeline_diagnostico();

alter table diagnosticos_sv enable row level security;
alter table diagnosticos_sv force row level security;

-- Contém patrimônio e riscos do cliente: recorte de `ve_patrimonio`.
-- `relacionamento` NÃO lê (B31 + sigilo) — a Pasta do Cliente só recebe
-- "existe/não existe" pelo payload da Ficha (agente A).
create policy dg_sel on diagnosticos_sv for select to authenticated using ((select app.ve_patrimonio()));
create policy dg_upd on diagnosticos_sv for update to authenticated
  using ((select app.ve_patrimonio())) with check ((select app.ve_patrimonio()));
-- Sem policy de INSERT direto: versão nova entra por `registrar_diagnostico_sv`
-- (abaixo), que troca o `atual` na mesma transação. Sem DELETE: histórico fica.

revoke all on diagnosticos_sv from public, anon;
grant select, update on diagnosticos_sv to authenticated;
grant select, insert, update, delete on diagnosticos_sv to service_role;

-- ===========================================================================
-- registrar_diagnostico_sv — mesma forma de `registrar_croqui_analise` (0010),
-- mas `security definer` só para atravessar a ausência de policy de INSERT;
-- o gate de papel é explícito (ve_patrimonio), e a jornada precisa existir
-- para quem chama (RLS de `jornadas`).
-- ===========================================================================
create or replace function public.registrar_diagnostico_sv(
  p_jornada_id uuid, p_analise_id uuid, p_blocos jsonb
) returns diagnosticos_sv
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_versao smallint;
  v_linha diagnosticos_sv;
  v_perfil_id uuid;
begin
  if not app.ve_patrimonio() then
    raise exception 'sem_permissao: só admin/advogada monta o diagnóstico' using errcode = '42501';
  end if;
  if not exists (select 1 from jornadas where id = p_jornada_id) then
    raise exception 'jornada_nao_encontrada: %', p_jornada_id using errcode = 'P0002';
  end if;
  if p_analise_id is not null and not exists (
       select 1 from croqui_analises a join croquis c on c.id = a.croqui_id
        where a.id = p_analise_id and c.jornada_id = p_jornada_id) then
    raise exception 'analise_de_outra_jornada: %', p_analise_id using errcode = '23514';
  end if;
  if not app.blocos_diagnostico_validos(p_blocos) then
    raise exception 'blocos_invalidos: forma dos blocos do diagnóstico inválida' using errcode = '23514';
  end if;

  select id into v_perfil_id from perfis_equipe where auth_user_id = auth.uid() and ativo limit 1;

  update diagnosticos_sv set atual = false where jornada_id = p_jornada_id and atual;
  select coalesce(max(versao), 0) + 1 into v_versao from diagnosticos_sv where jornada_id = p_jornada_id;

  insert into diagnosticos_sv (jornada_id, versao, analise_id, blocos, atual, criado_por, atualizado_por)
  values (p_jornada_id, v_versao, p_analise_id, p_blocos, true, v_perfil_id, v_perfil_id)
  returning * into v_linha;

  return v_linha;
end $$;
revoke execute on function public.registrar_diagnostico_sv(uuid, uuid, jsonb) from public, anon;
grant  execute on function public.registrar_diagnostico_sv(uuid, uuid, jsonb) to authenticated, service_role;
