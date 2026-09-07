/**
 * scripts/simular-chatwoot.ts — prova o agente de WhatsApp de onboarding contra
 * um servidor de verdade, sem inbox da Meta, sem cliente real e sem gastar IA.
 *
 * O que ele faz: monta o payload `message_created` no formato exato do Chatwoot,
 * assina com `CHATWOOT_WEBHOOK_SECRET` na URL, sobe um **Chatwoot de mentira**
 * (servidor HTTP local que aceita `POST /api/v1/accounts/:c/conversations/:id/messages`
 * e devolve um id) e confere, no banco, o que o agente fez.
 *
 * Os 10 roteiros — cada um é uma trava do §B do plano:
 *   desligado         `agente_whatsapp.ativo=false` → grava e NÃO responde, 0 IA
 *   desconhecido      número fora do cadastro → silêncio + pendência (D1/D2)
 *   demo              pessoa/jornada `origem_dado='exemplo'` → silêncio (D5)
 *   sem_pagamento     lead que não contratou a SV → silêncio + tarefa (B63)
 *   sem_consentimento sem `comunicacao_whatsapp` → silêncio + tarefa
 *   documento         cliente real pedindo documento → RESPONDE com o /p/d
 *   fora_do_tema      2 mensagens fora do tema → 2ª encaminha + tarefa (B57)
 *   humano            humano respondeu há 2 min → silêncio (C8/D24)
 *   outgoing          mensagem de saída → carimba, não grava em recebidas
 *   duplicada         o MESMO `message.id` duas vezes → `reentrega`
 *
 * MODO DE USO
 *   # 1. suba o dev server apontando o Chatwoot para o dublê deste script:
 *   CHATWOOT_WEBHOOK_SECRET=cw-local CHATWOOT_URL=http://127.0.0.1:3999 \
 *   CHATWOOT_ACCOUNT_ID=1 CHATWOOT_API_TOKEN=local CHATWOOT_INBOX_ID=1 npx next dev
 *   # 2. rode:
 *   CHATWOOT_WEBHOOK_SECRET=cw-local npx tsx scripts/simular-chatwoot.ts
 *   npx tsx scripts/simular-chatwoot.ts --roteiro=documento --manter
 *
 * SEGURANÇA
 *   · RECUSA qualquer host que não seja local. Este script escreve em `pessoas`,
 *     `jornadas` e `pagamentos` — rodar contra produção criaria cliente falso.
 *   · Nunca imprime o segredo.
 *   · Liga o agente e o DEVOLVE ao valor anterior no `finally`, sempre.
 *   · Limpa tudo o que criou (`--manter` desliga).
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Ambiente e argumentos
// ---------------------------------------------------------------------------

function carregarEnvLocal(): void {
  const arquivo = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(arquivo)) return;
  for (const linha of fs.readFileSync(arquivo, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linha);
    if (!m) continue;
    const [, nome, bruto] = m;
    const valor = bruto.replace(/^["']|["']$/g, "");
    if (process.env[nome] !== undefined && process.env[nome] !== "") continue;
    process.env[nome] = valor;
  }
}

function argumento(nome: string): string | undefined {
  const prefixo = `--${nome}=`;
  return process.argv.find((a) => a.startsWith(prefixo))?.slice(prefixo.length);
}
function bandeira(nome: string): boolean {
  return process.argv.includes(`--${nome}`);
}

const ROTEIROS = [
  "desligado",
  "desconhecido",
  "demo",
  "sem_pagamento",
  "sem_consentimento",
  "documento",
  "fora_do_tema",
  "humano",
  "outgoing",
  "duplicada",
  "conversa_alheia",
] as const;
type Roteiro = (typeof ROTEIROS)[number];

/** Só localhost. É a trava que impede criar cliente falso em produção. */
function exigirHostLocal(base: string): URL {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new Error(`BASE_URL invalida: ${base}`);
  }
  const locais = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);
  if (!locais.has(url.hostname)) {
    throw new Error(
      `RECUSADO: ${url.hostname} nao e local. Este script cria pessoa, processo e PAGAMENTO — ` +
        "rodar contra producao sujaria a base do escritorio.",
    );
  }
  return url;
}

