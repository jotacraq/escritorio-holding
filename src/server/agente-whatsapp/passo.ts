import { derivarProximoPasso, type ProximoPasso } from "@/lib/pasta/proximo-passo";
import { sinaisVazios, type Sinais } from "@/lib/pasta/sinais";
import type { EtapaJornada } from "@/lib/api";
import type { IntencaoAgente } from "@/types/agente";

/**
 * A MÁQUINA DE PASSOS DO AGENTE É `derivarProximoPasso()` (D1/D9).
 *
 * Este arquivo NÃO decide nada sobre a esteira: ele traduz o passo que a
 * função pura de `src/lib/pasta/proximo-passo.ts` já devolve — a mesma que a
 * Esteira, o Painel e a Ficha 360 usam — para (a) qual link o agente pode
 * emitir e (b) qual intenção é a "esperada" naquele momento.
 *
 * Escrever uma segunda máquina de estados aqui reprovaria em otimização antes
 * de existir, e — pior — faria o que o robô diz no WhatsApp divergir do que a
 * equipe vê na tela.
 */

/** Os tipos de link que o agente pode fazer nascer. Nada além destes três. */
export type TipoLinkAgente = "formulario" | "documentos" | "confirmacao";

export interface PassoDoAgente {
  proximo: ProximoPasso;
  /** `true` quando o passo depende do CLIENTE — é a única situação em que o agente fala do passo. */
  ehDoCliente: boolean;
  /**
   * O link que ESTE passo prevê. `null` = o passo não tem link, e nenhuma
   * intenção (nem a IA) pode fazer o agente emitir um (D21).
   */
  linkPrevisto: TipoLinkAgente | null;
  /** A intenção que faz sentido responder sem modelo, quando o cliente escreve algo genérico. */
  intencaoEsperada: IntencaoAgente;
}

/** `ProximoPasso.chave` → link previsto. Fora desta tabela, o agente não emite. */
const LINK_POR_PASSO: Record<string, TipoLinkAgente> = {
  formulario: "formulario",
  documentos: "documentos",
  confirmar_presenca: "confirmacao",
};

const INTENCAO_POR_PASSO: Record<string, IntencaoAgente> = {
  formulario: "o_que_falta",
  documentos: "enviar_documento",
  confirmar_presenca: "confirmar_horario",
};

/**
 * Forma crua devolvida por `public.sinais_agente_whatsapp(uuid)` (0089).
 * Campo ausente vira `null` — a regra tri-estado de `Sinais` vale aqui igual:
 * `null` é "sem informação", nunca "não".
 */
export interface SinaisBrutoAgente {
  jornada_id?: string | null;
  pessoa_id?: string | null;
  primeiro_nome?: string | null;
  pessoa_origem_dado?: string | null;
  jornada_origem_dado?: string | null;
  desfecho?: string | null;
  etapa?: string | null;
  nivel_pago?: number | null;
  nivel_pago_vigente?: number | null;
  tem_formulario?: boolean | null;
  tem_ligacao?: boolean | null;
  tem_briefing?: boolean | null;
  tem_documentos?: boolean | null;
  proxima_sessao_em?: string | null;
  presenca_confirmada_em?: string | null;
  sessao_realizada_em?: string | null;
  tem_relatorio?: boolean | null;
  croqui_status?: string | null;
  material_estado?: string | null;
  tarefas_abertas?: Array<{ tipo?: string | null; responsavel_papel?: string | null }> | null;
  link_ativo_formulario?: boolean | null;
  link_ativo_documentos?: boolean | null;
}

const ETAPAS = new Set<string>([
  "captado",
  "qualificado",
  "sessao_contratada",
  "sessao_agendada",
  "sessao_realizada",
  "croqui_contratado",
  "croqui_apresentado",
  "holding_contratada",
]);

function booleano(valor: unknown): boolean | null {
  return typeof valor === "boolean" ? valor : null;
}

