/**
 * Para onde o `.docx` vai depois de montado (§10.1 de
 * `docs/ARQUITETURA-FASE-5.md`).
 *
 * Dois adaptadores:
 * - `manual` — devolve os bytes para download. É o único que esta rodada
 *   entrega funcionando, e é o default.
 * - `drive` — Google Drive API v3 com service account, replicando a convenção
 *   manual do escritório: uma pasta `HOLDING DRIVE - <cliente>` com o arquivo
 *   `3) RELATÓRIO DO CROQUI.docx` dentro.
 *
 * **Falha fechada, sem `if (env && ...)`.** Sem `GOOGLE_SA_JSON` E
 * `DRIVE_PASTA_RAIZ_ID`, `disponivel()` é `false`, a rota devolve 503 rotulado e
 * a UI não renderiza o botão. O padrão `if (secret && ...)` — que deixa o
 * caminho aberto justamente quando a variável não existe — é achado conhecido
 * nos sistemas do João e não se repete aqui.
 *
 * **Sem dependência nova.** O JWT do service account é assinado com
 * `node:crypto` e as chamadas são `fetch` cru, com timeout — mesmo princípio de
 * `src/server/regua/email.ts` (não puxar SDK para um `package.json` que a squad
 * inteira compartilha).
 */

import { createSign } from "node:crypto";
import { MIME_DOCX } from "./docx-croqui";

export type DestinoExportacao = "download" | "drive";

export interface ArgsEnvio {
  /** Nome do arquivo, com extensão. */
  nome: string;
  bytes: Buffer;
  /** Nome do cliente — vira o nome da pasta no Drive. */
  nomeCliente: string;
  /** Carimbo de auditoria de quem pediu (não vai para o arquivo). */
  jornadaId: string;
}

export interface ResultadoEnvio {
  destino: DestinoExportacao;
  /** Só no Drive: link de visualização do arquivo. */
  url?: string;
  /** Só no Drive: id do arquivo, para reenvio idempotente. */
  arquivoId?: string;
  /** Só no download: os bytes que a rota devolve. */
  bytes?: Buffer;
}

export interface AdaptadorExportacao {
  readonly destino: DestinoExportacao;
  /** `false` → a rota nem tenta, e o botão não é renderizado. */
  disponivel(): boolean;
  /** Em português, o que falta para ficar disponível. `null` quando está. */
  motivoIndisponivel(): string | null;
  enviar(args: ArgsEnvio): Promise<ResultadoEnvio>;
}

// ---------------------------------------------------------------------------
// manual (download)
// ---------------------------------------------------------------------------

export const adaptadorManual: AdaptadorExportacao = {
  destino: "download",
  disponivel: () => true,
  motivoIndisponivel: () => null,
  enviar: async ({ bytes }) => ({ destino: "download", bytes }),
};

// ---------------------------------------------------------------------------
// Google Drive (service account)
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 20_000;
/**
 * Escopo completo, e não `drive.file`: a pasta raiz é criada por gente, no
 * Drive do escritório. Com `drive.file` a service account só enxerga o que ela
 * própria criou — não acharia a raiz e criaria uma árvore paralela invisível.
 */
const ESCOPO_DRIVE = "https://www.googleapis.com/auth/drive";
const MIME_PASTA = "application/vnd.google-apps.folder";

interface ContaServico {
  client_email: string;
  private_key: string;
  token_uri: string;
}

function lerContaServico(): ContaServico | null {
  const cru = process.env.GOOGLE_SA_JSON?.trim();
  if (!cru) return null;
  try {
    // Aceita o JSON puro ou em base64 — painel de host costuma comer quebra de
    // linha em variável multilinha, e aí o `private_key` chega quebrado.
    const texto = cru.startsWith("{") ? cru : Buffer.from(cru, "base64").toString("utf8");
    const dados = JSON.parse(texto) as Partial<ContaServico>;
    if (!dados.client_email || !dados.private_key) return null;
    return {
      client_email: dados.client_email,
      // A `\n` literal é o jeito padrão de guardar chave PEM em env var.
      private_key: dados.private_key.replace(/\\n/g, "\n"),
      token_uri: dados.token_uri ?? "https://oauth2.googleapis.com/token",
    };
  } catch {
    // Nunca logar o conteúdo: é chave privada.
    return null;
  }
}

