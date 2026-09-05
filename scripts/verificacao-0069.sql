-- scripts/verificacao-0069.sql — roteiro da 0069 (correção do pentest da Fase 5).
-- ---------------------------------------------------------------------------
-- COMO RODAR: uma chamada só (MCP execute_sql / SQL Editor / psql -f) como
-- postgres, com a 0069 APLICADA. Cada passo é um sub-bloco que termina em
-- `raise exception 'rollback_proposital'` — NENHUMA escrita sobrevive, nem
-- cálculo, nem documento, nem pessoa de fixture. Papéis simulados com
-- set_config('request.jwt.claims') + set local role authenticated (desfeito no
-- rollback). A última instrução devolve `resultado_0069` (ordem, passo, ok,
-- detalhe). ok = true significa que o banco BLOQUEOU o que devia e LIBEROU o
-- que devia. Idempotente.
--
-- Molde: scripts/verificacao-0063-0068.sql (C1).
--
-- FIXTURES ÚNICAS: e-mail e telefone carregam um sufixo de `gen_random_uuid()`
-- porque `pessoas` tem unique em ambos e um roteiro que colide com resíduo de
-- outra rodada mente dizendo "o banco recusou". Papel é sempre convertido com
-- `p_papel::papel_equipe` — comparar enum com text solto quebra em runtime.
--
-- O QUE NÃO DÁ PARA VERIFICAR AQUI: que a ROTA usa `criarClienteAdmin()` e
-- responde 503 sem `SUPABASE_SERVICE_ROLE_KEY`. Isso é curl contra o Next
-- (`POST /api/jornadas/<id>/croqui-calculo` com sessão admin real → 503
-- `servico_indisponivel` no ambiente local, que não tem a chave). O que o SQL
-- prova é o outro lado da mesma trava: `authenticated` leva 42501 na RPC.
-- ---------------------------------------------------------------------------

drop table if exists resultado_0069;
create temp table resultado_0069 (
  ordem serial primary key, passo text not null, ok boolean not null, detalhe text
) on commit drop;

create or replace function pg_temp.r69(p_passo text, p_ok boolean, p_detalhe text) returns void
language sql as $$ insert into resultado_0069 (passo, ok, detalhe) values (p_passo, p_ok, left(p_detalhe, 900)) $$;

-- Fixture: duas pessoas com jornada aberta, cada uma com um bem e um familiar,
-- e um croqui em cada jornada. É o mínimo para provar (a) que o cálculo de A
-- não se repontua para o croqui de B e (b) que o documento de A não gruda no
-- bem de B.
create or replace function pg_temp.f69()
returns table (
  pessoa_a uuid, jornada_a uuid, bem_a uuid, familiar_a uuid, croqui_a uuid,
  pessoa_b uuid, jornada_b uuid, bem_b uuid, croqui_b uuid,
  perfil_admin uuid, perfil_relacionamento uuid
)
language plpgsql as $$
declare
  v_pa uuid; v_ja uuid; v_ba uuid; v_fa uuid; v_ca uuid;
  v_pb uuid; v_jb uuid; v_bb uuid; v_cb uuid;
  v_adm uuid; v_rel uuid;
  v_tag text := left(gen_random_uuid()::text, 8);