/** Adaptador: a linha da RPC vira `Sinais`, o MESMO contrato das telas. */
export function sinaisDoAgente(bruto: SinaisBrutoAgente): Sinais {
  const croqui = bruto.croqui_status;
  const material = bruto.material_estado;
  return {
    ...sinaisVazios(),
    etapa: bruto.etapa && ETAPAS.has(bruto.etapa) ? (bruto.etapa as EtapaJornada) : null,
    // O TETO vigente manda (Fase 8, D4): quem foi reembolsado não é tratado
    // como quem pagou só porque a etapa não caiu.
    nivelPago:
      typeof bruto.nivel_pago_vigente === "number"
        ? (Math.max(0, Math.min(3, bruto.nivel_pago_vigente)) as 0 | 1 | 2 | 3)
        : typeof bruto.nivel_pago === "number"
          ? (Math.max(0, Math.min(3, bruto.nivel_pago)) as 0 | 1 | 2 | 3)
          : null,
    temFormulario: booleano(bruto.tem_formulario),
    temLigacao: booleano(bruto.tem_ligacao),
    temBriefing: booleano(bruto.tem_briefing),
    temDocumentos: booleano(bruto.tem_documentos),
    proximaSessaoEm: bruto.proxima_sessao_em ?? null,
    // Sem sessão marcada não há presença a confirmar: `null` (sem informação),
    // nunca `false` — `false` faria o passo gritar "o cliente não confirmou".
    presencaConfirmada: bruto.proxima_sessao_em ? bruto.presenca_confirmada_em != null : null,
    presencaConfirmadaEm: bruto.presenca_confirmada_em ?? null,
    sessaoRealizadaEm: bruto.sessao_realizada_em ?? null,
    temRelatorio: booleano(bruto.tem_relatorio),
    croquiStatus:
      croqui === "rascunho" || croqui === "pronto" || croqui === "apresentado" ? croqui : croqui === null || croqui === undefined ? "nenhum" : null,
    materialEstado: material === "nenhum" || material === "rascunho" || material === "aprovado" ? material : null,
    tarefasAbertas: Array.isArray(bruto.tarefas_abertas)
      ? bruto.tarefas_abertas
          .filter((t) => typeof t?.tipo === "string")
          .map((t) => ({ tipo: t.tipo as string, responsavelPapel: t.responsavel_papel ?? null }))
      : null,
  };
}

/**
 * Traduz os sinais em "o que o agente pode falar agora".
 *
 * `agora` é injetável para teste — o passo depende da proximidade da sessão, e
 * um teste que depende do relógio real não é teste.
 */
export function derivarPassoDoAgente(sinais: Sinais, agora: number = Date.now()): PassoDoAgente {
  const proximo = derivarProximoPasso(sinais, agora);
  return {
    proximo,
    ehDoCliente: proximo.dono === "cliente",
    linkPrevisto: LINK_POR_PASSO[proximo.chave] ?? null,
    intencaoEsperada: INTENCAO_POR_PASSO[proximo.chave] ?? "o_que_falta",
  };
}

/**
 * A trava do D21: o modelo REDIGE, o banco DECIDE. Uma resposta da IA com
 * `acao: 'enviar_link'` só é obedecida quando o passo derivado do banco já
 * previa aquele link. Sem isto, "nunca inventa dado" seria promessa, não
 * garantia — bastaria o cliente pedir com jeitinho.
 */
export function podeEmitirLink(passo: PassoDoAgente, intencao: IntencaoAgente): boolean {
  if (passo.linkPrevisto === null) return false;
  if (!passo.ehDoCliente) return false;
  switch (intencao) {
    case "enviar_documento":
      return passo.linkPrevisto === "documentos";
    case "confirmar_horario":
      return passo.linkPrevisto === "confirmacao";
    case "o_que_falta":
      return passo.linkPrevisto === "formulario" || passo.linkPrevisto === "documentos";
    default:
      return false;
  }
}
