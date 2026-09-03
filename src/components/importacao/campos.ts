import { CAMPOS_IMPORTAVEIS, type CampoImportavel, type ResultadoLinhaImportacao } from "@/types/importacao";

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

export const ROTULO_RESULTADO: Record<ResultadoLinhaImportacao, string> = {
  pessoa_nova: "Pessoa nova",
  pessoa_existente: "Pessoa já existente",
  jornada_nova: "Jornada nova",
  ignorada_jornada_aberta: "Ignorada — jornada já aberta",
  erro: "Erro",
};

export const TOM_RESULTADO: Record<ResultadoLinhaImportacao, "verde" | "vermelho" | "azul" | "neutro"> = {
  pessoa_nova: "verde",
  pessoa_existente: "neutro",
  jornada_nova: "azul",
  ignorada_jornada_aberta: "neutro",
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
