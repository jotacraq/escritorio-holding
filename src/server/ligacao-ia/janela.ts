/**
 * Janela de discagem da ligação por IA (Fase 7 · agente LIG).
 *
 * Até 06/09/2026 o cron ligava 24/7: uma compra à 1h da manhã fazia o telefone
 * do cliente tocar à 1h da manhã. Agora a fila só disca dentro de uma janela
 * lida de `configuracoes['ligacao_ia.janela']`.
 *
 * Este módulo é PURO de propósito (nenhum acesso a banco, nenhum `Date.now()`
 * escondido): quem chama passa `agora`. É o que torna a regra testável sem
 * relógio de mentira.
 *
 * Fuso: convertido com `Intl.DateTimeFormat` — nenhuma dependência nova. O
 * Brasil não tem horário de verão desde 2019, mas a conversão é feita pelo
 * deslocamento REAL do instante (com um refinamento), então continua correta se
 * voltar, e vale para qualquer IANA.
 *
 * IMPORTANTE: a janela vale para o que o SISTEMA decide sozinho (fila do cron e
 * retentativa). O botão "Ligar por IA agora" da Ficha é ordem humana e dispara
 * fora da janela — a UI avisa, não impede (§1c do brief da Fase 7).
 */

export interface JanelaDiscagem {
  /** Dias da semana em que é permitido discar. 0 = domingo … 6 = sábado (convenção do `Date`). */
  dias: number[];
  /** "HH:MM" no fuso da janela. */
  inicio: string;
  /** "HH:MM" no fuso da janela. Exclusivo: às 19:00 a janela já fechou. */
  fim: string;
  /** IANA, ex.: "America/Sao_Paulo". */
  fuso: string;
}

/**
 * Default NO CÓDIGO — vale quando `configuracoes['ligacao_ia.janela']` não
 * existe (migration 0073 não aplicada) ou traz valor inválido. Segunda a sexta,
 * 9h–19h, horário de Brasília. Não vem do método: é a faixa comercial que a
 * Dra. Elaine confirma (ver §8 de docs/integracoes/n8n-ligacao-ia.md).
 */
export const JANELA_PADRAO: JanelaDiscagem = {
  dias: [1, 2, 3, 4, 5],
  inicio: "09:00",
  fim: "19:00",
  fuso: "America/Sao_Paulo",
};

const RE_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** Teto de dias que `proximaAbertura` procura antes de desistir. 8 cobre qualquer janela com ≥ 1 dia. */
const HORIZONTE_DIAS = 8;

function minutosDoDia(hhmm: string): number | null {
  const m = RE_HORA.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function fusoValido(fuso: unknown): fuso is string {
  if (typeof fuso !== "string" || fuso.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: fuso });
    return true;
  } catch {
    return false;
  }
}

/**
 * Aceita o jsonb como ele vier e devolve uma janela utilizável. Campo inválido
 * cai para o do `JANELA_PADRAO` — nunca lança, nunca inventa dia da semana.
 * `fim <= inicio` é considerado inválido (janela que não abre) e cai inteiro
 * para o padrão: melhor discar no horário comercial do que nunca discar.
 */
export function sanitizarJanela(valor: unknown): JanelaDiscagem {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return JANELA_PADRAO;
  const bruto = valor as Record<string, unknown>;

  const dias = Array.isArray(bruto.dias)
    ? [...new Set(bruto.dias.filter((d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6))].sort((a, b) => a - b)
    : [];
  const inicio = typeof bruto.inicio === "string" && RE_HORA.test(bruto.inicio) ? bruto.inicio : JANELA_PADRAO.inicio;
  const fim = typeof bruto.fim === "string" && RE_HORA.test(bruto.fim) ? bruto.fim : JANELA_PADRAO.fim;
  const fuso = fusoValido(bruto.fuso) ? bruto.fuso : JANELA_PADRAO.fuso;

  if (dias.length === 0) return { ...JANELA_PADRAO, fuso };
  if (minutosDoDia(fim)! <= minutosDoDia(inicio)!) return { ...JANELA_PADRAO, dias, fuso };

  return { dias, inicio, fim, fuso };
}

interface PartesLocais {
  ano: number;
  mes: number; // 1-12
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
}

const formatadores = new Map<string, Intl.DateTimeFormat>();

function formatador(fuso: string): Intl.DateTimeFormat {
  let f = formatadores.get(fuso);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: fuso,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatadores.set(fuso, f);
  }
  return f;
}

