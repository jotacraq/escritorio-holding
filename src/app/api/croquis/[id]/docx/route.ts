export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirVePatrimonio, type UsuarioAtual } from "@/server/auth";
import { ErroApi, erroConflito, erroNaoEncontrado, registrarErro, respostaErro } from "@/server/erros";
import { MIME_DOCX, montarDocxCroqui, type CabecalhoDocxCroqui } from "@/server/exportacao/docx-croqui";
import { consumir } from "@/server/exportacao/limite";
import type { ResultadoCroqui } from "@/types/croqui-calculo";

/**
 * `GET /api/croquis/[id]/docx` — o Relatório do Croqui em `.docx`, para download.
 *
 * `GET ?info=1` devolve JSON dizendo se há cálculo fixado (e qual versão) — é
 * o que a UI consulta, barato, para decidir se renderiza o botão.
 *
 * Só download. Houve um destino "Google Drive" (service account, pasta por
 * cliente) que foi REMOVIDO em 05/09/2026: a pasta do Drive de um cliente
 * serviu de referência para entender o método, não de padrão a replicar — o
 * sistema é a fonte, e o advogado guarda o arquivo onde quiser.
 *
 * Trava de papel: `ve_patrimonio` (admin/advogada) — o relatório é o croqui
 * inteiro, com patrimônio, imposto e composição familiar. `relacionamento` não
 * exporta. A RLS é a segunda trava: o cálculo vem por `vw_croqui_calculo_atual`,
 * lida com a SESSÃO, e `croqui_calculos` está sob `app.ve_patrimonio()`.
 */

const ParamsSchema = z.object({ id: z.string().uuid() });

/** Um relatório pesa ~19 tabelas de render; 20 por 5 min por pessoa é folgado. */
const TETO_EXPORTACAO = 20;
const JANELA_MS = 5 * 60_000;

interface CroquiDaRota {
  id: string;
  jornada_id: string;
}

interface JornadaDoCroqui {
  id: string;
  origem_dado: "real" | "exemplo";
  pessoas: { nome: string | null } | null;
}

interface CalculoAtual {
  id: string;
  versao: number;
  motor_versao: string;
  resultado: ResultadoCroqui;
  criado_em: string;
}

type Cliente = Awaited<ReturnType<typeof criarClienteServidor>>;

/** Croqui + jornada + pessoa, lidos pela SESSÃO (a RLS decide, não a URL). */
async function lerContexto(supabase: Cliente, croquiId: string) {
  const { data: croqui, error } = await supabase
    .from("croquis")
    .select("id, jornada_id")
    .eq("id", croquiId)
    .maybeSingle<CroquiDaRota>();
  if (error) throw error;
  if (!croqui) throw erroNaoEncontrado("Croqui não encontrado.");

  const { data: jornada, error: erroJornada } = await supabase
    .from("jornadas")
    .select("id, origem_dado, pessoas(nome)")
    .eq("id", croqui.jornada_id)
    .maybeSingle<JornadaDoCroqui>();
  if (erroJornada) throw erroJornada;
  if (!jornada) throw erroNaoEncontrado("Jornada do croqui não encontrada.");

  return { croqui, jornada };
}

async function lerCalculoAtual(supabase: Cliente, jornadaId: string): Promise<CalculoAtual> {
  const { data, error } = await supabase
    .from("vw_croqui_calculo_atual")
    .select("id, versao, motor_versao, resultado, criado_em")
    .eq("jornada_id", jornadaId)
    .maybeSingle<CalculoAtual>();
  if (error) throw error;
  if (!data) {
    throw erroConflito(
      "sem_calculo",
      "Este croqui ainda não tem cálculo gravado. Gere o cálculo antes de exportar o relatório.",
    );
  }
  return data;
}

/** `configuracoes['croqui.assinatura']`, com o padrão do escritório. */
const ASSINATURA_PADRAO = "Time Holding Brasil · Dra. Elaine Montenegro";

async function lerAssinatura(supabase: Cliente): Promise<string> {
  const { data, error } = await supabase
    .from("configuracoes")
    .select("valor")
    .eq("chave", "croqui.assinatura")
    .maybeSingle<{ valor: unknown }>();
  if (error) {
    // Assinatura é decoração do cabeçalho; não vale derrubar a exportação.
    registrarErro("api/croquis/[id]/docx#assinatura", error);
    return ASSINATURA_PADRAO;
  }
  const valor = data?.valor;
  return typeof valor === "string" && valor.trim().length > 0 ? valor.trim() : ASSINATURA_PADRAO;
}

/**
 * Nome do arquivo baixado. **Só o primeiro nome** — mesma regra 4 da 0028 que
 * vale para `/p/m`: o nome do arquivo vaza para histórico de download, backup e
 * anexo de e-mail. Sem acento, sem espaço, sem sobrenome, sem id interno.
 */
