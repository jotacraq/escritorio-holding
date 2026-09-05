import { CAMPOS_IMPORTAVEIS, type CampoImportavel, type ResultadoLinhaImportacao } from "@/types/importacao";
import type { TomSelo } from "@/components/ui/Selo";

/** Rótulo em PT-BR de cada campo do domínio que uma coluna do CSV pode alimentar. */
export const ROTULO_CAMPO: Record<CampoImportavel, string> = {
  nome: "Nome (obrigatório)",
  email: "E-mail",
  telefone: "Telefone",
  cidade: "Cidade",
  uf: "UF",
  profissao: "Profissão",
  faixa_etaria: "Faixa etária",
  estado_civil: "Estado civil",
  observacoes: "Observações",
  dias_assistidos: "Dias assistidos (0 a 3)",
};

export const CAMPOS_ORDENADOS: CampoImportavel[] = [...CAMPOS_IMPORTAVEIS];

/**
 * Valor especial do `<select>` de destino para "Pergunta do seminário:
 * <cabeçalho>" (Fase 4 §5.2). Nunca entra em `MapaColunas` — vive na lista
 * `perguntas` do assistente e viaja em campo próprio do multipart.
 */
export const DESTINO_PERGUNTA = "__pergunta_seminario__";

/** Rótulo do destino "pergunta do seminário" para uma coluna. */
export function rotuloPergunta(cabecalho: string): string {
  return `Pergunta do seminário: ${cabecalho || "(sem nome)"}`;
}

export const ROTULO_RESULTADO: Record<ResultadoLinhaImportacao, string> = {
  pessoa_nova: "Pessoa nova",
  pessoa_existente: "Pessoa já existente",
  jornada_nova: "Jornada nova",
  ignorada_jornada_aberta: "Ignorada — jornada já aberta",
  erro: "Erro",
};

/** O que acontece com a linha ao confirmar — a explicação humana por trás de cada resultado. */
export const EXPLICACAO_RESULTADO: Record<ResultadoLinhaImportacao, string> = {
  pessoa_nova: "Entra como pessoa nova, com jornada aberta nesta edição.",
  pessoa_existente: "Já participou desta edição — não duplica, nada muda para ela.",
  jornada_nova: "Pessoa já cadastrada; ganha uma jornada nova nesta edição.",
  ignorada_jornada_aberta: "Já tem uma jornada em andamento — fica de fora para não atropelar o que está rolando.",
  erro: "Linha sem nome ou com dado inválido — não entra; corrija no arquivo e importe de novo.",
};

export const TOM_RESULTADO: Record<ResultadoLinhaImportacao, TomSelo> = {
  pessoa_nova: "verde",
  pessoa_existente: "neutro",
  jornada_nova: "azul",
  ignorada_jornada_aberta: "ambar",
  erro: "vermelho",
};

/** `classificarLinhas` grava `duplicata_da_linha:N` como motivo técnico quando a
 * duplicata é dentro do próprio arquivo — aqui vira frase legível. */
export function formatarMotivo(motivo: string | null): string {
  if (!motivo) return "—";
  const duplicata = motivo.match(/^duplicata_da_linha:(\d+)$/);
  if (duplicata) return `Mesma pessoa da linha ${duplicata[1]} deste arquivo.`;
  return motivo;
}

/** Plural simples para as frases de confirmação e de resultado. */
export function frasePlural(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** Tamanho de arquivo legível ("1,2 MB", "340 KB"). */
export function formatarTamanho(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

/** As etapas do assistente — a MESMA lista nas telas "nova" e "detalhe",
 * para a pessoa reconhecer onde está. */
export const PASSOS_IMPORTACAO = [
  { id: "arquivo", rotulo: "Enviar arquivo", descricao: "Escolha a edição do seminário e o CSV exportado da planilha." },
  { id: "mapear", rotulo: "Mapear colunas", descricao: "Diga qual coluna do arquivo é o nome, o e-mail, o telefone…" },
  { id: "conferir", rotulo: "Conferir", descricao: "Veja uma amostra com o mapeamento aplicado antes de gerar a prévia." },
  { id: "confirmar", rotulo: "Confirmar", descricao: "A prévia mostra o que entra e o que fica de fora. Só grava quando você confirmar." },
] as const;

export type PassoImportacao = (typeof PASSOS_IMPORTACAO)[number]["id"];
