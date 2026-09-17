/**
 * As 4 tabs da Ficha (Fatia 3, 17/09/2026) — ordem do
 * João, literal: *"clica na ficha do cliente e ele exibe: tudo o que for
 * respectivo da sessão, o que está pendente, o que a gente precisa fazer de
 * forma objetiva."* E: *"dividir em tabs: sessão · croqui · holding ·
 * documentos. Não podem ocupar o mesmo espaço."*
 *
 * Correção do João (mesma rodada): as 4 tabs nascem **sempre visíveis** —
 * "não preciso ocultar". Sem chave de `configuracoes` para controlar quais
 * aparecem: uma coisa a menos para existir e para explicar. A tab Sessão
 * continua sendo a PADRÃO (a que abre primeiro) — é o foco de hoje.
 *
 * Esta peça só descreve o CATÁLOGO das 4 tabs — que gavetas
 * (`ChaveItemPasta`, ou chave avulsa como `"historico"`) cada uma reúne. Não
 * decide estado de nenhum item (isso continua em `derivar.ts`) nem desenha
 * nada (isso é `TabsFicha.tsx`).
 */
import type { ChaveItemPasta } from "./catalogo";

export type ChaveTabFicha = "sessao" | "documentos" | "croqui" | "holding";

export interface DefinicaoTabFicha {
  chave: ChaveTabFicha;
  rotulo: string;
  /** Gavetas (`ChaveItemPasta`) que esta tab reúne — a MESMA lista que já existia solta na Ficha. */
  itens: ChaveItemPasta[];
}

/**
 * Sessão é a tab padrão — "foca na sessão hoje" (pedido literal). Reúne as
 * gavetas que já viviam soltas na Ficha (`sessao`, `briefing`,
 * `relatorio_sv`, `analise_sessao`, `diagnostico_sv`, `material`) mais o
 * bloco "o que fazer agora" e o registro discreto do agente de WhatsApp —
 * esses dois não são gaveta, então não entram em `itens` (a página continua
 * desenhando-os direto dentro da tab Sessão).
 *
 * Croqui reúne a gaveta `croqui` (hoje representada só pelo cartão +
 * `/croquis/[id]`, sem gaveta própria — `itens` fica vazio de propósito, ver
 * `page.tsx`). Holding não tem gaveta nenhuma hoje: é stub rotulado.
 */
export const TABS_FICHA: DefinicaoTabFicha[] = [
  {
    chave: "sessao",
    rotulo: "Sessão",
    itens: ["sessao", "briefing", "relatorio_sv", "analise_sessao", "diagnostico_sv", "material"],
  },
  {
    chave: "documentos",
    rotulo: "Documentos",
    itens: ["documentos", "patrimonio"],
  },
  {
    chave: "croqui",
    rotulo: "Croqui",
    itens: [],
  },
  {
    chave: "holding",
    rotulo: "Holding",
    itens: [],
  },
];

/** Em qual tab uma gaveta (`ChaveItemPasta`) vive — o inverso de `itens` acima. */
export function tabDoItem(chave: ChaveItemPasta): ChaveTabFicha | null {
  for (const tab of TABS_FICHA) {
    if (tab.itens.includes(chave)) return tab.chave;
  }
  return null;
}

/**
 * O que um hash de deep-link SIGNIFICA — extraído do `useEffect` de
 * `jornadas/[id]/page.tsx` para virar função pura e testável (Fatia 3, teste
 * obrigatório #2: "os hashes de formulário/contato/histórico continuam
 * abrindo a gaveta certa"). A página continua sendo quem EXECUTA (mexe no
 * DOM, rola a tela); esta função só decide.
 *
 * `alias` e `chavesEmGaveta` chegam por parâmetro de propósito — são
 * `ALIAS_HASH`/`CHAVES_EM_GAVETA`, que o plano da Fatia 3 marca como
 * INTOCADOS (`page.tsx:148-155`); um arquivo de rota do Next não pode ser
 * importado por outro módulo, então o contrato fica na assinatura, não na
 * duplicação da tabela aqui.
 */
export type AcaoDeHash =
  | { tipo: "rolar-ate"; alvo: "enviar" }
  | { tipo: "abrir-details-na-tab"; tab: ChaveTabFicha; idDoBloco: string }
  | { tipo: "abrir-gaveta-na-tab"; tab: ChaveTabFicha; chave: string }
  | { tipo: "abrir-gaveta"; chave: ChaveItemPasta }
  | { tipo: "nenhuma" };

export function interpretarHashFicha(hashBruto: string, alias: Record<string, string>, chavesEmGaveta: ReadonlySet<string>): AcaoDeHash {
  if (!hashBruto) return { tipo: "nenhuma" };
  const chave = alias[hashBruto] ?? hashBruto;
  if (chave === "enviar") return { tipo: "rolar-ate", alvo: "enviar" };
  if (chave === "conversa") return { tipo: "abrir-details-na-tab", tab: "sessao", idDoBloco: "conversa" };
  if (chave === "croqui") return { tipo: "abrir-details-na-tab", tab: "croqui", idDoBloco: "croqui" };
  if (chave === "historico") return { tipo: "abrir-gaveta-na-tab", tab: "sessao", chave: "historico" };
  if (chavesEmGaveta.has(chave)) return { tipo: "abrir-gaveta", chave: chave as ChaveItemPasta };
  return { tipo: "nenhuma" };
}
