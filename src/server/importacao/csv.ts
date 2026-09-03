/**
 * Decodificação e parsing de CSV — entrada NÃO CONFIÁVEL (arquivo enviado por
 * upload). Sem dependência nova: parser escrito à mão (RFC4180-ish) porque
 * `String.split(",")` quebra em qualquer célula com vírgula/quebra de linha
 * dentro de aspas, e exportação de planilha brasileira comumente vem em
 * Windows-1252/ISO-8859-1, não UTF-8.
 */

const CODIGO_BOM_UTF8 = 0xfeff;

function removerBom(texto: string): string {
  return texto.charCodeAt(0) === CODIGO_BOM_UTF8 ? texto.slice(1) : texto;
}

/**
 * Decodifica os bytes do arquivo, removendo o BOM UTF-8 se presente. Tenta
 * UTF-8 estrito primeiro (`fatal: true` — não engole byte inválido em
 * silêncio); se a sequência não for UTF-8 válido, cai para Windows-1252
 * (cobre o caso comum de export de Excel/planilha brasileira em Latin-1).
 * Windows-1252 nunca lança — é decodificador de fallback seguro para
 * qualquer sequência de bytes.
 */
export function decodificarArquivo(bytes: Uint8Array): string {
  try {
    const texto = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return removerBom(texto);
  } catch {
    return removerBom(new TextDecoder("windows-1252").decode(bytes));
  }
}

export interface CsvParseado {
  cabecalho: string[];
  linhas: string[][];
}

/** Sniff simples de delimitador: conta ',' e ';' fora de aspas na 1ª linha
 * (exportações brasileiras de Excel costumam usar ';'). */
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

/**
 * Parser CSV mínimo (RFC4180): campo entre aspas pode conter delimitador e
 * quebra de linha; `""` dentro de aspas é aspas literal. Descarta linhas
 * 100% vazias (comuns no fim do arquivo, depois de normalizar quebras).
 */
export function parseCsv(texto: string): CsvParseado {
  const semCrlf = texto.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const primeiraQuebra = semCrlf.indexOf("\n");
  const primeiraLinha = primeiraQuebra === -1 ? semCrlf : semCrlf.slice(0, primeiraQuebra);
  const delimitador = detectarDelimitador(primeiraLinha);

  const linhas: string[][] = [];
  let campo = "";
  let linhaAtual: string[] = [];
  let dentroDeAspas = false;
  let i = 0;

  const fecharCampo = () => {
    linhaAtual.push(campo);
    campo = "";
  };
  const fecharLinha = () => {
    fecharCampo();
    linhas.push(linhaAtual);
    linhaAtual = [];
  };

  while (i < semCrlf.length) {
    const c = semCrlf[i];

    if (dentroDeAspas) {
      if (c === '"') {
        if (semCrlf[i + 1] === '"') {
          campo += '"';
          i += 2;
          continue;
        }
        dentroDeAspas = false;
        i++;
        continue;
      }
      campo += c;
      i++;
      continue;
    }

    if (c === '"') {
      dentroDeAspas = true;
      i++;
      continue;
    }
    if (c === delimitador) {
      fecharCampo();
      i++;
      continue;
    }
    if (c === "\n") {
      fecharLinha();
      i++;
      continue;
    }
    campo += c;
    i++;
  }
  // Última linha sem quebra final no arquivo.
  if (campo.length > 0 || linhaAtual.length > 0) {
    fecharLinha();
  }

  const naoVazias = linhas.filter((linha) => linha.some((valor) => valor.trim() !== ""));
  const [cabecalho, ...resto] = naoVazias;

  return { cabecalho: (cabecalho ?? []).map((h) => h.trim()), linhas: resto };
}
