import { memo, type ReactNode } from "react";
import type { Celula, Tabela } from "@/types/croqui-calculo";
import { MARCA_CALCULADO, marcaDaCelula, textoDaCelula, unidadeDaCelula, type Unidade } from "./formatoTabela";
import { SUPERFICIES, type PaletaTabela, type Superficie } from "./paletasTabela";

/**
 * UMA tabela do croqui, genérica: renderiza qualquer uma das 19 a partir do
 * `Tabela` que o motor devolve (`colunas` × `linhas` × `celulas`). Não existe
 * componente por tabela — a estrutura já está no dado, e um componente por
 * aba seria 19 lugares para o mesmo bug.
 *
 * Regras que esta tela garante, e que o deck do escritório não garantia:
 *  · célula ausente aparece como `—`, com o motivo no `title` e no leitor de
 *    tela. Nunca R$ 0,00 — é literalmente o que já foi entregue a um cliente
 *    (§3 do recon do Drive);
 *  · procedência é visível: `✎` digitado, `≈` estimativa por percentual,
 *    `ƒ` calculado (este só com "De onde veio o número" ligado);
 *  · a tabela rola na horizontal com a coluna de rótulo fixa, e a região
 *    rolável é FOCÁVEL — senão o teclado não alcança as colunas fora da tela.
 *
 * Tudo o que varia entre tela, papel e projetor vem de UMA `superficie`
 * (`paletasTabela.ts`): cor, rolagem e se a explicação interna da célula pode
 * sair. Cor vem sempre de paleta, nunca de classe de cor — é o que garante
 * que o deck impresso e a tela mudem juntos.
 *
 * Sem `"use client"` e sem import do catálogo de parâmetros de propósito:
 * este arquivo também é renderizado no link PÚBLICO. O painel de faltas (que
 * precisa do catálogo) vive em `FaltaDaTabela.tsx`.
 */

export interface TabelaCroquiProps {
  tabela: Tabela;
  /** Onde esta tabela está sendo mostrada. Default: a tela do app. */
  superficie?: Superficie;
  /** Liga o glifo `ƒ` nas células calculadas. */
  mostrarProcedencia?: boolean;
  /** Colunas a esconder (ex.: "após a reforma" quando não há dado). */
  colunasOcultas?: string[];
  /** Abaixo da tabela: o painel de faltas, nas telas internas. */
  rodape?: ReactNode;
  nivelTitulo?: "h2" | "h3";
  /** `false` esconde o título (o slide já traz o título grande). */
  comTitulo?: boolean;
  className?: string;
}

const CLASSE_CELULA = "px-3 py-2 text-right tabular-nums";
const CLASSE_CABECALHO = "px-3 py-2 text-rotulo font-medium uppercase";

function CelulaCroqui({
  celula,
  unidade,
  mostrarProcedencia,
  destaque,
  paleta,
  publico,
  umaLinha,
}: {
  celula: Celula | undefined;
  unidade: Unidade;
  mostrarProcedencia: boolean;
  destaque: boolean;
  paleta: PaletaTabela;
  publico: boolean;
  umaLinha: boolean;
}) {
  const classe = `${CLASSE_CELULA} ${umaLinha ? "whitespace-nowrap" : ""} ${
    destaque ? "text-corpo" : "text-sm"
  }`;

  // Coluna que esta linha não tem (o par "hoje × reforma" nem sempre é simétrico).
  if (!celula) {
    return (
      <td className={classe} style={{ color: paleta.tintaFraca }}>
        <span aria-label="não se aplica">·</span>
      </td>
    );
  }

  const texto = textoDaCelula(celula, unidade);
  const marca = marcaDaCelula(celula, publico);
  const glifo =
    marca.glifo ?? (mostrarProcedencia && celula.procedencia === "calculado" ? MARCA_CALCULADO : null);

  return (
    <td className={classe}>
      <span
        className={destaque ? "font-bold" : undefined}
        style={{ color: marca.falta ? paleta.atencao : paleta.tinta }}
        title={marca.explicacao}
      >
        {texto}
        {glifo && (
          <span
            aria-hidden="true"
            className="ml-1 align-super text-legenda font-normal"
            style={{ color: paleta.tintaFraca }}
          >
            {glifo}
          </span>
        )}
        <span className="sr-only"> — {marca.explicacao}</span>
      </span>
    </td>
  );
}

