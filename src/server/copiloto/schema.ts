import { z } from "zod";

/**
 * Contrato de saída do Copiloto ao Vivo — Fase 10, Fatia 2
 * (docs/ARQUITETURA-FASE-10.md §4.3). 5 campos, um único enum curto (`tipo`,
 * 4 valores) — mesma lição do briefing (schema-briefing.ts): enum em
 * gramática estrita é alternação, e alternações se multiplicam com o resto
 * do schema. O teto medido no projeto é 3.905 B compila / 4.428 B não
 * (04/09/2026, achado do briefing v2); este schema nasce pequeno de
 * propósito — a SONDA (`POST /api/admin/sonda-schema`) é quem confirma o
 * byte count real antes de ativar o prompt 0094, não uma conta de cabeça
 * feita aqui.
 *
 * ARMADILHA (mesma de `schema-briefing.ts`): NENHUM campo ganha `.max()`/
 * `.min()` de string ou `.int()`/`.min()`/`.max()` de número — essas viram
 * `minLength`/`maximum`/`minimum` no JSON Schema, que o modo `strict:true`
 * do OpenRouter RECUSA (ver `provedor/json-schema-estrito.ts`). Os tetos de
 * caractere que o §4.3 do plano define (240/200/120/160) são regra de
 * PROMPT (0094), não de Zod — e são reforçados aqui só como corte defensivo
 * no `validarSaidaCopiloto`, depois que a resposta já voltou.
 */

export const TipoObservacaoSchema = z.enum(["fato", "hipotese", "inferencia", "recomendacao"]);

const ProximaPerguntaSchema = z
  .object({
    texto: z.string(),
    motivo: z.string(),
    evidencia: z.string(),
  })
  .nullable();

const ItemFaltaSchema = z.object({
  item: z.string(),
  evidencia: z.string(),
});

/**
 * 17/09/2026 — ACERTO da condução (migration 0119). Mesmo shape de
 * `ItemFaltaSchema` (item + evidência) de propósito: são o par positivo/
 * negativo da MESMA pergunta ("a advogada cobriu isto?") — `falta_no_bloco`
 * é o que falta, `cobriu_no_bloco` é o que já foi feito. Decisão do dono: o
 * verde/vermelho julga a CONDUÇÃO DA ADVOGADA, não a qualidade da IA —
 * "cobriu" significa que ela FEZ a pergunta do bloco, mesmo sem resposta
 * ainda (a resposta em si não é o que este campo mede).
 */
const ItemCobriuSchema = z.object({
  item: z.string(),
  evidencia: z.string(),
});

const ObservacaoSchema = z
  .object({
    tipo: TipoObservacaoSchema,
    texto: z.string(),
    evidencia: z.string(),
    confianca: z.number(),
  })
  .nullable();

const DesvioSugeridoSchema = z
  .object({
    bloco_id: z.string(),
    motivo: z.string(),
    confianca: z.number(),
  })
  .nullable();

/**
 * Fase 12, Fatia 1 — 6º campo, NÃO um enum: corrige o defeito-raiz de
 * `estado.ts`/`ciclo.ts` dependerem do índice que a TELA guarda em
 * `sessionStorage`. "Em que bloco a fala dos últimos ~90s indica que a
 * conversa está agora" — DIFERENTE de `desvio_sugerido` (que é "para onde a
 * sessão DEVERIA ir", uma sugestão de ação com botão). Escopo reduzido de
 * propósito: nenhum enum novo aqui — era `veredito` (cobertura, fora desta
 * entrega) que ameaçava estourar o teto medido da gramática estrita (3.905 B
 * compila / 4.428 B não, 04/09/2026); um objeto de 3 campos de string/número
 * não corre esse risco, mas a SONDA (`POST /api/admin/sonda-schema`)
 * continua sendo quem confirma, não uma conta de cabeça.
 */
const BlocoInferidoSchema = z
  .object({
    bloco_id: z.string(),
    confianca: z.number(),
    evidencia: z.string(),
  })
  .nullable();

