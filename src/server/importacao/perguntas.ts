import type { MapaColunas, PerguntasSeminario } from "@/types/importacao";
import { ErroImportacao } from "./erros";

/**
 * "Pergunta do seminário: <cabeçalho>" — colunas do CSV que não alimentam
 * campo cadastral e cuja célula é a RESPOSTA da pessoa a uma pergunta da
 * pesquisa do seminário (ARQUITETURA-FASE-4.md §5.2). A PERGUNTA é o próprio
 * texto do cabeçalho.
 *
 * CONTRATO COM A TELA (`src/types/importacao.ts`, `PerguntasSeminario =
 * string[]`; `components/importacao/api.ts`): o multipart de `POST
 * /api/importacoes` traz o campo `perguntas_seminario` (JSON `string[]` de
 * cabeçalhos), SEPARADO de `mapa_colunas` — o contrato antigo continua
 * válido; sem o campo, comportamento idêntico ao de antes. A lista é salva
 * em `importacoes.perguntas_seminario` (0059) e `confirmar_importacao` grava
 * uma linha em `respostas_seminario` por pessoa × pergunta a partir de
 * `dados.bruto[<cabeçalho>]`, sem nunca sobrescrever resposta existente;
 * `importacoes.respostas_seminario` recebe a contagem gravada e volta em
 * `GET /api/importacoes/[id]`.
 */
export const MAX_PERGUNTAS_SEMINARIO = 50;
export const MAX_CHARS_PERGUNTA = 300; // mesmo CHECK de respostas_seminario.pergunta (0059)

/**
 * Valida a FORMA da lista: cabeçalho existe no arquivo, não está também
 * mapeado a campo cadastral (uma coluna é uma coisa só), sem repetição,
 * dentro do tamanho que o banco aceita. Devolve a lista limpa (trim, sem
 * duplicata) na ordem recebida; vazia → `null` (nada a gravar).
 */
export function validarPerguntasSeminario(
  perguntas: PerguntasSeminario | null | undefined,
  mapaColunas: MapaColunas,
  cabecalho: string[],
): PerguntasSeminario | null {
  if (!perguntas || perguntas.length === 0) return null;
  if (perguntas.length > MAX_PERGUNTAS_SEMINARIO) {
    throw new ErroImportacao(
      `No máximo ${MAX_PERGUNTAS_SEMINARIO} colunas podem ser marcadas como pergunta do seminário.`,
      "perguntas_excesso",
    );
  }
  const colunasDoArquivo = new Set(cabecalho);
  const limpas: string[] = [];
  for (const bruta of perguntas) {
    const coluna = typeof bruta === "string" ? bruta.trim() : "";
    if (!coluna) continue;
    if (!colunasDoArquivo.has(coluna)) {
      throw new ErroImportacao(
        `A coluna "${coluna}" marcada como pergunta do seminário não existe no cabeçalho do arquivo.`,
        "pergunta_coluna_inexistente",
      );
    }
    if (coluna in mapaColunas) {
      throw new ErroImportacao(
        `A coluna "${coluna}" está mapeada a um campo cadastral e também marcada como pergunta — escolha um dos dois.`,
        "pergunta_coluna_tambem_cadastral",
      );
    }
    if (coluna.length > MAX_CHARS_PERGUNTA) {
      throw new ErroImportacao(
        `O cabeçalho "${coluna.slice(0, 40)}…" tem mais de ${MAX_CHARS_PERGUNTA} caracteres — encurte a pergunta no arquivo.`,
        "pergunta_longa",
      );
    }
    if (!limpas.includes(coluna)) limpas.push(coluna);
  }
  return limpas.length > 0 ? limpas : null;
}
