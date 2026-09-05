import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { montarRadar } from "@/server/radar";
import { registrarErro } from "@/server/erros";
import type { DocumentoTipoRadar, EstadoItemRadar, ItemRadar } from "@/types/jornada-automacoes";
import type { DocumentoPedidoPublico } from "@/types/publico";

/**
 * O que o link `/p/d` pede ao cliente — **derivado do radar de documentos**
 * (§8.3), não da lista fixa de três tipos que `app.payload_link_documentos`
 * (0028) devolve desde sempre.
 *
 * O que muda na prática: uma família com três imóveis via um cartão único
 * "Matrícula de Imóvel" e mandava três arquivos soltos; o radar casa documento
 * com item por `item_ref` EXATO ou não casa (`lib/radar/derivar.ts#acharDocumento`,
 * de propósito — distribuir "3 matrículas soltas" entre 3 imóveis marcaria o
 * imóvel errado como resolvido), e os três ficavam `a_pedir` para sempre. Agora
 * cada item do radar é um cartão e o documento nasce grudado no bem certo.
 *
 * ## Por que a chave que vai ao navegador é opaca
 *
 * A chave do radar é `"coleta:matricula_imovel:<uuid de patrimonio_itens>"` —
 * carrega um id interno, e a regra dura 4 (§2.2) diz que resposta pública não
 * expõe id interno. Então o que viaja é `sha256(pepper || chave)` truncado: o
 * navegador devolve a mesma string no upload e o servidor **reconstrói o radar
 * e reencontra o item** para descobrir `tipo` e `item_ref`.
 *
 * O ganho não é só de exposição. A chave nunca é lida como dado — só comparada
 * contra o conjunto que o servidor acabou de derivar. Chave forjada não casa
 * com nada e o upload é recusado: **não existe caminho em que um `item_ref`
 * escolhido pelo navegador chegue ao banco**. E, mesmo assim, a RPC
 * `registrar_documento_publico` (0068) revalida que o item pertence à pessoa da
 * jornada daquele link antes de gravar — as duas travas, sempre.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cliente vem sem generic Database
type ClienteAdmin = SupabaseClient<any, any, any>;

/** Só o lado da coleta vai ao cliente: `entrega` é o que o ESCRITÓRIO devolve. */
const LADO_PUBLICO = "coleta";

/** Já recebido ou já conferido não é pedido — não vira cartão de envio. */
const ESTADOS_PENDENTES: ReadonlySet<EstadoItemRadar> = new Set<EstadoItemRadar>(["a_pedir", "pedido"]);

export function chavePublicaDeItem(chaveRadar: string, pepper: string): string {
  return crypto.createHash("sha256").update(`documento:${chaveRadar}${pepper}`, "utf8").digest("hex").slice(0, 32);
}

export interface ItemPedidoResolvido {
  /** o que viaja ao navegador */
  chave_publica: string;
  /** `{lado}:{tipo}:{item_ref}` — só no servidor */
  chave_radar: string;
  tipo: DocumentoTipoRadar;
  item_ref: string | null;
  rotulo: string;
  obrigatorio: boolean;
  estado: EstadoItemRadar;
}

function paraItemResolvido(item: ItemRadar, pepper: string): ItemPedidoResolvido {
  return {
    chave_publica: chavePublicaDeItem(item.chave, pepper),
    chave_radar: item.chave,
    tipo: item.tipo,
    item_ref: item.item_ref,
    rotulo: item.rotulo,
    obrigatorio: item.obrigatorio,
    estado: item.estado,
  };
}

/**
 * Os itens de coleta desta jornada, com a chave pública já calculada.
 *
 * Devolve `null` — e não lista vazia — quando o radar não pôde ser derivado
 * (erro de leitura, tabela da 0065 ausente). `null` faz o chamador **manter o
 * payload que a RPC devolveu**; lista vazia diria ao cliente "não preciso de
 * nada de você", que é uma afirmação, não uma falha.
 */
