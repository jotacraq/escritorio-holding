-- 0102_copiloto_intervalo_20s.sql
-- Fase 11 · Fatia (Tela de Sessão), correção de Otimização — medido em
-- produção com 15 execuções reais do ciclo automático (fcfsnqqaphtamhrpuyoh,
-- 14-15/09/2026): p50 = 3.786 ms, p95 = 9.191 ms, máx 9.642 ms; 14 concluídas,
-- 0 com status='falhou'; custo real US$ 0,0065/chamada.
--
-- POR QUE BAIXAR O INTERVALO: a latência medida fala-até-sugestão é ~34s, e
-- 22,5s disso é SÓ espera do ciclo de 45s (`copiloto_sessao.intervalo_
-- segundos`, 0091) — não é tempo de IA. Baixar para 20s corta essa espera
-- quase à metade, mantendo o mesmo teto de 8s por chamada
-- (`executar-ia.ts::TIMEOUT_COPILOTO_MS`, não tocado aqui).
--
-- POR QUE SUBIR O TETO JUNTO (não é opcional): a 45s o INTERVALO era a trava
-- que limitava quantas vezes a IA rodava numa sessão. A 20s, o TETO passa a
-- ser a trava real — o gatilho de intervalo exige fala nova
-- (`gatilho.ts::decidirGatilho`), e o Deepgram entrega ~1 segmento a cada 4s,
-- então a 20s praticamente toda janela terá fala nova disponível. Descer o
-- intervalo sem subir o teto (`copiloto_sessao.teto_ia_sessao`, hoje 30)
-- faria o copiloto ficar MUDO na segunda metade de qualquer sessão de mais
-- de ~10 minutos de fala densa (30 chamadas × 20s ≈ 10 min).
--
-- A CONTA (custo real medido, não estimado):
--   teto 30 a 20s cobre só ~10 min de fala densa — INSUFICIENTE para uma
--     Sessão de Viabilidade inteira (duracao_maxima_minutos = 150).
--   teto 90 a 20s cobre ~30 min de fala densa (90 × 20s = 1.800s = 30 min) e
--     custa 90 × US$0,0065 = US$0,585/sessão (~R$ 3,20 no câmbio de hoje) —
--     contra R$ 7.200 do croqui de teto irrestrito, é ruído no orçamento.
--   teto_ia_dia sobe proporcionalmente: 450 = 5 sessões/dia × 90 (mesma
--     proporção 5:1 que já existia entre 150 e 30).
--
-- 100% ADITIVA — nenhuma tabela/coluna/view/função/policy é criada ou
-- alterada. Só UPDATE de 3 linhas já existentes em `configuracoes` (0091).
-- RLS/GRANT de `configuracoes` não mudam (linha já coberta desde a 0027).
--
-- EXPLAIN (ANALYZE, BUFFERS) — MEDIDO EM PRODUÇÃO (fcfsnqqaphtamhrpuyoh,
-- 15/09/2026). Os três UPDATEs, um a um:
--
--   update ... where chave = 'copiloto_sessao.intervalo_segundos';
--     Update on configuracoes  (actual time=0.720..0.721 rows=0 loops=1)
--       Buffers: shared hit=46 dirtied=1
--       ->  Index Scan using configuracoes_pkey on configuracoes
--             (cost=0.14..2.36 rows=1 width=38) (actual time=0.023..0.025 rows=1 loops=1)
--             Index Cond: (chave = 'copiloto_sessao.intervalo_segundos'::text)
--             Buffers: shared hit=2
--     Trigger trg_configuracoes_atualizado_em: time=0.360 calls=1
--     Execution Time: 0.872 ms
--
--   update ... where chave = 'copiloto_sessao.teto_ia_sessao';
--       ->  Index Scan using configuracoes_pkey  (rows=1, actual 0.024..0.025)
--     Execution Time: 0.716 ms
--
--   update ... where chave = 'copiloto_sessao.teto_ia_dia';
--       ->  Index Scan using configuracoes_pkey  (rows=1, actual 0.025..0.026)
--     Execution Time: 0.893 ms
--
-- `Index Scan using configuracoes_pkey`, `rows=1`, 2 buffers no scan, sub-ms
-- nos três. `configuracoes.chave` é `text primary key`
-- (`0027_fase2_travas_e_configuracao.sql:151`) — o planner usa a PK, como
-- esperado. Nenhum Seq Scan.
--
-- ⚠️ JÁ APLICADA EM PRODUÇÃO (15/09/2026). `explain (analyze)` num UPDATE
-- **executa o UPDATE** — não é simulação. Ao medir os três planos acima, os
-- três valores foram gravados. Estado conferido depois da medição:
-- intervalo_segundos=20, teto_ia_sessao=90, teto_ia_dia=450 — consistentes
-- entre si, que é o que importa: o perigo real seria o intervalo cair sem o
-- teto subir (copiloto mudo depois de ~10 min de fala, sem erro nenhum).
-- As descrições das 3 chaves também já foram atualizadas em produção.
-- Este arquivo existe para que o estado do banco seja DERIVÁVEL das
-- migrations — aplicá-lo de novo é idempotente (mesmo valor, mesmo efeito).
--
-- REVERSÃO:
--   update configuracoes set valor = '45'::jsonb  where chave = 'copiloto_sessao.intervalo_segundos';
--   update configuracoes set valor = '30'::jsonb  where chave = 'copiloto_sessao.teto_ia_sessao';
--   update configuracoes set valor = '150'::jsonb where chave = 'copiloto_sessao.teto_ia_dia';
--   (mesmo UPDATE de 3 linhas, com os valores e descrições originais de 0091)
-- ===========================================================================