begin
  insert into pessoas (nome, email, telefone, cidade, uf, origem_dado)
  values ('Verificação 0069 A ' || v_tag, 'verif69a.' || v_tag || '@example.com',
          '+55000000' || lpad((random()*99999)::int::text, 5, '0'), 'São Paulo', 'SP', 'exemplo')
  returning id into v_pa;
  insert into jornadas (pessoa_id, origem, etapa, origem_dado)
  values (v_pa, 'outro', 'sessao_agendada', 'exemplo') returning id into v_ja;
  insert into patrimonio_itens (pessoa_id, registrado_na_jornada_id, tipo, descricao, valor_historico, valor_mercado)
  values (v_pa, v_ja, 'imovel', 'Imóvel de verificação A', 100000, 200000) returning id into v_ba;
  insert into familiares (pessoa_id, registrado_na_jornada_id, parentesco, nome)
  values (v_pa, v_ja, 'conjuge', 'Cônjuge de verificação A') returning id into v_fa;
  insert into croquis (jornada_id, origem_dado) values (v_ja, 'exemplo') returning id into v_ca;

  insert into pessoas (nome, email, telefone, cidade, uf, origem_dado)
  values ('Verificação 0069 B ' || v_tag, 'verif69b.' || v_tag || '@example.com',
          '+55000000' || lpad((random()*99999)::int::text, 5, '0'), 'Belo Horizonte', 'MG', 'exemplo')
  returning id into v_pb;
  insert into jornadas (pessoa_id, origem, etapa, origem_dado)
  values (v_pb, 'outro', 'sessao_agendada', 'exemplo') returning id into v_jb;
  insert into patrimonio_itens (pessoa_id, registrado_na_jornada_id, tipo, descricao, valor_historico, valor_mercado)
  values (v_pb, v_jb, 'imovel', 'Imóvel de verificação B', 300000, 400000) returning id into v_bb;
  insert into croquis (jornada_id, origem_dado) values (v_jb, 'exemplo') returning id into v_cb;

  select id into v_adm from perfis_equipe where papel = 'admin'::papel_equipe and ativo limit 1;
  select id into v_rel from perfis_equipe where papel = 'relacionamento'::papel_equipe and ativo limit 1;

  return query select v_pa, v_ja, v_ba, v_fa, v_ca, v_pb, v_jb, v_bb, v_cb, v_adm, v_rel;
end $$;

create or replace function pg_temp.como69(p_papel text) returns uuid
language plpgsql as $$
declare v_uid uuid;
begin
  select auth_user_id into v_uid from perfis_equipe
   where papel = p_papel::papel_equipe and ativo and auth_user_id is not null limit 1;
  if v_uid is null then
    select auth_user_id into v_uid from perfis_equipe where ativo and auth_user_id is not null limit 1;
    update perfis_equipe set papel = p_papel::papel_equipe where auth_user_id = v_uid;   -- só neste sub-bloco (rollback)
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  execute 'set local role authenticated';
  return v_uid;
end $$;

/** Um resultado mínimo que passa em `app.resultado_croqui_valido`. */
create or replace function pg_temp.res69() returns jsonb
language sql immutable as $$ select '{"motor_versao":"motor-croqui@1","tabelas":{}}'::jsonb $$;


-- ===========================================================================
-- 1. Uma assinatura só de cada RPC, com o parâmetro novo (armadilha 6).
--    `create or replace` com parâmetro novo criaria uma SEGUNDA sobrecarga e a
--    chamada por nome ficaria ambígua em runtime.
-- ===========================================================================
do $$
declare n_reg int; n_fix int; a_reg int; a_fix int; s_reg text; ok boolean := false; det text;
begin
  begin
    select count(*) into n_reg from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'registrar_croqui_calculo';
    select count(*) into n_fix from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'fixar_croqui_calculo';
    select p.pronargs, pg_get_function_identity_arguments(p.oid) into a_reg, s_reg
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'registrar_croqui_calculo' limit 1;
    select p.pronargs into a_fix from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'fixar_croqui_calculo' limit 1;

    ok := n_reg = 1 and n_fix = 1 and a_reg = 8 and a_fix = 2;
    det := format('registrar: %s função(ões), %s args (esp. 1 e 8) · fixar: %s função(ões), %s args (esp. 1 e 2) · args=%s',
                  n_reg, a_reg, n_fix, a_fix, s_reg);
    raise exception 'rollback_proposital';
  exception when others then if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if; end;
  perform pg_temp.r69('1 uma assinatura só de cada RPC, com p_criado_por (sem sobrecarga ambígua)', ok, det);
end $$;


-- ===========================================================================
-- 2. Privilégio: só `service_role`. É o MÉDIO fechado do lado do grant.
--    (`revoke all from public, anon, authenticated` ANTES do grant — sem isso
--    o `alter default privileges` do Supabase continua alcançando
--    `authenticated`, que é a lição inteira da 0065b.)
-- ===========================================================================
do $$
declare
  s_reg text := 'public.registrar_croqui_calculo(uuid,uuid,text,jsonb,jsonb,jsonb,text,uuid)';
  s_fix text := 'public.fixar_croqui_calculo(uuid,uuid)';
  auth_reg boolean; anon_reg boolean; srv_reg boolean;
  auth_fix boolean; anon_fix boolean; srv_fix boolean;
  acl_reg text; pub_reg boolean;
  ok boolean := false; det text;
