export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno } from "@/server/auth";
import { registrarErro, respostaErro } from "@/server/erros";
import type { MensagemRecebida } from "@/types/integracoes";
import type { AgenteNaRecebida, IntencaoAgente } from "@/types/agente";

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
  /**
   * O que o agente de WhatsApp fez com ESTA mensagem (0088), casado por
   * `mensagem_recebida_id` — não por `conversa_externa_id` + relógio, que erra
   * quando duas mensagens chegam no mesmo minuto. `null` = o agente não
   * respondeu (desligado, ou alguma trava do porteiro barrou).
   */
  agente: AgenteNaRecebida | null;
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
interface LinhaRespostaAgente {
  mensagem_recebida_id: string;
  intencao: string | null;
  confianca: number | null;
  enviada_em: string | null;
  custo_usd: number | null;
  texto: string | null;
  execucoes_ia?: { prompts_versoes?: { versao: number } | { versao: number }[] | null } | Array<{ prompts_versoes?: { versao: number } | { versao: number }[] | null }> | null;
}

const COLUNAS_AGENTE = "mensagem_recebida_id, intencao, confianca, enviada_em, custo_usd, texto";

function versaoDoPrompt(embed: LinhaRespostaAgente["execucoes_ia"]): number | null {
  const execucao = Array.isArray(embed) ? embed[0] : embed;
  const prompt = Array.isArray(execucao?.prompts_versoes) ? execucao?.prompts_versoes[0] : execucao?.prompts_versoes;
  return prompt?.versao ?? null;
}

/**
 * UMA consulta para a página inteira (`in (...)` sobre o unique
 * `mensagem_recebida_id`) — nunca uma por linha. Sem os ids, nem consulta.
 *
 * A versão do prompt vem por embed em dois níveis
 * (`agente_whatsapp_respostas → execucoes_ia → prompts_versoes`). A RLS de
 * `execucoes_ia` é `ve_patrimonio` (0009): para assistente e relacionamento o
 * embed volta vazio e `prompt_versao` fica `null` — "sem informação", que é a
 * verdade para aquele papel, e não um número inventado.
 *
 * Se o embed falhar (0088 ausente, relação não resolvida no cache do
 * PostgREST), relê SEM ele: o selo "respondido pelo agente" é mais importante
 * que a versão do prompt, e a fila não pode virar 500 por causa de um adorno.
 */
async function lerRespostasDoAgente(
  supabase: Awaited<ReturnType<typeof criarClienteServidor>>,
  ids: string[],
): Promise<Map<string, AgenteNaRecebida>> {
  const mapa = new Map<string, AgenteNaRecebida>();
  if (ids.length === 0) return mapa;

  const montar = (linhas: LinhaRespostaAgente[], comVersao: boolean) => {
    for (const l of linhas) {
      mapa.set(l.mensagem_recebida_id, {
        intencao: (l.intencao as IntencaoAgente | null) ?? null,
        confianca: l.confianca === null ? null : Number(l.confianca),
        enviada_em: l.enviada_em,
        custo_usd: l.custo_usd === null ? null : Number(l.custo_usd),
        prompt_versao: comVersao ? versaoDoPrompt(l.execucoes_ia) : null,
        texto: l.texto,
      });
    }
  };

  const comEmbed = await supabase
    .from("agente_whatsapp_respostas")
    .select(`${COLUNAS_AGENTE}, execucoes_ia(prompts_versoes(versao))`)
    .in("mensagem_recebida_id", ids);
  if (!comEmbed.error) {
    montar((comEmbed.data as unknown as LinhaRespostaAgente[]) ?? [], true);
    return mapa;
  }

  const codigo = (comEmbed.error as { code?: string }).code ?? "";
  if (CODIGOS_TABELA_AUSENTE.has(codigo)) return mapa;

  const semEmbed = await supabase.from("agente_whatsapp_respostas").select(COLUNAS_AGENTE).in("mensagem_recebida_id", ids);
  if (semEmbed.error) {
    if (!CODIGOS_TABELA_AUSENTE.has((semEmbed.error as { code?: string }).code ?? "")) {
      registrarErro("api/mensagens/recebidas GET#agente", semEmbed.error);
    }
    return mapa;
  }
  montar((semEmbed.data as unknown as LinhaRespostaAgente[]) ?? [], false);
  return mapa;
}

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
    const porMensagem = await lerRespostasDoAgente(
      supabase,
      linhas.map((l) => l.id),
    );
    const itens: MensagemRecebidaItem[] = linhas.map(({ pessoas, ...linha }) => {
      const pessoa = Array.isArray(pessoas) ? pessoas[0] : pessoas;
      return { ...linha, pessoa_nome: pessoa?.nome ?? null, agente: porMensagem.get(linha.id) ?? null };
    });

    const resposta: RespostaMensagensRecebidas = { disponivel: true, itens };
    return NextResponse.json(resposta);
  } catch (erro) {
    return respostaErro("api/mensagens/recebidas GET", erro);
  }
}
