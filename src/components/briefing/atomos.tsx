import type { ReactNode } from "react";
import {
  rotularDisc,
  rotularProbabilidade,
  rotularTom,
  tomProbabilidade,
  type BriefingConteudoV2,
} from "@/components/briefing/tipos";

/**
 * Peças visuais do Briefing Estratégico compartilhadas entre a aba completa
 * (`BriefingAba.tsx`, Ficha 360) e o painel compacto do Modo Conduzir Sessão
 * (`PainelBriefingSessao.tsx`, U1). Extraídas daqui em vez de duplicadas —
 * ARQUITETURA-FASE-3.md §5.3/§7 pede exatamente isto: "reaproveite os
 * componentes de briefing que já existem; se precisar generalizar, generalize".
 */

/**
 * A objeção mais provável do Briefing. Fonte única — antes existiam duas
 * versões divergentes (`CabecalhoFicha.tsx` ordenava por `ORDEM_PROBABILIDADE`,
 * `PainelBriefingSessao.tsx` fazia `find(alta) ?? [0]`), que podiam apontar
 * objeções diferentes na mesma tela. Ambas tinham o mesmo resultado prático
 * (a primeira de probabilidade "alta", ou a primeira da lista na ausência de
 * uma "alta") — esta versão usa a forma por ordenação, que é estável mesmo
 * se a lista trouxer mais de uma objeção "alta" fora de ordem.
 */
const ORDEM_PROBABILIDADE: Record<"alta" | "media" | "baixa", number> = { alta: 0, media: 1, baixa: 2 };

export function objecaoPrincipal(
  objecoes: BriefingConteudoV2["objecoes_provaveis"] | undefined,
): BriefingConteudoV2["objecoes_provaveis"][number] | null {
  if (!objecoes || objecoes.length === 0) return null;
  const ordenada = [...objecoes].sort((a, b) => ORDEM_PROBABILIDADE[a.probabilidade] - ORDEM_PROBABILIDADE[b.probabilidade]);
  return ordenada[0];
}

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
    <span className={`inline-flex items-center rounded-controle border px-2 py-0.5 text-xs font-medium leading-none ${TONS_CHIP[tom]}`}>
      {children}
    </span>
  );
}

export function BadgeConfianca({ valor }: { valor: number | null }) {
  if (valor === null) return null;
  const tom = valor >= 70 ? "var(--verde)" : valor >= 40 ? "var(--ambar)" : "var(--vermelho)";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-controle border px-2 py-1 text-sm font-medium"
      style={{ borderColor: tom, color: tom }}
    >
      Confiança: {valor}%
    </span>
  );
}

export function Hipotese({ evidencias }: { evidencias?: string[] }) {
  if (evidencias && evidencias.length > 0) return null;
  return (
    <span className="ml-2 rounded-controle bg-ambar-fraco px-1.5 py-0.5 text-legenda font-bold uppercase tracking-wide text-[color:var(--ambar)]">
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
          className="rounded-controle bg-vermelho-fraco px-1.5 py-0.5 text-legenda font-bold uppercase tracking-wide text-[color:var(--vermelho)]"
        >
          Não localizada na fonte
        </span>
      )}
    </span>
  );
}

function BlocoCompacto({ titulo, tom = "neutro", children }: { titulo: string; tom?: "neutro" | "vermelho"; children: ReactNode }) {
  const bordas = tom === "vermelho" ? "border-vermelho/40" : "border-linha";
  return (
    <section className={`rounded-controle border ${bordas} px-3 py-2.5`}>
      <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-tinta-fraca">{titulo}</h3>
      <div className="text-tinta">{children}</div>
    </section>
  );
}

/**
 * Resumo de topo do Briefing: objeção mais provável, perfil/linguagem, o que
 * não fazer, frases do cliente para o fechamento, e quando apresentar
 * croqui/investimento. Peça pura (recebe `briefing` + contexto, zero I/O) —
 * usada tanto no painel compacto do Modo Conduzir Sessão
 * (`PainelBriefingSessao.tsx`) quanto no topo da aba Briefing da Ficha 360
 * (`BriefingAba.tsx`, Tarefa 3 da mudança de navegação de 04/09).
 */
