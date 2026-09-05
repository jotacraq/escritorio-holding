-- scripts/verificacao-0070.sql — roteiro da 0070 (correção do REPROVADO do Fable).
-- ---------------------------------------------------------------------------
-- COMO RODAR: uma chamada só (MCP execute_sql / SQL Editor / psql -f) como
-- postgres, com a 0070 APLICADA. A última instrução devolve `resultado_0070`
-- (ordem, passo, ok, detalhe). `ok = true` significa que o banco faz o que a
-- migration promete. Idempotente; nenhuma fixture sobrevive.
--
-- Molde: scripts/verificacao-0069.sql — inclusive a ARMADILHA que ele resolve e
-- que é fácil de reintroduzir: em PL/pgSQL, o bloco `EXCEPTION` é uma
-- subtransação, então TUDO que o corpo escreveu (inclusive o INSERT no
-- `resultado_0070`) é desfeito quando o `raise 'rollback_proposital'` estoura.
-- Por isso o padrão é sempre: sub-bloco `begin … exception … end` que só
-- alimenta VARIÁVEIS locais, e o `perform pg_temp.r70(...)` **fora** dele.
--
-- O QUE ESTE ROTEIRO PROVA
--   1. evento de cálculo NÃO chega como `tipo='croqui'` — a causa raiz do
--      "croqui pronto — apresentar" com croqui em rascunho;
--   2. nenhum evento `croqui` sobrou sem `dados.status` (backfill do bloco b);
--   3. grants de `vw_automacoes_jornada` (anon fora, authenticated só SELECT);
--   4. `search_path` das 4 funções da 0065/0067 via `pg_proc.proconfig`;
--   5. `croqui_narrativas` com RLS forçada, sem INSERT para `authenticated`, e
--      a RPC com assinatura única e EXECUTE só de `service_role`;
--   6. a RPC recusa autor sem `ve_patrimonio` e grava com autor válido.
--
-- O QUE NÃO DÁ PARA VERIFICAR AQUI: que a ROTA responde 401/404/409
-- `narrativa_inativa`. Isso é curl contra o Next — feito, tabela no relatório
-- do F1 em tmp/squad/fase5-brief.md.
-- ---------------------------------------------------------------------------

drop table if exists resultado_0070;
create temp table resultado_0070 (
  ordem serial primary key, passo text not null, ok boolean not null, detalhe text
) on commit drop;

create or replace function pg_temp.r70(p_passo text, p_ok boolean, p_detalhe text) returns void
language sql as $$ insert into resultado_0070 (passo, ok, detalhe) values (p_passo, p_ok, left(p_detalhe, 900)) $$;


-- ===========================================================================
-- 1. O trigger de cálculo grava `croqui_calculo`, não `croqui`.
--    Fixture real (pessoa + jornada + RPC de service_role da 0069), revertida.
-- ===========================================================================
do $$
declare
  v_tag    text := left(gen_random_uuid()::text, 8);
  v_pessoa uuid; v_jornada uuid; v_perfil uuid;
  v_tipo   text; v_dados jsonb; v_croqui_evt int;
  ok boolean := false; det text;
