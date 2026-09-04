import { GraficoIndisponivel } from "./GraficoIndisponivel";
import { ItemLegenda, Moldura } from "./Moldura";
import { PALETA_GRAFICO, ROTULO_CATEGORIA_AFIRMACAO } from "./paleta";
import type { CategoriaAfirmacaoGrafico, GraficoBaseProps } from "./tipos";

export type CelulaTipo = "unica" | "cofre" | "veiculo" | "destino";

export interface ItemAlocado {
  descricao: string;
  categoria?: CategoriaAfirmacaoGrafico;
}

export interface CelulaArquitetura {
  tipo: CelulaTipo;
  /** Sobrescreve o rótulo padrão da função, se a advogada quiser nomear a célula. */
  rotulo?: string;
  itens: ItemAlocado[];
  /** Nome do instituidor a destacar dentro desta célula — usado no slide 10
   * (Controle na arquitetura), quase sempre na célula "veículo". */
  destaqueInstituidor?: string | null;
}

export interface DiagramaCelulasProps extends GraficoBaseProps {
  /** A arquitetura recomendada — só para o rótulo do cabeçalho; o desenho segue `celulas`. */
  arquitetura?: 1 | 2 | 3;
  celulas: CelulaArquitetura[];
  titulo?: string;
}

const ROTULO_CELULA: Record<CelulaTipo, string> = {
  unica: "Estrutura única",
  cofre: "Cofre",
  veiculo: "Veículo",
  destino: "Destino",
};

/** Cláusula do método — vive numa segunda linha do cabeçalho, não espremida
 * na mesma linha do nome (é isso que estourava a largura da caixa). */
const DESCRICAO_CELULA: Record<CelulaTipo, string> = {
  unica: "Concentra patrimônio, controle e destino",
  cofre: "Onde está o patrimônio",
  veiculo: "Quem controla e administra",
  destino: "Para quem e em quais condições",
};

function rotuloCompleto(celula: Pick<CelulaArquitetura, "tipo" | "rotulo">): string {
  if (celula.rotulo) return celula.rotulo;
  return `${ROTULO_CELULA[celula.tipo]} — ${DESCRICAO_CELULA[celula.tipo]}`;
}

const LARGURA = 640;
const GAP_SETA = 56;
const MARGEM = 16;
const ALTURA_CABECALHO = 46;
const ALTURA_ITEM = 20;

/**
 * Slides 7-10 (§3.4) — Cofre → Veículo → Destino. Não é gráfico de dados: é
 * diagrama de arquitetura. Fonte: `analise.arquitetura.alocacao` (schema v2).
 * Sem alocação → recomendação ainda é `ponto_a_validar`, e o diagrama não
 * inventa onde cada bem vai.
 */