// ---------------------------------------------------------------------------
// O Chatwoot de mentira
// ---------------------------------------------------------------------------

interface EnvioCapturado {
  conversa: string;
  texto: string;
}

/**
 * De quem é cada conversa, do lado do "Chatwoot". É o que faz a 15ª trava ser
 * testável: o servidor pergunta ao provedor de quem é a conversa, e o provedor
 * (aqui, o dublê) responde com um número que o payload NÃO controla.
 */
const donoDaConversa = new Map<string, string>();

function subirDubleChatwoot(porta: number, capturados: EnvioCapturado[]): Promise<http.Server> {
  const servidor = http.createServer((req, res) => {
    const leitura = /^\/api\/v1\/accounts\/[^/]+\/conversations\/([^/]+)$/.exec(req.url ?? "");
    if (req.method === "GET" && leitura) {
      const telefone = donoDaConversa.get(leitura[1]);
      res.writeHead(telefone ? 200 : 404, { "Content-Type": "application/json" });
      res.end(
        telefone
          ? JSON.stringify({ id: Number(leitura[1]), meta: { sender: { id: 1, name: "Contato", phone_number: telefone } } })
          : JSON.stringify({ error: "conversa nao existe no duble" }),
      );
      return;
    }

    const m = /^\/api\/v1\/accounts\/[^/]+\/conversations\/([^/]+)\/messages$/.exec(req.url ?? "");
    if (req.method !== "POST" || !m) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "rota nao simulada" }));
      return;
    }
    let corpo = "";
    req.on("data", (p) => {
      corpo += p;
    });
    req.on("end", () => {
      let texto = "";
      try {
        texto = String(JSON.parse(corpo).content ?? "");
      } catch {
        texto = "";
      }
      capturados.push({ conversa: m[1], texto });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: 900000 + capturados.length }));
    });
  });
  return new Promise((resolve, reject) => {
    servidor.once("error", reject);
    servidor.listen(porta, "127.0.0.1", () => resolve(servidor));
  });
}

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

let sequencia = 0;
function proximoId(): number {
  sequencia += 1;
  return 700000 + sequencia;
}

interface OpcoesPayload {
  telefone: string | null;
  conteudo: string;
  conversa: number;
  inbox: number;
  saida?: boolean;
  mensagemId?: number;
  anexo?: boolean;
}

function montarPayload(o: OpcoesPayload): Record<string, unknown> {
  return {
    event: "message_created",
    id: o.mensagemId ?? proximoId(),
    content: o.conteudo,
    message_type: o.saida ? "outgoing" : "incoming",
    private: false,
    created_at: new Date().toISOString(),
    attachments: o.anexo ? [{ file_type: "image", data_url: "http://127.0.0.1:3999/x.jpg", extension: "jpg" }] : [],
    conversation: { id: o.conversa, inbox_id: o.inbox },
    inbox: { id: o.inbox },
    sender: { id: 1, name: "Simulação", phone_number: o.telefone, identifier: o.telefone },
    account: { id: 1 },
  };
}

interface Resposta {
  status: number;
  corpo: Record<string, unknown>;
}