export function ConteudoCompacto({ briefing, c }: { briefing: { grau_confianca: number | null; modo_reduzido?: boolean }; c: BriefingConteudoV2 }) {
  const objecao = objecaoPrincipal(c.objecoes_provaveis);
  const naoFazer = c.pontos_de_atencao.slice(0, 3);

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <BadgeConfianca valor={briefing.grau_confianca} />
        {briefing.modo_reduzido && (
          <span className="rounded-controle bg-ambar-fraco px-1.5 py-0.5 text-legenda font-bold uppercase tracking-wide text-[color:var(--ambar)]">
            Sem transcrição
          </span>
        )}
      </div>

      <BlocoCompacto titulo="Objeção mais provável e como tratar">
        {objecao ? (
          <>
            <p>
              <strong>{objecao.objecao}</strong>{" "}
              <Chip tom={tomProbabilidade(objecao.probabilidade)}>{rotularProbabilidade(objecao.probabilidade)}</Chip>
            </p>
            <p className="mt-1 text-tinta-suave">{objecao.justificativa}</p>
          </>
        ) : (
          <p className="text-tinta-fraca">Nenhuma objeção identificada.</p>
        )}
        {c.estrategia_sessao.tratamento_objecoes && (
          <p className="mt-2 border-t border-linha pt-2 text-tinta-suave">
            <strong className="text-tinta">Como tratar:</strong> {c.estrategia_sessao.tratamento_objecoes}
          </p>
        )}
      </BlocoCompacto>

      <BlocoCompacto titulo="Perfil e linguagem">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip tom="azul">{rotularDisc(c.perfil_disc.predominante)}</Chip>
          {c.perfil_disc.secundario && <Chip>secundário: {rotularDisc(c.perfil_disc.secundario)}</Chip>}
          <span className="text-xs text-tinta-fraca">confiança {c.perfil_disc.confianca}%</span>
        </div>
        {c.linguagem_recomendada.tom.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {c.linguagem_recomendada.tom.map((t) => (
              <Chip key={t}>{rotularTom(t)}</Chip>
            ))}
          </div>
        )}
        {c.motivadores.principal && (
          <p className="mt-2 text-tinta-suave">
            <strong className="text-tinta">Motivador principal:</strong> {c.motivadores.principal}
          </p>
        )}
      </BlocoCompacto>

      {naoFazer.length > 0 && (
        <BlocoCompacto titulo="O que não fazer" tom="vermelho">
          <ul className="flex flex-col gap-1.5">
            {naoFazer.map((p, i) => (
              <li key={i}>
                <strong>{p.nao_fazer}</strong>
                <span className="text-tinta-suave"> — {p.motivo}</span>
              </li>
            ))}
          </ul>
        </BlocoCompacto>
      )}

      {c.frases_para_o_fechamento.length > 0 && (
        <BlocoCompacto titulo="Frases do cliente para o fechamento">
          <ul className="flex flex-col gap-2">
            {c.frases_para_o_fechamento.map((f, i) => (
              <li key={i}>
                <FraseComFidelidade frase={f.frase_literal} />
                <p className="mt-0.5 text-tinta-suave">Como usar: {f.como_usar}</p>
              </li>
            ))}
          </ul>
        </BlocoCompacto>
      )}

      {(c.estrategia_sessao.momento_croqui || c.estrategia_sessao.momento_investimento) && (
        <BlocoCompacto titulo="Croqui e investimento — quando apresentar">
          {c.estrategia_sessao.momento_croqui && (
            <p><strong>Croqui:</strong> {c.estrategia_sessao.momento_croqui}</p>
          )}
          {c.estrategia_sessao.momento_investimento && (
            <p className="mt-1"><strong>Investimento:</strong> {c.estrategia_sessao.momento_investimento}</p>
          )}
        </BlocoCompacto>
      )}

      {c.lacunas.length > 0 && (
        <p role="note" className="rounded-controle border border-ambar-borda bg-ambar-fraco px-2.5 py-2 text-xs text-[color:var(--ambar)]">
          Lacunas nesta análise: {c.lacunas.join(" · ")}
        </p>
      )}
    </div>
  );
}
