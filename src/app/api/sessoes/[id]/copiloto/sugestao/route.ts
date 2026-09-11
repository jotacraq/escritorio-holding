export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { exigirVePatrimonio } from "@/server/auth";
import { ErroApi, erroConflito, erroNaoEncontrado, respostaErro } from "@/server/erros";
import { copilotoEstaAtivo } from "@/server/copiloto/config";
import { montarContextoCopiloto } from "@/server/copiloto/contexto";
import { conferirOrcamentoCopiloto } from "@/server/copiloto/orcamento";
import { conferirGateCopiloto } from "@/server/copiloto/gate";
import { executarIaCopiloto } from "@/server/copiloto/executar-ia";
import { sugestaoEVisivel, validarSugestaoCopiloto } from "@/server/copiloto/validar";
import { lerConfiguracaoJson } from "@/server/ia/configuracao";
import type { RespostaSugestaoCopiloto } from "@/types/copiloto";

const ParametroSchema = z.object({ id: z.string().uuid() });

// `bloco` é opcional pelo mesmo motivo de `GET /api/sessoes/[id]/copiloto`
// (Fatia 1): o servidor não sabe "onde a advogada está agora", só a tela sabe.
const CorpoSchema = z.object({
  bloco: z.coerce.number().int().min(0).optional().default(0),
});

const CHAVE_CONFIANCA_MINIMA = "copiloto_sessao.confianca_minima";
const PADRAO_CONFIANCA_MINIMA = 0.6;

interface SessaoParaOrcamento {
  jornada_id: string;
  criado_em: string;
  sessoes_copiloto: { iniciado_em: string | null; criado_em: string } | null;
  // Embed para o GATE jurídico (achado do Fable): a pessoa titular do
  // consentimento é resolvida AQUI, na mesma query que já busca a sessão —
  // não numa 2ª ida ao banco separada.
  jornadas: { pessoa_id: string } | null;
}

interface ErroPostgrest {
  code?: string;
  message?: string;
}

const MENSAGEM_GATE: Record<string, string> = {
  sem_decisao_juridica: "Sem decisão jurídica ativa para o copiloto ao vivo (escopo sessao.copiloto_ao_vivo).",
  sem_consentimento_titular: "O titular ainda não consentiu com o copiloto ao vivo (copiloto_sessao_ao_vivo).",
  falha_ao_conferir_gate: "Não foi possível conferir a autorização do copiloto ao vivo.",
};