/**
 * 17/09/2026 — inventário patrimonial MENCIONADO na fala (PARTE 03 do
 * script da SV, `tmp/script-sv-oficial.md`: "levantar a lista de bens" por
 * categoria, sempre com os três eixos do dossiê de exemplo — quantos, de
 * quem, ordem de grandeza). DIFERENTE do bloco `dossie` (server/copiloto/
 * dossie.ts): o dossiê é o que o ESCRITÓRIO já tem cadastrado; isto é o que
 * o DECISOR está dizendo agora, sessão a sessão, antes de qualquer cadastro
 * existir.
 *
 * DOIS enums novos (`categoria`, `posse`) na MESMA gramática estrita que já
 * tem `tipo` (4 valores, `TipoObservacaoSchema`) — sonda local (script
 * ad-hoc, mesmo `paraJsonSchemaEstrito` da sonda real) mediu o schema
 * INTEIRO com os dois enums em 2.019 B, bem abaixo do teto documentado
 * (3.905 B compila / 4.428 B não) — não foi preciso o plano de contingência
 * (`posse: boolean|null` + `categoria` string livre). Ainda assim, `POST
 * /api/admin/sonda-schema {"chave":"copiloto"}` é quem confirma contra o
 * provedor real antes de ativar o prompt novo (0094-padrão) — a medição
 * local é determinística para BYTES, não para o que o provedor aceita.
 *
 * `posse` é o filtro do pedido do dono ("empresas que eles consideram como
 * deles DE FATO"): `"propria"` = o decisor trata como patrimônio próprio ou
 * da família; `"terceiro"` = menção de posse de outra pessoa ("meu genro
 * tem uma empresa") — nunca contado; `"incerta"` = não deu para saber pela
 * fala — aparece na tela como "a confirmar", nunca somado ao total (ver
 * `server/copiloto/inventario.ts`). Na dúvida entre `propria` e `incerta`,
 * o PROMPT instrui `incerta` — o schema não pode forçar essa cautela
 * sozinho, só oferecer o valor.
 */
export const CategoriaInventarioMencionadoSchema = z.enum(["imovel", "empresa", "investimento", "outro"]);
export const PosseInventarioMencionadoSchema = z.enum(["propria", "terceiro", "incerta"]);

const ItemInventarioMencionadoSchema = z.object({
  categoria: CategoriaInventarioMencionadoSchema,
  descricao: z.string(),
  titularidade: z.string().nullable(),
  posse: PosseInventarioMencionadoSchema,
  valor_mencionado: z.string().nullable(),
  evidencia: z.string(),
});

/**
 * 18/09/2026 — FICHA DO CLIENTE: retrato humano do decisor, acumulado na
 * sessão (`server/copiloto/ficha.ts`, `sessoes_copiloto.ficha_acumulada`,
 * migration 0122). Substitui a col. 3 de transcrição+inventário em ABAS que
 * a advogada nunca clicava (medido: `observacao` da IA é 74% navegação, mas
 * a EVIDÊNCIA por trás é ouro — "eu vou perder qualidade de vida" (dor),
 * "imposto de renda é 30 por 100" (objeção), "40 40 10 e 10" (desejo)).
 *
 * 4 categorias fechadas (`rank_categoria` em `ficha.ts` decide a ORDEM de
 * exibição, nunca este schema — regra de negócio vive no acumulador, não na
 * gramática da IA). MESMA ARMADILHA de todo schema deste arquivo: NENHUM
 * `.max()`/`.min()` de string — vira `minLength`/`maxLength` no JSON Schema
 * e o `strict:true` do OpenRouter recusa. Os tetos de caractere (90/120) são
 * regra de PROMPT (0123) + corte defensivo no `validarSugestaoCopiloto`
 * (`validar.ts`), nunca do Zod.
 */
export const CategoriaFichaClienteSchema = z.enum(["dor", "objecao", "desejo", "fato_decisor"]);

const ItemFichaClienteSchema = z.object({
  categoria: CategoriaFichaClienteSchema,
  texto: z.string(),
  evidencia: z.string(),
});

export const SugestaoCopilotoIaSchema = z.object({
  proxima_pergunta: ProximaPerguntaSchema,
  falta_no_bloco: z.array(ItemFaltaSchema),
  cobriu_no_bloco: z.array(ItemCobriuSchema),
  observacao: ObservacaoSchema,
  desvio_sugerido: DesvioSugeridoSchema,
  confianca_geral: z.number(),
  bloco_inferido: BlocoInferidoSchema,
  inventario_mencionado: z.array(ItemInventarioMencionadoSchema),
  ficha_cliente: z.array(ItemFichaClienteSchema),
});

export type SugestaoCopilotoIa = z.infer<typeof SugestaoCopilotoIaSchema>;

