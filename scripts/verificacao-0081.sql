-- scripts/verificacao-0081.sql — roteiro da 0081 (correções do pentest da Fase 7, r3).
-- ---------------------------------------------------------------------------
-- COMO RODAR: uma chamada só (MCP execute_sql / SQL Editor / psql -f) como
-- `postgres`, com 0078 → 0079 → 0080 → 0081 APLICADAS, NESTA ORDEM. TEM de ser
-- `postgres`: quase toda tabela tocada aqui está em `force row level security`,
-- e as fixtures só passam com um papel que tenha BYPASSRLS.
--
-- NADA DE VERDADE É ALTERADO. Toda fixture nasce e morre dentro de um
-- `raise exception 'rollback_proposital'` — mesma armadilha da 0074/0075 que a
-- 0080 já documenta: o bloco `EXCEPTION` é subtransação, tudo que o corpo
-- escreveu é desfeito quando o `raise` estoura, e por isso o RESULTADO sai em
-- VARIÁVEL e o `perform pg_temp.r81(...)` vem FORA do sub-bloco.
--
-- NÚMEROS MEDIDOS ANTES DE APLICAR (06/09/2026, produção, pelo orquestrador):
--   pessoas = 6 (1 real + 5 exemplo) · webhooks_eventos = 6 ·
--   formularios = 1 · formularios_respostas = 3 · roteiros_versoes = 6 ·
--   titulares_solicitacoes = 0
-- ---------------------------------------------------------------------------

drop table if exists resultado_0081;
create temp table resultado_0081 (
  ordem serial primary key, passo text not null, ok boolean not null, detalhe text
) on commit drop;

create or replace function pg_temp.r81(p_passo text, p_ok boolean, p_detalhe text) returns void
language sql as $$ insert into resultado_0081 (passo, ok, detalhe) values (p_passo, p_ok, left(p_detalhe, 1200)) $$;

create temp table contagem_0081 on commit drop as
select (select count(*) from pessoas)                 as pessoas,
       (select count(*) from webhooks_eventos)        as webhooks,
       (select count(*) from formularios)             as formularios,
       (select count(*) from formularios_respostas)   as respostas,
       (select count(*) from roteiros_versoes)        as roteiros,
       (select count(*) from titulares_solicitacoes)  as solicitacoes,
       (select md5(string_agg(definicao::text, '|' order by chave, versao)) from roteiros_versoes) as md5_roteiros;


-- ===========================================================================
-- 1. SUPERFÍCIE: a view continua invoker, `roteiros_versoes` perdeu a escrita
--    direta, e `confirmar_expurgo_storage` saiu de `authenticated`.
-- ===========================================================================
do $$
declare
  v_invoker text; v_rvwr int; v_rv_ins boolean; v_rv_upd boolean; v_rv_del boolean;
  v_conf_auth boolean; v_conf_srv boolean; v_pub_auth boolean; ok boolean;
begin
  select (select option from unnest(coalesce(c.reloptions, '{}')) as option
           where option like 'security_invoker=%' limit 1)
    into v_invoker
    from pg_class c where c.oid = 'public.vw_pendencias_sistema'::regclass;

  select count(*) into v_rvwr from pg_policies
   where schemaname = 'public' and tablename = 'roteiros_versoes' and policyname = 'rv_wr';

  v_rv_ins := has_table_privilege('authenticated', 'roteiros_versoes', 'insert');
  v_rv_upd := has_table_privilege('authenticated', 'roteiros_versoes', 'update');
  v_rv_del := has_table_privilege('authenticated', 'roteiros_versoes', 'delete');

  v_conf_auth := has_function_privilege('authenticated', 'public.confirmar_expurgo_storage(uuid, text[])', 'execute');
  v_conf_srv  := has_function_privilege('service_role',  'public.confirmar_expurgo_storage(uuid, text[])', 'execute');
  v_pub_auth  := has_function_privilege('authenticated',
    'public.publicar_roteiro_versao(text, jsonb, text, boolean, text, uuid)', 'execute');

  ok := coalesce(v_invoker = 'security_invoker=true' and v_rvwr = 0
                 and not v_rv_ins and not v_rv_upd and not v_rv_del
                 and not v_conf_auth and v_conf_srv and v_pub_auth, false);
  perform pg_temp.r81(
    '1 view invoker · rv_wr fora · roteiros_versoes sem escrita para authenticated · confirmar_expurgo so service_role',
    ok,
    format('invoker=%s rv_wr=%s rv_ins=%s rv_upd=%s rv_del=%s conf_auth=%s conf_srv=%s publicar_auth=%s',
           coalesce(v_invoker, '(sem opcao)'), v_rvwr, v_rv_ins, v_rv_upd, v_rv_del,
           v_conf_auth, v_conf_srv, v_pub_auth));
