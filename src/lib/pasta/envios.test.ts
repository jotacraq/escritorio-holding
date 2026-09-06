/**
 * Barra "Enviar" (`src/lib/pasta/envios.ts`, `docs/ARQUITETURA-FASE-6.md`
 * §5.2 e §5.4): os 6 motivos da tabela do §5.2, os 6 estados de linha do §5.4
 * e as duas invariantes que a tela depende — os 5 tipos aparecem SEMPRE, e
 * emitir sobre link ativo pede confirmação.
 *
 * Convertido de `scripts/teste-envios.ts` (Fase 7 · rodada 2) — mesmos casos,
 * mesmos números, agora sob `npm test` / CI.
 *
 * `derivarEnvios` é PURA: nenhum banco, nenhuma env, `agora` injetado.
 */
import { describe, expect, it } from "vitest";

import { derivarEnvios, MOTIVO_ENVIO, TIPOS_ENVIO, type ItemEnvio, type TipoEnvio } from "@/lib/pasta/envios";
import type { Ficha360 } from "@/lib/api";
import type { LinkPublicoResumo } from "@/types/publico";

const AGORA = Date.parse("2026-09-05T12:00:00Z");
const EM_7_DIAS = new Date(AGORA + 7 * 24 * 60 * 60 * 1000).toISOString();
const HA_2_DIAS = new Date(AGORA - 2 * 24 * 60 * 60 * 1000).toISOString();
const HA_10_DIAS = new Date(AGORA - 10 * 24 * 60 * 60 * 1000).toISOString();

// ---------------------------------------------------------------------------
// Harness — cada `conferir` do script original vira um `it` do vitest.
//
// As condições são avaliadas na COLETA (código puro, síncrono) e asseguradas
// dentro do `it`: o placar por caso é o mesmo do script, mas quem reporta é
// o vitest — e o CI reprova o PR.
// ---------------------------------------------------------------------------
interface Caso {
  secao: string;
  nome: string;
  ok: boolean;
  detalhe: string;
}

const casos: Caso[] = [];
let secaoAtual = "geral";

function secao(nome: string): void {
  secaoAtual = nome;
}

function conferir(nome: string, ok: boolean, detalhe: string): void {
  casos.push({ secao: secaoAtual, nome, ok, detalhe });
}

