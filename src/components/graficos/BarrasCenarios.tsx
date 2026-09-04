import { GraficoIndisponivel } from "./GraficoIndisponivel";
import { Moldura } from "./Moldura";
import { formatarMoeda, formatarPercentual, PALETA_GRAFICO } from "./paleta";
import type { CenarioComparado, GraficoBaseProps } from "./tipos";

export interface BarrasCenariosProps extends GraficoBaseProps {
  cenarios: CenarioComparado[];
  titulo?: string;
  fonte?: string;
}

const LARGURA_PLOTAVEL = 520;
const MARGEM_ESQUERDA = 16;
const ALTURA_ROTULO = 22;
const ALTURA_BARRA = 36;
const ESPACO = 18;

/**
 * Generalização de `BarrasComparativas` (2 séries fixas: inventário ×
 * estrutura) para N cenários — plano "Croqui rico em dados" (Fase C,
 * `brain/Diário/2026-09-04.md`), conceito "Cenário Patrimonial" (Fase B,
 * ainda bloqueada): Inventário, Doação, 1/2/3 Células.
 *
 * Regra dura (CLAUDE.md — "nada de dado inventado na tela"): um cenário com
 * `custoTotal: null` (rubrica ausente, procedência "ausente" por rubrica na
 * Fase B) NÃO vira barra de altura zero — isso mentiria "custo zero". Fica
 * de fora do desenho, e a legenda abaixo do gráfico diz quantos cenários
 * foram omitidos. `BarrasComparativas` não precisa dessa robustez porque as
 * duas séries que ele compara são digitadas manualmente e o componente já
 * recusa desenhar se qualquer uma faltar (tudo ou nada); aqui, com até 5
 * cenários, teria sentido mostrar os 3 que já existem enquanto os outros 2
 * ainda não são computáveis — silenciar o gráfico inteiro derrubaria dado
 * bom junto com o ausente.
 */
export function BarrasCenarios({
  cenarios,
  titulo = "Comparação de cenários",
  fonte = "Fonte: Cenário Patrimonial — custo total por cenário",
  tema = "claro",
  modoApresentacao = false,
  className = "",
}: BarrasCenariosProps) {
  const cores = PALETA_GRAFICO[tema];

  if (cenarios.length === 0) {
    return (
      <GraficoIndisponivel
        titulo={titulo}
        tema={tema}
        modoApresentacao={modoApresentacao}
        className={className}
        itensFaltantes={[{ campo: "Ao menos um cenário com custo total calculado", onde: "Cenário Patrimonial" }]}
      />
    );
  }

  const computaveis = cenarios.filter((c): c is CenarioComparado & { custoTotal: number } => c.custoTotal != null);
  const omitidos = cenarios.length - computaveis.length;

  if (computaveis.length === 0) {
    return (
      <GraficoIndisponivel
        titulo={titulo}
        tema={tema}
        modoApresentacao={modoApresentacao}
        className={className}
        itensFaltantes={[{ campo: `Custo total de ao menos um dos ${cenarios.length} cenários informados`, onde: "Cenário Patrimonial — falta alíquota/rubrica" }]}
      />
    );
  }

  const maior = Math.max(...computaveis.map((c) => c.custoTotal), 1);

  const cor = (cenario: CenarioComparado) => {
    if (cenario.ehReferencia) return cores.tintaFraca;
    if (cenario.diferencaPercentual == null) return cores.latao;
    return cenario.diferencaPercentual <= 0 ? cores.bom : cores.ruim;
  };

  const altura = computaveis.length * (ALTURA_ROTULO + ALTURA_BARRA + ESPACO) - ESPACO + 24;
  const largura = MARGEM_ESQUERDA + LARGURA_PLOTAVEL + 16;

  const rotuloAria = `Comparação de ${computaveis.length} de ${cenarios.length} cenários${omitidos > 0 ? ` (${omitidos} não computados)` : ""}: ${computaveis
    .map((c) => `${c.nome}, ${formatarMoeda(c.custoTotal)}${c.diferencaPercentual != null && !c.ehReferencia ? ` (${c.diferencaPercentual >= 0 ? "+" : ""}${formatarPercentual(c.diferencaPercentual)} em relação à referência)` : ""}`)
    .join("; ")}.`;

  return (
    <Moldura
      titulo={titulo}
      tema={tema}
      fonte={fonte}
      tabela={
        <div className="sr-only">
          <table>
            <caption>{rotuloAria}</caption>
            <thead>
              <tr>
                <th scope="col">Cenário</th>
                <th scope="col">Custo total</th>
                <th scope="col">Diferença vs. referência</th>
              </tr>
            </thead>
            <tbody>
              {cenarios.map((c) => (
                <tr key={c.nome}>
                  <td>
                    {c.nome}
                    {c.ehReferencia ? " (referência)" : ""}
                  </td>
                  <td>{c.custoTotal != null ? formatarMoeda(c.custoTotal) : "não computado — rubrica ausente"}</td>
                  <td>{c.diferencaPercentual != null && !c.ehReferencia ? formatarPercentual(c.diferencaPercentual) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      }
      className={className}
    >
      <svg role="img" aria-label={rotuloAria} viewBox={`0 0 ${largura} ${altura}`} width="100%" style={{ display: "block", height: "auto" }}>
        {computaveis.map((cenario, indice) => {
          const y = indice * (ALTURA_ROTULO + ALTURA_BARRA + ESPACO);
          const larguraBarra = Math.max(4, (cenario.custoTotal / maior) * LARGURA_PLOTAVEL);
          const corBarra = cor(cenario);
          const sufixoDiferenca =
            cenario.diferencaPercentual != null && !cenario.ehReferencia
              ? ` (${cenario.diferencaPercentual >= 0 ? "+" : ""}${formatarPercentual(cenario.diferencaPercentual)})`
              : "";
          return (
            <g key={cenario.nome}>
              <text x={MARGEM_ESQUERDA} y={y + 16} fontSize="14" fontWeight={600} fill={cores.tinta}>
                {cenario.nome}
                {cenario.ehReferencia ? " · referência" : ""}
              </text>
              <text x={MARGEM_ESQUERDA + LARGURA_PLOTAVEL} y={y + 16} fontSize="14" fontWeight={700} textAnchor="end" fill={corBarra}>
                {formatarMoeda(cenario.custoTotal)}
                {sufixoDiferenca}
              </text>
              <rect x={MARGEM_ESQUERDA} y={y + ALTURA_ROTULO} width={LARGURA_PLOTAVEL} height={ALTURA_BARRA} rx={5} fill={cores.grade} />
              <rect x={MARGEM_ESQUERDA} y={y + ALTURA_ROTULO} width={larguraBarra} height={ALTURA_BARRA} rx={5} fill={corBarra} />
            </g>
          );
        })}
      </svg>

      {omitidos > 0 && (
        <p className="mt-2 text-xs" style={{ color: cores.tintaFraca }}>
          {omitidos} {omitidos === 1 ? "cenário não pôde" : "cenários não puderam"} ser calculado{omitidos === 1 ? "" : "s"} — faltam dados de alíquota/rubrica.
        </p>
      )}
    </Moldura>
  );
}