begin
  begin
    auth_reg := has_function_privilege('authenticated', s_reg, 'execute');
    anon_reg := has_function_privilege('anon',          s_reg, 'execute');
    srv_reg  := has_function_privilege('service_role',  s_reg, 'execute');
    auth_fix := has_function_privilege('authenticated', s_fix, 'execute');
    anon_fix := has_function_privilege('anon',          s_fix, 'execute');
    srv_fix  := has_function_privilege('service_role',  s_fix, 'execute');
    select coalesce(p.proacl::text, '') into acl_reg
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'registrar_croqui_calculo' limit 1;
    pub_reg := acl_reg like '%=X/%';   -- entrada sem role nomeado = PUBLIC

    ok := srv_reg and srv_fix
      and not auth_reg and not anon_reg and not auth_fix and not anon_fix and not pub_reg;
    det := format('registrar → service_role=%s auth=%s anon=%s PUBLIC=%s · fixar → service_role=%s auth=%s anon=%s · acl=%s',
                  srv_reg, auth_reg, anon_reg, pub_reg, srv_fix, auth_fix, anon_fix, acl_reg);
    raise exception 'rollback_proposital';
  exception when others then if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if; end;
  perform pg_temp.r69('2 [MÉDIO] EXECUTE das duas RPCs de croqui: só service_role', ok, det);
end $$;


-- ===========================================================================
-- 3. [MÉDIO] Sessão `authenticated` (ADMIN de verdade, o caso que antes PASSAVA)
--    chamando a RPC com resultado forjado → 42501, e NADA gravado.
--    Antes da 0069 isto devolvia a linha nova com `atual = true`.
-- ===========================================================================
do $$
declare f record; e_adm text; e_rel text; n_linhas int; ok boolean := false; det text;
begin
  begin
    select * into f from pg_temp.f69();

    perform pg_temp.como69('admin');
    begin
      perform registrar_croqui_calculo(f.jornada_a, null, 'motor-croqui@1',
        '{"bens":"FORJADO"}'::jsonb, '{"itens":"FORJADO"}'::jsonb, pg_temp.res69(), 'forjado', f.perfil_admin);
      e_adm := 'PASSOU';
    exception when others then e_adm := sqlstate; end;
    execute 'reset role';

    perform pg_temp.como69('relacionamento');
    begin
      perform registrar_croqui_calculo(f.jornada_a, null, 'motor-croqui@1',
        '{}'::jsonb, '{}'::jsonb, pg_temp.res69(), null, f.perfil_admin);
      e_rel := 'PASSOU';
    exception when others then e_rel := sqlstate; end;
    execute 'reset role';

    select count(*) into n_linhas from croqui_calculos where jornada_id = f.jornada_a;

    ok := e_adm = '42501' and e_rel = '42501' and n_linhas = 0;
    det := format('admin autenticado→%s (esp. 42501, ANTES da 0069 era PASSOU) · relacionamento→%s (esp. 42501) · linhas=%s (esp. 0)',
                  e_adm, e_rel, n_linhas);
    raise exception 'rollback_proposital';
  exception when others then if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if; end;
  perform pg_temp.r69('3 [MÉDIO] authenticated (mesmo admin) leva 42501 na RPC e nada grava', ok, det);
end $$;


-- ===========================================================================
-- 4. `p_criado_por` é o gate novo: nulo, inativo ou de papel errado não grava;
--    admin ativo grava e o `criado_por` é EXATAMENTE o perfil informado.
--    (Rodando como postgres, que é o papel efetivo de `service_role` para
--    efeito desta RPC `security definer`.)
-- ===========================================================================
do $$
declare
  f record; v_rel uuid; v_inativo uuid;
  e_nulo text; e_rel text; e_inativo text; v_linha croqui_calculos;
  n_linhas int; ok boolean := false; det text;
