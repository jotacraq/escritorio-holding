"use client";

import type { CategoriaInventarioMencionado, InventarioParaPainel, ItemInventarioRecentePainel } from "@/types/copiloto";

/** Mesmo padrão de `PainelTranscricao.tsx`/`Coluna.tsx` (WCAG 2.1.1 — container
 * `overflow-y-auto` exige foco por teclado). `jsx-a11y/no-noninteractive-tabindex`
 * reporta erro em `tabIndex={0}` LITERAL num `role="region"` estático, mesmo
 * sendo o padrão que a própria WCAG pede — uma constante nomeada (não-literal
 * do ponto de vista do linter) sai do falso positivo sem mudar o
 * comportamento em runtime (é sempre `0`). */
const TAB_INDEX_ROLAVEL = 0;

const ROTULO_CATEGORIA_INVENTARIO: Record<CategoriaInventarioMencionado, string> = {
  imovel: "Imóveis",
  empresa: "Empresas",
  investimento: "Investimentos",
  outro: "Outros",
};

/**
 * Fase 13, FE-3 — EXTRAÍDO de `PainelCopiloto.tsx` (que tinha 2.094 linhas e
 * carregava esta folha junto com outras 30). Comportamento idêntico ao de
 * lá; o que MUDOU é só o container, e por dois motivos nomeados:
 *
 *  1. **O rótulo saiu daqui.** No layout anterior a COL 3 empilhava
 *     transcrição + inventário, e o `<p>Inventário · N</p>` que ficava em
 *     `PainelCopiloto.tsx` era o único jeito de dizer de quem era o bloco de
 *     baixo. Agora o nome (e a contagem) vivem no RÓTULO DA ABA
 *     (`AbasColuna3`) — repetir aqui seria o mesmo fato em dois lugares na
 *     mesma célula de 28% de largura.
 *  2. **O painel virou a superfície de rolagem da célula.** A `Coluna` da
 *     COL 3 deixou de ser `rolavel` (Fase 13, §A.2: fecha o duplo-scroll
 *     vivo que a F3 tinha fechado na COL 1 e reaberto aqui). Quem rola é o
 *     painel ATIVO — este, o da transcrição ou a região própria da Ficha —,
 *     nunca a célula. Uma superfície por célula, o contrato de `Coluna.tsx`
 *     cumprido sem exceção.
 *
 * Contagens por categoria (`IMÓVEIS · 6`) + os 5 itens mais recentes com a
 * citação literal que os prova — layout do pedido do dono, 17/09. `posse:
 * "incerta"` nunca soma no total da categoria (regra do tipo: "a confirmar",
 * nunca somado) — aparece só como contagem separada, mesmo padrão do resumo
 * que já vai para a IA (`ResumoInventarioAcumulado`).
 */
export function PainelInventario({ inventario }: { inventario: InventarioParaPainel }) {
  const categorias = inventario.resumo.por_categoria.filter((c) => c.contagem_propria > 0 || c.contagem_incerta > 0);
  const { total_itens_proprios: proprios, total_itens_incertos: incertos } = inventario.resumo;

  return (
    <div
      role="region"
      aria-label="Inventário da sessão"
      tabIndex={TAB_INDEX_ROLAVEL}
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-controle border border-linha bg-papel-elevado px-3 py-2"
    >
      {/* Fatia 2 — a mentira por omissão era "Inventário (0)" com 31 itens
       * captados: o rótulo da aba já soma próprios+incertos (responde "tem
       * coisa aqui?"), e esta linha responde a segunda pergunta, densa:
       * quanto já foi captado vs. quanto ainda precisa de confirmação da
       * titularidade. Some sozinha se não há nada captado ainda (mesma regra
       * de "vazio é vazio" — nunca "0 captados · 0 confirmados"). */}
      {proprios + incertos > 0 && (
        <p className="shrink-0 text-sm text-tinta">
          <span className="font-bold tabular-nums">{proprios + incertos}</span> captados ·{" "}
          <span className="font-bold tabular-nums">{proprios}</span> confirmados ·{" "}
          <span className="font-bold tabular-nums">{incertos}</span> a confirmar
        </p>
      )}

      {categorias.length === 0 ? (
        <p className="text-sm text-tinta-suave">Nenhum item de patrimônio mencionado ainda nesta sessão.</p>
      ) : (
        <ul className="flex shrink-0 flex-col gap-1">
          {categorias.map((c) => (
            <li key={c.categoria} className="flex items-baseline justify-between text-sm text-tinta">
              <span className="font-medium uppercase tracking-wide text-tinta-fraca">{ROTULO_CATEGORIA_INVENTARIO[c.categoria]}</span>
              {/* Quando nada está confirmado ainda (`contagem_propria === 0`),
               * o destaque nunca pode ser um "0" em negrito ao lado de itens
               * reais captados — inverte a ênfase para o número que importa
               * agora: o captado, ainda a confirmar. */}
              {c.contagem_propria > 0 ? (
                <span className="font-bold tabular-nums">
                  {c.contagem_propria}
                  {c.contagem_incerta > 0 && <span className="ml-1.5 font-normal text-tinta-fraca">· {c.contagem_incerta} a confirmar</span>}
                </span>
              ) : (
                <span className="font-normal tabular-nums text-tinta-suave">
                  <span className="font-bold text-tinta">{c.contagem_incerta}</span> a confirmar
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {inventario.recentes.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-dashed border-linha pt-2.5">
          <p className="text-legenda font-medium uppercase text-tinta-fraca">Mencionados recentemente</p>
          <ul className="flex flex-col gap-2">
            {inventario.recentes.map((item, i) => (
              <ItemInventarioRecente key={i} item={item} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ItemInventarioRecente({ item }: { item: ItemInventarioRecentePainel }) {
  return (
    <li className="flex flex-col gap-0.5">
      <p className="text-sm text-tinta">
        {item.descricao}
        {item.posse === "incerta" && <span className="ml-1.5 text-legenda text-tinta-fraca">(a confirmar)</span>}
        {item.posse === "terceiro" && <span className="ml-1.5 text-legenda text-tinta-fraca">(de terceiro)</span>}
      </p>
      <p className="text-legenda italic text-tinta-fraca">&ldquo;{item.evidencia}&rdquo;</p>
    </li>
  );
}

/** Total que o rótulo da aba "Inventário" mostra — próprios + a confirmar, a
 * MESMA soma que a linha de resumo do painel exibe. Exportado para
 * `PainelCopiloto.tsx` montar a faixa de abas sem redigitar a regra (dois
 * lugares somando "o que tem aqui dentro" é como eles divergem). */
export function totalDoInventario(inventario: InventarioParaPainel): number {
  return inventario.resumo.total_itens_proprios + inventario.resumo.total_itens_incertos;
}
