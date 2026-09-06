/**
 * Diferença entre duas versões de roteiro (`roteiros_versoes.definicao`, 0030).
 *
 * Por que não uma biblioteca de diff: `definicao` já é estruturada POR ID
 * (blocos, falas e campos têm `id` estável), então casar por id resolve 100%
 * dos casos e diz a coisa certa — "a fala `abertura_2` mudou" em vez de "a
 * linha 47 mudou". Diff textual sobre JSON marcaria como alteração o que é só
 * reordenação de chave. E não entra dependência nova (`npm install` está
 * proibido nesta fase).
 *
 * Puro, sem React: é o que o vitest cobre e o que a aba do Admin desenha.
 */

import type { RoteiroBloco, RoteiroDefinicao, RoteiroFala, SimIdentificador } from "@/types/roteiro";

export type SituacaoDiferenca = "adicionado" | "removido" | "alterado";

/**
 * `titulo` não estava no desenho original (§A5.3) e foi acrescentado aqui: sem
 * ele, renomear um bloco sem mexer no conteúdo aparecia como "nenhuma
 * diferença" — um diff que esconde mudança é pior que nenhum diff.
 */
export type TipoItemDiferenca = "titulo" | "objetivo" | "acao" | "fala" | "campo" | "observar" | "proibido";

export interface ItemDiferenca {
  tipo: TipoItemDiferenca;
  /** Id do item quando existe (fala/campo); rótulo estável quando não existe. */
  id: string;
  situacao: SituacaoDiferenca;
  /** Como está na versão da esquerda (a ativa). `null` = não existia. */
  antes: string | null;
  /** Como fica na versão da direita (a candidata). `null` = deixou de existir. */
  depois: string | null;
}

export interface DiferencaRoteiro {
  /** Id do bloco — é por ele que as duas versões foram casadas. */
  blocoId: string;
  /** Título do bloco na versão em que ele existe (a candidata tem prioridade). */
  bloco: string;
  situacao: SituacaoDiferenca;
  itens: ItemDiferenca[];
}

const ROTULO_TIPO_ITEM: Record<TipoItemDiferenca, string> = {
  titulo: "Título do bloco",
  objetivo: "Objetivo",
  acao: "Ação",
  fala: "Fala",
  campo: "Campo",
  observar: "Observar",
  proibido: "Proibido",
};

export function rotuloTipoItem(tipo: TipoItemDiferenca): string {
  return ROTULO_TIPO_ITEM[tipo] ?? tipo;
}

/** A fala como se lê: quem fala, o que fala e se ela carrega um dos 4 SIMs. */
function textoDaFala(fala: RoteiroFala): string {
  const corpo = fala.locutor ? `${fala.locutor}: ${fala.texto}` : fala.texto;
  return fala.sim ? `${corpo}\n[marca de SIM: ${fala.sim}]` : corpo;
}

function textoDoCampo(campo: { rotulo: string; tipo: string; opcoes?: string[] }): string {
  const opcoes = campo.opcoes && campo.opcoes.length > 0 ? ` (${campo.opcoes.join(" · ")})` : "";
  return `${campo.rotulo} — ${campo.tipo}${opcoes}`;
}

function comparar(tipo: TipoItemDiferenca, id: string, antes: string | null, depois: string | null): ItemDiferenca | null {
  const a = antes?.trim() || null;
  const b = depois?.trim() || null;
  if (a === b) return null;
  const situacao: SituacaoDiferenca = a === null ? "adicionado" : b === null ? "removido" : "alterado";
  return { tipo, id, situacao, antes: a, depois: b };
}

/** Itens de um bloco que só existe de um lado — tudo entra com a mesma situação. */
function itensDoBloco(bloco: RoteiroBloco, situacao: "adicionado" | "removido"): ItemDiferenca[] {
  const lado = (texto: string): Pick<ItemDiferenca, "antes" | "depois"> =>
    situacao === "adicionado" ? { antes: null, depois: texto } : { antes: texto, depois: null };
  const itens: ItemDiferenca[] = [];
  if (bloco.objetivo) itens.push({ tipo: "objetivo", id: "objetivo", situacao, ...lado(bloco.objetivo) });
  if (bloco.acao) itens.push({ tipo: "acao", id: "acao", situacao, ...lado(bloco.acao) });
  for (const fala of bloco.falas ?? []) itens.push({ tipo: "fala", id: fala.id, situacao, ...lado(textoDaFala(fala)) });
  for (const campo of bloco.campos ?? []) itens.push({ tipo: "campo", id: campo.id, situacao, ...lado(textoDoCampo(campo)) });
  (bloco.observar ?? []).forEach((texto, i) => itens.push({ tipo: "observar", id: `observar-${i + 1}`, situacao, ...lado(texto) }));
  (bloco.proibido ?? []).forEach((texto, i) => itens.push({ tipo: "proibido", id: `proibido-${i + 1}`, situacao, ...lado(texto) }));
  return itens;
}

