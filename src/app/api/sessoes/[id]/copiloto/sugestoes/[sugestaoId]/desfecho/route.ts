export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { exigirVePatrimonio } from "@/server/auth";
import { erroConflito, erroNaoEncontrado, erroValidacao, respostaErro } from "@/server/erros";
import { copilotoEstaAtivo } from "@/server/copiloto/config";
import type { RespostaDesfechoCopiloto } from "@/types/copiloto";

const ParametroSchema = z.object({ id: z.string().uuid(), sugestaoId: z.string().uuid() });
const CorpoSchema = z.object({ desfecho: z.enum(["aceita", "ignorada", "expirada"]) });

interface ErroPostgrest {
  code?: string;
  message?: string;
}

/**
 * POST /api/sessoes/[id]/copiloto/sugestoes/[sugestaoId]/desfecho — o botão
 * "Ir para lá" grava `desfecho='aceita'`, "Ignorar" grava `desfecho='ignorada'`
 * (Fase 10, Fatia 2, §5 e §9 do plano: "o registro de que a sugestão foi
 * aceita [...] é o dado que, daqui a 20 sessões, dirá se o copiloto acerta").
 * Item da correção do `fable-orchestrator`: a 0091 já tinha as colunas
 * (`desfecho`/`desfecho_em`) e a tela já tem os dois cliques — nada gravava.
 *
 * **`desfecho` é IMUTÁVEL depois de gravado** — não só por convenção desta
 * rota: a trigger `trg_copiloto_sugestoes_desfecho_imutavel` (0095) recusa no
 * BANCO qualquer tentativa de trocar um `desfecho` já preenchido, mesmo por
 * `service_role` (RLS não filtra service_role). Clicar duas vezes (duplo
 * clique, os dois botões em sequência) devolve 409 `desfecho_ja_registrado`,
 * nunca sobrescreve.
 *
 * `expirada` não é escrita por esta rota nesta fatia (não há ciclo automático
 * ainda — Fatia 3) — o enum já nasce completo para a Fatia 3 não precisar de
 * migration nova só para isso.
 *
 * KILL-SWITCH: `copiloto_sessao.ativo=false` devolve 409 `copiloto_desligado`
 * — mesmo contrato das outras rotas do copiloto.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; sugestaoId: string }> }) {
  try {
    await exigirVePatrimonio();
    const { id: sessaoId, sugestaoId } = ParametroSchema.parse(await params);
    const { desfecho } = CorpoSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    const supabase = await criarClienteServidor();

    if (!(await copilotoEstaAtivo(supabase))) {
      throw erroConflito("copiloto_desligado", "O copiloto está desligado (copiloto_sessao.ativo = false em Admin).");
    }

    // Confere que a sugestão existe E pertence à sessão do path — mesma
    // postura de "id opaco resolve, corpo não decide" das outras rotas do
    // copiloto (nunca aceitar sugestaoId de uma sessão e gravar desfecho
    // numa sugestão de outra, por erro de tela ou tentativa deliberada).
    const { data: sugestaoExistente, error: erroLeitura } = await supabase
      .from("copiloto_sugestoes")
      .select("id, desfecho")
      .eq("id", sugestaoId)
      .eq("sessao_id", sessaoId)
      .maybeSingle<{ id: string; desfecho: string | null }>();
    if (erroLeitura) throw erroLeitura;
    if (!sugestaoExistente) throw erroNaoEncontrado("Sugestão do copiloto não encontrada nesta sessão.");

    if (sugestaoExistente.desfecho !== null) {
      throw erroConflito(
        "desfecho_ja_registrado",
        `Esta sugestão já tem desfecho registrado (${sugestaoExistente.desfecho}) e não pode ser alterada.`,
      );
    }

    const desfechoEm = new Date().toISOString();

    // UPDATE por service_role — mesmo motivo de `copiloto_sugestoes` no
    // INSERT da rota de sugestão: RLS de 0091 não dá gaveta de UPDATE a
    // `authenticated`. A trigger de 0095 é o backstop que torna a
    // imutabilidade real mesmo aqui, não só uma checagem de aplicação acima.
    const admin = criarClienteAdmin();
    const { data: atualizado, error: erroAtualizacao } = await admin
      .from("copiloto_sugestoes")
      .update({ desfecho, desfecho_em: desfechoEm })
      .eq("id", sugestaoId)
      .eq("sessao_id", sessaoId)
      .is("desfecho", null) // corrida: duas requisições quase simultâneas — só a primeira grava
      .select("id, desfecho, desfecho_em")
      .maybeSingle<{ id: string; desfecho: string; desfecho_em: string }>();

    if (erroAtualizacao) {
      const pg = erroAtualizacao as ErroPostgrest;
      if (pg.code === "23514" && pg.message?.includes("desfecho_imutavel")) {
        throw erroConflito("desfecho_ja_registrado", "Esta sugestão já tem desfecho registrado e não pode ser alterada.");
      }
      throw erroAtualizacao;
    }
    if (!atualizado) {
      // `is("desfecho", null)` não casou: outra requisição gravou entre a
      // leitura acima e este UPDATE (corrida). Mesmo código de recusa.
      throw erroConflito("desfecho_ja_registrado", "Esta sugestão já tem desfecho registrado e não pode ser alterada.");
    }

    const resposta: RespostaDesfechoCopiloto = {
      sugestao_id: atualizado.id,
      desfecho: atualizado.desfecho as RespostaDesfechoCopiloto["desfecho"],
      desfecho_em: atualizado.desfecho_em,
    };
    return NextResponse.json(resposta);
  } catch (erro) {
    return respostaErro("POST /api/sessoes/[id]/copiloto/sugestoes/[sugestaoId]/desfecho", erro);
  }
}
