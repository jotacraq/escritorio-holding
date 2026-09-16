-- 0106_copiloto_inferencia_bloco.sql
-- Fase 12 · Fatia 1 — corrige o defeito-raiz: `montarEstadoCopiloto`/
-- `executarCicloCopiloto` recebiam o índice do bloco DA TELA
-- (`sessionStorage`), nunca "onde a advogada está agora" de fato. Se ela não
-- clicava durante a reunião, o gatilho de "virada de bloco" nunca disparava
-- e a tela afirmava que 11 partes não foram percorridas quando a conversa já
-- estava na 8ª.
--
-- ESCOPO REDUZIDO DE PROPÓSITO (2ª rodada do arquiteto): esta migration é SÓ
-- DML. NENHUMA tabela nova, NENHUMA coluna nova, NENHUM índice novo.
-- `copiloto_sugestoes.bloco_id` (0091:159) JÁ EXISTE — nasceu para
-- `desvio_sugerido` ("sugestão de pular para"), e esta fatia REINTERPRETA o
-- MESMO campo também como "bloco onde a IA entende que a conversa está"
-- (`bloco_inferido`, schema.ts) sem quebrar o significado anterior: o valor
-- gravado prioriza `bloco_inferido` quando presente, com fallback para
-- `desvio_sugerido`/o bloco de contexto quando a IA não infere nesta rodada
-- (`server/copiloto/ciclo.ts`). Cobertura acerto/erro por bloco (a "Fatia 2"
-- do desenho original, com tabela ou coluna jsonb própria) FICA DE FORA
-- desta entrega — ver o relatório da tarefa para o rascunho preservado fora
-- do diretório de migrations.
--
-- O QUE ENTRA
--   (a) configuracoes['copiloto_sessao.inferencia_bloco_ativa'] = true —
--       interruptor de reversão. Nasce LIGADO (pedido do dono, 2ª correção
--       do arquiteto): é correção de cegueira medida, não risco novo — a
--       tela sempre pôde fixar manualmente por `?bloco=`, que continua
--       funcionando e passa a ter PRECEDÊNCIA temporária sobre a inferência
--       (`copiloto_sessao.janela_fixacao_manual_segundos`, já usada por
--       `estado.ts::resolverBlocoAtual` com padrão de 300s embutido no
--       código — grava-se aqui a mesma chave para tornar o valor visível e
--       editável sem deploy, `on conflict do nothing` preserva o default se
--       já existir).
--   (b) 🔴 CORRIGIDO (achado do coordenador, medido em produção antes de
--       publicar): esta migration NÃO toca mais `prompts_versoes` — o
--       `update ... where chave='copiloto_sessao' and versao=1` que existia
--       aqui editava a versão ERRADA. Medido no banco real
--       (`fcfsnqqaphtamhrpuyoh`): `copiloto_sessao` v1 está com `ativo=false`
--       (a premissa "nunca foi ativada" está certa para a v1), mas quem está
--       ATIVA hoje é a **v2** (`ativo=true`, 4612 chars) — uma versão que
--       esta migration nem sabia que existia. Editar a v1 não teria efeito
--       nenhum em produção: a IA que roda de verdade (a v2) nunca receberia
--       o pedido de inferir o bloco, `bloco_inferido` voltaria sempre
--       ausente, e a tela ficaria em "ainda identificando…" a sessão
--       inteira — inerte, sem erro, sem alarme, só descoberto em produção.
--       A regra de `bloco_inferido` agora entra pela 0107, que cria uma
--       v3 DERIVADA do corpo da v2 (a que está ativa), nunca por UPDATE —
--       "prompt é versionado" (CLAUDE.md) volta a valer sem exceção.
--
-- SEM ENUM NOVO no schema de saída (`schema.ts::BlocoInferidoSchema`, 3
-- campos de string/número) — o risco de estourar o teto medido da gramática
-- estrita (3.905 B compila / 4.428 B não, 04/09/2026) era do `veredito` de
-- cobertura (enum de 4 valores), que ficou FORA desta entrega. Ainda assim,
-- rodar a sonda antes de qualquer ativação continua sendo regra da casa —
-- ver o relatório da tarefa para o byte count desta rodada.
--
-- MEDIÇÃO — `begin; explain (analyze, buffers) ...; rollback;` (explain em
-- DML EXECUTA o DML — 0105/0102 já erraram nisso; aqui não). Roteiro em
-- `scripts/verificacao-0106.sql`. ⚠️ ESTE AGENTE NÃO TEM ACESSO AO BANCO DE
-- PRODUÇÃO (fcfsnqqaphtamhrpuyoh) NESTA MÁQUINA — nenhuma credencial de
-- produção foi buscada nem usada. Os planos abaixo são a EXPECTATIVA
-- (mesmos predicados já provados em produção por migrations irmãs, não uma
-- medição nova desta rodada):
--   - `insert ... on conflict (chave) do nothing` em `configuracoes`:
--     `Conflict Arbiter Indexes: configuracoes_pkey` — mesmo plano colado no
--     cabeçalho da 0103/0105 para o MESMO padrão de INSERT nesta MESMA
--     tabela.
--   A tabela `prompts_versoes` não é mais tocada por ESTA migration (ver
--   0107) — nada a medir aqui além do INSERT em `configuracoes` acima.
--   A APLICAÇÃO desta migration em produção fica PENDENTE da medição real —
--   ver o relatório desta entrega.
--
-- ROLLBACK:
--   delete from configuracoes where chave = 'copiloto_sessao.inferencia_bloco_ativa';
--   delete from configuracoes where chave = 'copiloto_sessao.janela_fixacao_manual_segundos';
-- ===========================================================================


