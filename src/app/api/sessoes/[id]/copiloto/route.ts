export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirVePatrimonio } from "@/server/auth";
import { erroConflito, respostaErro } from "@/server/erros";
import { montarEstadoCopiloto } from "@/server/copiloto/estado";
import { copilotoEstaAtivo } from "@/server/copiloto/config";

const ParametroSchema = z.object({ id: z.string().uuid() });

// `bloco` é opcional: sem ele, a rota assume o primeiro bloco (0) — só quem
// já está com a tela aberta (ConduzirSessaoApp, que guarda o índice em
// sessionStorage) manda o índice real. Fora do intervalo válido é tratado
// dentro de `montarEstadoCopiloto` (trata como 0, nunca lança).
const QuerySchema = z.object({
  bloco: z.coerce.number().int().min(0).optional().default(0),
});

/**
 * GET /api/sessoes/[id]/copiloto — estado DETERMINÍSTICO do copiloto ao vivo
 * (Fase 10, Fatia 1, docs/ARQUITETURA-FASE-10.md §8, §12). Zero IA: o que
 * falta no bloco atual (`campos[]`/`observar[]` do roteiro), SIMs pendentes,
 * blocos ainda não percorridos. UMA rota, UMA query coalescida — é o formato
 * que a Fatia 3 (polling automático) vai reusar sem trocar de contrato
 * (§2.4/C9), por isso já nasce como `GET /api/sessoes/[id]/copiloto` e não
 * como algo específico desta fatia.
 *
 * Mesma trava de papel que a leitura de transcrição (`exigirVePatrimonio`):
 * é o mesmo recorte de PII de conversa patrimonial que rege `transcricoes`
 * (0032) e as 3 tabelas novas da 0091 (RLS `app.ve_patrimonio()`).
 *
 * KILL-SWITCH (achado do Fable, corrigido): `copiloto_sessao.ativo=false` é
 * fail-closed AQUI, não só descrição no banco. 409 `copiloto_desligado` —
 * contrato para o front distinguir "desligado" de erro genérico (nunca
 * sumiço mudo; a tela deve renderizar um estado explícito, não um 500/404).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirVePatrimonio();
    const { id: sessaoId } = ParametroSchema.parse(await params);
    const { bloco } = QuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));

    const supabase = await criarClienteServidor();

    if (!(await copilotoEstaAtivo(supabase))) {
      throw erroConflito(
        "copiloto_desligado",
        "O copiloto está desligado (copiloto_sessao.ativo = false em Admin).",
      );
    }

    const estado = await montarEstadoCopiloto(supabase, sessaoId, bloco);

    return NextResponse.json(estado);
  } catch (erro) {
    return respostaErro("GET /api/sessoes/[id]/copiloto", erro);
  }
}
