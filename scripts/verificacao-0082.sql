-- scripts/verificacao-0082.sql — roteiro da 0082 (`responder_formulario_publico`
-- avalia `condicional`).
-- ---------------------------------------------------------------------------
-- COMO RODAR: uma chamada só (MCP execute_sql / SQL Editor / psql -f) como
-- `postgres`, com 0078 → 0079 → 0080 → 0081 → 0082 APLICADAS, NESTA ORDEM. TEM
-- de ser `postgres`: as fixtures escrevem em `formularios`, `pessoas`,
-- `jornadas` e `links_publicos`, todas em `force row level security`.
--
-- NADA DE VERDADE É ALTERADO. Toda fixture nasce e morre dentro de um
-- `raise exception 'rollback_proposital'` — mesma armadilha da 0080/0081: o
-- bloco `EXCEPTION` é subtransação, tudo que o corpo escreveu é desfeito
-- quando o `raise` estoura, e por isso o RESULTADO sai em VARIÁVEL e o
-- `perform pg_temp.r82(...)` vem FORA do sub-bloco.
--
-- O QUE ESTE ROTEIRO PROVA (é o achado do Fable r3, critério "solidificação"):
-- a 0081 passou a cobrar `obrigatoria` e opção válida no servidor, mas cobrava
-- TODA pergunta — inclusive a que a `condicional` escondeu do cliente. A 0082
-- só cobra o que ele VIU, com a mesma regra de `perguntaPublicaVisivel`
-- (src/components/publico/CampoPerguntaPublico.tsx).
--
-- A fixture é a do §5 da verificacao-0081, com três perguntas condicionais a
-- mais: p11 (obrigatória, aparece por `contem`), p12 (escolha, aparece por
-- `contem`) e p13 (obrigatória, aparece por `igual`).
-- ---------------------------------------------------------------------------

drop table if exists resultado_0082;
create temp table resultado_0082 (
  ordem serial primary key, passo text not null, ok boolean not null, detalhe text
) on commit drop;

create or replace function pg_temp.r82(p_passo text, p_ok boolean, p_detalhe text) returns void
language sql as $$ insert into resultado_0082 (passo, ok, detalhe) values (p_passo, p_ok, left(p_detalhe, 1200)) $$;

create temp table contagem_0082 on commit drop as
select (select count(*) from pessoas)               as pessoas,
       (select count(*) from jornadas)              as jornadas,
       (select count(*) from links_publicos)        as links,
       (select count(*) from formularios)           as formularios,
       (select count(*) from formularios_respostas) as respostas,
       (select count(*) from consentimentos)        as consentimentos,
       (select md5(string_agg(definicao::text, '|' order by chave, versao)) from formularios) as md5_definicoes;


-- ===========================================================================
-- 1. SUPERFÍCIE: a função continua `security definer` com `search_path` preso,
--    `anon` executa (é a porta do link público) e `public` não. A 0082 não
--    mexe em grant nenhum — este passo é a prova de que não mexeu.
-- ===========================================================================
do $$
declare
  v_secdef boolean; v_config text[]; v_anon boolean; v_public boolean;
  v_auth boolean; ok boolean;
begin
  select p.prosecdef, p.proconfig into v_secdef, v_config
    from pg_proc p
   where p.oid = 'public.responder_formulario_publico(text, jsonb, jsonb, text, text)'::regprocedure;

  v_anon   := has_function_privilege('anon',          'public.responder_formulario_publico(text, jsonb, jsonb, text, text)', 'execute');
  v_auth   := has_function_privilege('authenticated', 'public.responder_formulario_publico(text, jsonb, jsonb, text, text)', 'execute');
  v_public := has_function_privilege('public',        'public.responder_formulario_publico(text, jsonb, jsonb, text, text)', 'execute');

  ok := coalesce(v_secdef, false)
        and coalesce(array_to_string(v_config, ',') like '%search_path=public, pg_temp%', false)
        and v_anon and not v_public;

  perform pg_temp.r82('1 superficie intacta: security definer, search_path preso, anon executa e public nao',
    ok, format('secdef=%s config=%s anon=%s authenticated=%s public=%s',
               v_secdef, coalesce(array_to_string(v_config, ','), '-'), v_anon, v_auth, v_public));
end $$;


