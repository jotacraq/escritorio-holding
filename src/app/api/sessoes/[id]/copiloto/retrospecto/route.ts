export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirVePatrimonio, type UsuarioAtual } from "@/server/auth";
import { ErroApi, erroConflito, erroLimite, respostaErro } from "@/server/erros";
import { consumir } from "@/server/exportacao/limite";
import { copilotoEstaAtivo } from "@/server/copiloto/config";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import {
  lerRetrospectoComEstado,
  montarDocxRetrospecto,
  remontarRetrospectoSeEncerrada,
  retrospectoEstaAtivo,
  MIME_DOCX,
} from "@/server/copiloto/retrospecto";
import type { RetrospectoDaSessao } from "@/types/copiloto";

/**
 * `GET /api/sessoes/[id]/copiloto/retrospecto` — Fase 13, BE-4
 * (`docs/ARQUITETURA-FASE-13.md` §D.5/§D.6).
 *
 *   - sem query string  → JSON (`RetrospectoDaSessao`), para o pop-up de fim
 *     de sessão e para a aba "Retrospecto" da Ficha 360.
 *   - `?formato=docx`   → o mesmo documento em `.docx`, com
 *     `Content-Disposition: attachment`.
 *
 * DOWNLOAD — o padrão PROVADO da casa é rota + `Content-Disposition:
 * attachment` + `<a href download>` (`components/croqui/BaixarRelatorio.tsx`:
 * funciona com botão direito, com "abrir em nova aba" e sem JavaScript).
 * MESMA ORIGEM, então a restrição de `download` (que só morde cross-origin)
 * não se aplica. O caminho `fetch → Blob → createObjectURL → âncora
 * sintética` (`components/publico/cliente.ts`) NÃO é usado aqui: ele existe
 * lá porque aquela rota faz 302 para o Storage (cross-origin). O retrospecto
 * não passa por Storage.
 *
 * `.docx` e não `.md`/`.txt` porque a dependência `docx@^9.7.1` JÁ está no
 * `package.json` (zero dependência nova) e o destinatário é uma advogada que
 * vai anexar isso num e-mail.
 *
 * ===========================================================================
 * SEGURANÇA — o conteúdo é PII PESADA (objeção/dor/desejo com citação
 * literal de família real). As travas, todas obrigatórias, nenhuma sozinha:
 *
 *   1. `exigirVePatrimonio()` — trava de ROTA. `relacionamento` não lê.
 *   2. RLS (0125) — trava de BANCO, e é PRECISO dizer o que ela faz e o que
 *      NÃO faz. A leitura usa o cliente COM SESSÃO (`criarClienteServidor`),
 *      NUNCA `criarClienteAdmin`, então a policy `cr_sel` decide junto com a
 *      rota.
 *
 *      🔴 CORRIGIDO (achado F4 do pentest, 19/09/2026): a versão anterior
 *      deste comentário afirmava que "um `sessao_id` de outra jornada
 *      simplesmente não volta". **Isso é FALSO e era perigoso escrever.**
 *      `app.ve_patrimonio()` é gate de PAPEL, não recorte de LINHA: ela
 *      devolve o mesmo `true` para qualquer admin/advogada, em qualquer
 *      linha. Uma advogada autenticada LÊ o retrospecto de QUALQUER sessão
 *      cujo id ela conheça — a RLS não faz, e nunca fez, filtro por jornada
 *      nesta base (o mesmo vale para `copiloto_sugestoes`,
 *      `sessoes_copiloto` e `transcricoes`, todas sob a mesma função).
 *
 *      Isso é ACEITO por desenho: o escritório é uma equipe pequena e quem
 *      vê patrimônio vê a carteira inteira — não há tenant por advogada. O
 *      comentário existe para o próximo leitor NÃO confundir "gate de papel"
 *      com "isolamento por linha" e construir em cima de uma garantia que
 *      não existe. Se um dia houver recorte por carteira, é AQUI que entra,
 *      e a policy da 0125 terá de mudar junto.
 *
 *      O que a RLS de fato garante: `relacionamento` (e qualquer papel sem
 *      `ve_patrimonio`) não lê NADA, nem com o id na mão — e `force row
 *      level security` faz isso valer inclusive para o dono da tabela.
 *   3. Teto de exportação por usuário no ramo `.docx` (montar documento
 *      custa CPU no MESMO processo que serve as telas — a Hostinger roda UM
 *      processo; ver `server/exportacao/limite.ts`).
 *   4. Kill-switch duplo: `copiloto_sessao.ativo` e
 *      `copiloto_sessao.retrospecto_ativo` (fail-closed: chave ausente ⇒
 *      desligado).
 *
 * 🔴 SEM RETROSPECTO → **404 COM CÓDIGO** (`retrospecto_nao_encontrado`),
 * nunca 200 com corpo vazio: um documento vazio devolvido com sucesso é
 * exatamente o "dado inventado na tela" que a regra da casa proíbe — a tela
 * renderizaria zeros plausíveis.
 * ===========================================================================
 */

