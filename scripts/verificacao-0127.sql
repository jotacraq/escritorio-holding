-- scripts/verificacao-0127.sql — roteiro da ANONIMIZAÇÃO DO COPILOTO (0127).
-- Achado F1 do `security-pentester` na Fase 13 (19/09/2026), severidade ALTA.
-- Escopo ampliado por decisão do João: a FAMÍLIA INTEIRA do copiloto.
-- ---------------------------------------------------------------------------
-- 🔴 LEIA ANTES DE RODAR: anonimização é IRREVERSÍVEL. Este roteiro exercita
-- o ciclo COMPLETO (titular real fabricado → dado do copiloto → anonimizar →
-- conferir) e desfaz tudo com `raise exception 'rollback_proposital'`. Cada
-- bloco que escreve vive num sub-`begin … exception … end`; o INSERT no
-- resultado acontece FORA dele. NENHUMA linha sobrevive.
--
-- ⚠️ `anonimizar_titular` RECUSA `origem_dado = 'exemplo'` (trava da 0080:
-- "dado de demonstração não é titular"). Por isso as pessoas deste roteiro
-- nascem com `origem_dado = 'real'` — o que torna o rollback OBRIGATÓRIO, não
-- opcional: são linhas que a trava de exemplo não protegeria.
--
-- COMO RODAR: uma chamada só, como `postgres`, com 0014 a 0127 aplicadas.
-- A última instrução devolve `resultado_0127`. `ok = true` em TODAS é a
-- condição para aplicar a 0127 em produção.
--
-- O QUE ESTE ROTEIRO PROVA
--   0  a função existe em `public` (NÃO em `app`) com a assinatura vigente
--   1  a função menciona as 4 tabelas do copiloto (o furo do F1 fechado)
--   2  🔴 CICLO COMPLETO: titular com retrospecto + sugestões + segmentos +
--      ficha + inventário → anonimizar → NENHUMA citação literal sobrou
--   3  🔴 a CONTAGEM devolvida inclui as 4 tabelas novas
--   4  🔴 NÃO-REGRESSÃO: a contagem continua trazendo as chaves ANTIGAS —
--      a prova de que o `create or replace` não comeu nenhuma das 36 tabelas
--   5  idempotência: anonimizar 2× não explode e não duplica solicitação
--   6  `INVENTARIO_TITULAR` (TypeScript) e a função concordam sobre as 4
-- ---------------------------------------------------------------------------

drop table if exists resultado_0127;
create temp table resultado_0127 (
  ordem serial primary key, passo text not null, ok boolean not null, detalhe text
) on commit drop;

create or replace function pg_temp.r127(p_passo text, p_ok boolean, p_detalhe text) returns void
language sql as $$ insert into resultado_0127 (passo, ok, detalhe) values (p_passo, p_ok, left(p_detalhe, 900)) $$;

-- As 4 tabelas que o João mandou entrar.
create or replace function pg_temp.tabelas_copiloto() returns text[]
language sql immutable as $$ select array['sessoes_copiloto','sessoes_copiloto_segmentos','copiloto_sugestoes','copiloto_retrospectos'] $$;


-- ===========================================================================
-- 0 · A função existe em `public`, e SÓ lá.
--
-- 🔴 O relatório do pentester escreveu `app.anonimizar_titular`. Não existe
-- nada com esse nome no schema `app` — a real é `public.anonimizar_titular`.
-- Recriar em `app` produziria uma função NOVA que ninguém chama, enquanto a
-- real seguiria sem tocar o copiloto: o furo aberto com a migration
-- "aplicada". É a armadilha de sobrecarga/recriação já catalogada aqui, e
-- este passo existe para ela nunca mais passar.
-- ===========================================================================
do $$
declare v_public int; v_app int; v_args text;
begin
  select count(*) into v_public from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'anonimizar_titular';
  select count(*) into v_app from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'anonimizar_titular';
  select pg_get_function_identity_arguments(p.oid) into v_args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'anonimizar_titular' limit 1;

  perform pg_temp.r127('0 · public.anonimizar_titular existe (1 so, sem sobrecarga) e NAO existe app.anonimizar_titular',
    v_public = 1 and v_app = 0,
    'public=' || v_public || ' app=' || v_app || ' args=' || coalesce(v_args,'AUSENTE'));
end $$;