/** Tetos de caractere do §4.3 do plano — aplicados no VALIDADOR pós-Zod
 * (server/copiloto/validar.ts), nunca no schema Zod (ver ARMADILHA acima). */
export const TETO_TEXTO_PERGUNTA = 240;
export const TETO_MOTIVO_PERGUNTA = 200;
export const TETO_EVIDENCIA_PERGUNTA = 200;
export const TETO_ITEM_FALTA = 120;
export const TETO_EVIDENCIA_FALTA = 160;
export const TETO_TEXTO_OBSERVACAO = 240;
export const TETO_EVIDENCIA_OBSERVACAO = 200;
export const TETO_MOTIVO_DESVIO = 240;

/** Máximo de itens em `falta_no_bloco` (§4.3 do plano: "lista de no máximo 4 objetos"). */
export const MAX_ITENS_FALTA_NO_BLOCO = 4;

/** 17/09/2026 — mesmo teto de `falta_no_bloco` (migration 0119): o bloco
 * atual não tem mais que 8 itens de apuração no maior caso medido (parte_03,
 * 8 campos) — 4 é generoso o bastante para cobrir a MAIORIA coberta numa
 * janela de ~90s sem custear itens que o servidor descartaria sem usar
 * (mesmo raciocínio de `MAX_ITENS_FALTA_NO_BLOCO`, reforçado no prompt v7). */
export const MAX_ITENS_COBRIU_NO_BLOCO = 4;

/** Mesmo teto de caractere de `TETO_ITEM_FALTA`/`TETO_EVIDENCIA_FALTA` — par
 * positivo/negativo da mesma pergunta, mesmo orçamento de byte. */
export const TETO_ITEM_COBRIU = 120;
export const TETO_EVIDENCIA_COBRIU = 160;

/** Fase 12, Fatia 1 — mesmo teto de evidência de `desvio_sugerido` (não há
 * teto próprio no plano; reusa o valor mais próximo em espírito: uma citação
 * curta, não um parágrafo). */
export const TETO_EVIDENCIA_BLOCO_INFERIDO = 200;

/** 17/09/2026 — tetos de `inventario_mencionado[]` (mesmo raciocínio dos
 * tetos acima: regra de PROMPT + corte defensivo no validador, nunca no
 * Zod). `descricao`/`titularidade`/`valor_mencionado` são rótulos curtos
 * ("sala comercial no centro", "do casal", "uns 800 mil") — não uma frase;
 * `evidencia` segue o mesmo teto de 200 já usado para as outras citações. */
export const TETO_DESCRICAO_INVENTARIO = 160;
export const TETO_TITULARIDADE_INVENTARIO = 120;
export const TETO_VALOR_MENCIONADO_INVENTARIO = 80;
export const TETO_EVIDENCIA_INVENTARIO = 200;

/** Máximo de itens de inventário que a IA pode propor POR CHAMADA — não é o
 * total acumulado da sessão (isso não tem teto, `server/copiloto/
 * inventario.ts` acumula por toda a sessão): é quantos itens NOVOS uma
 * janela de ~90s de fala pode plausivelmente mencionar. Mesmo espírito de
 * `MAX_ITENS_FALTA_NO_BLOCO` — teto defensivo de payload por chamada, não
 * de negócio. */
export const MAX_ITENS_INVENTARIO_POR_CHAMADA = 6;

/** 18/09/2026 — tetos de `ficha_cliente[]` (FICHA DO CLIENTE, migration
 * 0122). 🔴 90/120, NÃO 120/160: o arquiteto reduziu porque a altura do
 * card em 768p × escala de 18px não fechava com os tetos maiores. A maior
 * evidência medida na sessão real tem 89 caracteres — 120 não corta nenhuma
 * citação real. Regra de PROMPT (0123) + corte defensivo no validador,
 * nunca no Zod (ver ARMADILHA no topo do arquivo). */
export const TETO_TEXTO_FICHA = 90;
export const TETO_EVIDENCIA_FICHA = 120;

/** Máximo de itens de `ficha_cliente[]` que a IA pode propor POR CHAMADA —
 * mesmo espírito de `MAX_ITENS_INVENTARIO_POR_CHAMADA`: quantos itens NOVOS
 * uma janela de ~90s de fala pode plausivelmente render, não o total
 * acumulado da sessão (isso não tem teto — `server/copiloto/ficha.ts`
 * acumula por toda a sessão, com poda por bytes). */
export const MAX_ITENS_FICHA_POR_CHAMADA = 2;
