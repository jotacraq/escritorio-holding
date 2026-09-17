-- 0114_copiloto_timeout_configuravel.sql
-- Fase 12 · Fatias 1+2 — `TIMEOUT_COPILOTO_MS` e `maxTokens` de
-- `executar-ia.ts` deixam de ser literais hard-coded e passam a ser lidos de
-- `configuracoes` (`copiloto_sessao.timeout_ms` / `copiloto_sessao.max_tokens`),
-- com os literais atuais (8000 / 900) preservados como FALLBACK no código
-- (`executar-ia.ts::TIMEOUT_COPILOTO_MS`/`MAX_TOKENS_COPILOTO`) — chave
-- ausente ou valor inválido cai neles, nunca crash. 100% ADITIVA: nenhuma
-- tabela/coluna/view/função/policy é criada ou alterada, só 2 linhas novas
-- em `configuracoes` (0027) — RLS/GRANT já cobrem a tabela desde a 0027.
--
-- MEDIÇÕES QUE JUSTIFICAM OS VALORES (14 dias de `execucoes_ia`, modelo
-- claude-sonnet-5, status='concluida', n=58 — mesma tabela que já embasou a
-- 0102):
--   tokens_saida: p95=531, p99=637, MÁXIMO=644
--   latencia_ms:  p99=9.246 ms, MÁXIMO=9.642 ms
--   corr(tokens_saida, latencia_ms) = 0,73 — a latência é dominada pela
--     GERAÇÃO, não pela leitura (cache já cobre 79% da entrada).
--   Sessão de 17/09: 12 de 26 chamadas (48%) falharam com
--     `openrouter_resposta_vazia: corpo nao-JSON ou vazio apos 8s
--     (status 200)`, entre 7.858 e 7.965 ms — o `abort()` de 8s cortava a
--     resposta NO MEIO da geração, antes do JSON fechar. Sucessos: p50
--     6.036 ms, p95 7.284 ms.
--
-- copiloto_sessao.timeout_ms = 20000: o máximo real observado é 9.642 ms;
--   20s dá folga de 2× sobre o pior caso e continua 15× menor que o
--   `IA_TIMEOUT_MS` global de 300s (preserva o CONFLITO C3 documentado no
--   topo de `executar-ia.ts`: "IA_TIMEOUT_MS global é veneno aqui").
--
-- copiloto_sessao.max_tokens = 850: 🔴 NÃO É 600 — o p99 real é 637 e o
--   máximo 644; 600 truncaria a saída, trocando timeout por
--   `conteudo_recusado` (JSON inválido). 644 × 1,3 ≈ 850: corta a cauda
--   patológica preservando toda a saída legítima observada. Ganho marginal
--   deliberado — não é otimização de custo, é margem de segurança sobre o
--   teto anterior (900), que já cobria o cenário real com folga maior ainda.
--
-- LEITURA (ciclo.ts): as duas chaves entram no MESMO `Promise.all` que já
-- lê orçamento+contexto (`ciclo.ts`, Fase 11) — zero round-trip novo no
-- caminho quente do ciclo automático de IA.
--
-- warmup.ts (chamada de aquecimento) e os testes que chamam
-- `executarIaCopiloto` sem passar `timeoutMs`/`maxTokens` continuam usando
-- os fallbacks do próprio módulo (8000/900) — não foram alterados nesta
-- fatia (fora do escopo do plano; ver comentário de topo de
-- `executar-ia.ts`).
--
-- AS 5 PERGUNTAS DO PROTOCOLO DE SUSTENTABILIDADE:
--
-- 1. Escala — a query é `select valor from configuracoes where chave = $1`,
--    sempre 0 ou 1 linha, independente do tamanho da tabela `configuracoes`
--    (hoje ~40 linhas, cresce só por migration/feature nova, nunca por
--    volume de negócio). Custo é por LEITURA (chave fixa), não por base
--    inteira — não escala com nada que cresça no domínio do negócio.
--
-- 2. Índice — `configuracoes.chave` é `text primary key`
--    (0027_fase2_travas_e_configuracao.sql:151). Filtro é `where chave = $1`
--    (igualdade exata na PK, sem `lower`/`btrim`/expressão nenhuma) — não há
--    ambiguidade de convenção aqui (essa armadilha é só para índice de
--    expressão sobre e-mail). EXPLAIN abaixo prova `Index Scan using
--    configuracoes_pkey`. Nenhum índice novo criado — a PK já serve.
--
-- 3. Frequência — mesma frequência que a leitura de
--    `copiloto_sessao.duracao_maxima_minutos`/`intervalo_segundos` que já
--    roda a cada ciclo automático (a cada 20s por sessão ativa, só enquanto
--    houver gatilho) — não é chamada nova em cadência própria, é 2 SELECTs
--    a mais DENTRO de um `Promise.all` que já ia rodar.
--
-- 4. Repetição — não há N telas pedindo isto: é 1 leitura server-side por
--    ciclo de IA (não por render de tela, não por polling do cliente — o
--    polling de 3s só chama `executarCicloCopiloto` quando há gatilho, e
--    aí sim entra no `Promise.all` único, não em paralelo por componente).
--
-- 5. Reversão — `update configuracoes set valor = '8000'::jsonb where
--    chave = 'copiloto_sessao.timeout_ms'` (e o par para `max_tokens`)
--    reverte sem deploy — a leitura já é dinâmica desde este commit. Se a
--    própria LEITURA precisar ser desligada (rollback de código), o
--    fallback do módulo (`TIMEOUT_COPILOTO_MS=8000`/`MAX_TOKENS_COPILOTO=900`)
--    já cobre chave ausente — não há caminho de crash.
--
-- ===========================================================================
-- EXPLAIN (ANALYZE, BUFFERS) — rodar em `begin; ... rollback;` (DML em
-- EXPLAIN EXECUTA o comando; o rollback desfaz o INSERT de teste antes de
-- aplicar o INSERT real logo abaixo). Colar aqui a saída real, no padrão da
-- 0102, ANTES de considerar esta migration pronta para aplicar em produção:
--
--   begin;
--   explain (analyze, buffers)
--   insert into configuracoes (chave, valor, descricao) values
--    ('copiloto_sessao.timeout_ms', '20000'::jsonb, '<descrição>')
--   on conflict (chave) do nothing;
--   rollback;
--
--   -- esperado: Index Scan using configuracoes_pkey (conflict check),
--   -- Insert on configuracoes, sub-ms, sem Seq Scan.
--
-- ✅ MEDIDO em 17/09/2026 contra `fcfsnqqaphtamhrpuyoh` (produção), pelo
-- responsável da sessão — o subagente executor não tem (nem deve ter)
-- credencial de produção.
--
-- (a) ESCRITA — o INSERT desta migration, dentro de `begin; ... rollback;`
--     (EXPLAIN em DML EXECUTA; o rollback desfez o insert de teste):
--
--   Insert on configuracoes  (cost=0.00..0.01 rows=0 width=0)
--                            (actual time=0.388..0.389 rows=0 loops=1)
--     Conflict Resolution: NOTHING
--     Conflict Arbiter Indexes: configuracoes_pkey
--     Tuples Inserted: 1
--     Conflicting Tuples: 0
--     Buffers: shared hit=14 dirtied=2
--     ->  Result  (cost=0.00..0.01 rows=1 width=120)
--                 (actual time=0.002..0.002 rows=1 loops=1)
--   Planning Time: 0.135 ms
--   Trigger for constraint configuracoes_atualizado_por_fkey: time=0.283 calls=1
--   Execution Time: 0.762 ms
--
-- (b) LEITURA — o caminho QUENTE de verdade (roda até 90×/sessão, dentro do
--     `Promise.all` de `ciclo.ts`; é este plano que importa, não o do INSERT):
--
--   Index Scan using configuracoes_pkey on configuracoes
--       (cost=0.14..2.36 rows=1 width=53) (actual time=0.027..0.028 rows=0 loops=1)
--     Index Cond: (chave = 'copiloto_sessao.timeout_ms'::text)
--     Buffers: shared hit=3
--   Planning Time: 0.337 ms
--   Execution Time: 0.141 ms
--
--   (`rows=0` porque a medição correu ANTES deste INSERT ser aplicado — e é
--   justamente a prova de que o rollback de (a) desfez o insert de teste.)
--
-- VEREDITO: Index Scan pela PK nos dois caminhos, sub-ms, sem Seq Scan.
-- 0,141 ms × 2 chaves = ~0,3 ms por ciclo de IA, contra uma chamada de IA de
-- ~6.000 ms — 0,005% do tempo do ciclo. Custo desprezível para trocar duas
-- constantes hard-coded por kill-switch.
--
-- ===========================================================================