begin
  begin
    select * into f from pg_temp.f69();

    begin
      perform registrar_croqui_calculo(f.jornada_a, null, 'motor-croqui@1',
        '{}'::jsonb, '{}'::jsonb, pg_temp.res69(), null, null);
      e_nulo := 'PASSOU';
    exception when others then e_nulo := sqlstate; end;

    begin
      perform registrar_croqui_calculo(f.jornada_a, null, 'motor-croqui@1',
        '{}'::jsonb, '{}'::jsonb, pg_temp.res69(), null, f.perfil_relacionamento);
      e_rel := 'PASSOU';
    exception when others then e_rel := sqlstate; end;

    -- Mesmo perfil admin, desativado: o gate é "ativo E papel", não só papel.
    update perfis_equipe set ativo = false where id = f.perfil_admin;
    begin
      perform registrar_croqui_calculo(f.jornada_a, null, 'motor-croqui@1',
        '{}'::jsonb, '{}'::jsonb, pg_temp.res69(), null, f.perfil_admin);
      e_inativo := 'PASSOU';
    exception when others then e_inativo := sqlstate; end;
    update perfis_equipe set ativo = true where id = f.perfil_admin;

    v_linha := registrar_croqui_calculo(f.jornada_a, f.croqui_a, 'motor-croqui@1',
      '{}'::jsonb, '{}'::jsonb, pg_temp.res69(), 'ok', f.perfil_admin);
    select count(*) into n_linhas from croqui_calculos where jornada_id = f.jornada_a;

    ok := e_nulo = '22004'
      and e_rel = '42501'
      and coalesce(e_inativo, '') = '42501'
      and v_linha.criado_por = f.perfil_admin
      and v_linha.atual
      and n_linhas = 1;
    det := format('p_criado_por nulo→%s (esp. 22004) · relacionamento→%s (esp. 42501) · admin INATIVO→%s (esp. 42501) · admin ativo→criado_por=%s atual=%s · linhas=%s (esp. 1)',
                  e_nulo, e_rel, e_inativo, v_linha.criado_por = f.perfil_admin, v_linha.atual, n_linhas);
    raise exception 'rollback_proposital';
  exception when others then if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if; end;
  perform pg_temp.r69('4 p_criado_por: nulo 22004, papel errado/inativo 42501, admin ativo grava com o autor certo', ok, det);
end $$;


-- ===========================================================================
-- 5. [BAIXO] `croqui_id` é imutável — o achado do pentest: `update
--    croqui_calculos set croqui_id = <croqui de OUTRA jornada>` PASSAVA e
--    repontuava o cálculo. Agora 23514. `nota` continua editável (é a única
--    razão de a policy `cc_upd` existir).
-- ===========================================================================
do $$
declare
  f record; v_linha croqui_calculos;
  e_croqui text; e_resultado text; e_atual text; e_nota text; v_nota text;
  ok boolean := false; det text;
begin
  begin
    select * into f from pg_temp.f69();
    v_linha := registrar_croqui_calculo(f.jornada_a, f.croqui_a, 'motor-croqui@1',
      '{}'::jsonb, '{}'::jsonb, pg_temp.res69(), null, f.perfil_admin);

    begin
      update croqui_calculos set croqui_id = f.croqui_b where id = v_linha.id;
      e_croqui := 'PASSOU';
    exception when others then e_croqui := sqlstate; end;

    begin
      update croqui_calculos set resultado = '{"tabelas":{"forjado":1}}'::jsonb where id = v_linha.id;
      e_resultado := 'PASSOU';
    exception when others then e_resultado := sqlstate; end;

    begin
      update croqui_calculos set atual = false where id = v_linha.id;
      e_atual := 'PASSOU';
    exception when others then e_atual := sqlstate; end;

    begin
      update croqui_calculos set nota = 'nota nova' where id = v_linha.id;
      select nota into v_nota from croqui_calculos where id = v_linha.id;
      e_nota := 'PASSOU';
    exception when others then e_nota := sqlstate; end;

    ok := e_croqui = '23514' and e_resultado = '23514' and e_atual = '23514'
      and e_nota = 'PASSOU' and v_nota = 'nota nova';
    det := format('croqui_id→%s (esp. 23514, ANTES era PASSOU) · resultado→%s · atual→%s · nota→%s (esp. PASSOU, valor=%s)',
                  e_croqui, e_resultado, e_atual, e_nota, v_nota);
    raise exception 'rollback_proposital';
  exception when others then if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if; end;
  perform pg_temp.r69('5 [BAIXO] croqui_id imutável (23514); nota continua editável', ok, det);