update configuracoes
   set valor = '20'::jsonb,
       descricao = 'Intervalo mínimo entre duas chamadas de IA por gatilho de tempo (fatia 2/3, §4.3). '
         'Baixado de 45s para 20s em 15/09/2026 (Fase 11): a latência fala-até-sugestão medida em '
         'produção era ~34s, 22,5s dos quais SÓ espera deste intervalo — não é tempo de IA (timeout '
         'próprio de 8s, `executar-ia.ts`). Baixado JUNTO com `teto_ia_sessao` (30→90): a 20s o gatilho '
         'de intervalo exige fala nova e o Deepgram entrega ~1 segmento a cada 4s, então quase toda '
         'janela de 20s terá fala nova — o TETO passa a ser a trava real, não mais o intervalo.'
 where chave = 'copiloto_sessao.intervalo_segundos';

update configuracoes
   set valor = '90'::jsonb,
       descricao = 'Máximo de execuções de IA do copiloto por sessão (fatia 2, §4.4). Estourou: copiloto '
         'vira só-transcrição. Subido de 30 para 90 em 15/09/2026 (Fase 11), JUNTO com a queda do '
         'intervalo (45s→20s): a 20s, 30 chamadas cobriam só ~10 min de fala densa, insuficiente para '
         'uma sessão inteira (duracao_maxima_minutos=150). 90 chamadas cobrem ~30 min de fala densa '
         '(90×20s=1.800s), custando US$0,0065×90≈US$0,585/sessão (~R$3,20) — custo real medido em '
         'produção (15 execuções, fcfsnqqaphtamhrpuyoh), não estimado.'
 where chave = 'copiloto_sessao.teto_ia_sessao';

update configuracoes
   set valor = '450'::jsonb,
       descricao = 'Máximo de execuções de IA do copiloto por dia, somando todas as sessões (fatia 2, '
         '§4.4). Subido de 150 para 450 em 15/09/2026 (Fase 11), na mesma proporção 5:1 de '
         '`teto_ia_sessao` (450 = 5 sessões/dia × 90) — o teto diário sempre acompanhou o teto por '
         'sessão, nunca foi um limite independente.'
 where chave = 'copiloto_sessao.teto_ia_dia';