begin
  begin
    select id into v_perfil from perfis_equipe
     where papel in ('admin','advogada') and ativo limit 1;
    if v_perfil is null then
      det := 'sem perfil admin/advogada ativo para usar de autor';
      raise exception 'rollback_proposital';
    end if;

    insert into pessoas (nome, email, telefone, cidade, uf, origem_dado)
    values ('Verificação 0070 ' || v_tag, 'verif70.' || v_tag || '@example.com',
            '+55000000' || lpad((random()*99999)::int::text, 5, '0'), 'São Paulo', 'SP', 'exemplo')
    returning id into v_pessoa;
    insert into jornadas (pessoa_id, origem, etapa, origem_dado)
    values (v_pessoa, 'outro', 'sessao_agendada', 'exemplo') returning id into v_jornada;

    perform registrar_croqui_calculo(
      v_jornada, null::uuid, 'motor-croqui@1',
      '{"jornada_id":"x"}'::jsonb, '{"itens":{}}'::jsonb,
      '{"motor_versao":"motor-croqui@1","tabelas":{},"faltas":[],"divergencias":[]}'::jsonb,
      null::text, v_perfil);

    select tipo, dados into v_tipo, v_dados
      from eventos_timeline
     where jornada_id = v_jornada
     order by ocorrido_em desc limit 1;

    -- A trava de verdade: NENHUM evento `tipo='croqui'` nasceu desta jornada,
    -- que é o que fazia `sinaisDaFicha()` dizer "pronto".
    select count(*) into v_croqui_evt from eventos_timeline
     where jornada_id = v_jornada and tipo = 'croqui';

    ok := v_tipo = 'croqui_calculo'
      and v_croqui_evt = 0
      and v_dados ? 'calculo_id' and v_dados ? 'motor_versao';
    det := format('tipo do evento = %s · eventos tipo=croqui na jornada = %s · dados = %s',
                  coalesce(v_tipo, '(nenhum)'), v_croqui_evt, coalesce(v_dados::text, 'null'));
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if;
  end;
  perform pg_temp.r70('1 evento de cálculo com tipo próprio (e zero evento tipo=croqui)', ok, det);
end $$;


-- ===========================================================================
-- 2. Backfill: nenhum evento `croqui` sobrou sem `dados.status`.
--    Leitura pura — sem escrita, sem subtransação.
-- ===========================================================================
do $$
declare v_sem_status int; v_com_status int; v_calc int; v_exp int;
begin
  select count(*) filter (where not (dados ? 'status')),
         count(*) filter (where dados ? 'status')
    into v_sem_status, v_com_status
    from eventos_timeline where tipo = 'croqui';
  select count(*) into v_calc from eventos_timeline where tipo = 'croqui_calculo';
  select count(*) into v_exp  from eventos_timeline where tipo = 'croqui_exportacao';

  perform pg_temp.r70('2a nenhum evento tipo=croqui sem dados.status (backfill)',
    v_sem_status = 0,
    format('sem status = %s · com status = %s', v_sem_status, v_com_status));
  perform pg_temp.r70('2b eventos reclassificados (informativo — confira contra o PRÉ do passo 0)',
    true, format('croqui_calculo = %s · croqui_exportacao = %s', v_calc, v_exp));
end $$;


-- ===========================================================================
-- 3. Grants de vw_automacoes_jornada (ressalva de segurança do Fable).
-- ===========================================================================
do $$
declare anon_sel boolean; auth_sel boolean; auth_ins boolean; auth_upd boolean;
        auth_del boolean; srv_sel boolean;
begin
  anon_sel := has_table_privilege('anon',          'vw_automacoes_jornada', 'select');
  auth_sel := has_table_privilege('authenticated', 'vw_automacoes_jornada', 'select');
  auth_ins := has_table_privilege('authenticated', 'vw_automacoes_jornada', 'insert');
  auth_upd := has_table_privilege('authenticated', 'vw_automacoes_jornada', 'update');
  auth_del := has_table_privilege('authenticated', 'vw_automacoes_jornada', 'delete');
  srv_sel  := has_table_privilege('service_role',  'vw_automacoes_jornada', 'select');

  perform pg_temp.r70('3 vw_automacoes_jornada: anon fora, authenticated só SELECT',
    (not anon_sel) and auth_sel and srv_sel and not (auth_ins or auth_upd or auth_del),
    format('anon.select=%s auth.select=%s auth.insert=%s auth.update=%s auth.delete=%s service_role.select=%s',
           anon_sel, auth_sel, auth_ins, auth_upd, auth_del, srv_sel));
end $$;


-- ===========================================================================
-- 4. `search_path` das 4 funções de trigger da 0065/0067.
-- ===========================================================================
do $$
declare r record; v_total int := 0; v_ok int := 0; det text := '';
begin
  for r in
    select p.proname, coalesce(array_to_string(p.proconfig, ','), '(nulo)') as cfg
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app'
       and p.proname in ('protege_documento_pedido','documentos_pedidos_timeline',
                         'protege_execucao_marco','execucao_marco_timeline')
     order by 1
  loop
    v_total := v_total + 1;
    if r.cfg like 'search_path=%' then v_ok := v_ok + 1; end if;
    det := det || r.proname || '=' || r.cfg || ' · ';
  end loop;

  perform pg_temp.r70('4 as 4 funções da 0065/0067 com set search_path',
    v_total = 4 and v_ok = 4,
    format('%s de %s funções encontradas com search_path · %s', v_ok, v_total, det));