end $$;


-- ===========================================================================
-- 2. A VIEW EMITE A PENDÊNCIA. Fixture: uma solicitação de anonimização com
--    `storage_pendente` cheio e `storage_removido_em` nulo tem de aparecer em
--    `vw_pendencias_sistema` como `expurgo_storage_pendente` — e SUMIR quando
--    o carimbo de fecho existe.
-- ===========================================================================
do $$
declare
  v_admin uuid; v_pessoa uuid; v_sol uuid;
  v_linhas int := -1; v_tipo text; v_nome text; v_titulo text; v_desc text;
  v_apos_fecho int := -1;
  ok boolean := true; det text := null;
begin
  select id into v_admin from perfis_equipe where papel = 'admin' and ativo order by criado_em limit 1;
  if v_admin is null then
    perform pg_temp.r81('2 view emite expurgo_storage_pendente', false, 'nenhum admin ativo para a fixture');
    return;
  end if;

  begin
    insert into pessoas (nome, email, origem_dado)
    values ('Fixture Verificacao 0081', 'fixture0081@example.com', 'real')
    returning id into v_pessoa;

    -- Escrita DIRETA na trilha (a RPC não é o alvo deste passo): `postgres` tem
    -- BYPASSRLS, e a linha morre no rollback.
    insert into titulares_solicitacoes
      (pessoa_id, tipo, motivo, base_legal, canal_pedido, solicitado_em, executado_por, resultado)
    values (v_pessoa, 'anonimizacao', 'fixture do roteiro 0081', 'Art. 18, VI', 'oficio',
            now() - interval '1 hour', v_admin,
            jsonb_build_object('tabelas', '{}'::jsonb,
                               'storage_pendente', jsonb_build_array('pessoas/x/ir.pdf', 'pessoas/x/contrato.pdf'),
                               'storage_removido_em', null,
                               'avisos', '[]'::jsonb))
    returning id into v_sol;

    select count(*) into v_linhas from vw_pendencias_sistema where id = v_sol::text;
    select tipo, titulo, descricao, pessoa_nome into v_tipo, v_titulo, v_desc, v_nome
      from vw_pendencias_sistema where id = v_sol::text;

    -- Com o fecho carimbado, a linha some da fila (não é pendência resolvida à
    -- mão: é a mesma condição que `confirmar_expurgo_storage` produz).
    update titulares_solicitacoes
       set resultado = resultado || jsonb_build_object('storage_pendente', '[]'::jsonb,
                                                       'storage_removido_em', to_jsonb(now()))
     where id = v_sol;
    select count(*) into v_apos_fecho from vw_pendencias_sistema where id = v_sol::text;

    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      ok := false; det := format('EXCECAO onde nao podia haver: %s %s', sqlstate, sqlerrm);
    end if;
  end;

  ok := coalesce(ok
    and v_linhas = 1
    and v_tipo = 'expurgo_storage_pendente'
    and v_titulo = 'Expurgo de arquivos pendente'
    and v_desc like '%2 arquivo(s)%'
    and v_nome = 'Fixture Verificacao 0081'
    and v_apos_fecho = 0, false);

  perform pg_temp.r81('2 view emite expurgo_storage_pendente com fixture, e a linha some com o fecho',
    ok, coalesce(det, format('linhas=%s tipo=%s titulo=%s pessoa=%s apos_fecho=%s desc=%s',
      v_linhas, coalesce(v_tipo,'-'), coalesce(v_titulo,'-'), coalesce(v_nome,'-'), v_apos_fecho,
      left(coalesce(v_desc,'-'), 90))));