-- ===========================================================================
-- (a) Interruptores.
-- ===========================================================================
insert into configuracoes (chave, valor, descricao) values
 ('copiloto_sessao.inferencia_bloco_ativa', 'true'::jsonb,
  'Liga a INFERÊNCIA do bloco atual pelo servidor a partir de bloco_inferido '
  'na saída da IA (schema.ts), gravado em copiloto_sugestoes.bloco_id pelo '
  'ciclo automático (ciclo.ts) e lido por estado.ts::resolverBlocoAtual. '
  'Nasce TRUE (decisão do dono, Fase 12): é correção de cegueira medida em '
  'produção — antes desta fatia o gatilho de "virada de bloco" dependia só '
  'do índice que a TELA guardava em sessionStorage, e uma sessão sem clique '
  'nunca disparava esse gatilho. FALSE devolve o comportamento anterior: '
  'só a fixação manual (?bloco=, com fixado_em) decide o bloco atual, e sem '
  'ela o bloco fica indisponível (nunca inventa índice 0).'),
 ('copiloto_sessao.janela_fixacao_manual_segundos', '300'::jsonb,
  'Por quanto tempo ?bloco=<indice>&fixado_em=<iso> (correção/fixação '
  'manual da advogada) tem PRECEDÊNCIA sobre a inferência automática do '
  'bloco atual (estado.ts::resolverBlocoAtual) — 300s (5 min) desde o '
  'instante de fixado_em, contado a partir de AGORA, nunca do início da '
  'sessão. Passada a janela, a inferência volta a decidir sozinha (quando '
  'copiloto_sessao.inferencia_bloco_ativa=true) sem precisar de novo clique. '
  'Este valor já era o padrão embutido no código antes desta chave existir; '
  'grava-se aqui para ficar editável sem deploy, mesmo padrão de todo '
  'interruptor do copiloto.')
on conflict (chave) do nothing;

-- O prompt `copiloto_sessao` (v3, DERIVADA da v2 ativa) é tratado à parte,
-- na 0107 — ver o cabeçalho desta migration, item (b).
