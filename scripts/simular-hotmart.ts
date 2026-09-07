/**
 * scripts/simular-hotmart.ts — prova o webhook da Hotmart contra um servidor de
 * verdade, sem venda real e sem esperar a Hotmart.
 *
 * Até a Fase 8 não havia como testar este caminho: o único jeito de saber se o
 * sistema entende "comprou / cancelou / reembolsou / só gerou boleto e não
 * pagou" era vender. Agora são cinco roteiros:
 *
 *   aprovado     → PURCHASE_APPROVED. Espera 200, estado `aprovado`, etapa da
 *                  jornada em `sessao_contratada` e `nivel_pago = 1`.
 *   boleto       → PURCHASE_BILLET_PRINTED **com `purchase.status = APPROVED`**
 *                  no payload (o caso que o vault do João documenta) e depois
 *                  PURCHASE_EXPIRED. Espera `boleto_gerado` -> `expirado`,
 *                  etapa PARADA em `captado`, e tarefa de cobrança criada.
 *   reembolso    → APPROVED e depois REFUNDED. Espera `reembolsado`, TETO em 0,
 *                  `nivel_pago` continuando 1 (piso é histórico), etapa NÃO
 *                  regredindo, tarefa + andamento criados e a régua calada.
 *   chargeback   → APPROVED e depois CHARGEBACK. Mesmo desenho, estado
 *                  `estornado`.
 *   desconhecido → `data.product.id` que ninguém mapeou. Espera 200 com
 *                  `produto_nao_mapeado`, `webhooks_eventos.processado_em`
 *                  NULO e a linha aparecendo em `vw_pendencias_sistema` com o
 *                  tipo `produto_nao_mapeado` (a fila do Admin).
 *
 * MODO DE USO
 *   # 1. suba o dev server COM o secret (o `.env.local` do João está vazio):
 *   HOTMART_WEBHOOK_SECRET=hottok-local-de-teste npx next dev
 *   # 2. rode:
 *   HOTMART_WEBHOOK_SECRET=hottok-local-de-teste npx tsx scripts/simular-hotmart.ts --roteiro=todos
 *   npx tsx scripts/simular-hotmart.ts --roteiro=boleto --produto=croqui
 *   npx tsx scripts/simular-hotmart.ts --roteiro=aprovado --manter   # não limpa
 *
 * SEGURANÇA
 *   · RECUSA qualquer host que não seja local. Assinar um payload de compra e
 *     mandar para produção seria criar dinheiro no banco de verdade.
 *   · Nunca imprime o segredo.
 *   · Limpa tudo o que criou (`--manter` desliga). Os três produtos ficam com o
 *     `hotmart_produto_id` que tinham antes, inclusive se o roteiro falhar.
 */
import fs from "node:fs";
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

const ROTEIROS = ["aprovado", "boleto", "reembolso", "chargeback", "desconhecido"] as const;
type Roteiro = (typeof ROTEIROS)[number];

const TIPO_POR_APELIDO: Record<string, string> = {
  sv: "sessao_viabilidade",
  sessao: "sessao_viabilidade",
  croqui: "croqui_estrutural",
  holding: "holding",
};

const ETAPA_ALVO: Record<string, string> = {
  sessao_viabilidade: "sessao_contratada",
  croqui_estrutural: "croqui_contratado",
  holding: "holding_contratada",
};

/** Só localhost. É a trava que impede assinar uma compra contra produção. */
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
      `RECUSADO: ${url.hostname} nao e local. Este script assina eventos de COMPRA — ` +
        "rodar contra producao criaria pagamento de verdade no banco.",
    );
  }
  return url;
}

// ---------------------------------------------------------------------------
// Payload no formato do webhook 2.0
// ---------------------------------------------------------------------------

interface Fixture {
  tag: string;
  email: string;
  nome: string;
  telefone: string;
  transacao: string;
}

function montarPayload(opcoes: {
  evento: string;
  eventoId: string;
  fixture: Fixture;
  produtoHotmartId: string;
  statusNoPayload: string;
  quando: Date;
  valor: number;
}): Record<string, unknown> {
  const { evento, eventoId, fixture, produtoHotmartId, statusNoPayload, quando, valor } = opcoes;
  return {
    id: eventoId,
    event: evento,
    version: "2.0.0",
    creation_date: quando.getTime(),
    data: {
      product: { id: produtoHotmartId, name: "Simulação SIC-HF" },
      buyer: { email: fixture.email, name: fixture.nome, checkout_phone: fixture.telefone },
      purchase: {
        transaction: fixture.transacao,
        status: statusNoPayload,
        approved_date: statusNoPayload === "APPROVED" || statusNoPayload === "COMPLETE" ? quando.getTime() : undefined,
        order_date: quando.getTime(),
        price: { value: valor, currency_value: "BRL" },
        payment: { installments_number: 1 },
      },
    },
  };
}