end $$;


-- ===========================================================================
-- 6. [BAIXO] Grant de COLUNA: `authenticated` só atualiza `nota`. Trigger é a
--    trava do VALOR; privilégio é a trava da SUPERFÍCIE — com o grant de
--    coluna, um PATCH em `resultado` morre em 42501 antes de abrir transação.
--    (A 0065b existe porque `grant` sem `revoke` anterior não restringe nada.)
-- ===========================================================================
do $$
declare
  p_nota boolean; p_croqui boolean; p_res boolean; p_atual boolean; p_jornada boolean;
  p_sel boolean; p_ins boolean; p_del boolean;
  ok boolean := false; det text;
begin
  begin
    p_nota    := has_column_privilege('authenticated', 'croqui_calculos', 'nota', 'update');
    p_croqui  := has_column_privilege('authenticated', 'croqui_calculos', 'croqui_id', 'update');
    p_res     := has_column_privilege('authenticated', 'croqui_calculos', 'resultado', 'update');
    p_atual   := has_column_privilege('authenticated', 'croqui_calculos', 'atual', 'update');
    p_jornada := has_column_privilege('authenticated', 'croqui_calculos', 'jornada_id', 'update');
    p_sel     := has_table_privilege('authenticated', 'croqui_calculos', 'select');
    p_ins     := has_table_privilege('authenticated', 'croqui_calculos', 'insert');
    p_del     := has_table_privilege('authenticated', 'croqui_calculos', 'delete');

    ok := p_nota and not p_croqui and not p_res and not p_atual and not p_jornada
      and p_sel and not p_ins and not p_del;
    det := format('update: nota=%s (esp. t) croqui_id=%s resultado=%s atual=%s jornada_id=%s (esp. f) · select=%s (esp. t) insert=%s delete=%s (esp. f)',
                  p_nota, p_croqui, p_res, p_atual, p_jornada, p_sel, p_ins, p_del);
    raise exception 'rollback_proposital';
  exception when others then if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if; end;
  perform pg_temp.r69('6 [BAIXO] croqui_calculos: authenticated só tem UPDATE(nota)', ok, det);
end $$;


-- ===========================================================================
-- 7. [BAIXO] `documentos.item_ref` — a MESMA regra para os dois escritores.
--    Estes INSERTs são o caminho INTERNO (service_role / postgres), que antes
--    validava só o formato uuid: item de outra pessoa PASSAVA. Agora o trigger
--    grava NULL + warning, sem derrubar o upload (fail-safe idêntico ao da 0068).
-- ===========================================================================
do $$
declare
  f record;
  v_outra uuid; v_propria uuid; v_familiar uuid; v_texto uuid; v_inventado uuid; v_nulo uuid;
  r_outra text; r_propria text; r_familiar text; r_texto text; r_inventado text; r_nulo text;
  r_update text; n_docs int;
  ok boolean := false; det text;
