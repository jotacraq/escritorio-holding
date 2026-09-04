/**
 * Orçamento de escrita (L2, ARQUITETURA-FASE-3.md §1.4) — bloco anexado ao
 * `corpo_sistema` do prompt v2 do Briefing, condicionado por
 * `configuracoes.ia.orcamento_escrita_ativo` (0042): liga/desliga sem deploy.
 *
 * Texto vive em CÓDIGO, não na migration/DB — é o que permite o toggle sem
 * `UPDATE prompts_versoes`. Regra de FORMA, não de conteúdo: nenhuma linha do
 * Protocolo 01 é removida ou reinterpretada por este bloco.
 *
 * ARMADILHA (não repetir): a cardinalidade fica só aqui, em texto de prompt —
 * nunca em `.max()`/`.min()` no Zod de `schema-briefing.ts`. `.max()` em array
 * vira `maxItems` no JSON Schema estrito, que `json-schema-estrito.ts` agora
 * remove por precaução (armadilha de 03/09), e mesmo removido um `.max()` no
 * Zod faria o `safeParse()` REJEITAR uma resposta com 1 item a mais — reprompt
 * automático, custo dobrado para tentar economizar.
 */
export const BLOCO_ORCAMENTO_ESCRITA = `ORÇAMENTO DE ESCRITA (regra de forma, não de conteúdo)

Escreva o mínimo que sustente a conclusão com evidência. Prolixidade não é
profundidade — no método deste escritório, uma frase presa a uma evidência vale
mais que um parágrafo bem escrito sem lastro.

- resumo_executivo: no máximo 5 frases.
- toda justificativa/motivo: 1 frase, até 240 caracteres.
- perfil_disc.evidencias: no máximo 3, as mais fortes, sempre citando a
  linguagem observada.
- arquetipo_patrimonial.evidencias: no máximo 3.
- objecoes_provaveis: no máximo 3, a mais provável primeiro.
- pontos_de_atencao: no máximo 4.
- perguntas_para_aprofundar: no máximo 5.
- frases_para_o_fechamento: no máximo 4.
- motivadores.secundarios: no máximo 3.
- estrategia_sessao.mais_tempo_em / menos_tempo_em: no máximo 3 itens cada.
- lacunas: no máximo 6.

Se houver menos evidência do que o limite permite, entregue MENOS — nunca
complete o número com item fraco. Lista curta e forte é o resultado correto;
lista cheia e genérica viola a REGRA DE OURO acima.`;
