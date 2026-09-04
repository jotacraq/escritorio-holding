import { GraficoIndisponivel } from "./GraficoIndisponivel";
import { Moldura } from "./Moldura";
import { formatarData, PALETA_GRAFICO } from "./paleta";
import type { GraficoBaseProps } from "./tipos";

export interface EventoLinhaDoTempo {
  id: string;
  titulo: string;
  descricao?: string | null;
  /** ISO 8601. */
  ocorridoEm: string;
}

export interface LinhaDoTempoProps extends GraficoBaseProps {
  eventos: EventoLinhaDoTempo[];
  titulo?: string;
}

const LARGURA = 640;
const X_SPINE = 28;
const X_TEXTO = 52;
const MARGEM_TOPO = 12;
const ALTURA_BASE = 40;
const ALTURA_DESCRICAO = 20;

/**
 * Serve dois usos do método com o mesmo formato de dado: a jornada da família
 * (do seminário até aqui) e o slide 12 · Implementação (§3.4, fonte
 * `analise.croqui.implementacao.pontos`). Uma sequência de eventos com data é
 * uma sequência de eventos com data — não precisa de dois componentes.
 */
export function LinhaDoTempo({ eventos, titulo = "Linha do tempo", tema = "claro", modoApresentacao = false, className = "" }: LinhaDoTempoProps) {
  const cores = PALETA_GRAFICO[tema];

  if (eventos.length === 0) {
    return (
      <GraficoIndisponivel
        titulo={titulo}
        modoApresentacao={modoApresentacao}
        className={className}
        itensFaltantes={[{ campo: "Ao menos um evento com data registrado", onde: "Linha do tempo / Análise da Sessão" }]}
      />
    );
  }

  const ordenados = [...eventos].sort((a, b) => new Date(a.ocorridoEm).getTime() - new Date(b.ocorridoEm).getTime());
  const alturas = ordenados.map((e) => ALTURA_BASE + (e.descricao ? ALTURA_DESCRICAO : 0));
  const posicoesY: number[] = [];
  let acumulado = MARGEM_TOPO;
  for (const h of alturas) {
    posicoesY.push(acumulado);
    acumulado += h;
  }
  const altura = acumulado + MARGEM_TOPO;

  const rotuloAria = `Linha do tempo com ${ordenados.length} eventos, de ${formatarData(ordenados[0].ocorridoEm)} a ${formatarData(ordenados[ordenados.length - 1].ocorridoEm)}.`;

  return (
    <Moldura
      titulo={titulo}
      tema={tema}
      fonte="Fonte: registro de eventos da jornada"
      tabela={
        <table className="sr-only">
          <caption>{rotuloAria}</caption>
          <thead>
            <tr>
              <th scope="col">Data</th>
              <th scope="col">Evento</th>
              <th scope="col">Descrição</th>
            </tr>
          </thead>
          <tbody>
            {ordenados.map((e) => (
              <tr key={e.id}>
                <td>{formatarData(e.ocorridoEm)}</td>
                <td>{e.titulo}</td>
                <td>{e.descricao ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
      className={className}
    >
      <svg role="img" aria-label={rotuloAria} viewBox={`0 0 ${LARGURA} ${altura}`} width="100%" height="auto" style={{ display: "block" }}>
        <line x1={X_SPINE} y1={MARGEM_TOPO} x2={X_SPINE} y2={altura - MARGEM_TOPO} stroke={cores.linhaForte} strokeWidth={2} />
        {ordenados.map((evento, indice) => {
          const y = posicoesY[indice];
          return (
            <g key={evento.id}>
              <circle cx={X_SPINE} cy={y + 6} r={6} fill={cores.superficie} stroke={cores.latao} strokeWidth={2.5} />
              <text x={X_TEXTO} y={y + 6} fontSize="11" fontWeight={700} fill={cores.tintaFraca}>
                {formatarData(evento.ocorridoEm)}
              </text>
              <text x={X_TEXTO} y={y + 24} fontSize="14" fontWeight={600} fill={cores.tinta}>
                {truncar(evento.titulo, 62)}
              </text>
              {evento.descricao && (
                <text x={X_TEXTO} y={y + 40} fontSize="12" fill={cores.tintaSuave}>
                  {truncar(evento.descricao, 72)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </Moldura>
  );
}

function truncar(texto: string, max: number): string {
  return texto.length > max ? `${texto.slice(0, max - 1)}…` : texto;
}
