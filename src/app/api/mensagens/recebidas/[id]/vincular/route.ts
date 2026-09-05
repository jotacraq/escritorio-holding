export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno } from "@/server/auth";
import { ErroApi, erroNaoEncontrado, erroSemPermissao, erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import { vincularMensagemRecebida } from "@/server/chatwoot/recebidas";
import type { MensagemRecebida } from "@/types/integracoes";

const ParametroSchema = z.object({ id: z.string().uuid() });
const CorpoSchema = z.object({ pessoa_id: z.string().uuid() });

/** Função/tabela ainda não existem (0054 não aplicada) — Postgres e PostgREST. */
const CODIGOS_AUSENTE = new Set(["42P01", "42883", "PGRST202", "PGRST205"]);

/**
 * POST /api/mensagens/recebidas/[id]/vincular {pessoa_id} — "Vincular a uma
 * pessoa" quando o telefone do Chatwoot não casou com ninguém. Chama a RPC
 * `vincular_mensagem_recebida(uuid, uuid)` (0054) com o cliente de SESSÃO:
 * a jornada é derivada pelo banco (a aberta da pessoa), `vinculada_por`
 * é o perfil de quem clicou — o cliente não escolhe nem um nem outro.
 *
 * Erros do banco viram código estável: `pessoa_invalida`/`mensagem_invalida`
 * (404), `sem_permissao` (403), objeto ausente (503 rotulado).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = "api/mensagens/recebidas/[id]/vincular POST";
  try {
    await exigirInterno();
    const { id } = ParametroSchema.parse(await params);
    const corpo = CorpoSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    const supabase = await criarClienteServidor();
    let mensagem: MensagemRecebida;
    try {
      mensagem = await vincularMensagemRecebida(supabase, { mensagemId: id, pessoaId: corpo.pessoa_id });
    } catch (erroRpc) {
      const pg = erroRpc as { code?: string; message?: string };
      const texto = pg.message ?? "";
      if (texto.startsWith("pessoa_invalida")) throw erroNaoEncontrado("Pessoa não encontrada.");
      if (texto.startsWith("mensagem_invalida")) throw erroNaoEncontrado("Mensagem recebida não encontrada.");
      if (texto.startsWith("sem_permissao") || pg.code === "42501") throw erroSemPermissao();
      if (CODIGOS_AUSENTE.has(pg.code ?? "")) {
        throw new ErroApi(503, "recurso_indisponivel", "Mensagens recebidas ainda não estão disponíveis neste ambiente (migration 0054 não aplicada).");
      }
      registrarErro(contexto, erroRpc, { mensagem_id: id, pessoa_id: corpo.pessoa_id });
      throw erroRpc;
    }

    return NextResponse.json({ mensagem });
  } catch (erro) {
    return respostaErro(contexto, erro);
  }
}
