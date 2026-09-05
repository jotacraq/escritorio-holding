import type { CanalMensagem, MensagemDaFila, StatusMensagem } from "./api-comunicacao";
import type { TomSelo } from "@/components/ui/Selo";

/**
 * Vocabulário da tela Comunicação: chave de template → motivo humano,
 * canal → rótulo, status → selo, e o agrupamento "quando vai sair".
 * Tudo puro, sem fetch — testável na mesa.
 */

const ROTULO_TEMPLATE: Record<string, string> = {
  boas_vindas: "Boas-vindas",
  confirmacao_d7: "Confirmação D-7",
  dia_da_sessao: "Dia da sessão (link da sala)",
  pos_sessao: "Material pós-sessão",
  croqui_convite: "Convite do croqui",
  agendamento_link: "Link de agendamento",
};

/** Chave desconhecida vira texto legível (`nova_chave` → "nova chave"), nunca some. */
export function rotuloTemplate(chave: string | null): string {
  if (!chave) return "Mensagem da régua";
  return ROTULO_TEMPLATE[chave] ?? chave.replace(/_/g, " ");
}

export function rotuloCanal(canal: CanalMensagem): string {
  return canal === "email" ? "E-mail" : "WhatsApp";
}

export const TOM_STATUS: Record<StatusMensagem, TomSelo> = {
  pendente: "neutro",
  enviando: "azul",
  enviada: "verde",
  falhou: "vermelho",
  cancelada: "neutro",
};

export const ROTULO_STATUS: Record<StatusMensagem, string> = {
  pendente: "Pendente",
  enviando: "Enviando",
  enviada: "Enviada",
  falhou: "Falhou",
  cancelada: "Cancelada",
};

export type GrupoQuando = "atrasada" | "hoje" | "amanha" | "esta_semana" | "depois" | "sem_data";

export const ORDEM_GRUPOS: GrupoQuando[] = ["atrasada", "hoje", "amanha", "esta_semana", "depois", "sem_data"];

export const ROTULO_GRUPO: Record<GrupoQuando, { titulo: string; descricao: string }> = {
  atrasada: { titulo: "Já deveria ter saído", descricao: "Hora passou e ainda está pendente — a régua não rodou ou o envio depende de alguém." },
  hoje: { titulo: "Hoje", descricao: "Sai na próxima passagem do cron depois da hora marcada." },
  amanha: { titulo: "Amanhã", descricao: "" },
  esta_semana: { titulo: "Esta semana", descricao: "" },
  depois: { titulo: "Depois", descricao: "" },
  sem_data: { titulo: "Sem data", descricao: "Mensagem sem horário — não sai enquanto não tiver." },
};

const FUSO = "America/Sao_Paulo";

/** "AAAA-MM-DD" no fuso do escritório — o dia civil é o que a equipe entende por "hoje". */
function diaCivil(data: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" }).format(data);
}

function somarDias(data: Date, dias: number): Date {
  return new Date(data.getTime() + dias * 86_400_000);
}

/** Decide o grupo de uma data em relação a `agora` (parâmetro para o teste de mesa). */
export function grupoDe(agendadaPara: string | null, agora: Date = new Date()): GrupoQuando {
  if (!agendadaPara) return "sem_data";
  const data = new Date(agendadaPara);
  if (Number.isNaN(data.getTime())) return "sem_data";
  if (data.getTime() < agora.getTime()) return "atrasada";
  const dia = diaCivil(data);
  if (dia === diaCivil(agora)) return "hoje";
  if (dia === diaCivil(somarDias(agora, 1))) return "amanha";
  if (dia <= diaCivil(somarDias(agora, 6))) return "esta_semana";
  return "depois";
}

export interface GrupoMensagens {
  grupo: GrupoQuando;
  itens: MensagemDaFila[];
}

/** Agrupa mantendo a ordem de `agendada_para` que a API já devolve. Grupos vazios não aparecem. */
export function agruparPorQuando(itens: MensagemDaFila[], agora: Date = new Date()): GrupoMensagens[] {
  const mapa = new Map<GrupoQuando, MensagemDaFila[]>();
  for (const item of itens) {
    const grupo = grupoDe(item.agendada_para, agora);
    if (!mapa.has(grupo)) mapa.set(grupo, []);
    mapa.get(grupo)!.push(item);
  }
  return ORDEM_GRUPOS.filter((g) => mapa.has(g)).map((grupo) => ({ grupo, itens: mapa.get(grupo)! }));
}
