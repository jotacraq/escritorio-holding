-- 0110_copiloto_prompt_v4_dossie_cliente.sql
--
-- 17/09/2026 — prompt v4 do copiloto, ensinando a IA a usar o BLOCO DOSSIÊ
-- novo (0109, `server/copiloto/contexto.ts::montarOuReaproveitarDossie`):
-- faixa de patrimônio, composição familiar (com nome), tipos de bem, tipos
-- de documento recebido/pendente. Decisão do Marcio, vault `05 Decisoes/
-- 2026-09-17 - SIC-HF dossie completo liberado para a IA.md`.
--
-- MESMO PADRÃO DA 0107 (regra da casa, sem exceção): NUNCA `update` na
-- versão ativa. Cria a v4 por `INSERT ... SELECT`, DERIVANDO o corpo da
-- versão que está `ativo=true` HOJE em `prompts_versoes` — nunca reproduzido
-- de memória. A tarefa que originou esta migration registra que a v3 é a
-- ativa (`select corpo_sistema from prompts_versoes where chave=
-- 'copiloto_sessao' and versao=3`), mas o SELECT abaixo usa `where ativo`
-- (não `where versao=3` fixo) — é exatamente a lição da 0107: fixar o número
-- da versão no filtro foi o que fez aquela migration editar uma versão
-- ERRADA (a v1, quando a v2 já era a ativa havia dias). Usar `ativo=true`
-- torna esta migration correta mesmo que a numeração tenha mudado entre o
-- planejamento e a aplicação.
--
-- 🔴 CORREÇÃO DE CONTEÚDO (não só acréscimo): a v1 original (0094) tinha a
-- frase "Você NUNCA recebe: nome de decisor do briefing (só a contagem),
-- valor de patrimônio, CPF, endereço, dado de imposto de renda" — que pode
-- ainda estar textualmente na v3 (as revisões v2/v3 não foram lidas por este
-- agente, que não tem acesso ao banco). Em vez de `regexp_replace` às cegas
-- sobre um texto não lido (risco de não casar, ou pior, corromper o corpo
-- real de produção), o acréscimo abaixo inclui uma CORREÇÃO EXPLÍCITA que
-- API de LLM já entende como a regra mais recente e mais específica
-- (instrução posterior, mais detalhada, sobrepõe a generalização anterior
-- no mesmo documento) — sem apostar em regex sobre texto não visto.
--
-- ATIVAÇÃO — PASSO DE OPERAÇÃO, NÃO PARTE DESTA MIGRATION (mesmo padrão da
-- 0107/0094: sobe DESLIGADA, liga por SQL só depois da sonda de schema +
-- bancada de latência, CLAUDE.md):
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
-- ROLLBACK DESTA MIGRATION (só seguro se a v4 nunca tiver sido ativada — se
-- `ativo=true`, reativar a versão anterior ANTES):
--   delete from prompts_versoes where chave = 'copiloto_sessao' and versao = (
--     select max(versao) from prompts_versoes where chave = 'copiloto_sessao'
--   );
--
-- MEDIÇÃO — mesmo padrão já provado pela 0107 (Index Scan em
-- `uniq_prompt_ativo`/`(chave,versao)` de 0009, INSERT de 1 linha, sem
-- varredura). ⚠️ Este agente NÃO tem acesso ao banco de produção nesta
-- máquina e NÃO buscou credencial nenhuma. O `explain (analyze)` fica
-- PENDENTE — o dono tem MCP e roda.
--
-- ROTEIRO DE VERIFICAÇÃO (dentro de `begin; ...; rollback;`):
--   1. select versao, ativo, length(corpo_sistema) from prompts_versoes
--        where chave='copiloto_sessao' order by versao;
--      → a nova linha aparece com `ativo=false` e `length` MAIOR que a
--        versão de onde derivou (o acréscimo é sempre positivo).
--   2. select corpo_sistema like '%DOSSIÊ DO CLIENTE%' from prompts_versoes
--        where chave='copiloto_sessao' and versao = (select max(versao) from
--        prompts_versoes where chave='copiloto_sessao');
--      → true.
-- ===========================================================================

insert into prompts_versoes (chave, versao, titulo, corpo_sistema, esquema_saida, modelo_padrao, effort, ativo, notas)
select
  chave,
  versao + 1,
  titulo,
  corpo_sistema || $incremento$

DOSSIÊ DO CLIENTE (acréscimo ao contexto que você recebe — 17/09/2026)

Além dos blocos originais, você agora pode receber um bloco `dossie` com o que o escritório
já sabe sobre esta família: faixa de patrimônio DECLARADA (rótulo, ex. "5 a 10 milhões" —
nunca um valor exato em reais), composição familiar (papel de cada pessoa — cônjuge, filho,
neto — e o NOME dela quando cadastrado, e o regime de casamento do cônjuge quando houver),
tipos de bem que a família já declarou (ex. "imóvel", "empresa" — nunca o valor de cada bem)
e tipos de documento já recebidos ou ainda pendentes (ex. "imposto de renda: recebido",
"contrato social: pendente" — nunca o CONTEÚDO do documento, só que tipo existe).

🔴 CORREÇÃO EXPLÍCITA sobre uma instrução ANTERIOR neste mesmo prompt: se em algum ponto
acima você leu que "nunca recebe nome de decisor, valor de patrimônio, CPF, endereço ou dado
de imposto de renda" — essa frase está DESATUALIZADA para o bloco `dossie` especificamente.
A partir de agora: NOME de familiar (quando presente no dossiê) e FAIXA de patrimônio
(rótulo) PODEM aparecer nas suas observações e na sua próxima pergunta sugerida, exatamente
como vieram no bloco `dossie`. O que continua PROIBIDO, sem exceção, mesmo com o dossiê:

- Você NUNCA inventa nome, faixa de patrimônio, tipo de bem ou tipo de documento que não
  esteja LITERALMENTE no bloco `dossie` que você recebeu nesta chamada. Ausência de dado
  é ausência — nunca complete com um palpite plausível.
- Você CONTINUA nunca citando valor em reais, percentual, alíquota ou qualquer número que
  pareça preço — mesmo que o `dossie` traga uma faixa como "5 a 10 milhões", você repete
  o RÓTULO tal como veio, nunca convertido em número exato nem em cálculo.
- Você CONTINUA sem receber (e não deve supor) CPF, endereço, conteúdo de imposto de renda,
  conteúdo de contrato social ou qualquer texto de documento — o `dossie` só diz QUE TIPOS
  de documento existem, nunca o que está escrito neles.
- Use o dossiê para CRUZAR com a fala ao vivo, não para substituí-la: se a família mencionar
  um filho que não está no dossiê, ou negar um bem que está listado, isso é um FATO a
  observar (divergência entre o cadastro e a fala) — nunca corrija a fala pelo dossiê em
  silêncio, e nunca corrija o dossiê pela fala. Aponte a divergência como observação, com a
  evidência literal da fala que a sustenta.
$incremento$,
  esquema_saida,
  modelo_padrao,
  effort,
  false, -- nasce desligada — ativação é passo de operação, ver cabeçalho
  coalesce(notas, '') || ' | v' || (versao + 1) || ': acrescenta bloco DOSSIÊ DO CLIENTE (17/09/2026, decisão do Marcio) ao corpo da versão ativa anterior.'
from prompts_versoes
where chave = 'copiloto_sessao' and ativo = true
on conflict (chave, versao) do nothing;