-- ===========================================================================
-- 1 · O corpo VIGENTE menciona as 4 tabelas. Antes da 0127 isto era `false`
-- (medido: `ilike '%copiloto%'` = false, 36 tabelas, 13.968 caracteres).
-- ===========================================================================
do $$
declare v_def text; v_faltando text[] := '{}'; t text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'anonimizar_titular' limit 1;

  foreach t in array pg_temp.tabelas_copiloto() loop
    if coalesce(v_def,'') not like '%' || t || '%' then v_faltando := v_faltando || t; end if;
  end loop;

  perform pg_temp.r127('1 · o corpo vigente MENCIONA as 4 tabelas do copiloto (F1 fechado)',
    array_length(v_faltando, 1) is null,
    'tamanho=' || coalesce(length(v_def)::text,'?') || ' faltando=' || coalesce(array_to_string(v_faltando, ', '), 'nenhuma'));
end $$;


-- ===========================================================================
-- 2, 3 e 4 · 🔴 O CICLO COMPLETO.
-- Fabrica um titular REAL com dado do copiloto nas 4 tabelas, com CITAÇÃO
-- LITERAL reconhecível, anonimiza, e confere que a citação sumiu das quatro.
-- ===========================================================================
do $$
declare
  v_p uuid; v_j uuid; v_s uuid; v_admin uuid;
  v_linha titulares_solicitacoes;
  v_contagem jsonb;
  -- Marcadores únicos: se QUALQUER um sobreviver, a anonimização falhou.
  v_marca_seg  text := 'MARCA-SEGMENTO-0127-eu-vou-perder-qualidade-de-vida';
  v_marca_sug  text := 'MARCA-SUGESTAO-0127-imposto-de-renda-e-30-por-100';
  v_marca_fic  text := 'MARCA-FICHA-0127-tenho-medo-de-briga-entre-os-filhos';
  v_marca_inv  text := 'MARCA-INVENTARIO-0127-a-sala-comercial-no-centro';
  v_marca_ret  text := 'MARCA-RETROSPECTO-0127-nao-quero-inventario';
  v_sobreviveu text[] := '{}';
  v_n int;
  v_chaves_novas text[] := '{}';
  v_chaves_antigas_faltando text[] := '{}';
  t text;
  -- Amostra das chaves ANTIGAS: se o `create or replace` tiver comido alguma
  -- tabela, ela some da contagem e este passo acusa.
  v_antigas text[] := array['pessoas','familiares','patrimonio_itens','formularios_respostas',
                            'ligacoes_estrategicas','briefings','execucoes_ia','sessoes_viabilidade',
                            'relatorios_sessao','croquis','croqui_calculos','transcricoes',
                            'materiais_gerados','mensagens_agendadas','diagnosticos_sv'];