begin
  begin
    select * into f from pg_temp.f69();

    -- (a) item de OUTRA pessoa → NULL
    insert into documentos (pessoa_id, jornada_id, tipo, item_ref, nome_arquivo, caminho, mime, tamanho_bytes, sha256, origem)
    values (f.pessoa_a, f.jornada_a, 'matricula_imovel', f.bem_b::text, 'a.pdf',
            'pessoas/verif69/a.pdf', 'application/pdf', 10, encode(sha256(gen_random_uuid()::text::bytea), 'hex'), 'cliente')
    returning id into v_outra;
    select item_ref into r_outra from documentos where id = v_outra;

    -- (b) bem da PRÓPRIA pessoa → grava
    insert into documentos (pessoa_id, jornada_id, tipo, item_ref, nome_arquivo, caminho, mime, tamanho_bytes, sha256, origem)
    values (f.pessoa_a, f.jornada_a, 'matricula_imovel', f.bem_a::text, 'b.pdf',
            'pessoas/verif69/b.pdf', 'application/pdf', 10, encode(sha256(gen_random_uuid()::text::bytea), 'hex'), 'cliente')
    returning id into v_propria;
    select item_ref into r_propria from documentos where id = v_propria;

    -- (c) FAMILIAR da própria pessoa → grava (a regra cobre as duas tabelas)
    insert into documentos (pessoa_id, jornada_id, tipo, item_ref, nome_arquivo, caminho, mime, tamanho_bytes, sha256, origem)
    values (f.pessoa_a, f.jornada_a, 'certidao_casamento', f.familiar_a::text, 'c.pdf',
            'pessoas/verif69/c.pdf', 'application/pdf', 10, encode(sha256(gen_random_uuid()::text::bytea), 'hex'), 'cliente')
    returning id into v_familiar;
    select item_ref into r_familiar from documentos where id = v_familiar;

    -- (d) texto que não é uuid → NULL, SEM 22P02 (o regex vem antes do cast)
    insert into documentos (pessoa_id, jornada_id, tipo, item_ref, nome_arquivo, caminho, mime, tamanho_bytes, sha256, origem)
    values (f.pessoa_a, f.jornada_a, 'outro', 'cofre', 'd.pdf',
            'pessoas/verif69/d.pdf', 'application/pdf', 10, encode(sha256(gen_random_uuid()::text::bytea), 'hex'), 'cliente')
    returning id into v_texto;
    select item_ref into r_texto from documentos where id = v_texto;

    -- (e) uuid inventado → NULL, sem oráculo de existência
    insert into documentos (pessoa_id, jornada_id, tipo, item_ref, nome_arquivo, caminho, mime, tamanho_bytes, sha256, origem)
    values (f.pessoa_a, f.jornada_a, 'outro', gen_random_uuid()::text, 'e.pdf',
            'pessoas/verif69/e.pdf', 'application/pdf', 10, encode(sha256(gen_random_uuid()::text::bytea), 'hex'), 'cliente')
    returning id into v_inventado;
    select item_ref into r_inventado from documentos where id = v_inventado;

    -- (f) regressão da 0028: sem item_ref continua gravando
    insert into documentos (pessoa_id, jornada_id, tipo, nome_arquivo, caminho, mime, tamanho_bytes, sha256, origem)
    values (f.pessoa_a, f.jornada_a, 'imposto_renda', 'f.pdf',
            'pessoas/verif69/f.pdf', 'application/pdf', 10, encode(sha256(gen_random_uuid()::text::bytea), 'hex'), 'cliente')
    returning id into v_nulo;
    select item_ref into r_nulo from documentos where id = v_nulo;

    -- (g) UPDATE trocando para item de outra pessoa → NULL (o achado valia para
    --     INSERT e UPDATE; o trigger cobre os dois)
    update documentos set item_ref = f.bem_b::text where id = v_propria;
    select item_ref into r_update from documentos where id = v_propria;

    select count(*) into n_docs from documentos where caminho like 'pessoas/verif69/%';

    ok := r_outra is null
      and r_propria = f.bem_a::text
      and r_familiar = f.familiar_a::text
      and r_texto is null
      and r_inventado is null
      and r_nulo is null
      and r_update is null
      and n_docs = 6;
    det := format('bem de OUTRA pessoa→%s (esp. NULL, ANTES era o uuid) · bem próprio→%s · familiar próprio→%s · ''cofre''→%s · uuid inventado→%s · sem item_ref→%s · UPDATE p/ outra pessoa→%s · documentos gravados=%s (esp. 6)',
                  coalesce(r_outra, 'NULL'), coalesce(r_propria, 'NULL'), coalesce(r_familiar, 'NULL'),
                  coalesce(r_texto, 'NULL'), coalesce(r_inventado, 'NULL'), coalesce(r_nulo, 'NULL'),
                  coalesce(r_update, 'NULL'), n_docs);
    raise exception 'rollback_proposital';
  exception when others then if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if; end;
  perform pg_temp.r69('7 [BAIXO] documentos.item_ref: upload INTERNO com item de outra pessoa grava NULL (não erro)', ok, det);
end $$;


