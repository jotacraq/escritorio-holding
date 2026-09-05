import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { processarFilaRegua, type ResultadoProcessamento } from "@/server/regua/processar";
import { etapaLigacoesIa, etapaReaperLigacoesIa, type ResultadoEtapaExterna } from "@/server/regua/externas";
import { sincronizarSalas, type ResultadoSincronizarSalas } from "@/server/sala/sincronizar";
import { registrarErro } from "@/server/erros";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Comparação em tempo constante — mesmo padrão do webhook Hotmart. */
function segredosIguais(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

type Etapa<T> = (T & { erro?: undefined }) | { erro: string };

export interface RespostaCron {
  regua: Etapa<ResultadoProcessamento>;
  ligacoes: Etapa<ResultadoEtapaExterna>;
  reaper: Etapa<ResultadoEtapaExterna>;
  salas: Etapa<ResultadoSincronizarSalas>;
  ultimo_cron_em: string;
}

async function rodarEtapa<T>(nome: string, fn: () => Promise<T>): Promise<Etapa<T>> {
  try {
    return (await fn()) as Etapa<T>;
  } catch (erro) {
    registrarErro(`POST /api/cron/regua#${nome}`, erro);
    return { erro: erro instanceof Error ? erro.message : String(erro) };
  }
}

/**
 * POST /api/cron/regua — disparado pelo cron do painel Hostinger (a cada 5 min),
 * nunca por pg_cron (ARQUITETURA.md §5.1). Fail-CLOSED: sem CRON_SECRET
 * configurado, 503 — nunca processa a fila sem segredo definido.
 *
 * Uma rota de cron só (§1.6). A mesma passagem roda, nesta ordem:
 *   1) régua de mensagens (e-mail; WhatsApp só com Chatwoot configurado);
 *   2) fila de ligações por IA (agente B — pulada com `modulo_ausente` até existir);
 *   3) reaper das ligações presas (idem);
 *   4) salas via n8n (só se `sala.provedor='n8n'` e env vars presentes).
 * Cada etapa é isolada: falha em uma não derruba as outras; o retorno lista as
 * quatro. Prova de vida: grava `configuracoes['regua.ultimo_cron_em']`
 * (UPDATE, nunca linha nova) — a tela de Comunicação e a pendência
 * `cron_parado` (0052) leem daí.
 */
export async function POST(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) {
    registrarErro("POST /api/cron/regua", new Error("CRON_SECRET ausente"));
    return NextResponse.json({ erro: "servico_indisponivel" }, { status: 503 });
  }

  const header = request.headers.get("x-cron-secret");
  if (!header || !segredosIguais(header, segredo)) {
    return NextResponse.json({ erro: "nao_autorizado" }, { status: 401 });
  }

  let supabaseAdmin;
  try {
    supabaseAdmin = criarClienteAdmin();
  } catch (erro) {
    registrarErro("POST /api/cron/regua#service_role", erro);
    return NextResponse.json({ erro: "servico_indisponivel" }, { status: 503 });
  }

  const regua = await rodarEtapa("regua", () => processarFilaRegua(supabaseAdmin));
  const ligacoes = await rodarEtapa("ligacoes", () => etapaLigacoesIa(supabaseAdmin));
  const reaper = await rodarEtapa("reaper", () => etapaReaperLigacoesIa(supabaseAdmin));
  const salas = await rodarEtapa("salas", () => sincronizarSalas(supabaseAdmin));

  const ultimoCronEm = new Date().toISOString();
  const { error: erroProvaDeVida } = await supabaseAdmin
    .from("configuracoes")
    .update({ valor: ultimoCronEm })
    .eq("chave", "regua.ultimo_cron_em");
  if (erroProvaDeVida) {
    // Não derruba a passagem (as etapas já rodaram); fica visível no log.
    registrarErro("POST /api/cron/regua#prova_de_vida", erroProvaDeVida);
  }

  const resposta: RespostaCron = { regua, ligacoes, reaper, salas, ultimo_cron_em: ultimoCronEm };
  return NextResponse.json(resposta, { status: 200 });
}
