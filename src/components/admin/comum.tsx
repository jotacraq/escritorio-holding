import type { ReactNode } from "react";
import { Selo } from "@/components/ui/Selo";

/**
 * Peças pequenas repetidas nas abas do Admin. Ficam aqui para toda aba falar
 * a mesma língua (mesmo selo de "ativa", mesma tabela-que-vira-lista).
 */

/** Selo de estado ativo/inativo — sempre com texto, nunca só cor. */
export function SeloAtivo({ ativo, rotuloAtivo = "Ativa", rotuloInativo = "Inativa" }: { ativo: boolean; rotuloAtivo?: string; rotuloInativo?: string }) {
  return ativo ? <Selo tom="verde">{rotuloAtivo}</Selo> : <Selo tom="neutro">{rotuloInativo}</Selo>;
}

/**
 * Tabela que, abaixo de 640px, vira lista de cartões: cada célula mostra o
 * `rotulo` da coluna como legenda (`data-rotulo` + `before:content`). Regra
 * da casa (design system §4): nunca scroll horizontal. Sem CSS global —
 * só utilitários, porque `globals.css` é de outro agente.
 */
export function Tabela({ children, resumo }: { children: ReactNode; resumo: string }) {
  // `overflow-x-auto` no embrulho: tabela larga (Equipe, 6 colunas) rola
  // dentro do cartão em vez de empurrar a página inteira para o lado.
  return (
    <div className="w-full overflow-x-auto">
      <table className="block w-full border-collapse sm:table">
        <caption className="sr-only">{resumo}</caption>
        {children}
      </table>
    </div>
  );
}

export function Thead({ children }: { children: ReactNode }) {
  return <thead className="hidden sm:table-header-group">{children}</thead>;
}

export function Tbody({ children }: { children: ReactNode }) {
  return <tbody className="block divide-y divide-linha sm:table-row-group">{children}</tbody>;
}

export function Tr({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <tr className={`block px-5 py-3 sm:table-row sm:px-0 sm:py-0 sm:hover:bg-papel ${className}`}>{children}</tr>;
}

export function Th({ children, className = "", srOnly = false }: { children: ReactNode; className?: string; srOnly?: boolean }) {
  return (
    <th scope="col" className={`border-b border-linha px-5 py-3 text-left text-rotulo font-medium uppercase text-tinta-fraca ${srOnly ? "sr-only" : ""} ${className}`}>
      {children}
    </th>
  );
}

/** Célula: no celular vira "Rótulo: valor" em linha; no desktop, célula comum de 44px. */
export function Td({ children, className = "", rotulo, acoes = false }: { children: ReactNode; className?: string; rotulo?: string; acoes?: boolean }) {
  return (
    <td
      data-rotulo={rotulo}
      className={`block py-1 text-sm text-tinta sm:table-cell sm:min-h-11 sm:px-5 sm:py-3 sm:align-middle ${
        rotulo ? "before:mr-2 before:text-legenda before:font-medium before:uppercase before:text-tinta-fraca before:content-[attr(data-rotulo)] sm:before:content-none" : ""
      } ${acoes ? "pt-2 sm:text-right" : ""} ${className}`}
    >
      {children}
    </td>
  );
}

/** Texto de apoio no topo de uma aba: o que ela faz por quem a usa. */
export function IntroAba({ children }: { children: ReactNode }) {
  return <p className="max-w-3xl text-corpo text-tinta-suave">{children}</p>;
}

/** Célula/valor "vazio é vazio". */
export const TRACO = "—";