interface Resposta {
  status: number;
  corpo: unknown;
}

async function postar(base: URL, segredo: string, corpo: unknown, opcoes: { semHottok?: boolean } = {}): Promise<Resposta> {
  const resposta = await fetch(new URL("/api/webhooks/hotmart", base), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(opcoes.semHottok ? {} : { "x-hotmart-hottok": segredo }),
    },
    body: JSON.stringify(corpo),
  });
  const texto = await resposta.text();
  let json: unknown = texto;
  try {
    json = JSON.parse(texto);
  } catch {
    /* corpo não-JSON: mostra cru */
  }
  return { status: resposta.status, corpo: json };
}

// ---------------------------------------------------------------------------
// Leitura do efeito real (exige service_role)
// ---------------------------------------------------------------------------

interface Efeito {
  pagamento_status: string | null;
  evento_hotmart: string | null;
  transicoes: number;
  etapa: string | null;
  nivel_pago: number | null;
  teto: number | null;
  tarefas: string[];
  alertas: number;
  mensagens_pendentes: number;
  webhook_processado: boolean | null;
  webhook_erro: string | null;
  pendencia_tipo: string | null;
}

async function lerEfeito(db: SupabaseClient, fixture: Fixture, ultimoEventoId: string): Promise<Efeito> {
  const { data: pagamento } = await db
    .from("pagamentos")
    .select("id, status, evento_hotmart, jornada_id")
    .eq("transacao_externa_id", fixture.transacao)
    .maybeSingle<{ id: string; status: string; evento_hotmart: string | null; jornada_id: string | null }>();

  let transicoes = 0;
  if (pagamento) {
    const { count } = await db
      .from("pagamentos_transicoes")
      .select("id", { count: "exact", head: true })
      .eq("pagamento_id", pagamento.id);
    transicoes = count ?? 0;
  }

  let etapa: string | null = null;
  let nivelPago: number | null = null;
  let teto: number | null = null;
  const tarefas: string[] = [];
  let alertas = 0;
  let mensagensPendentes = 0;

  if (pagamento?.jornada_id) {
    const { data: jornada } = await db
      .from("jornadas")
      .select("etapa, nivel_pago")
      .eq("id", pagamento.jornada_id)
      .maybeSingle<{ etapa: string; nivel_pago: number }>();
    etapa = jornada?.etapa ?? null;
    nivelPago = jornada?.nivel_pago ?? null;

    const { data: pagos } = await db
      .from("vw_pagamentos_jornada")
      .select("produto_tipo, status")
      .eq("jornada_id", pagamento.jornada_id);
    const niveis = ((pagos as Array<{ produto_tipo: string; status: string }> | null) ?? [])
      .filter((p) => p.status === "aprovado")
      .map((p) => (p.produto_tipo === "holding" ? 3 : p.produto_tipo === "croqui_estrutural" ? 2 : 1));
    teto = niveis.length > 0 ? Math.max(...niveis) : 0;

    const { data: t } = await db
      .from("tarefas")
      .select("tipo")
      .eq("jornada_id", pagamento.jornada_id)
      .is("concluida_em", null);
    for (const linha of ((t as Array<{ tipo: string | null }> | null) ?? [])) if (linha.tipo) tarefas.push(linha.tipo);

    const { count: nAlertas } = await db
      .from("eventos_timeline")
      .select("id", { count: "exact", head: true })
      .eq("jornada_id", pagamento.jornada_id)
      .eq("tipo", "pagamento_alerta");
    alertas = nAlertas ?? 0;

    const { count: nMsg } = await db
      .from("mensagens_agendadas")
      .select("id", { count: "exact", head: true })
      .eq("jornada_id", pagamento.jornada_id)
      .eq("status", "pendente");
    mensagensPendentes = nMsg ?? 0;
  }

  const { data: webhook } = await db
    .from("webhooks_eventos")
    .select("id, processado_em, erro")
    .eq("origem", "hotmart")
    .eq("evento_externo_id", ultimoEventoId)
    .maybeSingle<{ id: string; processado_em: string | null; erro: string | null }>();

  let pendenciaTipo: string | null = null;
  if (webhook) {
    const { data: pend } = await db
      .from("vw_pendencias_sistema")
      .select("tipo")
      .eq("id", webhook.id)
      .maybeSingle<{ tipo: string }>();
    pendenciaTipo = pend?.tipo ?? null;
  }

  return {
    pagamento_status: pagamento?.status ?? null,
    evento_hotmart: pagamento?.evento_hotmart ?? null,
    transicoes,
    etapa,
    nivel_pago: nivelPago,
    teto,
    tarefas: tarefas.sort(),
    alertas,
    mensagens_pendentes: mensagensPendentes,
    webhook_processado: webhook ? webhook.processado_em !== null : null,
    webhook_erro: webhook?.erro ?? null,
    pendencia_tipo: pendenciaTipo,
  };
}