-- ===========================================================================
-- 2. O CASO DO FABLE, nos seis cenários. Uma fixture só, quatro links: os três
--    envios que DÃO CERTO carimbam o link como 'usado' (`resolve_link_escrita`
--    só aceita 'ativo'), então cada um precisa do seu; os três que são
--    recusados deixam o link intacto e cabem no mesmo (limite do token são 10
--    por minuto).
--
--    Definição da fixture (as 4 perguntas de sistema + 3 condicionais):
--      p9  unica     Faixa de patrimonio            (ate_500k | acima_500k)
--      p10 multipla  O que voce tem                 (imoveis | empresas)
--      p11 texto     Quantos imoveis                OBRIGATORIA, aparece se p10 contem 'imoveis'
--      p12 unica     Tem socio                      (sim | nao), aparece se p10 contem 'empresas'
--      p13 texto     Nome do conjuge                OBRIGATORIA, aparece se p9 igual 'acima_500k'
--
--    Cenários:
--      A  condicional obrigatoria OCULTA (p11 e p13)            -> ACEITA
--      B  condicional obrigatoria VISIVEL e vazia (p11)         -> recusa resposta_obrigatoria p11
--      C  condicional VISIVEL com opcao invalida (p12='talvez') -> recusa opcao_invalida p12
--      D  condicional OCULTA com opcao invalida (p12='talvez')  -> ACEITA (pergunta oculta nao cobra nada)
--      E  ramo `igual`: p13 VISIVEL e vazia                     -> recusa resposta_obrigatoria p13
--      G  `contem` com resposta que NAO e lista (p10='imoveis') -> p11 OCULTA -> ACEITA
--
--    G é o cenário que separa o espelho do palpite: no cliente,
--    `Array.isArray(valorDependido) ? valorDependido : []` faz uma resposta em
--    texto esconder a pergunta filha. Um `@>` ingênuo no SQL a mostraria, e o
--    cliente receberia `resposta_obrigatoria` de uma pergunta invisível — que é
--    exatamente o beco sem saída que a 0082 fecha.
-- ===========================================================================
do $$
declare
  v_admin uuid; v_edicao uuid; v_pessoa uuid; v_jornada uuid; v_jornada_a uuid; v_jornada_d uuid; v_jornada_g uuid; v_form formularios;
  v_hash_a text; v_hash_d text; v_hash_g text; v_hash_x text;
  v_a jsonb; v_b jsonb; v_c jsonb; v_d jsonb; v_e jsonb; v_g jsonb;
  ok boolean := true; det text := null;
