export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno } from "@/server/auth";
import { registrarErro, respostaErro } from "@/server/erros";
import type { MensagemRecebida } from "@/types/integracoes";

const LIMITE_PADRAO = 100;

const FiltrosSchema = z.object({
  sem_vinculo: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  limite: z.coerce.number().int().min(1).max(200).default(LIMITE_PADRAO),
});

/** Códigos que significam "tabela ainda não existe" (0054 não aplicada) — Postgres e PostgREST. */
const CODIGOS_TABELA_AUSENTE = new Set(["42P01", "PGRST205", "PGRST200", "PGRST204"]);

interface MensagemRecebidaLinha extends MensagemRecebida {
  pessoas: { nome: string } | { nome: string }[] | null;
}

/** Item da lista: a linha da 0054 + o nome da pessoa vinculada (join), sem o `bruto`. */
export interface MensagemRecebidaItem extends MensagemRecebida {
  pessoa_nome: string | null;
}

export interface RespostaMensagensRecebidas {
  /** `false` quando `mensagens_recebidas` ainda não existe no banco — a tela mostra "ainda não disponível". */
  disponivel: boolean;
  itens: MensagemRecebidaItem[];
}

/**
 * GET /api/mensagens/recebidas[?sem_vinculo=true&limite=100] — caixa de
 * entrada do WhatsApp (Chatwoot → `mensagens_recebidas`, 0054) para a tela
 * Comunicação. `sem_vinculo=true` filtra as que o telefone não casou com
 * ninguém ("Sem correspondência" → botão "Vincular a uma pessoa").
 *
 * RLS `mr_sel` (interno lê) já vale no cliente de sessão; a rota checa de
 * novo. Nunca devolve `bruto` (payload inteiro do Chatwoot) — a tela não
 * precisa e ele pode carregar dado de terceiros.
 *
 * Tabela ausente (migration 0054 não aplicada) NÃO é erro: responde
 * `{disponivel:false, itens:[]}` para a tela rotular, em vez de 500.
 */
export async function GET(request: NextRequest) {
  try {
    await exigirInterno();
    const filtros = FiltrosSchema.parse(Object.fromEntries(request.nextUrl.searchParams.entries()));

    const supabase = await criarClienteServidor();
    let consulta = supabase
      .from("mensagens_recebidas")
      .select(
        "id, canal, provedor, conversa_externa_id, mensagem_externa_id, telefone, pessoa_id, jornada_id, corpo, anexos, recebida_em, vinculada_por, vinculada_em, criado_em, pessoas(nome)",
      )
      .order("recebida_em", { ascending: false })
      .limit(filtros.limite);
    if (filtros.sem_vinculo) consulta = consulta.is("pessoa_id", null);

    const { data, error } = await consulta;
    if (error) {
      const codigo = (error as { code?: string }).code ?? "";
      if (CODIGOS_TABELA_AUSENTE.has(codigo)) {
        const resposta: RespostaMensagensRecebidas = { disponivel: false, itens: [] };
        return NextResponse.json(resposta);
      }
      registrarErro("api/mensagens/recebidas GET", error, { filtros });
      throw error;
    }

    const linhas = (data as unknown as MensagemRecebidaLinha[] | null) ?? [];
    const itens: MensagemRecebidaItem[] = linhas.map(({ pessoas, ...linha }) => {
      const pessoa = Array.isArray(pessoas) ? pessoas[0] : pessoas;
      return { ...linha, pessoa_nome: pessoa?.nome ?? null };
    });

    const resposta: RespostaMensagensRecebidas = { disponivel: true, itens };
    return NextResponse.json(resposta);
  } catch (erro) {
    return respostaErro("api/mensagens/recebidas GET", erro);
  }
}
