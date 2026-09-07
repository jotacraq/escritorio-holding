export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel, exigirInterno } from "@/server/auth";
import { erroNaoEncontrado, respostaErro } from "@/server/erros";
import { lerConfigAgente } from "@/server/agente-whatsapp/config";
import { lerEstado } from "@/server/agente-whatsapp/porteiro";
import { salvarEstado } from "@/server/agente-whatsapp/estado";
import { inicioDoDiaSp } from "@/server/agente-whatsapp/ia";
import type { AgenteJornada, AgenteResposta } from "@/types/agente";

/**
 * O agente de WhatsApp numa jornada — leitura para a Ficha 360 e as duas ações
 * ("Assumir conversa" / "Devolver ao agente", D25).
 *
 * ## Autorização em duas camadas, e por que o cliente é misto
 *
 * A LEITURA usa o cliente de SESSÃO: a RLS de `agente_whatsapp_estado` e
 * `agente_whatsapp_respostas` (0088) é `select ... using (app.eh_interno())`, e
 * é ela que garante que só a equipe vê. A rota confere o papel antes, como toda
 * rota desta base — as duas travas, sempre.
 *
 * A ESCRITA usa `service_role` de propósito: `authenticated` NÃO tem grant de
 * insert/update nessas tabelas (least privilege — o rascunho do plano previa um
 * `grant update (pausado_ate, pausado_por)`, que deixaria qualquer sessão da
 * equipe pausar o agente de qualquer processo por PostgREST direto, fora desta
 * rota). Quem autoriza é `exigirPapel` aqui; quem escreve é o servidor.
 */

const AcaoSchema = z.object({ acao: z.enum(["assumir", "devolver"]) });

const COLUNAS_RESPOSTA =
  "id, mensagem_recebida_id, jornada_id, conversa_externa_id, intencao, confianca, acao, texto, custo_usd, enviada_em, erro, criado_em";

const AUSENTE = new Set(["42P01", "42883", "42703", "PGRST202", "PGRST204", "PGRST205"]);

interface LinhaEstado {
  passo_ultimo: string | null;
  ultima_intencao: string | null;
  esquivas_seguidas: number;
  humano_respondeu_em: string | null;
  pausado_ate: string | null;
  pausado_por: string | null;
  /** Embed do PostgREST — objeto quando a FK resolve, array em alguns formatos. */
  perfis_equipe?: { nome: string } | { nome: string }[] | null;
}

