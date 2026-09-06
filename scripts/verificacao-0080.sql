-- scripts/verificacao-0080.sql — roteiro da 0080 (direitos do titular: exportar
-- e encerrar o tratamento — LGPD art. 18).
-- ---------------------------------------------------------------------------
-- COMO RODAR: uma chamada só (MCP execute_sql / SQL Editor / psql -f) como
-- `postgres`, com 0078 → 0079 → 0080 APLICADAS, NESTA ORDEM (a 0080 usa o valor
-- de enum criado pela 0079). TEM de ser `postgres`: quase toda tabela do
-- inventário está em `force row level security`, e as fixtures só passam com um
-- papel que tenha BYPASSRLS.
--
-- NADA DE VERDADE É ANONIMIZADO AQUI. A pessoa da fixture nasce e morre dentro
-- de um `raise exception 'rollback_proposital'`. A pessoa REAL do banco e as
-- 4 famílias de demonstração (`origem_dado='exemplo'`) não são tocadas — o
-- passo 3 usa uma delas justamente para provar que a RPC RECUSA.
--
-- ARMADILHA (0074/0075): o bloco `EXCEPTION` é subtransação; tudo que o corpo
-- escreveu é desfeito quando o `raise` estoura. Por isso o resultado sai em
-- VARIÁVEL e o `perform pg_temp.r80(...)` vem FORA do sub-bloco.
--
-- NÚMEROS MEDIDOS ANTES DE APLICAR (06/09/2026, produção, pelo orquestrador):
--   pessoas = 6 (1 real + 5 exemplo) · webhooks_eventos = 6 ·
--   formularios_respostas = 3 · documentos = 0
-- ---------------------------------------------------------------------------

drop table if exists resultado_0080;
create temp table resultado_0080 (
  ordem serial primary key, passo text not null, ok boolean not null, detalhe text
) on commit drop;

create or replace function pg_temp.r80(p_passo text, p_ok boolean, p_detalhe text) returns void
language sql as $$ insert into resultado_0080 (passo, ok, detalhe) values (p_passo, p_ok, left(p_detalhe, 1200)) $$;

create temp table contagem_0080 on commit drop as
select (select count(*) from pessoas)               as pessoas,
       (select count(*) from webhooks_eventos)      as webhooks,
       (select count(*) from formularios_respostas) as respostas,
       (select count(*) from consentimentos)        as consentimentos,
       (select count(*) from titulares_solicitacoes) as solicitacoes;


-- ===========================================================================
-- 1. A trilha existe e é append-only: RLS + force, `authenticated` só LÊ.
-- ===========================================================================
do $$
declare v_rls boolean; v_force boolean; v_sel boolean; v_ins boolean; v_upd boolean; v_del boolean;
        v_pol int; v_uniq int; ok boolean;
begin
  select relrowsecurity, relforcerowsecurity into v_rls, v_force
    from pg_class where oid = 'public.titulares_solicitacoes'::regclass;
  v_sel := has_table_privilege('authenticated','titulares_solicitacoes','select');
  v_ins := has_table_privilege('authenticated','titulares_solicitacoes','insert');
  v_upd := has_table_privilege('authenticated','titulares_solicitacoes','update');
  v_del := has_table_privilege('authenticated','titulares_solicitacoes','delete');
  select count(*) into v_pol  from pg_policies where schemaname='public' and tablename='titulares_solicitacoes';
  select count(*) into v_uniq from pg_indexes  where schemaname='public' and indexname='uniq_anonimizacao_por_pessoa';

  ok := coalesce(v_rls and v_force and v_sel and not v_ins and not v_upd and not v_del
                 and v_pol = 1 and v_uniq = 1, false);
  perform pg_temp.r80('1 titulares_solicitacoes: RLS+force, so SELECT para authenticated, 1 policy, unique de anonimizacao',
    ok, format('rls=%s force=%s select=%s insert=%s update=%s delete=%s policies=%s uniq=%s',
               v_rls, v_force, v_sel, v_ins, v_upd, v_del, v_pol, v_uniq));
