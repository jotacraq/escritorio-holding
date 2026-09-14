import type { HTMLAttributes, ReactNode } from "react";

interface QuadroProps extends HTMLAttributes<HTMLElement> {
  /** Rótulo pequeno em caixa alta, cinza — o nome do quadro, não um título de marca. */
  rotulo: string;
  /** Ação curta à direita do rótulo (selo, contagem) — nunca um botão decorado. */
  acao?: ReactNode;
  /** `article` para item de uma lista de quadros; `section` (default) para quadro autocontido. */
  como?: "section" | "article" | "div";
  children?: ReactNode;
}

/**
 * Quadro chapado — a unidade visual do painel denso de condução de sessão
 * (`/sessoes/[id]/conduzir`, pedido do Marcio, 11-14/09: "tela única, todas
 * as informações à mostra, modelo do Juliano" — referência: borda fina,
 * rótulo pequeno maiúsculo cinza, conteúdo direto, sem sombra, sem
 * gradiente, sem `border-l-4` colorida, sem ícone decorativo).
 *
 * Deliberadamente DISTINTO de `Cartao`: `Cartao` é a superfície padrão do
 * resto do sistema (sombra marrom, raio grande, realce lateral colorido) —
 * `Quadro` NUNCA usa `shadow-cartao` nem `realce`. Não é upgrade nem
 * substituto de `Cartao`; é o vocabulário de UMA tela específica, a tela
 * que o Marcio pediu "direta, objetiva, sem enfeite, como sistema
 * tradicional". Não usar fora de `/sessoes/[id]/conduzir`.
 *
 * Cor só onde significa: o rótulo do quadro é sempre `text-tinta-fraca`,
 * nunca colorido — quem carrega cor é o CONTEÚDO (um selo de alerta, uma
 * observação âmbar), nunca o wrapper.
 */
export function Quadro({ rotulo, acao, como = "section", className = "", children, ...props }: QuadroProps) {
  const Tag = como;
  return (
    <Tag className={`flex flex-col gap-2 rounded-controle border border-linha bg-papel-elevado p-3 ${className}`} {...props}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-rotulo font-medium uppercase tracking-wide text-tinta-fraca">{rotulo}</p>
        {acao}
      </div>
      {children}
    </Tag>
  );
}