begin
  select id into v_admin  from perfis_equipe where papel = 'admin' and ativo order by criado_em limit 1;
  select id into v_edicao from edicoes_seminario order by criado_em limit 1;
  if v_admin is null then
    perform pg_temp.r82('2 condicional avaliada no servidor', false, 'nenhum admin ativo — fixture impossivel');
    return;
  end if;

  begin
    v_form := public.publicar_formulario_versao(
      'estrategico',
      jsonb_build_array(
        jsonb_build_object('id','p1','bloco','Identificacao','tipo','texto','rotulo','Nome completo'),
        jsonb_build_object('id','p2','bloco','Identificacao','tipo','texto','rotulo','Cidade'),
        jsonb_build_object('id','p9','bloco','Patrimonio','tipo','unica','rotulo','Faixa de patrimonio',
          'opcoes', jsonb_build_array(
            jsonb_build_object('valor','ate_500k','rotulo','Ate R$ 500 mil'),
            jsonb_build_object('valor','acima_500k','rotulo','Acima de R$ 500 mil'))),
        jsonb_build_object('id','p10','bloco','Patrimonio','tipo','multipla','rotulo','O que voce tem',
          'opcoes', jsonb_build_array(
            jsonb_build_object('valor','imoveis','rotulo','Imoveis'),
            jsonb_build_object('valor','empresas','rotulo','Empresas'))),
        jsonb_build_object('id','p11','bloco','Patrimonio','tipo','texto','rotulo','Quantos imoveis',
          'obrigatoria', true,
          'condicional', jsonb_build_object('depende_de','p10','contem','imoveis')),
        jsonb_build_object('id','p12','bloco','Patrimonio','tipo','unica','rotulo','Tem socio',
          'opcoes', jsonb_build_array(
            jsonb_build_object('valor','sim','rotulo','Sim'),
            jsonb_build_object('valor','nao','rotulo','Nao')),
          'condicional', jsonb_build_object('depende_de','p10','contem','empresas')),
        jsonb_build_object('id','p13','bloco','Familia','tipo','texto','rotulo','Nome do conjuge',
          'obrigatoria', true,
          'condicional', jsonb_build_object('depende_de','p9','igual','acima_500k')),
        jsonb_build_object('id','p16','bloco','Dor','tipo','texto_longo','rotulo','O que mais preocupa')),
      'fixture do roteiro 0082', 'nao publicar de verdade', true, v_admin);

    -- 4 pessoas/jornadas: `uniq_link_ativo` permite UM link ativo por (jornada, tipo) e
    -- `uniq_jornada_aberta_por_pessoa` permite UMA jornada aberta por pessoa.
    insert into pessoas (nome, origem_dado) values ('Fixture Publico 0082 x', 'real') returning id into v_pessoa;
    insert into jornadas (pessoa_id, edicao_id, origem, etapa, desfecho, origem_dado)
    values (v_pessoa, v_edicao, 'outro', 'captado', 'aberta', 'real') returning id into v_jornada;
    insert into pessoas (nome, origem_dado) values ('Fixture Publico 0082 a', 'real') returning id into v_pessoa;
    insert into jornadas (pessoa_id, edicao_id, origem, etapa, desfecho, origem_dado)
    values (v_pessoa, v_edicao, 'outro', 'captado', 'aberta', 'real') returning id into v_jornada_a;
    insert into pessoas (nome, origem_dado) values ('Fixture Publico 0082 d', 'real') returning id into v_pessoa;
    insert into jornadas (pessoa_id, edicao_id, origem, etapa, desfecho, origem_dado)
    values (v_pessoa, v_edicao, 'outro', 'captado', 'aberta', 'real') returning id into v_jornada_d;
    insert into pessoas (nome, origem_dado) values ('Fixture Publico 0082 g', 'real') returning id into v_pessoa;
    insert into jornadas (pessoa_id, edicao_id, origem, etapa, desfecho, origem_dado)
    values (v_pessoa, v_edicao, 'outro', 'captado', 'aberta', 'real') returning id into v_jornada_g;

    -- `app.resolve_link_escrita` compara `p_hash` com `token_hash` DIRETO (o
    -- hash é calculado no Node, não no banco): o valor gravado aqui é o mesmo
    -- que a RPC recebe.
    v_hash_a := 'verif0082a_' || encode(gen_random_bytes(24), 'hex');
    v_hash_d := 'verif0082d_' || encode(gen_random_bytes(24), 'hex');
    v_hash_g := 'verif0082g_' || encode(gen_random_bytes(24), 'hex');
    v_hash_x := 'verif0082x_' || encode(gen_random_bytes(24), 'hex');
    insert into links_publicos (jornada_id, tipo, token_hash, token_prefixo, estado, expira_em, origem_dado)
    values (v_jornada_a, 'formulario', v_hash_a, 'vf82a', 'ativo', now() + interval '7 days', 'real'),
           (v_jornada_d, 'formulario', v_hash_d, 'vf82d', 'ativo', now() + interval '7 days', 'real'),
           (v_jornada_g, 'formulario', v_hash_g, 'vf82g', 'ativo', now() + interval '7 days', 'real'),
           (v_jornada,   'formulario', v_hash_x, 'vf82x', 'ativo', now() + interval '7 days', 'real');

    -- (B) p11 VISIVEL (p10 contem 'imoveis') e sem resposta -> recusa.
    v_b := public.responder_formulario_publico(v_hash_x,
      jsonb_build_object('p1','Fulano','p9','ate_500k','p10', jsonb_build_array('imoveis')),
      '[]'::jsonb, null, null);

    -- (C) p12 VISIVEL (p10 contem 'empresas') com opcao fora da definicao -> recusa.
    v_c := public.responder_formulario_publico(v_hash_x,
      jsonb_build_object('p1','Fulano','p9','ate_500k','p10', jsonb_build_array('empresas'),'p12','talvez'),
      '[]'::jsonb, null, null);

    -- (E) ramo `igual`: p9 = 'acima_500k' torna p13 VISIVEL, e ela esta vazia -> recusa.
    v_e := public.responder_formulario_publico(v_hash_x,
      jsonb_build_object('p1','Fulano','p9','acima_500k','p10', jsonb_build_array('empresas'),'p12','sim'),
      '[]'::jsonb, null, null);

    -- (A) p11 e p13 OCULTAS (p10 sem 'imoveis', p9 <> 'acima_500k') -> ACEITA.
    v_a := public.responder_formulario_publico(v_hash_a,
      jsonb_build_object('p1','Fulano','p9','ate_500k','p10', jsonb_build_array('empresas'),'p12','sim'),
      '[]'::jsonb, null, null);

    -- (D) p12 OCULTA com valor invalido guardado (o cliente respondeu e depois
    --     mudou p10): pergunta invisivel nao cobra nem opcao -> ACEITA, e o
    --     valor entra em `formularios_respostas` como veio.
    v_d := public.responder_formulario_publico(v_hash_d,
      jsonb_build_object('p1','Fulano','p9','ate_500k','p10', jsonb_build_array('imoveis'),'p11','3','p12','talvez'),
      '[]'::jsonb, null, null);

    -- (G) `contem` sobre resposta que NAO e lista: p11 fica OCULTA -> ACEITA.
    v_g := public.responder_formulario_publico(v_hash_g,
      jsonb_build_object('p1','Fulano','p9','ate_500k','p10','imoveis'),
      '[]'::jsonb, null, null);

    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      ok := false; det := format('EXCECAO onde nao podia haver: %s %s', sqlstate, sqlerrm);
    end if;
  end;

  ok := coalesce(ok
    and (v_a ->> 'ok')::boolean
    and v_b ->> 'erro' = 'resposta_obrigatoria' and v_b ->> 'pergunta' = 'p11'
    and v_c ->> 'erro' = 'opcao_invalida'       and v_c ->> 'pergunta' = 'p12'
    and (v_d ->> 'ok')::boolean
    and v_e ->> 'erro' = 'resposta_obrigatoria' and v_e ->> 'pergunta' = 'p13'
    and (v_g ->> 'ok')::boolean, false);

  perform pg_temp.r82(
    '2 condicional avaliada: obrigatoria oculta aceita, visivel vazia recusa, opcao invalida so cobra na visivel',
    ok, coalesce(det, format('A(oculta)=%s ;; B(visivel vazia)=%s ;; C(opcao visivel)=%s ;; D(opcao oculta)=%s ;; E(igual visivel)=%s ;; G(contem sem lista)=%s',
      coalesce(v_a::text,'-'), coalesce(v_b::text,'-'), coalesce(v_c::text,'-'),
      coalesce(v_d::text,'-'), coalesce(v_e::text,'-'), coalesce(v_g::text,'-'))));
