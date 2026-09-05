import type { ReactNode } from "react";

/**
 * Toda funcionalidade não pronta carrega este selo. Stub sem selo é
 * reprovação automática na revisão final (CLAUDE.md do projeto).
 */
export function SeloStub({ texto, className = "" }: { texto: string; className?: string }) {
  return (
    <div
      role="status"
      className={`flex items-start gap-2.5 rounded-controle border border-ambar-borda bg-ambar-fraco px-3.5 py-2.5 text-sm text-[color:var(--ambar)] ${className}`}
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 fill-current">
        <path d="M10 1.5 19 17H1L10 1.5Zm0 5.4a1 1 0 0 0-1 1v3.4a1 1 0 1 0 2 0V7.9a1 1 0 0 0-1-1Zm0 7.2a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Z" />
      </svg>
      <span className="font-medium leading-snug">{texto}</span>
    </div>
  );
}

/** Marca uma linha de seed (`origem_dado = 'exemplo'`) para não confundir com cliente real. */
export function SeloDadoExemplo({ className = "" }: { className?: string }) {
  return (
    <span
      title="Este registro é dado de exemplo (seed de desenvolvimento), não cliente real."
      className={`inline-flex items-center gap-1 rounded-full border border-linha-forte bg-papel px-2 py-0.5 text-legenda font-medium uppercase tracking-wide text-tinta-fraca ${className}`}
    >
      exemplo
    </span>
  );
}

/** Frase fixa do modo demonstração — reusar aqui, nunca redigitar (Fase 2, §3.2/§3.4). */
export const FRASE_DEMONSTRACAO =
  "EXEMPLO GERADO SEM IA — conteúdo fixo de demonstração. Nada aqui foi analisado sobre este cliente.";

/**
 * Faixa de largura total que cobre todo bloco gerado em modo demonstração
 * (chave da Anthropic ausente). Não é um chip discreto: a Dra. Elaine não
 * pode confundir isto com análise real, nem imprimir e levar para uma
 * reunião sem perceber (ver `.marca-dagua-demonstracao` em globals.css).
 */
export function SeloDemonstracao({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return (
    <div
      role="alert"
      className={`marca-dagua-demonstracao overflow-hidden rounded-controle border-2 border-[color:var(--demo-faixa-forte)] bg-[color:var(--demo-fundo)] ${className}`}
    >
      <div className="relative z-[1] flex items-start gap-2.5 border-b-2 border-[color:var(--demo-faixa-forte)] bg-[color:var(--demo-faixa)] px-4 py-3 text-[color:var(--demo-faixa-texto)] sm:items-center">
        <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 h-5 w-5 shrink-0 fill-current sm:mt-0">
          <path d="M10 1.5 19 17H1L10 1.5Zm0 5.4a1 1 0 0 0-1 1v3.4a1 1 0 1 0 2 0V7.9a1 1 0 0 0-1-1Zm0 7.2a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Z" />
        </svg>
        <p className="text-sm font-bold leading-snug sm:text-base">{FRASE_DEMONSTRACAO}</p>
      </div>
      {children && <div className="relative z-[1] px-4 py-4">{children}</div>}
      <p className="relative z-[1] border-t-2 border-dashed border-[color:var(--demo-faixa-forte)] px-4 py-2 text-legenda font-medium uppercase tracking-wide text-[color:var(--demo-faixa-forte)]">
        Demonstração · grau de confiança 0 · nenhum dado real deste cliente foi analisado
      </p>
    </div>
  );
}

/**
 * Rótulo neutro para toda tela cujo conteúdo principal é gerado por IA
 * (Briefing, Análise da Sessão, Material). É rótulo, não anúncio: sem
 * `role`. Nunca usar junto de `SeloDemonstracao` na mesma peça.
 */
export function SeloIA({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-linha-forte bg-papel px-2.5 py-1 text-legenda font-medium leading-tight text-tinta-suave ${className}`}
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 3.5l1.3 3.7 3.7 1.3-3.7 1.3L10 13.5 8.7 9.8 5 8.5l3.7-1.3L10 3.5z" />
      </svg>
      Gerado por IA — insumo do advogado, não parecer
    </span>
  );
}

export type TomSelo = "verde" | "vermelho" | "azul" | "ambar" | "latao" | "neutro";

const TONS: Record<TomSelo, string> = {
  verde: "bg-verde-fraco text-[color:var(--verde)] border-transparent",
  vermelho: "bg-vermelho-fraco text-[color:var(--vermelho)] border-transparent",
  azul: "bg-azul-fraco text-[color:var(--azul)] border-transparent",
  ambar: "bg-ambar-fraco text-[color:var(--ambar)] border-transparent",
  latao: "bg-latao-fraco text-[color:var(--latao)] border-transparent",
  neutro: "bg-papel text-tinta-suave border-linha",
};

/**
 * Chip de estado. Pílula, 12px mínimo, sempre com texto (cor nunca é o único
 * sinal). `icone` opcional (SVG 20×20 `aria-hidden`) para reforçar o estado
 * sem depender de cor.
 *
 * `title` (Fase 5, lei de texto §2.2): o detalhe longo — a sigla do método
 * (`titleDe()`), o motivo, a data por extenso — vive aqui, nunca num `<p>` ao
 * lado. Antes disso, seis chamadas envolviam o selo num `<span title>` só para
 * conseguir o mesmo efeito (relatório do M3).
 */
export function Selo({ tom, icone, title, className = "", children }: { tom: TomSelo; icone?: ReactNode; title?: string; className?: string; children: ReactNode }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-legenda font-medium leading-tight ${TONS[tom]} ${className}`}>
      {icone}
      {children}
    </span>
  );
}