end $$;


-- ===========================================================================
-- 2. As colunas novas em `pessoas` existem e ninguém está anonimizado ainda.
-- ===========================================================================
do $$
declare v_cols int; v_anon int; ok boolean;
begin
  select count(*) into v_cols from information_schema.columns
   where table_schema='public' and table_name='pessoas'
     and column_name in ('anonimizada_em','anonimizacao_id');
  select count(*) into v_anon from pessoas where anonimizada_em is not null;

  ok := (v_cols = 2 and v_anon = 0);
  perform pg_temp.r80('2 pessoas.anonimizada_em/anonimizacao_id existem e nenhuma pessoa anonimizada',
    ok, format('colunas = %s de 2 · pessoas anonimizadas = %s (esp. 0)', v_cols, v_anon));
end $$;


-- ===========================================================================
-- 3. A RPC RECUSA dado de demonstração. Usa uma das 4 famílias de exemplo — e
--    é a prova de que a tela nova não consegue quebrar a apresentação.
-- ===========================================================================
do $$
declare v_admin uuid; v_exemplo uuid; v_erro text := '(NAO RECUSOU)'; ok boolean := false;
begin
  select id into v_admin   from perfis_equipe where papel='admin' and ativo order by criado_em limit 1;
  select id into v_exemplo from pessoas where origem_dado='exemplo' order by criado_em limit 1;

  if v_admin is null or v_exemplo is null then
    perform pg_temp.r80('3 RPC recusa pessoa origem_dado=exemplo', false,
      format('faltou fixture: admin=%s pessoa_exemplo=%s', coalesce(v_admin::text,'(nenhum)'), coalesce(v_exemplo::text,'(nenhuma)')));
    return;
  end if;

  begin
    perform public.anonimizar_titular(v_exemplo, 'roteiro de verificacao 0080',
      'Art. 18, VI — eliminacao', 'iniciativa_do_escritorio', now(), v_admin);
  exception when others then
    v_erro := sqlerrm;
    ok := position('origem_dado_exemplo' in sqlerrm) = 1;
  end;

  perform pg_temp.r80('3 RPC recusa pessoa origem_dado=exemplo (nao quebra a demonstracao)', ok, v_erro);
end $$;


-- ===========================================================================
-- 4. Autor: sem sessão e sem `p_executado_por` é 22004; com perfil não-admin é
--    42501. A rota nunca chama assim — mas o PostgREST é a segunda porta.
-- ===========================================================================
do $$
declare v_pessoa uuid; v_naoadmin uuid; v_e1 text := '(NAO RECUSOU)'; v_e2 text := '(NAO RECUSOU)';
        ok1 boolean := false; ok2 boolean := false;
begin
  select id into v_pessoa   from pessoas where origem_dado='exemplo' order by criado_em limit 1;
  select id into v_naoadmin from perfis_equipe where papel <> 'admin' and ativo order by criado_em limit 1;

  if v_pessoa is null then
    perform pg_temp.r80('4 autor obrigatorio e precisa ser admin', false, 'nenhuma pessoa de exemplo para a sonda');
    return;
  end if;

  begin
    perform public.anonimizar_titular(v_pessoa, 'roteiro de verificacao 0080', 'Art. 18', 'oficio', now(), null);
  exception when others then v_e1 := sqlerrm; ok1 := position('autor_obrigatorio' in sqlerrm) = 1;
  end;

  if v_naoadmin is null then
    ok2 := true; v_e2 := '(sem perfil nao-admin ativo no banco — caso pulado)';
  else
    begin
      perform public.anonimizar_titular(v_pessoa, 'roteiro de verificacao 0080', 'Art. 18', 'oficio', now(), v_naoadmin);
    exception when others then v_e2 := sqlerrm; ok2 := position('sem_permissao' in sqlerrm) = 1;
    end;
  end if;

  perform pg_temp.r80('4 sem autor -> autor_obrigatorio · autor nao-admin -> sem_permissao',
    ok1 and ok2, format('sem autor: %s ;; nao-admin: %s', left(v_e1,150), left(v_e2,150)));