export function DiagramaCelulas({ arquitetura, celulas, titulo, tema = "claro", modoApresentacao = false, className = "" }: DiagramaCelulasProps) {
  const cores = PALETA_GRAFICO[tema];
  const tituloFinal = titulo ?? (arquitetura ? `Arquitetura de ${arquitetura} ${arquitetura === 1 ? "célula" : "células"}` : "Arquitetura por células");

  const temAlgumItem = celulas.some((c) => c.itens.length > 0);
  if (celulas.length === 0 || !temAlgumItem) {
    return (
      <GraficoIndisponivel
        titulo={tituloFinal}
        tema={tema}
        modoApresentacao={modoApresentacao}
        className={className}
        itensFaltantes={[{ campo: "Alocação dos bens por célula (Cofre, Veículo, Destino)", onde: "Análise da Sessão" }]}
      />
    );
  }

  const n = celulas.length;
  const larguraCaixa = (LARGURA - (n - 1) * GAP_SETA) / n;
  const maiorItens = Math.max(...celulas.map((c) => c.itens.length), 1);
  const alturaCaixa = ALTURA_CABECALHO + maiorItens * ALTURA_ITEM + 44;
  const altura = alturaCaixa + MARGEM * 2;

  const categoriasPresentes = new Set<CategoriaAfirmacaoGrafico>();
  for (const c of celulas) for (const item of c.itens) if (item.categoria) categoriasPresentes.add(item.categoria);

  const rotuloAria = `Arquitetura de ${n} ${n === 1 ? "célula" : "células"}: ${celulas
    .map((c) => `${rotuloCompleto(c)} contém ${c.itens.length} ${c.itens.length === 1 ? "item" : "itens"}`)
    .join("; ")}.`;

  return (
    <Moldura
      titulo={tituloFinal}
      tema={tema}
      fonte="Fonte: alocação definida na Análise da Sessão"
      legenda={Array.from(categoriasPresentes).map((cat) => (
        <ItemLegenda key={cat} cor={cores.categoriaAfirmacao[cat]} rotulo={ROTULO_CATEGORIA_AFIRMACAO[cat]} tema={tema} />
      ))}
      tabela={
        <div className="sr-only">
          <table>
          <caption>{rotuloAria}</caption>
          <thead>
            <tr>
              <th scope="col">Célula</th>
              <th scope="col">Item alocado</th>
              <th scope="col">Categoria da afirmação</th>
            </tr>
          </thead>
          <tbody>
            {celulas.flatMap((c) =>
              c.itens.length > 0
                ? c.itens.map((item, indice) => (
                    <tr key={`${c.tipo}-${indice}`}>
                      <td>{rotuloCompleto(c)}</td>
                      <td>{item.descricao}</td>
                      <td>{item.categoria ? ROTULO_CATEGORIA_AFIRMACAO[item.categoria] : "não informado"}</td>
                    </tr>
                  ))
                : [
                    <tr key={c.tipo}>
                      <td>{rotuloCompleto(c)}</td>
                      <td colSpan={2}>sem item alocado</td>
                    </tr>,
                  ],
            )}
          </tbody>
          </table>
        </div>
      }
      className={className}
    >
      <svg role="img" aria-label={rotuloAria} viewBox={`0 0 ${LARGURA} ${altura}`} width="100%" style={{ display: "block", height: "auto" }}>
        {celulas.map((celula, indice) => {
          const x = indice * (larguraCaixa + GAP_SETA);
          const y = MARGEM;
          return (
            <g key={celula.tipo}>
              <rect x={x} y={y} width={larguraCaixa} height={alturaCaixa} rx={6} fill={cores.superficie} stroke={cores.latao} strokeWidth={2} />
              <rect x={x} y={y} width={larguraCaixa} height={ALTURA_CABECALHO} rx={6} fill={cores.latao} />
              <rect x={x} y={y + 8} width={larguraCaixa} height={ALTURA_CABECALHO - 8} fill={cores.latao} />
              {celula.rotulo ? (
                <text x={x + larguraCaixa / 2} y={y + ALTURA_CABECALHO / 2 + 5} fontSize="13" fontWeight={700} textAnchor="middle" fill={cores.superficie}>
                  {truncar(celula.rotulo, Math.floor(larguraCaixa / 6.2))}
                </text>
              ) : (
                <>
                  <text x={x + larguraCaixa / 2} y={y + 20} fontSize="14" fontWeight={700} textAnchor="middle" fill={cores.superficie}>
                    {ROTULO_CELULA[celula.tipo]}
                  </text>
                  <text x={x + larguraCaixa / 2} y={y + 36} fontSize="10.5" textAnchor="middle" fill={cores.superficie} opacity={0.9}>
                    {truncar(DESCRICAO_CELULA[celula.tipo], Math.floor(larguraCaixa / 5.4))}
                  </text>
                </>
              )}

              {celula.itens.length === 0 && (
                <text x={x + larguraCaixa / 2} y={y + ALTURA_CABECALHO + 26} fontSize="12" textAnchor="middle" fill={cores.tintaFraca} fontStyle="italic">
                  Sem item alocado ainda
                </text>
              )}
              {celula.itens.map((item, indiceItem) => {
                const yItem = y + ALTURA_CABECALHO + 20 + indiceItem * ALTURA_ITEM;
                const cor = item.categoria ? cores.categoriaAfirmacao[item.categoria] : cores.tintaFraca;
                return (
                  <g key={indiceItem}>
                    <circle cx={x + 16} cy={yItem - 4} r={4} fill={cor} />
                    <text x={x + 28} y={yItem} fontSize="12" fill={cores.tinta}>
                      {truncar(item.descricao, Math.floor(larguraCaixa / 6.2))}
                    </text>
                  </g>
                );
              })}

              {celula.destaqueInstituidor && (
                <text x={x + larguraCaixa / 2} y={y + alturaCaixa - 12} fontSize="11" fontWeight={700} textAnchor="middle" fill={cores.latao}>
                  ★ {truncar(celula.destaqueInstituidor, 24)}
                </text>
              )}

              {indice < celulas.length - 1 && (
                <g>
                  <line x1={x + larguraCaixa + 8} y1={y + alturaCaixa / 2} x2={x + larguraCaixa + GAP_SETA - 10} y2={y + alturaCaixa / 2} stroke={cores.linhaForte} strokeWidth={2} />
                  <path
                    d={`M ${x + larguraCaixa + GAP_SETA - 14} ${y + alturaCaixa / 2 - 6} L ${x + larguraCaixa + GAP_SETA - 4} ${y + alturaCaixa / 2} L ${x + larguraCaixa + GAP_SETA - 14} ${y + alturaCaixa / 2 + 6} Z`}
                    fill={cores.linhaForte}
                  />
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </Moldura>
  );
}

function truncar(texto: string, max: number): string {
  const limite = Math.max(6, max);
  return texto.length > limite ? `${texto.slice(0, limite - 1)}…` : texto;
}