end $$;


-- ===========================================================================
-- 3. TRIGGER DE `pessoas`: recusa mudança em anonimizada_em/anonimizacao_id, e
--    aceita quando a GUC `app.anonimizacao` está ligada (que é o que a RPC
--    faz). O resto do UPDATE em `pessoas` continua livre — a trava é nas duas
--    colunas, não na tabela.
-- ===========================================================================
do $$
declare
  v_pessoa uuid;
  v_e1 text := '(NAO RECUSOU)'; v_e2 text := '(NAO RECUSOU)';
  ok1 boolean := false; ok2 boolean := false; ok3 boolean := false; ok4 boolean := false;
  v_com_guc timestamptz; v_cidade text;
  ok boolean := true; det text := null;
begin
  begin
    insert into pessoas (nome, email, cidade, origem_dado)
    values ('Fixture Trigger 0081', 'trigger0081@example.com', 'Curitiba', 'real')
    returning id into v_pessoa;

    -- (1) carimbar à mão: recusa
    begin
      update pessoas set anonimizada_em = now() where id = v_pessoa;
    exception when others then v_e1 := sqlerrm; ok1 := position('carimbo_anonimizacao_protegido' in sqlerrm) = 1;
    end;

    -- (2) mexer no anonimizacao_id: recusa
    begin
      update pessoas set anonimizacao_id = gen_random_uuid() where id = v_pessoa;
    exception when others then v_e2 := sqlerrm; ok2 := position('carimbo_anonimizacao_protegido' in sqlerrm) = 1;
    end;

    -- (3) UPDATE comum continua passando (a trava não é na tabela)
    update pessoas set cidade = 'Londrina' where id = v_pessoa;
    select cidade into v_cidade from pessoas where id = v_pessoa;
    ok3 := (v_cidade = 'Londrina');

    -- (4) com a GUC ligada — a porta de serviço que `anonimizar_titular` usa
    perform set_config('app.anonimizacao', 'on', true);
    update pessoas set anonimizada_em = now() where id = v_pessoa;
    select anonimizada_em into v_com_guc from pessoas where id = v_pessoa;
    perform set_config('app.anonimizacao', 'off', true);
    ok4 := (v_com_guc is not null);

    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      ok := false; det := format('EXCECAO onde nao podia haver: %s %s', sqlstate, sqlerrm);
    end if;
  end;

  ok := coalesce(ok and ok1 and ok2 and ok3 and ok4, false);
  perform pg_temp.r81('3 trigger de pessoas recusa carimbo a mao (2 colunas), deixa UPDATE comum passar e aceita com a GUC',
    ok, coalesce(det, format('anonimizada_em: %s ;; anonimizacao_id: %s ;; update comum ok=%s ;; com GUC ok=%s',
      left(v_e1, 120), left(v_e2, 120), ok3, ok4)));
end $$;


-- ===========================================================================
-- 4. `confirmar_expurgo_storage`: recusa caminho fora de `storage_pendente`,
--    acumula `storage_removido`, e só carimba `storage_removido_em` quando a
--    lista de pendentes esvazia (é esse `null` que mantém a fila do passo 2).
-- ===========================================================================
do $$
declare
  v_admin uuid; v_pessoa uuid; v_sol uuid;
  v_erro text := '(NAO RECUSOU)'; ok1 boolean := false;
  v_parcial titulares_solicitacoes; v_final titulares_solicitacoes;
  ok boolean := true; det text := null;