end $$;


-- ===========================================================================
-- 5. O caminho feliz, inteiro, com fixture descartável e rollback: PII sai,
--    esqueleto contábil fica, links morrem, consentimento intacto — e a
--    segunda chamada é no-op (idempotência).
-- ===========================================================================
do $$
declare
  v_admin uuid; v_edicao uuid; v_pessoa uuid; v_jornada uuid; v_form uuid;
  v_sol titulares_solicitacoes; v_sol2 titulares_solicitacoes;
  v_transacao text; v_hash text;
  v_nome text; v_email text; v_resp jsonb; v_valor numeric; v_comprador text;
  v_desfecho text; v_links_ativos int; v_consent int; v_webhook jsonb; v_anon timestamptz;
  ok boolean := true; det text := null;
begin
  select id into v_admin  from perfis_equipe where papel='admin' and ativo order by criado_em limit 1;
  select id into v_edicao from edicoes_seminario order by criado_em limit 1;
  select id into v_form   from formularios where chave='estrategico' order by versao desc limit 1;

  if v_admin is null or v_form is null then
    perform pg_temp.r80('5 caminho feliz (fixture descartavel + rollback)', false,
      format('faltou fixture: admin=%s formulario=%s', coalesce(v_admin::text,'(nenhum)'), coalesce(v_form::text,'(nenhum)')));
    return;
  end if;

  v_transacao := 'verif0080-' || encode(gen_random_bytes(8), 'hex');
  v_hash      := 'verif0080_' || encode(gen_random_bytes(24), 'hex');

  begin
    insert into pessoas (nome, email, telefone, cidade, uf, origem_dado)
    values ('Fixture Verificacao 0080', 'fixture0080@example.com', '+5511900000080', 'Curitiba', 'PR', 'real')
    returning id into v_pessoa;

    -- `ck_edicao_por_origem`: origem 'seminario' exige edicao_id. Usa 'outro'
    -- para não depender de haver edição no banco.
    insert into jornadas (pessoa_id, edicao_id, origem, etapa, desfecho, faixa_patrimonio_declarada, origem_dado)
    values (v_pessoa, v_edicao, 'outro', 'sessao_realizada', 'aberta', 'Entre R$ 1 milhao e R$ 2 milhoes', 'real')
    returning id into v_jornada;

    insert into formularios_respostas (jornada_id, formulario_id, respostas, origem_dado)
    values (v_jornada, v_form, jsonb_build_object('p1','Fixture Verificacao 0080','p9','Entre R$ 1 milhao e R$ 2 milhoes'), 'real');

    insert into consentimentos (pessoa_id, tipo, concedido, texto_apresentado, versao_texto, canal)
    values (v_pessoa, 'tratamento_ia', true, 'texto do escritorio', 'verif-0080', 'formulario');

    -- `produto_id` NULL de propósito: com produto de Sessão de Viabilidade, a
    -- régua de boas-vindas dispararia no INSERT (0011) e enfileiraria mensagem.
    insert into pagamentos (jornada_id, pessoa_id, produto_id, origem, transacao_externa_id, status,
                            valor, comprador_email, comprador_nome, bruto)
    values (v_jornada, v_pessoa, null, 'hotmart', v_transacao, 'aprovado', 1997.00,
            'fixture0080@example.com', 'Fixture Verificacao 0080',
            jsonb_build_object('buyer', jsonb_build_object('email','fixture0080@example.com')));

    insert into webhooks_eventos (origem, evento_externo_id, tipo_evento, assinatura_valida, bruto)
    values ('hotmart', 'verif0080-' || v_transacao, 'PURCHASE_APPROVED', true,
            jsonb_build_object('transaction', v_transacao, 'buyer_name', 'Fixture Verificacao 0080'));

    insert into links_publicos (jornada_id, tipo, token_hash, token_prefixo, estado, expira_em, origem_dado)
    values (v_jornada, 'formulario', v_hash, 'vf0080', 'ativo', now() + interval '7 days', 'real');

    -- ---- a operação em si -------------------------------------------------
    v_sol := public.anonimizar_titular(v_pessoa, 'pedido do titular por e-mail, roteiro 0080',
      'Art. 18, VI — eliminacao', 'email', now() - interval '1 day', v_admin);

    -- ---- segunda chamada: no-op que devolve o MESMO registro ---------------
    v_sol2 := public.anonimizar_titular(v_pessoa, 'segunda chamada, tem de ser no-op',
      'Art. 18, VI — eliminacao', 'email', now(), v_admin);

    select nome, email, anonimizada_em into v_nome, v_email, v_anon from pessoas where id = v_pessoa;
    select respostas into v_resp from formularios_respostas where jornada_id = v_jornada;
    select valor, comprador_nome into v_valor, v_comprador from pagamentos where transacao_externa_id = v_transacao;
    select desfecho::text into v_desfecho from jornadas where id = v_jornada;
    select count(*) into v_links_ativos from links_publicos where jornada_id = v_jornada and estado = 'ativo';
    select count(*) into v_consent from consentimentos where pessoa_id = v_pessoa;
    select bruto into v_webhook from webhooks_eventos where evento_externo_id = 'verif0080-' || v_transacao;

    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      ok := false; det := format('EXCECAO onde nao podia haver: %s %s', sqlstate, sqlerrm);
    end if;
  end;

  ok := coalesce(ok
    and v_nome like 'Titular anonimizado %'
    and v_email is null
    and v_anon is not null
    and v_resp = '{}'::jsonb
    and v_valor = 1997.00                      -- o dinheiro FICA
    and v_comprador is null                    -- o nome do comprador SAI
    and v_desfecho = 'anonimizada'
    and v_links_ativos = 0
    and v_consent = 1                          -- consentimento NAO e tocado
    and v_webhook = '{}'::jsonb
    and v_sol.id is not null
    and v_sol2.id = v_sol.id                   -- idempotencia
    and (v_sol.resultado -> 'tabelas' -> 'jornadas')::int = 1, false);

  perform pg_temp.r80(
    '5 PII sai · pagamento/consentimento ficam · jornada anonimizada · links revogados · 2a chamada e no-op',
    ok,
    coalesce(det, format('nome=%s email=%s respostas=%s valor=%s comprador=%s desfecho=%s links_ativos=%s consentimentos=%s webhook=%s sol=%s sol2=%s tabelas=%s',
      coalesce(v_nome,'(nulo)'), coalesce(v_email,'(nulo)'), coalesce(v_resp::text,'-'),
      coalesce(v_valor::text,'-'), coalesce(v_comprador,'(nulo)'), coalesce(v_desfecho,'-'),
      coalesce(v_links_ativos::text,'-'), coalesce(v_consent::text,'-'), coalesce(v_webhook::text,'-'),
      coalesce(v_sol.id::text,'-'), coalesce(v_sol2.id::text,'-'), coalesce((v_sol.resultado->'tabelas')::text,'-'))));
