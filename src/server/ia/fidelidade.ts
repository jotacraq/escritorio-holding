import type { ContextoBriefing } from "./contexto-briefing";
import type { Briefing } from "./schema-briefing";

/**
 * Verificação de fidelidade (ARQUITETURA-FASE-3.md §1.8) — a checagem que
 * custa zero e vale muito. `frases_para_o_fechamento[].frase_literal` é, pelo
 * Protocolo 01, uma frase que o CLIENTE disse. A advogada vai repeti-la na
 * reunião. Hoje nada verifica que ela existe no contexto de entrada — frase
 * que não existe é frase que o cliente nunca disse.
 *
 * Sem IA, sem query nova: roda inteiramente sobre `ContextoBriefing` (o mesmo
 * JSON que já foi enviado ao modelo) e a saída estruturada já validada pelo
 * Zod. Grava em `briefings.verificacao` (0042) e devolve na resposta de quem
 * chamar `gerarBriefing`.
 */

export type StatusFraseLiteral = "verificada" | "nao_localizada";

export interface VerificacaoFraseLiteral {
  frase_literal: string;
  status: StatusFraseLiteral;
}

export interface VerificacaoEvidencia {
  evidencia: string;
  cobertura: number; // 0..1 — fração de palavras significativas encontradas no contexto
}

export interface ResultadoFidelidade {
  frases_fechamento: VerificacaoFraseLiteral[];
  evidencias_perfil_disc: VerificacaoEvidencia[];
  evidencias_arquetipo_patrimonial: VerificacaoEvidencia[];
  /** Fração de frases_literais verificadas — 1.0 = todas achadas no material. Métrica da bancada (§1.9). */
  ancoragem: number;
  /** Média das coberturas de evidência (perfil_disc + arquétipo). Métrica da bancada (§1.9). */
  cobertura_evidencia_media: number;
  frases_nao_localizadas: number;
}

/** minúsculas, sem acento, sem pontuação, espaço colapsado — mesma normalização para agulha e palheiro. */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "") // remove marcas de combinação (acentos) deixadas pelo NFD
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function coletarStrings(valor: unknown, acc: string[]): void {
  if (typeof valor === "string") {
    if (valor.trim().length > 0) acc.push(valor);
    return;
  }
  if (Array.isArray(valor)) {
    for (const item of valor) coletarStrings(item, acc);
    return;
  }
  if (valor !== null && typeof valor === "object") {
    for (const item of Object.values(valor)) coletarStrings(item, acc);
  }
}

/** Junta todo texto do contexto (formulário, ligação, transcrição) num único palheiro normalizado. */
function montarPalheiro(contexto: ContextoBriefing): string {
  const strings: string[] = [];
  coletarStrings(contexto, strings);
  return normalizar(strings.join(" \n "));
}

const PALAVRAS_IGNORADAS = new Set([
  "a", "o", "as", "os", "de", "da", "do", "das", "dos", "e", "ou", "que", "um", "uma",
  "para", "por", "com", "em", "no", "na", "nos", "nas", "se", "eu", "meu", "minha",
  "seu", "sua", "ele", "ela", "isso", "esse", "essa", "muito", "mais", "mas", "ja",
]);

function palavrasSignificativas(textoNormalizado: string): string[] {
  return textoNormalizado.split(" ").filter((p) => p.length >= 3 && !PALAVRAS_IGNORADAS.has(p));
}

/** Substring exata (após normalização) — não é paráfrase; é a frase que o cliente literalmente disse. */
function verificarFraseLiteral(fraseLiteral: string, palheiro: string): StatusFraseLiteral {
  const agulha = normalizar(fraseLiteral);
  if (agulha.length === 0) return "nao_localizada";
  return palheiro.includes(agulha) ? "verificada" : "nao_localizada";
}

/**
 * Evidência é paráfrase legítima (não exige literalidade) — mede sobreposição
 * de palavras significativas contra o palheiro. Evidência sem palavra
 * significativa (vazia/curta) conta como coberta (nada a desmentir).
 */
function calcularCoberturaEvidencia(evidencia: string, palheiro: string): number {
  const palavras = palavrasSignificativas(normalizar(evidencia));
  if (palavras.length === 0) return 1;
  const palheiroPalavras = new Set(palheiro.split(" "));
  const encontradas = palavras.filter((p) => palheiroPalavras.has(p)).length;
  return encontradas / palavras.length;
}

export function calcularFidelidade(contexto: ContextoBriefing, briefing: Briefing): ResultadoFidelidade {
  const palheiro = montarPalheiro(contexto);

  const frases_fechamento: VerificacaoFraseLiteral[] = briefing.frases_para_o_fechamento.map((item) => ({
    frase_literal: item.frase_literal,
    status: verificarFraseLiteral(item.frase_literal, palheiro),
  }));

  const evidencias_perfil_disc: VerificacaoEvidencia[] = briefing.perfil_disc.evidencias.map((evidencia) => ({
    evidencia,
    cobertura: calcularCoberturaEvidencia(evidencia, palheiro),
  }));

  const evidencias_arquetipo_patrimonial: VerificacaoEvidencia[] = briefing.arquetipo_patrimonial.evidencias.map(
    (evidencia) => ({
      evidencia,
      cobertura: calcularCoberturaEvidencia(evidencia, palheiro),
    }),
  );

  const frases_nao_localizadas = frases_fechamento.filter((f) => f.status === "nao_localizada").length;
  const ancoragem = frases_fechamento.length > 0 ? 1 - frases_nao_localizadas / frases_fechamento.length : 1;

  const todasCoberturas = [...evidencias_perfil_disc, ...evidencias_arquetipo_patrimonial].map((e) => e.cobertura);
  const cobertura_evidencia_media =
    todasCoberturas.length > 0 ? todasCoberturas.reduce((a, b) => a + b, 0) / todasCoberturas.length : 1;

  return {
    frases_fechamento,
    evidencias_perfil_disc,
    evidencias_arquetipo_patrimonial,
    ancoragem,
    cobertura_evidencia_media,
    frases_nao_localizadas,
  };
}
