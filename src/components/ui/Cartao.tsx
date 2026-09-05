import type { HTMLAttributes, ReactNode } from "react";

interface CartaoProps extends HTMLAttributes<HTMLElement> {
  /** Rótulo pequeno em caixa alta acima do título (a "seção" do seminário). */
  rotulo?: string;
  titulo?: ReactNode;
  descricao?: ReactNode;
  /** Ação à direita do cabeçalho (botão compacto, link). */
  acao?: ReactNode;
  /** `sem` tira o padding do corpo (tabelas e listas com divisor). */
  preenchimento?: "normal" | "compacto" | "sem";
  /** Realce lateral por estado — o único lugar em que o cartão fala cor. */
  realce?: "latao" | "ambar" | "verde" | "vermelho";
  /** `section` por padrão; `article` para item de lista autocontido. */
  como?: "section" | "article" | "div";
  children?: ReactNode;
}

const PREENCHIMENTO = {
  normal: "p-5 sm:p-6",
  compacto: "p-4",
  sem: "",
} as const;

const REALCE = {
  latao: "border-l-4 border-l-[color:var(--latao-cta)]",
  ambar: "border-l-4 border-l-ambar-borda",
  verde: "border-l-4 border-l-[color:var(--verde)]",
  vermelho: "border-l-4 border-l-[color:var(--vermelho)]",
} as const;

/**
 * A superfície padrão: cartão branco, raio 1.25rem, sombra marrom difusa.
 * Cabeçalho opcional com rótulo caixa alta + título grande + ação — a
 * hierarquia do seminário aplicada a cada bloco de tela.
 */
export function Cartao({
  rotulo,
  titulo,
  descricao,
  acao,
  preenchimento = "normal",
  realce,
  como = "section",
  className = "",
  children,
  ...props
}: CartaoProps) {
  const Tag = como;
  const temCabecalho = Boolean(rotulo || titulo || descricao || acao);
  return (
    <Tag
      className={`rounded-cartao border border-linha bg-papel-elevado shadow-cartao ${realce ? REALCE[realce] : ""} ${className}`}
      {...props}
    >
      {temCabecalho && (
        <header
          className={`flex flex-wrap items-start justify-between gap-x-4 gap-y-2 ${
            preenchimento === "sem" ? "border-b border-linha px-5 py-4 sm:px-6" : `${PREENCHIMENTO[preenchimento]} ${children ? "pb-0 sm:pb-0" : ""}`
          }`}
        >
          <div className="min-w-0 flex-1">
            {rotulo && <p className="text-rotulo font-medium uppercase text-tinta-fraca">{rotulo}</p>}
            {titulo && <h2 className={`font-bold text-tinta ${rotulo ? "mt-1" : ""} text-subtitulo`}>{titulo}</h2>}
            {descricao && <p className="mt-1 text-sm text-tinta-suave">{descricao}</p>}
          </div>
          {/* `flex-wrap` (não `shrink-0`): várias ações/filtros no cabeçalho
              quebram para a linha de baixo em telas estreitas em vez de
              estourar a largura do cartão (achado G, 390px). */}
          {acao && <div className="flex flex-wrap items-center gap-2">{acao}</div>}
        </header>
      )}
      {children !== undefined && children !== null && (
        <div className={`${PREENCHIMENTO[preenchimento]} ${temCabecalho && preenchimento !== "sem" ? "pt-4 sm:pt-4" : ""}`}>{children}</div>
      )}
    </Tag>
  );
}