export async function itensDeColetaDoLink(
  admin: ClienteAdmin,
  jornadaId: string,
  pepper: string,
): Promise<ItemPedidoResolvido[] | null> {
  try {
    const radar = await montarRadar(admin, jornadaId);
    return radar.itens.filter((i) => i.lado === LADO_PUBLICO).map((i) => paraItemResolvido(i, pepper));
  } catch (erro) {
    registrarErro("server/publico.itensDeColetaDoLink", erro, { jornada_id: jornadaId });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cache curto do radar por link (0069 — achado BAIXO do pentest da Fase 5)
//
// `montarRadar` são ~5 consultas com `service_role` (bens, familiares,
// documentos, pedidos, modelo do croqui). Elas rodavam a CADA `GET
// /api/publico/[token]` e a CADA tentativa de upload, ANTES do rate limit —
// que só existe dentro da RPC. Portador de token válido pagava 5N consultas
// por minuto do nosso lado.
//
// Escolhas, e por que cada uma:
//  · **Chave = `token_hash`.** Já é `sha256(token || pepper)`; o token em claro
//    nunca entra em memória de processo, do mesmo jeito que nunca entra no banco.
//  · **60 s.** Curto o bastante para "a advogada acabou de pedir mais um
//    documento" aparecer no link sem drama; longo o bastante para absorver a
//    rajada de uploads de uma família mandando 5 arquivos seguidos.
//  · **Só sucesso entra.** Cachear `null` deixaria o link degradado por um
//    minuto inteiro por causa de uma falha de leitura pontual.
//  · **Invalidação explícita depois de gravar** (`invalidarRadarDoLink`): sem
//    isso, o cartão do bem recém-enviado continuaria pedindo o arquivo até o
//    TTL vencer — o cliente veria "ainda falta" logo depois de mandar.
//  · **Memória de processo.** A Hostinger roda um Node App único (é a mesma
//    premissa do rate limit em memória do `.docx`, M6). Se um dia virar
//    multi-processo, isto vira só um cache menos efetivo — nunca uma trava
//    furada, porque NÃO é trava: o rate limit de verdade continua em
//    `publico_rate_limit`, no banco.
// ---------------------------------------------------------------------------

const TTL_RADAR_MS = 60_000;
/** Teto de entradas: link é objeto de vida curta, e memória de processo não é banco. */
const CAPACIDADE_CACHE_RADAR = 500;

const cacheRadar = new Map<string, { expiraEm: number; itens: ItemPedidoResolvido[] }>();

function podarCacheRadar(agora: number): void {
  for (const [chave, entrada] of cacheRadar) {
    if (entrada.expiraEm <= agora) cacheRadar.delete(chave);
  }
  // `Map` itera em ordem de inserção: se ainda estourar, sai o mais antigo.
  while (cacheRadar.size >= CAPACIDADE_CACHE_RADAR) {
    const maisAntiga = cacheRadar.keys().next();
    if (maisAntiga.done) break;
    cacheRadar.delete(maisAntiga.value);
  }
}

/** Chamar depois de QUALQUER escrita que mude o radar daquele link (upload gravado). */
export function invalidarRadarDoLink(tokenHash: string): void {
  cacheRadar.delete(tokenHash);
}

/**
 * `itensDeColetaDoLink` com cache de 60 s por `token_hash`. Mesmo contrato:
 * `null` = não deu para derivar (o chamador mantém o payload da RPC).
 */
export async function itensDeColetaDoLinkEmCache(
  admin: ClienteAdmin,
  tokenHash: string,
  jornadaId: string,
  pepper: string,
): Promise<ItemPedidoResolvido[] | null> {
  const agora = Date.now();
  const emCache = cacheRadar.get(tokenHash);
  if (emCache && emCache.expiraEm > agora) return emCache.itens;

  const itens = await itensDeColetaDoLink(admin, jornadaId, pepper);
  if (itens === null) {
    cacheRadar.delete(tokenHash);
    return null;
  }

  podarCacheRadar(agora);
  cacheRadar.set(tokenHash, { expiraEm: agora + TTL_RADAR_MS, itens });
  return itens;
}

/**
 * O recorte que vai ao navegador: só o que ainda falta, sem `item_ref`, sem
 * chave de radar, sem id interno. Lista vazia aqui é resposta honesta — quer
 * dizer "o escritório já recebeu tudo que pediu".
 */
export function tiposPedidosPublicos(itens: ItemPedidoResolvido[]): DocumentoPedidoPublico[] {
  return itens
    .filter((i) => ESTADOS_PENDENTES.has(i.estado))
    .map((i) => ({ chave: i.chave_publica, tipo: i.tipo, rotulo: i.rotulo, obrigatorio: i.obrigatorio }));
}

/**
 * Traduz o que o navegador mandou no campo `tipo` do upload.
 *
 * Aceita duas formas, nesta ordem:
 *  1. **chave pública** de um item do radar → `{tipo, item_ref}` do item, e o
 *     documento nasce grudado no bem/familiar certo;
 *  2. **tipo cru** (`imposto_renda`, `contrato_social`, …) → `item_ref: null`.
 *     É o caminho do payload antigo e de qualquer cliente que ainda não conheça
 *     a chave: continua funcionando, só sem casamento por item.
 *
 * Qualquer outra coisa devolve `null` e o upload é recusado.
 */
export function resolverEnvio(
  campoTipo: string,
  itens: ItemPedidoResolvido[] | null,
  tiposValidos: ReadonlySet<string>,
): { tipo: string; item_ref: string | null } | null {
  const item = itens?.find((i) => i.chave_publica === campoTipo);
  if (item) return { tipo: item.tipo, item_ref: item.item_ref };
  if (tiposValidos.has(campoTipo)) return { tipo: campoTipo, item_ref: null };
  return null;
}
