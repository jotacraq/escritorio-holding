-- 0112_copiloto_prompt_v5_inventario_mencionado.sql
--
-- 17/09/2026 — prompt v5 do copiloto, ensinando a IA a levantar o
-- INVENTÁRIO MENCIONADO na fala (0111, `server/copiloto/schema.ts::
-- ItemInventarioMencionadoSchema` — campo `inventario_mencionado[]`).
-- Reproduz o padrão do script oficial (`tmp/script-sv-oficial.md`, PARTE
-- 03) e do dossiê de exemplo (`tmp/dossie-exemplo-maria.md` §5): quantos ·
-- de quem · ordem de grandeza, por categoria, e a distinção central do
-- pedido do dono — posse PRÓPRIA (conta) × menção de TERCEIRO (não conta).
--
-- MESMO PADRÃO DA 0107/0110 (regra da casa, sem exceção): NUNCA `update` na
-- versão ativa. Cria a v5 por `INSERT ... SELECT`, DERIVANDO o corpo da
-- versão que está `ativo=true` HOJE em `prompts_versoes` — nunca reproduzido
-- de memória. Usa `where ativo` (não `where versao=N` fixo) — mesma lição da
-- 0107: fixar o número de versão no filtro é o que causou uma migration
-- editar a versão ERRADA quando a numeração já tinha avançado entre o
-- planejamento e a aplicação.
--
-- ATIVAÇÃO — PASSO DE OPERAÇÃO, NÃO PARTE DESTA MIGRATION (mesmo padrão da
-- 0107/0110/0094: sobe DESLIGADA, liga por SQL só depois da sonda de schema
-- + bancada de latência, CLAUDE.md):
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
-- ROLLBACK DESTA MIGRATION (só seguro se a v5 nunca tiver sido ativada — se
-- `ativo=true`, reativar a versão anterior ANTES):
--   delete from prompts_versoes where chave = 'copiloto_sessao' and versao = (
--     select max(versao) from prompts_versoes where chave = 'copiloto_sessao'
--   );
--
-- MEDIÇÃO — mesmo padrão já provado pela 0107/0110 (Index Scan em
-- `uniq_prompt_ativo`/`(chave,versao)` de 0009, INSERT de 1 linha, sem
-- varredura). ⚠️ Este agente NÃO tem acesso ao banco de produção nesta
-- máquina e NÃO buscou credencial nenhuma. O `explain (analyze)` fica
-- PENDENTE — o dono tem MCP e roda.
--
-- 🔴 PRÉ-REQUISITO DE ATIVAÇÃO: o SCHEMA que vale em runtime é
-- `SugestaoCopilotoIaSchema` (server/copiloto/schema.ts), passado por
-- `executar-ia.ts` a cada chamada — `prompts_versoes.esquema_saida` é
-- METADADO/registro (lido por `/api/admin/prompts` para exibição, nunca
-- pelo caminho de execução real do copiloto), não a fonte que o provedor
-- recebe. Ou seja, o campo `inventario_mencionado[]` já vale assim que ESTE
-- DEPLOY sobe, independente de qual VERSÃO de prompt está ativa — o que
-- esta migration ativa/desativa é só o TEXTO que instrui a IA a USAR o
-- campo (sem o texto, o campo existe no schema mas a IA não sabe que deve
-- preenchê-lo, e `[]` — vazio — é um resultado válido e esperado). Rodar
-- `POST /api/admin/sonda-schema {"chave":"copiloto"}` ANTES de ativar esta
-- versão — a medição local (script ad-hoc, mesmo helper) deu 2.019 B para o
-- schema completo com os 2 enums novos (categoria/posse), abaixo do teto
-- conhecido (3.905 B compila) — a sonda contra o provedor real é quem
-- confirma.
--
-- ROTEIRO DE VERIFICAÇÃO (dentro de `begin; ...; rollback;`):
--   1. select versao, ativo, length(corpo_sistema) from prompts_versoes
--        where chave='copiloto_sessao' order by versao;
--      → a nova linha aparece com `ativo=false` e `length` MAIOR que a
--        versão de onde derivou.
--   2. select corpo_sistema like '%INVENTÁRIO PATRIMONIAL MENCIONADO%' from
--        prompts_versoes where chave='copiloto_sessao' and versao = (select
--        max(versao) from prompts_versoes where chave='copiloto_sessao');
--      → true.
-- ===========================================================================

