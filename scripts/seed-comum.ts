/**
 * scripts/seed-comum.ts
 *
 * O encanamento que `seed-exemplo-completo.ts` (a jornada do João) e
 * `seed-demo.ts` (as 4 famílias de demonstração) usam igual: ambiente,
 * cliente `service_role`, os quatro verbos idempotentes de escrita e a
 * demolição de uma jornada/pessoa na ordem que as FKs permitem.
 *
 * Existe para não haver DUAS cópias da ordem de DELETE. A ordem de
 * `apagarJornadas` é conhecimento caro (nem toda FK para `jornadas` é
 * `on delete cascade`; `familiares.registrado_na_jornada_id` é RESTRICT e
 * `transcricoes`/`documentos` de cliente REAL só podem ser DESVINCULADAS,
 * nunca apagadas). Duplicá-la seria garantir que uma das cópias envelhece
 * errado — e a que envelhece apaga dado de gente de verdade.
 *
 * Nada aqui conhece persona: nem nome, nem e-mail, nem etapa. Quem tem
 * conteúdo é quem importa este arquivo.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const RAIZ = path.resolve(__dirname, "..");

export function carregarEnvLocal(): void {
  const arquivo = path.resolve(RAIZ, ".env.local");
  if (!fs.existsSync(arquivo)) return;
  for (const linha of fs.readFileSync(arquivo, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(linha);
    if (!m) continue;
    const [, nome, bruto] = m;
    if (process.env[nome] !== undefined && process.env[nome] !== "") continue;
    const valor = bruto.replace(/^["']|["']$/g, "");
    if (valor !== "") process.env[nome] = valor;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cliente sem generic Database, como em src/lib/supabase/admin.ts
export type Cliente = SupabaseClient<any, any, any>;

export function clienteAdmin(): Cliente {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) {
    console.error(
      [
        "",
        "SUPABASE_SERVICE_ROLE_KEY ausente (ou vazia) em .env.local — nada foi escrito.",
        "",
        "Este script precisa dela porque, desde as migrations 0065b/0065c/0069/0070:",
        "  · registrar_croqui_calculo / fixar_croqui_calculo / registrar_croqui_narrativa",
        "    têm EXECUTE só para service_role;",
        "  · pagamentos, webhooks_eventos, execucoes_ia e materiais_gerados não aceitam",
        "    INSERT de `authenticated`;",
        "  · DELETE foi revogado de `authenticated` em todas as tabelas — sem a chave",
        "    o --limpar não conseguiria apagar nada do que criasse.",
        "",
        "Pegue em: Supabase → Settings → API → service_role, e ponha em .env.local.",
        "",
      ].join("\n"),
    );
    process.exit(2);
  }
  return createClient(url, chave, { auth: { autoRefreshToken: false, persistSession: false } });
}

// ---------------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------------

export const DIA = 24 * 60 * 60 * 1000;
const ONTEM = new Date(new Date().setHours(12, 0, 0, 0) - DIA);
/** `d` dias ANTES de ontem, ao meio-dia (evita virada de fuso na tela). */
export const quando = (d: number, hora = 12): string =>
  new Date(new Date(ONTEM.getTime() - d * DIA).setHours(hora, 0, 0, 0)).toISOString();

// ---------------------------------------------------------------------------
// Identidade determinística
// ---------------------------------------------------------------------------

/**
 * UUID estável a partir de (marca, chave). É o que torna todo seed
 * re-executável — e o que permite `--limpar` recalcular exatamente os mesmos
 * ids sem depender de um manifesto em disco que pode ter sumido.
 */
