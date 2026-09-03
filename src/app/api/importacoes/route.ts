export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel } from "@/server/auth";
import { erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import {
  CHAVE_TAMANHO_MAXIMO_BYTES,
  lerConfiguracaoInt,
  TAMANHO_MAXIMO_BYTES_PADRAO,
} from "@/server/importacao/config";
import { ErroImportacao } from "@/server/importacao/erros";
import { processarNovaImportacao } from "@/server/importacao/processarImportacao";
import { CAMPOS_IMPORTAVEIS } from "@/types/importacao";
import type { Importacao, MapaColunas } from "@/types/importacao";

const TAMANHO_PAGINA = 50;

/** Folga para o resto do multipart (campos de texto, boundaries) além do
 * próprio arquivo — o teto real de tamanho de ARQUIVO é o de `configuracoes`. */
const FOLGA_MULTIPART_BYTES = 256 * 1024;

const CODIGO_PARA_STATUS: Record<string, number> = {
  tamanho_invalido: 413,
  extensao_invalida: 415,
  arquivo_vazio: 422,
  sem_linhas: 422,
  limite_linhas_excedido: 422,
  mapeamento_coluna_inexistente: 422,
  mapeamento_campo_invalido: 422,
  mapeamento_campo_duplicado: 422,
  mapeamento_sem_nome: 422,
};

const FiltrosSchema = z.object({
  edicao_id: z.string().uuid().optional(),
  status: z.enum(["previa", "confirmada", "cancelada"]).optional(),
  pagina: z.coerce.number().int().min(1).max(10_000).default(1),
});

/**
 * GET /api/importacoes — histórico de importações (qualquer papel interno lê;
 * dado operacional, não é valor de patrimônio). Paginado, mais recente primeiro.
 */
export async function GET(request: NextRequest) {
  try {
    await exigirPapel();

    const params = Object.fromEntries(request.nextUrl.searchParams.entries());
    const filtros = FiltrosSchema.parse(params);

    const supabase = await criarClienteServidor();
    let query = supabase.from("importacoes").select("*", { count: "exact" });
    if (filtros.edicao_id) query = query.eq("edicao_id", filtros.edicao_id);
    if (filtros.status) query = query.eq("status", filtros.status);

    const inicio = (filtros.pagina - 1) * TAMANHO_PAGINA;
    query = query.order("criado_em", { ascending: false }).range(inicio, inicio + TAMANHO_PAGINA - 1);

    const { data, error, count } = await query;
    if (error) {
      registrarErro("api/importacoes GET", error, { filtros });
      throw error;
    }

    return NextResponse.json({ itens: (data as Importacao[] | null) ?? [], total: count ?? 0 });
  } catch (erro) {
    return respostaErro("api/importacoes GET", erro);
  }
}

const MapaColunasSchema = z.record(z.string().trim().min(1).max(200), z.enum(CAMPOS_IMPORTAVEIS));

/**
 * POST /api/importacoes — fase 1 (prévia). Corpo `multipart/form-data`:
 *   - `arquivo`: File (.csv)
 *   - `edicao_id`: uuid da edição do seminário (`edicoes_seminario.id`)
 *   - `mapa_colunas`: JSON `{ "<cabeçalho do arquivo>": "<campo do domínio>" }`
 *
 * Zero escrita em `pessoas`/`jornadas` — só grava a prévia (`status='previa'`).
 * Confirmar é uma chamada separada (`POST /api/importacoes/[id]/confirmar`),
 * só depois que o operador viu o resultado desta rota (BLOQUEIO B18: nunca
 * hardcoda layout de CSV — o mapa vem inteiro do cliente, casado na tela).
 */
export async function POST(request: NextRequest) {
  try {
    const usuario = await exigirPapel("admin", "advogada", "relacionamento");

    const supabase = await criarClienteServidor();
    const tamanhoMaximo = await lerConfiguracaoInt(supabase, CHAVE_TAMANHO_MAXIMO_BYTES, TAMANHO_MAXIMO_BYTES_PADRAO);

    // Corta cedo por `Content-Length` ANTES de bufferizar o corpo inteiro em
    // memória com `request.formData()` — defesa contra CSV gigante além do
    // que o header já denuncia (quando o cliente manda o header corretamente;
    // sem ele, `arquivo.size` ainda é checado depois, dentro de
    // `processarNovaImportacao`, mas nesse caso o corpo já foi bufferizado
    // pelo runtime do Next — limitação conhecida de Route Handler, registrada
    // no relatório de entrega).
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > 0 && contentLength > tamanhoMaximo + FOLGA_MULTIPART_BYTES) {
      throw new ErroImportacao("Requisição maior que o limite de tamanho aceito.", "tamanho_invalido");
    }

    const formData = await request.formData().catch(() => {
      throw erroValidacao(null, "Corpo da requisição precisa ser multipart/form-data válido.");
    });

    const arquivo = formData.get("arquivo");
    if (!(arquivo instanceof File)) {
      throw erroValidacao(null, "Campo 'arquivo' (CSV) ausente.");
    }

    const edicaoId = z.string().uuid().parse(formData.get("edicao_id"));

    const { data: edicao, error: erroEdicao } = await supabase
      .from("edicoes_seminario")
      .select("id")
      .eq("id", edicaoId)
      .maybeSingle();
    if (erroEdicao) throw erroEdicao;
    if (!edicao) {
      throw erroValidacao({ campo: "edicao_id" }, "Edição de seminário não encontrada.");
    }

    const mapaColunasBruto = formData.get("mapa_colunas");
    if (typeof mapaColunasBruto !== "string") {
      throw erroValidacao(null, "Campo 'mapa_colunas' (JSON) ausente.");
    }
    let mapaColunasJson: unknown;
    try {
      mapaColunasJson = JSON.parse(mapaColunasBruto);
    } catch {
      throw erroValidacao(null, "'mapa_colunas' precisa ser um JSON válido.");
    }
    const mapaColunas = MapaColunasSchema.parse(mapaColunasJson) as MapaColunas;

    const { importacao } = await processarNovaImportacao(supabase, {
      arquivo,
      edicaoId,
      mapaColunas,
      criadoPor: usuario.id,
    });

    return NextResponse.json({ importacao }, { status: 201 });
  } catch (erro) {
    if (erro instanceof ErroImportacao) {
      return NextResponse.json(
        { erro: erro.codigo, mensagem: erro.message },
        { status: CODIGO_PARA_STATUS[erro.codigo] ?? 422 },
      );
    }
    return respostaErro("api/importacoes POST", erro);
  }
}
