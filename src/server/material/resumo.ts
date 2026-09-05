import type { FonteDorMaterial, MaterialGeradoResumo, MotivoModelo, OrigemDadoMaterial } from "@/types/material";

/**
 * Projeção `materiais_gerados` → `MaterialGeradoResumo`, compartilhada pelas
 * rotas de material (listar, aprovar, PDF). Vive fora dos `route.ts` porque o
 * Next só aceita handlers/config como export de arquivo de rota.
 */

/** Colunas lidas em toda listagem de material — inclui as do PDF (0055). */
export const COLUNAS_MATERIAL_RESUMO =
  "id, versao, fonte_dor, dor_principal, origem_dado, atual, aprovado_por, aprovado_em, criado_em, " +
  "pdf_caminho, pdf_bytes, pdf_gerado_em, pdf_erro, motivo_modelo";

export interface LinhaMaterialGerado {
  id: string;
  versao: number;
  fonte_dor: FonteDorMaterial;
  dor_principal: string | null;
  origem_dado: OrigemDadoMaterial;
  atual: boolean;
  aprovado_por: string | null;
  aprovado_em: string | null;
  criado_em: string;
  pdf_caminho: string | null;
  pdf_bytes: number | null;
  pdf_gerado_em: string | null;
  pdf_erro: string | null;
  motivo_modelo: MotivoModelo | null;
  conteudo?: unknown;
  materiais_modelos?: { chave: string } | { chave: string }[] | null;
}

function chaveModeloDe(linha: LinhaMaterialGerado): string | null {
  const modelo = linha.materiais_modelos;
  if (!modelo) return linha.motivo_modelo?.chave ?? null;
  return Array.isArray(modelo) ? (modelo[0]?.chave ?? null) : modelo.chave;
}

export function paraResumoMaterial(linha: LinhaMaterialGerado): MaterialGeradoResumo {
  return {
    id: linha.id,
    versao: linha.versao,
    chave_modelo: chaveModeloDe(linha),
    fonte_dor: linha.fonte_dor,
    dor_principal: linha.dor_principal,
    origem_dado: linha.origem_dado,
    atual: linha.atual,
    aprovado_por: linha.aprovado_por,
    aprovado_em: linha.aprovado_em,
    criado_em: linha.criado_em,
    pdf_caminho: linha.pdf_caminho,
    pdf_bytes: linha.pdf_bytes,
    pdf_gerado_em: linha.pdf_gerado_em,
    pdf_erro: linha.pdf_erro,
    motivo_modelo: linha.motivo_modelo,
  };
}
