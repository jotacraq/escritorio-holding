/**
 * "A Pasta do Cliente" — de onde vem a rota (aba/hash) e a frase de ação de
 * cada item do catálogo. Extraído de `CabecalhoFicha.tsx` (onde nasceu, para
 * o chip "Próxima ação" da faixa vital) porque a Fase 2 (`PastaDoCliente.tsx`)
 * precisa exatamente da mesma tabela chave→aba para navegar ao clicar num
 * cartão — duplicar as 12 entradas em dois arquivos é como elas divergem.
 */
import { rotulo, titleDe } from "@/lib/vocabulario";
import type { ChaveItemPasta } from "./catalogo";

/**
 * `abaId` de cada item da Pasta do Cliente — para onde o clique (chip
 * "Próxima ação" ou cartão da Pasta) deve apontar via hash (`Abas`,
 * `deepLinkHash`). `transcricao` não tem aba própria hoje — aponta para a
 * mais próxima (`sessao`). `diagnostico_sv` ganhou página própria na Fase 4
 * (`jornadas/[id]/diagnostico`, agente H) — não é hash de `Abas` da Ficha,
 * mas o mesmo campo serve de âncora para `ConteudoPastaOuAbas` decidir a
 * navegação (ver uso em `PastaDoCliente.tsx`).
 */
export const ABA_POR_ITEM_PASTA: Record<ChaveItemPasta, string> = {
  formulario: "formulario",
  ligacao: "ligacao",
  links: "links",
  briefing: "briefing",
  sessao: "sessao",
  transcricao: "sessao",
  analise_sessao: "analise-sessao",
  diagnostico_sv: "diagnostico",
  relatorio_sv: "relatorio",
  croqui: "croqui",
  material: "material",
  patrimonio: "patrimonio",
  familiares: "patrimonio",
  documentos: "documentos",
};

/**
 * Texto de ação por item da Pasta do Cliente — verbo + item, sem inventar
 * vocabulário novo (Glossario.md).
 *
 * Fase 5, lei de texto (§2 + §9.2): **verbo curto (≤ 3 palavras) e nenhuma
 * sigla no fluxo.** O nome longo do artefato e a sigla do método ("POP 03",
 * "IR", "SV") vivem em `TITULO_ACAO_ITEM_PASTA`, que vai para o `title` do
 * elemento — quem conhece o termo antigo encontra; quem não conhece não
 * tropeça. Eram 48 das 158 palavras visíveis da Ficha (medição do M5).
 */
export const ACAO_POR_ITEM_PASTA: Record<ChaveItemPasta, string> = {
  formulario: "Preencher o formulário",
  ligacao: "Registrar a ligação",
  links: "Emitir os links",
  briefing: "Gerar o Briefing",
  sessao: "Agendar a sessão",
  transcricao: "Registrar a transcrição",
  analise_sessao: "Gerar a análise",
  diagnostico_sv: "Montar o diagnóstico",
  relatorio_sv: "Preencher o relatório",
  croqui: "Iniciar o croqui",
  material: "Gerar o material",
  patrimonio: "Cadastrar o patrimônio",
  familiares: "Mapear os familiares",
  documentos: "Anexar documentos",
};

/**
 * O nome inteiro por trás do verbo curto — SÓ para `title`/`aria-describedby`.
 * Nunca renderizado dentro do fluxo (§2). Montado a partir do dicionário único
 * (`lib/vocabulario.ts`) para a sigla não ser redigitada aqui.
 */
export const TITULO_ACAO_ITEM_PASTA: Partial<Record<ChaveItemPasta, string>> = {
  formulario: `${rotulo("pop02")} · ${titleDe("pop02")}`,
  ligacao: `${rotulo("pop03")} · ${titleDe("pop03")}`,
  briefing: `${rotulo("briefing_entregavel")} · ${titleDe("briefing_etapa")}`,
  sessao: rotulo("sessao_viabilidade"),
  transcricao: `Transcrição da ${rotulo("sessao_viabilidade")}`,
  analise_sessao: `Análise da ${rotulo("sessao_viabilidade")}`,
  diagnostico_sv: `${rotulo("diagnostico")} da ${rotulo("sessao_viabilidade")}`,
  relatorio_sv: `Relatório da ${rotulo("sessao_viabilidade")}`,
  croqui: rotulo("croqui"),
  material: "Material pós-sessão",
  documentos: `${rotulo("imposto_renda")} e contrato social`,
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

/**
 * Hash de navegação de um item da Pasta/faixa vital para dentro das abas da
 * Ficha 360 (`diagnostico_sv` → `#diagnostico`, aba que existe sempre que
 * `podeVerPatrimonio`, ver `jornadas/[id]/page.tsx`). Função em vez de acesso
 * direto ao record só para dar um único ponto de leitura — mesma razão de
 * `ABA_POR_ITEM_PASTA` existir.
 */
export function caminhoItemPasta(chave: ChaveItemPasta): string {
  return `#${ABA_POR_ITEM_PASTA[chave]}`;
}
