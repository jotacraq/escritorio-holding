import type { ReactNode } from "react";

/**
 * Peças visuais do Briefing Estratégico compartilhadas entre a aba completa
 * (`BriefingAba.tsx`, Ficha 360) e o painel compacto do Modo Conduzir Sessão
 * (`PainelBriefingSessao.tsx`, U1). Extraídas daqui em vez de duplicadas —
 * ARQUITETURA-FASE-3.md §5.3/§7 pede exatamente isto: "reaproveite os
 * componentes de briefing que já existem; se precisar generalizar, generalize".
 */

export type TomChip = "verde" | "ambar" | "vermelho" | "azul" | "neutro";

const TONS_CHIP: Record<TomChip, string> = {
  verde: "border-transparent bg-verde-fraco text-[color:var(--verde)]",
  ambar: "border-transparent bg-ambar-fraco text-[color:var(--ambar)]",
  vermelho: "border-transparent bg-vermelho-fraco text-[color:var(--vermelho)]",
  azul: "border-transparent bg-azul-fraco text-[color:var(--azul)]",
  neutro: "border-linha-forte bg-papel-elevado text-tinta-suave",
};

/** Chip genérico para enum do briefing (DISC, tom, probabilidade, ritmo…). */
export function Chip({ tom = "neutro", children }: { tom?: TomChip; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-medium leading-none ${TONS_CHIP[tom]}`}>
      {children}
    </span>
  );
}

export function BadgeConfianca({ valor }: { valor: number | null }) {
  if (valor === null) return null;
  const tom = valor >= 70 ? "var(--verde)" : valor >= 40 ? "var(--ambar)" : "var(--vermelho)";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-sm font-medium"
      style={{ borderColor: tom, color: tom }}
    >
      Confiança: {valor}%
    </span>
  );
}

export function Hipotese({ evidencias }: { evidencias?: string[] }) {
  if (evidencias && evidencias.length > 0) return null;
  return (
    <span className="ml-2 rounded-sm bg-ambar-fraco px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--ambar)]">
      Hipótese — sem evidência direta
    </span>
  );
}

export function ListaEvidencias({ evidencias }: { evidencias?: string[] }) {
  if (!evidencias || evidencias.length === 0) return null;
  return (
    <ul className="mt-1.5 flex flex-col gap-0.5 border-l-2 border-linha pl-2.5 text-xs text-tinta-fraca">
      {evidencias.map((ev, i) => (
        <li key={i}>&ldquo;{ev}&rdquo;</li>
      ))}
    </ul>
  );
}

/**
 * Frase literal do cliente, com a marca de fidelidade (§1.8) quando o backend
 * já expuser `verificacao.frases_fechamento` (hoje não expõe — ver
 * `tipos.ts`). Sem o dado, não mostra selo nenhum: ausência nunca vira
 * "verificada" por omissão.
 */
export function FraseComFidelidade({ frase, status }: { frase: string; status?: "verificada" | "nao_localizada" }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="italic">&ldquo;{frase}&rdquo;</span>
      {status === "nao_localizada" && (
        <span
          title="Esta frase não foi localizada no material de origem (formulário, ligação ou transcrição) usado para gerar o briefing."
          className="rounded-sm bg-vermelho-fraco px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--vermelho)]"
        >
          Não localizada na fonte
        </span>
      )}
    </span>
  );
}
