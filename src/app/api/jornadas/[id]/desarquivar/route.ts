export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel } from "@/server/auth";
import { erroConflito, erroNaoEncontrado, erroSemPermissao, registrarErro, respostaErro } from "@/server/erros";
import { desarquivarJornada, traduzErroArquivamento } from "@/server/jornadas";

/**
 * POST /api/jornadas/[id]/desarquivar — o "Desfazer" do toast (Fase 8, D16/D17).
 *
 * Sem corpo: desarquivar não tem opção. Ou o processo volta como estava, ou o
 * banco recusa com motivo — e o motivo mais comum não é técnico: a pessoa
 * ganhou OUTRO processo enquanto este estava arquivado, e a regra da casa é um
 * processo aberto por pessoa (`uniq_jornada_aberta_por_pessoa`, 0004).
 *
 * O que volta e o que não volta está em `public.desarquivar_jornada` (0086):
 * mensagem ainda no futuro volta para a fila; mensagem cuja hora passou fica
 * cancelada (mandar hoje o "sua sessão é amanhã" de uma sessão da semana
 * passada é pior que não mandar); ligação por IA não é re-enfileirada.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirPapel("admin", "advogada", "relacionamento");

    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      throw erroNaoEncontrado("Processo não encontrado.");
    }

    const supabase = await criarClienteServidor();
    const resultado = await desarquivarJornada(supabase, id);

    return NextResponse.json({ resultado });
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String((erro as { message?: string })?.message ?? "");
    const traduzido = traduzErroArquivamento(mensagem);
    if (traduzido) {
      if (traduzido.http === 403) return respostaErro("api/jornadas/[id]/desarquivar POST", erroSemPermissao(traduzido.mensagem));
      if (traduzido.http === 404) return respostaErro("api/jornadas/[id]/desarquivar POST", erroNaoEncontrado(traduzido.mensagem));
      return respostaErro("api/jornadas/[id]/desarquivar POST", erroConflito(traduzido.codigo, traduzido.mensagem));
    }
    registrarErro("api/jornadas/[id]/desarquivar POST", erro);
    return respostaErro("api/jornadas/[id]/desarquivar POST", erro);
  }
}