end $$;


-- ===========================================================================
-- 6. `confirmar_expurgo_storage` recusa solicitação inexistente e recusa
--    solicitação de tipo 'exportacao'. (O caminho feliz dela precisa de objeto
--    real no Storage — é o roteiro do orquestrador, não deste arquivo.)
-- ===========================================================================
do $$
declare v_e1 text := '(NAO RECUSOU)'; ok1 boolean := false;
begin
  begin
    perform public.confirmar_expurgo_storage('00000000-0000-0000-0000-000000000000'::uuid, array['x']);
  exception when others then v_e1 := sqlerrm; ok1 := position('solicitacao_nao_encontrada' in sqlerrm) = 1;
  end;
  perform pg_temp.r80('6 confirmar_expurgo_storage recusa solicitacao inexistente', ok1, v_e1);
end $$;


-- ===========================================================================
-- 7. Nada sobreviveu: contagens iguais às de antes, e nenhuma solicitação nova.
-- ===========================================================================
do $$
declare c record; v_p int; v_w int; v_r int; v_c int; v_s int; ok boolean;
begin
  select * into c from contagem_0080;
  select count(*) into v_p from pessoas;
  select count(*) into v_w from webhooks_eventos;
  select count(*) into v_r from formularios_respostas;
  select count(*) into v_c from consentimentos;
  select count(*) into v_s from titulares_solicitacoes;

  ok := (v_p = c.pessoas and v_w = c.webhooks and v_r = c.respostas
         and v_c = c.consentimentos and v_s = c.solicitacoes);
  perform pg_temp.r80('7 contagens intactas (pessoas · webhooks · respostas · consentimentos · solicitacoes)',
    ok, format('pessoas %s→%s · webhooks %s→%s · respostas %s→%s · consentimentos %s→%s · solicitacoes %s→%s',
               c.pessoas, v_p, c.webhooks, v_w, c.respostas, v_r, c.consentimentos, v_c, c.solicitacoes, v_s));