insert into prompts_versoes (chave, versao, titulo, corpo_sistema, esquema_saida, modelo_padrao, effort, ativo, notas)
select
  chave,
  versao + 1,
  titulo,
  corpo_sistema || $incremento$

INVENTÁRIO PATRIMONIAL MENCIONADO (acréscimo ao contexto que você recebe — 17/09/2026)

Você agora preenche `inventario_mencionado[]` sempre que a fala dos últimos ~90s mencionar
um bem — imóvel, empresa, investimento ou outro ativo — seguindo o mesmo padrão da PARTE 03
da Sessão de Viabilidade: quantos, de quem, ordem de grandeza. Para CADA item mencionado:

- `categoria`: "imovel", "empresa", "investimento" ou "outro" (previdência, seguro, patrimônio
  no exterior).
- `descricao`: um rótulo curto do bem exatamente como foi dito ("sala comercial no centro",
  "construtora", "uns 30% da empresa da família") — nunca invente detalhe que não foi dito.
- `titularidade`: de quem é, como foi dito ("do casal", "dela e dos 2 irmãos") — `null` quando
  ninguém disse de quem é.
- `posse`: esta é a distinção MAIS IMPORTANTE deste bloco.
  - `"propria"`: o decisor trata o bem como patrimônio PRÓPRIO ou DA FAMÍLIA que está na
    sessão — é isto que conta no levantamento do escritório.
  - `"terceiro"`: o bem é de OUTRA pessoa fora da família em questão — um genro, um ex-sócio,
    uma empresa onde o cliente já trabalhou mas não é dono. Nunca marque como "propria" só
    porque o bem foi mencionado na conversa.
  - `"incerta"`: você não tem como saber pela fala se é patrimônio da família ou de terceiro.
    NA DÚVIDA ENTRE "propria" E "incerta", USE SEMPRE "incerta" — errar para o lado cauteloso
    é a regra: um item marcado "propria" por engano conta num total que a advogada vai repetir
    de volta para o cliente.
- `valor_mencionado`: a ordem de grandeza tal como foi dita ("uns 800 mil", "na faixa de 2
  milhões") — texto literal, NUNCA um número calculado ou convertido, mesmo que pareça óbvio.
  `null` quando nenhum valor foi mencionado.
- `evidencia`: a citação literal da fala que sustenta este item — sem uma frase real dita na
  janela de transcrição, o item NÃO EXISTE. Nunca proponha um item de inventário sustentado só
  pelo dossiê ou por inferência sua; a evidência tem que ser algo que alguém disse agora.

Você também recebe, quando disponível, um bloco `inventario_resumo` com o que JÁ foi levantado
nesta sessão (contagem por categoria, quantos ainda estão sem titularidade). Use-o para NÃO
repetir pergunta sobre um bem já registrado, e para notar o que falta — por exemplo, sugerir a
pergunta de titularidade quando o resumo mostrar itens de posse própria sem ela.

PROIBIÇÕES que já valiam continuam valendo aqui: nunca cite valor em reais formatado, alíquota
ou percentual — mesmo que o cliente tenha dito "uns 800 mil", você repete esse texto tal como
foi dito, nunca "R$ 800.000,00" nem qualquer cálculo sobre ele.
$incremento$,
  esquema_saida,
  modelo_padrao,
  effort,
  false, -- nasce desligada — ativação é passo de operação, ver cabeçalho
  coalesce(notas, '') || ' | v' || (versao + 1) || ': acrescenta inventario_mencionado (17/09/2026, pedido do dono — contagem de patrimonio "de fato").'
from prompts_versoes
-- 🔴 17/09 (coordenador): deriva da MAIOR versão existente, NÃO da ativa.
-- A v4 (dossiê) nasceu desligada, então `ativo = true` ainda aponta para a v3
-- e a v5 sairia SEM o bloco do dossiê — as duas features ficariam em versões
-- que nunca se encontram, e ligar uma desligaria a outra.
where chave = 'copiloto_sessao'
  and versao = (select max(versao) from prompts_versoes where chave = 'copiloto_sessao')
on conflict (chave, versao) do nothing;
