/**
 * "A Pasta do Cliente" — de onde vem a rota (aba/hash) e a frase de ação de
 * cada item do catálogo. Extraído de `CabecalhoFicha.tsx` (onde nasceu, para
 * o chip "Próxima ação" da faixa vital) porque a Fase 2 (`PastaDoCliente.tsx`)
 * precisa exatamente da mesma tabela chave→aba para navegar ao clicar num
 * cartão — duplicar as 12 entradas em dois arquivos é como elas divergem.
 */
import type { ChaveItemPasta } from "./catalogo";

/**
 * `abaId` de cada item da Pasta do Cliente — para onde o clique (chip
 * "Próxima ação" ou cartão da Pasta) deve apontar via hash (`Abas`,
 * `deepLinkHash`). `transcricao`/`diagnostico_sv` não têm aba própria hoje —
 * apontam para a aba mais próxima (`sessao`) ou ficam sem link
 * (`diagnostico_sv` nunca chega a um estado clicável na prática).
 */
export const ABA_POR_ITEM_PASTA: Record<ChaveItemPasta, string> = {
  formulario: "formulario",
  ligacao: "ligacao",
  links: "links",
  briefing: "briefing",
  sessao: "sessao",
  transcricao: "sessao",
  analise_sessao: "analise-sessao",
  diagnostico_sv: "sessao",
  relatorio_sv: "relatorio",
  croqui: "croqui",
  material: "material",
  patrimonio: "patrimonio",
  familiares: "patrimonio",
  documentos: "documentos",
};

/**
 * Texto de ação por item da Pasta do Cliente — mesma frase que
 * `calcularPendencias()` já usava para os 5 itens em comum (verbo + item),
 * sem inventar vocabulário novo (Glossario.md).
 */
export const ACAO_POR_ITEM_PASTA: Record<ChaveItemPasta, string> = {
  formulario: "Preencher o formulário estratégico",
  ligacao: "Registrar a Ligação Estratégica (POP 03)",
  links: "Emitir os links pendentes",
  briefing: "Gerar o Briefing Estratégico",
  sessao: "Agendar a Sessão de Viabilidade",
  transcricao: "Registrar a Transcrição da Sessão",
  analise_sessao: "Gerar a Análise da Sessão",
  diagnostico_sv: "Aguardar recurso ainda não disponível",
  relatorio_sv: "Preencher o Relatório da Sessão",
  croqui: "Iniciar o Croqui",
  material: "Gerar o Material pós-sessão",
  patrimonio: "Cadastrar o Patrimônio",
  familiares: "Mapear os Familiares",
  documentos: "Anexar documentos (IR, contrato social)",
};

/**
 * Camada 2 (Gaveta) x Camada 3 (aba/hash) — arquitetura de informação, Fase 3
 * (`brain/Diário/2026-09-04.md`, "a regra das três camadas"). Primeira leva de
 * migração: 5 dos itens candidatos (Formulário, Ligação, Links, Documentos,
 * Patrimônio) — os mais simples e de menor risco. `familiares` NÃO entra: não
 * tem aba/componente próprio hoje (`ABA_POR_ITEM_PASTA.familiares` já aponta
 * para `patrimonio`, que é quem lista os familiares na prática); Relatório,
 * Briefing, Análise da Sessão e Material ficam de fora nesta rodada por
 * decisão de escopo, não por limitação técnica.
 *
 * `ConteudoPastaOuAbas` consulta este set para decidir, por chave de hash, se
 * abre a Gaveta (item migrado) ou mantém o comportamento antigo de `Abas`
 * (item não migrado) — um único lugar decide, em vez de duas listas que podem
 * divergir.
 */
export const ITENS_EM_GAVETA: ReadonlySet<ChaveItemPasta> = new Set([
  "formulario",
  "ligacao",
  "links",
  "documentos",
  "patrimonio",
]);