begin
  select id into v_admin from perfis_equipe where papel = 'admin' and ativo order by criado_em limit 1;
  if v_admin is null then
    perform pg_temp.r81('4 confirmar_expurgo_storage: lista fechada, trilha e fecho parcial', false, 'nenhum admin ativo');
    return;
  end if;

  begin
    insert into pessoas (nome, origem_dado) values ('Fixture Expurgo 0081', 'real') returning id into v_pessoa;

    insert into titulares_solicitacoes
      (pessoa_id, tipo, motivo, base_legal, canal_pedido, solicitado_em, executado_por, resultado)
    values (v_pessoa, 'anonimizacao', 'fixture do roteiro 0081', 'Art. 18, VI', 'oficio',
            now() - interval '1 hour', v_admin,
            jsonb_build_object('tabelas', '{}'::jsonb,
                               'storage_pendente', jsonb_build_array('pessoas/y/a.pdf', 'pessoas/y/b.pdf'),
                               'storage_removido_em', null))
    returning id into v_sol;

    -- (1) caminho que NUNCA esteve pendente: 22023
    begin
      perform public.confirmar_expurgo_storage(v_sol, array['pessoas/DE-OUTRA-PESSOA/segredo.pdf']);
    exception when others then v_erro := sqlerrm; ok1 := position('caminho_fora_da_lista' in sqlerrm) = 1;
    end;

    -- (2) confirmação PARCIAL: sobra 1 pendente, então NÃO carimba o fecho
    v_parcial := public.confirmar_expurgo_storage(v_sol, array['pessoas/y/a.pdf']);

    -- (3) confirmação do último: agora sim carimba
    v_final := public.confirmar_expurgo_storage(v_sol, array['pessoas/y/b.pdf']);

    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      ok := false; det := format('EXCECAO onde nao podia haver: %s %s', sqlstate, sqlerrm);
    end if;
  end;

  ok := coalesce(ok and ok1
    and jsonb_array_length(v_parcial.resultado -> 'storage_pendente') = 1
    and v_parcial.resultado ->> 'storage_removido_em' is null
    and jsonb_array_length(v_parcial.resultado -> 'storage_removido') = 1
    and jsonb_array_length(v_final.resultado -> 'storage_pendente') = 0
    and v_final.resultado ->> 'storage_removido_em' is not null
    and jsonb_array_length(v_final.resultado -> 'storage_removido') = 2, false);

  perform pg_temp.r81('4 confirmar_expurgo recusa caminho fora da lista · fecho so quando pendente esvazia · trilha acumula',
    ok, coalesce(det, format('recusa=%s ;; parcial pendente=%s removido=%s fecho=%s ;; final pendente=%s removido=%s fecho=%s',
      left(v_erro, 90),
      coalesce((v_parcial.resultado -> 'storage_pendente')::text, '-'),
      coalesce((v_parcial.resultado -> 'storage_removido')::text, '-'),
      coalesce(v_parcial.resultado ->> 'storage_removido_em', '(nulo)'),
      coalesce((v_final.resultado -> 'storage_pendente')::text, '-'),
      coalesce((v_final.resultado -> 'storage_removido')::text, '-'),
      coalesce(v_final.resultado ->> 'storage_removido_em', '(nulo)'))));
end $$;


-- ===========================================================================
-- 5. `responder_formulario_publico` aplica a definição: pergunta obrigatória
--    sem resposta é recusada, escolha fora das opções é recusada, e a resposta
--    correta ainda passa. Fixture: versão nova do formulário com uma pergunta
--    obrigatória e uma de escolha, ativada só dentro do rollback.
-- ===========================================================================
do $$
declare
  v_admin uuid; v_edicao uuid; v_pessoa uuid; v_jornada uuid; v_form formularios;
  v_hash text;
  v_r1 jsonb; v_r2 jsonb; v_r3 jsonb;
  ok boolean := true; det text := null;