insert into configuracoes (chave, valor, descricao) values
 ('copiloto_sessao.timeout_ms', '20000'::jsonb,
  'Teto de espera por chamada de IA do copiloto, em ms (fatia 2, migration 0114). Medido em produção '
  '(14 dias, execucoes_ia, n=58): latencia_ms p99=9.246 ms, MÁXIMO=9.642 ms. Era literal 8000 em '
  '`executar-ia.ts::TIMEOUT_COPILOTO_MS` — MENOR que o próprio máximo real, causando 48% de falha '
  '(`openrouter_resposta_vazia`) numa sessão de 17/09. 20000 = 2× o máximo real medido, ainda 15× '
  'menor que IA_TIMEOUT_MS global (300000) — preserva o CONFLITO C3 (`executar-ia.ts`, topo do '
  'arquivo). Chave ausente ou valor inválido cai no fallback 8000 do código, nunca crash.'),
 ('copiloto_sessao.max_tokens', '850'::jsonb,
  'Teto de tokens de saída por chamada de IA do copiloto (fatia 2, migration 0114). Medido em '
  'produção (14 dias, execucoes_ia, n=58): tokens_saida p99=637, MÁXIMO=644. Era literal 900 em '
  '`executar-ia.ts` (maxTokens do executarComAuditoria) — 850 é deliberadamente MENOR que 900 mas '
  'MAIOR que 644×1,3≈837: corta a cauda patológica sem truncar nenhuma saída legítima observada. '
  '🔴 NUNCA baixar para 600 — o p99 real (637) já ultrapassa esse valor, truncando JSON válido e '
  'trocando timeout por conteudo_recusado. Chave ausente ou valor inválido cai no fallback 900 do '
  'código, nunca crash.')
on conflict (chave) do nothing;