function nomeArquivoDownload(nomeCompleto: string | null, versao: number): string {
  const primeiro = (nomeCompleto ?? "").trim().split(/\s+/)[0] ?? "";
  // NFD separa a letra do acento; o filtro seguinte descarta tudo que não
  // for ASCII alfanumérico — acento, cedilha, hífen e espaço somem juntos.
  const limpo = primeiro
    .normalize("NFD")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 24);
  return `Relatorio-do-Croqui-${limpo || "cliente"}-v${versao}.docx`;
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

function exigirLimite(usuario: UsuarioAtual, operacao: string, teto: number) {
  const limite = consumir(`${usuario.id}:${operacao}`, teto, JANELA_MS);
  if (!limite.permitido) {
    throw new ErroApi(429, "limite_exportacao", "Muitas exportações seguidas. Tente de novo em instantes.", {
      esperar_segundos: limite.esperarSegundos,
    });
  }
}

/**
 * Registro na timeline. Falha aqui não desfaz a exportação — só é logada.
 *
 * `tipo` é `croqui_exportacao`, NÃO `croqui`: o tipo `croqui` é o canal do
 * trigger `app.timeline_croqui` (0014), que sempre carrega `dados.status`, e é
 * dele que `sinaisDaFicha()` deriva o estado do croqui na Pasta e no trilho.
 * Um "Relatório exportado" gravado como `croqui` (sem `status`) virava
 * "croqui pronto — apresentar" na tela, até com o croqui em rascunho. Migration
 * 0070 fez a mesma separação do lado do banco e reclassificou os eventos que
 * este código já tinha gravado.
 */
async function registrarNaTimeline(
  supabase: Cliente,
  args: { jornadaId: string; croquiId: string; usuario: UsuarioAtual; versao: number },
) {
  const { error } = await supabase.from("eventos_timeline").insert({
    jornada_id: args.jornadaId,
    tipo: "croqui_exportacao",
    titulo: "Relatório exportado",
    descricao: "Baixado em .docx",
    dados: { croqui_id: args.croquiId, destino: "download", versao_calculo: args.versao },
    ator_perfil_id: args.usuario.id,
    ator_tipo: "humano",
  });
  if (error) {
    registrarErro("api/croquis/[id]/docx#timeline", error, { croqui_id: args.croquiId });
  }
}

async function montar(
  supabase: Cliente,
  croquiId: string,
): Promise<{
  bytes: Buffer;
  nomeArquivo: string;
  jornadaId: string;
  versao: number;
}> {
  const { croqui, jornada } = await lerContexto(supabase, croquiId);
  const [calculo, assinatura] = await Promise.all([
    lerCalculoAtual(supabase, croqui.jornada_id),
    lerAssinatura(supabase),
  ]);

  const nomeCliente = jornada.pessoas?.nome?.trim() || "Cliente";
  const cabecalho: CabecalhoDocxCroqui = {
    nomeCliente,
    dataCalculo: calculo.criado_em,
    advogada: assinatura,
    motorVersao: calculo.motor_versao,
    versaoCalculo: calculo.versao,
    origemDado: jornada.origem_dado === "exemplo" ? "exemplo" : "real",
  };

  const bytes = await montarDocxCroqui(calculo.resultado, cabecalho);
  return {
    bytes,
    nomeArquivo: nomeArquivoDownload(jornada.pessoas?.nome ?? null, calculo.versao),
    jornadaId: croqui.jornada_id,
    versao: calculo.versao,
  };
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const contexto = "GET /api/croquis/[id]/docx";
  try {
    const usuario = await exigirVePatrimonio();
    const { id } = ParamsSchema.parse(await context.params);
    const supabase = await criarClienteServidor();

    // `?info=1`: o que a UI precisa saber ANTES de mostrar botão. Barato, sem
    // montar o documento.
    if (request.nextUrl.searchParams.get("info") === "1") {
      const { croqui } = await lerContexto(supabase, id);
      const { data } = await supabase
        .from("vw_croqui_calculo_atual")
        .select("versao, criado_em")
        .eq("jornada_id", croqui.jornada_id)
        .maybeSingle<{ versao: number; criado_em: string }>();
      return NextResponse.json(
        { calculo: data ? { versao: data.versao, criado_em: data.criado_em } : null },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    exigirLimite(usuario, "docx", TETO_EXPORTACAO);

    const montado = await montar(supabase, id);
    await registrarNaTimeline(supabase, {
      jornadaId: montado.jornadaId,
      croquiId: id,
      usuario,
      versao: montado.versao,
    });
    return respostaArquivo(montado.bytes, montado.nomeArquivo);
  } catch (erro) {
    return respostaErro(contexto, erro);
  }
}
