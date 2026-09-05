import Link from "next/link";
import type { FaltaParametro, ResultadoCroqui } from "@/types/croqui-calculo";
import { CATALOGO_PARAMETROS, type ChaveParametroCroqui } from "@/server/motor-croqui/catalogo";

/**
 * O que impede uma tabela (ou o croqui inteiro) de fechar: nome humano do
 * parâmetro, a jurisdição em que falta e o caminho para cadastrar. Só telas
 * internas — o cliente vê o `—` da célula, não a chave do parâmetro.
 *
 * Import direto de `./catalogo` (não do barril) para não arrastar o motor
 * inteiro para dentro do bundle de quem só renderiza tabela.
 */

function rotuloDoParametro(chave: string): string {
  // `motor.erro_interno` não é parâmetro: é o motor dizendo que não conseguiu
  // calcular (calcular.ts, rede de segurança). Nome humano, não a chave crua.
  if (chave === "motor.erro_interno") return "Falha ao calcular — recarregue a ficha";
  return CATALOGO_PARAMETROS[chave as ChaveParametroCroqui]?.rotulo ?? chave;
}

const CLASSE_LINK =
  "inline-flex min-h-11 items-center rounded-controle border border-ambar-borda px-3 text-sm font-medium text-[color:var(--ambar)] transition-colors hover:bg-papel-elevado focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ambar-borda)]";

function jurisdicao(f: FaltaParametro): string | null {
  return f.municipio ?? f.uf ?? null;
}

const chaveDe = (f: FaltaParametro) => `${f.chave}-${f.uf ?? ""}-${f.municipio ?? ""}`;

/** Rodapé de uma tabela: quantos parâmetros faltam e quais. */
export function FaltaDaTabela({ falta }: { falta: FaltaParametro[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-controle border border-ambar-borda bg-ambar-fraco px-3 py-2 text-xs text-[color:var(--ambar)]">
      <span className="font-medium">
        {falta.length} {falta.length === 1 ? "parâmetro falta" : "parâmetros faltam"}
      </span>
      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {falta.map((f) => (
          <li key={chaveDe(f)}>
            <span title={f.chave}>{rotuloDoParametro(f.chave)}</span>
            {jurisdicao(f) && <span className="opacity-80"> · {jurisdicao(f)}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Rollup do croqui inteiro: número primeiro, uma linha por parâmetro, um botão. */
export function PainelFaltas({ faltas }: { faltas: ResultadoCroqui["faltas"] }) {
  return (
    <section
      aria-label="Parâmetros a cadastrar"
      className="flex flex-col gap-item rounded-controle border border-ambar-borda bg-ambar-fraco p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-item">
        <p className="text-sm font-medium text-[color:var(--ambar)]">
          {faltas.length} {faltas.length === 1 ? "parâmetro a cadastrar" : "parâmetros a cadastrar"}
        </p>
        <Link href="/admin#parametros" className={CLASSE_LINK}>
          Cadastrar
        </Link>
      </div>
      <ul className="flex flex-col gap-1 text-xs text-[color:var(--ambar)]">
        {faltas.map((falta) => (
          <li key={chaveDe(falta)} className="flex flex-wrap gap-x-2">
            <span className="font-medium" title={falta.chave}>
              {rotuloDoParametro(falta.chave)}
            </span>
            {jurisdicao(falta) && <span>{jurisdicao(falta)}</span>}
            <span className="opacity-70">
              {falta.tabelas.length} {falta.tabelas.length === 1 ? "tabela" : "tabelas"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Duas versões do mesmo número no material do escritório — o motor não escolhe. */
export function PainelDivergencias({ divergencias }: { divergencias: ResultadoCroqui["divergencias"] }) {
  return (
    <section
      aria-label="Números em divergência"
      className="flex flex-col gap-item rounded-controle border border-vermelho bg-vermelho-fraco p-4"
    >
      <p className="text-sm font-medium text-[color:var(--vermelho)]">
        {divergencias.length} {divergencias.length === 1 ? "número em divergência" : "números em divergência"}
      </p>
      <ul className="flex flex-col gap-1 text-xs text-[color:var(--vermelho)]">
        {divergencias.map((d) => (
          <li key={d.chave} title={d.onde}>
            <span className="font-medium">{rotuloDoParametro(d.chave)}</span> {d.valores.join(" × ")}
          </li>
        ))}
      </ul>
    </section>
  );
}
