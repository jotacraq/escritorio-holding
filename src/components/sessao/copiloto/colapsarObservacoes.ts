import type { CategoriaFichaCliente, ObservacaoDoClienteRetrospecto } from "@/types/copiloto";

/**
 * Fase 13, §D — **colapso de exibição** das observações do Retrospecto.
 *
 * 🔴 **Só exibição.** Nada aqui toca o dado: `conteudo.observacoes_do_cliente`
 * continua exatamente como o servidor gravou (o Retrospecto é artefato
 * CONGELADO). Isto é uma lente de leitura, aplicada na hora de desenhar.
 *
 * **Por que existe.** Medido na sessão real de 22/09: `ficha_acumulada` trazia
 * 8 itens que eram ~5 fatos ("Divorciada há mais de 10 anos" em 3 redações
 * diferentes) e `inventario_acumulado` 7 itens que eram 2 imóveis. A lista
 * corrida repetia o mesmo fato, e repetição lida como fato novo — o documento
 * mentia o volume do que a cliente disse.
 *
 * **Conservador por contrato: na dúvida, NÃO colapsa.** Errar repetindo é
 * barato; errar sumindo com um fato da cliente custa a sessão. Por isso a
 * porta de entrada é um PREFIXO comum de pelo menos `PREFIXO_MIN` palavras
 * plenas — e não similaridade global de texto.
 *
 * A calibração está nos casos reais e é o motivo da regra ser esta:
 *
 * | par | Jaccard | prefixo | decisão |
 * |---|---|---|---|
 * | "Divorciada há mais de 10 anos; ex-marido…" × "…, partilha resolvida…" | 0,27 | 3 | colapsa |
 * | "Divorciada há mais de 10 anos, dois filhos" × "Quer evitar inventário para os dois filhos" | 0,25 | 0 | **não** colapsa |
 *
 * Duplicata verdadeira pontua 0,27 de Jaccard e fato DISTINTO pontua 0,25:
 * nenhum limiar de similaridade global separa os dois. O prefixo separa (3
 * contra 0), porque a redação da IA repete o fato começando igual e diverge no
 * complemento. Daí o gate duro de prefixo, com a sobreposição só como segunda
 * trava.
 *
 * "Apartamento do filho…" × "Apartamento do irmão…" fica SEPARADO de
 * propósito: filho e irmão são pessoas diferentes, e colapsar apagaria um
 * imóvel do patrimônio. Preferir o falso negativo é a regra.
 *
 * **Nenhuma evidência se perde.** O item colapsado carrega as citações de
 * TODAS as linhas que entraram nele (`evidencias`) e a soma dos `n`.
 */

/** Palavras sem carga semântica: entram no texto, não na identidade do fato. */
const PALAVRAS_VAZIAS = new Set([
  "a", "o", "as", "os", "de", "da", "do", "das", "dos", "em", "no", "na", "nos", "nas",
  "e", "que", "com", "um", "uma", "para", "por", "ha", "mais", "seu", "sua", "ao",
]);

/**
 * Quantas palavras plenas iniciais dois textos precisam compartilhar para
 * serem candidatos ao mesmo fato. 3 é o menor valor que separa as duplicatas
 * reais medidas (prefixo 3) do fato distinto mais parecido (prefixo 0).
 */
const PREFIXO_MIN = 3;

/** Fração mínima de palavras em comum, já passado o gate de prefixo. */
const SOBREPOSICAO_MIN = 0.5;

/** Minúsculas, sem acento e sem pontuação — a pontuação é justamente onde as
 * redações da IA divergem ("10 anos;" × "10 anos,"). */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function palavrasPlenas(texto: string): string[] {
  return normalizar(texto)
    .split(" ")
    .filter((p) => p.length > 0 && !PALAVRAS_VAZIAS.has(p));
}

/** Determinístico, sem IA e sem dependência nova. Simétrico: `mesmoFato(a,b)`
 * é sempre igual a `mesmoFato(b,a)`. */
export function mesmoFato(textoA: string, textoB: string): boolean {
  if (normalizar(textoA) === normalizar(textoB)) return true;

  const a = palavrasPlenas(textoA);
  const b = palavrasPlenas(textoB);
  if (a.length === 0 || b.length === 0) return false;

  const menor = Math.min(a.length, b.length);
  let prefixo = 0;
  while (prefixo < menor && a[prefixo] === b[prefixo]) prefixo += 1;

  // Gate duro: sem começo comum, são fatos diferentes — mesmo que dividam
  // muitas palavras soltas ("dois filhos" aparece em fatos não relacionados).
  if (prefixo < PREFIXO_MIN) return false;

  // Um é prefixo exato do outro: a versão curta é a mesma frase truncada.
  if (prefixo === menor) return true;

  const conjuntoB = new Set(b);
  const comuns = a.filter((p) => conjuntoB.has(p)).length;
  return comuns / menor >= SOBREPOSICAO_MIN;
}

/** Um fato, depois do colapso. `n` e `evidencias` somam as linhas de origem. */
export interface ObservacaoColapsada {
  origem: ObservacaoDoClienteRetrospecto["origem"];
  categoria: CategoriaFichaCliente | "patrimonio" | null;
  tipo: ObservacaoDoClienteRetrospecto["tipo"];
  /** A redação MAIS LONGA entre as colapsadas — a que carrega mais detalhe da
   * fala da cliente. Escolher a mais curta jogaria informação fora na tela. */
  texto: string;
  /** Citações literais de TODAS as linhas colapsadas, sem repetir e sem
   * `null`. Vazio quando o expurgo já redigiu as evidências. */
  evidencias: string[];
  /** Soma dos `n` das linhas colapsadas. */
  n: number;
  /** Quantas linhas do documento entraram neste item. 1 = nada foi colapsado. */
  linhas: number;
}

/**
 * Colapsa dentro de um mesmo grupo já homogêneo (mesma categoria/tipo).
 *
 * 🔴 **Preserva a ordem de chegada.** O primeiro item de cada fato mantém a
 * posição que tinha, então a ordem do servidor (`RANK_CATEGORIA`: objeção 1 ·
 * dor 2 · desejo 3 · fato_decisor 4 · patrimônio 5 — regra de negócio do dono)
 * atravessa esta função intacta. Nada aqui reordena.
 */
export function colapsarObservacoes(itens: ObservacaoDoClienteRetrospecto[]): ObservacaoColapsada[] {
  const grupos: ObservacaoColapsada[] = [];

  for (const item of itens) {
    // Compara com os fatos JÁ abertos, sempre contra o texto representativo.
    const alvo = grupos.find(
      (g) => g.origem === item.origem && g.categoria === item.categoria && g.tipo === item.tipo && mesmoFato(g.texto, item.texto),
    );

    if (alvo === undefined) {
      grupos.push({
        origem: item.origem,
        categoria: item.categoria,
        tipo: item.tipo,
        texto: item.texto,
        evidencias: item.evidencia === null ? [] : [item.evidencia],
        n: item.n,
        linhas: 1,
      });
      continue;
    }

    alvo.n += item.n;
    alvo.linhas += 1;
    // A redação mais longa vira a representativa: mais detalhe na tela.
    if (item.texto.length > alvo.texto.length) alvo.texto = item.texto;
    // Evidência NUNCA se perde em silêncio — só não se duplica.
    if (item.evidencia !== null && !alvo.evidencias.includes(item.evidencia)) {
      alvo.evidencias.push(item.evidencia);
    }
  }

  return grupos;
}
