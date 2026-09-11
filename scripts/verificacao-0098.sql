-- scripts/verificacao-0098.sql — roteiro da Fase 10, Fatia 5 (expurgo de
-- sessoes_copiloto_segmentos, B69/B19).
-- ---------------------------------------------------------------------------
-- COMO RODAR: uma chamada só (MCP execute_sql / SQL Editor / psql -f) como
-- `postgres`, com 0091 a 0098 APLICADAS. A última instrução devolve
-- `resultado_0098` (ordem, passo, ok, detalhe). `ok = true` em todas prova
-- que o banco faz o que a 0098 promete.
--
-- TUDO COM ROLLBACK, mesmo padrão de `verificacao-0096.sql`.
--
-- 🔴 O QUE ESTE ROTEIRO NÃO PROVA (e por quê): a REGRA "só expurga sessão
-- com transcricao_id preenchido" e a REGRA "não carimba pela metade" são
-- lógica de APLICAÇÃO (server/copiloto/expurgo.ts), não CHECK/trigger do
-- banco — a 0098 é aditiva de DDL puro (2 colunas + 1 chave de
-- configuração), sem trigger nova. A prova dessas duas regras está em
-- `src/server/copiloto/expurgo.test.ts` (9 testes, unitários, sem banco).
-- Este roteiro prova o que É responsabilidade do banco: que as colunas e a
-- chave existem com o valor de fábrica CORRETO (nasce desligado), que RLS/
-- GRANT não regridem, e o `explain (analyze)` das duas queries que o job
-- roda por sessão.
--
-- O QUE ESTE ROTEIRO PROVA
--   0  as colunas sessoes_copiloto.expurgo_segmentos_em/_motivo existem
--   1  copiloto_sessao.expurgo_ativo existe com valor 'false' (nasce
--        DESLIGADO — regra dura do coordenador, mais séria nesta fatia)
--   2  copiloto_sessao.retencao_dias_segmentos CONTINUA existindo (0091,
--        não foi tocada por esta migration), com valor inteiro POSITIVO —
--        não exige um número fixo: a Dra. Elaine pode mudar o prazo sem
--        que este roteiro passe a reprovar
--   3  RLS/GRANT de sessoes_copiloto NÃO regrediram (as colunas novas são
--        cobertas pela policy por LINHA já existente, 0091 — não há coluna
--        nova exposta a quem não devia)
--   4  idx_copiloto_sessoes_pendentes_expurgo existe, é PARCIAL, e cobre
--        SEMANTICAMENTE as duas condições do WHERE da query real — prova
--        tolerante a parentetização (não compara string exata contra
--        `pg_get_expr`, que varia de formatação entre versões do Postgres)
--   5  `explain (analyze)` — A MEDIR, 2 comandos: a leitura de sessões
--        elegíveis (buscarSessoesElegiveis, usando o índice do passo 4) e o
--        DELETE por lote (removerSegmentosVencidos) — os dois caminhos que
--        o job roda a cada passagem do cron
-- ---------------------------------------------------------------------------

drop table if exists resultado_0098;
create temp table resultado_0098 (
  ordem serial primary key, passo text not null, ok boolean not null, detalhe text
) on commit drop;

create or replace function pg_temp.r98(p_passo text, p_ok boolean, p_detalhe text) returns void
language sql as $$ insert into resultado_0098 (passo, ok, detalhe) values (p_passo, p_ok, left(p_detalhe, 900)) $$;


-- ===========================================================================
-- 0 · As colunas existem.
-- ===========================================================================
do $$
declare
  v_tem_em boolean;
  v_tem_motivo boolean;
begin
  v_tem_em := exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'sessoes_copiloto' and column_name = 'expurgo_segmentos_em'
  );
  v_tem_motivo := exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'sessoes_copiloto' and column_name = 'expurgo_segmentos_motivo'
  );
  perform pg_temp.r98('0 · colunas expurgo_segmentos_em/_motivo existem em sessoes_copiloto',
    v_tem_em and v_tem_motivo, 'tem_em=' || v_tem_em || ' tem_motivo=' || v_tem_motivo);
end $$;


-- ===========================================================================
-- 1 · copiloto_sessao.expurgo_ativo nasce 'false' — REGRA DURA: sem isto,
-- nenhum DELETE de sessoes_copiloto_segmentos pode acontecer, mesmo com
-- retencao_dias_segmentos configurada.
-- ===========================================================================
do $$
declare
  v_valor jsonb;
begin
  select valor into v_valor from configuracoes where chave = 'copiloto_sessao.expurgo_ativo';
  perform pg_temp.r98('1 · copiloto_sessao.expurgo_ativo existe e vale false (nasce DESLIGADO)',
    v_valor is not null and v_valor = 'false'::jsonb,
    'valor=' || coalesce(v_valor::text, '(ausente)'));
