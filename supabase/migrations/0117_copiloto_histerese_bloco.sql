-- 0117_copiloto_histerese_bloco.sql
-- Fase 12, Fatia 1 (F1) — HISTERESE DO BLOCO INFERIDO. Corrige o bug mais
-- irritante para o dono, MEDIDO agora na sessão real
-- `ebbf08d4-9ed3-4d0d-a5c9-a780225726ce`:
--
--   hora        bloco inferido          confiança
--   15:35–15:39 parte_11 (negociação)   0,85
--   15:40, 15:47 parte_03               0,75
--   15:44–15:48 parte_00 (check-in)     0,65
--
-- `estado.ts::resolverBlocoAtual` pegava SIMPLESMENTE A ÚLTIMA inferência
-- (`limit 1`, `order by ordem_evento desc`), sem piso de confiança e sem
-- impedir retrocesso. Uma leitura FRACA (0,65) apontando o COMEÇO do
-- roteiro sobrescrevia uma FORTE (0,85) apontando o FIM — a tela mostrava
-- "00 — Check-in" com a sessão há 1h45 falando de preço. O dono pediu "o
-- bloco tem que mover automaticamente" — ele já move, só que também para
-- TRÁS, o que é pior que não mover.
--
-- ESCOPO REDUZIDO DE PROPÓSITO (mesma disciplina da 0106): esta migration é
-- SÓ DML — 3 chaves novas em `configuracoes`. NENHUMA tabela nova, NENHUMA
-- coluna nova, NENHUM índice novo. A correção inteira mora em
-- `estado.ts::aplicarHisterese` (função pura) + `resolverBlocoAtual`
-- (que agora lê `limit(N)` — na prática um teto fixo maior,
-- `LIMITE_CANDIDATAS_LIDAS_HISTERESE=10`, ver comentário no código — em vez
-- de `limit(1)`). `copiloto_sugestoes.bloco_id`/`conteudo->bloco_inferido`
-- (0091/0106) continuam sendo a ÚNICA fonte de verdade; não existe coluna de
-- "bloco vigente" persistido — decisão do arquiteto: um UPDATE a mais por
-- ciclo de polling que já faz ~12 idas ao banco não se paga. O "vigente" é
-- DERIVADO da própria série a cada chamada (ver comentário de
-- `aplicarHisterese` em `estado.ts` para o mecanismo exato).
--
-- 🔴 A FIXAÇÃO MANUAL (`?bloco=`+`fixado_em`, `estado.ts:227-257` da versão
-- anterior à 0117) CONTINUA VENCENDO TUDO abaixo, sem qualquer alteração
-- nesta fatia — a histerese só entra em jogo quando NÃO há fixação manual
-- vigente, exatamente como a inferência simples entrava antes.
--
-- ===========================================================================
-- AS 3 CHAVES NOVAS
-- ===========================================================================
--
-- (a) copiloto_sessao.piso_confianca_bloco = 0.70
--     Confiança mínima para uma inferência ENTRAR na janela de histerese.
--     Abaixo disto a linha é descartada como se não existisse — nem soma,
--     nem quebra concordância, nem vira "vigente".
--
-- (b) copiloto_sessao.histerese_n = 2
--     Quantas das inferências mais recentes (já acima do piso) precisam
--     CONCORDAR no MESMO bloco para a regra aceitar uma MUDANÇA. Se as `n`
--     mais recentes não concordam entre si, mantém o bloco vigente.
--
-- (c) copiloto_sessao.bloco_permite_retrocesso = false
--     Retroceder para um bloco de índice MENOR que o vigente é o sintoma do
--     bug medido — por isso tem barra MAIOR que avançar: só é aceito com
--     este interruptor ligado, OU se a leitura mais recente tiver confiança
--     >= 0,90 (constante de código, `CONFIANCA_MINIMA_RETROCESSO_FORCADO`,
--     não é chave de `configuracoes` — ninguém pediu ajustar esse número
--     isoladamente ainda; nasce quando houver essa decisão de negócio, não
--     antes). `true` remove a barra extra — existe como reversão SEM DEPLOY
--     caso a barra alta se mostre conservadora demais na prática.
--
-- 🔴 HIPÓTESE CONSERVADORA, NÃO MEDIÇÃO — decisão explícita do arquiteto:
-- só existe 1 sessão real com bloco inferido (~19 sugestões com
-- `bloco_inferido` não nulo) e o eco do Zoom (~8% da fala, conforme medido
-- em `docs/ARQUITETURA-FASE-10.md`) contamina essa amostra — não há base
-- estatística para calibrar piso/N/retrocesso com confiança ainda. Os 3
-- valores replicam o comportamento que TERIA resolvido o caso medido (ver
-- simulação abaixo) com a margem mais conservadora disponível, não uma
-- otimização fina. Reavaliar quando houver mais sessões reais com
-- `bloco_inferido` gravado.
--
-- SIMULAÇÃO CONTRA O CASO REAL (piso=0,70, n=2, permite_retrocesso=false):
-- lendo as candidatas mais-recente-primeiro — [0,65/parte_00 (15:48),
-- 0,65/parte_00 (15:44), 0,75/parte_03 (15:47 — nota: a ORDEM por
-- ordem_evento pode divergir do relógio de parede em poucos segundos; a
-- simulação usa ordem_evento, não hora), 0,85/parte_11 (15:39)] — o piso
-- descarta as duas leituras de 0,65 (abaixo de 0,70) antes mesmo delas
-- formarem a janela. Sobram [0,75/parte_03, 0,85/parte_11]: JANELA (n=2) =
-- essas duas, que NÃO concordam entre si (parte_03 ≠ parte_11) → MANTÉM o
-- vigente, que sem 3ª candidata válida sobrando é a mais antiga da própria
-- janela: parte_11 (0,85). Resultado: a tela continua mostrando "Parte 11
-- — negociação", não regride para "Parte 00 — Check-in". Caso de teste
-- automatizado equivalente: `estado.test.ts` — "🔴 TESTE DE ACEITE (o bug
-- do dono)".
--
-- ===========================================================================
-- AS 5 PERGUNTAS DO PROTOCOLO DE SUSTENTABILIDADE
-- ===========================================================================
--
-- 1. Escala — a leitura de `resolverBlocoAtual` sobre `copiloto_sugestoes`
--    é `where sessao_id=$1 and <bloco_inferido não nulo> order by
--    ordem_evento desc limit LIMITE_CANDIDATAS_LIDAS_HISTERESE` — teto FIXO
--    (10, constante de código), não escala com o tamanho da sessão nem com
--    o volume de sugestões acumuladas. Uma sessão de 3h com 200 sugestões
--    paga o MESMO custo de leitura que uma de 20 min com 10 sugestões — o
--    custo é por CHAMADA, não por base inteira.
--
-- 2. Índice — o filtro é `sessao_id=$1` + `conteudo->bloco_inferido->>
--    bloco_id is not null`, ordenado por `ordem_evento desc` — MESMO
--    predicado de igualdade/ordenação da 0091/0106 (nenhuma mudança), sobre
--    `idx_copiloto_sugestoes_polling (sessao_id, ordem_evento)`. A parte
--    JSONB (`->>bloco_id is not null`) NÃO é coberta pelo índice — o
--    predicado é aplicado como FILTRO após o Index Scan pelo par
--    `(sessao_id, ordem_evento)`, exatamente como já acontecia com
--    `limit(1)` desde a 0106. A MUDANÇA desta fatia é só o teto do `limit`
--    (de 1 para até 10) — MEDIDO: 0,177 ms, Index Scan, 14 linhas
--    descartadas pelo filtro. Ver EXPLAIN abaixo.
--
-- 3. Frequência — mesma cadência de sempre: 1× por chamada de
--    `GET /api/sessoes/[id]/copiloto`, que roda a cada 3s de polling em
--    foco (~1.800×/sessão de 90 min, §4.1 do plano da Fase 10) — já era o
--    caminho quente antes desta fatia; não é uma leitura nova em cadência
--    própria, é o MESMO ponto de leitura com teto maior.
--
-- 4. Repetição — não há N telas pedindo isto: é 1 leitura server-side por
--    ciclo de polling (dentro de `montarEstadoCopiloto`, chamada 1× por
--    request), não por componente de tela.
--
-- 5. Reversão — 3 caminhos, todos sem deploy:
--      - `update configuracoes set valor='false'::jsonb where
--        chave='copiloto_sessao.inferencia_bloco_ativa'` (0106, já existe)
--        desliga TODA a inferência automática — a fixação manual
--        (`?bloco=`) continua funcionando.
--      - `update configuracoes set valor='999'::jsonb where
--        chave='copiloto_sessao.piso_confianca_bloco'` inviabilizado
--        (>1) faz TODA leitura cair abaixo do piso — equivalente a nunca
--        aceitar inferência nova, sempre mantendo o último bloco válido
--        (nunca "indisponível" no meio de uma sessão já resolvida).
--      - `update configuracoes set valor='true'::jsonb where
--        chave='copiloto_sessao.bloco_permite_retrocesso'` relaxa a barra
--        de retrocesso se ela se mostrar conservadora demais na prática.
--
-- ===========================================================================
-- ✅ MEDIDO EM PRODUÇÃO (17/09/2026, 16:0x) contra `fcfsnqqaphtamhrpuyoh`,
-- pelo responsável da sessão — subagente não busca credencial de produção.
--
-- (a) ESCRITA — INSERT em `configuracoes`, dentro de `begin; ... rollback;`
--     (padrão idêntico ao medido na 0114 hoje: Index Scan em
--     `configuracoes_pkey` como árbitro de conflito, 0,762 ms).
--
-- (b) 🔴 O CAMINHO QUENTE — a leitura que roda ~1.800×/sessão (polling 3s),
--     contra a sessão REAL da Nicéas (`ebbf08d4`, 195 sugestões):
--
--   Limit  (cost=0.27..4.15 rows=10 width=937)
--          (actual time=0.031..0.064 rows=10 loops=1)
--     Buffers: shared hit=16
--     ->  Index Scan Backward using idx_copiloto_sugestoes_polling
--         on copiloto_sugestoes  (cost=0.27..46.89 rows=120 width=937)
--                                (actual time=0.030..0.061 rows=10 loops=1)
--           Index Cond: (sessao_id = 'ebbf08d4-…'::uuid)
--           Filter: (((conteudo -> 'bloco_inferido') ->> 'bloco_id') IS NOT NULL)
--           Rows Removed by Filter: 14
--           Buffers: shared hit=16
--   Planning Time: 0.580 ms
--   Execution Time: 0.177 ms
--
-- VEREDITO, pelo critério escrito acima (Index Scan + filtro barato):
-- **a migration está pronta como está. O ÍNDICE PARCIAL NÃO É NECESSÁRIO.**
-- `Rows Removed by Filter: 14` — o filtro jsonb, que não é indexável,
-- descarta 14 linhas para devolver 10. É exatamente o cenário barato que o
-- critério previu; criar índice parcial aqui seria acrescentar estrutura
-- para economizar 0,06 ms, contra a própria regra de otimização da casa
-- (feature nova não pode deixar o sistema mais pesado do que achou).
--
-- Contexto de escala: 0,177 ms × 2 leituras por ciclo, contra uma chamada de
-- IA de ~7.000 ms no mesmo ciclo — 0,005% do tempo. O `limit 1` → `limit 10`
-- não mudou o plano: continua Index Scan Backward pela mesma chave.
--
-- ⚠️ A MEDIR DE NOVO quando uma sessão passar de ~500 sugestões: o filtro
-- não-indexável cresce com a proporção de sugestões SEM `bloco_inferido`.
-- Hoje são 14 descartadas; se essa proporção subir muito, o índice parcial
-- `where (conteudo->'bloco_inferido'->>'bloco_id') is not null` volta à mesa.
--
-- ===========================================================================
-- Este agente NÃO tem credencial de produção nesta máquina (mesma restrição
-- documentada nas migrations 0106/0111/0114 — regra da casa: subagente NÃO
-- busca credencial de produção). O comando abaixo tem que rodar contra
-- `fcfsnqqaphtamhrpuyoh` (produção) DENTRO de `begin; ...; rollback;`
-- (EXPLAIN em DML EXECUTA o DML) ANTES de considerar esta migration
-- aplicável, e a saída REAL colada aqui — não uma expectativa:
--
--   begin;
--   -- (a) A escrita desta migration (mesmo padrão de INSERT medido em
--   -- todas as migrations irmãs de configuracoes — 0091/0101/0103/0106/
--   -- 0108/0109/0111/0114/0115 — Index Scan em configuracoes_pkey,
--   -- sub-ms; não é o plano que importa aqui, é o de leitura abaixo):
--   explain (analyze, buffers)
--   insert into configuracoes (chave, valor, descricao) values
--    ('copiloto_sessao.piso_confianca_bloco', '0.70'::jsonb, '<descrição>')
--   on conflict (chave) do nothing;
--
--   -- (b) O CAMINHO QUENTE DE VERDADE — rodar contra uma sessão REAL com
--   -- bloco_inferido gravado (ex.: ebbf08d4-9ed3-4d0d-a5c9-a780225726ce,
--   -- 93 sugestões, ~43 com bloco):
--   explain (analyze, buffers)
--   select bloco_id, conteudo, criado_em
--   from copiloto_sugestoes
--   where sessao_id = 'ebbf08d4-9ed3-4d0d-a5c9-a780225726ce'
--     and (conteudo->'bloco_inferido'->>'bloco_id') is not null
--   order by ordem_evento desc
--   limit 10;
--   rollback;
--
-- CRITÉRIO DE DECISÃO (do plano, não negociável): se o plano mostrar
-- `Index Scan` em `idx_copiloto_sugestoes_polling` seguido de filtro barato
-- (poucas dezenas de linhas removidas), a migration está pronta como está.
-- 🔴 Se `Rows Removed by Filter` for ALTO (ex.: a sessão tiver centenas de
-- sugestões e a maioria SEM `bloco_inferido`, fazendo o Postgres varrer
-- muitas linhas do índice por `sessao_id` antes de achar 10 com a marca),
-- a correção é um ÍNDICE PARCIAL:
--
--   create index idx_copiloto_sugestoes_bloco_inferido
--     on copiloto_sugestoes (sessao_id, ordem_evento desc)
--     where (conteudo->'bloco_inferido'->>'bloco_id') is not null;
--
-- — mas SÓ criar isto se o EXPLAIN provar o `where` (regra da casa: "índice
-- parcial só serve se a query provar o WHERE"). NÃO incluído nesta
-- migration porque ainda não foi medido — decidir com o número, não antes.
-- O responsável da sessão roda o comando acima e cola a saída; se o índice
-- parcial se mostrar necessário, ele entra em migration 0118 separada
-- (aditiva, sem tocar nesta).
-- ===========================================================================

insert into configuracoes (chave, valor, descricao) values
 ('copiloto_sessao.piso_confianca_bloco', '0.70'::jsonb,
  'HIPÓTESE CONSERVADORA (Fase 12, Fatia 1, 0117), NÃO medição — só 1 sessão real '
  'com bloco inferido (~19 sugestões) e o eco do Zoom (~8% da fala) contamina a '
  'amostra. Confiança mínima para uma inferência de bloco ENTRAR na janela de '
  'histerese (server/copiloto/estado.ts::aplicarHisterese) — abaixo disto a '
  'linha é descartada como se não existisse. Corrige o bug medido na sessão '
  'ebbf08d4-9ed3-4d0d-a5c9-a780225726ce: leitura de 0,65 (parte_00, check-in) '
  'sobrescrevendo uma de 0,85 (parte_11, negociação) já percorrida. Subir para '
  '> 1 desliga a aceitação de inferência nova sem deploy (mantém o último '
  'bloco válido). Lido por lerConfiguracaoJson (server/ia/configuracao.ts).'),
 ('copiloto_sessao.histerese_n', '2'::jsonb,
  'HIPÓTESE CONSERVADORA (Fase 12, Fatia 1, 0117), NÃO medição. Quantas das '
  'inferências mais recentes (já acima do piso de confiança) precisam CONCORDAR '
  'no MESMO bloco para a histerese (server/copiloto/estado.ts::aplicarHisterese) '
  'aceitar uma MUDANÇA de bloco atual. Se as N mais recentes não concordam entre '
  'si, mantém o bloco vigente. Lido por lerConfiguracaoInt (server/ia/'
  'configuracao.ts).'),
 ('copiloto_sessao.bloco_permite_retrocesso', 'false'::jsonb,
  'HIPÓTESE CONSERVADORA (Fase 12, Fatia 1, 0117), NÃO medição. FALSE (padrão): '
  'retroceder para um bloco de índice MENOR que o vigente (server/copiloto/'
  'estado.ts::aplicarHisterese) só é aceito com confiança >= 0,90 (constante de '
  'código CONFIANCA_MINIMA_RETROCESSO_FORCADO) mesmo com concordância das N mais '
  'recentes — retroceder é o SINTOMA do bug medido em produção (leitura fraca '
  'do início da sessão sobrescrevendo o fim já percorrido), por isso a barra é '
  'maior que para avançar. TRUE remove essa barra extra (retrocesso aceito nas '
  'mesmas condições que avanço) — reversão SEM DEPLOY caso a barra alta se '
  'mostre conservadora demais na prática. Lido por lerConfiguracaoBool '
  '(server/ia/configuracao.ts).')
on conflict (chave) do nothing;
