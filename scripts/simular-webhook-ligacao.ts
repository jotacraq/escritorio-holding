/**
 * scripts/simular-webhook-ligacao.ts — prova o webhook da ligação por IA
 * (`POST /api/webhooks/n8n/ligacao`) contra um servidor de verdade.
 *
 * Cenários (ARQUITETURA-FASE-4.md §9, agente B; ampliados na Fase 7 pelo LIG):
 *   valida      → assinatura válida + horário entre os ofertados → 200, ligação `concluida`/`agendou`
 *                 com `agendamento_id`; `webhooks_eventos(origem='n8n_ligacao')` processado.
 *   invalida    → assinatura errada → 401 e linha `assinatura_valida=false`.
 *   fora        → assinatura válida + horário FORA dos 4 → 422 `horario_indisponivel`;
 *                 ligação `falhou` e mensagem `agendamento_link` na fila.
 *   reentrega   → repete o `id_evento` do cenário `valida` → 200 `reentrega:true`.
 *   sem-secret  → servidor sem LIGACAO_IA_WEBHOOK_SECRET → 503.
 *   ---- Fase 7: o corpo passa pelo MAPEAMENTO REAL do nó do n8n
 *        (`n8n/ligacao/mapear-vapi.js`), com fixture de payload da Vapi ----
 *   vapi-agendou     → end-of-call-report com `opcao_escolhida: 1` → 200, ligação agenda.
 *   vapi-recusou     → `resultado: recusou` → 200, `concluida`/`recusou` + fallback por link.
 *   vapi-sem-resposta→ `endedReason: customer-did-not-answer` → 200, `sem_resposta` + retentativa.
 *   vapi-caixa-postal→ `endedReason: voicemail` → 200, `sem_resposta`/`caixa_postal`.
 *   vapi-falhou      → `endedReason: assistant-error` → 200, `falhou`.
 *   vapi-gigante     → transcrição de 300 000 caracteres e resumo de 9 000: prova que a
 *                      truncagem do mapeamento evita o 422 que perderia o evento inteiro.
 *   vapi-callback-forjado → a PoC do achado A1 do pentest: a "mensagem da Vapi" traz
 *                      `metadata.callback_url = http://169.254.169.254/...`. O script
 *                      ABORTA com código 1 se o mapeamento devolver esse destino; o
 *                      destino tem de ser sempre o configurado. → 200.
 *   ---- Fase 7: ataques contra o webhook (nenhum precisa de --ligacao) ----
 *   sem-assinatura   → sem o header `x-sichf-assinatura` → 401.
 *   timestamp-velho  → assinatura correta, timestamp de 1 h atrás → 401 (janela de 5 min).
 *   corpo-adulterado → assina um corpo e manda outro → 401.
 *
 * MODO DE USO (depois de aplicar 0051, 0053 e 0054 e com uma ligação `discando`
 * ou `na_fila` com `link_id` + `agendamentos_sugestoes` — o botão "Ligar por IA"
 * ou `processarFilaLigacoesIa` criam isso):
 *   npx tsx scripts/simular-webhook-ligacao.ts --cenario=valida   --ligacao=<uuid> [--horario=<iso>]
 *   npx tsx scripts/simular-webhook-ligacao.ts --cenario=invalida --ligacao=<uuid>
 *   npx tsx scripts/simular-webhook-ligacao.ts --cenario=fora     --ligacao=<uuid>
 *   npx tsx scripts/simular-webhook-ligacao.ts --cenario=reentrega --ligacao=<uuid> --id-evento=<id usado antes>
 *   npx tsx scripts/simular-webhook-ligacao.ts --cenario=vapi-agendou --ligacao=<uuid>
 *   npx tsx scripts/simular-webhook-ligacao.ts --cenario=sem-assinatura
 *   # prova de contrato sem tocar em dado de cliente (ligação inexistente):
 *   npx tsx scripts/simular-webhook-ligacao.ts --cenario=vapi-recusou  *     --ligacao=00000000-0000-4000-8000-000000000000 --espera-status=404
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
import { createRequire } from "node:module";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** O MESMO código que roda no nó do n8n — não uma reimplementação. */
const { mapear } = createRequire(__filename)("../n8n/ligacao/mapear-vapi.js") as {
  mapear: (m: unknown, callbackUrl: string) => { payload: Record<string, unknown>; callback_url: string } | null;
};

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

