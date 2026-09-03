/**
 * Leitura do CSV NO NAVEGADOR — só para montar a tela de mapeamento
 * (cabeçalho + poucas linhas de amostra) e contar linhas antes do upload.
 * NÃO é a fonte de verdade: `src/server/importacao/csv.ts` (fronteira de
 * outro agente) reprocessa o arquivo de novo no servidor, com as mesmas
 * regras de decodificação — se um dia divergirem, quem vale é o servidor.
 * Duplicar aqui, pequeno e isolado, é mais seguro que importar módulo de
 * `src/server/**` dentro de um componente cliente.
 */

const TAMANHO_AMOSTRA = 5;

export interface CsvAmostra {
  cabecalho: string[];
  linhasAmostra: string[][];
  totalLinhas: number;
}

function removerBom(texto: string): string {
  return texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
}

function decodificar(bytes: Uint8Array): string {
  try {
    return removerBom(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return removerBom(new TextDecoder("windows-1252").decode(bytes));
  }
}

function detectarDelimitador(primeiraLinha: string): "," | ";" {
  let virgulas = 0;
  let pontoEVirgulas = 0;
  let dentroDeAspas = false;
  for (const c of primeiraLinha) {
    if (c === '"') dentroDeAspas = !dentroDeAspas;
    else if (!dentroDeAspas && c === ",") virgulas++;
    else if (!dentroDeAspas && c === ";") pontoEVirgulas++;
  }
  return pontoEVirgulas > virgulas ? ";" : ",";
}

function parseLinhas(texto: string, limite: number): { linhas: string[][]; total: number } {
  const semCrlf = texto.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const primeiraQuebra = semCrlf.indexOf("\n");
  const primeiraLinha = primeiraQuebra === -1 ? semCrlf : semCrlf.slice(0, primeiraQuebra);
  const delimitador = detectarDelimitador(primeiraLinha);

  const linhas: string[][] = [];
  let campo = "";
  let linhaAtual: string[] = [];
  let dentroDeAspas = false;
  let total = 0;

  const fecharCampo = () => {
    linhaAtual.push(campo);
    campo = "";
  };
  const fecharLinha = () => {
    fecharCampo();
    if (linhaAtual.some((v) => v.trim() !== "")) {
      total++;
      if (linhas.length < limite) linhas.push(linhaAtual);
    }
    linhaAtual = [];
  };

  for (let i = 0; i < semCrlf.length; i++) {
    const c = semCrlf[i];
    if (dentroDeAspas) {
      if (c === '"') {
        if (semCrlf[i + 1] === '"') {
          campo += '"';
          i++;
          continue;
        }
        dentroDeAspas = false;
        continue;
      }
      campo += c;
      continue;
    }
    if (c === '"') {
      dentroDeAspas = true;
      continue;
    }
    if (c === delimitador) {
      fecharCampo();
      continue;
    }
    if (c === "\n") {
      fecharLinha();
      continue;
    }
    campo += c;
  }
  if (campo.length > 0 || linhaAtual.length > 0) fecharLinha();

  return { linhas, total };
}

/** Lê só o essencial: cabeçalho, algumas linhas de amostra e a contagem total
 * (mapeada em memória, mas o arquivo inteiro só é enviado no POST da fase 1). */
export async function lerAmostraCsv(arquivo: File): Promise<CsvAmostra> {
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const texto = decodificar(bytes);
  const { linhas, total } = parseLinhas(texto, TAMANHO_AMOSTRA + 1);
  const [cabecalho, ...resto] = linhas;
  return {
    cabecalho: (cabecalho ?? []).map((h) => h.trim()),
    linhasAmostra: resto.slice(0, TAMANHO_AMOSTRA),
    totalLinhas: Math.max(0, total - 1),
  };
}