-- ===========================================================================
-- 8. O trigger existe, é BEFORE INSERT OR UPDATE e a função é SECURITY DEFINER
--    com search_path fixo (0017/0047 — sem isso, `patrimonio_itens` pode ser
--    resolvido em outro schema por quem controlar o search_path da sessão).
-- ===========================================================================
do $$
declare
  v_tipo text; v_secdef boolean; v_config text[]; n_trig int;
  ok boolean := false; det text;
begin
  begin
    select count(*) into n_trig from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = 'documentos' and t.tgname = 'trg_documento_item_ref' and not t.tgisinternal;
    select p.prosecdef, p.proconfig into v_secdef, v_config
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname = 'documento_item_ref_valido' limit 1;
    select case when t.tgtype & 2 > 0 then 'BEFORE' else 'AFTER' end into v_tipo
      from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = 'documentos' and t.tgname = 'trg_documento_item_ref' limit 1;

    ok := n_trig = 1 and v_secdef and v_tipo = 'BEFORE'
      and array_to_string(coalesce(v_config, '{}'), ',') like '%search_path=public, pg_temp%';
    det := format('trigger=%s (esp. 1) · momento=%s (esp. BEFORE) · security definer=%s · proconfig=%s',
                  n_trig, v_tipo, v_secdef, array_to_string(coalesce(v_config, '{}'), ','));
    raise exception 'rollback_proposital';
  exception when others then if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if; end;
  perform pg_temp.r69('8 trg_documento_item_ref: BEFORE, security definer, search_path fixo', ok, det);
end $$;


-- ===========================================================================
-- 9. `app.perfil_ve_patrimonio` não é alcançável de fora: nem `authenticated`,
--    nem `anon`, nem PUBLIC. Ela só é chamada de dentro das duas RPCs
--    `security definer`, que rodam como o dono.
-- ===========================================================================
do $$
declare
  s text := 'app.perfil_ve_patrimonio(uuid)';
  p_auth boolean; p_anon boolean; v_acl text; p_pub boolean;
  ok boolean := false; det text;
begin
  begin
    p_auth := has_function_privilege('authenticated', s, 'execute');
    p_anon := has_function_privilege('anon', s, 'execute');
    select coalesce(p.proacl::text, '') into v_acl
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname = 'perfil_ve_patrimonio' limit 1;
    p_pub := v_acl like '%=X/%';

    ok := not p_auth and not p_anon and not p_pub;
    det := format('authenticated=%s anon=%s PUBLIC=%s (todos esp. f) · acl=%s', p_auth, p_anon, p_pub, v_acl);
    raise exception 'rollback_proposital';
  exception when others then if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if; end;
  perform pg_temp.r69('9 app.perfil_ve_patrimonio inalcançável de fora (só de dentro das RPCs definer)', ok, det);
end $$;


-- ===========================================================================
-- 10. Nada sobreviveu: nenhuma pessoa, cálculo ou documento de fixture, e
--     nenhum perfil ficou desativado pelo passo 4.
--     (Cada passo rolou de volta; este passo é a prova, não a limpeza.)
-- ===========================================================================
do $$
declare n_pessoa int; n_calc int; n_doc int; n_inativo int; ok boolean := false; det text;
begin
  select count(*) into n_pessoa from pessoas where nome like 'Verificação 0069 %';
  select count(*) into n_calc from croqui_calculos c
    join jornadas j on j.id = c.jornada_id
    join pessoas p on p.id = j.pessoa_id
   where p.nome like 'Verificação 0069 %';
  select count(*) into n_doc from documentos where caminho like 'pessoas/verif69/%';
  select count(*) into n_inativo from perfis_equipe where papel = 'admin'::papel_equipe and not ativo;
  ok := n_pessoa = 0 and n_calc = 0 and n_doc = 0;
  det := format('pessoas de fixture=%s · cálculos=%s · documentos=%s (esp. 0) · admins inativos=%s (conferir contra a linha de base)',
                n_pessoa, n_calc, n_doc, n_inativo);
  perform pg_temp.r69('10 nenhuma escrita sobreviveu ao roteiro', ok, det);
end $$;

select ordem, passo, ok, detalhe from resultado_0069 order by ordem;