const ParametroSchema = z.object({ id: z.string().uuid() });

/** Montar o `.docx` custa CPU no processo que serve as telas. 30 por 5 min
 * por usuário é folgado para uso humano e barra laço no front. */
const TETO_EXPORTACAO = 30;
/** Teto do ramo JSON (F7) — BALDE SEPARADO e bem mais alto: ler o documento
 * é uma leitura por PK, e a advogada pode reabrir o pop-up e trocar de aba
 * várias vezes numa sessão difícil sem que isso gaste a cota de DOWNLOAD.
 * 300 por 5 min é ~1 por segundo: nenhum uso humano chega perto, e um laço
 * no front bate no teto em vez de martelar o banco indefinidamente. */
const TETO_LEITURA = 300;
const JANELA_MS = 5 * 60_000;

/**
 * 🔴 NOME DE ARQUIVO SEM PII E SEM SUPERFÍCIE DE INJEÇÃO.
 *
 * Duas coisas ao mesmo tempo:
 *   (a) NENHUM dado do cliente entra aqui — nem nome, nem e-mail. O nome do
 *       arquivo vaza para histórico de download, backup e anexo de e-mail
 *       (regra 4 da 0028, a mesma que vale para `/p/m`). O documento é sobre
 *       a SESSÃO DE COPILOTO; quem o baixou sabe de quem é.
 *   (b) O único pedaço variável é a DATA, formatada por `toISOString()` —
 *       `[0-9T:.Z-]` e nada mais. Não existe caminho para aspa, CRLF ou
 *       unicode entrarem no cabeçalho `Content-Disposition`, que é a
 *       injeção clássica deste header. O `filename*=UTF-8''` vai junto por
 *       consistência com a rota do croqui (nome com acento resolvido lá),
 *       mesmo com um nome que hoje é ASCII puro — se um dia alguém
 *       acrescentar um rótulo acentuado, o par já está certo.
 */
function nomeArquivoRetrospecto(criadoEm: string): string {
  const data = new Date(criadoEm);
  const carimbo = Number.isNaN(data.getTime()) ? "sem-data" : data.toISOString().slice(0, 10);
  return `Retrospecto-da-Sessao-${carimbo}.docx`;
}

function exigirLimite(usuario: UsuarioAtual, balde: "docx" | "json") {
  const limite = consumir(
    `${usuario.id}:retrospecto-${balde}`,
    balde === "docx" ? TETO_EXPORTACAO : TETO_LEITURA,
    JANELA_MS,
  );
  if (!limite.permitido) {
    // F6 (pentest Fase 13): `erroLimite` acrescenta `Retry-After` ao 429.
    // Sem ele, um cliente que reage a 429 automaticamente volta no mesmo
    // instante e toma 429 de novo — laço que o teto deveria justamente
    // evitar. `esperar_segundos` continua no corpo para a tela.
    throw erroLimite("limite_exportacao", "Muitas exportações seguidas. Tente de novo em instantes.", limite.esperarSegundos);
  }
}

