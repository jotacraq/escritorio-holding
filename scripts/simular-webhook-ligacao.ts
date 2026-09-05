/**
 * scripts/simular-webhook-ligacao.ts — prova o webhook da ligação por IA
 * (`POST /api/webhooks/n8n/ligacao`) contra um servidor de verdade.
 *
 * Cenários (ARQUITETURA-FASE-4.md §9, linha do agente B):
 *   valida   → assinatura válida + horário entre os ofertados → 200, ligação `concluida`/`agendou`
 *              com `agendamento_id`; `webhooks_eventos(origem='n8n_ligacao')` processado.
 *   invalida → assinatura errada → 401 e linha `assinatura_valida=false`.
 *   fora     → assinatura válida + horário FORA dos 4 → 422 `horario_indisponivel`;
 *              ligação `falhou` e mensagem `agendamento_link` na fila.
 *   reentrega→ repete o `id_evento` do cenário `valida` → 200 `reentrega:true`.
 *   sem-secret (servidor sem LIGACAO_IA_WEBHOOK_SECRET) → 503 em qualquer cenário.
 *
 * MODO DE USO (depois de aplicar 0051, 0053 e 0054 e com uma ligação `discando`
 * ou `na_fila` com `link_id` + `agendamentos_sugestoes` — o botão "Ligar por IA"
 * ou `processarFilaLigacoesIa` criam isso):
 *   npx tsx scripts/simular-webhook-ligacao.ts --cenario=valida   --ligacao=<uuid> [--horario=<iso>]
 *   npx tsx scripts/simular-webhook-ligacao.ts --cenario=invalida --ligacao=<uuid>
 *   npx tsx scripts/simular-webhook-ligacao.ts --cenario=fora     --ligacao=<uuid>
 *   npx tsx scripts/simular-webhook-ligacao.ts --cenario=reentrega --ligacao=<uuid> --id-evento=<id usado antes>
 *   npx tsx scripts/simular-webhook-ligacao.ts --cenario=sem-secret
 *
 * Lê `.env.local` (sem dependência nova): LIGACAO_IA_WEBHOOK_SECRET (obrigatório
 * para assinar), BASE_URL (default http://localhost:3000), e — se houver
 * SUPABASE_SERVICE_ROLE_KEY — consulta `ligacoes_ia`, `webhooks_eventos` e
 * `mensagens_agendadas` depois da chamada para mostrar o efeito real.
 * Sem `--horario`, o cenário `valida` usa a posição 1 de `agendamentos_sugestoes`
 * do link da ligação (exige service_role). Nunca imprime segredo.
 *
 * Sem banco local: rode contra o `next dev` do orquestrador (porta 3000) com o
 * banco remoto — é o único ambiente em que o resultado significa algo.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function carregarEnvLocal(): void {
  const arquivo = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(arquivo)) return;
  for (const linha of fs.readFileSync(arquivo, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linha);
    if (!m) continue;
    const [, nome, bruto] = m;
    if (process.env[nome] !== undefined) continue;
    process.env[nome] = bruto.replace(/^["']|["']$/g, "");
  }
}

function argumento(nome: string): string | undefined {
  const prefixo = `--${nome}=`;
  return process.argv.find((a) => a.startsWith(prefixo))?.slice(prefixo.length);
}

function assinar(segredo: string, timestamp: string, corpo: string): string {
  return `sha256=${crypto.createHmac("sha256", segredo).update(`${timestamp}.${corpo}`, "utf8").digest("hex")}`;
}

async function horarioDaPosicao1(admin: SupabaseClient, ligacaoId: string): Promise<string | null> {
  const { data: lig } = await admin.from("ligacoes_ia").select("link_id").eq("id", ligacaoId).maybeSingle<{ link_id: string | null }>();
  if (!lig?.link_id) return null;
  const { data } = await admin
    .from("agendamentos_sugestoes")
    .select("inicio_em")
    .eq("link_id", lig.link_id)
    .order("posicao", { ascending: true })
    .limit(1)
    .maybeSingle<{ inicio_em: string }>();
  return data?.inicio_em ?? null;
}

async function mostrarEfeito(admin: SupabaseClient, ligacaoId: string | null, idEvento: string): Promise<void> {
  const { data: ev } = await admin
    .from("webhooks_eventos")
    .select("assinatura_valida, processado_em, erro, recebido_em")
    .eq("origem", "n8n_ligacao")
    .eq("evento_externo_id", idEvento)
    .maybeSingle();
  console.log("webhooks_eventos:", ev ?? "(sem linha com este id_evento)");

  if (ligacaoId) {
    const { data: lig } = await admin
      .from("ligacoes_ia")
      .select("status, resultado, horario_escolhido, agendamento_id, erro, custo_usd, duracao_segundos, tentativa")
      .eq("id", ligacaoId)
      .maybeSingle();
    console.log("ligacoes_ia:", lig ?? "(não encontrada)");
    const { data: msgs } = await admin
      .from("mensagens_agendadas")
      .select("canal, status, agendada_para")
      .like("chave_idempotencia", `%:agendamento_link:${ligacaoId}%`);
    console.log("mensagens agendamento_link na fila:", msgs?.length ?? 0);
  }
}

async function principal(): Promise<void> {
  carregarEnvLocal();
  if (process.argv.includes("--ajuda") || process.argv.includes("--help")) {
    console.log(fs.readFileSync(__filename, "utf8").split("*/")[0]);
    return;
  }

  const cenario = argumento("cenario") ?? "valida";
  const ligacaoId = argumento("ligacao") ?? null;
  const baseUrl = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const segredo = process.env.LIGACAO_IA_WEBHOOK_SECRET?.trim() ?? "";
  const url = `${baseUrl}/api/webhooks/n8n/ligacao`;

  let admin: SupabaseClient | null = null;
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  if (cenario !== "sem-secret" && !ligacaoId) {
    console.error("Falta --ligacao=<uuid>.");
    process.exit(2);
  }

  let horario = argumento("horario") ?? null;
  if (cenario === "valida" && !horario) {
    if (!admin) {
      console.error("Cenário 'valida' sem --horario exige SUPABASE_SERVICE_ROLE_KEY para ler agendamentos_sugestoes.");
      process.exit(2);
    }
    horario = await horarioDaPosicao1(admin, ligacaoId!);
    if (!horario) {
      console.error("A ligação não tem link com sugestões — dispare a fila primeiro (botão 'Ligar por IA' ou cron).");
      process.exit(2);
    }
  }
  if (cenario === "fora") {
    // Um horário que nunca estará entre os ofertados: 3h da manhã daqui a 400 dias.
    const d = new Date(Date.now() + 400 * 86_400_000);
    d.setUTCHours(6, 0, 0, 0);
    horario = d.toISOString();
  }

  const idEvento = argumento("id-evento") ?? `simulacao:${cenario}:${crypto.randomUUID()}`;
  const corpoObj = {
    id_evento: idEvento,
    ligacao_id: ligacaoId ?? "00000000-0000-0000-0000-000000000000",
    evento: "concluida",
    id_externo: `sim_${Date.now()}`,
    horario_escolhido: horario,
    transcricao: "[simulação] AI: Olá. USER: Pode ser esse horário.",
    resumo: `[simulação] cenário ${cenario}`,
    custo_usd: 0.0123,
    duracao_s: 61,
  };
  const corpo = JSON.stringify(corpoObj);
  const timestamp = String(Math.floor(Date.now() / 1000));

  const headers: Record<string, string> = { "content-type": "application/json", "x-sichf-timestamp": timestamp };
  if (cenario === "invalida") {
    headers["x-sichf-assinatura"] = assinar("segredo-errado", timestamp, corpo);
  } else if (cenario !== "sem-secret") {
    if (!segredo) {
      console.error("LIGACAO_IA_WEBHOOK_SECRET ausente no .env.local — não dá para assinar.");
      process.exit(2);
    }
    headers["x-sichf-assinatura"] = assinar(segredo, timestamp, corpo);
  }

  console.log(`→ POST ${url}  cenário=${cenario}  id_evento=${idEvento}`);
  const resposta = await fetch(url, { method: "POST", headers, body: corpo });
  const texto = await resposta.text();
  console.log(`← HTTP ${resposta.status}`);
  console.log(texto.slice(0, 1500));

  const esperado: Record<string, number> = { valida: 200, invalida: 401, fora: 422, reentrega: 200, "sem-secret": 503 };
  const ok = resposta.status === esperado[cenario];
  console.log(ok ? `OK — status esperado (${esperado[cenario]}).` : `DIVERGÊNCIA — esperado ${esperado[cenario]}, veio ${resposta.status}.`);

  if (admin && cenario !== "sem-secret") {
    await mostrarEfeito(admin, ligacaoId, idEvento);
  } else if (!admin) {
    console.log("(sem SUPABASE_SERVICE_ROLE_KEY: efeito no banco não consultado)");
  }
  process.exit(ok ? 0 : 1);
}

principal().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
