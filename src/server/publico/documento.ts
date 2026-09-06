import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarErro } from "@/server/erros";

/**
 * Upload público de documento reaproveita o caminho já auditado do upload interno
 * (`src/server/ia/documentos.ts`, fora da minha fronteira) — mesmo bucket privado,
 * mesma exigência de mime por ASSINATURA DE BYTES (nunca só `Content-Type`), mesmo
 * `sanitizarNomeArquivo`. As duas constantes de assinatura abaixo são uma cópia
 * pequena e deliberada (não uma importação) porque `ASSINATURAS_MIME` e
 * `assinaturaBate` não são exportadas daquele arquivo — evita editar um arquivo que
 * não é meu só para expor duas constantes. Se isso incomodar na revisão, é um
 * refactor de 5 minutos: exportar as duas de lá e apagar a cópia daqui.
 */
const ASSINATURAS_MIME_PUBLICO: Record<string, Buffer[]> = {
  "application/pdf": [Buffer.from([0x25, 0x50, 0x44, 0x46])], // %PDF
  "image/jpeg": [Buffer.from([0xff, 0xd8, 0xff])],
  "image/png": [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
};

const EXTENSAO_POR_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};

export const TAMANHO_MAXIMO_DOCUMENTO_PUBLICO_BYTES = 20 * 1024 * 1024; // 20 MB, §2.4
/**
 * FALLBACK, não a verdade. A verdade é `configuracoes['link.limite_arquivos']`,
 * lida por `limiteArquivosPorLink()` aqui e por `app.limite_arquivos_por_link()`
 * no banco (0075) — a mesma chave alimenta o número que a página do cliente
 * MOSTRA (`app.payload_link_documentos`) e o que a RPC APLICA
 * (`registrar_documento_publico`).
 *
 * Este número só vale quando a chave não existe ou é inválida. Foi exatamente a
 * divergência que a 0075 corrige: em 06/09 o 5→10 foi feito SÓ aqui, e o banco
 * continuou recusando o 6º arquivo enquanto a tela dizia "até 5". §2.4.
 */
export const LIMITE_ARQUIVOS_POR_LINK = 10;

export function mimeSuportadoPublico(mime: string): boolean {
  return mime in ASSINATURAS_MIME_PUBLICO;
}

export function assinaturaDeBytesBate(bytes: Buffer, mimeDeclarado: string): boolean {
  const assinaturas = ASSINATURAS_MIME_PUBLICO[mimeDeclarado];
  if (!assinaturas) return false;
  return assinaturas.some((assinatura) => bytes.subarray(0, assinatura.length).equals(assinatura));
}

export function extensaoPorMime(mime: string): string {
  return EXTENSAO_POR_MIME[mime] ?? "bin";
}

/** Mesmo saneamento de `src/server/ia/documentos.ts#sanitizarNomeArquivo`, sem depender do import. */
export function nomeArquivoPublico(mime: string): string {
  return `documento.${extensaoPorMime(mime)}`;
}

export interface LinkParaUpload {
  linkId: string;
  jornadaId: string;
  pessoaId: string;
  /**
   * `links_publicos.usos` DESTE link — o denominador do teto de arquivos, e o
   * mesmo que `registrar_documento_publico` usa (`v_link.usos >=
   * app.limite_arquivos_por_link()`, 0075:212). Vem junto na consulta que já
   * existia: zero consulta a mais. Ver `tetoDeArquivosBatido`.
   */
  usos: number;
}