/** Listas sem id (observar/proibido) casam por VALOR: some o que sumiu, entra o que entrou. */
function diferencaDeLista(tipo: "observar" | "proibido", antes: string[], depois: string[]): ItemDiferenca[] {
  const itens: ItemDiferenca[] = [];
  let n = 0;
  for (const texto of antes) {
    if (!depois.includes(texto)) itens.push({ tipo, id: `${tipo}-${++n}`, situacao: "removido", antes: texto, depois: null });
  }
  for (const texto of depois) {
    if (!antes.includes(texto)) itens.push({ tipo, id: `${tipo}-${++n}`, situacao: "adicionado", antes: null, depois: texto });
  }
  return itens;
}

function diferencaDeBloco(antes: RoteiroBloco, depois: RoteiroBloco): ItemDiferenca[] {
  const itens: ItemDiferenca[] = [];
  const titulo = comparar("titulo", "titulo", antes.titulo, depois.titulo);
  if (titulo) itens.push(titulo);
  const objetivo = comparar("objetivo", "objetivo", antes.objetivo, depois.objetivo);
  if (objetivo) itens.push(objetivo);
  const acao = comparar("acao", "acao", antes.acao, depois.acao);
  if (acao) itens.push(acao);

  const falasAntes = new Map((antes.falas ?? []).map((f) => [f.id, f]));
  const falasDepois = new Map((depois.falas ?? []).map((f) => [f.id, f]));
  for (const id of new Set([...falasAntes.keys(), ...falasDepois.keys()])) {
    const a = falasAntes.get(id);
    const b = falasDepois.get(id);
    const item = comparar("fala", id, a ? textoDaFala(a) : null, b ? textoDaFala(b) : null);
    if (item) itens.push(item);
  }

  const camposAntes = new Map((antes.campos ?? []).map((c) => [c.id, c]));
  const camposDepois = new Map((depois.campos ?? []).map((c) => [c.id, c]));
  for (const id of new Set([...camposAntes.keys(), ...camposDepois.keys()])) {
    const a = camposAntes.get(id);
    const b = camposDepois.get(id);
    const item = comparar("campo", id, a ? textoDoCampo(a) : null, b ? textoDoCampo(b) : null);
    if (item) itens.push(item);
  }

  itens.push(...diferencaDeLista("observar", antes.observar ?? [], depois.observar ?? []));
  itens.push(...diferencaDeLista("proibido", antes.proibido ?? [], depois.proibido ?? []));
  return itens;
}

/**
 * `antes` é a versão ATIVA, `depois` é a candidata. Blocos sem nenhuma
 * diferença não aparecem — a lista devolvida é a resposta à pergunta "o que
 * muda se eu ativar esta?", não um dump das duas versões.
 */
export function diffRoteiro(antes: RoteiroDefinicao | null | undefined, depois: RoteiroDefinicao | null | undefined): DiferencaRoteiro[] {
  const blocosAntes = (antes?.blocos ?? []).filter(Boolean);
  const blocosDepois = (depois?.blocos ?? []).filter(Boolean);
  const mapaAntes = new Map(blocosAntes.map((b) => [b.id, b]));
  const mapaDepois = new Map(blocosDepois.map((b) => [b.id, b]));

  // Ordem: a da versão candidata (é a que a pessoa vai passar a usar), com os
  // blocos removidos no fim — eles não têm posição na nova.
  const ordem = [...blocosDepois.map((b) => b.id), ...blocosAntes.map((b) => b.id).filter((id) => !mapaDepois.has(id))];

  const diferencas: DiferencaRoteiro[] = [];
  for (const id of new Set(ordem)) {
    const a = mapaAntes.get(id);
    const b = mapaDepois.get(id);
    if (!a && b) {
      diferencas.push({ blocoId: id, bloco: b.titulo, situacao: "adicionado", itens: itensDoBloco(b, "adicionado") });
    } else if (a && !b) {
      diferencas.push({ blocoId: id, bloco: a.titulo, situacao: "removido", itens: itensDoBloco(a, "removido") });
    } else if (a && b) {
      const itens = diferencaDeBloco(a, b);
      if (itens.length > 0) diferencas.push({ blocoId: id, bloco: b.titulo, situacao: "alterado", itens });
    }
  }
  return diferencas;
}

/** Quantas mudanças, para a linha de resumo ("3 blocos · 11 mudanças"). */
export function contarMudancas(diferencas: DiferencaRoteiro[]): number {
  return diferencas.reduce((total, d) => total + d.itens.length, 0);
}

/**
 * A trava do 1º SIM. `registrar_sim_sessao` (0030) acha o texto do
 * consentimento de sigilo e gravação pela fala marcada `sim: 'sigilo_gravacao'`.
 * Ativar uma versão de `sessao_viabilidade` sem essa fala faz a RPC levantar
 * `texto_consentimento_nao_encontrado` — e a sessão trava no primeiro passo,
 * com o cliente na chamada. A tela desabilita o botão por causa disto.
 */
export function temFalaDeSim(definicao: RoteiroDefinicao | null | undefined, sim: SimIdentificador): boolean {
  return (definicao?.blocos ?? []).some((bloco) => (bloco.falas ?? []).some((fala) => fala.sim === sim));
}
