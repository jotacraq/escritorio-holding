-- scripts/verificacao-0063-0068.sql — roteiro da costura C1 da Fase 5.
-- Cobre a 0063 (`registrar_croqui_calculo`) e a 0068 (`registrar_documento_publico`
-- com `p_item_ref` validado).
-- ---------------------------------------------------------------------------
-- COMO RODAR: uma chamada só (MCP execute_sql / SQL Editor / psql -f) como
-- postgres, com 0063 e 0068 APLICADAS. Cada passo é um sub-bloco que termina em
-- `raise exception 'rollback_proposital'` — NENHUMA escrita sobrevive, nem
-- documento, nem link, nem pessoa de fixture. Papéis simulados com
-- set_config('request.jwt.claims') + set local role authenticated (desfeito no
-- rollback). A última instrução devolve resultado_c1 (ordem, passo, ok,
-- detalhe). ok = true significa que o banco BLOQUEOU o que devia e LIBEROU o
-- que devia. Idempotente.
--
-- Molde: scripts/verificacao-0064-0067.sql (M2).
--
-- O QUE NÃO DÁ PARA VERIFICAR AQUI: a lista de documentos pedidos deixou de
-- morar no banco — ela é derivada em `src/lib/radar/derivar.ts` e servida por
-- `GET /api/publico/[token]`. O passo 7 confere o que resta do lado SQL: o
-- fallback (`app.payload_link_documentos`) continua devolvendo os 3 tipos
-- fixos, intacto, para quando o servidor não conseguir derivar o radar.
-- ---------------------------------------------------------------------------

drop table if exists resultado_c1;
create temp table resultado_c1 (
  ordem serial primary key, passo text not null, ok boolean not null, detalhe text
) on commit drop;

create or replace function pg_temp.c1_reg(p_passo text, p_ok boolean, p_detalhe text) returns void
language sql as $$ insert into resultado_c1 (passo, ok, detalhe) values (p_passo, p_ok, left(p_detalhe, 900)) $$;

-- Fixture: duas pessoas com jornada aberta, cada uma com um bem e um familiar,
-- e um link de documentos ATIVO para a jornada A. É o mínimo para provar que o
-- item de B não entra no documento de A.
create or replace function pg_temp.c1_fixture()
returns table (
  pessoa_a uuid, jornada_a uuid, bem_a uuid, familiar_a uuid,
  pessoa_b uuid, jornada_b uuid, bem_b uuid,
  hash_a text
)
language plpgsql as $$
declare
  v_pa uuid; v_ja uuid; v_ba uuid; v_fa uuid;
  v_pb uuid; v_jb uuid; v_bb uuid;
  v_hash text := encode(sha256(gen_random_uuid()::text::bytea), 'hex');
  v_tag text := left(gen_random_uuid()::text, 8);
begin
  insert into pessoas (nome, email, telefone, cidade, uf, origem_dado)
  values ('Verificação C1 A ' || v_tag, 'verifc1a.' || v_tag || '@example.com',
          '+55000000' || lpad((random()*99999)::int::text, 5, '0'), 'São Paulo', 'SP', 'exemplo')
  returning id into v_pa;
  insert into jornadas (pessoa_id, origem, etapa, origem_dado)
  values (v_pa, 'outro', 'sessao_agendada', 'exemplo') returning id into v_ja;
  insert into patrimonio_itens (pessoa_id, registrado_na_jornada_id, tipo, descricao, valor_historico, valor_mercado)
  values (v_pa, v_ja, 'imovel', 'Imóvel de verificação A', 100000, 200000) returning id into v_ba;
  insert into familiares (pessoa_id, registrado_na_jornada_id, parentesco, nome)
  values (v_pa, v_ja, 'conjuge', 'Cônjuge de verificação A') returning id into v_fa;

  insert into pessoas (nome, email, telefone, cidade, uf, origem_dado)
  values ('Verificação C1 B ' || v_tag, 'verifc1b.' || v_tag || '@example.com',
          '+55000000' || lpad((random()*99999)::int::text, 5, '0'), 'Belo Horizonte', 'MG', 'exemplo')
  returning id into v_pb;
  insert into jornadas (pessoa_id, origem, etapa, origem_dado)
  values (v_pb, 'outro', 'sessao_agendada', 'exemplo') returning id into v_jb;
  insert into patrimonio_itens (pessoa_id, registrado_na_jornada_id, tipo, descricao, valor_historico, valor_mercado)
  values (v_pb, v_jb, 'imovel', 'Imóvel de verificação B', 300000, 400000) returning id into v_bb;

  -- Link de documentos da jornada A. `token_hash` é opaco aqui de propósito: o
  -- token em claro só existe no processo Next.js, nunca no banco (regra dura 2).
  insert into links_publicos (jornada_id, tipo, token_hash, token_prefixo, expira_em, origem_dado)
  values (v_ja, 'documentos', v_hash, 'verif1', now() + interval '7 days', 'exemplo');

  return query select v_pa, v_ja, v_ba, v_fa, v_pb, v_jb, v_bb, v_hash;