async function enviarWebhook(base: URL, segredo: string, payload: unknown): Promise<Resposta> {
  const r = await fetch(`${base.origin}/api/webhooks/chatwoot?token=${encodeURIComponent(segredo)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const texto = await r.text();
  let corpo: Record<string, unknown> = {};
  try {
    corpo = texto ? JSON.parse(texto) : {};
  } catch {
    corpo = { bruto: texto.slice(0, 200) };
  }
  return { status: r.status, corpo };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface Fixture {
  tag: string;
  pessoaId: string;
  jornadaId: string;
  telefone: string;
  conversa: number;
}

interface OpcoesFixture {
  tag: string;
  origemDado: "real" | "exemplo";
  /** `null` = sem pagamento (lead). `2` = SV + Croqui (o passo vira "Enviar documentos"). */
  nivel: 0 | 1 | 2;
  consentimentos: string[];
  /** Guarda o telefone SEM `+` — é como a única pessoa real do banco está gravada. */
  telefoneSemMais?: boolean;
}

async function pagar(db: SupabaseClient, jornadaId: string, pessoaId: string, tipo: string, tag: string): Promise<void> {
  const { data: produto } = await db.from("produtos").select("id").eq("tipo", tipo).limit(1).maybeSingle<{ id: string }>();
  if (!produto) throw new Error(`fixture: produto ${tipo} nao cadastrado`);
  const { error } = await db.from("pagamentos").insert({
    jornada_id: jornadaId,
    pessoa_id: pessoaId,
    produto_id: produto.id,
    origem: "manual",
    transacao_externa_id: `SIMCW-${tag}-${tipo}`,
    status: "aprovado",
    valor: 1,
    moeda: "BRL",
    pago_em: new Date().toISOString(),
    bruto: {},
  });
  if (error) throw new Error(`fixture pagamento ${tipo}: ${error.message}`);
}

async function subirEtapas(db: SupabaseClient, jornadaId: string, etapas: string[]): Promise<void> {
  for (const etapa of etapas) {
    const { error } = await db.from("jornadas").update({ etapa }).eq("id", jornadaId);
    if (error) throw new Error(`fixture etapa ${etapa}: ${error.message}`);
  }
}

async function criarFixture(db: SupabaseClient, o: OpcoesFixture): Promise<Fixture> {
  const sufixo = Math.floor(Math.random() * 9_000_000) + 1_000_000;
  const e164 = `+5511${sufixo}00`.slice(0, 14);
  const gravado = o.telefoneSemMais ? e164.replace("+55", "") : e164;

  const { data: pessoa, error: erroPessoa } = await db
    .from("pessoas")
    .insert({ nome: `Simulação ${o.tag}`, email: `sim.${o.tag}.${sufixo}@example.com`, telefone: gravado, origem_dado: o.origemDado })
    .select("id")
    .single<{ id: string }>();
  if (erroPessoa) throw new Error(`fixture pessoa: ${erroPessoa.message}`);

  const { data: jornada, error: erroJornada } = await db
    .from("jornadas")
    // `origem: "indicacao"` e não "seminario": `ck_edicao_por_origem` (0004:47)
    // exige `edicao_id` quando a origem é seminário, e a fixture não tem edição.
    .insert({ pessoa_id: pessoa.id, etapa: "captado", origem: "indicacao", origem_dado: o.origemDado })
    .select("id")
    .single<{ id: string }>();
  if (erroJornada) throw new Error(`fixture jornada: ${erroJornada.message}`);

  const fixture: Fixture = {
    tag: o.tag,
    pessoaId: pessoa.id,
    jornadaId: jornada.id,
    telefone: e164,
    conversa: 5000 + (sufixo % 1000),
  };
  // A conversa desta fixture pertence a ESTE telefone — é o que o servidor vai
  // conferir contra o payload (trava 15).
  donoDaConversa.set(String(fixture.conversa), e164);

  // A partir daqui TUDO limpa a si mesmo se falhar. Sem isto, um erro no meio
  // da montagem (etapa recusada, consentimento sem texto) deixava pessoa e
  // processo órfãos no banco — e o script "falhava limpo" mentindo.
  try {

  if (o.nivel >= 1) {
    // A ORDEM aqui é a máquina de estados do banco, não conveniência:
    //   . o TETO (0084) exige o pagamento REGISTRADO para entrar numa etapa paga;
    //   . o PISO (0004) usa `jornadas.nivel_pago`, que o pagamento acabou de
    //     subir — com o croqui já pago, `sessao_contratada` vira "abaixo do
    //     nível pago" e é RECUSADA;
    //   . `transicoes_permitidas` (0004) só aceita pares vizinhos.
    // Logo: paga a SV → sobe até `sessao_realizada` → paga o croqui → sobe a
    // última. Pular qualquer passo levanta `transicao_invalida`.
    await pagar(db, jornada.id, pessoa.id, "sessao_viabilidade", `${o.tag}-${sufixo}`);
    const ateSessao: string[] = o.nivel >= 2 ? ["sessao_contratada", "sessao_agendada", "sessao_realizada"] : ["sessao_contratada"];
    await subirEtapas(db, jornada.id, ateSessao);
    if (o.nivel >= 2) {
      await pagar(db, jornada.id, pessoa.id, "croqui_estrutural", `${o.tag}-${sufixo}`);
      await subirEtapas(db, jornada.id, ["croqui_contratado"]);
    }
  }

  for (const tipo of o.consentimentos) {
    const { error } = await db
      .from("consentimentos")
      .insert({
        pessoa_id: pessoa.id,
        tipo,
        concedido: true,
        // `texto_apresentado` e `versao_texto` são NOT NULL (0005): o registro
        // de consentimento guarda O QUE a pessoa leu, não só o "sim".
        texto_apresentado: `Simulação da Fase 9 (${tipo}) — fixture de scripts/simular-chatwoot.ts.`,
        versao_texto: "simulacao-fase9",
        canal: "formulario",
        concedido_em: new Date().toISOString(),
      });
    if (error) throw new Error(`fixture consentimento ${tipo}: ${error.message}`);
  }

  } catch (erro) {
    await limparFixture(db, fixture);
    throw erro;
  }

  return fixture;
}

async function limparFixture(db: SupabaseClient, f: Fixture): Promise<void> {
  await db.from("mensagens_recebidas").delete().eq("conversa_externa_id", String(f.conversa));
  await db.from("pagamentos").delete().eq("jornada_id", f.jornadaId);
  await db.from("jornadas").delete().eq("id", f.jornadaId); // cascata: tarefas, timeline, links, agente_*
  await db.from("consentimentos").delete().eq("pessoa_id", f.pessoaId);
  await db.from("pessoas").delete().eq("id", f.pessoaId);
}

// ---------------------------------------------------------------------------
// Roteiros
// ---------------------------------------------------------------------------

interface Veredito {
  roteiro: Roteiro;
  ok: boolean;
  detalhe: string;
}

const INBOX = Number(process.env.CHATWOOT_INBOX_ID ?? "1");

async function contarExecucoesDoAgente(db: SupabaseClient): Promise<number> {
  const { data: prompts } = await db
    .from("prompts_versoes")
    .select("id")
    .eq("chave", "agente_whatsapp_onboarding")
    .returns<Array<{ id: string }>>();
  const ids = (prompts ?? []).map((p) => p.id);
  if (ids.length === 0) return 0;
  const { count } = await db.from("execucoes_ia").select("id", { count: "exact", head: true }).in("prompt_versao_id", ids);
  return count ?? 0;
}

async function rodar(
  roteiro: Roteiro,
  ctx: { db: SupabaseClient; base: URL; segredo: string; capturados: EnvioCapturado[]; manter: boolean; ligar: (v: boolean) => Promise<void> },
): Promise<Veredito> {
  const { db, base, segredo, capturados } = ctx;
  const tag = `${roteiro}-${Date.now().toString(36)}`;
  const criadas: Fixture[] = [];

  try {
    switch (roteiro) {
      case "desligado": {
        await ctx.ligar(false);
        const f = await criarFixture(db, { tag, origemDado: "real", nivel: 2, consentimentos: ["comunicacao_whatsapp"] });
        criadas.push(f);
        const antes = await contarExecucoesDoAgente(db);
        const r = await enviarWebhook(base, segredo, montarPayload({ telefone: f.telefone, conteudo: "oi", conversa: f.conversa, inbox: INBOX }));
        const depois = await contarExecucoesDoAgente(db);
        const { count: gravadas } = await db
          .from("mensagens_recebidas")
          .select("id", { count: "exact", head: true })
          .eq("conversa_externa_id", String(f.conversa));
        await ctx.ligar(true);
        const ok = r.status === 200 && r.corpo.agente === "silencio" && r.corpo.agente_motivo === "agente_desligado" && gravadas === 1 && depois === antes;
        return { roteiro, ok, detalhe: `200=${r.status === 200} motivo=${r.corpo.agente_motivo} gravadas=${gravadas} execucoes_ia ${antes}→${depois}` };
      }

      case "desconhecido": {
        const telefone = "+5511999990001";
        const conversa = 5901;
        const r = await enviarWebhook(base, segredo, montarPayload({ telefone, conteudo: "oi, quem é?", conversa, inbox: INBOX }));
        const { data: msg } = await db
          .from("mensagens_recebidas")
          .select("id, pessoa_id")
          .eq("conversa_externa_id", String(conversa))
          .maybeSingle<{ id: string; pessoa_id: string | null }>();
        const { count: pend } = await db
          .from("vw_pendencias_sistema")
          .select("id", { count: "exact", head: true })
          .eq("tipo", "numero_desconhecido");
        await db.from("mensagens_recebidas").delete().eq("conversa_externa_id", String(conversa));
        const ok =
          r.status === 200 &&
          r.corpo.correspondencia === "sem_correspondencia" &&
          r.corpo.agente === "silencio" &&
          r.corpo.agente_motivo === "numero_desconhecido" &&
          msg?.pessoa_id === null &&
          (pend ?? 0) >= 1 &&
          capturados.length === 0;
        return { roteiro, ok, detalhe: `motivo=${r.corpo.agente_motivo} gravada=${Boolean(msg)} pessoa_id=null=${msg?.pessoa_id === null} pendencias=${pend} enviados=${capturados.length}` };
      }

      case "demo": {
        const f = await criarFixture(db, { tag, origemDado: "exemplo", nivel: 2, consentimentos: ["comunicacao_whatsapp"] });
        criadas.push(f);
        const antes = capturados.length;
        const r = await enviarWebhook(base, segredo, montarPayload({ telefone: f.telefone, conteudo: "oi", conversa: f.conversa, inbox: INBOX }));
        const ok = r.corpo.agente_motivo === "origem_demonstracao" && capturados.length === antes;
        return { roteiro, ok, detalhe: `motivo=${r.corpo.agente_motivo} novos_envios=${capturados.length - antes} (esperado 0)` };
      }

      case "sem_pagamento": {
        const f = await criarFixture(db, { tag, origemDado: "real", nivel: 0, consentimentos: ["comunicacao_whatsapp"] });
        criadas.push(f);
        const r = await enviarWebhook(base, segredo, montarPayload({ telefone: f.telefone, conteudo: "oi", conversa: f.conversa, inbox: INBOX }));
        const { count: tarefas } = await db
          .from("tarefas")
          .select("id", { count: "exact", head: true })
          .eq("jornada_id", f.jornadaId)
          .eq("tipo", "lead_escreveu_sem_contratar");
        const ok = r.corpo.agente_motivo === "sem_pagamento" && (tarefas ?? 0) === 1;
        return { roteiro, ok, detalhe: `motivo=${r.corpo.agente_motivo} tarefa_comercial=${tarefas}` };
      }

      case "sem_consentimento": {
        const f = await criarFixture(db, { tag, origemDado: "real", nivel: 2, consentimentos: [] });
        criadas.push(f);
        const r = await enviarWebhook(base, segredo, montarPayload({ telefone: f.telefone, conteudo: "oi", conversa: f.conversa, inbox: INBOX }));
        const { count: tarefas } = await db
          .from("tarefas")
          .select("id", { count: "exact", head: true })
          .eq("jornada_id", f.jornadaId)
          .eq("tipo", "escreveu_sem_consentimento");
        const ok = r.corpo.agente_motivo === "sem_consentimento_whatsapp" && (tarefas ?? 0) === 1;
        return { roteiro, ok, detalhe: `motivo=${r.corpo.agente_motivo} tarefa=${tarefas}` };
      }

      case "documento": {
        // Telefone gravado SEM `+` de propósito: é o formato da única pessoa
        // real do banco, e o que o CONFLITO C1 quebrava.
        const f = await criarFixture(db, { tag, origemDado: "real", nivel: 2, consentimentos: ["comunicacao_whatsapp"], telefoneSemMais: true });
        criadas.push(f);
        const antes = capturados.length;
        const r = await enviarWebhook(base, segredo, montarPayload({ telefone: f.telefone, conteudo: "quero mandar os documentos", conversa: f.conversa, inbox: INBOX }));
        const enviados = capturados.slice(antes);
        const { data: resposta } = await db
          .from("agente_whatsapp_respostas")
          .select("intencao, acao, texto, enviada_em")
          .eq("jornada_id", f.jornadaId)
          .maybeSingle<{ intencao: string | null; acao: string | null; texto: string | null; enviada_em: string | null }>();
        const { data: link } = await db
          .from("links_publicos")
          .select("id, tipo, estado, criado_por")
          .eq("jornada_id", f.jornadaId)
          .eq("tipo", "documentos")
          .maybeSingle<{ id: string; estado: string; criado_por: string | null }>();
        const ok =
          r.corpo.agente === "respondeu" &&
          enviados.length === 1 &&
          enviados[0].texto.includes("/p/d/") &&
          resposta?.intencao === "enviar_documento" &&
          resposta?.acao === "enviar_link" &&
          resposta?.enviada_em !== null &&
          link?.estado === "ativo" &&
          link?.criado_por === null;
        return {
          roteiro,
          ok,
          detalhe: `agente=${r.corpo.agente} envios=${enviados.length} tem_link=${enviados[0]?.texto.includes("/p/d/")} intencao=${resposta?.intencao} link_estado=${link?.estado} criado_por=${link?.criado_por}`,
        };
      }

      case "fora_do_tema": {
        const f = await criarFixture(db, { tag, origemDado: "real", nivel: 2, consentimentos: ["comunicacao_whatsapp"] });
        criadas.push(f);
        const antes = capturados.length;
        await enviarWebhook(base, segredo, montarPayload({ telefone: f.telefone, conteudo: "vocês jogam futebol no fim de semana?", conversa: f.conversa, inbox: INBOX }));
        await enviarWebhook(base, segredo, montarPayload({ telefone: f.telefone, conteudo: "mas e o campeonato, quem ganha?", conversa: f.conversa, inbox: INBOX }));
        const enviados = capturados.slice(antes);
        const { count: tarefas } = await db
          .from("tarefas")
          .select("id", { count: "exact", head: true })
          .eq("jornada_id", f.jornadaId)
          .eq("tipo", "agente_whatsapp_encaminhou");
        const { data: estado } = await db
          .from("agente_whatsapp_estado")
          .select("esquivas_seguidas")
          .eq("jornada_id", f.jornadaId)
          .maybeSingle<{ esquivas_seguidas: number }>();
        const ok = enviados.length === 2 && enviados[1].texto !== enviados[0].texto && (tarefas ?? 0) === 1 && (estado?.esquivas_seguidas ?? 0) >= 2;
        return { roteiro, ok, detalhe: `envios=${enviados.length} textos_diferentes=${enviados[1]?.texto !== enviados[0]?.texto} tarefa_encaminhou=${tarefas} esquivas=${estado?.esquivas_seguidas}` };
      }

      case "humano": {
        const f = await criarFixture(db, { tag, origemDado: "real", nivel: 2, consentimentos: ["comunicacao_whatsapp"] });
        criadas.push(f);
        await db
          .from("agente_whatsapp_estado")
          .upsert({ jornada_id: f.jornadaId, humano_respondeu_em: new Date(Date.now() - 2 * 60_000).toISOString() }, { onConflict: "jornada_id" });
        const antes = capturados.length;
        const r = await enviarWebhook(base, segredo, montarPayload({ telefone: f.telefone, conteudo: "e aí, tudo certo?", conversa: f.conversa, inbox: INBOX }));
        const ok = r.corpo.agente_motivo === "humano_no_comando" && capturados.length === antes;
        return { roteiro, ok, detalhe: `motivo=${r.corpo.agente_motivo} novos_envios=${capturados.length - antes} (esperado 0)` };
      }

      case "outgoing": {
        const f = await criarFixture(db, { tag, origemDado: "real", nivel: 2, consentimentos: ["comunicacao_whatsapp"] });
        criadas.push(f);
        // Primeiro uma entrada, para a conversa ficar conhecida...
        await enviarWebhook(base, segredo, montarPayload({ telefone: f.telefone, conteudo: "oi", conversa: f.conversa, inbox: INBOX }));
        const { count: antesRecebidas } = await db
          .from("mensagens_recebidas")
          .select("id", { count: "exact", head: true })
          .eq("conversa_externa_id", String(f.conversa));
        // ...e agora a resposta de um humano.
        const r = await enviarWebhook(base, segredo, montarPayload({ telefone: f.telefone, conteudo: "oi, aqui é a Ana do escritório", conversa: f.conversa, inbox: INBOX, saida: true }));
        const { count: depoisRecebidas } = await db
          .from("mensagens_recebidas")
          .select("id", { count: "exact", head: true })
          .eq("conversa_externa_id", String(f.conversa));
        const { data: estado } = await db
          .from("agente_whatsapp_estado")
          .select("humano_respondeu_em")
          .eq("jornada_id", f.jornadaId)
          .maybeSingle<{ humano_respondeu_em: string | null }>();
        const ok = r.status === 200 && r.corpo.efeito === "humano_respondeu" && antesRecebidas === depoisRecebidas && Boolean(estado?.humano_respondeu_em);
        return {
          roteiro,
          ok,
          detalhe: `efeito=${r.corpo.efeito} recebidas ${antesRecebidas}→${depoisRecebidas} (não pode crescer) carimbou=${Boolean(estado?.humano_respondeu_em)}`,
        };
      }

      case "conversa_alheia": {
        // O ataque do finding MÉDIO: payload com o telefone de um cliente REAL
        // e o id de uma conversa que o atacante controla. O porteiro casa a
        // pessoa certa — e a trava 15 é a única coisa entre o onboarding dela
        // e a conversa do atacante.
        const f = await criarFixture(db, { tag, origemDado: "real", nivel: 2, consentimentos: ["comunicacao_whatsapp"] });
        criadas.push(f);
        const conversaAlheia = f.conversa + 400;
        donoDaConversa.set(String(conversaAlheia), "+5511777770000");
        const antes = capturados.length;
        const r = await enviarWebhook(
          base,
          segredo,
          montarPayload({ telefone: f.telefone, conteudo: "o que falta?", conversa: conversaAlheia, inbox: INBOX }),
        );
        const { data: resposta } = await db
          .from("agente_whatsapp_respostas")
          .select("erro, texto, enviada_em")
          .eq("jornada_id", f.jornadaId)
          .maybeSingle<{ erro: string | null; texto: string | null; enviada_em: string | null }>();
        const { count: tarefas } = await db
          .from("tarefas")
          .select("id", { count: "exact", head: true })
          .eq("jornada_id", f.jornadaId)
          .eq("tipo", "agente_whatsapp_conversa_divergente");
        await db.from("mensagens_recebidas").delete().eq("conversa_externa_id", String(conversaAlheia));
        donoDaConversa.delete(String(conversaAlheia));
        const ok =
          r.corpo.agente === "silencio" &&
          r.corpo.agente_motivo === "conversa_nao_pertence_ao_telefone" &&
          capturados.length === antes &&
          resposta?.erro === "conversa_nao_pertence_ao_telefone" &&
          resposta?.texto === null &&
          (tarefas ?? 0) === 1;
        return {
          roteiro,
          ok,
          detalhe: `motivo=${r.corpo.agente_motivo} novos_envios=${capturados.length - antes} (esperado 0) erro_gravado=${resposta?.erro} texto=${resposta?.texto} tarefa=${tarefas}`,
        };
      }

      case "duplicada": {
        const f = await criarFixture(db, { tag, origemDado: "real", nivel: 2, consentimentos: ["comunicacao_whatsapp"] });
        criadas.push(f);
        const id = proximoId();
        const antes = capturados.length;
        const p = montarPayload({ telefone: f.telefone, conteudo: "quero mandar os documentos", conversa: f.conversa, inbox: INBOX, mensagemId: id });
        const r1 = await enviarWebhook(base, segredo, p);
        const r2 = await enviarWebhook(base, segredo, p);
        const { count: respostas } = await db
          .from("agente_whatsapp_respostas")
          .select("id", { count: "exact", head: true })
          .eq("jornada_id", f.jornadaId);
        const ok = r1.corpo.agente === "respondeu" && r2.corpo.reentrega === true && respostas === 1 && capturados.length - antes === 1;
        return { roteiro, ok, detalhe: `1ª=${r1.corpo.agente} 2ª_reentrega=${r2.corpo.reentrega} respostas=${respostas} envios=${capturados.length - antes} (esperado 1)` };
      }
    }
  } finally {
    if (!ctx.manter) {
      for (const f of criadas) await limparFixture(db, f);
    }
  }
  // Inalcançável: o `switch` cobre os 10 roteiros. Existe para que acrescentar
  // um roteiro sem `case` falhe VISÍVEL, e não em silêncio como sucesso.
  return { roteiro, ok: false, detalhe: "roteiro sem implementação" };
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  carregarEnvLocal();

  const segredo = process.env.CHATWOOT_WEBHOOK_SECRET ?? "";
  if (!segredo) {
    throw new Error(
      "CHATWOOT_WEBHOOK_SECRET vazio. Suba o dev server e rode este script com o MESMO valor:\n" +
        "  CHATWOOT_WEBHOOK_SECRET=cw-local CHATWOOT_URL=http://127.0.0.1:3999 CHATWOOT_ACCOUNT_ID=1 \\\n" +
        "  CHATWOOT_API_TOKEN=local CHATWOOT_INBOX_ID=1 npx next dev\n" +
        "  CHATWOOT_WEBHOOK_SECRET=cw-local npx tsx scripts/simular-chatwoot.ts",
    );
  }

  const base = exigirHostLocal(argumento("base") ?? process.env.BASE_URL ?? "http://localhost:3000");
  const pedido = argumento("roteiro") ?? "todos";
  const roteiros: Roteiro[] = pedido === "todos" ? [...ROTEIROS] : [pedido as Roteiro];
  for (const r of roteiros) {
    if (!ROTEIROS.includes(r)) throw new Error(`roteiro desconhecido: ${r}. Use ${ROTEIROS.join(" | ")} | todos`);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) throw new Error("NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorios para conferir o efeito.");
  const db = createClient(url, chave, { auth: { persistSession: false } });

  // A conferência das migrations vem ANTES de subir qualquer servidor: sem a
  // 0088 não há o que simular, e um socket aberto seguraria o processo de pé
  // depois do erro (o script travaria em vez de falhar).
  const { data: antesConfig } = await db
    .from("configuracoes")
    .select("valor")
    .eq("chave", "agente_whatsapp.ativo")
    .maybeSingle<{ valor: unknown }>();
  if (!antesConfig) {
    throw new Error(
      "configuracoes['agente_whatsapp.ativo'] nao existe no banco.\n" +
        "Aplique 0088_agente_whatsapp.sql, 0089_link_sistema_sinais_e_pendencias.sql e\n" +
        "0090_prompt_agente_whatsapp.sql (nesta ordem) e rode scripts/verificacao-0088-0090.sql antes de simular.",
    );
  }
  const valorOriginal = antesConfig.valor;

  const capturados: EnvioCapturado[] = [];
  const porta = Number(argumento("porta") ?? 3999);
  const duble = await subirDubleChatwoot(porta, capturados);
  // `unref`: o dublê não pode segurar o processo de pé se um roteiro estourar.
  duble.unref();
  console.log(`alvo: ${base.origin} · duble do Chatwoot em http://127.0.0.1:${porta} · roteiros: ${roteiros.join(", ")}`);
  const ligar = async (v: boolean) => {
    const { error } = await db.from("configuracoes").update({ valor: v }).eq("chave", "agente_whatsapp.ativo");
    if (error) throw new Error(`nao consegui ligar/desligar o agente: ${error.message}`);
  };

  const vereditos: Veredito[] = [];
  try {
    await ligar(true);
    for (const roteiro of roteiros) {
      const v = await rodar(roteiro, { db, base, segredo, capturados, manter: bandeira("manter"), ligar });
      vereditos.push(v);
      console.log(`${v.ok ? "OK  " : "FALHA"} ${v.roteiro.padEnd(18)} ${v.detalhe}`);
    }
  } finally {
    await db.from("configuracoes").update({ valor: valorOriginal }).eq("chave", "agente_whatsapp.ativo");
    duble.close();
  }

  const falhas = vereditos.filter((v) => !v.ok);
  console.log(`\n${vereditos.length - falhas.length}/${vereditos.length} roteiros verdes · agente devolvido a ${JSON.stringify(valorOriginal)}`);
  if (falhas.length > 0) process.exitCode = 1;
}

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
});
