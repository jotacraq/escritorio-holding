-- 0103_copiloto_papeis_de_fala.sql
-- Fase 11 · Fatia (Tela de Sessão) — Papéis de fala. Fecha a cegueira medida
-- em produção: 128 segmentos com o nome PRÓPRIO gravado certo
-- ("João CSM") chegavam à IA como "participante:", porque
-- `contexto.ts::PAPEIS_CONHECIDOS` só conhecia "advogada"/"cliente" — nunca
-- casava com nome próprio (`select falante, origem, count(*) from
-- sessoes_copiloto_segmentos group by 1,2` → "João CSM"/bot/128, 15/09/2026).
--
-- 100% ADITIVA. Nenhuma tabela, coluna, view, função ou policy existente é
-- alterada. Só ACRESCENTA 1 chave nova em `configuracoes` — mesma tabela e
-- mesmo padrão de todos os interruptores do copiloto (0091, 0097, 0098,
-- 0100). `sessoes_copiloto.participantes` (jsonb, 0091) já comporta o campo
-- novo `papel` sem DDL nenhum — é só um formato novo de item dentro do
-- array, gravado por `server/copiloto/participantes.ts::aplicarEventoParticipante`.
--
-- O QUE ENTRA
--   configuracoes['copiloto_sessao.papeis_de_fala'] = 'true' — interruptor
--   de reversão. `false` faz `contexto.ts::rotuloFalante` ignorar o mapa de
--   papéis e voltar ao comportamento de hoje (fallback "participante" para
--   nome próprio, "advogada"/"cliente" só no caminho manual). Nasce TRUE —
--   decisão do dono (15/09/2026): é correção de cegueira, não risco novo
--   sendo ligado (a IA hoje já não distingue ninguém na sala; ligar o mapa
--   não abre nenhuma superfície que não existisse — o NOME continua nunca
--   saindo de `contexto.ts`, só o papel estável). Se o dono discordar do
--   valor inicial, é um UPDATE de 1 linha, sem nova migration.
--
-- POR QUE NÃO PRECISA DE ÍNDICE NOVO: o predicado de leitura é sempre
-- `where chave = $1` — `configuracoes.chave` é `text primary key`
-- (0027_fase2_travas_e_configuracao.sql:151). Mesmo caminho de leitura
-- (`Index Scan using configuracoes_pkey`) de toda chave existente da tabela;
-- não há WHERE novo que um índice parcial precisasse provar.
--
-- EXPLAIN (ANALYZE, BUFFERS) — MEDIDO EM PRODUÇÃO (fcfsnqqaphtamhrpuyoh,
-- 15/09/2026), DENTRO DE `begin; ... rollback;` — ou seja, o plano é real e
-- NADA foi gravado pela medição:
--
--   Insert on configuracoes  (cost=0.00..0.01 rows=0 width=0)
--                            (actual time=0.471..0.471 rows=0 loops=1)
--     Conflict Resolution: NOTHING
--     Conflict Arbiter Indexes: configuracoes_pkey
--     Tuples Inserted: 1
--     Conflicting Tuples: 0
--     Buffers: shared hit=14 dirtied=2
--     ->  Result  (cost=0.00..0.01 rows=1 width=120) (actual time=0.002..0.002 rows=1 loops=1)
--   Planning Time: 0.146 ms
--   Trigger for constraint configuracoes_atualizado_por_fkey: time=0.297 calls=1
--   Execution Time: 0.854 ms
--
-- `Conflict Arbiter Indexes: configuracoes_pkey` — o `on conflict (chave)`
-- usa a PK, como esperado. Sub-ms. Nenhum Seq Scan.
--
-- 🔑 POR QUE DENTRO DE TRANSAÇÃO: `explain (analyze)` em DML **executa o
-- DML**. Na 0102 isso gravou os 3 UPDATEs sem intenção (está registrado no
-- cabeçalho de lá). Para DML, medir sem aplicar exige
-- `begin; explain (analyze) ...; rollback;` — foi o que se fez aqui.
--
-- APLICADA EM PRODUÇÃO em 15/09/2026, depois da medição, por
-- `apply_migration`. Conferido: `copiloto_sessao.papeis_de_fala = true`.
--
-- ROLLBACK:
--   delete from configuracoes where chave = 'copiloto_sessao.papeis_de_fala';
-- ===========================================================================

insert into configuracoes (chave, valor, descricao) values
 ('copiloto_sessao.papeis_de_fala', 'true'::jsonb,
  'Interruptor de reversão do mapa de papéis de fala (Fase 11, Tela de '
  'Sessão, 15/09/2026). TRUE liga a resolução de papel na ESCRITA '
  '(server/copiloto/participantes.ts::resolverPapelNoJoin, chamada por '
  'entrada-bot.ts no join) e o consumo do mapa na LEITURA '
  '(contexto.ts::rotuloFalante) — advogada (is_host), decisor_N (casa sem '
  'ambiguidade com processo_decisorio.decisores do briefing, N pela ordem '
  'do briefing), acompanhante_N (resto). FALSE volta ao comportamento '
  'anterior: nome próprio de falante sempre cai em "participante" genérico '
  '(fallback de PAPEIS_CONHECIDOS, que só reconhece "advogada"/"cliente" do '
  'caminho manual). Nasce TRUE: é correção de cegueira medida em produção '
  '(128 segmentos com nome certo chegavam à IA como "participante:"), não '
  'um risco novo — o NOME continua nunca saindo de contexto.ts, só o papel.')
on conflict (chave) do nothing;
