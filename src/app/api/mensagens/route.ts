export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno } from "@/server/auth";
import { registrarErro, respostaErro } from "@/server/erros";

const LIMITE = 200;

const FiltrosSchema = z.object({
  status: z.enum(["pendente", "enviando", "enviada", "falhou", "cancelada"]).optional(),
  canal: z.enum(["email", "whatsapp"]).optional(),
});

interface MensagemAgendadaLinha {
  id: string;
  jornada_id: string;
  canal: "email" | "whatsapp";
  destinatario: string;
  agendada_para: string;
  status: "pendente" | "enviando" | "enviada" | "falhou" | "cancelada";
  corpo_renderizado: string | null;
  erro: string | null;
  enviada_em: string | null;
  jornadas: { pessoas: { nome: string } | { nome: string }[] | null } | { pessoas: { nome: string } | { nome: string }[] | null }[] | null;
}

/**
 * GET /api/mensagens — fila de `mensagens_agendadas` para a tela `/comunicacao`
 * (F8): régua automática de e-mail + fila manual de WhatsApp. Junta o nome da
 * pessoa via `jornada_id -> jornadas -> pessoas` (o corpo já vem congelado em
 * `corpo_renderizado`, gravado no enfileiramento — não precisa reler o template).
 * `ma_sel` na RLS já exige `app.eh_interno()`; a rota checa de novo.
 */
export async function GET(request: NextRequest) {
  try {
    await exigirInterno();

    const params = Object.fromEntries(request.nextUrl.searchParams.entries());
    const filtros = FiltrosSchema.parse(params);

    const supabase = await criarClienteServidor();
    let query = supabase
      .from("mensagens_agendadas")
      .select(
        "id, jornada_id, canal, destinatario, agendada_para, status, corpo_renderizado, erro, enviada_em, jornadas(pessoas(nome))",
      )
      .order("agendada_para", { ascending: true })
      .limit(LIMITE);

    if (filtros.status) query = query.eq("status", filtros.status);
    if (filtros.canal) query = query.eq("canal", filtros.canal);

    const { data, error } = await query;
    if (error) {
      registrarErro("api/mensagens GET", error, { filtros });
      throw error;
    }

    const linhas = (data as unknown as MensagemAgendadaLinha[] | null) ?? [];
    const itens = linhas.map((linha) => {
      const jornada = Array.isArray(linha.jornadas) ? linha.jornadas[0] : linha.jornadas;
      const pessoaBruta = jornada ? (Array.isArray(jornada.pessoas) ? jornada.pessoas[0] : jornada.pessoas) : null;
      return {
        id: linha.id,
        jornada_id: linha.jornada_id,
        pessoa_nome: pessoaBruta?.nome,
        canal: linha.canal,
        destinatario: linha.destinatario,
        agendada_para: linha.agendada_para,
        status: linha.status,
        corpo_renderizado: linha.corpo_renderizado,
        erro: linha.erro,
        enviada_em: linha.enviada_em,
      };
    });

    return NextResponse.json({ itens });
  } catch (erro) {
    return respostaErro("api/mensagens GET", erro);
  }
}
