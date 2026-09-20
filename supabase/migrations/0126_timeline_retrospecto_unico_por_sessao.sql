-- 0126_timeline_retrospecto_unico_por_sessao.sql
--
-- O EVENTO DE TIMELINE DO RETROSPECTO — e a trava que o torna idempotente.
--
-- CONTEXTO (achado do `frontend-engineer`, 19/09/2026, sobre a 0125/Fase 13):
-- `src/lib/pasta/derivar.ts:66` decide se o item `retrospecto_sv` aparece
-- como `pronto` na Pasta do Cliente lendo `ficha.timeline.some(e => e.tipo
-- === 'retrospecto')` — o MESMO mecanismo de `analise_sessao` e
-- `transcricao`, sem query nova. A 0125 criou a tabela e o encerramento
-- passou a gravar o documento, mas NINGUÉM gravava o evento. Resultado: o
-- retrospecto existia no banco e era invisível na Pasta, preso em `falta`.
--
-- 🔴 Não era dado falso — `derivar.ts` degrada para `falta`, nunca inventa
-- `pronto`, e isso está certo. Era o padrão desta casa de "feature sem
-- migration vira invisível": o artefato existe, a tela não sabe.
--
-- ===========================================================================
-- O QUE ESTA MIGRATION FAZ (e o que NÃO faz)
-- ===========================================================================
--
-- NÃO cria tipo novo de evento: `eventos_timeline.tipo` é `text` SEM CHECK
-- (0014:11, confirmado na 0070 e reusado pela 0074 para o tipo `link`) —
-- tipo novo nunca precisou de DDL nesta base. O evento `retrospecto` passa a
-- ser gravado por `server/copiloto/retrospecto.ts::registrarRetrospectoNaTimeline`,
-- com `admin` (service_role), no MESMO caminho do documento.
--
-- FAZ uma coisa só: o ÍNDICE ÚNICO PARCIAL que torna "1 evento por sessão"
-- um INVARIANTE DE BANCO, e não disciplina de código.
--
-- POR QUE PRECISA: o documento é protegido pela PK `sessao_id` de
-- `copiloto_retrospectos` (0125) — encerrar 2× não gera 2 retrospectos. O
-- EVENTO não tem essa proteção: `eventos_timeline` é append-only, com PK
-- sintética (`id uuid default gen_random_uuid()`), e aceita quantas linhas
-- iguais lhe mandarem. Sem esta trava, qualquer caminho de escrita repetida
-- duplicaria o evento e a advogada veria o mesmo fato duas vezes no
-- Histórico. Os caminhos que existem HOJE e poderiam repetir:
--   (a) o retry de `tentarNovamenteEncerrarBotPendente` quando a sessão
--       está em `'erro'` — `marcarEncerrada` aceita `'erro'` como origem
--       (correção do Fable na Fase 10), então uma sessão pode passar pelo
--       encerramento completo mais de uma vez na vida;
--   (b) a corrida entre o clique da advogada e o ciclo automático de
--       `duracao_maxima_minutos` no mesmo segundo — `gravarRetrospectoDaSessao`
--       RELÊ o documento existente e segue em frente, e seguiria gravando o
--       evento de novo;
--   (c) qualquer chamador futuro que ninguém previu aqui.
-- Trava em código cobre (a) e (b) e deixa (c) em aberto. Trava no banco
-- cobre os três — é a mesma lição da PK da 0125.
--
-- COMO O CÓDIGO CONVIVE: `registrarRetrospectoNaTimeline` faz o INSERT e
-- trata `23505` (unique_violation) como SUCESSO — "o evento já existe" é o
-- resultado desejado, não uma falha. Nunca lança, nunca derruba o
-- encerramento (mesma disciplina de `tirarBotDaSalaSeHouver` e de
-- `server/publico/timeline-links.ts`: timeline é registro secundário).
--
-- POR QUE A CHAVE É `dados->>'sessao_id'` E NÃO `jornada_id`: hoje há no
-- máximo 1 Sessão de Viabilidade por jornada (`server/jornadas.ts` lê com
-- `maybeSingle`), então os dois dariam o mesmo resultado. `sessao_id` é a
-- chave CERTA porque o retrospecto é DA SESSÃO — se um dia uma jornada tiver
-- duas sessões, cada uma tem o seu evento, e um índice por `jornada_id`
-- estaria silenciosamente errado. `->>` sobre `jsonb` é IMMUTABLE, então
-- serve de expressão de índice.
--
-- ===========================================================================
-- AS 5 PERGUNTAS DO PROTOCOLO DE SUSTENTABILIDADE
-- ===========================================================================
--
-- 1. Escala — índice parcial: só indexa linhas com `tipo = 'retrospecto'`,
--    que são ~1 por sessão encerrada (3 hoje, ~1/dia). Medido em 19/09/2026
--    em produção: `eventos_timeline` tem **52 linhas no total** e **ZERO**
--    com `tipo = 'retrospecto'` (tipos existentes: agendamento 14, patrimonio
--    9, familia 6, ligacao 5, transcricao 4, etapa 4, briefing 3, mensagem 3,
--    formulario 2, pagamento 2). O índice nasce vazio.
--
-- 2. Índice — é o próprio objeto desta migration. Não substitui
--    `idx_timeline_jornada (jornada_id, ocorrido_em desc)` (0014), que
--    continua sendo quem serve a leitura da Ficha 360; este só existe para a
--    UNICIDADE.
--
-- 3. Frequência — 1 INSERT por sessão encerrada. Zero leitura nova: quem lê
--    o evento é a Ficha 360, na query de timeline que JÁ existe.
--
-- 4. Repetição — é exatamente o que esta migration impede.
--
-- 5. Reversão — `drop index if exists uniq_timeline_retrospecto_sessao;`.
--    Reverter NÃO apaga evento nenhum (índice não guarda dado) e não
--    desliga a feature: o kill-switch continua sendo
--    `copiloto_sessao.retrospecto_ativo` (0125), que já governa documento E
--    evento no mesmo `if`.
--
-- 🔴 BACKFILL: NENHUM, e desta vez nem é escolha — não existe uma linha
-- sequer de `tipo='retrospecto'` para reclassificar (medido acima: 0 de 52).
-- As 3 sessões já encerradas não ganham retrospecto retroativo (decisão da
-- 0125) e, portanto, não ganham evento retroativo: um evento de timeline
-- carimbado hoje sobre uma sessão de anteontem mentiria sobre QUANDO o fato
-- aconteceu, que é a única coisa que uma linha do tempo promete.
--
-- ⚠️ SE UM DIA O `create unique index` ABAIXO FALHAR com 23505, NÃO
-- remova a unicidade para "destravar o deploy": significa que já existem
-- eventos duplicados, e apagar o índice esconderia o defeito em vez de
-- corrigi-lo. O caminho é apagar as duplicatas (mantendo a mais antiga, que
-- é a que tem o `ocorrido_em` verdadeiro) e só então criar o índice.
--
-- ROTEIRO DE VERIFICAÇÃO: scripts/verificacao-0126.sql (tudo com rollback).
--
-- ROLLBACK:
--   drop index if exists uniq_timeline_retrospecto_sessao;
-- ===========================================================================

create unique index if not exists uniq_timeline_retrospecto_sessao
  on eventos_timeline ((dados->>'sessao_id'))
  where tipo = 'retrospecto';

comment on index uniq_timeline_retrospecto_sessao is
  'Fase 13 (19/09/2026) — 1 evento de timeline tipo=retrospecto por SESSAO, '
  'como invariante de banco. O documento (copiloto_retrospectos) ja e unico '
  'pela PK sessao_id (0125); o evento nao tinha trava nenhuma, e '
  'eventos_timeline aceita linhas iguais. Encerrar 2x (retry de sessao em '
  'estado erro, ou corrida entre o clique e o ciclo automatico) duplicaria o '
  'fato no Historico da advogada. Escrito por server/copiloto/retrospecto.ts'
  '::registrarRetrospectoNaTimeline, que trata 23505 como SUCESSO ("o evento '
  'ja existe" e o resultado desejado). Chave = dados->>''sessao_id'' e nao '
  'jornada_id: o retrospecto e DA SESSAO.';
