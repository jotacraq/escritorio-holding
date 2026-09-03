import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { exigirVePatrimonio } from "@/server/auth";
import { respostaErro } from "@/server/erros";
import { criarClienteServidor } from "@/lib/supabase/server";
import { construirSlidesBase, CroquiConteudoSchema } from "@/server/ia/schema-croqui-slides";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CorpoSchema = z.object({
  jornada_id: z.string().uuid(),
  titulo: z.string().min(1).max(200),
  // Opcional: se o cliente já monta os 13 slides localmente (como
  // `criarEsqueletoSlides()` em src/lib/croqui.ts), a rota valida e usa; se
  // omitido, gera o padrão do método no servidor.
  conteudo: CroquiConteudoSchema.optional(),
});

/**
 * POST /api/croquis — cria um croqui novo (versão seguinte para a jornada) já
 * com os 13 slides tipados do método (Legado ... Investimento), `conteudo`
 * editável. Usa o cliente com sessão (RLS aplica de verdade): só
 * admin/advogada gravam croqui, mesmo recorte de patrimônio.
 *
 * NOTA de integração: `src/lib/api.ts` (já escrito) chama
 * `POST /api/jornadas/[id]/croqui` para criar — fora da minha fronteira
 * (`src/app/api/jornadas/**` é do BACK-CORE). Esta rota aqui é a que consta no
 * meu escopo (CLAUDE.md). Reportado como gap de integração a fechar pelo
 * orquestrador; `construirSlidesBase()` está exportado justamente para o
 * BACK-CORE reaproveitar na rota deles em vez de duplicar a lista de slides.
 */
export async function POST(request: NextRequest) {
  try {
    const usuario = await exigirVePatrimonio();
    const corpo = CorpoSchema.parse(await request.json());

    const supabase = await criarClienteServidor();

    const { data: ultimoCroqui } = await supabase
      .from("croquis")
      .select("versao")
      .eq("jornada_id", corpo.jornada_id)
      .order("versao", { ascending: false })
      .limit(1)
      .maybeSingle<{ versao: number }>();

    const proximaVersao = (ultimoCroqui?.versao ?? 0) + 1;

    const { data: croqui, error } = await supabase
      .from("croquis")
      .insert({
        jornada_id: corpo.jornada_id,
        versao: proximaVersao,
        titulo: corpo.titulo,
        status: "rascunho",
        conteudo: corpo.conteudo ?? construirSlidesBase(),
        criado_por: usuario.id,
        atualizado_por: usuario.id,
      })
      .select("id, jornada_id, versao, titulo, status, conteudo, criado_em")
      .single();

    if (error || !croqui) throw error ?? new Error("falha_ao_criar_croqui");

    return NextResponse.json({ croqui }, { status: 201 });
  } catch (erro) {
    return respostaErro("POST /api/croquis", erro);
  }
}
