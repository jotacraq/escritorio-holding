/**
 * "A Pasta do Cliente" — catálogo declarativo dos artefatos que uma jornada
 * pode ter. Antes desta peça, o único inventário do sistema era
 * `calcularPendencias()` (`components/ui/pendencias.ts`), que lista só 5
 * itens fixos e fica mudo sobre os outros 9 artefatos que o sistema produz
 * (Croqui, Patrimônio, Documentos, Relatório, Material, Links, Transcrição,
 * Análise da Sessão, Familiares) — visíveis só para quem está no grupo de
 * abas certo (`Abas.tsx`, `abasVisiveis = grupoAtivo ? grupoAtivo.abas :
 * abas`).
 *
 * Este catálogo não decide estado (isso é `derivar.ts`) — só descreve o que
 * existe, com que nome de negócio e de que procedência.
 */

export type ProcedenciaItemPasta = "recebido" | "produzido" | "gerado_ia";

export interface ItemCatalogoPasta {
  chave: ChaveItemPasta;
  rotulo: string;
  procedencia: ProcedenciaItemPasta;
  /**
   * Item de patrimônio pesado (PII, CLAUDE.md) — omitido INTEIRAMENTE do
   * array de `derivarPasta()` para quem não tem `podeVerPatrimonio`. Nunca
   * aparece como "bloqueado"/"sem permissão": é regra de segurança (mesma
   * classe do achado de pentest sobre `temAnaliseSessao` em
   * `jornadas/[id]/page.tsx`), não de UX — vazar a EXISTÊNCIA do item já é
   * vazar metadado que o papel não deveria saber.
   */
  requerPatrimonio: boolean;
}

export type ChaveItemPasta =
  | "formulario"
  | "ligacao"
  | "links"
  | "briefing"
  | "sessao"
  | "transcricao"
  | "analise_sessao"
  | "diagnostico_sv"
  | "relatorio_sv"
  | "croqui"
  | "material"
  | "patrimonio"
  | "familiares"
  | "documentos";

/**
 * Nomes de negócio reusados tal e qual das abas/telas existentes — nenhum
 * vocabulário novo (regra do plano; ver `Glossario.md`):
 * - "Formulário" (aba `formulario`), "Ligação" (aba `ligacao`, POP 03/03-B),
 *   "Links" (aba `links`), "Briefing" (aba `briefing`, `BriefingAba.tsx`),
 *   "Sessão" (aba `sessao`), "Transcrição da Sessão" (evento de timeline
 *   `transcricao`, `0045_transcricao_sv.sql`), "Análise da Sessão" (aba
 *   `analise-sessao`, `AnaliseSessaoAba.tsx`), "Relatório" (aba `relatorio`,
 *   `RelatorioAba.tsx`), "Croqui" (aba `croqui`), "Material" (aba `material`,
 *   `MaterialAba.tsx`), "Patrimônio" (aba `patrimonio`), "Familiares"
 *   (`Familiar[]` da Ficha 360), "Documentos" (aba `documentos`).
 * - "Diagnóstico da SV": não existe aba/tela hoje — nome herdado do plano
 *   arquitetural bloqueado (B31, Diário 2026-09-04) porque ainda não tem
 *   vocabulário de produto próprio no sistema.
 */
export const CATALOGO_PASTA: ItemCatalogoPasta[] = [
  { chave: "formulario", rotulo: "Formulário", procedencia: "produzido", requerPatrimonio: false },
  { chave: "ligacao", rotulo: "Ligação", procedencia: "produzido", requerPatrimonio: false },
  { chave: "links", rotulo: "Links", procedencia: "produzido", requerPatrimonio: false },
  { chave: "briefing", rotulo: "Briefing", procedencia: "gerado_ia", requerPatrimonio: false },
  { chave: "sessao", rotulo: "Sessão", procedencia: "produzido", requerPatrimonio: false },
  { chave: "transcricao", rotulo: "Transcrição da Sessão", procedencia: "recebido", requerPatrimonio: true },
  { chave: "analise_sessao", rotulo: "Análise da Sessão", procedencia: "gerado_ia", requerPatrimonio: true },
  // Ver nota de bloqueio no topo de `derivar.ts` — sempre 'ainda_nao' por ora.
  { chave: "diagnostico_sv", rotulo: "Diagnóstico da SV", procedencia: "gerado_ia", requerPatrimonio: true },
  { chave: "relatorio_sv", rotulo: "Relatório", procedencia: "produzido", requerPatrimonio: true },
  { chave: "croqui", rotulo: "Croqui", procedencia: "gerado_ia", requerPatrimonio: true },
  { chave: "material", rotulo: "Material", procedencia: "gerado_ia", requerPatrimonio: false },
  { chave: "patrimonio", rotulo: "Patrimônio", procedencia: "produzido", requerPatrimonio: true },
  { chave: "familiares", rotulo: "Familiares", procedencia: "produzido", requerPatrimonio: true },
  { chave: "documentos", rotulo: "Documentos", procedencia: "recebido", requerPatrimonio: true },
];