function TabelaCroquiInterna({
  tabela,
  superficie = "tela",
  mostrarProcedencia = false,
  colunasOcultas,
  rodape,
  nivelTitulo = "h3",
  comTitulo = true,
  className = "",
}: TabelaCroquiProps) {
  const { paleta, rolavel, publico } = SUPERFICIES[superficie];
  const colunas = colunasOcultas?.length
    ? tabela.colunas.filter((c) => !colunasOcultas.includes(c.chave))
    : tabela.colunas;
  const Titulo = nivelTitulo;
  const idTitulo = `tabela-${tabela.chave}`;

  return (
    <section
      aria-labelledby={comTitulo ? idTitulo : undefined}
      aria-label={comTitulo ? undefined : tabela.titulo}
      className={`flex flex-col gap-item ${className}`}
    >
      {comTitulo && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <Titulo id={idTitulo} className="text-subtitulo font-bold" style={{ color: paleta.tinta }}>
            {tabela.titulo}
          </Titulo>
          {tabela.nota && (
            <p className="text-xs" style={{ color: paleta.tintaFraca }}>
              {tabela.nota}
            </p>
          )}
        </div>
      )}

      <div
        className={`rounded-controle border ${
          rolavel
            ? "overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--latao-cta)]"
            : ""
        }`}
        style={{ borderColor: paleta.linha, background: paleta.papel }}
        {...(rolavel ? { tabIndex: 0, role: "region", "aria-label": tabela.titulo } : {})}
      >
        {/* `min-w-full`, não `w-full`: em coluna estreita (o `/p/m` vive num
            `max-w-lg`) a tabela cresce e a região rola, em vez de espremer o
            rótulo da linha em cinco linhas de texto. */}
        <table className="min-w-full border-collapse text-left">
          <thead>
            <tr style={{ borderBottom: `1px solid ${paleta.linhaForte}` }}>
              <th
                scope="col"
                className={`sticky left-0 z-10 ${CLASSE_CABECALHO}`}
                style={{ background: paleta.papel, color: paleta.tintaFraca }}
              >
                <span className="sr-only">Linha</span>
              </th>
              {colunas.map((coluna) => (
                <th
                  key={coluna.chave}
                  scope="col"
                  className={`${CLASSE_CABECALHO} text-right ${rolavel ? "whitespace-nowrap" : ""}`}
                  style={{ color: paleta.tintaFraca }}
                >
                  {coluna.rotulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tabela.linhas.map((linha) => (
              <tr
                key={linha.chave}
                style={
                  linha.destaque
                    ? { borderTop: `2px solid ${paleta.linhaForte}`, background: paleta.papelLinha }
                    : { borderBottom: `1px solid ${paleta.linha}` }
                }
              >
                <th
                  scope="row"
                  className={`sticky left-0 z-10 min-w-40 px-3 py-2 text-left text-sm ${
                    linha.destaque ? "font-bold" : "font-normal"
                  }`}
                  style={{
                    background: linha.destaque ? paleta.papelLinha : paleta.papel,
                    color: linha.destaque ? paleta.tinta : paleta.tintaSuave,
                  }}
                >
                  {linha.rotulo}
                </th>
                {colunas.map((coluna) => (
                  <CelulaCroqui
                    key={coluna.chave}
                    celula={linha.celulas[coluna.chave]}
                    unidade={unidadeDaCelula(tabela, linha, coluna)}
                    mostrarProcedencia={mostrarProcedencia}
                    destaque={Boolean(linha.destaque)}
                    paleta={paleta}
                    publico={publico}
                    umaLinha={rolavel}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rodape}
    </section>
  );
}

/**
 * `memo` porque o simulador re-renderiza a cada tecla e só UMA das tabelas
 * muda: sem isso, ~250 células são reformatadas (`Intl`, `title`, className)
 * a cada caractere digitado na frente da família. Quem passa `colunasOcultas`
 * precisa memoizar o array — identidade nova a cada render derruba a
 * comparação e o `memo` vira custo puro.
 */
export const TabelaCroqui = memo(TabelaCroquiInterna);

/** Legenda dos glifos — uma linha, fora do fluxo das tabelas. */
export function LegendaGlifos({ mostrarProcedencia }: { mostrarProcedencia: boolean }) {
  return (
    <p className="text-xs text-tinta-fraca">
      <span aria-hidden="true">—</span> falta cadastrar · <span aria-hidden="true">✎</span> digitado ·{" "}
      <span aria-hidden="true">≈</span> estimativa
      {mostrarProcedencia && (
        <>
          {" "}
          · <span aria-hidden="true">{MARCA_CALCULADO}</span> calculado
        </>
      )}
    </p>
  );
}
