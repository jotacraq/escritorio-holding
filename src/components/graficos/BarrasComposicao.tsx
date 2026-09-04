import { GraficoIndisponivel } from "./GraficoIndisponivel";
import { ItemLegenda, Moldura } from "./Moldura";
import { formatarMoeda, formatarPercentual, ORDEM_TIPO_BEM, PALETA_GRAFICO, ROTULO_TIPO_BEM, type TipoBemGrafico } from "./paleta";
import type { GraficoBaseProps } from "./tipos";

/** Um item de patrimônio, no recorte mínimo que este gráfico precisa —
 * compatível com `PatrimonioItem` de `src/lib/api.ts` (não importado daqui:
 * este componente não depende do front-core, só do formato do dado). */
export interface ItemComposicaoPatrimonial {
  tipo: TipoBemGrafico;
  valor_mercado?: number | null;
  valor_historico?: number | null;
}

export interface BarrasComposicaoProps extends GraficoBaseProps {
  itens: ItemComposicaoPatrimonial[];
  titulo?: string;
}

const MARGEM = { esquerda: 16, direita: 16, topo: 8 };
const LARGURA_PLOTAVEL = 560;
const ALTURA_LINHA = 30;
const ALTURA_TEXTO = 22;
const ESPACO_ENTRE_LINHAS = 14;

/**
 * Slide 4 · Patrimônio (§3.4). Fonte: `patrimonio_itens.valor_mercado ??
 * valor_historico`, agrupado por tipo. Sem item com valor → `GraficoIndisponivel`.
 */
export function BarrasComposicao({ itens, titulo = "Composição patrimonial por tipo de bem", tema = "claro", modoApresentacao = false, className = "" }: BarrasComposicaoProps) {
  const cores = PALETA_GRAFICO[tema];

  const somaPorTipo = new Map<TipoBemGrafico, number>();
  for (const item of itens) {
    const valor = item.valor_mercado ?? item.valor_historico;
    if (valor == null || valor <= 0) continue;
    somaPorTipo.set(item.tipo, (somaPorTipo.get(item.tipo) ?? 0) + valor);
  }

  const linhas = ORDEM_TIPO_BEM.map((tipo) => ({ tipo, valor: somaPorTipo.get(tipo) ?? 0 }))
    .filter((linha) => linha.valor > 0)
    .sort((a, b) => b.valor - a.valor);

  if (linhas.length === 0) {
    return (
      <GraficoIndisponivel
        titulo={titulo}
        tema={tema}
        modoApresentacao={modoApresentacao}
        className={className}
        itensFaltantes={[{ campo: "Valor de mercado (ou histórico) de ao menos um bem patrimonial", onde: "Aba Patrimônio" }]}
      />
    );
  }

  const total = linhas.reduce((soma, l) => soma + l.valor, 0);
  const maiorValor = linhas[0].valor;
  const altura = MARGEM.topo * 2 + linhas.length * (ALTURA_TEXTO + ALTURA_LINHA + ESPACO_ENTRE_LINHAS) - ESPACO_ENTRE_LINHAS;
  const largura = MARGEM.esquerda + LARGURA_PLOTAVEL + MARGEM.direita;

  const maiorRotulo = ROTULO_TIPO_BEM[linhas[0].tipo];
  const rotuloAria = `Composição patrimonial: total de ${formatarMoeda(total)} em ${linhas.length} ${linhas.length === 1 ? "categoria" : "categorias"} de bem. A maior é ${maiorRotulo}, com ${formatarPercentual(maiorValor / total)} do total.`;

  return (
    <Moldura
      titulo={titulo}
      tema={tema}
      fonte="Fonte: valor de mercado (ou histórico) declarado na aba Patrimônio"
      legenda={linhas.map((l) => (
        <ItemLegenda key={l.tipo} cor={cores.categorica[l.tipo]} rotulo={`${ROTULO_TIPO_BEM[l.tipo]} — ${formatarPercentual(l.valor / total)}`} tema={tema} />
      ))}
      tabela={
        <div className="sr-only">
          <table>
          <caption>{rotuloAria}</caption>
          <thead>
            <tr>
              <th scope="col">Tipo de bem</th>
              <th scope="col">Valor</th>
              <th scope="col">Percentual do total</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.tipo}>
                <td>{ROTULO_TIPO_BEM[l.tipo]}</td>
                <td>{formatarMoeda(l.valor)}</td>
                <td>{formatarPercentual(l.valor / total)}</td>
              </tr>
            ))}
            <tr>
              <td>Total</td>
              <td>{formatarMoeda(total)}</td>
              <td>100%</td>
            </tr>
          </tbody>
          </table>
        </div>
      }
      className={className}
    >
      <svg role="img" aria-label={rotuloAria} viewBox={`0 0 ${largura} ${altura}`} width="100%" style={{ display: "block", height: "auto" }}>
        {linhas.map((linha, indice) => {
          const y = MARGEM.topo + indice * (ALTURA_TEXTO + ALTURA_LINHA + ESPACO_ENTRE_LINHAS);
          const larguraBarra = Math.max(4, (linha.valor / maiorValor) * LARGURA_PLOTAVEL);
          const cor = cores.categorica[linha.tipo];
          return (
            <g key={linha.tipo}>
              <text x={MARGEM.esquerda} y={y + 14} fontSize="14" fontWeight={600} fill={cores.tinta}>
                {ROTULO_TIPO_BEM[linha.tipo]}
              </text>
              <text x={largura - MARGEM.direita} y={y + 14} fontSize="13" textAnchor="end" fill={cores.tintaSuave}>
                {formatarMoeda(linha.valor)} · {formatarPercentual(linha.valor / total)}
              </text>
              <rect x={MARGEM.esquerda} y={y + ALTURA_TEXTO} width={LARGURA_PLOTAVEL} height={ALTURA_LINHA} rx={4} fill={cores.grade} />
              <rect x={MARGEM.esquerda} y={y + ALTURA_TEXTO} width={larguraBarra} height={ALTURA_LINHA} rx={4} fill={cor} />
            </g>
          );
        })}
      </svg>
    </Moldura>
  );
}
