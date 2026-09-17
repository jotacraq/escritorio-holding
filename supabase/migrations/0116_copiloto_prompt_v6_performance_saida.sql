-- 0116_copiloto_prompt_v6_performance_saida.sql
--
-- 17/09/2026 — prompt v6 do copiloto: NÃO acrescenta capacidade nova (dossiê,
-- inventário, inferência de bloco ficam intactos). É pura performance ×
-- resultado, pedido do dono a partir de medição real de 14 dias
-- (`execucoes_ia`, claude-sonnet-5, n=82): 15,4 ms por token de SAÍDA,
-- corr(tokens_saida, latencia_ms) = 0,80. Cortar chars de SAÍDA é o único
-- corte que rende — entrada não-cacheada tem corr=0,43 e 5.851 de 7.352
-- tokens de entrada já vêm do cache.
--
-- TRÊS CORTES, cada um investigado contra o código antes de virar instrução
-- de prompt (regra da casa: "alinhe o prompt ao teto do validador, nunca o
-- contrário"):
--
-- CORTE 1 — para de gerar `campos_evidencia_nao_conferida`.
--   Achado: esse campo NÃO existe em `SugestaoCopilotoIaSchema`
--   (server/copiloto/schema.ts:115-123, conferido nesta sessão) — a IA o
--   emite espontaneamente porque o prompt v1 (0094) mostra um exemplo de
--   saída com esse nome de campo. `validar.ts:268` RECONSTRÓI o campo
--   inteiro no servidor (`camposNaoConferidos`, conferindo cada evidência
--   por substring contra a transcrição real) — o que a IA gerou é
--   DESCARTADO, nunca lido. Medição do dono: ~125 chars médios por chamada
--   pagos por nada.
--   Estimativa de ganho: 125 chars ÷ 4 = 31,25 tokens × 15,4 ms = ~481 ms/chamada.
--
-- CORTE 2 — teto de 12 palavras em `proxima_pergunta.motivo`.
--   Achado: `validar.ts` já corta esse campo por CARACTERE
--   (`TETO_MOTIVO_PERGUNTA = 200`, schema.ts:130) mas não por palavra — hoje
--   a IA escreve frase completa (média medida: 102 chars) e o corte de 200
--   chars nunca é acionado. O campo é exibido em fonte menor
--   (PainelCopiloto.tsx:838-841, `sugestao.proxima_pergunta.motivo`) —
--   mantido, só enxuto. Não criei constante nova em schema.ts/validar.ts:
--   o teto de palavras é regra de PROMPT (mesma arquitetura dos tetos de
--   caractere, que também são só de prompt + corte defensivo pós-Zod), não
--   dá para validar contagem de palavras sem reescrever o texto — o
--   validador já corta por caractere como rede de segurança.
--   Estimativa de ganho: 12 palavras × ~7 chars/palavra (média pt-BR com
--   espaço) ≈ 84 chars-alvo contra 102 medidos = 18 chars economizados ÷ 4
--   = 4,5 tokens × 15,4 ms = ~69 ms/chamada.
--
-- CORTE 3 — `falta_no_bloco`: CONFERIDO, sem mudança de número.
--   Achado: o prompt v1 (0094) já diz "lista de até 4 itens" e o validador
--   já aplica `MAX_ITENS_FALTA_NO_BLOCO = 4` (schema.ts:139) — prompt e
--   validador JÁ estão alinhados. Não havia desalinhamento a corrigir (o
--   caso hipotético do brief — "gerar 6 para o servidor descartar 3" — não
--   se confirmou nesta base). Reforcei a instrução existente com uma frase
--   objetiva ("não gere mais que 4 — o servidor descarta o excedente sem
--   usar, é gasto sem retorno") para reduzir a chance de o modelo ignorar o
--   teto por diluição em meio ao resto do prompt v1-v5. Ganho estimado: 0 ms
--   hoje (nenhum char cortado); efeito é blindagem contra regressão futura.
--
-- GANHO TOTAL ESTIMADO: ~481 + ~69 = ~550 ms/chamada (~10% da latência média
-- medida de 5.476 ms). Não inclui corte 3 (blindagem, não redução).
--
-- MESMO PADRÃO DA 0107/0110/0112 (regra da casa, sem exceção): NUNCA
-- `update` na versão ativa. Cria a v6 por `INSERT ... SELECT`, DERIVANDO do
-- `max(versao)` — NÃO de `ativo = true`. A v4 (dossiê) nasceu desligada
-- (mesmo padrão) e `ativo = true` hoje aponta para uma versão anterior à v5;
-- derivar da ativa faria a v6 nascer SEM o inventário mencionado (0112) e
-- sem o dossiê (0110) — mesma armadilha já documentada na 0112.
--
-- ATIVAÇÃO — PASSO DE OPERAÇÃO, NÃO PARTE DESTA MIGRATION:
--   begin;
--     update prompts_versoes set ativo = false where chave = 'copiloto_sessao' and ativo = true;
--     update prompts_versoes set ativo = true  where chave = 'copiloto_sessao' and versao = (
--       select versao from prompts_versoes where chave = 'copiloto_sessao'
--       order by versao desc limit 1
--     );
--   commit;
--   -- `uniq_prompt_ativo` (0009, unique parcial em (chave) where ativo) exige
--   -- desativar a anterior ANTES (ou na mesma transação).
--
-- ROLLBACK DA ATIVAÇÃO: reativar a versão anterior pelo mesmo padrão acima,
-- trocando os dois `where`.
--
-- ROLLBACK DESTA MIGRATION (só seguro se a v6 nunca tiver sido ativada — se
-- `ativo=true`, reativar a versão anterior ANTES):
--   delete from prompts_versoes where chave = 'copiloto_sessao' and versao = (
--     select max(versao) from prompts_versoes where chave = 'copiloto_sessao'
--   );
--
-- AS 5 PERGUNTAS DO PROTOCOLO (~/.claude/PROTOCOLO-SUSTENTABILIDADE.md):
--   1. Escala — não aplicável a volume de linha: é 1 INSERT de 1 linha nova
--      em `prompts_versoes`, tabela de dezenas de linhas (uma por versão de
--      prompt já criada nesta base), não cresce com uso do sistema.
--   2. Índice — o INSERT usa `uniq_prompt_ativo (chave) where ativo` (fica
--      false, não conflita) e a PK/índice `(chave, versao)`; o SELECT do
--      `max(versao)` e do `where chave=... and versao=(select max...)` usa
--      o mesmo índice de `(chave, versao)` já provado pela 0107/0110/0112.
--      Sem varredura de tabela grande — `prompts_versoes` inteira cabe em
--      poucas dezenas de linhas.
--   3. Frequência — migration roda 1x, na aplicação. Em runtime, o prompt é
--      lido 1x por chamada de IA do copiloto (mesmo caminho de sempre,
--      inalterado por esta migration) — o ganho de latência é POR CHAMADA
--      de IA, não introduz chamada nova.
--   4. Repetição — não aplicável: não há N telas pedindo a mesma coisa aqui,
--      é texto de prompt lido uma vez por execução de IA.
--   5. Reversão — sim, dois níveis: (a) a versão nasce `ativo=false`, então
--      "desligar" é simplesmente NÃO ativar; (b) se já ativada e precisar
--      reverter, `delete`/reativação da anterior documentados acima, sem
--      deploy de código (é só dado em `prompts_versoes`).
--
-- MEDIÇÃO — `explain (analyze)`: PENDENTE. Este agente não tem credencial de
-- banco de produção nesta máquina e não buscou nenhuma (regra da casa —
-- nunca buscar credencial de produção por conta própria). O padrão de plano
-- já foi medido e confirmado nas migrations 0107/0110/0112 (Index Scan em
-- `uniq_prompt_ativo`/`(chave,versao)`, INSERT de 1 linha) — esta migration
-- repete exatamente a mesma forma de `INSERT ... SELECT`, sem predicado novo
-- nem índice novo. O dono roda com MCP e cola o resultado real aqui antes de
-- aplicar, caso queira confirmar de novo.
--
-- ROTEIRO DE VERIFICAÇÃO (dentro de `begin; ...; rollback;`):
--   1. select versao, ativo, length(corpo_sistema) from prompts_versoes
--        where chave='copiloto_sessao' order by versao;
--      → a nova linha aparece com `ativo=false` e `length` MAIOR que a
--        versão de onde derivou (é um acréscimo de texto, não substituição).
--   2. select corpo_sistema like '%AJUSTES DE FORMATO — v6%' from
--        prompts_versoes where chave='copiloto_sessao' and versao = (select
--        max(versao) from prompts_versoes where chave='copiloto_sessao');
--      → true.
--   3. select corpo_sistema not like '%campos_evidencia_nao_conferida%'... —
--      NÃO É POSSÍVEL testar "ausência de instrução para gerar o campo" por
--      LIKE, porque o prompt v1 nunca usa esse nome de campo no texto (ele
--      aparece só no EXEMPLO implícito da lista de 5 campos da seção "A
--      SAÍDA"); o corte 1 é comportamental (instrução explícita de NÃO
--      emitir um 6º campo), não removível por string matching. Confirmar
--      por teste real de chamada (bancada de custo/latência, já prevista
--      para antes da ativação) que o campo deixou de aparecer na resposta.
-- ===========================================================================

insert into prompts_versoes (chave, versao, titulo, corpo_sistema, esquema_saida, modelo_padrao, effort, ativo, notas)
select
  chave,
  versao + 1,
  titulo,
  corpo_sistema || $incremento$

AJUSTES DE FORMATO — v6 (17/09/2026, performance × resultado)

Estas três instruções REFINAM o formato de saída descrito acima — não removem nenhuma
capacidade (dossiê, inventário mencionado e inferência de bloco continuam exatamente como
descrito nas seções anteriores). O objetivo é só reduzir texto gerado sem valor de leitura:
cada caractere que você escreve tem custo de tempo real para a advogada, que está com o
cliente na sala esperando a sugestão aparecer.

1. NÃO gere um campo `campos_evidencia_nao_conferida` (ou qualquer nome parecido) na sua
   saída. Isto NUNCA fez parte do formato de 5 campos descrito acima e nunca foi lido — o
   servidor calcula essa informação sozinho, a partir da sua própria saída, depois que você
   responde. Se você estava gerando esse campo, pare: é texto que ninguém lê.

2. `proxima_pergunta.motivo`: no máximo 12 palavras. Não é uma frase completa com sujeito e
   contexto — é um lembrete telegráfico do porquê ("decisor ainda não confirmou presença",
   "bloco exige confirmação de todos os sócios"). A advogada já está olhando o `texto` da
   pergunta em destaque; o motivo é só a justificativa em fonte menor, ao lado.

3. `falta_no_bloco`: no máximo 4 itens, sempre. Nunca gere um 5º ou 6º item "para garantir"
   — o servidor descarta qualquer item além do 4º sem usar. Se há mais de 4 lacunas reais no
   bloco atual, escolha as 4 mais relevantes; gerar mais que isso é texto pago e descartado,
   sem nenhum ganho para a advogada.
$incremento$,
  esquema_saida,
  modelo_padrao,
  effort,
  false, -- nasce desligada — ativação é passo de operação, ver cabeçalho
  coalesce(notas, '') || ' | v' || (versao + 1) || ': performance x resultado (17/09/2026) — '
  || 'para de gerar campos_evidencia_nao_conferida (descartado no servidor, ~481ms/chamada), '
  || 'teto de 12 palavras em proxima_pergunta.motivo (~69ms/chamada), reforca teto de 4 itens '
  || 'ja existente em falta_no_bloco (blindagem, sem ganho de chars). Nenhuma capacidade removida.'
from prompts_versoes
-- 🔴 17/09 (backend-engineer): deriva da MAIOR versão existente, NÃO da
-- ativa — mesmo raciocínio da 0112 (a v4/dossiê nasceu desligada; se esta
-- migration derivasse de `ativo=true`, a v6 sairia sem dossiê E sem
-- inventário mencionado, e ativar a v6 desligaria as duas features).
where chave = 'copiloto_sessao'
  and versao = (select max(versao) from prompts_versoes where chave = 'copiloto_sessao')
on conflict (chave, versao) do nothing;
