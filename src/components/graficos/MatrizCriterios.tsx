import { GraficoIndisponivel } from "./GraficoIndisponivel";
import { ItemLegenda, Moldura } from "./Moldura";
import { PALETA_GRAFICO } from "./paleta";
import type { GraficoBaseProps } from "./tipos";

export type NivelAtendimento = "atende" | "atende_parcial" | "nao_atende" | "nao_se_aplica";

export interface RespostaCelulaCriterio {
  nivel: NivelAtendimento;
  /** Justificativa curta — vira o texto da linha na tabela `sr-only`. */
  nota?: string;
}

export interface CriterioMatriz {
  id: string;
  /** Rótulo em português do critério — este componente não hardcoda os 9
   * textos do método (eles moram no schema/prompt); recebe pronto. */
  criterio: string;
  celula1: RespostaCelulaCriterio;
  celula2: RespostaCelulaCriterio;
  celula3: RespostaCelulaCriterio;
}

export interface MatrizCriteriosProps extends GraficoBaseProps {
  criterios: CriterioMatriz[];
  /** Arquitetura recomendada pela análise — a coluna correspondente ganha destaque. */
  recomendacao?: 1 | 2 | 3;
  titulo?: string;
}

const ROTULO_NIVEL: Record<NivelAtendimento, string> = {
  atende: "Atende",
  atende_parcial: "Atende parcialmente",
  nao_atende: "Não atende",
  nao_se_aplica: "Não se aplica",
};

const LARGURA = 640;
const COL_CRITERIO = 232;
const ALTURA_CABECALHO = 32;
const ALTURA_LINHA = 32;
const MARGEM = 12;

/**
 * Slide 6 · Alternativas (§3.4). Fonte: `analise.arquitetura.criterios` — já
 * existe no schema v1, com `.length(9)` garantido. Prova que a holding não foi
 * escolhida antes de comparar os caminhos (princípio do método).
 */
