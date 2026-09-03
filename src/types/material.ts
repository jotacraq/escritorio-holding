/**
 * Contrato do material pós-sessão (ARQUITETURA-FASE-2.md §4.4). Dono: B-3B.
 *
 * `ConteudoMaterial`/`BlocoMaterial` espelham EXATAMENTE `PayloadMaterialPublico`/
 * `BlocoMaterialPublico` de `src/types/publico-ui.ts` (F-1A, fora da minha
 * fronteira) — mesmo vocabulário de bloco, porque é o mesmo JSON que
 * `app.payload_link_material` (0031) devolve para `/p/m/[token]`. Não duplicar
 * com nomes diferentes aqui seria recriar o drift que a 0028 documentou entre
 * `publico.ts` e `publico-ui.ts`.
 */

export type FonteDorMaterial = "ligacao" | "formulario" | "relatorio" | "nenhuma";
export type OrigemDadoMaterial = "real" | "exemplo";

export type BlocoMaterial =
  | { tipo: "titulo"; texto: string }
  | { tipo: "paragrafo"; texto: string }
  | { tipo: "lista"; itens: string[] }
  | { tipo: "citacao"; texto: string };

export interface ConteudoMaterial {
  titulo: string;
  blocos: BlocoMaterial[];
}

export interface MaterialGeradoResumo {
  id: string;
  versao: number;
  chave_modelo: string | null;
  fonte_dor: FonteDorMaterial;
  dor_principal: string | null;
  origem_dado: OrigemDadoMaterial;
  atual: boolean;
  aprovado_por: string | null;
  aprovado_em: string | null;
  criado_em: string;
}

export interface MaterialGeradoDetalhe extends MaterialGeradoResumo {
  conteudo: ConteudoMaterial;
}

// ---------------------------------------------------------------------------
// GET /api/jornadas/[id]/material
// ---------------------------------------------------------------------------

export interface RespostaListarMateriais {
  itens: MaterialGeradoResumo[];
  /** A versão `atual`, com conteúdo — `null` quando a jornada nunca gerou material. */
  atual: MaterialGeradoDetalhe | null;
}

// ---------------------------------------------------------------------------
// POST /api/jornadas/[id]/material
// ---------------------------------------------------------------------------

export interface CorpoGerarMaterial {
  forcar_regeracao?: boolean;
}

export interface RespostaGerarMaterial {
  /** `null` quando `fonte_dor='nenhuma'` — material padrão gerado sem chamada de IA (C11). */
  execucao_id: string | null;
  material_id: string;
  fonte_dor: FonteDorMaterial;
  chave_modelo: string;
  origem_dado: OrigemDadoMaterial;
}

// ---------------------------------------------------------------------------
// POST /api/jornadas/[id]/material/[materialId]/aprovar
// ---------------------------------------------------------------------------

export interface RespostaAprovarMaterial {
  material: MaterialGeradoResumo;
}
