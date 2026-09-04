/**
 * Tipos do domínio de CONSULTA PÚBLICA DE CNPJ (Fase 3 §4 —
 * `0044_consultas_cnpj.sql`). Mesmo espírito de `src/types/pesquisa-publica.ts`:
 * interface de linha escrita à mão a partir da migration, schema de corpo em
 * zod ao lado. Arquivo novo e exclusivo deste agente (backend-cnpj) — não
 * depende de `src/types/banco.ts` (fronteira de outro agente).
 *
 * LEIA ANTES DE ESTENDER: o `qsa` é PII de pessoa física de terceiro
 * (BLOQUEIO B21, docs/ARQUITETURA-FASE-3.md §4.3/§9) — mesma sensibilidade de
 * `patrimonio_itens`/`pesquisas_publicas`. Nunca exponha esta tabela em rota
 * pública/anônima.
 */

import { z } from "zod";

/** Uma linha de `consultas_cnpj`. Cache GLOBAL por CNPJ — não é por jornada. */
export interface ConsultaCnpj {
  cnpj: string;
  razao_social: string | null;
  nome_fantasia: string | null;
  situacao: string | null;
  data_situacao: string | null;
  capital_social: number | null;
  cnae_principal: string | null;
  cnae_descricao: string | null;
  data_abertura: string | null;
  municipio: string | null;
  uf: string | null;
  qsa: SocioCnpj[];
  fonte: "brasilapi";
  consultado_em: string | null;
  consultado_por: string | null;
  falha_em: string | null;
  falha_motivo: string | null;
  origem_dado: "real" | "exemplo";
}

/** Um sócio no `qsa`, campos crus da BrasilAPI que interessam à tela. */
export interface SocioCnpj {
  nome_socio: string;
  qualificacao_socio: string | null;
  data_entrada_sociedade: string | null;
  faixa_etaria: string | null;
}

/**
 * Corpo de `POST /api/cnpj/[cnpj]`. `jornada_id` é obrigatório — é o que
 * ancora o evento em `eventos_timeline` ("consulta a fonte externa sobre
 * cliente é ato auditável", §4.4.5). O servidor confirma que a jornada
 * existe antes de consultar a BrasilAPI.
 */
export const CorpoConsultarCnpjSchema = z.object({
  jornada_id: z.string().uuid(),
  forcar: z.boolean().optional().default(false),
});

export type CorpoConsultarCnpj = z.infer<typeof CorpoConsultarCnpjSchema>;

/**
 * Resultado tipado de uma tentativa de consulta à BrasilAPI — nunca lança
 * exceção para "CNPJ inexistente" ou "resposta inesperada", porque esses são
 * desfechos esperados do domínio, não bugs. `sucesso: false` sempre vem com
 * `motivo` e `statusHttp` (o código que a rota deve devolver ao cliente).
 */
export type ResultadoConsultaBrasilApi =
  | { sucesso: true; dados: DadosBrasilApi }
  | { sucesso: false; motivo: string; statusHttp: 404 | 502 | 503 };

/** Campos da BrasilAPI já mapeados para as colunas de `consultas_cnpj`. */
export interface DadosBrasilApi {
  razao_social: string | null;
  nome_fantasia: string | null;
  situacao: string | null;
  data_situacao: string | null;
  capital_social: number | null;
  cnae_principal: string | null;
  cnae_descricao: string | null;
  data_abertura: string | null;
  municipio: string | null;
  uf: string | null;
  qsa: SocioCnpj[];
  bruto: Record<string, unknown>;
}