// ---------------------------------------------------------------------------
// Limpeza
// ---------------------------------------------------------------------------

async function limpar(db: SupabaseClient, fixture: Fixture): Promise<string> {
  const contagens: string[] = [];

  const { data: pagamentos } = await db
    .from("pagamentos")
    .select("id, jornada_id, pessoa_id")
    .eq("transacao_externa_id", fixture.transacao);
  const linhas = ((pagamentos as Array<{ id: string; jornada_id: string | null; pessoa_id: string | null }> | null) ?? []);
  if (linhas.length > 0) {
    await db.from("pagamentos").delete().eq("transacao_externa_id", fixture.transacao);
    contagens.push(`pagamentos:${linhas.length}`);
  }

  const { data: pessoa } = await db
    .from("pessoas")
    .select("id")
    .eq("email", fixture.email)
    .maybeSingle<{ id: string }>();
  if (pessoa) {
    const { data: jornadas } = await db.from("jornadas").select("id").eq("pessoa_id", pessoa.id);
    const ids = ((jornadas as Array<{ id: string }> | null) ?? []).map((j) => j.id);
    if (ids.length > 0) {
      // Selar a régua ANTES de apagar: o pagamento aprovado enfileirou
      // boas-vindas com `agendada_para = now()`, já vencida. O cron reivindica
      // tudo que está pendente e vencido — é o achado M1 do pentest da Fase 7,
      // e a janela entre o roteiro e o DELETE é real. Mesmo cuidado do seed.
      await db
        .from("mensagens_agendadas")
        .update({ status: "cancelada", erro: "simulacao_hotmart" })
        .in("jornada_id", ids)
        .eq("status", "pendente");
      // `on delete cascade` leva timeline, tarefas, mensagens e ligações junto.
      await db.from("jornadas").delete().in("id", ids);
      contagens.push(`jornadas:${ids.length}`);
    }
    await db.from("pessoas").delete().eq("id", pessoa.id);
    contagens.push("pessoas:1");
  }

  const { data: eventos } = await db
    .from("webhooks_eventos")
    .select("id")
    .like("evento_externo_id", `${fixture.tag}-%`);
  const idsEventos = ((eventos as Array<{ id: string }> | null) ?? []).map((e) => e.id);
  if (idsEventos.length > 0) {
    await db.from("webhooks_eventos").delete().in("id", idsEventos);
    contagens.push(`webhooks_eventos:${idsEventos.length}`);
  }

  return contagens.length > 0 ? contagens.join(" · ") : "nada a limpar";
}

// ---------------------------------------------------------------------------
// Roteiros
// ---------------------------------------------------------------------------

interface Passo {
  evento: string;
  statusNoPayload: string;
  minutosAtras: number;
  /** Sobrescreve o id do produto no payload — usado pelo roteiro `desconhecido`. */
  produtoHotmartId?: string;
}

const PASSOS: Record<Roteiro, Passo[]> = {
  aprovado: [{ evento: "PURCHASE_APPROVED", statusNoPayload: "APPROVED", minutosAtras: 0 }],
  // O payload MENTE de propósito: `status = APPROVED` num boleto só emitido.
  boleto: [
    { evento: "PURCHASE_BILLET_PRINTED", statusNoPayload: "APPROVED", minutosAtras: 60 },
    { evento: "PURCHASE_EXPIRED", statusNoPayload: "EXPIRED", minutosAtras: 0 },
  ],
  reembolso: [
    { evento: "PURCHASE_APPROVED", statusNoPayload: "APPROVED", minutosAtras: 60 },
    { evento: "PURCHASE_REFUNDED", statusNoPayload: "REFUNDED", minutosAtras: 0 },
  ],
  chargeback: [
    { evento: "PURCHASE_APPROVED", statusNoPayload: "APPROVED", minutosAtras: 60 },
    { evento: "PURCHASE_CHARGEBACK", statusNoPayload: "CHARGEBACK", minutosAtras: 0 },
  ],
  desconhecido: [
    { evento: "PURCHASE_APPROVED", statusNoPayload: "APPROVED", minutosAtras: 0, produtoHotmartId: "ID-QUE-NINGUEM-MAPEOU" },
  ],
};