function publicar(): void {
  for (const nome of [...new Set(casos.map((c) => c.secao))]) {
    describe(nome, () => {
      for (const caso of casos.filter((c) => c.secao === nome)) {
        it(caso.nome, () => {
          expect(caso.ok, caso.detalhe || caso.nome).toBe(true);
        });
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Fixtures — nenhum dado de cliente, nenhum token
// ---------------------------------------------------------------------------

let seq = 0;
function link(tipo: string, campos: Partial<LinkPublicoResumo> = {}): LinkPublicoResumo {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    tipo: tipo as LinkPublicoResumo["tipo"],
    estado: "ativo",
    token_prefixo: "abc123",
    expira_em: EM_7_DIAS,
    usos: 0,
    criado_em: HA_2_DIAS,
    revogado_em: null,
    ...campos,
  };
}

interface Cenario {
  desfecho?: "aberta" | "ganha" | "perdida";
  advogadaId?: string | null;
  /** `null` = jornada sem sessão nenhuma. */
  temSessao?: boolean;
  statusAgendamento?: string | null;
  materialAprovadoEm?: string | null;
  /** `true` = existe material atual; `false` = nenhum material gerado. */
  temMaterial?: boolean;
}

function ficha(c: Cenario = {}): Ficha360 {
  const temSessao = c.temSessao ?? true;
  return {
    jornada: { etapa: "sessao_agendada", nivel_pago: 1, desfecho: c.desfecho ?? "aberta" },
    pessoa: { id: "p1", nome_completo: "Exemplo" },
    formulario: null,
    ligacao: null,
    briefingAtual: null,
    sessao: temSessao ? { id: "s1", advogada_id: c.advogadaId === undefined ? "adv-1" : c.advogadaId } : null,
    relatorio: null,
    agendamentos: c.statusAgendamento
      ? [{ id: "ag-1", sessao_id: "s1", inicio_em: EM_7_DIAS, fim_em: EM_7_DIAS, status: c.statusAgendamento }]
      : [],
    documentos: [],
    timeline: [],
    patrimonio: null,
    familiares: null,
    materialAtual: (c.temMaterial ?? false)
      ? { id: "m1", versao: 1, atual: true, aprovado_em: c.materialAprovadoEm ?? null }
      : null,
    diagnosticoAtual: null,
    cenarios: null,
    ligacaoIaAtual: null,
    tarefasAbertas: [],
  } as unknown as Ficha360;
}

function item(itens: ItemEnvio[], tipo: TipoEnvio): ItemEnvio {
  const i = itens.find((x) => x.tipo === tipo);
  if (!i) throw new Error(`tipo ausente na barra: ${tipo}`);
  return i;
}

const mapa = (itens: ItemEnvio[]) =>
  itens.map((i) => `${i.tipo}=${i.estado}${i.podeEmitir ? "" : "(travado)"}`).join(" ");

// ---------------------------------------------------------------------------
// Invariantes da barra
// ---------------------------------------------------------------------------
secao("BARRA ENVIAR — invariantes (§5.4)");


{
  const itens = derivarEnvios([], ficha({ temSessao: false }), AGORA);
  conferir("os 5 tipos aparecem sempre, na ordem", itens.map((i) => i.tipo).join(",") === TIPOS_ENVIO.join(","), mapa(itens));
  // Jornada crua (sem sessão, sem agendamento): o que pode ser emitido está
  // "não emitido"; só a confirmação já nasce travada — e com o motivo escrito,
  // que é exatamente o que o João pediu para ver em vez de um botão morto.
  conferir(
    "sem link nenhum, o que dá para emitir fica 'nao_emitido'",
    itens.filter((i) => i.tipo !== "confirmacao").every((i) => i.estado === "nao_emitido"),
    mapa(itens),
  );
  conferir(
    "a confirmação nasce travada com motivo (nunca botão mudo)",
    item(itens, "confirmacao").estado === "indisponivel" && Boolean(item(itens, "confirmacao").motivo),
    mapa(itens),
  );
  conferir("e ninguém 'substitui ativo'", itens.every((i) => !i.substituiAtivo), mapa(itens));
}

// ---------------------------------------------------------------------------
// Os 6 motivos da tabela do §5.2 — um a um, com a fonte no comentário
// ---------------------------------------------------------------------------

secao("BARRA ENVIAR — os 6 motivos do §5.2");


// 1 · Jornada encerrada trava TODOS os tipos (0028:816-818).
{
  const itens = derivarEnvios([link("formulario")], ficha({ desfecho: "perdida", statusAgendamento: "agendado" }), AGORA);
  conferir(
    "1 · jornada encerrada trava os 5 tipos",
    itens.every((i) => i.podeEmitir === false && i.estado === "indisponivel"),
    mapa(itens),
  );
  conferir(
    "1 · com a frase do §5.2",
    itens.every((i) => i.motivo === MOTIVO_ENVIO.jornada_encerrada),
    JSON.stringify(itens.map((i) => i.motivo)),
  );
  conferir("1 · e nada 'substitui ativo' (não há o que emitir)", itens.every((i) => !i.substituiAtivo), mapa(itens));
}

// 2 · Agendamento sem advogada: EMITE com aviso, não bloqueia (links/route.ts:115-119).
{
  const itens = derivarEnvios([], ficha({ advogadaId: null }), AGORA);
  const ag = item(itens, "agendamento");
  conferir("2 · agendamento sem advogada avisa", ag.motivo === MOTIVO_ENVIO.agendamento_sem_advogada, String(ag.motivo));
  conferir("2 · e continua emitindo (não vira bloqueio)", ag.podeEmitir === true, mapa(itens));
  conferir("2 · o aviso não vaza para os outros tipos", item(itens, "formulario").motivo === null, mapa(itens));
}

// 3 · 503 de service_role: não é derivável — vem do SERVIDOR (links/route.ts:126-139).
{
  const semOpcao = derivarEnvios([], ficha({ advogadaId: "adv-1" }), AGORA);
  conferir(
    "3 · sem resposta do servidor a barra NÃO inventa o 503",
    item(semOpcao, "agendamento").motivo === null,
    String(item(semOpcao, "agendamento").motivo),
  );

  const doServidor =
    "Link de agendamento exige SUPABASE_SERVICE_ROLE_KEY para gerar os horários ofertados — indisponível agora.";
  const itens = derivarEnvios([], ficha({ advogadaId: "adv-1" }), AGORA, {
    motivoDoServidor: { agendamento: doServidor },
  });
  const ag = item(itens, "agendamento");
  conferir("3 · com a resposta do servidor, a linha fica indisponível", ag.estado === "indisponivel" && !ag.podeEmitir, mapa(itens));
  conferir("3 · e a frase é a DELE, palavra por palavra", ag.motivo === doServidor, String(ag.motivo));
  conferir("3 · sem contaminar as outras linhas", item(itens, "documentos").podeEmitir === true, mapa(itens));
}

// 4 · Confirmação exige agendamento ativo (ck_link_confirmacao_agendamento, 0051:285-286).
{
  const semAg = derivarEnvios([], ficha({ statusAgendamento: null }), AGORA);
  const c1 = item(semAg, "confirmacao");
  conferir("4 · sem agendamento, confirmação trava", c1.estado === "indisponivel" && !c1.podeEmitir, mapa(semAg));
  conferir("4 · com a frase do §5.2", c1.motivo === MOTIVO_ENVIO.confirmacao_sem_agendamento, String(c1.motivo));

  const comAg = derivarEnvios([], ficha({ statusAgendamento: "agendado" }), AGORA);
  conferir("4 · com agendamento 'agendado', destrava", item(comAg, "confirmacao").podeEmitir === true, mapa(comAg));

  const confirmado = derivarEnvios([], ficha({ statusAgendamento: "confirmado" }), AGORA);
  conferir("4 · 'confirmado' também vale (0051:498)", item(confirmado, "confirmacao").podeEmitir === true, mapa(confirmado));

  // Cancelado/remarcado NÃO valem — e é o mesmo filtro que revoga o link (0051:193-204).
  const cancelado = derivarEnvios([], ficha({ statusAgendamento: "cancelado" }), AGORA);
  conferir(
    "4 · agendamento cancelado não serve para confirmar",
    item(cancelado, "confirmacao").podeEmitir === false,
    mapa(cancelado),
  );
}

// 5 · Material inexistente: avisa o que o cliente veria, e mantém a ação.
{
  const itens = derivarEnvios([], ficha({ temMaterial: false }), AGORA);
  const m = item(itens, "material");
  conferir("5 · material inexistente avisa", m.motivo === MOTIVO_ENVIO.material_inexistente, String(m.motivo));
  conferir("5 · e a ação continua existindo (§5.2)", m.podeEmitir === true, mapa(itens));
}

// 6 · Material sem aprovação (0031:313-318 na via de sistema).
{
  const itens = derivarEnvios([], ficha({ temMaterial: true, materialAprovadoEm: null }), AGORA);
  const m = item(itens, "material");
  conferir("6 · material não aprovado avisa", m.motivo === MOTIVO_ENVIO.material_nao_aprovado, String(m.motivo));
  conferir("6 · e a ação continua existindo", m.podeEmitir === true, mapa(itens));

  const aprovado = derivarEnvios([], ficha({ temMaterial: true, materialAprovadoEm: HA_10_DIAS }), AGORA);
  conferir("6 · material aprovado não tem motivo nenhum", item(aprovado, "material").motivo === null, mapa(aprovado));
}

// ---------------------------------------------------------------------------
// Os estados de linha do §5.4
// ---------------------------------------------------------------------------

secao("BARRA ENVIAR — estados de linha (§5.4)");


{
  const itens = derivarEnvios(
    [
      link("formulario", { estado: "ativo", expira_em: EM_7_DIAS, usos: 0 }),
      link("agendamento", { estado: "usado", usos: 1 }),
      link("documentos", { estado: "revogado", revogado_em: HA_2_DIAS }),
      link("material", { estado: "expirado" }),
    ],
    ficha({ temMaterial: true, materialAprovadoEm: HA_10_DIAS, statusAgendamento: "agendado" }),
    AGORA,
  );
  conferir("ativo → 'ativo'", item(itens, "formulario").estado === "ativo", mapa(itens));
  conferir("usado → 'consumido'", item(itens, "agendamento").estado === "consumido", mapa(itens));
  conferir("revogado → 'revogado'", item(itens, "documentos").estado === "revogado", mapa(itens));
  conferir("expirado → 'expirado'", item(itens, "material").estado === "expirado", mapa(itens));
  conferir("confirmação sem link fica 'nao_emitido'", item(itens, "confirmacao").estado === "nao_emitido", mapa(itens));

  // §5.4: 1 clique quando não há ativo; confirmação de 1 linha quando há.
  conferir("só o ativo pede confirmação para substituir", item(itens, "formulario").substituiAtivo === true, mapa(itens));
  conferir("consumido não pede confirmação", item(itens, "agendamento").substituiAtivo === false, mapa(itens));
  conferir("revogado não pede confirmação", item(itens, "documentos").substituiAtivo === false, mapa(itens));
}

// Link vencido pela DATA continua 'ativo' no banco até alguém abrir — a barra
// não pode chamar de "Ativo" um link que o cliente não consegue mais usar.
{
  const itens = derivarEnvios(
    [link("formulario", { estado: "ativo", expira_em: HA_2_DIAS })],
    ficha(),
    AGORA,
  );
  const f = item(itens, "formulario");
  conferir("link vencido pela data mostra 'expirado', não 'ativo'", f.estado === "expirado", mapa(itens));
  conferir("e não pede confirmação de substituição", f.substituiAtivo === false, mapa(itens));
  conferir("mas continua emitindo", f.podeEmitir === true, mapa(itens));
}

// Vários links do mesmo tipo: vale o mais recente (uniq_link_ativo garante um
// ativo por tipo, mas o histórico continua na listagem).
{
  const itens = derivarEnvios(
    [
      link("formulario", { estado: "revogado", criado_em: HA_10_DIAS, revogado_em: HA_2_DIAS }),
      link("formulario", { estado: "ativo", criado_em: HA_2_DIAS, usos: 3 }),
    ],
    ficha(),
    AGORA,
  );
  const f = item(itens, "formulario");
  conferir("com histórico, vale o link mais recente", f.estado === "ativo" && f.usos === 3, mapa(itens));
  conferir("e a data de emissão é a dele", f.emitidoEm === HA_2_DIAS, String(f.emitidoEm));
}

// A régua emite `confirmacao` sozinha (0051) e ela CHEGA na listagem: a barra
// precisa enxergá-la, senão mostra "não emitido" para um link que existe.
{
  const itens = derivarEnvios(
    [link("confirmacao", { estado: "ativo" })],
    ficha({ statusAgendamento: "agendado" }),
    AGORA,
  );
  const c = item(itens, "confirmacao");
  conferir("link de confirmação emitido pela régua aparece na barra", c.estado === "ativo", mapa(itens));
  conferir("e emitir outro exige confirmação de 1 linha", c.substituiAtivo === true, mapa(itens));
}
publicar();