begin
  select id into v_admin  from perfis_equipe where papel = 'admin' and ativo order by criado_em limit 1;
  select id into v_edicao from edicoes_seminario order by criado_em limit 1;
  if v_admin is null then
    perform pg_temp.r81('5 responder_formulario_publico aplica obrigatoria e opcoes', false, 'nenhum admin ativo');
    return;
  end if;

  begin
    -- Versão nova do POP 02 com as 4 perguntas de sistema; `p9` é obrigatória
    -- e de escolha única. Publicada e ativada pela própria RPC da 0078.
    v_form := public.publicar_formulario_versao(
      'estrategico',
      jsonb_build_array(
        jsonb_build_object('id','p1','bloco','Identificacao','tipo','texto','rotulo','Nome completo'),
        jsonb_build_object('id','p2','bloco','Identificacao','tipo','texto','rotulo','Cidade'),
        jsonb_build_object('id','p9','bloco','Patrimonio','tipo','unica','rotulo','Faixa de patrimonio',
          'obrigatoria', true,
          'opcoes', jsonb_build_array(
            jsonb_build_object('valor','ate_500k','rotulo','Ate R$ 500 mil'),
            jsonb_build_object('valor','acima_500k','rotulo','Acima de R$ 500 mil'))),
        jsonb_build_object('id','p16','bloco','Dor','tipo','texto_longo','rotulo','O que mais preocupa')),
      'fixture do roteiro 0081', 'nao publicar de verdade', true, v_admin);

    insert into pessoas (nome, origem_dado) values ('Fixture Publico 0081', 'real') returning id into v_pessoa;
    insert into jornadas (pessoa_id, edicao_id, origem, etapa, desfecho, origem_dado)
    values (v_pessoa, v_edicao, 'outro', 'captado', 'aberta', 'real')
    returning id into v_jornada;

    -- `app.resolve_link_escrita` compara `p_hash` com `token_hash` DIRETO (o
    -- hash é calculado no Node, não no banco): aqui o valor gravado é o mesmo
    -- que a RPC recebe. Nada de pgcrypto no caminho.
    v_hash := 'verif0081_' || encode(gen_random_bytes(24), 'hex');
    insert into links_publicos (jornada_id, tipo, token_hash, token_prefixo, estado, expira_em, origem_dado)
    values (v_jornada, 'formulario', v_hash, 'vf0081', 'ativo', now() + interval '7 days', 'real');

    -- (1) obrigatória sem resposta
    v_r1 := public.responder_formulario_publico(v_hash, jsonb_build_object('p1','Fulano'), '[]'::jsonb, null, null);
    -- (2) opção que não existe na definição desta versão
    v_r2 := public.responder_formulario_publico(v_hash,
      jsonb_build_object('p1','Fulano','p9','faixa_que_nao_existe'), '[]'::jsonb, null, null);
    -- (3) resposta correta ainda passa
    v_r3 := public.responder_formulario_publico(v_hash,
      jsonb_build_object('p1','Fulano','p9','ate_500k'), '[]'::jsonb, null, null);

    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      ok := false; det := format('EXCECAO onde nao podia haver: %s %s', sqlstate, sqlerrm);
    end if;
  end;

  ok := coalesce(ok
    and v_r1 ->> 'erro' = 'resposta_obrigatoria' and v_r1 ->> 'pergunta' = 'p9'
    and v_r2 ->> 'erro' = 'opcao_invalida'       and v_r2 ->> 'pergunta' = 'p9'
    and (v_r3 ->> 'ok')::boolean, false);

  perform pg_temp.r81('5 responder_formulario_publico recusa obrigatoria vazia e opcao invalida, e aceita a valida',
    ok, coalesce(det, format('obrigatoria=%s ;; opcao=%s ;; valida=%s',
      coalesce(v_r1::text,'-'), coalesce(v_r2::text,'-'), coalesce(v_r3::text,'-'))));
