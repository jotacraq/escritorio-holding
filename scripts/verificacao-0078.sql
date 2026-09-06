-- scripts/verificacao-0078.sql — roteiro da 0078 (Formulário Estratégico
-- versionado: autoria, validação no banco e publicação atômica).
-- ---------------------------------------------------------------------------
-- COMO RODAR: uma chamada só (MCP execute_sql / SQL Editor / psql -f) como
-- `postgres`, com a 0078 APLICADA. TEM de ser `postgres`: `formularios` está em
-- `force row level security` e as fixtures dos passos 4 e 5 só passam com um
-- papel que tenha BYPASSRLS. Rodando com outro papel, esses passos falham com
-- 42501 no detalhe — é falha de papel, não da migration.
--
-- Devolve `resultado_0078` (ordem, passo, ok, detalhe) e, se QUALQUER passo
-- falhar, levanta exceção nomeando os passos — o roteiro é trava, não
-- relatório. Idempotente; nenhuma fixture sobrevive.
--
-- Molde: `scripts/verificacao-0075.sql`, inclusive a ARMADILHA: em PL/pgSQL o
-- bloco `EXCEPTION` é subtransação, então tudo que o corpo escreveu é desfeito
-- quando o `raise 'rollback_proposital'` estoura. Por isso o padrão é
-- sub-bloco alimentando VARIÁVEIS locais e `perform pg_temp.r78(...)` FORA dele.
--
-- NÚMEROS MEDIDOS ANTES DE APLICAR (06/09/2026, produção, pelo orquestrador):
--   formularios = 1 (chave 'estrategico', versao 2, ativa)
--   formularios_respostas = 3 · roteiros_versoes = 6
--   md5(string_agg(definicao::text, '|' order by chave, versao)) = 266c5fb099d9c4490b39459937e11a53
-- Se a sua medição foi outra, ajuste a tabela `esperado_0078` ANTES de rodar —
-- número decorado é pior do que número nenhum.
-- ---------------------------------------------------------------------------

drop table if exists resultado_0078;
create temp table resultado_0078 (
  ordem serial primary key, passo text not null, ok boolean not null, detalhe text
) on commit drop;

create or replace function pg_temp.r78(p_passo text, p_ok boolean, p_detalhe text) returns void
language sql as $$ insert into resultado_0078 (passo, ok, detalhe) values (p_passo, p_ok, left(p_detalhe, 900)) $$;

-- Os números medidos ANTES de aplicar. Literais (nada de `\set`: este roteiro
-- roda também por MCP/SQL Editor, que não têm as variáveis do psql). Se a sua
-- medição foi outra, mude AQUI antes de rodar.
create temp table esperado_0078 on commit drop as
select 1 as formularios,
       3 as respostas,
       6 as roteiros,
       '266c5fb099d9c4490b39459937e11a53'::text as md5_definicoes;


-- ===========================================================================
-- 1. As colunas novas existem (5 em formularios, 2 em roteiros_versoes).
-- ===========================================================================
do $$
declare v_form int; v_rot int; ok boolean; det text;
begin
  select count(*) into v_form from information_schema.columns
   where table_schema = 'public' and table_name = 'formularios'
     and column_name in ('titulo','notas','criado_por','ativado_por','ativado_em');
  select count(*) into v_rot from information_schema.columns
   where table_schema = 'public' and table_name = 'roteiros_versoes'
     and column_name in ('ativado_por','ativado_em');

  ok  := (v_form = 5 and v_rot = 2);
  det := format('formularios: %s de 5 colunas · roteiros_versoes: %s de 2', v_form, v_rot);
  perform pg_temp.r78('1 colunas de autoria criadas (formularios + roteiros_versoes)', ok, det);
end $$;


-- ===========================================================================
-- 2. Nenhuma linha de cliente mudou de valor. Contagens e o md5 das definições
--    conferidos contra a medição feita ANTES de aplicar.
-- ===========================================================================
do $$
declare v_f int; v_r int; v_rot int; v_md5 text; e record; ok boolean; det text;
begin
  select * into e from esperado_0078;
  select count(*) into v_f   from formularios;
  select count(*) into v_r   from formularios_respostas;
  select count(*) into v_rot from roteiros_versoes;
  select md5(string_agg(definicao::text, '|' order by chave, versao)) into v_md5 from formularios;

  ok  := (v_f = e.formularios and v_r = e.respostas and v_rot = e.roteiros and v_md5 = e.md5_definicoes);
  det := format('formularios %s (esp. %s) · respostas %s (esp. %s) · roteiros %s (esp. %s) · md5 %s (esp. %s)',
                v_f, e.formularios, v_r, e.respostas, v_rot, e.roteiros,
                coalesce(v_md5, '(nulo)'), e.md5_definicoes);
  perform pg_temp.r78('2 contagens e md5 das definicoes intactos (zero backfill)', ok, det);