function pastaRaiz(): string | null {
  return process.env.DRIVE_PASTA_RAIZ_ID?.trim() || null;
}

const base64url = (dados: Buffer | string): string =>
  (typeof dados === "string" ? Buffer.from(dados, "utf8") : dados)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** JWT RS256 assinado localmente — o `assertion` do fluxo de service account. */
function assinarJwt(conta: ContaServico): string {
  const agora = Math.floor(Date.now() / 1000);
  const cabecalho = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const corpo = base64url(
    JSON.stringify({
      iss: conta.client_email,
      scope: ESCOPO_DRIVE,
      aud: conta.token_uri,
      iat: agora,
      exp: agora + 3600,
    }),
  );
  const assinatura = createSign("RSA-SHA256").update(`${cabecalho}.${corpo}`).sign(conta.private_key);
  return `${cabecalho}.${corpo}.${base64url(assinatura)}`;
}

export class ErroDrive extends Error {
  readonly etapa: string;
  constructor(etapa: string, mensagem: string) {
    super(mensagem);
    this.name = "ErroDrive";
    this.etapa = etapa;
  }
}

async function pedir(url: string, init: RequestInit, etapa: string): Promise<Response> {
  let resposta: Response;
  try {
    resposta = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (erro) {
    throw new ErroDrive(etapa, erro instanceof Error ? erro.message : String(erro));
  }
  if (!resposta.ok) {
    // Corpo de erro do Google não traz segredo, mas traz e-mail da SA — corta.
    const corpo = (await resposta.text().catch(() => "")).slice(0, 200);
    throw new ErroDrive(etapa, `HTTP ${resposta.status}${corpo ? `: ${corpo}` : ""}`);
  }
  return resposta;
}

async function obterToken(conta: ContaServico): Promise<string> {
  const resposta = await pedir(
    conta.token_uri,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: assinarJwt(conta),
      }).toString(),
    },
    "token",
  );
  const dados = (await resposta.json()) as { access_token?: string };
  if (!dados.access_token) throw new ErroDrive("token", "resposta sem access_token");
  return dados.access_token;
}

/**
 * A query do Drive é uma linguagem com string entre aspas simples. Nome de
 * cliente com apóstrofo ("O'Brien") ou com `\` quebraria — ou, pior, mudaria o
 * predicado. Escapa antes de concatenar; é injeção de query como qualquer outra.
 */
const escaparQuery = (valor: string): string => valor.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

/** Nome de pasta e de arquivo: sem controle, sem `/`, e com teto de tamanho. */
function limparNome(valor: string): string {
  // Sem regex de caractere de controle (que o eslint proíbe e que é fácil de
  // escrever errado): filtra por código. Controle vira espaço; barra e
  // contrabarra viram hífen, para o nome não abrir caminho no Drive.
  const limpo = Array.from(valor)
    .map((ch) => {
      const codigo = ch.charCodeAt(0);
      if (codigo < 32 || codigo === 127) return " ";
      if (ch === "/" || ch === "\\") return "-";
      return ch;
    })
    .join("");
  return limpo.replace(/\s+/g, " ").trim().slice(0, 120);
}

export const NOME_PASTA_CLIENTE = (nomeCliente: string): string =>
  `HOLDING DRIVE - ${limparNome(nomeCliente)}`;

interface ArquivoDrive {
  id: string;
  webViewLink?: string;
}

async function acharPorNome(
  token: string,
  nome: string,
  paiId: string,
  mime?: string,
): Promise<ArquivoDrive | null> {
  const q = [
    `name = '${escaparQuery(nome)}'`,
    `'${escaparQuery(paiId)}' in parents`,
    "trashed = false",
    ...(mime ? [`mimeType = '${escaparQuery(mime)}'`] : []),
  ].join(" and ");
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", q);
  url.searchParams.set("fields", "files(id,webViewLink)");
  url.searchParams.set("pageSize", "1");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");

  const resposta = await pedir(url.toString(), { headers: { Authorization: `Bearer ${token}` } }, "buscar");
  const dados = (await resposta.json()) as { files?: ArquivoDrive[] };
  return dados.files?.[0] ?? null;
}