/**
 * Pré-checagem do teto de arquivos. **O denominador é POR LINK** (`usos`), não
 * por jornada — decisão espelhada da 0075/0068, onde a recusa é
 * `v_link.usos >= app.limite_arquivos_por_link()`.
 *
 * Até 06/09 esta pré-checagem contava `documentos` da JORNADA
 * (`origem='cliente' and ativo`), um denominador que só por acaso coincidia com
 * o do banco. Divergia em pelo menos três situações reais, todas recusando
 * envio LEGÍTIMO antes mesmo de tentar:
 *
 *  - **link reemitido** (o caso comum): a equipe manda um link novo depois que o
 *    cliente esgotou o primeiro. `usos` do link novo é 0 e o banco aceita 10
 *    arquivos; a contagem por jornada já estava em 10 e a rota recusava tudo.
 *  - **dois links ativos** na mesma jornada (0072 permite): cada um tem cota
 *    própria no banco, mas somavam entre si na contagem por jornada.
 *  - **upload interno** (`origem='cliente'` gravado pela equipe pela Ficha) e
 *    documento inativado: mexem na contagem da jornada e não em `usos`.
 *
 * A recíproca — a rota deixar passar o que o banco recusaria — é inofensiva: a
 * RPC recusa, a rota apaga o objeto do bucket. Este portão só existe para não
 * gastar bytes de Storage à toa, nunca para ser a trava.
 */
export function tetoDeArquivosBatido(usosDoLink: number, limite: number): boolean {
  return usosDoLink >= limite;
}

/**
 * Resolve `token_hash` -> pessoa_id usando `service_role` (bypassa RLS — necessário
 * porque `links_publicos`/`jornadas` não têm policy para `anon`, e esta consulta
 * precisa rodar ANTES do upload, só para montar o caminho `pessoas/{pessoa_id}/...`
 * do Storage, que segue a MESMA convenção do upload interno, 0012).
 *
 * NÃO é a validação de negócio (rate limit, estado, expiração, remarcação, dedupe) —
 * essa validação, completa, é feita de novo por `registrar_documento_publico` (a RPC
 * `security definer`, chamada DEPOIS do upload) — porque a regra de negócio do link
 * vive no banco, não na rota. Esta função só existe pela fronteira técnica real: o
 * schema `app` (onde vive `app.resolve_link_escrita`) não é exposto pelo PostgREST,
 * então nenhum cliente JS — nem com `service_role` — consegue chamá-lo. E a resposta
 * pública de `abrir_link_publico` nunca traz `pessoa_id` (regra dura 4, §2.2) — de
 * propósito, para não vazar UUID interno ao NAVEGADOR. Aqui é o SERVIDOR, não o
 * navegador, lendo a tabela diretamente com uma chave que só o processo Next.js tem.
 * Por isso a checagem abaixo é deliberadamente mínima: só o suficiente para decidir
 * se vale a pena gastar upload de bytes, nunca a fonte de verdade final.
 */
export async function resolverLinkParaUpload(
  supabaseAdmin: SupabaseClient,
  tokenHash: string,
): Promise<LinkParaUpload | null> {
  const { data: link, error: erroLink } = await supabaseAdmin
    .from("links_publicos")
    // `usos` entra na consulta que já existia — é o denominador do teto de
    // arquivos (0075) e sai daqui de graça. Sem ele a rota precisaria de uma
    // segunda consulta só para contar.
    .select("id, jornada_id, tipo, estado, expira_em, usos")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (erroLink || !link) return null;
  if (link.tipo !== "documentos") return null;
  if (link.estado !== "ativo") return null;
  if (new Date(link.expira_em).getTime() <= Date.now()) return null;

  const { data: jornada, error: erroJornada } = await supabaseAdmin
    .from("jornadas")
    .select("id, pessoa_id, desfecho")
    .eq("id", link.jornada_id)
    .maybeSingle();

  if (erroJornada || !jornada || jornada.desfecho !== "aberta") return null;

  return {
    linkId: link.id as string,
    jornadaId: jornada.id as string,
    pessoaId: jornada.pessoa_id as string,
    // `usos` é `int not null default 0` (0028:79). O `?? 0` cobre só o banco
    // sem a coluna no cache do PostgREST — nunca dado real.
    usos: typeof link.usos === "number" ? link.usos : 0,
  };
}

/**
 * `token_hash` -> `jornada_id`, com `service_role`. Usada DEPOIS de
 * `abrir_link_publico` já ter autorizado a leitura — é só a tradução que a
 * resposta pública não pode carregar (nenhum id interno volta ao navegador,
 * regra dura 4 do §2.2). Não é gate de autorização e não repete o que a RPC faz.
 */