end $$;


-- ===========================================================================
-- 6. `publicar_roteiro_versao` é ATÔMICO: versão N+1, autoria carimbada, e
--    exatamente UMA ativa na chave depois de publicar com `p_ativar`.
-- ===========================================================================
do $$
declare
  v_admin uuid; v_naoadmin uuid;
  v_antes int; v_max_antes smallint; v_ativa_antes uuid;
  v_novo roteiros_versoes; v_ativas int; v_def jsonb;
  v_erro text := '(NAO RECUSOU)'; ok1 boolean := false;
  ok boolean := true; det text := null;
begin
  select id into v_admin    from perfis_equipe where papel = 'admin' and ativo order by criado_em limit 1;
  select id into v_naoadmin from perfis_equipe where papel <> 'admin' and ativo order by criado_em limit 1;
  if v_admin is null then
    perform pg_temp.r81('6 publicar_roteiro_versao atomico', false, 'nenhum admin ativo');
    return;
  end if;

  select count(*), coalesce(max(versao), 0) into v_antes, v_max_antes
    from roteiros_versoes where chave = 'sessao_viabilidade';
  select id into v_ativa_antes from roteiros_versoes where chave = 'sessao_viabilidade' and ativo;

  v_def := jsonb_build_object('blocos', jsonb_build_array(
    jsonb_build_object('id','b1','titulo','Bloco do roteiro 0081','falas','[]'::jsonb,
                       'campos','[]'::jsonb,'observar','[]'::jsonb,'proibido','[]'::jsonb)));

  begin
    -- autor não-admin é recusado mesmo sem sessão (a rota nunca chama assim,
    -- mas o PostgREST é a segunda porta)
    if v_naoadmin is not null then
      begin
        perform public.publicar_roteiro_versao('sessao_viabilidade', v_def, 'fixture 0081', false, null, v_naoadmin);
      exception when others then v_erro := sqlerrm; ok1 := position('sem_permissao' in sqlerrm) = 1;
      end;
    else
      ok1 := true; v_erro := '(sem perfil nao-admin ativo — caso pulado)';
    end if;

    v_novo := public.publicar_roteiro_versao('sessao_viabilidade', v_def, 'fixture 0081', true, 'roteiro 0081', v_admin);
    select count(*) into v_ativas from roteiros_versoes where chave = 'sessao_viabilidade' and ativo;

    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      ok := false; det := format('EXCECAO onde nao podia haver: %s %s', sqlstate, sqlerrm);
    end if;
  end;

  ok := coalesce(ok and ok1
    and v_novo.versao = v_max_antes + 1
    and v_novo.ativo
    and v_novo.criado_por = v_admin
    and v_novo.ativado_por = v_admin
    and v_novo.ativado_em is not null
    and v_ativas = 1, false);

  perform pg_temp.r81('6 publicar_roteiro_versao: N+1, autoria, e UMA ativa por chave na mesma transacao',
    ok, coalesce(det, format('nao-admin: %s ;; versao %s→%s ativo=%s criado_por=%s ativado_por=%s ativas=%s (antes: %s versoes, ativa %s)',
      left(v_erro, 90), v_max_antes, coalesce(v_novo.versao::text,'-'), coalesce(v_novo.ativo::text,'-'),
      coalesce((v_novo.criado_por = v_admin)::text,'-'), coalesce((v_novo.ativado_por = v_admin)::text,'-'),
      coalesce(v_ativas::text,'-'), v_antes, coalesce(v_ativa_antes::text,'(nenhuma)'))));
end $$;