begin
  begin
    select id into v_admin from perfis_equipe where papel = 'admin' and ativo limit 1;
    if v_admin is null then
      perform pg_temp.r127('2 · ciclo completo de anonimizacao', false, 'nenhum perfil admin ativo — impossivel executar a RPC');
      return;
    end if;

    -- 🔴 origem_dado = 'real': a funcao RECUSA 'exemplo'. Por isso o rollback.
    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificacao 0127 Titular', 'verif0127@example.com', '+5511921970150', 'real') returning id into v_p;
    insert into jornadas (pessoa_id, etapa, origem, origem_dado)
    values (v_p, 'sessao_realizada', 'indicacao', 'real') returning id into v_j;
    insert into sessoes_viabilidade (jornada_id) values (v_j) returning id into v_s;

    -- (a) sessoes_copiloto — com ficha e inventário carregados de citação.
    insert into sessoes_copiloto (sessao_id, estado, ficha_acumulada, inventario_acumulado)
    values (
      v_s, 'encerrado',
      jsonb_build_array(jsonb_build_object(
        'categoria','dor','texto','Teme briga entre os filhos','evidencia', v_marca_fic,
        'chave','dor:x','primeira_mencao_em', now(), 'ultima_mencao_em', now(), 'n', 1)),
      jsonb_build_array(jsonb_build_object(
        'categoria','imovel','descricao','Sala comercial','titularidade', null,'posse','propria',
        'valor_mencionado', null,'evidencia', v_marca_inv,
        'chave','imovel:sala','primeira_mencao_em', now(), 'ultima_mencao_em', now()))
    );

    -- (b) sessoes_copiloto_segmentos — a fala bruta.
    insert into sessoes_copiloto_segmentos (sessao_id, texto, origem, ordem)
    values (v_s, v_marca_seg, 'manual', 1);

    -- (c) copiloto_sugestoes — a saída da IA, com evidência literal dentro.
    insert into copiloto_sugestoes (sessao_id, gatilho, conteudo, confianca)
    values (v_s, 'intervalo',
      jsonb_build_object(
        'proxima_pergunta', null, 'falta_no_bloco', '[]'::jsonb, 'desvio_sugerido', null,
        'confianca_geral', 0.6, 'campos_evidencia_nao_conferida', '[]'::jsonb,
        'observacao', jsonb_build_object('tipo','fato','texto','Acha o imposto alto','evidencia', v_marca_sug,'confianca',0.6)),
      0.60);

    -- (d) copiloto_retrospectos — o documento congelado da Fase 13.
    insert into copiloto_retrospectos (sessao_id, jornada_id, blocos_com_atividade, blocos_no_roteiro, conteudo)
    values (v_s, v_j, 4, 13,
      jsonb_build_object('versao', 1, 'observacoes_do_cliente',
        jsonb_build_array(jsonb_build_object('origem','ficha','categoria','dor','tipo', null,
          'texto','Nao quer inventario','evidencia', v_marca_ret, 'n', 1, 'confianca', null))));

    -- ---- O ATO -------------------------------------------------------------
    select * into v_linha from public.anonimizar_titular(
      v_p, 'verificacao 0127', 'art. 18 LGPD', 'iniciativa_do_escritorio', now(), v_admin);
    -- 🔴 `titulares_solicitacoes` NAO tem coluna `contagem`: tem `resultado`
    -- jsonb, e as contagens ficam em `resultado->'tabelas'` (0080:78-80).
    -- Conferido no schema real antes de escrever este roteiro.
    v_contagem := coalesce(v_linha.resultado -> 'tabelas', '{}'::jsonb);

    -- ---- (2) NENHUMA citação literal sobrou nas 4 tabelas ------------------
    select count(*) into v_n from sessoes_copiloto_segmentos where sessao_id = v_s and texto like '%MARCA-SEGMENTO-0127%';
    if v_n > 0 then v_sobreviveu := v_sobreviveu || 'sessoes_copiloto_segmentos'; end if;

    select count(*) into v_n from copiloto_sugestoes where sessao_id = v_s and conteudo::text like '%MARCA-SUGESTAO-0127%';
    if v_n > 0 then v_sobreviveu := v_sobreviveu || 'copiloto_sugestoes'; end if;

    select count(*) into v_n from sessoes_copiloto
     where sessao_id = v_s and (ficha_acumulada::text like '%MARCA-FICHA-0127%'
                             or inventario_acumulado::text like '%MARCA-INVENTARIO-0127%');
    if v_n > 0 then v_sobreviveu := v_sobreviveu || 'sessoes_copiloto'; end if;

    select count(*) into v_n from copiloto_retrospectos where sessao_id = v_s and conteudo::text like '%MARCA-RETROSPECTO-0127%';
    if v_n > 0 then v_sobreviveu := v_sobreviveu || 'copiloto_retrospectos'; end if;

    -- ---- (3) a contagem inclui as 4 ---------------------------------------
    foreach t in array pg_temp.tabelas_copiloto() loop
      if v_contagem ? t then v_chaves_novas := v_chaves_novas || t; end if;
    end loop;

    -- ---- (4) NAO-REGRESSAO: as chaves antigas continuam la -----------------
    foreach t in array v_antigas loop
      if not (v_contagem ? t) then v_chaves_antigas_faltando := v_chaves_antigas_faltando || t; end if;
    end loop;

    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      perform pg_temp.r127('2 · ciclo completo de anonimizacao', false, 'excecao: ' || sqlstate || ' ' || sqlerrm);
      return;
    end if;
  end;

  perform pg_temp.r127('2 · 🔴 NENHUMA citacao literal sobreviveu nas 4 tabelas do copiloto',
    array_length(v_sobreviveu, 1) is null,
    'tabelas_com_citacao_viva=' || coalesce(array_to_string(v_sobreviveu, ', '), 'nenhuma'));

  perform pg_temp.r127('3 · 🔴 a CONTAGEM devolvida inclui as 4 tabelas novas',
    coalesce(array_length(v_chaves_novas, 1), 0) = 4,
    'presentes=' || coalesce(array_to_string(v_chaves_novas, ', '), 'nenhuma') ||
    ' | resultado.tabelas=' || left(coalesce(v_contagem::text,'NULO'), 500));

  -- 🔴 DUAS provas de nao-regressao, e a segunda e a forte:
  --   (a) as 15 chaves nomeadas continuam la;
  --   (b) o TOTAL e exatamente 40 = 36 (medidas no corpo vigente em
  --       19/09/2026, conferidas por regex sobre pg_get_functiondef) + 4 do
  --       copiloto. Se o create or replace tiver comido QUALQUER tabela, ou
  --       duplicado alguma, este numero muda e o passo fica vermelho — sem
  --       depender de eu ter escolhido a chave certa para conferir.
  perform pg_temp.r127('4 · 🔴 NAO-REGRESSAO: 15 chaves antigas presentes E total de chaves = 40 (36 + 4)',
    array_length(v_chaves_antigas_faltando, 1) is null
      and (select count(*) from jsonb_object_keys(v_contagem)) = 40,
    'faltando=' || coalesce(array_to_string(v_chaves_antigas_faltando, ', '), 'nenhuma') ||
    ' | total_chaves=' || coalesce((select count(*)::text from jsonb_object_keys(v_contagem)), '?') || ' (esperado 40)');
