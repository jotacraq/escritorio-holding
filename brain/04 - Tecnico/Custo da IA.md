# Custo da IA

Onde o dinheiro do SIC-HF é queimado, o que já foi medido e qual alavanca funciona
de verdade. Nota de domínio — o diário registra o dia, aqui fica o que vale sempre.

## A conta de um briefing (medido em produção, 03/09/2026)

| Parte | Tokens | Fatia do custo |
|---|---|---|
| Entrada (contexto montado) | 4.697 | ~9% |
| Saída (briefing + raciocínio) | 9.377–11.651 | ~91% |
| — dentro da saída: **raciocínio** | 6.416 | **55% da saída** |

**Otimizar entrada é ruído. O custo é a saída, e mais da metade da saída é o
modelo pensando.** Cortar seção do contexto para "economizar" mexe em 9% do
custo e degrada o briefing — é o pior negócio disponível.

## A armadilha do teto de raciocínio

O adaptador do OpenRouter mandava `reasoning: { max_tokens: N }`. Na Anthropic
esse campo vira `thinking.budget_tokens`, **removido da geração atual do Claude**.
O pedido **não falha** — o teto simplesmente não vale. Por isso um briefing
configurado com teto de 4.096 gastou 6.416 tokens de raciocínio sem nenhum erro,
nenhum aviso e nenhum log estranho.

Consequência: **a alavanca de economia inteira estava desligada e ninguém via.**
Baixar o effort não economizava nada, porque o parâmetro que carregava o effort
era ignorado.

O caminho de rollback (`src/server/ia/provedor/anthropic.ts`) sempre falou a API
nova — `thinking: { type: "adaptive" }` + `output_config: { effort }`. Só o
adaptador do OpenRouter tinha ficado para trás. Corrigido em 04/09/2026 para
`reasoning: { effort }` em `src/server/ia/provedor/openrouter.ts`.

> `provider.require_parameters: true` **não protegeu** contra isso. Ele checa a
> capacidade grossa do provider, não se o campo ainda existe na API do modelo.
> Não confie nele como validação de parâmetro.

A escala do OpenRouter tem três degraus (`low`/`medium`/`high`); `xhigh` e `max`
do SIC-HF colapsam em `high`. O `max_tokens` do topo do corpo é outro campo,
continua valendo, e é o teto absoluto da saída.

## Onde o effort é decidido

Coluna `effort` da linha ativa em `prompts_versoes` — **não é variável de
ambiente e não é constante no código**. Trocar o effort de um agente é `UPDATE`
nessa tabela, e passa a valer na próxima execução, sem deploy.

Hoje: `protocolo_01_briefing` e `agente_croqui_analise` em `high`,
`material_pos_sessao` em `medium`, `ordenar_horarios_agenda` em `low`.

## Como decidir se vale baixar o effort

Não no olho. `scripts/bancada-ia.ts` roda baseline e variantes contra jornadas
reais e só promove se o gate objetivo passar: custo cai **e** cobertura,
ancoragem em evidência e grau de confiança ficam dentro da variância do
baseline. Precisa de `SUPABASE_SERVICE_ROLE_KEY`.

**Enquanto a medição pós-correção não rodar, nenhum número de economia aqui é
promessa.** O que está medido é a conta acima e a causa da fuga — não a
economia obtida.

## Medição que ficou pendente

Repetir o mesmo briefing em `high` e em `medium` com o adaptador já corrigido e
comparar `execucoes_ia.tokens_raciocinio`. Se o número não se mover entre os
dois, a correção não pegou e a causa é outra — **medir antes de comemorar.**

Ver [[Stack e deploy]], [[Schema]].