export function MatrizCriterios({ criterios, recomendacao, titulo = "Os 9 critérios de escolha da arquitetura", tema = "claro", modoApresentacao = false, className = "" }: MatrizCriteriosProps) {
  const cores = PALETA_GRAFICO[tema];

  if (criterios.length === 0) {
    return (
      <GraficoIndisponivel
        titulo={titulo}
        modoApresentacao={modoApresentacao}
        className={className}
        itensFaltantes={[{ campo: "Os 9 critérios de escolha entre 1, 2 e 3 células", onde: "Análise da Sessão" }]}
      />
    );
  }

  const larguraCelula = (LARGURA - COL_CRITERIO) / 3;
  const altura = MARGEM + ALTURA_CABECALHO + criterios.length * ALTURA_LINHA + MARGEM;

  const corNivel: Record<NivelAtendimento, string> = {
    atende: cores.bom,
    atende_parcial: cores.categoriaAfirmacao.inferencia,
    nao_atende: cores.ruim,
    nao_se_aplica: cores.tintaFraca,
  };

  const rotuloAria = `Matriz de ${criterios.length} critérios de escolha de arquitetura, comparando 1, 2 e 3 células${
    recomendacao ? `. Arquitetura recomendada: ${recomendacao} ${recomendacao === 1 ? "célula" : "células"}` : ""
  }.`;

  const colunasCelula: Array<{ chave: "celula1" | "celula2" | "celula3"; rotulo: string; n: 1 | 2 | 3 }> = [
    { chave: "celula1", rotulo: "1 célula", n: 1 },
    { chave: "celula2", rotulo: "2 células", n: 2 },
    { chave: "celula3", rotulo: "3 células", n: 3 },
  ];

  return (
    <Moldura
      titulo={titulo}
      tema={tema}
      fonte="Fonte: Análise da Sessão — arquitetura.criterios"
      legenda={(Object.keys(ROTULO_NIVEL) as NivelAtendimento[]).map((nivel) => (
        <ItemLegenda key={nivel} cor={corNivel[nivel]} rotulo={ROTULO_NIVEL[nivel]} tema={tema} />
      ))}
      tabela={
        <table className="sr-only">
          <caption>{rotuloAria}</caption>
          <thead>
            <tr>
              <th scope="col">Critério</th>
              <th scope="col">1 célula</th>
              <th scope="col">2 células</th>
              <th scope="col">3 células</th>
            </tr>
          </thead>
          <tbody>
            {criterios.map((c) => (
              <tr key={c.id}>
                <td>{c.criterio}</td>
                {colunasCelula.map(({ chave }) => (
                  <td key={chave}>
                    {ROTULO_NIVEL[c[chave].nivel]}
                    {c[chave].nota ? ` — ${c[chave].nota}` : ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      }
      className={className}
    >
      <svg role="img" aria-label={rotuloAria} viewBox={`0 0 ${LARGURA} ${altura}`} width="100%" height="auto" style={{ display: "block" }}>
        {colunasCelula.map((coluna, indice) =>
          coluna.n === recomendacao ? (
            <rect
              key={coluna.chave}
              x={COL_CRITERIO + indice * larguraCelula}
              y={MARGEM}
              width={larguraCelula}
              height={altura - MARGEM * 2}
              fill={cores.latao}
              opacity={0.08}
            />
          ) : null,
        )}

        <text x={MARGEM} y={MARGEM + ALTURA_CABECALHO / 2 + 5} fontSize="12" fontWeight={700} fill={cores.tintaSuave}>
          Critério
        </text>
        {colunasCelula.map((coluna, indice) => (
          <text
            key={coluna.chave}
            x={COL_CRITERIO + indice * larguraCelula + larguraCelula / 2}
            y={MARGEM + ALTURA_CABECALHO / 2 + 5}
            fontSize="12"
            fontWeight={700}
            textAnchor="middle"
            fill={coluna.n === recomendacao ? cores.latao : cores.tintaSuave}
          >
            {coluna.rotulo}
            {coluna.n === recomendacao ? " ★" : ""}
          </text>
        ))}
        <line x1={0} y1={MARGEM + ALTURA_CABECALHO} x2={LARGURA} y2={MARGEM + ALTURA_CABECALHO} stroke={cores.linhaForte} strokeWidth={1.5} />

        {criterios.map((c, indiceLinha) => {
          const y = MARGEM + ALTURA_CABECALHO + indiceLinha * ALTURA_LINHA;
          return (
            <g key={c.id}>
              {indiceLinha > 0 && <line x1={0} y1={y} x2={LARGURA} y2={y} stroke={cores.linha} strokeWidth={1} />}
              <text x={MARGEM} y={y + ALTURA_LINHA / 2 + 4} fontSize="12" fill={cores.tinta}>
                {truncar(c.criterio, 40)}
              </text>
              {colunasCelula.map(({ chave }, indiceColuna) => {
                const resposta = c[chave];
                const cx = COL_CRITERIO + indiceColuna * larguraCelula + larguraCelula / 2;
                const cy = y + ALTURA_LINHA / 2;
                return (
                  <g key={chave}>
                    {resposta.nota && <title>{resposta.nota}</title>}
                    <IconeNivel nivel={resposta.nivel} cx={cx} cy={cy} cor={corNivel[resposta.nivel]} />
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </Moldura>
  );
}

function IconeNivel({ nivel, cx, cy, cor }: { nivel: NivelAtendimento; cx: number; cy: number; cor: string }) {
  if (nivel === "atende") {
    return (
      <g>
        <circle cx={cx} cy={cy} r={8} fill={cor} />
        <path d={`M ${cx - 4} ${cy} l 2.5 2.5 l 5 -5`} stroke="white" strokeWidth={1.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    );
  }
  if (nivel === "nao_atende") {
    return (
      <g>
        <circle cx={cx} cy={cy} r={8} fill="none" stroke={cor} strokeWidth={1.8} />
        <path d={`M ${cx - 3.5} ${cy - 3.5} L ${cx + 3.5} ${cy + 3.5} M ${cx + 3.5} ${cy - 3.5} L ${cx - 3.5} ${cy + 3.5}`} stroke={cor} strokeWidth={1.8} strokeLinecap="round" />
      </g>
    );
  }
  if (nivel === "atende_parcial") {
    return (
      <g>
        <circle cx={cx} cy={cy} r={8} fill="none" stroke={cor} strokeWidth={1.8} />
        <path d={`M ${cx} ${cy - 8} A 8 8 0 0 1 ${cx} ${cy + 8} Z`} fill={cor} />
      </g>
    );
  }
  return <line x1={cx - 6} y1={cy} x2={cx + 6} y2={cy} stroke={cor} strokeWidth={1.8} strokeLinecap="round" />;
}

function truncar(texto: string, max: number): string {
  return texto.length > max ? `${texto.slice(0, max - 1)}…` : texto;
}
