# Custo da IA

Onde o dinheiro do SIC-HF é queimado, o que já foi **medido** e qual alavanca
funciona de verdade. O diário registra o dia; aqui fica o que vale sempre.

## A conta de um briefing

Mesma jornada, mesma entrada, medido em producao em 04/09/2026. So muda o
`effort` da linha ativa de `prompts_versoes` — nenhum deploy entre as tres.

| effort | raciocinio | saida | custo | latencia | briefing entregue |
|---|---|---|---|---|---|
| high | 7.611 | 11.137 | **US$ 0,1241** | 105s | 8.742 chars |
| **medium** | 933 | 4.218 | **US$ 0,0549** | 49s | 8.198 chars |
| low | 0 | 2.697 | **US$ 0,0397** | 31s | 6.703 chars |

**`medium` e o ponto de operacao, e e o que esta ativo.** Custa 56% menos que
`high` e entrega um documento praticamente do mesmo tamanho — o `high` queima
7.611 tokens pensando para produzir um briefing MENOR. Estrutura preservada nos
tres: mesmo numero de objecoes, de evidencias de DISC e de lacunas.

`low` corta mais um terco do preco, mas encurta o texto de verdade (resumo
executivo de 810 para 511 caracteres). Fica como opcao para entrada pobre, nao
como padrao.

Ressalva honesta: **n=1 por degrau, numa jornada de exemplo com completude 40**
(entrada fraca). Em cliente real com formulario e ligacao completos o `high`
pode justificar o preco. Quem confirma isso e `scripts/bancada-ia.ts`, com
varias jornadas e gate objetivo.

O `agente_croqui_analise` **continua em `high` e nao foi medido** — nao mudei
por analogia. Medir antes de mexer.

Historico: o baseline de 04/09 04:25 custava US$ 0,1281 com 6.416 de raciocinio.
Otimizar a entrada e ruido: ela e ~9% da conta.

## O teto de gramática — o que derrubou tudo

A Anthropic compila o JSON Schema estrito **do lado dela**. Se ficar grande
demais, responde 400 com *"The compiled grammar is too large"*. Medido pela
sonda em 04/09/2026:

| Schema | Resultado |
|---|---|
| 4.428 bytes | **recusado** |
| 3.905 bytes | compilou |
| 3.813 bytes (atual) | compilou |

**Isso não aparece em `tsc`, `eslint` nem `build`.** O schema v2 do briefing
subiu para produção com tudo verde e deixou **100% dos briefings quebrados** —
o sintoma era um 500 genérico.

Enum em gramática estrita não é um campo: é uma alternação, e alternações se
multiplicam entre si. Sete campos `_nota` viraram uma lista `evidencias`, e os
enums de arquétipo (8 opções) e de tom (7) viraram string, com a lista fechada
morando no texto do prompt, onde custa zero gramática.

> **Antes de acrescentar campo ao schema, rode `POST /api/admin/sonda-schema`.**
> Um 400 do provedor não custa token; um deploy às cegas custa 5 minutos e pode
> derrubar a geração inteira.

## O parâmetro de raciocínio nunca funcionou

`reasoning: { max_tokens: N }` — **não dá erro e não limita.** Na Anthropic vira
`thinking.budget_tokens`, removido da geração atual do Claude. Um briefing com
"teto" de 4.096 gastou 6.416. A alavanca inteira estava desligada sem ninguém
ver, e `provider.require_parameters: true` **não protegeu**: ele checa
capacidade grossa do provider, não se o campo ainda existe na API do modelo.

Trocar para `reasoning: { effort }` deu 400 — mas **esse 400 era do schema**, e
eu creditei ao parâmetro errado. Lição repetida: hipótese plausível não é
diagnóstico. Hoje o adaptador não manda campo de raciocínio nenhum; o Claude
decide sozinho quanto pensar.

## Onde o effort é decidido

Coluna `effort` da linha ativa em `prompts_versoes` — não é variável de ambiente
nem constante no código. Trocar é `UPDATE`, vale na próxima execução, sem
deploy. Hoje só tem efeito real no caminho direto da Anthropic
(`anthropic.ts`), que fala `output_config.effort`.

## O que ainda não foi medido

- Se o OpenRouter aceita **algum** campo de raciocínio para a Anthropic — a
  sonda em `/api/admin/sonda-schema` responde isso.
- Se baixar o effort mantém a qualidade: é o que `scripts/bancada-ia.ts` mede,
  com gate objetivo. Precisa de `SUPABASE_SERVICE_ROLE_KEY`.
- Quanto a porta de completude poupa: está no ar, mas ainda não há execução
  suficiente para dizer.

**Nenhum número de economia aqui é promessa** — só o que está na tabela acima
foi medido de verdade.

Ver [[Stack e deploy]], [[Schema]].