end $$;


-- ===========================================================================
-- 3. A `not valid` não está escondendo lixo: a função ACEITA cada definição já
--    gravada da chave 'estrategico'? Isto é INFORMAÇÃO, não regressão — versão
--    antiga reprovada é histórico legítimo (o plano previu: `p14` com "Outro"
--    sem par condicional). O passo só falha se a função EXPLODIR de um jeito
--    inesperado (erro que não seja 22023).
-- ===========================================================================
do $$
declare v_linha record; v_res text := ''; ok boolean := true; v_estado text;
begin
  for v_linha in select id, chave, versao, definicao from formularios where chave = 'estrategico' order by versao loop
    begin
      perform app.definicao_formulario_valida(v_linha.definicao, v_linha.chave);
      v_res := v_res || format('v%s=aceita ', v_linha.versao);
    exception when others then
      get stacked diagnostics v_estado = returned_sqlstate;
      v_res := v_res || format('v%s=REPROVA(%s: %s) ', v_linha.versao, v_estado, left(sqlerrm, 120));
      if v_estado <> '22023' then ok := false; end if;
    end;
  end loop;
  if v_res = '' then v_res := '(nenhuma versao da chave estrategico no banco)'; end if;
  perform pg_temp.r78('3 versoes ja gravadas passam pela validacao (ou reprovam so com 22023 legivel)', ok, v_res);
end $$;


-- ===========================================================================
-- 4. A RPC RECUSA definição inválida — cinco casos, cada um com o código de
--    erro nomeado. Sem sessão (postgres), `p_criado_por` é obrigatório: usa o
--    primeiro admin ativo. Tudo dentro de sub-bloco; nada é gravado.
-- ===========================================================================
do $$
declare
  v_admin uuid; v_base jsonb; v_res text := ''; ok boolean := true;
  v_caso record; v_erro text;
begin
  select id into v_admin from perfis_equipe where papel = 'admin' and ativo order by criado_em limit 1;
  if v_admin is null then
    perform pg_temp.r78('4 RPC recusa definicao invalida (5 casos)', false,
      'nenhum perfil admin ativo em perfis_equipe — sem autor nao da para chamar a RPC sem sessao');
    return;
  end if;

  -- Definição mínima VÁLIDA da chave 'estrategico' (tem p1, p2, p9 e p16).
  v_base := jsonb_build_array(
    jsonb_build_object('id','p1','bloco','Identificação','tipo','texto','rotulo','Nome completo'),
    jsonb_build_object('id','p2','bloco','Identificação','tipo','texto','rotulo','Cidade'),
    jsonb_build_object('id','p9','bloco','Patrimônio','tipo','unica','rotulo','Faixa de patrimônio',
      'opcoes', jsonb_build_array(jsonb_build_object('valor','ate_500k','rotulo','Até R$ 500 mil'),
                                  jsonb_build_object('valor','acima_500k','rotulo','Acima de R$ 500 mil'))),
    jsonb_build_object('id','p16','bloco','Dor','tipo','texto_longo','rotulo','O que mais preocupa?')
  );

  for v_caso in
    select * from (values
      -- (rotulo do caso, definicao, prefixo esperado do erro)
      ('sem p9',
       jsonb_build_array(
         jsonb_build_object('id','p1','bloco','B','tipo','texto','rotulo','Nome'),
         jsonb_build_object('id','p2','bloco','B','tipo','texto','rotulo','Cidade'),
         jsonb_build_object('id','p16','bloco','B','tipo','texto','rotulo','Dor')),
       'pergunta_de_sistema_removida'),
      ('opcao duplicada',
       v_base || jsonb_build_array(jsonb_build_object('id','p20','bloco','B','tipo','unica','rotulo','X',
         'opcoes', jsonb_build_array(jsonb_build_object('valor','a','rotulo','A'),
                                     jsonb_build_object('valor','a','rotulo','A de novo')))),
       'valor_opcao_duplicado'),
      ('unica com 1 opcao',
       v_base || jsonb_build_array(jsonb_build_object('id','p21','bloco','B','tipo','unica','rotulo','X',
         'opcoes', jsonb_build_array(jsonb_build_object('valor','a','rotulo','A')))),
       'opcoes_insuficientes'),
      ('condicional apontando adiante',
       v_base || jsonb_build_array(jsonb_build_object('id','p22','bloco','B','tipo','texto','rotulo','X',
         'condicional', jsonb_build_object('depende_de','p99','igual','sim'))),
       'condicional_adiante'),
      ('contem sobre pergunta unica',
       v_base || jsonb_build_array(jsonb_build_object('id','p23','bloco','B','tipo','texto','rotulo','X',
         'condicional', jsonb_build_object('depende_de','p9','contem','ate_500k'))),
       'condicional_contem')
    ) as t(rotulo, definicao, esperado)
  loop
    begin
      perform public.publicar_formulario_versao('estrategico', v_caso.definicao, null, null, false, v_admin);
      v_erro := '(NAO RECUSOU)';
      ok := false;
    exception when others then
      v_erro := sqlerrm;
      if position(v_caso.esperado in sqlerrm) <> 1 then ok := false; end if;
    end;
    v_res := v_res || format('%s -> %s ;; ', v_caso.rotulo, left(v_erro, 90));
  end loop;

  perform pg_temp.r78('4 RPC recusa: sem p9 · opcao duplicada · unica com 1 opcao · condicional adiante · contem sobre unica',
                      ok, v_res);