end $$;


-- ===========================================================================
-- 5. croqui_narrativas: RLS, privilégio de tabela e assinatura única da RPC.
-- ===========================================================================
do $$
declare
  s_rpc text := 'public.registrar_croqui_narrativa(uuid,uuid,jsonb,smallint,smallint,uuid)';
  rls boolean; forc boolean; anon_sel boolean; auth_sel boolean;
  auth_ins boolean; auth_upd boolean; auth_del boolean;
  n_assin int; auth_exec boolean; srv_exec boolean; acl text; pub_exec boolean;
  ok boolean := false; det text;
begin
  begin
    select relrowsecurity, relforcerowsecurity into rls, forc
      from pg_class where oid = 'croqui_narrativas'::regclass;
    anon_sel := has_table_privilege('anon',          'croqui_narrativas', 'select');
    auth_sel := has_table_privilege('authenticated', 'croqui_narrativas', 'select');
    auth_ins := has_table_privilege('authenticated', 'croqui_narrativas', 'insert');
    auth_upd := has_table_privilege('authenticated', 'croqui_narrativas', 'update');
    auth_del := has_table_privilege('authenticated', 'croqui_narrativas', 'delete');

    select count(*) into n_assin
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'registrar_croqui_narrativa';
    select coalesce(p.proacl::text, '') into acl
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'registrar_croqui_narrativa' limit 1;
    -- entrada sem role nomeado = PUBLIC: '{=X/…' ou ',=X/…'. ('%=X/%' casava com
    -- 'postgres=X/postgres' e dava falso positivo — corrigido em 05/09 à noite.)
    pub_exec  := acl like '{=X/%' or acl like '%,=X/%';
    auth_exec := has_function_privilege('authenticated', s_rpc, 'execute');
    srv_exec  := has_function_privilege('service_role',  s_rpc, 'execute');

    ok := rls and forc and auth_sel and srv_exec
      and not anon_sel and not (auth_ins or auth_upd or auth_del)
      and n_assin = 1 and not auth_exec and not pub_exec;
    det := format('rls=%s forçada=%s · tabela: anon.sel=%s auth.sel=%s auth.ins=%s auth.upd=%s auth.del=%s · rpc: %s assinatura(s) auth=%s service_role=%s PUBLIC=%s acl=%s',
                  rls, forc, anon_sel, auth_sel, auth_ins, auth_upd, auth_del,
                  n_assin, auth_exec, srv_exec, pub_exec, acl);
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if;
  end;
  perform pg_temp.r70('5 croqui_narrativas: RLS forçada, sem escrita de authenticated, RPC só service_role', ok, det);
end $$;


-- ===========================================================================
-- 6. A RPC recusa autor sem papel e grava com autor válido (tudo revertido).
-- ===========================================================================
do $$
declare
  v_tag text := left(gen_random_uuid()::text, 8);
  v_pessoa uuid; v_jornada uuid; v_croqui uuid; v_perfil uuid; v_rel uuid; v_prompt uuid;
  -- `record`, não `croqui_narrativas`: se a 0070 não estiver aplicada, um
  -- tipo composto inexistente quebraria a COMPILAÇÃO do bloco inteiro e o
  -- passo 6 sumiria do relatório em vez de reportar a falta.
  v_exec uuid; v_narr record;
  v_recusou boolean := false; v_pulou_recusa boolean := false;
  v_evt_proprio boolean; v_croqui_antes int; v_croqui_depois int; v_croqui_sem_status int;
  ok boolean := false; det text;
  v_conteudo jsonb := '{"como_apresentar":[],"arquitetura":{"recomendacao":"ponto_a_validar","justificativa":"x","criterios":[]},"perguntas":[],"objecoes":[],"fechamento":"x","grau_confianca":10,"lacunas":[]}'::jsonb;