/** Ano/mês/dia/hora/minuto/segundo COMO SE LÊ NO RELÓGIO daquele fuso. */
function partesNoFuso(instante: Date, fuso: string): PartesLocais {
  const partes = formatador(fuso).formatToParts(instante);
  const p: Record<string, number> = {};
  for (const parte of partes) {
    if (parte.type !== "literal") p[parte.type] = Number(parte.value);
  }
  return { ano: p.year, mes: p.month, dia: p.day, hora: p.hour === 24 ? 0 : p.hour, minuto: p.minute, segundo: p.second };
}

/** Deslocamento do fuso naquele instante, em milissegundos (positivo a leste de Greenwich). */
function deslocamentoMs(instante: Date, fuso: string): number {
  const p = partesNoFuso(instante, fuso);
  const comoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  return comoUtc - Math.floor(instante.getTime() / 1000) * 1000;
}

/**
 * Instante UTC de um horário de PAREDE naquele fuso. Duas passadas: a primeira
 * chuta o deslocamento pelo próprio palpite, a segunda corrige se o palpite
 * caiu do outro lado de uma virada de horário de verão.
 */
function instanteDe(fuso: string, ano: number, mes: number, dia: number, minutos: number): Date {
  const paredeUtc = Date.UTC(ano, mes - 1, dia, Math.floor(minutos / 60), minutos % 60, 0, 0);
  let ts = paredeUtc - deslocamentoMs(new Date(paredeUtc), fuso);
  ts = paredeUtc - deslocamentoMs(new Date(ts), fuso);
  return new Date(ts);
}

/** Dia da semana (0 = domingo) da data de parede — sem depender do fuso do processo. */
function diaDaSemana(ano: number, mes: number, dia: number): number {
  return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
}

/** `true` quando `agora` está dentro da janela: dia permitido e `inicio <= hora < fim`. */
export function dentroDaJanela(agora: Date, janela: JanelaDiscagem = JANELA_PADRAO): boolean {
  const j = sanitizarJanela(janela);
  if (Number.isNaN(agora.getTime())) return false;
  const p = partesNoFuso(agora, j.fuso);
  if (!j.dias.includes(diaDaSemana(p.ano, p.mes, p.dia))) return false;
  const minutos = p.hora * 60 + p.minuto;
  return minutos >= minutosDoDia(j.inicio)! && minutos < minutosDoDia(j.fim)!;
}

/**
 * O PRIMEIRO instante ≥ `agora` que está dentro da janela. Se `agora` já está
 * dentro, devolve `agora` — é o que faz
 * `nao_antes_de = proximaAbertura(agora + intervalo)` respeitar as duas regras
 * ao mesmo tempo (esperar o intervalo E cair no horário comercial) sem empurrar
 * a retentativa um dia inteiro à toa.
 */
export function proximaAbertura(agora: Date, janela: JanelaDiscagem = JANELA_PADRAO): Date {
  const j = sanitizarJanela(janela);
  if (Number.isNaN(agora.getTime())) return agora;
  if (dentroDaJanela(agora, j)) return agora;

  const inicioMin = minutosDoDia(j.inicio)!;
  const p = partesNoFuso(agora, j.fuso);

  for (let offset = 0; offset <= HORIZONTE_DIAS; offset += 1) {
    // Soma o offset no CALENDÁRIO local (não em milissegundos): imune a
    // dia de 23 h / 25 h.
    const d = new Date(Date.UTC(p.ano, p.mes - 1, p.dia + offset));
    const ano = d.getUTCFullYear();
    const mes = d.getUTCMonth() + 1;
    const dia = d.getUTCDate();
    if (!j.dias.includes(diaDaSemana(ano, mes, dia))) continue;

    const abertura = instanteDe(j.fuso, ano, mes, dia, inicioMin);
    if (abertura.getTime() >= agora.getTime()) return abertura;
  }
  // Inalcançável com `dias` não vazio (garantido por `sanitizarJanela`), mas
  // nunca devolvemos data inválida: o pior caso é discar agora.
  return agora;
}

/** "segunda-feira, 8 de setembro, às 9h" — a mesma voz de `horarios.rotuloHorario`. */
export function rotuloAbertura(instante: Date, fuso: string = JANELA_PADRAO.fuso): string {
  const alvo = fusoValido(fuso) ? fuso : JANELA_PADRAO.fuso;
  const dia = new Intl.DateTimeFormat("pt-BR", { timeZone: alvo, weekday: "long", day: "numeric", month: "long" }).format(instante);
  const [hora, minuto] = new Intl.DateTimeFormat("pt-BR", { timeZone: alvo, hour: "2-digit", minute: "2-digit", hour12: false })
    .format(instante)
    .split(":");
  return `${dia}, às ${minuto === "00" ? `${Number(hora)}h` : `${Number(hora)}h${minuto}`}`;
}