end $$;


-- ===========================================================================
-- 5. ATOMICIDADE: publicar com `p_ativar = true` desativa a anterior e insere a
--    nova na MESMA transação — a chave nunca fica sem versão ativa (o bug real
--    de `POST /api/formularios` antes da 0078). Tudo desfeito no fim.
-- ===========================================================================
do $$
declare
  v_admin uuid; v_def jsonb; v_nova formularios; v_ativas int; v_versao_esperada int;
  ok boolean := true; det text := null;
begin
  select id into v_admin from perfis_equipe where papel = 'admin' and ativo order by criado_em limit 1;
  if v_admin is null then
    perform pg_temp.r78('5 publicacao atomica (versao N+1 + uma ativa so)', false, 'nenhum perfil admin ativo');
    return;
  end if;

  select coalesce(max(versao), 0) + 1 into v_versao_esperada from formularios where chave = 'estrategico';

  v_def := jsonb_build_array(
    jsonb_build_object('id','p1','bloco','Identificação','tipo','texto','rotulo','Nome completo'),
    jsonb_build_object('id','p2','bloco','Identificação','tipo','texto','rotulo','Cidade'),
    jsonb_build_object('id','p9','bloco','Patrimônio','tipo','unica','rotulo','Faixa de patrimônio',
      'opcoes', jsonb_build_array(jsonb_build_object('valor','ate_500k','rotulo','Até R$ 500 mil'),
                                  jsonb_build_object('valor','acima_500k','rotulo','Acima de R$ 500 mil'))),
    jsonb_build_object('id','p16','bloco','Dor','tipo','texto_longo','rotulo','O que mais preocupa?'),
    jsonb_build_object('id','p17','bloco','Dor','tipo','texto','rotulo','Detalhe',
      'condicional', jsonb_build_object('depende_de','p9','igual','ate_500k'))
  );

  begin
    v_nova := public.publicar_formulario_versao('estrategico', v_def, 'verificacao 0078', 'fixture', true, v_admin);
    select count(*) into v_ativas from formularios where chave = 'estrategico' and ativo;
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      ok := false; det := format('EXCECAO onde nao podia haver: %s %s', sqlstate, sqlerrm);
    end if;
  end;

  ok := coalesce(ok and v_ativas = 1 and v_nova.versao = v_versao_esperada
                 and v_nova.criado_por = v_admin and v_nova.ativado_por = v_admin
                 and v_nova.ativado_em is not null, false);

  perform pg_temp.r78('5 publicacao atomica: versao N+1, uma ativa so, autoria carimbada',
    ok, coalesce(det, format('versao gravada = %s (esp. %s) · ativas depois = %s (esp. 1) · criado_por = %s · ativado_em = %s',
                             coalesce(v_nova.versao::text,'-'), v_versao_esperada, coalesce(v_ativas::text,'-'),
                             coalesce(v_nova.criado_por::text,'(nulo)'), coalesce(v_nova.ativado_em::text,'(nulo)'))));
