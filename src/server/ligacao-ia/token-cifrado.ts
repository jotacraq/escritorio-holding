import crypto from "node:crypto";
import { exigirPepper } from "@/server/publico/pepper";

/**
 * Guarda o token do link `/p/a` que o SISTEMA emitiu para uma ligação por IA —
 * cifrado, nunca em claro (Fase 7 · entrega 3 do brief).
 *
 * O PROBLEMA que isto resolve: `fila.ts` guardava o token só em memória
 * (`tokensPorLink`). Depois de um deploy/restart, o fallback "manda o link por
 * e-mail" não achava mais o token, emitia OUTRO link e — pela regra de
 * `emitir_link_agendamento_sistema` (0053) — REVOGAVA o ativo. Se quem emitiu o
 * anterior foi uma pessoa da equipe e já mandou ao cliente, o link do cliente
 * morria sem aviso.
 *
 * POR QUE CIFRAR E NÃO GUARDAR EM CLARO: `links_publicos` guarda só o
 * `sha256(token || pepper)` justamente para que vazamento de banco não vire
 * vazamento de link (0028 §4.1). Guardar o token em claro em `ligacoes_ia`
 * desfaria isso. Com AES-256-GCM sob chave derivada do `LINK_PUBLICO_PEPPER`
 * (que vive só na env do servidor), o banco sozinho continua sem valer nada.
 *
 * POR QUE NÃO A OUTRA OPÇÃO (dois links ativos): `uniq_link_ativo`
 * (0028:92) proíbe dois links ativos do mesmo tipo por jornada, e a 0072
 * fechou a tabela para escrita de `authenticated`. Permitir dois ativos exigiria
 * derrubar o índice que sustenta a promessa "emitir de novo revoga o anterior"
 * da barra Enviar — mexeria no modelo de segurança dos links inteiro. Cifrar o
 * token não encosta nele.
 *
 * FORMATO: `v2.<iv b64url>.<tag b64url>.<cifra b64url>`. Sem o pepper certo,
 * decifrar falha (GCM autentica) e o código cai no caminho de antes.
 *
 * ---------------------------------------------------------------------------
 * v2 · AAD (achado B1 do pentest, 06/09/2026)
 *
 * O v1 cifrava sem dado associado: o blob de uma ligação decifrava em qualquer
 * outra linha. GCM garantia que ninguém FORJOU o texto, mas não que ele veio
 * DAQUELA linha — e o token é a credencial de um link `/p/a` de um cliente
 * específico. Agora o `id` da ligação entra como AAD: o blob só abre na linha
 * em que foi selado. Mover a coluna de uma linha para outra passa a devolver
 * `null` (e o código cai no caminho de sempre: tarefa para a equipe).
 *
 * O v1 SIMPLESMENTE NÃO EXISTE MAIS — não há compatibilidade a manter. A coluna
 * `token_link_cifrado` nasceu na 0073, que ainda NÃO foi aplicada; não há um
 * único valor v1 em lugar nenhum. Aceitar v1 seria manter para sempre um
 * caminho sem AAD que ninguém nunca usou. Se um v1 aparecer (banco restaurado
 * de um futuro paralelo), `decifrarToken` devolve `null` — degradação limpa.
 * ---------------------------------------------------------------------------
 */

const VERSAO = "v2";
const ALGORITMO = "aes-256-gcm";
const IV_BYTES = 12;
const INFO = "sic-hf/ligacao-ia/token-link";

const chavesPorPepper = new Map<string, Buffer>();

/**
 * HKDF-SHA256 sobre o pepper — nunca o pepper cru como chave (ele já é usado
 * como sal do sha256 dos tokens; reusar o mesmo material para dois fins é como
 * reusar senha).
 */
function chave(): Buffer {
  const pepper = exigirPepper();
  let k = chavesPorPepper.get(pepper);
  if (!k) {
    k = Buffer.from(crypto.hkdfSync("sha256", Buffer.from(pepper, "utf8"), Buffer.alloc(0), Buffer.from(INFO, "utf8"), 32));
    chavesPorPepper.set(pepper, k);
  }
  return k;
}

const b64url = (b: Buffer): string => b.toString("base64url");

/** O dado associado (AAD): a linha à qual este blob pertence, e nenhuma outra. */
function aad(ligacaoId: string): Buffer {
  return Buffer.from(`${INFO}#${ligacaoId}`, "utf8");
}

/**
 * `null` quando não dá para cifrar (sem pepper, sem `ligacaoId`) — nunca lança
 * para o chamador.
 *
 * @param ligacaoId `ligacoes_ia.id` da linha onde o blob vai ser gravado. Entra
 *   como AAD: o mesmo valor será exigido para decifrar.
 */
export function cifrarToken(token: string, ligacaoId: string): string | null {
  if (!token || !ligacaoId) return null;
  try {
    const iv = crypto.randomBytes(IV_BYTES);
    const cifra = crypto.createCipheriv(ALGORITMO, chave(), iv);
    cifra.setAAD(aad(ligacaoId));
    const dados = Buffer.concat([cifra.update(token, "utf8"), cifra.final()]);
    return [VERSAO, b64url(iv), b64url(cifra.getAuthTag()), b64url(dados)].join(".");
  } catch {
    return null;
  }
}

/**
 * `null` quando o valor não é decifrável: pepper trocado, adulteração, formato
 * antigo (v1) ou — a novidade do v2 — blob de OUTRA ligação.
 */
export function decifrarToken(guardado: string | null | undefined, ligacaoId: string): string | null {
  if (!guardado || !ligacaoId) return null;
  const partes = guardado.split(".");
  if (partes.length !== 4 || partes[0] !== VERSAO) return null;
  try {
    const [, iv, tag, dados] = partes;
    const decifra = crypto.createDecipheriv(ALGORITMO, chave(), Buffer.from(iv, "base64url"));
    decifra.setAAD(aad(ligacaoId));
    decifra.setAuthTag(Buffer.from(tag, "base64url"));
    const claro = Buffer.concat([decifra.update(Buffer.from(dados, "base64url")), decifra.final()]);
    return claro.toString("utf8") || null;
  } catch {
    return null;
  }
}

/**
 * Reseló do blob para OUTRA linha — a retentativa (achado B2 do pentest).
 *
 * A retentativa é uma linha nova com o MESMO `link_id`; ela precisa do token
 * daquele link, senão `urlDoLinkAgendamento` reemite e revoga o link que o
 * sistema já mandou ao cliente. Como o AAD amarra o blob à linha, herdar não é
 * copiar: é abrir com o `id` de origem e selar de novo com o `id` de destino.
 *
 * `null` quando não há nada a herdar, quando o blob não abre (pepper trocado,
 * v1) ou quando não dá para cifrar. Herdar `null` NUNCA é erro: o pior caso é
 * exatamente o comportamento anterior a esta correção.
 */
export function reselarToken(guardado: string | null | undefined, deLigacaoId: string, paraLigacaoId: string): string | null {
  const token = decifrarToken(guardado, deLigacaoId);
  return token ? cifrarToken(token, paraLigacaoId) : null;
}