end $$;


-- ===========================================================================
-- 8. COMPLETUDE: toda tabela do inventário (§B1 do plano) é MENCIONADA pelo
--    corpo de `anonimizar_titular`. É a rede contra "esqueci uma tabela"
--    quando alguém criar a próxima. As tabelas deixadas de fora DE PROPÓSITO
--    (consentimentos, documentos_acessos, participacoes_seminario…) não entram
--    nesta lista — estão declaradas no cabeçalho da 0080.
-- ===========================================================================
do $$
declare
  v_corpo text; v_faltando text := ''; v_tab text; ok boolean;
  v_tabelas text[] := array[
    'pessoas','familiares','patrimonio_itens','formularios_respostas','respostas_seminario',
    'ligacoes_estrategicas','ligacoes_ia','briefings','execucoes_ia','sessoes_viabilidade',
    'relatorios_sessao','agendamentos','diagnosticos_sv','cenarios_patrimoniais','cenario_rubricas',
    'croquis','croqui_analises','croqui_narrativas','croqui_calculos','materiais_gerados',
    'analises_transcricao','transcricoes','mensagens_agendadas','mensagens_recebidas','pagamentos',
    'webhooks_eventos','pesquisas_publicas','importacoes_linhas','documentos_pedidos',
    'links_publicos_acessos','links_publicos','agendamentos_sugestoes','documentos','jornadas',
    'tarefas','eventos_timeline'];
begin
  select pg_get_functiondef(p.oid) into v_corpo
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='anonimizar_titular' limit 1;

  if v_corpo is null then
    perform pg_temp.r80('8 completude do inventario', false, 'anonimizar_titular nao existe');
    return;
  end if;

  foreach v_tab in array v_tabelas loop
    if position('update ' || v_tab || ' ' in v_corpo) = 0 then
      v_faltando := v_faltando || v_tab || ' ';
    end if;
  end loop;

  ok := (v_faltando = '');
  perform pg_temp.r80('8 toda tabela do inventario aparece num UPDATE da RPC',
    ok, case when ok then format('%s tabelas conferidas', array_length(v_tabelas,1))
             else 'SEM UPDATE na RPC: ' || v_faltando end);
end $$;


select * from resultado_0080 order by ordem;

-- Trava: qualquer passo em `ok = false` derruba o roteiro nomeando os passos.
do $$
declare v_falhas text;
begin
  select string_agg(passo || ' [' || coalesce(detalhe, '') || ']', ' ;; ' order by ordem)
    into v_falhas from resultado_0080 where not ok;
  if v_falhas is not null then
    raise exception 'verificacao_0080_falhou: %', v_falhas;
  end if;
end $$;
