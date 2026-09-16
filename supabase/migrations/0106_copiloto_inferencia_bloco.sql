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
--   (b) `update prompts_versoes` na v1 do prompt `copiloto_sessao` (0094) —
--       ACRÉSCIMO da regra de `bloco_inferido` ao corpo do prompt existente.
--       🔴 EXCEÇÃO DELIBERADA à regra da casa "prompt é versionado, nunca
--       editado" (CLAUDE.md): esta v1 NUNCA foi ativada em produção
--       (`ativo=false` desde que nasceu, nenhuma sonda rodada, nenhuma
--       execução de IA gerada com ela — conferido: 0 outras linhas de
--       `prompts_versoes` para a chave `copiloto_sessao` além desta).
--       Editar uma versão que nunca produziu histórico não corrompe
--       auditoria nenhuma; CRIAR uma v2 aqui obrigaria a próxima ativação a
--       escolher entre v1 (sem a regra) e v2 (com ela) sem necessidade — o
--       pedido explícito do arquiteto foi "update da v1, não v2". Da PRÓXIMA
--       vez que este prompt precisar mudar DEPOIS de ativado, a regra volta
--       a valer sem exceção: nova versão, nunca update.
--
-- REGRA NOVA NO PROMPT (texto, não schema — mesmo padrão de todo o resto do
-- corpo do prompt 0094, que já vive fora do JSON Schema estrito):
--   "`bloco_inferido.bloco_id` só pode ser id presente na lista de blocos
--   que você recebeu; se a fala dos últimos 90 segundos não permitir
--   identificar com segurança em que bloco a conversa está, devolva `null`
--   — nunca o bloco anterior por inércia."
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
--   - `update prompts_versoes ... where chave=$1 and versao=$2`: Index Scan
--     sobre a unique `(chave, versao)` (0009) — é a mesma chave que TODO
--     `insert ... on conflict (chave, versao) do nothing` já usa nesta
--     tabela (0042, 0059, 0066, 0090, 0094); um UPDATE pelo mesmo par usa o
--     MESMO índice pelo MESMO motivo (igualdade nas duas colunas da unique).
--   A APLICAÇÃO desta migration em produção fica PENDENTE da medição real —
--   ver o relatório desta entrega.
--
-- ROLLBACK (ordem inversa; o UPDATE do prompt é reversível só se o texto
-- anterior for preservado por quem aplicar — colado abaixo por segurança):
--   -- corpo_sistema ANTERIOR ao UPDATE: ver supabase/migrations/0094_prompt_copiloto.sql
--   -- (o texto completo da v1 original está naquele arquivo, intacto — esta
--   -- migration não o modifica, só ACRESCENTA a seção nova ao final).
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


-- ===========================================================================
-- (b) Atualiza o CORPO do prompt v1 `copiloto_sessao` (0094) — EXCEÇÃO
-- deliberada e justificada no cabeçalho acima (v1 nunca ativada, sem
-- histórico de execução). Acrescenta a saída `bloco_inferido` e a regra
-- dura de "nunca o bloco anterior por inércia". `ativo` continua FALSE
-- (nenhuma linha desta migration muda essa coluna) — a ativação segue
-- dependendo da sonda de schema + bancada de latência, como sempre.
-- ===========================================================================
update prompts_versoes
   set corpo_sistema = corpo_sistema || $incremento$

FASE 12 — INFERÊNCIA DO BLOCO ATUAL (acréscimo ao contrato de saída acima)

Além dos 5 campos originais, sua saída agora tem um 6º campo, `bloco_inferido`, que responde a
uma pergunta DIFERENTE de `desvio_sugerido`: não "para onde a sessão deveria ir", mas "em que
bloco do roteiro a conversa está AGORA, a julgar pela fala dos últimos ~90 segundos".

- `bloco_inferido`: objeto com `bloco_id` (de um bloco que existe LITERALMENTE na lista de
  blocos do roteiro ativo que você recebeu), `confianca` (0 a 1) e `evidencia` (uma citação
  literal da janela de transcrição que sustenta a inferência, até 200 caracteres) — ou nulo.

REGRA DURA, sem exceção: `bloco_inferido.bloco_id` só pode ser um id presente na lista de
blocos que você recebeu. Se a fala dos últimos 90 segundos não permitir identificar com
segurança em que bloco a conversa está, devolva `bloco_inferido: null` — NUNCA o bloco
anterior por inércia, e nunca um palpite sem uma citação literal que o sustente. Um
`bloco_inferido` errado move o ponteiro que a advogada vê na tela; "não sei" aqui é sempre
preferível a um palpite fraco disfarçado de fato.
$incremento$
 where chave = 'copiloto_sessao' and versao = 1;