/**
 * Constrói o corpo passando pelo MAPEAMENTO REAL do nó do n8n
 * (`n8n/ligacao/mapear-vapi.js`) a partir de um `message` da Vapi. É o que
 * torna estes cenários uma prova de ponta a ponta: se o mapeamento quebrar o
 * contrato do Zod da rota, aqui aparece como 422, não em produção.
 */
function corpoDoMapeamentoVapi(
  cenario: string,
  ligacaoId: string,
  horario: string | null,
  callbackUrl: string,
  idEvento: string,
): Record<string, unknown> {
  const horarios = horario ? [horario] : [];
  const call = {
    id: `sim_${Date.now()}`,
    // Sem `callback_url`: desde 06/09/2026 (achado A1 do pentest) o destino do
    // POST assinado vem da configuração do n8n (`$vars.SICHF_CALLBACK_URL`),
    // que aqui é o parâmetro `callbackUrl` passado a `mapear`.
    metadata: { ligacao_id: ligacaoId, tentativa: 1, horarios },
  };
  const base = {
    type: "end-of-call-report",
    call,
    transcript: "[simulação] AI: Olá. USER: Pode ser esse horário.",
    summary: `[simulação] cenário ${cenario}`,
    recordingUrl: "https://storage.vapi.ai/simulacao.wav",
    cost: 0.0123,
    durationSeconds: 61,
  };

  const porCenario: Record<string, Record<string, unknown>> = {
    "vapi-agendou": { endedReason: "customer-ended-call", analysis: { structuredData: { opcao_escolhida: 1, resultado: "agendou" } } },
    "vapi-recusou": { endedReason: "customer-ended-call", analysis: { structuredData: { resultado: "recusou" } } },
    "vapi-sem-resposta": { endedReason: "customer-did-not-answer" },
    "vapi-caixa-postal": { endedReason: "voicemail" },
    "vapi-falhou": { endedReason: "assistant-error" },
    "vapi-callback-forjado": { endedReason: "customer-ended-call", analysis: { structuredData: { resultado: "recusou" } } },
    "vapi-gigante": {
      endedReason: "customer-ended-call",
      analysis: { structuredData: { resultado: "recusou" } },
      transcript: "a".repeat(300_000),
      summary: "b".repeat(9_000),
    },
  };

  // A PoC do pentest (A1), aqui como cenário operável: a "mensagem da Vapi"
  // vem com um `callback_url` malicioso no metadata. O mapeamento tem de
  // ignorá-lo por completo.
  const mensagem = { ...base, ...porCenario[cenario] } as Record<string, unknown>;
  if (cenario === "vapi-callback-forjado") {
    (mensagem.call as { metadata: Record<string, unknown> }).metadata.callback_url = "http://169.254.169.254/latest/meta-data/";
  }

  const resultado = mapear(mensagem, callbackUrl);
  if (!resultado) {
    console.error(`O mapeamento do n8n devolveu VAZIO para o cenário ${cenario} — isso já é um achado.`);
    process.exit(1);
  }
  if (resultado.callback_url !== callbackUrl) {
    console.error(`ACHADO: o mapeamento devolveu destino ${resultado.callback_url} em vez do configurado ${callbackUrl}.`);
    process.exit(1);
  }
  // `id_evento` próprio para a simulação não colidir com entrega real.
  return { ...resultado.payload, id_evento: idEvento };
}

