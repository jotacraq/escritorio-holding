/**
 * Tipos do domínio de conhecimento (Fase 2, B-4A — Módulo 4,
 * `0032_base_conhecimento.sql`). Mesmo espírito de `src/types/banco.ts` e
 * `src/types/agenda.ts`: interfaces de linha escritas à mão a partir da
 * migration, não geradas.
 *
 * Este arquivo é NOVO e exclusivo deste agente. Não depende de
 * `src/types/banco.ts` (fronteira de outro agente).
 *
 * CONFLITO C13 (docs/ARQUITETURA-FASE-2.md §6): `DesfechoObservado` tem
 * SOMENTE dois valores, de propósito. Não existe "não converteu" neste
 * domínio — ausência de apresentação de croqui gravada não é prova de perda.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums / uniões (espelham os `check`/`enum` de 0032)
// ---------------------------------------------------------------------------

export type TipoTranscricao = "sessao_viabilidade" | "apresentacao_croqui";

export const TIPOS_TRANSCRICAO: readonly TipoTranscricao[] = [
  "sessao_viabilidade",
  "apresentacao_croqui",
] as const;

/**
 * NUNCA adicionar 'nao_converteu' aqui. O banco também proíbe estruturalmente
 * (check constraint em `casos_conhecimento.desfecho_observado`) — este tipo é
 * só o espelho do lado do TypeScript, não a única trava.
 */
export type DesfechoObservado = "avancou_para_croqui" | "indefinido";

export const DESFECHOS_OBSERVADOS: readonly DesfechoObservado[] = [
  "avancou_para_croqui",
  "indefinido",
] as const;

// ---------------------------------------------------------------------------
// Linhas de tabela / view
// ---------------------------------------------------------------------------

export interface Transcricao {
  id: string;
  tipo: TipoTranscricao;
  arquivo_origem: string;
  rotulo: string;
  data_reuniao: string | null; // date "YYYY-MM-DD"
  consultor: string | null;
  jornada_id: string | null;
  conteudo: string;
  tamanho_bytes: number;
  sha256: string;
  importado_em: string;
  importado_por: string | null;
  origem_dado: "real" | "exemplo";
}

/** Mesma forma de `Transcricao`, sem `conteudo` — para listas/resultados de
 * busca, onde o texto completo de 3,4 MB nunca deveria trafegar por engano. */
export type TranscricaoResumo = Omit<Transcricao, "conteudo">;

export interface CasoConhecimentoLinha {
  caso_id: string;
  rotulo: string;
  desfecho_observado: DesfechoObservado;
  revisado_por: string | null;
  criado_em: string;
  atualizado_em: string;
  transcricao_sv_id: string;
  sv_data_reuniao: string | null;
  sv_consultor: string | null;
  transcricao_croqui_id: string | null;
  croqui_data_reuniao: string | null;
}

export interface ContagemDesfecho {
  desfecho_observado: DesfechoObservado;
  total: number;
}

export interface ResultadoBusca {
  transcricao_id: string;
  tipo: TipoTranscricao;
  arquivo_origem: string;
  rotulo: string;
  data_reuniao: string | null;
  relevancia: number;
  trecho: string;
}

/** Resposta de `GET /api/conhecimento/casos/[id]` — leitura lado a lado. */
export interface CasoComTranscricoes {
  caso: CasoConhecimentoLinha;
  sessao_viabilidade: Transcricao | null;
  apresentacao_croqui: Transcricao | null;
}

// ---------------------------------------------------------------------------
// Parâmetros de rota (zod — validação na borda, `src/app/api/conhecimento/**`)
// ---------------------------------------------------------------------------

export const ParametroBuscaSchema = z.object({
  termo: z.string().trim().min(1, "Informe um termo de busca.").max(200),
  tipo: z.enum(["sessao_viabilidade", "apresentacao_croqui"]).optional(),
  desfecho: z.enum(["avancou_para_croqui", "indefinido"]).optional(),
  limite: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
export type ParametroBusca = z.infer<typeof ParametroBuscaSchema>;

export const ParametroListaCasosSchema = z.object({
  desfecho: z.enum(["avancou_para_croqui", "indefinido"]).optional(),
  limite: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
export type ParametroListaCasos = z.infer<typeof ParametroListaCasosSchema>;

export const ParametroIdSchema = z.object({ id: z.string().uuid() });