end $$;


-- ===========================================================================
-- 2 · copiloto_sessao.retencao_dias_segmentos continua existindo (0091) —
-- esta migration NÃO a altera, só documenta que as duas chaves são
-- independentes (mudar o prazo não liga o expurgo sozinho).
--
-- 🔴 CORREÇÃO (achado do coordenador, revisão da Fatia 5): a versão
-- anterior deste passo exigia `valor = 7` — o roteiro reprovaria PARA
-- SEMPRE no dia em que a Dra. Elaine mudasse o prazo legitimamente (ação
-- de configuração prevista pelo desenho, não um defeito). O valor de
-- fábrica (7) já foi provado no ATO da aplicação da 0091, que é quando o
-- roteiro daquela migration rodou — este passo, de outra migration
-- (0098), só precisa confirmar que a chave EXISTE e é um formato que
-- `lerConfiguracaoInt` (server/ia/configuracao.ts) aceita como válido:
-- inteiro POSITIVO. Um valor mudado para, digamos, 14 continua sendo
-- verde — é exatamente o comportamento correto do sistema.
-- ===========================================================================
do $$
declare
  v_valor jsonb;
  v_numero numeric;
  v_ok boolean;
begin
  select valor into v_valor from configuracoes where chave = 'copiloto_sessao.retencao_dias_segmentos';
  v_numero := nullif(v_valor #>> '{}', '')::numeric;
  v_ok := v_valor is not null and v_numero is not null and v_numero > 0 and v_numero = trunc(v_numero);

  perform pg_temp.r98('2 · copiloto_sessao.retencao_dias_segmentos existe e é inteiro positivo (valor livre — Dra. Elaine pode mudar)',
    coalesce(v_ok, false), 'valor=' || coalesce(v_valor::text, '(ausente)'));
end $$;


-- ===========================================================================
-- 3 · RLS/GRANT de sessoes_copiloto não regrediram: authenticated continua
-- select+insert+update (0091), sem DELETE (o expurgo é sempre service_role,
-- via cron — a policy de authenticated nunca precisou de DELETE e continua
-- sem ele). As colunas novas são cobertas pela policy por LINHA existente,
-- não precisam de policy própria.
-- ===========================================================================
do $$
declare
  v_erros text := '';
begin
  if not has_table_privilege('authenticated', 'sessoes_copiloto', 'select') then v_erros := v_erros || 'authenticated_sem_select '; end if;
  if not has_table_privilege('authenticated', 'sessoes_copiloto', 'insert') then v_erros := v_erros || 'authenticated_sem_insert '; end if;
  if not has_table_privilege('authenticated', 'sessoes_copiloto', 'update') then v_erros := v_erros || 'authenticated_sem_update '; end if;
  if has_table_privilege('authenticated', 'sessoes_copiloto', 'delete') then v_erros := v_erros || 'authenticated_COM_delete '; end if;
  if not has_table_privilege('service_role', 'sessoes_copiloto', 'update') then v_erros := v_erros || 'service_role_sem_update '; end if;

  perform pg_temp.r98('3 · RLS/GRANT de sessoes_copiloto não regrediram (0091 intacta)', v_erros = '',
    case when v_erros = '' then 'ok' else 'ACHADOS: ' || v_erros end);
end $$;


-- ===========================================================================
-- 4 · idx_copiloto_sessoes_pendentes_expurgo existe, é PARCIAL, e o WHERE
-- cobre semanticamente as duas condições da query real (`server/copiloto/
-- expurgo.ts::buscarSessoesElegiveis`).
--
-- 🔴 CORREÇÃO (achado do coordenador, revisão da Fatia 5 — "o passo 4 nasce
-- vermelho para sempre", mesma família do passo 11 da Fatia 2). A versão
-- anterior comparava o predicado por IGUALDADE DE STRING exata —
-- `pg_get_expr` na forma de 2 argumentos tende a devolver o predicado COM
-- parênteses externos (`((transcricao_id IS NOT NULL) AND
-- (expurgo_segmentos_em IS NULL))`, ou variações de formatação entre
-- versões do Postgres), reprovando um índice CORRETO. Como ninguém consegue
-- provar a formatação exata sem banco (não há como testar contra um
-- Postgres real nesta máquina), a comparação NÃO PODE depender dela.
--
-- CORREÇÃO: prova SEMÂNTICA, não textual — confere separadamente que (a) o
-- índice é parcial (`indpred is not null`), (b) o predicado MENCIONA
-- `transcricao_id` junto de `IS NOT NULL`, e (c) o predicado MENCIONA
-- `expurgo_segmentos_em` junto de `IS NULL` — tolerando qualquer
-- parentetização, espaçamento ou ordem das duas cláusulas.
-- ===========================================================================
do $$
declare
  v_existe boolean;
  v_indpred_not_null boolean;
  v_predicado text;
  v_normalizado text;
  v_tem_transcricao boolean;
  v_trecho_expurgo text;
  v_tem_expurgo boolean;
  v_ok boolean;
begin
  v_existe := to_regclass('public.idx_copiloto_sessoes_pendentes_expurgo') is not null;

  if v_existe then
    select indpred is not null, pg_get_expr(indpred, indrelid)
      into v_indpred_not_null, v_predicado
      from pg_index
     where indexrelid = 'public.idx_copiloto_sessoes_pendentes_expurgo'::regclass;
  end if;

  -- Normaliza para minúsculas e colapsa espaços — só sintaxe POSIX simples
  -- (sem lookahead/lookbehind, que o motor de regex do Postgres não tem),
  -- tolerante a QUALQUER parentetização que pg_get_expr venha a produzir.
  v_normalizado := regexp_replace(lower(coalesce(v_predicado, '')), '\s+', ' ', 'g');

  -- (a) transcricao_id tem de vir associado a "is not null" em algum ponto.
  v_tem_transcricao := v_normalizado ~ 'transcricao_id[^a-z0-9_]*is not null';

  -- (b) expurgo_segmentos_em tem de vir associado a "is null" — SEM o "not"
  -- dentro da MESMA cláusula. Isola do início de "expurgo_segmentos_em" até
  -- o PRIMEIRO "null" seguinte (não uma janela de caracteres fixa — uma
  -- janela fixa vazaria para a cláusula vizinha quando a ordem das duas
  -- condições no predicado está trocada, ex.: "expurgo_segmentos_em IS
  -- NULL AND transcricao_id IS NOT NULL" — bug encontrado e corrigido
  -- durante a escrita deste roteiro, antes de qualquer banco real rodá-lo).
  -- Non-greedy (`.*?`) é suportado pelo motor ARE do Postgres (operador `~`).
  v_trecho_expurgo := substring(v_normalizado from 'expurgo_segmentos_em.*?null');
  v_tem_expurgo := v_trecho_expurgo is not null
    and v_trecho_expurgo ~ 'is null'
    and v_trecho_expurgo !~ 'is not null';

  v_ok := v_existe and coalesce(v_indpred_not_null, false) and coalesce(v_tem_transcricao, false) and coalesce(v_tem_expurgo, false);

  perform pg_temp.r98('4 · idx_copiloto_sessoes_pendentes_expurgo é PARCIAL e cobre as duas condições (tolerante a parentetização)',
    coalesce(v_ok, false),
    'existe=' || v_existe || ' e_parcial=' || coalesce(v_indpred_not_null, false) ||
    ' tem_transcricao_not_null=' || coalesce(v_tem_transcricao, false) ||
    ' tem_expurgo_is_null=' || coalesce(v_tem_expurgo, false) || ' predicado=[' || coalesce(v_predicado, '(sem índice)') || ']');
end $$;


-- ===========================================================================
-- 5 · `explain (analyze)` — A MEDIR contra o banco real. Sem `.env` nesta
-- máquina não há como rodar (mesmo aviso de honestidade do plano). Comandos
-- exatos para colar no MCP/SQL Editor com dado de exemplo populado (algumas
-- sessões com transcricao_id preenchido e centenas de segmentos, alguns
-- vencidos):
--
--   -- (a) buscarSessoesElegiveis — server/copiloto/expurgo.ts (usa
--   -- idx_copiloto_sessoes_pendentes_expurgo, passo 4 acima):
--   explain (analyze, buffers)
--   select sessao_id from sessoes_copiloto
--    where transcricao_id is not null
--      and expurgo_segmentos_em is null
--    order by criado_em asc
--    limit 50;
--
-- Esperado em (a): Index Scan (ou Index Only Scan) sobre
-- `idx_copiloto_sessoes_pendentes_expurgo`, SEM Sort separado (o índice já
-- ordena por `criado_em`) — nunca Seq Scan. Se o `explain` mostrar Seq
-- Scan, o índice parcial não está sendo escolhido (conferir se o predicado
-- do passo 4 realmente bate, e se o planner tem estatística atualizada —
-- `analyze sessoes_copiloto` — antes de assumir que o índice está quebrado).
--
--   -- (b) removerSegmentosVencidos — a SELEÇÃO antes do DELETE (mesmo
--   -- índice do caminho quente do polling, idx_copiloto_segmentos_polling
--   -- (sessao_id, ordem) NÃO cobre `criado_em` — este é um índice
--   -- DIFERENTE do polling, e é o que este passo mede):
--   explain (analyze, buffers)
--   select id, sessao_id from sessoes_copiloto_segmentos
--    where sessao_id in ('<uuid sessão 1>', '<uuid sessão 2>')
--      and criado_em < now() - interval '7 days'
--    limit 1000;
--
-- Esperado em (b): Index Scan sobre `idx_copiloto_segmentos_polling
-- (sessao_id, ordem)` USANDO SÓ `sessao_id` como prefixo (o filtro de
-- `criado_em` é RESIDUAL dentro do Index Scan, sem índice próprio para essa
-- coluna) — aceitável pela cardinalidade pequena por sessão (~180
-- segmentos no teto do desenho, §2.1 do plano), MESMO raciocínio já
-- registrado no passo (d1)/(d2) de verificacao-0096.sql para a mesma
-- tabela. Se o `explain` mostrar Seq Scan (não Index Scan), é sinal de que
-- o índice do polling não está sendo usado como prefixo — revisar antes de
-- ligar `copiloto_sessao.expurgo_ativo=true` em produção.
--
-- Colar a saída CRUA de (a)/(b) na entrega — não estimar nenhuma.
-- ===========================================================================
do $$
begin
  perform pg_temp.r98('5 · explain (analyze): sessões elegíveis + seleção de segmentos vencidos', false,
    'A MEDIR — sem banco nesta máquina. Comandos exatos (a)/(b) no comentário acima deste bloco.');
end $$;


-- ===========================================================================
-- 🔴 NOTA NÃO BLOQUEANTE — o bug de STARVATION que a revisão desta fatia
-- encontrou, e como ele SERIA DETECTADO se voltasse (a correção aplicada é
-- FIFO + índice parcial, passos 4/5 acima; isto aqui é o SINTOMA, para quem
-- olhar depois sem ler o código).
--
-- O QUE ACONTECIA antes da correção: `buscarSessoesElegiveis`
-- (server/copiloto/expurgo.ts) tem teto de 50 sessões por passada
-- (LOTE_SESSOES_ELEGIVEIS) e, SEM `order by`, o Postgres não garante que
-- as 50 devolvidas mudem de uma passada para a outra. Se a base acumular
-- mais de 50 sessões consolidadas (transcricao_id preenchido) e ainda não
-- carimbadas, e uma fração relevante delas tiver segmento AINDA DENTRO do
-- prazo (situação normal: sessão recém-consolidada), o job podia devolver
-- SEMPRE o mesmo subconjunto "nada a fazer aqui" e nunca alcançar sessões
-- MAIS ANTIGAS com segmento de fato vencido — sem erro nenhum, sem exceção,
-- sem linha em `erros_servidor`. O cron rodava, respondia 200, "funcionava".
--
-- O SINTOMA, em produção: `sessoes_copiloto_segmentos.criado_em` de uma
-- sessão específica passa MUITO do prazo de `retencao_dias_segmentos`
-- (dias, não horas) e `sessoes_copiloto.expurgo_segmentos_em` continua NULL
-- para ela, mesmo com `copiloto_sessao.expurgo_ativo=true` e o cron rodando
-- normalmente (`configuracoes['regua.ultimo_cron_em']` recente). A resposta
-- do cron (`expurgo_copiloto` no JSON de `POST /api/cron/regua`) mostraria
-- `segmentosRemovidos`/`sessoesConcluidas` MAIORES QUE ZERO passada após
-- passada — está trabalhando, só nunca chega nesta sessão específica.
--
-- COMO CONFIRMAR (query de diagnóstico, roda a qualquer momento, não requer
-- banco de teste — é só leitura):
--
--   select sc.sessao_id, sc.criado_em, sc.transcricao_id,
--          min(s.criado_em) as segmento_mais_velho,
--          count(*) filter (where s.criado_em < now() - interval '7 days') as vencidos
--     from sessoes_copiloto sc
--     join sessoes_copiloto_segmentos s on s.sessao_id = sc.sessao_id
--    where sc.transcricao_id is not null
--      and sc.expurgo_segmentos_em is null
--    group by sc.sessao_id, sc.criado_em, sc.transcricao_id
--   having count(*) filter (where s.criado_em < now() - interval '7 days') > 0
--    order by segmento_mais_velho asc
--    limit 20;
--
-- Se esta query devolver linha com `segmento_mais_velho` de MUITOS dias
-- atrás (bem além de `retencao_dias_segmentos`) enquanto o cron está
-- confirmadamente rodando, é o sintoma voltando — conferir se
-- `idx_copiloto_sessoes_pendentes_expurgo` ainda existe (passo 4) e se
-- `buscarSessoesElegiveis` ainda tem `order by criado_em asc` antes de
-- suspeitar de outra causa.
-- ===========================================================================


select * from resultado_0098 order by ordem;