end $$;

create or replace function pg_temp.c1_como(p_papel text) returns uuid
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

-- ===========================================================================
-- 1. 0063 — `registrar_croqui_calculo` recusa quem não vê patrimônio.
--    `relacionamento` e `assistente` são internos e enxergam a jornada; o
--    snapshot do croqui é o patrimônio inteiro e não é para eles.
-- ===========================================================================
do $$
declare f record; e_rel text; e_asb text; n_linhas int; ok boolean := false; det text;
begin
  begin
    select * into f from pg_temp.c1_fixture();

    perform pg_temp.c1_como('relacionamento');
    begin
      perform registrar_croqui_calculo(f.jornada_a, null, 'motor-croqui@1',
        '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, null);
      e_rel := 'PASSOU';
    exception when others then e_rel := sqlstate; end;
    execute 'reset role';

    perform pg_temp.c1_como('assistente');
    begin
      perform registrar_croqui_calculo(f.jornada_a, null, 'motor-croqui@1',
        '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, null);
      e_asb := 'PASSOU';
    exception when others then e_asb := sqlstate; end;
    execute 'reset role';

    select count(*) into n_linhas from croqui_calculos where jornada_id = f.jornada_a;

    ok := e_rel = '42501' and e_asb = '42501' and n_linhas = 0;
    det := format('relacionamento→%s (esp. 42501) · assistente→%s (esp. 42501) · linhas gravadas=%s (esp. 0)',
                  e_rel, e_asb, n_linhas);
    raise exception 'rollback_proposital';
  exception when others then if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if; end;
  perform pg_temp.c1_reg('1 0063 registrar_croqui_calculo: intruso interno leva 42501 e nada grava', ok, det);
end $$;

-- ===========================================================================
-- 2. 0068 — a assinatura é ÚNICA e tem 10 parâmetros (armadilha 6: `create or
--    replace` com parâmetro novo criaria uma SEGUNDA sobrecarga e a chamada
--    nomeada ficaria ambígua em runtime).
-- ===========================================================================
do $$
declare n_func int; v_args text; n_arg int; ok boolean := false; det text;
begin
  begin
    select count(*) into n_func from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'registrar_documento_publico';
    select pg_get_function_identity_arguments(p.oid), p.pronargs into v_args, n_arg
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'registrar_documento_publico' limit 1;
    ok := n_func = 1 and n_arg = 10;
    det := format('funções com esse nome=%s (esp. 1) · nº de parâmetros=%s (esp. 10) · args=%s', n_func, n_arg, v_args);
    raise exception 'rollback_proposital';
  exception when others then if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if; end;
  perform pg_temp.c1_reg('2 0068 uma assinatura só, com 10 parâmetros (sem sobrecarga ambígua)', ok, det);
end $$;

-- ===========================================================================
-- 3. 0068 — privilégio: `anon` executa, PUBLIC e `authenticated` não.
--    (A 0065b existe porque um `grant` sem o `revoke` anterior não restringe
--    nada no Supabase — aqui o `revoke all from public, anon, authenticated`
--    vem antes do grant, e isto é a prova.)
-- ===========================================================================
do $$
declare v_acl text; p_anon boolean; p_auth boolean; p_pub boolean; ok boolean := false; det text;
begin
  begin
    select coalesce(p.proacl::text, '') into v_acl
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'registrar_documento_publico' limit 1;
    p_anon := has_function_privilege('anon',
      'public.registrar_documento_publico(text,text,text,text,text,bigint,text,text,text,text)', 'execute');
    p_auth := has_function_privilege('authenticated',
      'public.registrar_documento_publico(text,text,text,text,text,bigint,text,text,text,text)', 'execute');
    p_pub := v_acl like '%=X/%';   -- entrada sem role nomeado = PUBLIC
    ok := p_anon and not p_auth and not p_pub;
    det := format('anon=%s (esp. t) · authenticated=%s (esp. f) · PUBLIC=%s (esp. f) · acl=%s',
                  p_anon, p_auth, p_pub, v_acl);
    raise exception 'rollback_proposital';
  exception when others then if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if; end;
  perform pg_temp.c1_reg('3 0068 grants: só anon executa a RPC pública', ok, det);
end $$;

-- ===========================================================================
-- 4. 0068 — `item_ref` de OUTRA jornada vira NULL. É o passo que dá nome à
--    migration: o item precisa pertencer à pessoa da jornada DESTE link.
-- ===========================================================================
do $$
declare
  f record; r jsonb; v_ref text; v_sha text := encode(sha256(gen_random_uuid()::text::bytea), 'hex');
  ok boolean := false; det text;
begin
  begin
    select * into f from pg_temp.c1_fixture();
    r := registrar_documento_publico(
      f.hash_a, 'matricula_imovel', 'documento.pdf',
      'pessoas/' || f.pessoa_a || '/x/documento.pdf', 'application/pdf', 1024, v_sha,
      null, null, f.bem_b::text);            -- <<< o bem é da pessoa B
    select item_ref into v_ref from documentos where sha256 = v_sha;
    ok := (r ->> 'ok') = 'true' and v_ref is null;
    det := format('resposta=%s · item_ref gravado=%s (esp. NULL)', r::text, coalesce(v_ref, 'NULL'));
    raise exception 'rollback_proposital';
  exception when others then if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if; end;
  perform pg_temp.c1_reg('4 0068 item_ref de outra jornada grava NULL (upload aceito, item não casa)', ok, det);
end $$;

-- ===========================================================================
-- 5. 0068 — `item_ref` da PRÓPRIA jornada grava; familiar também vale; e
--    string que não é uuid vira NULL sem derrubar a RPC (`'cofre'::uuid`
--    levantaria 22P02 se não houvesse o teste de formato antes do cast).
-- ===========================================================================
do $$
declare
  f record;
  v_sha1 text := encode(sha256((gen_random_uuid()::text || '1')::bytea), 'hex');
  v_sha2 text := encode(sha256((gen_random_uuid()::text || '2')::bytea), 'hex');
  v_sha3 text := encode(sha256((gen_random_uuid()::text || '3')::bytea), 'hex');
  v_bem text; v_fam text; v_lixo text; e_lixo text := 'ok';
  ok boolean := false; det text;
begin
  begin
    select * into f from pg_temp.c1_fixture();

    perform registrar_documento_publico(f.hash_a, 'matricula_imovel', 'a.pdf',
      'pessoas/' || f.pessoa_a || '/1/a.pdf', 'application/pdf', 1024, v_sha1, null, null, f.bem_a::text);
    select item_ref into v_bem from documentos where sha256 = v_sha1;

    perform registrar_documento_publico(f.hash_a, 'certidao_casamento', 'b.pdf',
      'pessoas/' || f.pessoa_a || '/2/b.pdf', 'application/pdf', 1024, v_sha2, null, null, f.familiar_a::text);
    select item_ref into v_fam from documentos where sha256 = v_sha2;

    begin
      perform registrar_documento_publico(f.hash_a, 'crlv', 'c.pdf',
        'pessoas/' || f.pessoa_a || '/3/c.pdf', 'application/pdf', 1024, v_sha3, null, null, 'cofre');
    exception when others then e_lixo := sqlstate; end;
    select item_ref into v_lixo from documentos where sha256 = v_sha3;

    ok := v_bem = f.bem_a::text and v_fam = f.familiar_a::text and e_lixo = 'ok' and v_lixo is null;
    det := format('bem próprio gravado=%s · familiar próprio gravado=%s · item_ref não-uuid: erro=%s (esp. ok) item_ref=%s (esp. NULL)',
                  v_bem = f.bem_a::text, v_fam = f.familiar_a::text, e_lixo, coalesce(v_lixo, 'NULL'));
    raise exception 'rollback_proposital';
  exception when others then if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if; end;
  perform pg_temp.c1_reg('5 0068 item_ref próprio grava (bem e familiar); não-uuid vira NULL sem erro', ok, det);
end $$;

-- ===========================================================================
-- 6. 0068 — o `check` de tipo dentro da RPC acompanha a 0065: os 6 tipos novos
--    passam, tipo inventado é recusado e NADA é gravado.
--    Antes desta migration o cliente mandava o CRLV certo e recebia
--    "arquivo_invalido" — e o item ficava `a_pedir` para sempre.
-- ===========================================================================
do $$
declare
  f record; r_bom jsonb; r_ruim jsonb;
  v_sha text := encode(sha256((gen_random_uuid()::text || 'crlv')::bytea), 'hex');
  n_ruim int; ok boolean := false; det text;
begin
  begin
    select * into f from pg_temp.c1_fixture();
    r_bom := registrar_documento_publico(f.hash_a, 'crlv', 'crlv.pdf',
      'pessoas/' || f.pessoa_a || '/4/crlv.pdf', 'application/pdf', 1024, v_sha, null, null, null);
    r_ruim := registrar_documento_publico(f.hash_a, 'passaporte_do_cachorro', 'x.pdf',
      'pessoas/' || f.pessoa_a || '/5/x.pdf', 'application/pdf', 1024,
      encode(sha256('outro'::bytea), 'hex'), null, null, null);
    select count(*) into n_ruim from documentos where jornada_id = f.jornada_a and tipo = 'passaporte_do_cachorro';
    ok := (r_bom ->> 'ok') = 'true' and (r_ruim ->> 'erro') = 'arquivo_invalido' and n_ruim = 0;
    det := format('crlv→%s · tipo inventado→%s · linhas do tipo inventado=%s (esp. 0)',
                  r_bom::text, r_ruim::text, n_ruim);
    raise exception 'rollback_proposital';
  exception when others then if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if; end;
  perform pg_temp.c1_reg('6 0068 os 10 tipos da 0065 passam na RPC pública; tipo inventado é recusado', ok, det);
end $$;

-- ===========================================================================
-- 7. Fallback intacto — `app.payload_link_documentos` continua devolvendo os 3
--    tipos fixos, sem `item_ref`. É o que o `/p/d` mostra quando o servidor NÃO
--    consegue derivar o radar (sem service_role, sem a 0065). A lista de
--    verdade é derivada em `src/lib/radar/derivar.ts` e servida por
--    `GET /api/publico/[token]` — não dá para conferi-la em SQL.
-- ===========================================================================
do $$
declare
  f record; v_link links_publicos; v_jor jornadas%rowtype; v_payload jsonb;
  n_tipos int; n_com_item int; ok boolean := false; det text;
begin
  begin
    select * into f from pg_temp.c1_fixture();
    select * into v_link from links_publicos where token_hash = f.hash_a;
    select * into v_jor from jornadas where id = f.jornada_a;
    v_payload := app.payload_link_documentos(v_link, v_jor);
    select jsonb_array_length(v_payload -> 'tipos_pedidos') into n_tipos;
    select count(*) into n_com_item
      from jsonb_array_elements(v_payload -> 'tipos_pedidos') e
     where e ? 'item_ref';
    ok := n_tipos = 3 and n_com_item = 0 and (v_payload -> 'limite_arquivos')::int = 5;
    det := format('tipos_pedidos=%s (esp. 3, fallback) · com item_ref=%s (esp. 0) · limite_arquivos=%s',
                  n_tipos, n_com_item, v_payload -> 'limite_arquivos');
    raise exception 'rollback_proposital';
  exception when others then if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if; end;
  perform pg_temp.c1_reg('7 fallback: app.payload_link_documentos inalterado (3 tipos, sem item_ref)', ok, det);
end $$;

-- ===========================================================================
-- 8. Nada sobreviveu: nenhuma pessoa, jornada, link ou documento de fixture.
--    (Cada passo rolou de volta; este passo é a prova, não a limpeza.)
-- ===========================================================================
do $$
declare n_pessoa int; n_link int; n_doc int; ok boolean := false; det text;
begin
  select count(*) into n_pessoa from pessoas where nome like 'Verificação C1 %';
  select count(*) into n_link from links_publicos where token_prefixo = 'verif1';
  select count(*) into n_doc from documentos where caminho like 'pessoas/%/1/a.pdf';
  ok := n_pessoa = 0 and n_link = 0 and n_doc = 0;
  det := format('pessoas de fixture=%s · links=%s · documentos=%s (todos esp. 0)', n_pessoa, n_link, n_doc);
  perform pg_temp.c1_reg('8 nenhuma escrita sobreviveu ao roteiro', ok, det);
end $$;

select ordem, passo, ok, detalhe from resultado_c1 order by ordem;