export function uidDe(marca: string, chave: string): string {
  const h = crypto.createHash("md5").update(`${marca}:${chave}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// ---------------------------------------------------------------------------
// Helpers de escrita
// ---------------------------------------------------------------------------

export class ErroSeed extends Error {}

/** Insere e devolve a linha; erro do banco vira exceção com contexto legível. */
export async function inserir<T>(db: Cliente, tabela: string, linha: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.from(tabela).insert(linha).select("*").single();
  if (error) throw new ErroSeed(`insert ${tabela}: ${error.code ?? ""} ${error.message}`);
  return data as T;
}

export async function atualizar(
  db: Cliente,
  tabela: string,
  filtro: Record<string, unknown>,
  campos: Record<string, unknown>,
): Promise<void> {
  let q = db.from(tabela).update(campos);
  for (const [k, v] of Object.entries(filtro)) q = q.eq(k, v);
  const { error } = await q;
  if (error) throw new ErroSeed(`update ${tabela}: ${error.code ?? ""} ${error.message}`);
}

/** Acha por chave natural ou cria. É o que faz rodar 2× não duplicar. */
export async function acharOuCriar<T extends { id: string }>(
  db: Cliente,
  tabela: string,
  chave: Record<string, unknown>,
  novo: Record<string, unknown>,
): Promise<{ linha: T; criou: boolean }> {
  let q = db.from(tabela).select("*");
  for (const [k, v] of Object.entries(chave)) q = q.eq(k, v);
  const { data, error } = await q.maybeSingle();
  if (error) throw new ErroSeed(`select ${tabela}: ${error.code ?? ""} ${error.message}`);
  if (data) return { linha: data as T, criou: false };
  return { linha: await inserir<T>(db, tabela, { ...chave, ...novo }), criou: true };
}

export async function apagar(db: Cliente, tabela: string, filtro: Record<string, unknown>): Promise<number> {
  let q = db.from(tabela).delete();
  for (const [k, v] of Object.entries(filtro)) {
    if (Array.isArray(v)) {
      if (v.length === 0) return 0;
      q = q.in(k, v);
    } else {
      q = q.eq(k, v);
    }
  }
  const { data, error } = await q.select("*");
  // Tabela que não existe naquele banco não é falha do seed — só não há o que apagar.
  if (error && error.code === "PGRST205") return 0;
  if (error) throw new ErroSeed(`delete ${tabela}: ${error.code ?? ""} ${error.message}`);
  return (data as unknown[] | null)?.length ?? 0;
}

/**
 * Solta a referência em vez de apagar a linha. Existe porque nem toda FK para
 * `jornadas` é `on delete cascade`: `transcricoes` (0032), `importacao_linhas`
 * (0035, RESTRICT), `documentos` (0012) e o `registrado_na_jornada_id` de
 * `familiares`/`patrimonio_itens` (0007) apontam para a jornada sem cascata.
 * Apagar a transcrição de um cliente REAL porque ela encostou numa jornada de
 * exemplo seria perda de dado; desvincular resolve a FK sem destruir nada.
 */
export async function desvincular(db: Cliente, tabela: string, coluna: string, valores: string[]): Promise<number> {
  if (valores.length === 0) return 0;
  const { data, error } = await db.from(tabela).update({ [coluna]: null }).in(coluna, valores).select(coluna);
  if (error && error.code === "PGRST205") return 0;
  if (error) throw new ErroSeed(`desvincular ${tabela}.${coluna}: ${error.code ?? ""} ${error.message}`);
  return (data as unknown[] | null)?.length ?? 0;
}

/**
 * Cancela AGORA a fila da régua de uma jornada de exemplo.
 *
 * Os gatilhos de régua enfileiram mensagem DE VERDADE dentro da transação que
 * o seed dispara: `app.regua_boas_vindas` (0011:104) com `agendada_para =
 * now()`; `app.regua_agendamento` (0051:753) com `inicio_em - 10 min`; e
 * `app.regua_pos_sessao` (0020:65) com `realizada_em + 2h`. Como as famílias de
 * demonstração vivem no PASSADO, as três nascem VENCIDAS — e o cron da
 * Hostinger (`POST /api/cron/regua`, a cada 5 min) reivindica tudo que está
 * `pendente` e vencido. Cada segundo entre o gatilho e este cancelamento é uma
 * janela real de e-mail saindo para `@exemplo.com.br` (bounce na reputação do
 * domínio do Resend) — por isso a chamada fica colada no fato que enfileira,
 * nunca só na varredura do fim (achado M1 do pentest, 06/09).
 *
 * `falhou` entra no filtro: sem chave de envio configurada o cron marca a
 * mensagem como `falhou` em vez de `pendente`, e um filtro só-`pendente` a
 * deixaria como lixo permanente na tela de Pendências.
 */
export async function cancelarMensagensDaJornada(
  db: Cliente,
  jornadaIds: string[],
  opcoes: { agendadaPara?: string; erro?: string } = {},
): Promise<number> {
  if (jornadaIds.length === 0) return 0;
  const campos: Record<string, unknown> = {
    status: "cancelada",
    erro: opcoes.erro ?? "demonstração: destinatário fictício, cancelada pelo seed",
  };
  if (opcoes.agendadaPara) campos.agendada_para = opcoes.agendadaPara;
  const { data, error } = await db
    .from("mensagens_agendadas")
    .update(campos)
    .in("jornada_id", jornadaIds)
    .in("status", ["pendente", "falhou"])
    .select("id");
  if (error) throw new ErroSeed(`cancelar mensagens: ${error.code ?? ""} ${error.message}`);
  return (data as unknown[] | null)?.length ?? 0;
}

export async function contar(db: Cliente, tabela: string, filtro: Record<string, unknown>): Promise<number> {
  let q = db.from(tabela).select("*", { count: "exact", head: true });
  for (const [k, v] of Object.entries(filtro)) {
    if (Array.isArray(v)) {
      if (v.length === 0) return 0;
      q = q.in(k, v);
    } else {
      q = q.eq(k, v);
    }
  }
  const { count, error } = await q;
  if (error && error.code === "PGRST205") return 0;
  if (error) throw new ErroSeed(`count ${tabela}: ${error.code ?? ""} ${error.message}`);
  return count ?? 0;
}

export async function ids(
  db: Cliente,
  tabela: string,
  coluna: string,
  filtro: Record<string, unknown>,
): Promise<string[]> {
  let q = db.from(tabela).select(coluna);
  for (const [k, v] of Object.entries(filtro)) {
    if (Array.isArray(v)) {
      if (v.length === 0) return [];
      q = q.in(k, v);
    } else {
      q = q.eq(k, v);
    }
  }
  const { data, error } = await q;
  if (error) throw new ErroSeed(`select ${tabela}.${coluna}: ${error.code ?? ""} ${error.message}`);
  return ((data as unknown as Array<Record<string, string>> | null) ?? []).map((l) => l[coluna]).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Autor e catálogo
// ---------------------------------------------------------------------------

export async function perfilAutor(db: Cliente): Promise<string> {
  const { data, error } = await db
    .from("perfis_equipe")
    .select("id, papel, nome")
    .in("papel", ["advogada", "admin"])
    .eq("ativo", true)
    .order("papel", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new ErroSeed(`perfis_equipe: ${error.message}`);
  if (!data) throw new ErroSeed("Nenhum perfil admin/advogada ATIVO em perfis_equipe — o mock não inventa autor.");
  return (data as { id: string }).id;
}

export async function produtoPorTipo(db: Cliente, tipo: string): Promise<string> {
  const { data, error } = await db.from("produtos").select("id").eq("tipo", tipo).limit(1).maybeSingle();
  if (error) throw new ErroSeed(`produtos: ${error.message}`);
  if (!data) throw new ErroSeed(`Produto '${tipo}' não existe em produtos — cadastre antes.`);
  return (data as { id: string }).id;
}

// ---------------------------------------------------------------------------
// Demolição
// ---------------------------------------------------------------------------

/**
 * TRAVA de `--limpar`: nenhum DELETE por id sem reafirmar `origem_dado`.
 *
 * Os dois seeds apagam por id determinístico (`uidDe`), não por filtro de
 * `origem_dado`. Colisão de md5 com uma linha real é desprezível, mas este é o
 * único DELETE em PRODUÇÃO que confia só na aritmética do id — e um id trocado
 * à mão, um `MARCA_*` renomeado ou um copia-e-cola de manifesto apagariam
 * cliente de verdade em silêncio. A conferência custa uma consulta e é feita
 * ANTES do primeiro DELETE: ou tudo é `exemplo`, ou nada é apagado
 * (achado B2 do pentest, 06/09).
 *
 * Id que não existe no banco não é erro — não há o que apagar.
 */
export async function conferirSoExemplo(db: Cliente, tabela: string, alvo: string[]): Promise<void> {
  if (alvo.length === 0) return;
  const { data, error } = await db.from(tabela).select("id, origem_dado").in("id", alvo);
  if (error) throw new ErroSeed(`conferir ${tabela}: ${error.code ?? ""} ${error.message}`);
  const linhas = (data as Array<{ id: string; origem_dado: string | null }> | null) ?? [];
  const intrusas = linhas.filter((l) => l.origem_dado !== "exemplo");
  if (intrusas.length > 0) {
    throw new ErroSeed(
      `RECUSADO: ${intrusas.length} linha(s) de ${tabela} não são origem_dado='exemplo' — NADA foi apagado. ` +
        intrusas.map((l) => `${l.id} (origem_dado=${l.origem_dado ?? "null"})`).join(", "),
    );
  }
}

/**
 * Mesma trava para jornadas, com a exceção que o banco impõe:
 * `processar_pagamento_hotmart` (0011:190) abre jornada com o DEFAULT da
 * coluna (`origem_dado='real'`) quando não acha uma aberta. Essa jornada
 * fantasma pendura numa pessoa de exemplo e é lixo do próprio seed — apagá-la
 * é correto. Qualquer outra jornada fora de `exemplo` aborta tudo.
 */
async function conferirJornadasApagaveis(db: Cliente, jornadaIds: string[]): Promise<void> {
  if (jornadaIds.length === 0) return;
  const { data, error } = await db.from("jornadas").select("id, origem_dado, pessoa_id").in("id", jornadaIds);
  if (error) throw new ErroSeed(`conferir jornadas: ${error.code ?? ""} ${error.message}`);
  const linhas = (data as Array<{ id: string; origem_dado: string | null; pessoa_id: string | null }> | null) ?? [];
  const suspeitas = linhas.filter((l) => l.origem_dado !== "exemplo");
  if (suspeitas.length === 0) return;

  const donos = [...new Set(suspeitas.map((l) => l.pessoa_id).filter((p): p is string => Boolean(p)))];
  const { data: pessoas, error: erroPessoas } = donos.length
    ? await db.from("pessoas").select("id, origem_dado").in("id", donos)
    : { data: [], error: null };
  if (erroPessoas) throw new ErroSeed(`conferir pessoas donas: ${erroPessoas.code ?? ""} ${erroPessoas.message}`);
  const deExemplo = new Set(
    ((pessoas as Array<{ id: string; origem_dado: string | null }> | null) ?? [])
      .filter((p) => p.origem_dado === "exemplo")
      .map((p) => p.id),
  );
  const proibidas = suspeitas.filter((l) => !l.pessoa_id || !deExemplo.has(l.pessoa_id));
  if (proibidas.length > 0) {
    throw new ErroSeed(
      `RECUSADO: ${proibidas.length} jornada(s) não são de exemplo nem pertencem a pessoa de exemplo — NADA foi apagado. ` +
        proibidas.map((l) => `${l.id} (origem_dado=${l.origem_dado ?? "null"}, pessoa=${l.pessoa_id ?? "null"})`).join(", "),
    );
  }
}

/** Tudo que pende de uma lista de jornadas, na ordem em que as FKs permitem. */
export async function apagarJornadas(db: Cliente, jornadaIds: string[]): Promise<Record<string, number>> {
  const conta: Record<string, number> = {};
  const soma = (t: string, n: number) => {
    if (n > 0) conta[t] = (conta[t] ?? 0) + n;
  };
  if (jornadaIds.length === 0) return conta;
  await conferirJornadasApagaveis(db, jornadaIds);

  const croquiIds = await ids(db, "croquis", "id", { jornada_id: jornadaIds });
  const sessaoIds = await ids(db, "sessoes_viabilidade", "id", { jornada_id: jornadaIds });
  const agendamentoIds = sessaoIds.length ? await ids(db, "agendamentos", "id", { sessao_id: sessaoIds }) : [];
  const linkIds = await ids(db, "links_publicos", "id", { jornada_id: jornadaIds });
  const cenarioIds = await ids(db, "cenarios_patrimoniais", "id", { jornada_id: jornadaIds });

  soma("croqui_narrativas", croquiIds.length ? await apagar(db, "croqui_narrativas", { croqui_id: croquiIds }) : 0);
  soma("croqui_apresentacoes", croquiIds.length ? await apagar(db, "croqui_apresentacoes", { croqui_id: croquiIds }) : 0);
  soma("croqui_analises", croquiIds.length ? await apagar(db, "croqui_analises", { croqui_id: croquiIds }) : 0);
  soma("croqui_calculos", await apagar(db, "croqui_calculos", { jornada_id: jornadaIds }));
  soma("croquis", await apagar(db, "croquis", { jornada_id: jornadaIds }));
  soma("diagnosticos_sv", await apagar(db, "diagnosticos_sv", { jornada_id: jornadaIds }));
  soma("cenario_rubricas", cenarioIds.length ? await apagar(db, "cenario_rubricas", { cenario_id: cenarioIds }) : 0);
  soma("cenarios_patrimoniais", await apagar(db, "cenarios_patrimoniais", { jornada_id: jornadaIds }));
  soma("execucao_jornada_marcos", await apagar(db, "execucao_jornada_marcos", { jornada_id: jornadaIds }));
  soma("materiais_gerados", await apagar(db, "materiais_gerados", { jornada_id: jornadaIds }));
  soma("documentos_pedidos", await apagar(db, "documentos_pedidos", { jornada_id: jornadaIds }));
  soma("mensagens_agendadas", await apagar(db, "mensagens_agendadas", { jornada_id: jornadaIds }));
  soma("links_publicos_acessos", linkIds.length ? await apagar(db, "links_publicos_acessos", { link_id: linkIds }) : 0);
  soma("agendamentos_sugestoes", linkIds.length ? await apagar(db, "agendamentos_sugestoes", { link_id: linkIds }) : 0);
  soma("ligacoes_ia", await apagar(db, "ligacoes_ia", { jornada_id: jornadaIds }));
  soma("links_publicos", await apagar(db, "links_publicos", { jornada_id: jornadaIds }));
  soma("relatorios_sessao", sessaoIds.length ? await apagar(db, "relatorios_sessao", { sessao_id: sessaoIds }) : 0);
  soma("agendamentos", agendamentoIds.length ? await apagar(db, "agendamentos", { id: agendamentoIds }) : 0);
  soma("sessoes_viabilidade", await apagar(db, "sessoes_viabilidade", { jornada_id: jornadaIds }));
  soma("ligacoes_estrategicas", await apagar(db, "ligacoes_estrategicas", { jornada_id: jornadaIds }));
  soma("formularios_respostas", await apagar(db, "formularios_respostas", { jornada_id: jornadaIds }));
  soma("tarefas", await apagar(db, "tarefas", { jornada_id: jornadaIds }));
  soma("ofertas", await apagar(db, "ofertas", { jornada_id: jornadaIds }));
  soma("pagamentos", await apagar(db, "pagamentos", { jornada_id: jornadaIds }));
  soma("briefings", await apagar(db, "briefings", { jornada_id: jornadaIds }));
  soma("execucoes_ia", await apagar(db, "execucoes_ia", { jornada_id: jornadaIds }));
  soma("eventos_timeline", await apagar(db, "eventos_timeline", { jornada_id: jornadaIds }));
  soma("jornadas_transicoes", await apagar(db, "jornadas_transicoes", { jornada_id: jornadaIds }));

  // As FKs sem cascata: soltar a referência antes de apagar a jornada.
  for (const [tabela, coluna] of [
    ["transcricoes", "jornada_id"],
    ["importacao_linhas", "jornada_id"],
    ["mensagens_recebidas", "jornada_id"],
    ["documentos", "jornada_id"],
    ["familiares", "registrado_na_jornada_id"],
    ["patrimonio_itens", "registrado_na_jornada_id"],
  ] as const) {
    const n = await desvincular(db, tabela, coluna, jornadaIds);
    if (n > 0) conta[`${tabela} (desvinculadas)`] = (conta[`${tabela} (desvinculadas)`] ?? 0) + n;
  }

  soma("jornadas", await apagar(db, "jornadas", { id: jornadaIds }));
  return conta;
}

export async function apagarPessoas(db: Cliente, pessoaIds: string[]): Promise<Record<string, number>> {
  const conta: Record<string, number> = {};
  if (pessoaIds.length === 0) return conta;
  await conferirSoExemplo(db, "pessoas", pessoaIds);
  const jornadaIds = await ids(db, "jornadas", "id", { pessoa_id: pessoaIds });
  Object.assign(conta, await apagarJornadas(db, jornadaIds));
  for (const tabela of [
    "respostas_seminario",
    "consentimentos",
    "familiares",
    "patrimonio_itens",
    "participacoes_seminario",
    "documentos",
  ]) {
    const n = await apagar(db, tabela, { pessoa_id: pessoaIds });
    if (n > 0) conta[tabela] = (conta[tabela] ?? 0) + n;
  }
  const n = await apagar(db, "pessoas", { id: pessoaIds });
  if (n > 0) conta.pessoas = n;
  return conta;
}