function nomeDoPerfil(embed: LinhaEstado["perfis_equipe"]): string | null {
  const perfil = Array.isArray(embed) ? embed[0] : embed;
  return perfil?.nome ?? null;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirInterno();
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw erroNaoEncontrado("Processo não encontrado.");

    const supabase = await criarClienteServidor();
    const admin = criarClienteAdmin();
    const agora = Date.now();

    const config = await lerConfigAgente(admin);

    // `perfis_equipe(nome)` é embed pela FK `pausado_por` — uma consulta, não
    // duas: id de perfil na tela não diz nada a ninguém, e quem assumiu a
    // conversa é a informação que faz o "Devolver ao agente" ter dono.
    const estadoConsulta = await supabase
      .from("agente_whatsapp_estado")
      .select(
        "jornada_id, passo_ultimo, ultima_intencao, esquivas_seguidas, humano_respondeu_em, pausado_ate, pausado_por, ultimo_link_em, perfis_equipe(nome)",
      )
      .eq("jornada_id", id)
      .maybeSingle();
    if (estadoConsulta.error && !AUSENTE.has(estadoConsulta.error.code ?? "")) throw estadoConsulta.error;
    const estado = (estadoConsulta.data ?? null) as LinhaEstado | null;

    const respostasConsulta = await supabase
      .from("agente_whatsapp_respostas")
      .select(COLUNAS_RESPOSTA)
      .eq("jornada_id", id)
      .order("criado_em", { ascending: false })
      .limit(20);
    if (respostasConsulta.error && !AUSENTE.has(respostasConsulta.error.code ?? "")) throw respostasConsulta.error;
    const respostas = ((respostasConsulta.data ?? []) as unknown as AgenteResposta[]) ?? [];

    const desde = inicioDoDiaSp(agora);
    const custoHoje = respostas
      .filter((r) => r.criado_em >= desde)
      .reduce((soma, r) => soma + (Number(r.custo_usd) || 0), 0);

    const pausadoAte = estado?.pausado_ate ?? null;
    const pausado = pausadoAte ? Date.parse(pausadoAte) > agora : false;

    const impedimentos: string[] = [];
    if (!config.ativo) impedimentos.push("O agente está desligado em Admin.");
    if (pausado) impedimentos.push("A conversa foi assumida pela equipe.");
    if (estado?.humano_respondeu_em && agora - Date.parse(estado.humano_respondeu_em) < config.silencioHumanoMinutos * 60_000) {
      impedimentos.push(`Um humano respondeu há menos de ${config.silencioHumanoMinutos} minutos.`);
    }

    const corpo: AgenteJornada = {
      jornada_id: id,
      agente_ativo: config.ativo,
      passo_ultimo: estado?.passo_ultimo ?? null,
      ultima_intencao: (estado?.ultima_intencao as AgenteJornada["ultima_intencao"]) ?? null,
      esquivas_seguidas: estado?.esquivas_seguidas ?? 0,
      humano_respondeu_em: estado?.humano_respondeu_em ?? null,
      pausado_ate: pausadoAte,
      pausado_por: estado?.pausado_por ?? null,
      pausado_por_nome: nomeDoPerfil(estado?.perfis_equipe),
      pausado,
      custo_usd_hoje: Number(custoHoje.toFixed(6)),
      ultimas_respostas: respostas,
      impedimentos,
    };
    return NextResponse.json(corpo);
  } catch (erro) {
    return respostaErro("api/jornadas/[id]/agente-whatsapp GET", erro);
  }
}

/**
 * POST — "Assumir conversa" (`assumir`) e "Devolver ao agente" (`devolver`).
 *
 * D25: pausa NUNCA é destrutiva. `assumir` grava `pausado_ate = agora +
 * silencio_humano_minutos`; `devolver` limpa os dois campos. Nada é apagado, e
 * a ação é reversível pelo mesmo botão.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const usuario = await exigirPapel("admin", "advogada", "relacionamento");
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw erroNaoEncontrado("Processo não encontrado.");

    const { acao } = AcaoSchema.parse(await request.json().catch(() => ({})));

    const supabase = await criarClienteServidor();
    // A jornada tem de existir E ser visível para quem pede: sem esta leitura
    // pela SESSÃO, a rota escreveria com service_role numa jornada que a RLS
    // esconde de quem chamou.
    const { data: jornada, error } = await supabase.from("jornadas").select("id").eq("id", id).maybeSingle<{ id: string }>();
    if (error) throw error;
    if (!jornada) throw erroNaoEncontrado("Processo não encontrado.");

    const admin = criarClienteAdmin();
    const config = await lerConfigAgente(admin);
    const agora = Date.now();
    const estado = await lerEstado(admin, id);

    if (acao === "assumir") {
      const ate = new Date(agora + config.silencioHumanoMinutos * 60_000).toISOString();
      await salvarEstado(admin, id, estado, { pausadoAte: ate, pausadoPor: usuario.id }, agora);
      return NextResponse.json({ pausado: true, pausado_ate: ate });
    }

    await salvarEstado(admin, id, estado, { pausadoAte: null, pausadoPor: null }, agora);
    return NextResponse.json({ pausado: false, pausado_ate: null });
  } catch (erro) {
    return respostaErro("api/jornadas/[id]/agente-whatsapp POST", erro);
  }
}