end $$;


-- ===========================================================================
-- 3. O QUE JÁ ESTÁ PUBLICADO CONTINUA VALENDO. A 0082 não muda a validação da
--    definição — mas se a versão ATIVA de hoje tiver pergunta condicional
--    marcada obrigatória, é ela que o aviso novo do editor
--    (`FormulariosRoteirosAba.tsx`) explica. Este passo MEDE: informa o número
--    e só reprova se a definição ativa estiver ilegível.
-- ===========================================================================
do $$
declare v_total int; v_condicionais int; v_cond_obrig int; ok boolean;
begin
  select count(*) filter (where true),
         count(*) filter (where q -> 'condicional' is not null),
         count(*) filter (where q -> 'condicional' is not null and (q -> 'obrigatoria') = 'true'::jsonb)
    into v_total, v_condicionais, v_cond_obrig
    from formularios f,
         lateral jsonb_array_elements(coalesce(f.definicao, '[]'::jsonb)) q
   where f.chave = 'estrategico' and f.ativo;

  ok := v_total > 0;
  perform pg_temp.r82('3 definicao ativa legivel (medida, nao alterada)',
    ok, format('perguntas=%s condicionais=%s condicionais obrigatorias=%s', v_total, v_condicionais, v_cond_obrig));
end $$;


-- ===========================================================================
-- 4. Nada sobreviveu: contagens e o hash das definições de formulário iguais
--    aos de antes. Se algum `rollback_proposital` não tivesse estourado, é
--    aqui que apareceria — inclusive a versão de fixture publicada no passo 2.
-- ===========================================================================
do $$
declare c record; v_p int; v_j int; v_l int; v_f int; v_r int; v_c int; v_md5 text; ok boolean;
begin
  select * into c from contagem_0082;
  select count(*) into v_p from pessoas;
  select count(*) into v_j from jornadas;
  select count(*) into v_l from links_publicos;
  select count(*) into v_f from formularios;
  select count(*) into v_r from formularios_respostas;
  select count(*) into v_c from consentimentos;
  select md5(string_agg(definicao::text, '|' order by chave, versao)) into v_md5 from formularios;

  ok := (v_p = c.pessoas and v_j = c.jornadas and v_l = c.links and v_f = c.formularios
         and v_r = c.respostas and v_c = c.consentimentos
         and v_md5 is not distinct from c.md5_definicoes);
  perform pg_temp.r82('4 contagens intactas e definicoes de formulario com o mesmo md5',
    ok, format('pessoas %s→%s · jornadas %s→%s · links %s→%s · formularios %s→%s · respostas %s→%s · consentimentos %s→%s · md5 %s→%s',
               c.pessoas, v_p, c.jornadas, v_j, c.links, v_l, c.formularios, v_f,
               c.respostas, v_r, c.consentimentos, v_c,
               left(coalesce(c.md5_definicoes,'-'), 8), left(coalesce(v_md5,'-'), 8)));
end $$;


select * from resultado_0082 order by ordem;

-- Trava: qualquer passo em `ok = false` derruba o roteiro nomeando os passos.
do $$
declare v_falhas text;
begin
  select string_agg(passo || ' [' || coalesce(detalhe, '') || ']', ' ;; ' order by ordem)
    into v_falhas from resultado_0082 where not ok;
  if v_falhas is not null then
    raise exception 'verificacao_0082_falhou: %', v_falhas;
  end if;
end $$;