async function principal(): Promise<void> {
  carregarEnvLocal();
  if (process.argv.includes("--ajuda") || process.argv.includes("--help")) {
    console.log(fs.readFileSync(__filename, "utf8").split("*/")[0]);
    return;
  }

  const cenario = argumento("cenario") ?? "valida";
  const ligacaoId = argumento("ligacao") ?? null;
  const ehVapi = cenario.startsWith("vapi-");
  const baseUrl = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const segredo = process.env.LIGACAO_IA_WEBHOOK_SECRET?.trim() ?? "";
  const url = `${baseUrl}/api/webhooks/n8n/ligacao`;

  let admin: SupabaseClient | null = null;
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  const DISPENSAM_LIGACAO = new Set(["sem-secret", "sem-assinatura", "timestamp-velho", "corpo-adulterado"]);
  if (!DISPENSAM_LIGACAO.has(cenario) && !ligacaoId) {
    console.error("Falta --ligacao=<uuid>.");
    process.exit(2);
  }

  let horario = argumento("horario") ?? null;
  if ((cenario === "valida" || cenario === "vapi-agendou") && !horario) {
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

  const corpoObj = ehVapi
    ? corpoDoMapeamentoVapi(cenario, ligacaoId!, horario, `${baseUrl}/api/webhooks/n8n/ligacao`, idEvento)
    : {
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
  // `timestamp-velho`: assinatura PERFEITA, só que de 1 hora atrás. É o replay
  // que a janela de ±5 min existe para barrar.
  const timestamp = cenario === "timestamp-velho" ? String(Math.floor(Date.now() / 1000) - 3600) : String(Math.floor(Date.now() / 1000));

  const headers: Record<string, string> = { "content-type": "application/json", "x-sichf-timestamp": timestamp };
  if (cenario === "invalida") {
    headers["x-sichf-assinatura"] = assinar("segredo-errado", timestamp, corpo);
  } else if (cenario === "sem-assinatura") {
    // Nenhum header de assinatura: o webhook não pode aceitar "porque veio JSON válido".
  } else if (cenario !== "sem-secret") {
    if (!segredo) {
      console.error("LIGACAO_IA_WEBHOOK_SECRET ausente no .env.local — não dá para assinar.");
      process.exit(2);
    }
    // `corpo-adulterado`: assina um corpo e envia OUTRO (o clássico "trocaram o
    // resultado no meio do caminho").
    const corpoAssinado = cenario === "corpo-adulterado" ? corpo.replace("concluida", "cancelada") : corpo;
    headers["x-sichf-assinatura"] = assinar(segredo, timestamp, corpoAssinado);
  }

  console.log(`→ POST ${url}  cenário=${cenario}  id_evento=${idEvento}`);
  const resposta = await fetch(url, { method: "POST", headers, body: corpo });
  const texto = await resposta.text();
  console.log(`← HTTP ${resposta.status}`);
  console.log(texto.slice(0, 1500));

  const esperado: Record<string, number> = {
    valida: 200,
    invalida: 401,
    fora: 422,
    reentrega: 200,
    "sem-secret": 503,
    "sem-assinatura": 401,
    "timestamp-velho": 401,
    "corpo-adulterado": 401,
    "vapi-agendou": 200,
    "vapi-recusou": 200,
    "vapi-sem-resposta": 200,
    "vapi-caixa-postal": 200,
    "vapi-falhou": 200,
    "vapi-gigante": 200,
    "vapi-callback-forjado": 200,
  };
  if (!(cenario in esperado)) {
    console.error(`Cenário desconhecido: ${cenario}. Veja --ajuda.`);
    process.exit(2);
  }
  // `--espera-status=404`: prova de CONTRATO sem tocar em dado de cliente —
  // manda o corpo mapeado com um `ligacao_id` que não existe. 404 significa
  // "o corpo passou pelo Zod e chegou na máquina de estados"; 422 significa
  // "o mapeamento quebrou o contrato da rota".
  const esperadoStatus = Number(argumento("espera-status") ?? esperado[cenario]);
  const ok = resposta.status === esperadoStatus;
  console.log(ok ? `OK — status esperado (${esperadoStatus}).` : `DIVERGÊNCIA — esperado ${esperadoStatus}, veio ${resposta.status}.`);

  if (admin && !["sem-secret", "sem-assinatura", "timestamp-velho", "corpo-adulterado"].includes(cenario)) {
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
