import { GraficoIndisponivel } from "./GraficoIndisponivel";
import { Moldura } from "./Moldura";
import { formatarMoeda, formatarPercentual, PALETA_GRAFICO } from "./paleta";
import type { GraficoBaseProps, ItemFaltante } from "./tipos";

export interface BarrasComparativasProps extends GraficoBaseProps {
  /** `ideia_custo_inventario` — o que a família pagaria sem estrutura. */
  custoInventario: number | null | undefined;
  /** `relatorios_sessao.tributos` — custo projetado da estrutura, digitado pela advogada. */
  custoEstrutura: number | null | undefined;
  rotuloInventario?: string;
  rotuloEstrutura?: string;
  /** Proveniência — quem digitou e quando. Regra dura: nenhum cálculo automático de imposto. */
  fonte?: string;
  titulo?: string;
}

const LARGURA_PLOTAVEL = 520;
const MARGEM_ESQUERDA = 16;
const ALTURA_ROTULO = 22;
const ALTURA_BARRA = 40;
const ESPACO = 20;

/**
 * Slide 11 · Economia (§3.4) — CONFLITO C18. O único gráfico que o sistema
 * NÃO calcula: os dois números vêm de digitação da advogada
 * (`relatorios_sessao.tributos`) e da ideia de custo de inventário. Se
 * qualquer um faltar, não desenha — nenhuma suposição de imposto.
 */
export function BarrasComparativas({
  custoInventario,
  custoEstrutura,
  rotuloInventario = "Custo do inventário",
  rotuloEstrutura = "Custo da estrutura",
  fonte = "Fonte: digitado pela advogada no Relatório da Sessão",
  titulo = "Custo de agir × custo de não agir",
  tema = "claro",
  modoApresentacao = false,
  className = "",
}: BarrasComparativasProps) {
  const cores = PALETA_GRAFICO[tema];

  if (custoInventario == null || custoEstrutura == null) {
    const faltando: ItemFaltante[] = [];
    if (custoInventario == null) faltando.push({ campo: "Estimativa de custo do inventário", onde: "Relatório da Sessão" });
    if (custoEstrutura == null) faltando.push({ campo: "Custo projetado da estrutura (tributos)", onde: "Relatório da Sessão" });
    return <GraficoIndisponivel titulo={titulo} itensFaltantes={faltando} modoApresentacao={modoApresentacao} className={className} />;
  }

  const maior = Math.max(custoInventario, custoEstrutura, 1);
  const diferenca = custoInventario - custoEstrutura;
  const estruturaMenor = diferenca > 0;
  const percentual = custoInventario > 0 ? Math.abs(diferenca) / custoInventario : null;

  const linhas = [
    { rotulo: rotuloInventario, valor: custoInventario, cor: cores.ruim },
    { rotulo: rotuloEstrutura, valor: custoEstrutura, cor: cores.bom },
  ];

  const altura = linhas.length * (ALTURA_ROTULO + ALTURA_BARRA + ESPACO) - ESPACO + 44;
  const largura = MARGEM_ESQUERDA + LARGURA_PLOTAVEL + 16;

  const fraseDiferenca = percentual != null
    ? `${estruturaMenor ? "A estrutura custa" : "A estrutura custa mais que o inventário em"} ${formatarMoeda(Math.abs(diferenca))} (${formatarPercentual(percentual)}) ${estruturaMenor ? "menos que o inventário" : ""}`.trim()
    : `Diferença de ${formatarMoeda(Math.abs(diferenca))} entre os dois custos`;

  const rotuloAria = `${rotuloInventario}: ${formatarMoeda(custoInventario)}. ${rotuloEstrutura}: ${formatarMoeda(custoEstrutura)}. ${fraseDiferenca}.`;

  return (
    <Moldura
      titulo={titulo}
      tema={tema}
      fonte={fonte}
      tabela={
        <table className="sr-only">
          <caption>{rotuloAria}</caption>
          <thead>
            <tr>
              <th scope="col">Cenário</th>
              <th scope="col">Custo</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{rotuloInventario}</td>
              <td>{formatarMoeda(custoInventario)}</td>
            </tr>
            <tr>
              <td>{rotuloEstrutura}</td>
              <td>{formatarMoeda(custoEstrutura)}</td>
            </tr>
          </tbody>
        </table>
      }
      className={className}
    >
      <svg role="img" aria-label={rotuloAria} viewBox={`0 0 ${largura} ${altura}`} width="100%" height="auto" style={{ display: "block" }}>
        {linhas.map((linha, indice) => {
          const y = indice * (ALTURA_ROTULO + ALTURA_BARRA + ESPACO);
          const larguraBarra = Math.max(4, (linha.valor / maior) * LARGURA_PLOTAVEL);
          return (
            <g key={linha.rotulo}>
              <text x={MARGEM_ESQUERDA} y={y + 16} fontSize="15" fontWeight={600} fill={cores.tinta}>
                {linha.rotulo}
              </text>
              <rect x={MARGEM_ESQUERDA} y={y + ALTURA_ROTULO} width={LARGURA_PLOTAVEL} height={ALTURA_BARRA} rx={5} fill={cores.grade} />
              <rect x={MARGEM_ESQUERDA} y={y + ALTURA_ROTULO} width={larguraBarra} height={ALTURA_BARRA} rx={5} fill={linha.cor} />
              <text x={MARGEM_ESQUERDA + larguraBarra + 10} y={y + ALTURA_ROTULO + ALTURA_BARRA / 2 + 5} fontSize="15" fontWeight={700} fill={linha.cor}>
                {formatarMoeda(linha.valor)}
              </text>
            </g>
          );
        })}
        <text x={MARGEM_ESQUERDA} y={altura - 14} fontSize="14" fontWeight={600} fill={estruturaMenor ? cores.bom : cores.ruim}>
          {fraseDiferenca}
        </text>
      </svg>
    </Moldura>
  );
}