/**
 * POST /api/sessoes/[id]/copiloto/sugestao — a sugestão por IA SOB DEMANDA
 * (botão "Me ajuda agora", Fase 10 Fatia 2, docs/ARQUITETURA-FASE-10.md §4.3,
 * §8, §12). NÃO implementa o ciclo automático nem o polling — isso é Fatia 3.
 * Ignora o intervalo de 45s (gatilho `sob_demanda`, §4.3), mas NÃO ignora o
 * teto (§4.4) nem o timeout (8s, C3).
 *
 * ORDEM DAS TRAVAS, cada uma com código estável de recusa (nunca 500 para o
 * caso esperado) — CORRIGIDA após achado do `fable-orchestrator`: o gate
 * jurídico (decisão + consentimento) agora roda ANTES de montar contexto e
 * ANTES de chamar o provedor de IA. Na versão anterior, a checagem só
 * acontecia no INSERT em `copiloto_sugestoes` (trigger de 0093) — DEPOIS que
 * a janela de transcrição (a fala literal do cliente) já tinha sido enviada
 * por HTTP à Anthropic via `executarIaCopiloto`. O ENVIO ao provedor é o
 * caminho de saída de dado real (§7 do plano); o INSERT é onde o dado fica
 * persistido, não onde ele sai do escritório — são duas coisas diferentes, e
 * confundi-las foi o erro original deste desenho.
 *
 *  1. `exigirVePatrimonio()` — mesmo papel de quem lê transcrição/patrimônio.
 *  2. `copiloto_sessao.ativo=false` → 409 `copiloto_desligado` (kill-switch
 *     da Fatia 1, checado aqui também).
 *  3. Sessão inexistente → 404.
 *  4. **Gate jurídico** (`conferirGateCopiloto` — decisão ativa em
 *     `decisoes_juridicas` E consentimento do titular) → 409
 *     `copiloto_ao_vivo_bloqueado` **SEM montar contexto, SEM chamar IA,
 *     ZERO token gasto**. Esta é a trava PRIMÁRIA agora.
 *  5. Orçamento (`teto_ia_sessao`/`teto_ia_dia`) estourado → 409
 *     `teto_ia_copiloto_atingido`.
 *  6. Timeout de 8s → 504 `timeout_copiloto`. Prompt inativo/recusa/saída
 *     inválida → 409 `copiloto_ia_nao_ativada` / 502 `recusa_ia` /
 *     `saida_invalida`.
 *  7. INSERT em `copiloto_sugestoes` — a trigger de 0093 CONTINUA ativa e
 *     confere as MESMAS duas condições de novo. Ela não é mais a única
 *     trava: é o BACKSTOP no banco, para o caso de um caminho futuro chegar
 *     ao INSERT sem passar pelo gate 4 (agente novo, rota nova, RPC direta).
 *     Em uso normal desta rota, nunca deveria disparar — se disparar, é
 *     sinal de bug no gate 4, não comportamento esperado.
 *
 * Termo proibido na SAÍDA (validador pós-Zod) recusa a sugestão INTEIRA sem
 * gravar nada em `copiloto_sugestoes` — nunca chega a bater na trigger.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirVePatrimonio();
    const { id: sessaoId } = ParametroSchema.parse(await params);
    const { bloco } = CorpoSchema.parse(await request.json().catch(() => ({})));

    const supabase = await criarClienteServidor();

    if (!(await copilotoEstaAtivo(supabase))) {
      throw erroConflito("copiloto_desligado", "O copiloto está desligado (copiloto_sessao.ativo = false em Admin).");
    }

    const { data: sessao, error: erroSessao } = await supabase
      .from("sessoes_viabilidade")
      .select("jornada_id, criado_em, sessoes_copiloto(iniciado_em, criado_em), jornadas(pessoa_id)")
      .eq("id", sessaoId)
      .maybeSingle<SessaoParaOrcamento>();
    if (erroSessao) throw erroSessao;
    if (!sessao) throw erroNaoEncontrado("Sessão de Viabilidade não encontrada.");

    const pessoaId = sessao.jornadas?.pessoa_id;
    if (!pessoaId) throw erroNaoEncontrado("Sessão de Viabilidade sem jornada/pessoa vinculada.");

    const inicioSessaoIso = sessao.sessoes_copiloto?.iniciado_em ?? sessao.sessoes_copiloto?.criado_em ?? sessao.criado_em;

    const admin = criarClienteAdmin();

    // GATE JURÍDICO — ANTES de montar contexto, ANTES de chamar IA (achado do
    // Fable). Falta decisão ou consentimento: recusa aqui, sem gastar token.
    const gate = await conferirGateCopiloto(admin, { sessaoId, pessoaId });
    if (!gate.liberado) {
      throw erroConflito("copiloto_ao_vivo_bloqueado", MENSAGEM_GATE[gate.motivo ?? "falha_ao_conferir_gate"]);
    }

    const orcamento = await conferirOrcamentoCopiloto(admin, { jornadaId: sessao.jornada_id, inicioSessaoIso });
    if (!orcamento.dentro) {
      if (orcamento.motivo === "prompt_do_copiloto_inexistente") {
        throw erroConflito("copiloto_ia_nao_ativada", "O copiloto de IA não está ativado.");
      }
      throw erroConflito(
        "teto_ia_copiloto_atingido",
        `Teto de execuções de IA do copiloto atingido (${orcamento.motivo}). O copiloto segue em modo só-transcrição.`,
      );
    }

    const contexto = await montarContextoCopiloto(supabase, sessaoId, bloco);

    const execucao = await executarIaCopiloto(admin, { jornadaId: sessao.jornada_id, contexto });

    if (execucao.situacao === "timeout") {
      // Nunca sugestão velha disfarçada de nova (§4.3): 504, nada é gravado
      // aqui — a chamada tardia, se concluir, só atualiza `execucoes_ia`.
      throw new ErroApi(504, "timeout_copiloto", "A IA não respondeu em 8 segundos. Tente novamente.");
    }
    if (execucao.situacao === "indisponivel") {
      if (execucao.motivo.includes("prompt_ativo_nao_encontrado")) {
        throw erroConflito("copiloto_ia_nao_ativada", "O copiloto de IA não está ativado.");
      }
      if (execucao.motivo.includes("recusa_ia")) {
        throw new ErroApi(502, "recusa_ia", "A IA recusou processar esta sessão.");
      }
      throw new ErroApi(502, "saida_invalida", "A saída da IA não pôde ser validada.");
    }

    const validado = validarSugestaoCopiloto(execucao.saida, contexto);
    if (!validado.sugestao) {
      // Termo proibido na saída (B61) — nada é gravado, nada é exposto.
      throw new ErroApi(502, "conteudo_proibido", "A resposta da IA continha conteúdo não permitido e foi descartada.");
    }

    const confiancaMinima = await lerConfiguracaoJson<number>(supabase, CHAVE_CONFIANCA_MINIMA, PADRAO_CONFIANCA_MINIMA);
    const visivel = sugestaoEVisivel(validado.sugestao.confianca_geral, confiancaMinima);

    // INSERT por service_role — RLS de 0091 não dá gaveta de escrita a
    // `authenticated` em `copiloto_sugestoes` (comentário da migration: "a
    // fatia 2 grava por RPC/rota com service_role, nunca INSERT direto da
    // tela"). A trigger de 0093 confere decisão jurídica + consentimento de
    // novo aqui — BACKSTOP, não a trava primária (ver comentário de topo).
    const { data: gravado, error: erroInsercao } = await admin
      .from("copiloto_sugestoes")
      .insert({
        sessao_id: sessaoId,
        bloco_id: validado.sugestao.desvio_sugerido?.bloco_id ?? contexto.bloco_atual?.id ?? null,
        gatilho: "sob_demanda",
        conteudo: validado.sugestao,
        confianca: validado.sugestao.confianca_geral,
        execucao_ia_id: execucao.execucaoId,
      })
      .select("id")
      .single<{ id: string }>();

    if (erroInsercao) {
      const pg = erroInsercao as ErroPostgrest;
      if (pg.code === "23514" && pg.message?.includes("copiloto_ao_vivo_bloqueado")) {
        // Não deveria acontecer em uso normal (o gate acima já teria
        // recusado antes) — se acontecer, é o backstop pegando um caminho
        // que pulou o gate. Mesmo código de recusa, para o cliente não notar
        // diferença.
        throw erroConflito(
          "copiloto_ao_vivo_bloqueado",
          "Sem decisão jurídica ativa ou sem consentimento do titular para o copiloto ao vivo.",
        );
      }
      throw erroInsercao;
    }

    const resposta: RespostaSugestaoCopiloto = {
      sugestao_id: gravado.id,
      gatilho: "sob_demanda",
      confianca_geral: validado.sugestao.confianca_geral,
      visivel,
      sugestao: visivel ? validado.sugestao : null,
    };
    return NextResponse.json(resposta, { status: 201 });
  } catch (erro) {
    return respostaErro("POST /api/sessoes/[id]/copiloto/sugestao", erro);
  }
}
