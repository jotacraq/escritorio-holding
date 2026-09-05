/**
 * Contrato do material pós-sessão (ARQUITETURA-FASE-2.md §4.4; Fase 4 §3 —
 * PDF, catálogo por dor/arquétipo). Dono: agente C (backend-material-pdf).
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

/** Onde a pontuação do modelo casou (§3.4). Nunca apresentado como análise. */
export type CriterioEscolhaModelo = "dor_principal" | "arquetipo" | "preocupacao" | "riscos";

/**
 * Por que o modelo X foi escolhido — gravado em `materiais_gerados.motivo_modelo`
 * (0055). A tela mostra "Modelo escolhido: Inventário (casou em: dor principal)".
 */
export interface MotivoModelo {
  chave: string;
  pontos: number;
  casou_em: CriterioEscolhaModelo[];
  /** Todos os modelos ativos pontuados, para a advogada conferir a escolha. */
  candidatos: Array<{ chave: string; pontos: number; casou_em: CriterioEscolhaModelo[] }>;
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
  /** Caminho no bucket privado — só existe em material aprovado (constraint 0055). Nunca é URL. */
  pdf_caminho: string | null;
  pdf_bytes: number | null;
  pdf_gerado_em: string | null;
  /** Último erro de geração do PDF; a aprovação NÃO é desfeita por isso (§3.3). */
  pdf_erro: string | null;
  motivo_modelo: MotivoModelo | null;
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
  motivo_modelo: MotivoModelo | null;
}

// ---------------------------------------------------------------------------
// PDF (Fase 4 §3.3) — resultado de gerar + subir + registrar
// ---------------------------------------------------------------------------

export type FontePdfMaterial = "neuetra" | "helvetica";

export type ResultadoPdfMaterial =
  | {
      estado: "gerado";
      pdf_caminho: string;
      pdf_bytes: number;
      pdf_gerado_em: string;
      /** `helvetica` = a Neuetra não carregou no servidor; erro já registrado em `erros_servidor`. */
      fonte: FontePdfMaterial;
    }
  | { estado: "falhou"; erro: string }
  /** Sem `SUPABASE_SERVICE_ROLE_KEY` no servidor — configuração ausente, não falha. */
  | { estado: "indisponivel"; motivo: string };

// ---------------------------------------------------------------------------
// POST /api/jornadas/[id]/material/[materialId]/aprovar
// POST /api/jornadas/[id]/material/[materialId]/pdf   (regerar)
// ---------------------------------------------------------------------------

export interface RespostaAprovarMaterial {
  material: MaterialGeradoResumo;
  pdf: ResultadoPdfMaterial;
}

// ---------------------------------------------------------------------------
// GET /api/jornadas/[id]/material/[materialId]/pdf — URL assinada (300 s) para a equipe
// ---------------------------------------------------------------------------

export interface RespostaUrlPdfMaterial {
  url: string;
  expira_em: string;
}

// ---------------------------------------------------------------------------
// Admin → Modelos de material (GET/POST /api/admin/materiais-modelos,
// PATCH /api/admin/materiais-modelos/[id])
// ---------------------------------------------------------------------------

export interface MaterialModeloAdmin {
  id: string;
  chave: string;
  versao: number;
  titulo: string;
  descricao: string | null;
  conteudo: ConteudoMaterial;
  /** Palavras-chave da dor (minúsculas). Casa por "contém" na dor principal. */
  dores: string[];
  /** Arquétipos (Protocolo 03). Nasce vazio — B36. */
  arquetipos: string[];
  /** Desempate: menor vence. */
  prioridade: number;
  ativo: boolean;
  /** `exemplo` = rascunho semeado por engenharia; não pode ser ativado até virar `real`. */
  origem_dado: OrigemDadoMaterial;
  criado_em: string;
}

export interface RespostaListarMateriaisModelos {
  itens: MaterialModeloAdmin[];
}

/** POST — SEMPRE cria versão nova da `chave` (nunca edita conteúdo em uso). */
export interface CorpoCriarMaterialModelo {
  chave: string;
  titulo: string;
  descricao?: string | null;
  conteudo: ConteudoMaterial;
  dores?: string[];
  arquetipos?: string[];
  prioridade?: number;
  /** Promove esta versão e despromove a anterior na mesma transação. */
  ativar?: boolean;
}

/** PATCH — só metadados de roteamento e revisão; conteúdo novo = POST. */
export interface CorpoEditarMaterialModelo {
  titulo?: string;
  descricao?: string | null;
  dores?: string[];
  arquetipos?: string[];
  prioridade?: number;
  /** Advogada marca o rascunho como revisado. */
  origem_dado?: OrigemDadoMaterial;
  ativar?: boolean;
}

export interface RespostaMaterialModelo {
  modelo: MaterialModeloAdmin;
}
