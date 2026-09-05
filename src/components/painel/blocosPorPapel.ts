/**
 * Re-export. A matriz bloco × papel MUDOU DE CASA para `src/lib/blocosPorPapel.ts`
 * (0069 / correção do pentest da Fase 5): ela deixou de ser regra de render e
 * virou regra de autorização — `GET /api/painel` importa a mesma matriz para
 * decidir o que sequer consulta. Um route handler não importa de
 * `src/components/`.
 *
 * Este arquivo fica para os imports existentes do front continuarem válidos
 * (`PainelDia.tsx`, `Travado.tsx`, `comunicacao/PendenciasSistema.tsx`). Código
 * novo importa de `@/lib/blocosPorPapel`.
 */
export {
  BLOCOS_DE_SISTEMA,
  BLOCOS_POR_PAPEL,
  CHAVES_BLOCO_PAINEL,
  PENDENCIAS_DE_PESSOA,
  blocoVisivel,
  blocosDoPapel,
  ehChaveBlocoPainel,
  pendenciaVisivelPara,
} from "@/lib/blocosPorPapel";
export type { ChaveBlocoPainel } from "@/lib/blocosPorPapel";