function respostaArquivo(bytes: Buffer, nomeArquivo: string): NextResponse {
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": MIME_DOCX,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `attachment; filename="${nomeArquivo}"; filename*=UTF-8''${encodeURIComponent(nomeArquivo)}`,
      // Documento de cliente: não fica em cache de proxy nem de navegador.
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const contexto = "GET /api/sessoes/[id]/copiloto/retrospecto";
  try {
    const usuario = await exigirVePatrimonio();
    const { id: sessaoId } = ParametroSchema.parse(await context.params);

    // Cliente COM SESSÃO — a RLS da 0125 é quem decide o que volta. Nunca
    // `criarClienteAdmin()` numa rota de LEITURA: service_role ignora RLS e
    // transformaria a URL na única trava, que é o padrão de IDOR.
    const supabase = await criarClienteServidor();

    if (!(await copilotoEstaAtivo(supabase))) {
      throw erroConflito("copiloto_desligado", "O copiloto está desligado (copiloto_sessao.ativo = false em Admin).");
    }
    // Fail-closed: chave ausente ⇒ false (ver `retrospectoEstaAtivo`).
    if (!(await retrospectoEstaAtivo(supabase))) {
      throw erroConflito(
        "retrospecto_desligado",
        "O Retrospecto da Sessão está desligado (copiloto_sessao.retrospecto_ativo = false em Admin).",
      );
    }

    // F7 (pentest Fase 13): o teto vale para os DOIS ramos, não só o `.docx`.
    // O JSON é barato (uma leitura por PK), mas "barato" não é "de graça": é
    // rota autenticada que devolve PII pesada, e um laço no front bateria
    // nela sem limite nenhum. Cobrado ANTES da leitura, de propósito — quem
    // estourou o teto não chega a tocar o banco.
    //
    // Baldes SEPARADOS: abrir o pop-up 40× numa sessão difícil não pode
    // consumir a cota de BAIXAR o documento, e o `.docx` é ordem de grandeza
    // mais caro (monta o arquivo na CPU do MESMO processo que serve as telas
    // — a Hostinger roda UM processo).
    const ehDocx = request.nextUrl.searchParams.get("formato") === "docx";
    exigirLimite(usuario, ehDocx ? "docx" : "json");

    const leitura = await lerRetrospectoComEstado(supabase, sessaoId);

    // 🔴 D-1: linha ANONIMIZADA (0127 zerou `conteudo`) não é retrospecto, é
    // lápide — e nunca é remontada (as fontes também foram zeradas). Código
    // próprio para a tela dizer a verdade ("o tratamento deste titular foi
    // encerrado") em vez de "não encontrado", que soa como defeito.
    if (leitura.estado === "lapide") {
      throw new ErroApi(
        404,
        "retrospecto_indisponivel",
        "O Retrospecto desta sessão não está mais disponível.",
      );
    }

    let retrospecto: RetrospectoDaSessao | null = leitura.estado === "ok" ? leitura.retrospecto : null;

    // 🔴 D-2: não há linha. Se a sessão está encerrada, a gravação do
    // encerramento falhou (ela nunca derruba o encerramento — ver
    // `gravarRetrospectoDaSessao`), e `marcarEncerrada` já não deixa o
    // encerramento rodar de novo: sem isto, a advogada perderia o documento
    // para sempre, sem nunca saber por quê. Monta e grava agora.
    //
    // `criarClienteAdmin()` entra SÓ AQUI, e só para ESCREVER: a leitura
    // acima já passou pela RLS com o cliente de sessão, e
    // `remontarRetrospectoSeEncerrada` relê a sessão com o cliente de sessão
    // antes de gravar. Nenhuma leitura desta rota usa service_role.
    if (!retrospecto && leitura.estado === "ausente") {
      retrospecto = await remontarRetrospectoSeEncerrada(supabase, criarClienteAdmin(), sessaoId);
    }

    if (!retrospecto) {
      // 404 COM CÓDIGO ESTÁVEL (`retrospecto_nao_encontrado`,
      // `CodigoRecusaRetrospecto`) — a tela distingue "ainda não existe" de
      // "desligado" sem ler a mensagem.
      //
      // 🔴 F4: a versão anterior dizia que este 404 "não confirma a
      // existência de retrospecto de outra jornada". Não é o que acontece, e
      // afirmar isso escondia a realidade: para quem TEM `ve_patrimonio` a
      // leitura de outra jornada RETORNA (ver o docblock de topo — gate de
      // papel, não recorte de linha), então o 404 aqui significa mesmo "não
      // existe". Para quem NÃO tem `ve_patrimonio`, a requisição nem chega
      // aqui: morre no 403 de `exigirVePatrimonio()`.
      throw new ErroApi(404, "retrospecto_nao_encontrado", "Não existe Retrospecto para esta sessão.");
    }

    if (ehDocx) {
      const bytes = await montarDocxRetrospecto(retrospecto);
      return respostaArquivo(bytes, nomeArquivoRetrospecto(retrospecto.criado_em));
    }

    return NextResponse.json(retrospecto, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate, private" },
    });
  } catch (erro) {
    // `respostaErro` já registra sem corpo de resposta — nenhuma citação
    // literal do `conteudo` chega ao log por este caminho.
    return respostaErro(contexto, erro);
  }
}