-- ===========================================================================
-- 7. Teto de opções: 30 passa, 31 é recusado com `opcoes_demais`. E a maior
--    lista de opções JÁ GRAVADA no banco continua abaixo do teto — se não
--    estivesse, `ativar_formulario_versao` passaria a falhar com 23514 numa
--    versão legítima do histórico (o CHECK é `not valid`, mas revalida a linha
--    em qualquer UPDATE).
-- ===========================================================================
do $$
declare
  v_ok30 boolean := false; v_erro31 text := '(NAO RECUSOU)'; ok2 boolean := false;
  v_maior int; ok boolean;
  v_def30 jsonb; v_def31 jsonb;
begin
  select coalesce(max(n), 0) into v_maior
    from formularios f,
         lateral (select jsonb_array_length(p -> 'opcoes') as n
                    from jsonb_array_elements(f.definicao) p
                   where jsonb_typeof(p -> 'opcoes') = 'array') as t(n)
   where jsonb_typeof(f.definicao) = 'array';

  select jsonb_agg(jsonb_build_object('valor', 'v' || i, 'rotulo', 'Opcao ' || i)) into v_def30
    from generate_series(1, 30) i;
  select jsonb_agg(jsonb_build_object('valor', 'v' || i, 'rotulo', 'Opcao ' || i)) into v_def31
    from generate_series(1, 31) i;

  begin
    v_ok30 := app.definicao_formulario_valida(
      jsonb_build_array(jsonb_build_object('id','q1','bloco','b','tipo','unica','rotulo','x','opcoes', v_def30)), null);
  exception when others then v_ok30 := false;
  end;

  begin
    perform app.definicao_formulario_valida(
      jsonb_build_array(jsonb_build_object('id','q1','bloco','b','tipo','unica','rotulo','x','opcoes', v_def31)), null);
  exception when others then v_erro31 := sqlerrm; ok2 := position('opcoes_demais' in sqlerrm) = 1;
  end;

  ok := coalesce(v_ok30 and ok2 and v_maior <= 30, false);
  perform pg_temp.r81('7 teto de opcoes: 30 passa, 31 recusa, e nenhuma versao gravada estoura o teto',
    ok, format('30 ok=%s ;; 31: %s ;; maior lista gravada no banco = %s', v_ok30, left(v_erro31, 100), v_maior));
end $$;


-- ===========================================================================
-- 8. `anonimizar_titular` alcança o webhook que NUNCA casou com um pagamento.
--    É o `webhook_falho` da fila de pendências: sem `transacao_externa_id` a
--    varredura antiga não o via, e nome e e-mail do titular ficavam no `bruto`.
-- ===========================================================================
do $$
declare
  v_admin uuid; v_edicao uuid; v_pessoa uuid; v_sol titulares_solicitacoes;
  v_evento text; v_orfao jsonb; v_alheio jsonb;
  ok boolean := true; det text := null;