/** O que cada roteiro TEM de provar. Falha aqui = saída 1. */
function conferir(roteiro: Roteiro, efeito: Efeito, etapaAlvo: string): { ok: boolean; motivos: string[] } {
  const motivos: string[] = [];
  const exigir = (condicao: boolean, texto: string) => {
    if (!condicao) motivos.push(texto);
  };

  if (roteiro === "aprovado") {
    exigir(efeito.pagamento_status === "aprovado", `pagamento deveria ser 'aprovado', veio '${efeito.pagamento_status}'`);
    exigir(efeito.etapa === etapaAlvo, `etapa deveria ser '${etapaAlvo}', veio '${efeito.etapa}'`);
    exigir(efeito.webhook_processado === true, "webhook deveria estar processado");
  }
  if (roteiro === "boleto") {
    exigir(efeito.pagamento_status === "expirado", `pagamento deveria ser 'expirado', veio '${efeito.pagamento_status}'`);
    exigir(efeito.etapa === "captado", `etapa deveria continuar 'captado' (boleto nao pago nao avanca), veio '${efeito.etapa}'`);
    exigir(efeito.teto === 0, `teto deveria ser 0, veio ${efeito.teto}`);
    exigir(efeito.tarefas.includes("pagamento_expirado"), `deveria existir tarefa 'pagamento_expirado', ha [${efeito.tarefas.join(", ")}]`);
    exigir(efeito.transicoes >= 2, `deveria haver 2 transicoes (boleto -> expirado), ha ${efeito.transicoes}`);
  }
  if (roteiro === "reembolso" || roteiro === "chargeback") {
    const alvo = roteiro === "reembolso" ? "reembolsado" : "estornado";
    exigir(efeito.pagamento_status === alvo, `pagamento deveria ser '${alvo}', veio '${efeito.pagamento_status}'`);
    exigir(efeito.etapa === etapaAlvo, `etapa NAO deve regredir: esperava '${etapaAlvo}', veio '${efeito.etapa}'`);
    exigir(efeito.teto === 0, `teto deveria cair para 0, veio ${efeito.teto}`);
    exigir((efeito.nivel_pago ?? 0) > 0, `nivel_pago (piso historico) NAO deve cair, veio ${efeito.nivel_pago}`);
    exigir(efeito.alertas >= 1, "deveria haver andamento 'pagamento_alerta' na timeline");
    exigir(efeito.tarefas.includes(`pagamento_${alvo}`), `deveria existir tarefa 'pagamento_${alvo}', ha [${efeito.tarefas.join(", ")}]`);
    exigir(efeito.mensagens_pendentes === 0, `a regua deveria estar calada, ha ${efeito.mensagens_pendentes} mensagem(ns) pendente(s)`);
  }
  if (roteiro === "desconhecido") {
    exigir(efeito.webhook_processado === false, "webhook NAO deveria estar carimbado como processado (D8)");
    exigir(efeito.webhook_erro === "produto_nao_mapeado", `erro deveria ser 'produto_nao_mapeado', veio '${efeito.webhook_erro}'`);
    exigir(efeito.pendencia_tipo === "produto_nao_mapeado", `pendencia deveria ter tipo 'produto_nao_mapeado', veio '${efeito.pendencia_tipo}'`);
  }

  return { ok: motivos.length === 0, motivos };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  carregarEnvLocal();

  const segredo = process.env.HOTMART_WEBHOOK_SECRET ?? "";
  if (!segredo) {
    throw new Error(
      "HOTMART_WEBHOOK_SECRET vazio. Suba o dev server e rode este script com o MESMO valor:\n" +
        "  HOTMART_WEBHOOK_SECRET=hottok-local-de-teste npx next dev\n" +
        "  HOTMART_WEBHOOK_SECRET=hottok-local-de-teste npx tsx scripts/simular-hotmart.ts --roteiro=todos",
    );
  }

  const base = exigirHostLocal(argumento("base") ?? process.env.BASE_URL ?? "http://localhost:3000");
  const pedido = argumento("roteiro") ?? "todos";
  const roteiros: Roteiro[] = pedido === "todos" ? [...ROTEIROS] : [pedido as Roteiro];
  for (const r of roteiros) {
    if (!ROTEIROS.includes(r)) throw new Error(`roteiro desconhecido: ${r}. Use ${ROTEIROS.join(" | ")} | todos`);
  }

  const apelido = argumento("produto") ?? "sv";
  const tipoProduto = TIPO_POR_APELIDO[apelido];
  if (!tipoProduto) throw new Error(`produto desconhecido: ${apelido}. Use sv | croqui | holding`);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) throw new Error("NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorios para conferir o efeito.");
  const db = createClient(url, chave, { auth: { persistSession: false } });

  console.log(`alvo: ${base.origin} · produto: ${tipoProduto} · roteiros: ${roteiros.join(", ")}`);

  // Mapeamento temporário do produto (os três estão com `hotmart_produto_id`
  // NULL em produção — B7). Devolvido ao original no `finally`, sempre.
  const { data: produto } = await db
    .from("produtos")
    .select("id, nome, hotmart_produto_id")
    .eq("tipo", tipoProduto)
    .order("criado_em")
    .limit(1)
    .maybeSingle<{ id: string; nome: string; hotmart_produto_id: string | null }>();
  if (!produto) throw new Error(`nenhum produto do tipo ${tipoProduto} cadastrado`);

  const idOriginal = produto.hotmart_produto_id;
  const idSimulado = idOriginal ?? `SIM-PROD-${tipoProduto}`;
  let falhou = false;

  try {
    if (idOriginal === null) {
      await db.from("produtos").update({ hotmart_produto_id: idSimulado }).eq("id", produto.id);
      console.log(`produto "${produto.nome}" mapeado TEMPORARIAMENTE para ${idSimulado} (sera devolvido a null no fim)`);
    }

    for (const roteiro of roteiros) {
      const tag = `SIM-${roteiro}-${Date.now().toString(36)}`;
      const fixture: Fixture = {
        tag,
        email: `simulacao.${tag.toLowerCase()}@example.com`,
        nome: `Simulação ${roteiro}`,
        telefone: `+5511${Math.floor(100_000_000 + Math.random() * 899_999_999)}`,
        transacao: `${tag}-TX`,
      };

      console.log(`\n=== roteiro ${roteiro} ===`);
      let ultimoEventoId = "";
      try {
        let i = 0;
        for (const passo of PASSOS[roteiro]) {
          i += 1;
          ultimoEventoId = `${tag}-${i}`;
          const corpo = montarPayload({
            evento: passo.evento,
            eventoId: ultimoEventoId,
            fixture,
            produtoHotmartId: passo.produtoHotmartId ?? idSimulado,
            statusNoPayload: passo.statusNoPayload,
            quando: new Date(Date.now() - passo.minutosAtras * 60_000),
            valor: 1997,
          });
          const resposta = await postar(base, segredo, corpo);
          console.log(
            `  ${passo.evento} (payload dizia status=${passo.statusNoPayload}) -> HTTP ${resposta.status} ${JSON.stringify(resposta.corpo)}`,
          );
        }

        const efeito = await lerEfeito(db, fixture, ultimoEventoId);
        console.log(`  efeito: ${JSON.stringify(efeito)}`);
        const veredito = conferir(roteiro, efeito, ETAPA_ALVO[tipoProduto]);
        if (veredito.ok) {
          console.log(`  OK`);
        } else {
          falhou = true;
          for (const motivo of veredito.motivos) console.log(`  FALHOU: ${motivo}`);
        }
      } finally {
        if (!bandeira("manter")) {
          console.log(`  limpeza: ${await limpar(db, fixture)}`);
        } else {
          console.log(`  --manter: fixture ${fixture.transacao} preservada`);
        }
      }
    }
  } finally {
    if (idOriginal === null) {
      await db.from("produtos").update({ hotmart_produto_id: null }).eq("id", produto.id);
      console.log(`\nproduto "${produto.nome}" devolvido a hotmart_produto_id = null`);
    }
  }

  if (falhou) {
    console.error("\nRESULTADO: pelo menos um roteiro falhou.");
    process.exit(1);
  }
  console.log("\nRESULTADO: todos os roteiros passaram.");
}

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
