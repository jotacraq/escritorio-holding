export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel } from "@/server/auth";
import { erroConflito, erroNaoEncontrado, erroSemPermissao, registrarErro, respostaErro } from "@/server/erros";
import { arquivarJornada, traduzErroArquivamento } from "@/server/jornadas";

const CorpoSchema = z.object({
  motivo: z.string().trim().min(1).max(1000),
  /**
   * B51 — nasce `false`, e o cliente TEM de pedir explicitamente. Revogar link
   * é irreversível; arquivar é reversível. Não se embute um no outro.
   */
  revogarLinks: z.boolean().optional().default(false),
});

/**
 * POST /api/jornadas/[id]/arquivar — "Arquivar processo" (Fase 8, D15–D17).
 *
 * ## O que muda em relação a mudar a "Situação" no combo
 *
 * O combo já gravava `desfecho='congelada'` e parava por aí: a régua continuava
 * mandando e-mail e a fila de ligação continuava discando para uma família cujo
 * processo o escritório considera parado. Esta rota chama
 * `public.arquivar_jornada` (0086), que faz TUDO numa transação só — desfecho,
 * régua, fila e (só se pedirem) links — e devolve o que fez, contado.
 *
 * ## Por que a RPC e não três `await` aqui
 *
 * Três `await supabase.from(...)` não são atômicos entre si. Se o segundo
 * falhasse, o processo ficaria arquivado com a automação viva — exatamente o
 * estado que a fase veio consertar.
 *
 * ## Autorização em duas camadas
 *
 * 1. `exigirPapel` na rota (mesma lista do PATCH de etapa).
 * 2. A RPC confere o papel de novo, por `auth.uid()` contra `perfis_equipe`.
 *    Por isso o cliente é o da SESSÃO e nunca o `service_role`: com
 *    service_role `auth.uid()` é nulo e a função recusa — fail-closed.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirPapel("admin", "advogada", "relacionamento");

    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      throw erroNaoEncontrado("Processo não encontrado.");
    }

    const corpo = CorpoSchema.parse(await request.json().catch(() => ({})));

    const supabase = await criarClienteServidor();
    const resultado = await arquivarJornada(supabase, {
      jornadaId: id,
      motivo: corpo.motivo,
      revogarLinks: corpo.revogarLinks,
    });

    return NextResponse.json({ resultado });
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String((erro as { message?: string })?.message ?? "");
    const traduzido = traduzErroArquivamento(mensagem);
    if (traduzido) {
      // A mensagem crua do Postgres carrega nome de função e id de linha —
      // nunca vai para o cliente. Sai o par (código estável, frase de gente).
      if (traduzido.http === 403) return respostaErro("api/jornadas/[id]/arquivar POST", erroSemPermissao(traduzido.mensagem));
      if (traduzido.http === 404) return respostaErro("api/jornadas/[id]/arquivar POST", erroNaoEncontrado(traduzido.mensagem));
      return respostaErro("api/jornadas/[id]/arquivar POST", erroConflito(traduzido.codigo, traduzido.mensagem));
    }
    registrarErro("api/jornadas/[id]/arquivar POST", erro);
    return respostaErro("api/jornadas/[id]/arquivar POST", erro);
  }
}