end $$;


-- ===========================================================================
-- 6. Escrita direta em `formularios` deixou de existir para `authenticated`
--    (revoke + policy `form_wr` derrubada) — a RPC é a única porta.
-- ===========================================================================
do $$
declare v_ins boolean; v_upd boolean; v_del boolean; v_sel boolean; v_pol int; ok boolean;
begin
  v_ins := has_table_privilege('authenticated','formularios','insert');
  v_upd := has_table_privilege('authenticated','formularios','update');
  v_del := has_table_privilege('authenticated','formularios','delete');
  v_sel := has_table_privilege('authenticated','formularios','select');
  select count(*) into v_pol from pg_policies where schemaname='public' and tablename='formularios' and policyname='form_wr';

  ok := (not v_ins and not v_upd and not v_del and v_sel and v_pol = 0);
  perform pg_temp.r78('6 authenticated so LE formularios (insert/update/delete revogados, form_wr removida)',
    ok, format('insert=%s update=%s delete=%s select=%s · policy form_wr = %s', v_ins, v_upd, v_del, v_sel, v_pol));
end $$;


-- ===========================================================================
-- 7. Catálogo das funções novas: uma assinatura cada, definer onde deve,
--    `search_path` fixo, e EXECUTE fora do alcance de `anon`.
-- ===========================================================================
do $$
declare
  v_pub_n int; v_pub_def boolean; v_pub_path text[]; v_pub_anon boolean; v_pub_auth boolean; v_pub_oid oid;
  v_at_n int;  v_at_def boolean;  v_at_anon boolean; v_at_oid oid;
  v_val_n int; v_val_anon boolean; v_val_oid oid;
  ok boolean;
begin
  select count(*), bool_and(p.prosecdef), max(p.proconfig), max(p.oid)
    into v_pub_n, v_pub_def, v_pub_path, v_pub_oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='publicar_formulario_versao';

  select count(*), bool_and(p.prosecdef), max(p.oid) into v_at_n, v_at_def, v_at_oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='ativar_formulario_versao';

  select count(*), max(p.oid) into v_val_n, v_val_oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='app' and p.proname='definicao_formulario_valida';

  if v_pub_n = 1 then
    v_pub_anon := has_function_privilege('anon', v_pub_oid, 'EXECUTE');
    v_pub_auth := has_function_privilege('authenticated', v_pub_oid, 'EXECUTE');
  end if;
  if v_at_n  = 1 then v_at_anon  := has_function_privilege('anon', v_at_oid,  'EXECUTE'); end if;
  if v_val_n = 1 then v_val_anon := has_function_privilege('anon', v_val_oid, 'EXECUTE'); end if;

  ok := coalesce(v_pub_n = 1 and v_at_n = 1 and v_val_n = 1
    and v_pub_def and v_at_def
    and v_pub_path @> array['search_path=public, pg_temp']
    and v_pub_auth and not v_pub_anon and not v_at_anon and not v_val_anon, false);

  perform pg_temp.r78('7 catalogo: 1 assinatura cada, definer, search_path fixo, anon sem EXECUTE',
    ok, format('publicar: n=%s definer=%s path=%s anon=%s auth=%s · ativar: n=%s definer=%s anon=%s · validar: n=%s anon=%s',
               v_pub_n, v_pub_def, v_pub_path, v_pub_anon, v_pub_auth, v_at_n, v_at_def, v_at_anon, v_val_n, v_val_anon));
end $$;


select * from resultado_0078 order by ordem;

-- Trava: qualquer passo em `ok = false` derruba o roteiro nomeando os passos.
do $$
declare v_falhas text;
begin
  select string_agg(passo || ' [' || coalesce(detalhe, '') || ']', ' ;; ' order by ordem)
    into v_falhas from resultado_0078 where not ok;
  if v_falhas is not null then
    raise exception 'verificacao_0078_falhou: %', v_falhas;
  end if;
end $$;