begin
  begin
    select id into v_perfil from perfis_equipe where papel in ('admin','advogada') and ativo limit 1;
    select id into v_rel    from perfis_equipe where papel = 'relacionamento' and ativo limit 1;
    select id into v_prompt from prompts_versoes
     where chave = 'agente_croqui_narrativa' order by versao desc limit 1;
    if v_perfil is null or v_prompt is null then
      det := format('faltou fixture: perfil=%s prompt agente_croqui_narrativa=%s', v_perfil, v_prompt);
      raise exception 'rollback_proposital';
    end if;

    insert into pessoas (nome, email, telefone, cidade, uf, origem_dado)
    values ('Verificação 0070 N ' || v_tag, 'verif70n.' || v_tag || '@example.com',
            '+55000000' || lpad((random()*99999)::int::text, 5, '0'), 'São Paulo', 'SP', 'exemplo')
    returning id into v_pessoa;
    insert into jornadas (pessoa_id, origem, etapa, origem_dado)
    values (v_pessoa, 'outro', 'sessao_agendada', 'exemplo') returning id into v_jornada;
    -- croquis NÃO tem origem_dado (a jornada é que carrega); versao/titulo são not null.
    insert into croquis (jornada_id, versao, titulo) values (v_jornada, 1, 'Verificação 0070 ' || v_tag) returning id into v_croqui;

    insert into execucoes_ia (jornada_id, prompt_versao_id, modelo, status, hash_entrada, modo)
    values (v_jornada, v_prompt, 'anthropic/claude-sonnet-5', 'concluida', repeat('a', 64), 'real')
    returning id into v_exec;

    select count(*) into v_croqui_antes
      from eventos_timeline where jornada_id = v_jornada and tipo = 'croqui';

    -- (a) autor sem `ve_patrimonio` é recusado NO BANCO (42501).
    if v_rel is not null then
      begin
        perform registrar_croqui_narrativa(v_croqui, v_exec, v_conteudo, 10::smallint, 3::smallint, v_rel);
      exception when insufficient_privilege then v_recusou := true;
      end;
    else
      v_pulou_recusa := true;
    end if;

    -- (b) autor válido grava como atual, schema 3, origem real, versão 1.
    select * into v_narr
      from registrar_croqui_narrativa(v_croqui, v_exec, v_conteudo, 10::smallint, 3::smallint, v_perfil);

    -- (c) timeline com tipo PRÓPRIO, e nenhum evento `croqui` de carona.
    --     O INSERT em `croquis` gera, legitimamente, UM evento tipo=croqui (com
    --     `status`); o que se prova é que a RPC da narrativa não acrescenta outro
    --     e que nenhum evento croqui está sem status. (A 1ª versão exigia zero
    --     evento croqui e falhava por causa do próprio fixture — 05/09 à noite.)
    v_evt_proprio := exists (select 1 from eventos_timeline
                              where jornada_id = v_jornada and tipo = 'croqui_narrativa');
    select count(*), count(*) filter (where not (dados ? 'status'))
      into v_croqui_depois, v_croqui_sem_status
      from eventos_timeline where jornada_id = v_jornada and tipo = 'croqui';

    ok := (v_recusou or v_pulou_recusa)
      and v_narr.atual and v_narr.schema_versao = 3
      and v_narr.origem_dado = 'real' and v_narr.versao = 1
      and v_evt_proprio and v_croqui_depois = v_croqui_antes and v_croqui_sem_status = 0;
    det := format('recusou autor sem papel=%s%s · gravou: atual=%s schema=%s origem=%s versao=%s · timeline: croqui_narrativa=%s · eventos croqui antes/depois da RPC=%s/%s (sem status=%s)',
                  v_recusou, case when v_pulou_recusa then ' (pulado: sem perfil relacionamento ativo)' else '' end,
                  v_narr.atual, v_narr.schema_versao, v_narr.origem_dado, v_narr.versao,
                  v_evt_proprio, v_croqui_antes, v_croqui_depois, v_croqui_sem_status);
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then ok := false; det := sqlstate || ' ' || sqlerrm; end if;
  end;
  perform pg_temp.r70('6 registrar_croqui_narrativa: gate de papel, atual/schema 3 e timeline própria', ok, det);
end $$;

select * from resultado_0070 order by ordem;
