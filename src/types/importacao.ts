/**
 * Tipos da importação de leads por edição de seminário (Fase 2, B-2A).
 * Espelha `supabase/migrations/0035_importacao.sql`. Mesmo espírito de
 * `src/types/banco.ts`: interfaces de linha escritas à mão a partir da
 * migration, não geradas — mas em ARQUIVO NOVO e exclusivo deste agente
 * (não editar `src/types/banco.ts`, fronteira de outro agente).
 *
 * Ver docs/ARQUITETURA-FASE-2.md §4.6 e BLOQUEIO B18: não existe layout fixo
 * de CSV — o operador casa coluna do arquivo -> campo do domínio na tela. O
 * conjunto de CAMPOS é fixo (são as colunas reais de `pessoas`/
 * `participacoes_seminario`); os NOMES DAS COLUNAS DO ARQUIVO são livres.
 */

/** Campos do domínio que uma coluna do CSV pode alimentar. 'nome' é obrigatório. */
export const CAMPOS_IMPORTAVEIS = [
  "nome",
  "email",
  "telefone",
  "cidade",
  "uf",
  "profissao",
  "faixa_etaria",
  "estado_civil",
  "observacoes",
  "dias_assistidos",
] as const;

export type CampoImportavel = (typeof CAMPOS_IMPORTAVEIS)[number];

/** Cabeçalho do CSV (texto exato da coluna) -> campo do domínio. Salvo como está,
 * para reuso num upload futuro (mesma edição ou outra, mesmo layout de planilha). */
export type MapaColunas = Record<string, CampoImportavel>;

/**
 * Fase 4, §5.2 (`docs/ARQUITETURA-FASE-4.md`): qualquer coluna do arquivo que
 * NÃO alimenta campo cadastral pode virar "Pergunta do seminário: <cabeçalho>"
 * — a resposta de cada linha é gravada em `respostas_seminario` ligada à
 * pessoa e à edição. O front envia a lista de cabeçalhos no campo
 * `perguntas_seminario` do `multipart/form-data` (JSON `string[]`), SEPARADO
 * de `mapa_colunas`, para o contrato antigo continuar válido: um servidor
 * que ainda não conhece o campo simplesmente o ignora, e a coluna continua
 * guardada em `dados.bruto` da linha (nada se perde). Quando o servidor
 * expuser `perguntas_seminario`/`respostas_seminario` na `Importacao`, a
 * tela de detalhe mostra o que foi gravado.
 */
export type PerguntasSeminario = string[];

export type StatusImportacao = "previa" | "confirmada" | "cancelada";

export type ResultadoLinhaImportacao =
  | "pessoa_nova"
  | "pessoa_existente"
  | "jornada_nova"
  | "ignorada_jornada_aberta"
  | "erro";

export interface Importacao {
  id: string;
  edicao_id: string;
  arquivo_nome: string;
  mapa_colunas: MapaColunas;
  status: StatusImportacao;
  total_linhas: number;
  pessoas_novas: number;
  pessoas_existentes: number;
  jornadas_novas: number;
  ignoradas: number;
  com_erro: number;
  confirmada_em: string | null;
  confirmada_por: string | null;
  criado_em: string;
  criado_por: string | null;
  /** Cabeçalhos mapeados como "Pergunta do seminário" (§5.2). Ausente em
   * servidor que ainda não grava respostas; `null` quando nenhuma coluna
   * foi marcada. Tolerante nos dois casos. */
  perguntas_seminario?: PerguntasSeminario | null;
  /** Quantidade de respostas do seminário gravadas ao confirmar (§5.2).
   * Ausente/`null` = o servidor ainda não conta isso — a tela mostra "—". */
  respostas_seminario?: number | null;
}

/** Valores já normalizados (trim, e-mail minúsculo, telefone em E.164, etc.) —
 * única fonte que `public.confirmar_importacao` lê para gravar. */
export interface DadosNormalizadosLinha {
  nome: string;
  email: string | null;
  telefone: string | null;
  cidade: string | null;
  uf: string | null;
  profissao: string | null;
  faixa_etaria: string | null;
  estado_civil: string | null;
  observacoes: string | null;
  /** 0-3 (mesma faixa de `participacoes_seminario.dias_assistidos`). */
  dias_assistidos: number | null;
}

export interface DadosLinhaImportacao {
  /** Exatamente como leu do arquivo — cabeçalho original (TODAS as colunas,
   * mapeadas ou não) -> valor bruto da célula. É o rastro até a linha de origem. */
  bruto: Record<string, string>;
  normalizado: DadosNormalizadosLinha;
  /** Avisos não bloqueantes (ex.: telefone com formato irreconhecível, descartado
   * sem barrar a linha inteira). Ausente quando não há nenhum. */
  avisos?: string[];
}

export interface ImportacaoLinha {
  id: string;
  importacao_id: string;
  numero: number;
  dados: DadosLinhaImportacao;
  resultado: ResultadoLinhaImportacao;
  motivo: string | null;
  pessoa_id: string | null;
  jornada_id: string | null;
  criado_em: string;
}