begin
  select id into v_admin  from perfis_equipe where papel = 'admin' and ativo order by criado_em limit 1;
  select id into v_edicao from edicoes_seminario order by criado_em limit 1;
  if v_admin is null then
    perform pg_temp.r81('8 anonimizar_titular alcanca webhook sem pagamento casado', false, 'nenhum admin ativo');
    return;
  end if;

  v_evento := 'verif0081-' || encode(gen_random_bytes(8), 'hex');

  begin
    insert into pessoas (nome, email, origem_dado)
    values ('Fixture Webhook 0081', 'webhook0081@example.com', 'real')
    returning id into v_pessoa;

    -- Webhook ÓRFÃO: sem transação casada, com o e-mail do titular no bruto.
    insert into webhooks_eventos (origem, evento_externo_id, tipo_evento, assinatura_valida, bruto)
    values ('hotmart', v_evento, 'PURCHASE_APPROVED', true,
            jsonb_build_object('buyer', jsonb_build_object('email', 'WEBHOOK0081@example.com',
                                                           'name', 'Fixture Webhook 0081')));

    -- Webhook de OUTRA pessoa: tem de ficar intacto (a varredura por texto não
    -- pode virar uma vassoura que leva o webhook do vizinho).
    insert into webhooks_eventos (origem, evento_externo_id, tipo_evento, assinatura_valida, bruto)
    values ('hotmart', v_evento || '-alheio', 'PURCHASE_APPROVED', true,
            jsonb_build_object('buyer', jsonb_build_object('email', 'outra.pessoa@example.com')))
    ;

    v_sol := public.anonimizar_titular(v_pessoa, 'pedido do titular, roteiro 0081',
      'Art. 18, VI — eliminacao', 'email', now() - interval '1 day', v_admin);

    select bruto into v_orfao  from webhooks_eventos where evento_externo_id = v_evento;
    select bruto into v_alheio from webhooks_eventos where evento_externo_id = v_evento || '-alheio';

    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      ok := false; det := format('EXCECAO onde nao podia haver: %s %s', sqlstate, sqlerrm);
    end if;
  end;

  ok := coalesce(ok
    and v_orfao = '{}'::jsonb                                   -- o órfão foi limpo (ilike, case-insensitive)
    and v_alheio -> 'buyer' ->> 'email' = 'outra.pessoa@example.com'  -- o do vizinho ficou
    and v_sol.id is not null, false);

  perform pg_temp.r81('8 webhook orfao (sem pagamento casado) e limpo pelo e-mail; o de outra pessoa fica',
    ok, coalesce(det, format('orfao=%s ;; alheio=%s ;; solicitacao=%s',
      coalesce(v_orfao::text,'-'), coalesce(v_alheio::text,'-'), coalesce(v_sol.id::text,'-'))));
end $$;


-- ===========================================================================
-- 9. Nada sobreviveu: contagens e o hash das definições de roteiro iguais aos
--    de antes. Se algum `rollback_proposital` não tivesse estourado, é aqui
--    que apareceria.
-- ===========================================================================
do $$
declare c record; v_p int; v_w int; v_f int; v_r int; v_rv int; v_s int; v_md5 text; ok boolean;
begin
  select * into c from contagem_0081;
  select count(*) into v_p  from pessoas;
  select count(*) into v_w  from webhooks_eventos;
  select count(*) into v_f  from formularios;
  select count(*) into v_r  from formularios_respostas;
  select count(*) into v_rv from roteiros_versoes;
  select count(*) into v_s  from titulares_solicitacoes;
  select md5(string_agg(definicao::text, '|' order by chave, versao)) into v_md5 from roteiros_versoes;

  ok := (v_p = c.pessoas and v_w = c.webhooks and v_f = c.formularios and v_r = c.respostas
         and v_rv = c.roteiros and v_s = c.solicitacoes and v_md5 is not distinct from c.md5_roteiros);
  perform pg_temp.r81('9 contagens intactas e definicoes de roteiro com o mesmo md5',
    ok, format('pessoas %s→%s · webhooks %s→%s · formularios %s→%s · respostas %s→%s · roteiros %s→%s · solicitacoes %s→%s · md5 %s→%s',
               c.pessoas, v_p, c.webhooks, v_w, c.formularios, v_f, c.respostas, v_r,
               c.roteiros, v_rv, c.solicitacoes, v_s,
               left(coalesce(c.md5_roteiros,'-'), 8), left(coalesce(v_md5,'-'), 8)));
end $$;


select * from resultado_0081 order by ordem;

-- Trava: qualquer passo em `ok = false` derruba o roteiro nomeando os passos.
do $$
declare v_falhas text;
begin
  select string_agg(passo || ' [' || coalesce(detalhe, '') || ']', ' ;; ' order by ordem)
    into v_falhas from resultado_0081 where not ok;
  if v_falhas is not null then
    raise exception 'verificacao_0081_falhou: %', v_falhas;
  end if;
end $$;
