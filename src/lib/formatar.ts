/**
 * Formatação — tudo que aparece na tela do SIC-HF é português do Brasil,
 * fuso America/Sao_Paulo. Sem dado: retorna o marcador de ausência, nunca zero
 * e nunca string vazia silenciosa.
 */

const FUSO = "America/Sao_Paulo";
export const SEM_DADO = "—";

/** `YYYY-MM-DD` no começo da string, sem hora nenhuma depois. */
const DATA_PURA = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `date` do Postgres ("2026-09-07") formatado como DATA DE CALENDÁRIO.
 *
 * Uma data pura não tem instante e, portanto, não tem fuso: convertê-la é o
 * bug. `new Date("2026-09-07")` é meia-noite **UTC**, que em São Paulo (UTC−3)
 * é 21h do dia **anterior** — a edição que começa em 07/09 aparecia como
 * 06/09 em Admin → Edições, e o prazo de hoje aparecia como o de ontem. Aqui a
 * string é reformatada direto, sem fuso no caminho.
 *
 * Esta função nasceu TRÊS vezes na Fase 8 — `agenda/rotulos.ts`
 * (`formatarDataCalendario`, para `vale_de`/`vale_ate`), `admin/comum.tsx`
 * (`formatarDataPura`, para `edicoes`/`parametros`/`casos`) e o tratamento
 * interno de `ui/Prazo`. Três cópias da mesma correção é a quarta cópia
 * esperando para nascer errada; agora o dono é este arquivo, e os dois
 * primeiros re-exportam daqui.
 */
export function formatarDataPura(data?: string | null): string {
  if (!data) return SEM_DADO;
  const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(data);
  if (!partes) return SEM_DADO;
  return `${partes[3]}/${partes[2]}/${partes[1]}`;
}

/**
 * Data para a tela. Aceita **timestamp** (converte para America/Sao_Paulo) e
 * **`date` puro** (formata sem fuso, delegando a `formatarDataPura`).
 *
 * O desvio: antes da rodada FIX da Fase 8 esta função mandava tudo para
 * `new Date(iso)`, e toda coluna `date` saía um dia atrasada — furo que
 * apareceu de verdade em três telas (Edições, Parâmetros, Repertório) e que
 * cada uma consertou por fora. Distinguir os dois casos aqui, uma vez, é o
 * conserto que não depende de quem chama lembrar da armadilha.
 */
export function formatarData(iso?: string | null): string {
  if (!iso) return SEM_DADO;
  if (DATA_PURA.test(iso)) return formatarDataPura(iso);
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return SEM_DADO;
  return new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "numeric" }).format(data);
}

export function formatarDataHora(iso?: string | null): string {
  if (!iso) return SEM_DADO;
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return SEM_DADO;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(data);
}

export function formatarHora(iso?: string | null): string {
  if (!iso) return SEM_DADO;
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return SEM_DADO;
  return new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" }).format(data);
}

/** "há 3 dias" / "em 2 horas" — sem dependência nova, cálculo direto. */
export function formatarRelativo(iso?: string | null): string {
  if (!iso) return SEM_DADO;
  const alvo = new Date(iso).getTime();
  if (Number.isNaN(alvo)) return SEM_DADO;
  const diffMs = alvo - Date.now();
  const diffMin = Math.round(diffMs / 60000);
  const abs = Math.abs(diffMin);
  const passado = diffMin <= 0;
  let valor: number;
  let unidade: string;
  if (abs < 60) {
    valor = abs;
    unidade = "minuto";
  } else if (abs < 60 * 24) {
    valor = Math.round(abs / 60);
    unidade = "hora";
  } else {
    valor = Math.round(abs / (60 * 24));
    unidade = "dia";
  }
  const plural = valor === 1 ? "" : "s";
  if (valor === 0) return "agora";
  return passado ? `há ${valor} ${unidade}${plural}` : `em ${valor} ${unidade}${plural}`;
}

export function formatarMoeda(valor?: number | string | null): string {
  if (valor === null || valor === undefined || valor === "") return SEM_DADO;
  const numero = typeof valor === "string" ? Number(valor) : valor;
  if (Number.isNaN(numero)) return SEM_DADO;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(numero);
}

export function formatarPercentual(valor?: number | null, casas = 0): string {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return SEM_DADO;
  return `${valor.toFixed(casas)}%`;
}

export function formatarTelefone(telefone?: string | null): string {
  if (!telefone) return SEM_DADO;
  const digitos = telefone.replace(/\D/g, "").replace(/^55/, "");
  if (digitos.length === 11) return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)}-${digitos.slice(7)}`;
  if (digitos.length === 10) return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 6)}-${digitos.slice(6)}`;
  return telefone;
}

/** Link wa.me exige dígitos com país. */
export function linkWhatsapp(telefone?: string | null, textoPreenchido?: string): string | null {
  if (!telefone) return null;
  let digitos = telefone.replace(/\D/g, "");
  if (!digitos.startsWith("55")) digitos = `55${digitos}`;
  const base = `https://wa.me/${digitos}`;
  return textoPreenchido ? `${base}?text=${encodeURIComponent(textoPreenchido)}` : base;
}

export function formatarCidadeUf(cidade?: string | null, uf?: string | null): string {
  if (cidade && uf) return `${cidade}/${uf}`;
  if (cidade) return cidade;
  if (uf) return uf;
  return SEM_DADO;
}

export function iniciais(nome?: string | null): string {
  if (!nome) return "?";
  const partes = nome.trim().split(/\s+/);
  const primeira = partes[0]?.[0] ?? "";
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : "";
  return (primeira + ultima).toUpperCase();
}

export function truncar(texto: string, tamanho: number): string {
  if (texto.length <= tamanho) return texto;
  return `${texto.slice(0, tamanho - 1)}…`;
}
