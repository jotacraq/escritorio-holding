export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno } from "@/server/auth";
import { erroConflito, erroNaoEncontrado, erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import { CHAVE_DURACAO_PADRAO_MINUTOS, lerConfiguracaoInt } from "@/server/agenda/config";
import { iniciarSessaoImediata, SQLSTATE_EXCLUSION_VIOLATION } from "@/server/agenda/iniciar-sessao";
import type { AgendamentoSessao, SessaoViabilidade } from "@/types/banco";

const ParametroSchema = z.object({ id: z.string().uuid() });

/**
 * `fim_em` é opcional (15/09/2026, "Iniciar sessão agora"): o fluxo normal de
 * agendar sempre manda os dois, calculados pela tela a partir da duração
 * escolhida (`FormularioAgendamento`). Já a sessão imediata só sabe o
 * `inicio_em` (agora) — quem decide a duração é o SERVIDOR, lendo
 * `agenda.duracao_padrao_minutos` (BLOQUEIO B12, o mesmo caminho de
 * `POST /api/disponibilidades`), nunca uma constante duplicada no navegador.
 *
 * `modo: "imediato"` (17/09/2026, Fatia 1 "iniciar a sessão quando quiser")
 * é o segundo uso deste mesmo endpoint pelo botão "Iniciar sessão agora":
 * ver o comentário sobre idempotência de janela mais abaixo, no POST.
 */
const CorpoSchema = z
  .object({
    inicio_em: z.string().datetime({ offset: true }),
    fim_em: z.string().datetime({ offset: true }).optional(),
    advogada_id: z.string().uuid().optional(),
    observacoes: z.string().trim().max(1000).optional(),
    modo: z.enum(["imediato"]).optional(),
  })
  .refine((v) => !v.fim_em || new Date(v.fim_em) > new Date(v.inicio_em), {
    message: "`fim_em` precisa ser depois de `inicio_em`.",
    path: ["fim_em"],
  });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirInterno();
    const { id: jornadaId } = ParametroSchema.parse(await params);
    const corpo = CorpoSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    const supabase = await criarClienteServidor();

    const { data: jornada, error: erroJornada } = await supabase
      .from("jornadas")
      .select("id")
      .eq("id", jornadaId)
      .maybeSingle();
    if (erroJornada) throw erroJornada;
    if (!jornada) throw erroNaoEncontrado("Jornada não encontrada.");

    /**
     * `modo: "imediato"` (17/09/2026, Fatia 1 "Iniciar sessão agora") desvia
     * para `iniciarSessaoImediata` — mesma rota, segundo uso pelo botão
     * "Iniciar sessão agora" (`IniciarSessaoAgora.tsx`). A idempotência por
     * JANELA (não por advogada) está documentada no módulo compartilhado;
     * `POST /api/jornadas/[id]/sessao/iniciar` chama o MESMO módulo.
     */
    if (corpo.modo === "imediato") {
      const resultado = await iniciarSessaoImediata(supabase, {
        jornadaId,
        advogadaId: corpo.advogada_id,
        observacoes: corpo.observacoes,
      }).catch((erro) => {
        if ((erro as { code?: string })?.code === SQLSTATE_EXCLUSION_VIOLATION) {
          throw erroConflito("horario_indisponivel", "Este horário já está ocupado para a advogada selecionada.");
        }
        registrarErro("api/jornadas/[id]/agendamentos POST imediato", erro, { jornada_id: jornadaId });
        throw erro;
      });

      return NextResponse.json(
        { agendamento: resultado.agendamento, reaproveitado: resultado.reaproveitado },
        { status: resultado.reaproveitado ? 200 : 201 },
      );
    }

    // Sessão de Viabilidade é 1:1 com a jornada — cria na primeira vez que alguém agenda.
    const { data: sessaoExistente, error: erroSessao } = await supabase
      .from("sessoes_viabilidade")
      .select("*")
      .eq("jornada_id", jornadaId)
      .maybeSingle();
    if (erroSessao) throw erroSessao;

    let sessao = sessaoExistente;

    // Mesma leitura de `POST /api/disponibilidades` — `padrao` só cobre chave
    // ausente/falha pontual, nunca mascara um valor real diferente do padrão.
    const fimEm = corpo.fim_em ?? new Date(new Date(corpo.inicio_em).getTime() + (await lerConfiguracaoInt(supabase, CHAVE_DURACAO_PADRAO_MINUTOS, 60)) * 60_000).toISOString();

    if (!sessao) {
      const { data: novaSessao, error: erroCriarSessao } = await supabase
        .from("sessoes_viabilidade")
        .insert({ jornada_id: jornadaId, advogada_id: corpo.advogada_id ?? null })
        .select("*")
        .single();
      if (erroCriarSessao) {
        registrarErro("api/jornadas/[id]/agendamentos POST sessao", erroCriarSessao, { jornada_id: jornadaId });
        throw erroCriarSessao;
      }
      sessao = novaSessao;
    }

    const { data: agendamento, error } = await supabase
      .from("agendamentos")
      .insert({
        sessao_id: (sessao as SessaoViabilidade).id,
        inicio_em: corpo.inicio_em,
        fim_em: fimEm,
        advogada_id: corpo.advogada_id ?? null,
        observacoes: corpo.observacoes ?? null,
        status: "agendado",
        origem: "equipe",
      })
      .select("*")
      .single();

    if (error) {
      if (error.code === SQLSTATE_EXCLUSION_VIOLATION) {
        throw erroConflito(
          "horario_indisponivel",
          "Este horário já está ocupado para a advogada selecionada.",
        );
      }
      registrarErro("api/jornadas/[id]/agendamentos POST", error, { jornada_id: jornadaId });
      throw error;
    }

    return NextResponse.json({ agendamento: agendamento as AgendamentoSessao, reaproveitado: false }, { status: 201 });
  } catch (erro) {
    return respostaErro("api/jornadas/[id]/agendamentos POST", erro);
  }
}
