export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno } from "@/server/auth";
import { respostaErro } from "@/server/erros";
import { listarSlotsDisponiveis } from "@/server/agenda/slots";
import { ParametroSlotsSchema } from "@/types/agenda";

/**
 * Preview interno dos horários livres da advogada — uso da equipe (ex.: tela
 * de agenda em `src/app/(app)/agenda`, F-2A) antes de marcar manualmente ou
 * de emitir um link público de agendamento. NUNCA exposta a `anon`: o cliente
 * só vê horário através de `agendamentos_sugestoes`, já pré-computado no
 * momento da emissão do link (ver `src/server/agenda/sugestoes.ts`).
 */
export async function GET(request: NextRequest) {
  try {
    await exigirInterno();
    const { advogada_id: advogadaId, de, ate } = ParametroSlotsSchema.parse(
      Object.fromEntries(request.nextUrl.searchParams),
    );

    const supabase = await criarClienteServidor();
    const slots = await listarSlotsDisponiveis(supabase, { advogadaId, de, ate });

    return NextResponse.json({ slots });
  } catch (erro) {
    return respostaErro("api/agenda/slots GET", erro);
  }
}