async function garantirPasta(token: string, nome: string, paiId: string): Promise<string> {
  const existente = await acharPorNome(token, nome, paiId, MIME_PASTA);
  if (existente) return existente.id;

  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("fields", "id");
  url.searchParams.set("supportsAllDrives", "true");
  const resposta = await pedir(
    url.toString(),
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: nome, mimeType: MIME_PASTA, parents: [paiId] }),
    },
    "criar_pasta",
  );
  const dados = (await resposta.json()) as { id?: string };
  if (!dados.id) throw new ErroDrive("criar_pasta", "resposta sem id");
  return dados.id;
}

/**
 * Upload multipart/related montado à mão — é o que o `googleapis` faria por
 * baixo, e não vale um SDK inteiro no bundle por causa disso.
 */
function corpoMultipart(
  metadados: Record<string, unknown>,
  bytes: Buffer,
  fronteira: string,
): Buffer {
  const abertura = Buffer.from(
    `--${fronteira}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadados)}\r\n--${fronteira}\r\nContent-Type: ${MIME_DOCX}\r\n\r\n`,
    "utf8",
  );
  const fechamento = Buffer.from(`\r\n--${fronteira}--\r\n`, "utf8");
  return Buffer.concat([abertura, bytes, fechamento]);
}

async function subirArquivo(
  token: string,
  nome: string,
  bytes: Buffer,
  pastaId: string,
): Promise<ArquivoDrive> {
  const existente = await acharPorNome(token, nome, pastaId);
  const fronteira = `sichf${Date.now().toString(36)}`;
  // Arquivo já existe → nova VERSÃO do mesmo arquivo, não uma segunda cópia.
  // Duas cópias divergentes do mesmo relatório é literalmente o problema que o
  // recon achou no Drive do escritório.
  const metadados = existente ? { name: nome } : { name: nome, parents: [pastaId] };
  const url = new URL(
    existente
      ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existente.id)}`
      : "https://www.googleapis.com/upload/drive/v3/files",
  );
  url.searchParams.set("uploadType", "multipart");
  url.searchParams.set("fields", "id,webViewLink");
  url.searchParams.set("supportsAllDrives", "true");

  const resposta = await pedir(
    url.toString(),
    {
      method: existente ? "PATCH" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${fronteira}`,
      },
      body: new Uint8Array(corpoMultipart(metadados, bytes, fronteira)),
    },
    existente ? "atualizar_arquivo" : "criar_arquivo",
  );
  const dados = (await resposta.json()) as ArquivoDrive;
  if (!dados.id) throw new ErroDrive("upload", "resposta sem id");
  return dados;
}

export const adaptadorDrive: AdaptadorExportacao = {
  destino: "drive",

  disponivel() {
    return lerContaServico() !== null && pastaRaiz() !== null;
  },

  motivoIndisponivel() {
    const faltando: string[] = [];
    if (lerContaServico() === null) faltando.push("GOOGLE_SA_JSON");
    if (pastaRaiz() === null) faltando.push("DRIVE_PASTA_RAIZ_ID");
    if (faltando.length === 0) return null;
    return `Envio ao Google Drive não configurado: falta ${faltando.join(" e ")}.`;
  },

  async enviar({ nome, bytes, nomeCliente }) {
    const conta = lerContaServico();
    const raiz = pastaRaiz();
    // Cinto e suspensório: mesmo que alguém chame direto, sem passar por
    // `disponivel()`, não há caminho que suba arquivo sem as duas variáveis.
    if (!conta || !raiz) {
      throw new ErroDrive("config", this.motivoIndisponivel() ?? "Drive não configurado.");
    }

    const token = await obterToken(conta);
    const pastaId = await garantirPasta(token, NOME_PASTA_CLIENTE(nomeCliente), raiz);
    const arquivo = await subirArquivo(token, limparNome(nome), bytes, pastaId);

    return { destino: "drive", arquivoId: arquivo.id, url: arquivo.webViewLink };
  },
};

// ---------------------------------------------------------------------------
// Seleção
// ---------------------------------------------------------------------------

export const ADAPTADORES: Record<DestinoExportacao, AdaptadorExportacao> = {
  download: adaptadorManual,
  drive: adaptadorDrive,
};

export function adaptadorDe(destino: DestinoExportacao): AdaptadorExportacao {
  return ADAPTADORES[destino];
}

/** Destinos que a UI pode oferecer AGORA — a base do "botão não renderizado". */
export function destinosDisponiveis(): DestinoExportacao[] {
  return (Object.keys(ADAPTADORES) as DestinoExportacao[]).filter((d) => ADAPTADORES[d].disponivel());
}
