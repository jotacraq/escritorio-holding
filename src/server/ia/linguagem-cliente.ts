/**
 * "Como ele fala" — a seção `linguagem_do_cliente` do Briefing v3
 * (ARQUITETURA-FASE-4.md §5.2). Função PURA, zero I/O, zero IA.
 *
 * O schema v3 (`schema-briefing.ts`) carrega a seção como UMA string, porque
 * o objeto com arrays estoura o teto de gramática do provedor (medido:
 * 4.146 bytes > 3.905). O prompt v3 (0059) pede o formato fixo abaixo e este
 * módulo divide a string para a tela (chips) e para `fidelidade.ts`
 * (expressões verificadas contra o material de entrada).
 *
 * Formato pedido ao modelo — três linhas, prefixo fixo, itens separados por `;`:
 *
 *   PALAVRAS: patrimônio; meus meninos; segurança
 *   EXPRESSÕES: não quero deixar briga; a empresa é a minha vida
 *   REGISTRO: coloquial, direto, fala em histórias curtas
 *
 * Se o modelo não seguir o formato, nada é inventado: o que não tiver prefixo
 * reconhecível cai inteiro em `registro`, e as listas ficam vazias.
 */

export interface LinguagemDoCliente {
  /** Palavras/termos que o cliente repete, literais. */
  palavras: string[];
  /** Frases curtas exatamente como ele fala — cada uma verificada por `fidelidade.ts`. */
  expressoes: string[];
  /** Uma frase sobre o registro: formal/coloquial, técnico/prático, direto/narrativo. */
  registro: string | null;
}

/** Texto do prompt v3 que descreve o formato — exportado para a bancada e a documentação citarem a MESMA regra. */
export const FORMATO_LINGUAGEM_DO_CLIENTE =
  'linguagem_do_cliente: exatamente três linhas, nesta ordem, com estes prefixos: "PALAVRAS: " ' +
  "(até 8 palavras ou termos que o cliente repete, literais, separados por ponto e vírgula), " +
  '"EXPRESSÕES: " (até 5 frases curtas exatamente como ele as disse, separadas por ponto e vírgula) e ' +
  '"REGISTRO: " (uma frase: formal ou coloquial, técnico ou prático, direto ou narrativo). ' +
  "Só palavras e expressões que estejam literalmente no material recebido — nunca parafraseie. " +
  'Sem material suficiente, deixe a lista vazia (ex.: "EXPRESSÕES: ") em vez de inventar.';

const LIMITE_PALAVRAS = 8;
const LIMITE_EXPRESSOES = 5;

const PREFIXOS: Array<{ chave: keyof LinguagemDoCliente; regex: RegExp }> = [
  { chave: "palavras", regex: /^\s*palavras\s*:\s*/i },
  { chave: "expressoes", regex: /^\s*express(?:õ|o)es\s*:\s*/i },
  { chave: "registro", regex: /^\s*registro\s*:\s*/i },
];

function dividirLista(texto: string, limite: number): string[] {
  const vistos = new Set<string>();
  const itens: string[] = [];
  for (const bruto of texto.split(";")) {
    const item = bruto.trim().replace(/^["“”']+|["“”']+$/g, "").trim();
    if (!item) continue;
    const chave = item.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    itens.push(item);
    if (itens.length >= limite) break;
  }
  return itens;
}

export const LINGUAGEM_VAZIA: LinguagemDoCliente = { palavras: [], expressoes: [], registro: null };

export function separarLinguagemDoCliente(texto: string | null | undefined): LinguagemDoCliente {
  if (!texto || texto.trim().length === 0) return LINGUAGEM_VAZIA;

  const resultado: LinguagemDoCliente = { palavras: [], expressoes: [], registro: null };
  const semPrefixo: string[] = [];

  for (const linha of texto.split(/\r?\n/)) {
    if (linha.trim().length === 0) continue;
    const prefixo = PREFIXOS.find((p) => p.regex.test(linha));
    if (!prefixo) {
      semPrefixo.push(linha.trim());
      continue;
    }
    const conteudo = linha.replace(prefixo.regex, "");
    if (prefixo.chave === "palavras") resultado.palavras = dividirLista(conteudo, LIMITE_PALAVRAS);
    else if (prefixo.chave === "expressoes") resultado.expressoes = dividirLista(conteudo, LIMITE_EXPRESSOES);
    else resultado.registro = conteudo.trim() || null;
  }

  // Sem prefixo reconhecível: o texto inteiro vira registro (honesto: é o que
  // veio), nunca é fatiado em "palavras" por adivinhação.
  if (resultado.registro === null && semPrefixo.length > 0) {
    resultado.registro = semPrefixo.join(" ");
  }

  return resultado;
}