end $$;


-- ===========================================================================
-- 5 · IDEMPOTÊNCIA — anonimizar 2x devolve a MESMA solicitação, sem explodir
-- e sem criar uma segunda. (A 0080 já garantia; o passo existe para o
-- `create or replace` da 0127 não ter comido a guarda no caminho.)
-- ===========================================================================
do $$
declare
  v_p uuid; v_j uuid; v_admin uuid;
  v_1 titulares_solicitacoes; v_2 titulares_solicitacoes;
  v_qtd int; v_ok boolean := false;
begin
  begin
    select id into v_admin from perfis_equipe where papel = 'admin' and ativo limit 1;
    if v_admin is null then
      perform pg_temp.r127('5 · idempotencia', false, 'nenhum perfil admin ativo');
      return;
    end if;

    insert into pessoas (nome, email, telefone, origem_dado)
    values ('Verificacao 0127 Idem', 'verif0127b@example.com', '+5511921970151', 'real') returning id into v_p;
    insert into jornadas (pessoa_id, etapa, origem, origem_dado)
    values (v_p, 'sessao_agendada', 'indicacao', 'real') returning id into v_j;

    select * into v_1 from public.anonimizar_titular(v_p, 'verificacao 0127', 'art. 18 LGPD', 'iniciativa_do_escritorio', now(), v_admin);
    select * into v_2 from public.anonimizar_titular(v_p, 'verificacao 0127', 'art. 18 LGPD', 'iniciativa_do_escritorio', now(), v_admin);
    select count(*) into v_qtd from titulares_solicitacoes where pessoa_id = v_p and tipo = 'anonimizacao';

    v_ok := v_1.id = v_2.id and v_qtd = 1;
    raise exception 'rollback_proposital';
  exception when others then
    if sqlerrm <> 'rollback_proposital' then
      perform pg_temp.r127('5 · idempotencia (anonimizar 2x)', false, 'excecao: ' || sqlstate || ' ' || sqlerrm);
      return;
    end if;
  end;
  perform pg_temp.r127('5 · anonimizar 2x devolve a MESMA solicitacao e nao duplica linha',
    coalesce(v_ok,false), 'solicitacoes=' || coalesce(v_qtd::text,'?'));
end $$;


-- ===========================================================================
-- 6 · A LISTA MESTRA e a FUNÇÃO concordam sobre as 4.
--
-- `INVENTARIO_TITULAR` (`src/server/lgpd/inventario.ts`) é o que a TELA conta
-- e o que o dossiê exporta; a função é o que APAGA. O achado M3 do pentest da
-- rodada 3 foi exatamente as duas listas divergirem. Este passo não lê o
-- TypeScript — confere o outro lado: as 4 tabelas existem, têm a coluna
-- `sessao_id` que o inventário declara como escopo, e estão na função.
-- ===========================================================================
do $$
declare v_sem_coluna text[] := '{}'; t text; v_tem boolean;
begin
  foreach t in array pg_temp.tabelas_copiloto() loop
    select exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = t and column_name = 'sessao_id'
    ) into v_tem;
    if not v_tem then v_sem_coluna := v_sem_coluna || t; end if;
  end loop;

  perform pg_temp.r127('6 · as 4 tabelas tem `sessao_id` — o escopo que INVENTARIO_TITULAR declara (por: "sessao")',
    array_length(v_sem_coluna, 1) is null,
    'sem_sessao_id=' || coalesce(array_to_string(v_sem_coluna, ', '), 'nenhuma'));
end $$;


select ordem, passo, ok, detalhe from resultado_0127 order by ordem;