export async function jornadaDoLinkPublico(
  supabaseAdmin: SupabaseClient,
  tokenHash: string,
  tipo: string,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("links_publicos")
    .select("jornada_id, tipo")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error || !data) return null;
  if ((data as { tipo: string }).tipo !== tipo) return null;
  return (data as { jornada_id: string }).jornada_id;
}

export function caminhoDocumentoPublico(pessoaId: string, documentoId: string, mime: string): string {
  return `pessoas/${pessoaId}/${documentoId}/${nomeArquivoPublico(mime)}`;
}

export function sha256DeBytes(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

// ---------------------------------------------------------------------------
// Pré-checagem de rate limit (0069 — achado BAIXO do pentest da Fase 5)
//
// A fonte de verdade do teto continua sendo `app.limite_token_ok` dentro de
// `registrar_documento_publico` (0028): `publico_rate_limit` é uma TABELA
// justamente porque a Hostinger não garante processo único e X-Forwarded-For é
// forjável. O problema não era a trava — era a ORDEM. A rota fazia
// `resolverLinkParaUpload` + `count(documentos)` + o radar (~5 consultas
// service_role) + **o upload ao Storage** antes de chegar à RPC. Portador de
// token válido (o cliente, ou quem tiver o link) gerava N uploads e 5N
// consultas por minuto sem o teto contar; a RPC recusava e a rota apagava o
// objeto, mas o custo já tinha sido pago.
//
// Esta função é o portão barato que vem ANTES: UMA consulta a
// `links_publicos_acessos` (índice `idx_links_acessos (link_id, ocorrido_em
// desc)`) contando o último minuto DAQUELE link. Não consome cota, não escreve
// nada, não substitui a RPC — só decide se vale a pena continuar.
//
// Deliberadamente conservadora: conta os acessos que a RPC JÁ registrou, então
// ela enxerga um pouco menos que o contador real (a tentativa em curso ainda
// não virou linha). Isso a torna incapaz de recusar quem está dentro do teto,
// que é a única falha aceitável aqui — recusar cedo demais quebraria envio
// legítimo, e a RPC continua sendo quem diz o não definitivo.
// ---------------------------------------------------------------------------

/** Espelha o default de `link.limite_por_minuto` na 0028. Lido de `configuracoes` quando existe. */
const LIMITE_ACESSOS_POR_MINUTO_PADRAO = 10;

/**
 * Os dois tetos de link público que a rota de upload consulta vivem na MESMA
 * tabela, então vão na MESMA consulta: `link.limite_por_minuto` (portão de taxa)
 * e `link.limite_arquivos` (teto de arquivos, 0075). Ler as duas chaves de uma
 * vez, com o mesmo cache, é o motivo de o limite de arquivos ter deixado de ser
 * constante SEM custar uma consulta a mais por upload.
 *
 * TTL de 60 s: o teto é configurável no banco, mas reler a cada upload seria
 * trocar uma consulta por outra. Uma mudança em Admin vale no minuto seguinte.
 */
const TTL_LIMITE_MS = 60_000;

interface TetosDeLink {
  porMinuto: number;
  arquivos: number;
}

let tetosEmCache: { valor: TetosDeLink; expiraEm: number } | null = null;

/** `configuracoes.valor` é jsonb: um número vem como `number`, não string. */
function inteiroNaFaixa(bruto: unknown, minimo: number, maximo: number, padrao: number): number {
  const numero = typeof bruto === "number" ? bruto : Number(bruto);
  if (!Number.isInteger(numero) || numero < minimo || numero > maximo) return padrao;
  return numero;
}

async function tetosDeLink(supabaseAdmin: SupabaseClient): Promise<TetosDeLink> {
  const agora = Date.now();
  if (tetosEmCache && tetosEmCache.expiraEm > agora) return tetosEmCache.valor;

  const padrao: TetosDeLink = {
    porMinuto: LIMITE_ACESSOS_POR_MINUTO_PADRAO,
    arquivos: LIMITE_ARQUIVOS_POR_LINK,
  };

  const { data, error } = await supabaseAdmin
    .from("configuracoes")
    .select("chave, valor")
    .in("chave", ["link.limite_por_minuto", "link.limite_arquivos"]);

  // Falha (ou banco sem a 0075) mantém os defaults e NÃO envenena o cache com
  // um valor que veio de erro — a próxima tentativa relê.
  if (error || !data) {
    registrarErro("server/publico.tetosDeLink", error ?? new Error("configuracoes ilegivel"));
    return padrao;
  }

  const linhas = data as Array<{ chave: string; valor: unknown }>;
  const bruto = (chave: string) => linhas.find((l) => l.chave === chave)?.valor;

  const valor: TetosDeLink = {
    porMinuto: inteiroNaFaixa(bruto("link.limite_por_minuto"), 1, Number.MAX_SAFE_INTEGER, padrao.porMinuto),
    // Mesma faixa 1..50 de `app.limite_arquivos_por_link()` (0075). Divergir aqui
    // faria a pré-checagem barata recusar o que o banco aceitaria, ou o contrário.
    arquivos: inteiroNaFaixa(bruto("link.limite_arquivos"), 1, 50, padrao.arquivos),
  };

  tetosEmCache = { valor, expiraEm: agora + TTL_LIMITE_MS };
  return valor;
}

async function limitePorMinuto(supabaseAdmin: SupabaseClient): Promise<number> {
  return (await tetosDeLink(supabaseAdmin)).porMinuto;
}

/**
 * Teto de arquivos por link, do banco — a MESMA fonte que
 * `app.limite_arquivos_por_link()` (0075) usa para o número que a página do
 * cliente mostra e para a recusa dentro de `registrar_documento_publico`.
 *
 * Sem a 0075 aplicada, a chave não existe e isto devolve o fallback
 * `LIMITE_ARQUIVOS_POR_LINK` (10) — mas o banco continua recusando no 6º
 * arquivo, porque lá o literal ainda é 5. O comportamento nesse estado é o de
 * antes desta mudança (upload gasto, RPC recusa, objeto apagado), nunca pior;
 * quem fecha a divergência é aplicar a migration.
 *
 * Nunca lança: erro de leitura vira o fallback, porque este é o portão barato,
 * não a trava. A trava é a RPC.
 */
export async function limiteArquivosPorLink(supabaseAdmin: SupabaseClient): Promise<number> {
  try {
    return (await tetosDeLink(supabaseAdmin)).arquivos;
  } catch (erro) {
    registrarErro("server/publico.limiteArquivosPorLink", erro);
    return LIMITE_ARQUIVOS_POR_LINK;
  }
}

/**
 * `true` = este link já bateu o teto do minuto e a rota deve responder
 * `limite_excedido` (429) SEM tocar no radar nem no Storage.
 *
 * Falha em `false` de propósito: se a consulta der erro, seguimos para a RPC,
 * que tem a trava real. Um portão de custo nunca pode virar um novo jeito de
 * derrubar o envio do cliente.
 */
export async function tetoDoMinutoJaBatido(
  supabaseAdmin: SupabaseClient,
  linkId: string,
): Promise<boolean> {
  try {
    const desde = new Date(Date.now() - 60_000).toISOString();
    const [limite, contagem] = await Promise.all([
      limitePorMinuto(supabaseAdmin),
      supabaseAdmin
        .from("links_publicos_acessos")
        .select("id", { count: "exact", head: true })
        .eq("link_id", linkId)
        .gte("ocorrido_em", desde),
    ]);
    if (contagem.error) {
      registrarErro("server/publico.tetoDoMinutoJaBatido", contagem.error, { link_id: linkId });
      return false;
    }
    return (contagem.count ?? 0) >= limite;
  } catch (erro) {
    registrarErro("server/publico.tetoDoMinutoJaBatido", erro, { link_id: linkId });
    return false;
  }
}
