export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno } from "@/server/auth";
import { erroConflito, erroNaoEncontrado, erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import type { SessaoViabilidade } from "@/types/banco";

const ParametroSchema = z.object({ id: z.string().uuid() });

const SQLSTATE_CHECK_VIOLATION = "23514";
const SQLSTATE_UNDEFINED_COLUMN = "42703";

/**
 * Só URL https absoluta (Zoom, Meet, Teams) — o mesmo mínimo que o webhook do
 * n8n exige (`link_sala https`, 0051 `registrar_link_sala`). `null` limpa o link
 * (a sala foi cancelada); o trigger `app.carimba_link_sala` carimba o instante.
 */
const LinkSalaSchema = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((v) => v.startsWith("https://"), { message: "O link da sala precisa começar com https://." })
  .nullable();

const CorpoSchema = z.object({ link_sala: LinkSalaSchema });

/**
 * PATCH /api/jornadas/[id]/sessao — grava `sessoes_viabilidade.link_sala` colado
 * à mão pela equipe (Fase 4 §1.3, pendência H (1)). Substitui a escrita direta
 * pelo cliente Supabase do navegador (`components/ficha360/api-sessao.ts`).
 *
 * Trava real continua no banco: policy `ses_upd` (0021, `eh_interno`) e os
 * triggers da 0051 — `app.carimba_link_sala` grava `link_sala_origem='manual'`
 * (auth.uid() presente) + `link_sala_atualizado_em`, e `app.timeline_link_sala`
 * registra o evento com o nome de quem colou. A rota NÃO envia `link_sala_origem`
 * de propósito: o carimbo é do trigger, nunca do cliente.
 *
 * 409 `sessao_inexistente` quando a jornada ainda não tem sessão (1:1) — a sala
 * só existe depois do horário confirmado, e a tela não cria sessão por aqui.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirInterno();
    const { id: jornadaId } = ParametroSchema.parse(await params);
    const corpoBruto = await request.json().catch(() => {
      throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
    });
    const corpo = CorpoSchema.parse(corpoBruto);

    const supabase = await criarClienteServidor();

    // Uma consulta só: jornada (404 se não existe / sem acesso) + sessão 1:1 embutida.
    const { data: jornada, error: erroJornada } = await supabase
      .from("jornadas")
      .select("id, sessoes_viabilidade(id, link_sala)")
      .eq("id", jornadaId)
      .maybeSingle<{ id: string; sessoes_viabilidade: Array<{ id: string; link_sala: string | null }> | { id: string; link_sala: string | null } | null }>();
    if (erroJornada) throw erroJornada;
    if (!jornada) throw erroNaoEncontrado("Jornada não encontrada.");
    const sessao = Array.isArray(jornada.sessoes_viabilidade) ? (jornada.sessoes_viabilidade[0] ?? null) : jornada.sessoes_viabilidade;
    if (!sessao) {
      throw erroConflito("sessao_inexistente", "Esta jornada ainda não tem Sessão de Viabilidade — confirme um horário antes de colar o link da sala.");
    }

    // Idempotente: mesmo link → devolve como está, sem disparar carimbo/timeline.
    if (sessao.link_sala === corpo.link_sala) {
      const { data: atual, error } = await supabase.from("sessoes_viabilidade").select("*").eq("id", sessao.id).single();
      if (error) throw error;
      return NextResponse.json({ sessao: atual as SessaoViabilidade, inalterada: true });
    }

    const { data: atualizada, error } = await supabase
      .from("sessoes_viabilidade")
      .update({ link_sala: corpo.link_sala })
      .eq("id", sessao.id)
      .select("*")
      .single();
    if (error) {
      if (error.code === SQLSTATE_UNDEFINED_COLUMN) {
        throw erroConflito("migracao_pendente", "O servidor ainda não conhece a origem do link da sala (migração 0051 pendente).");
      }
      if (error.code === SQLSTATE_CHECK_VIOLATION) {
        throw erroConflito("link_sala_recusado", "O banco recusou o link da sala.");
      }
      registrarErro("api/jornadas/[id]/sessao PATCH", error, { jornada_id: jornadaId, sessao_id: sessao.id });
      throw error;
    }

    return NextResponse.json({ sessao: atualizada as SessaoViabilidade });
  } catch (erro) {
    return respostaErro("api/jornadas/[id]/sessao PATCH", erro);
  }
}
