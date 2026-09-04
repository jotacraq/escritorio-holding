# Custo da IA

Onde o dinheiro do SIC-HF é queimado, o que já foi **medido** e qual alavanca
funciona de verdade. O diário registra o dia; aqui fica o que vale sempre.

## A conta de um briefing

| Quando | Entrada | Saída | Raciocínio | Custo |
|---|---|---|---|---|
| Baseline 04/09 04:25 | 4.697 | 11.651 | 6.416 (55% da saída) | **US$ 0,1281** |
| Depois do enxugamento 06:07 | 5.153 | 8.822 | 5.385 (61% da saída) | **US$ 0,1009** |

**−21% de custo, −24% de saída.** Veio do schema menor e do bloco de orçamento
de escrita anexado ao prompt — **não** de mexer no parâmetro de raciocínio, que
nunca funcionou (abaixo).

Otimizar a entrada é ruído: ela é ~9% da conta. O custo é a saída, e mais da
metade da saída é o modelo pensando.

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
