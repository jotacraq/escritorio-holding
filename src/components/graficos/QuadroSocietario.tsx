import { GraficoIndisponivel } from "./GraficoIndisponivel";
import { Moldura } from "./Moldura";
import { formatarData, formatarMoeda, formatarPercentual, PALETA_GRAFICO, type TipoBemGrafico } from "./paleta";
import type { GraficoBaseProps } from "./tipos";

export interface SocioQuadro {
  nome: string;
  qualificacao?: string | null;
  /** 0–100. `null`/ausente = não informado — a BrasilAPI nem sempre traz percentual. */
  percentual?: number | null;
  dataEntrada?: string | null;
}

export interface QuadroSocietarioProps extends GraficoBaseProps {
  razaoSocial?: string | null;
  /** CNPJ cru (14 dígitos) ou já formatado — o componente normaliza a exibição. */
  cnpj?: string | null;
  situacao?: string | null;
  capitalSocial?: number | null;
  /** Proveniência (Stripe pattern, §5.2): "consultado em DD/MM". */
  consultadoEm?: string | null;
  socios: SocioQuadro[];
  titulo?: string;
}

/** Ordem fixa de cor por posição do sócio na lista (identidade = ordem de entrada, não ranking de %). */
const ORDEM_COR_SOCIO: TipoBemGrafico[] = ["imovel", "investimento", "previdencia", "empresa", "veiculo"];
const LARGURA_BARRA = 608;

function formatarCnpj(cnpj: string): string {
  const digitos = cnpj.replace(/\D/g, "");
  if (digitos.length !== 14) return cnpj;
  return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8, 12)}-${digitos.slice(12, 14)}`;
}

/**
 * Mapa societário (aparece nos slides 2 e 4, §3.4). Fonte:
 * `consultas_cnpj.qsa` (BrasilAPI, §4) + `patrimonio_itens` tipo `empresa`.
 * Percentual nem sempre existe na fonte pública — quando falta, mostra
 * "não informado", nunca 0% (0% é uma afirmação, não um buraco).
 */
export function QuadroSocietario({
  razaoSocial,
  cnpj,
  situacao,
  capitalSocial,
  consultadoEm,
  socios,
  titulo = "Quadro societário",
  tema = "claro",
  modoApresentacao = false,
  className = "",
}: QuadroSocietarioProps) {
  const cores = PALETA_GRAFICO[tema];

  if (socios.length === 0) {
    return (
      <GraficoIndisponivel
        titulo={titulo}
        modoApresentacao={modoApresentacao}
        className={className}
        itensFaltantes={[{ campo: "Quadro societário (QSA) desta empresa", onde: "Aba Patrimônio — consultar dados públicos por CNPJ" }]}
      />
    );
  }

  const cor = (indice: number) => cores.categorica[ORDEM_COR_SOCIO[indice % ORDEM_COR_SOCIO.length]];

  const somaPercentuais = socios.reduce((soma, s) => soma + (s.percentual ?? 0), 0);
  const temPercentual = socios.some((s) => s.percentual != null);
  const restante = Math.max(0, 100 - somaPercentuais);
  const escala = Math.max(somaPercentuais + (restante > 0 ? restante : 0), 100);

  const ALTURA_CABECALHO = razaoSocial || cnpj || capitalSocial != null ? 58 : 0;
  const ALTURA_BARRA_PCT = temPercentual ? 34 : 0;
  const ALTURA_LINHA_SOCIO = 30;
  const altura = 12 + ALTURA_CABECALHO + ALTURA_BARRA_PCT + socios.length * ALTURA_LINHA_SOCIO + 12;
  const largura = LARGURA_BARRA + 32;

  const rotuloAria = `Quadro societário${razaoSocial ? ` de ${razaoSocial}` : ""}, com ${socios.length} ${socios.length === 1 ? "sócio" : "sócios"}${
    temPercentual ? `, somando ${formatarPercentual(somaPercentuais / 100)} de participação informada` : ", sem percentual informado pela fonte pública"
  }.`;

  const yBarra = 12 + ALTURA_CABECALHO;
  /** Segmentos da barra empilhada, com a posição x já resolvida — calculado
   * antes do JSX para não reatribuir variável durante a renderização. */
  const { segmentos, xFinal } = socios.reduce<{ segmentos: Array<{ nome: string; x: number; largura: number }>; xFinal: number }>(
    (acumulado, socio) => {
      if (socio.percentual == null) return acumulado;
      const largura = (socio.percentual / escala) * LARGURA_BARRA;
      return {
        segmentos: [...acumulado.segmentos, { nome: socio.nome, x: acumulado.xFinal, largura }],
        xFinal: acumulado.xFinal + largura,
      };
    },
    { segmentos: [], xFinal: 16 },
  );

  return (
    <Moldura
      titulo={titulo}
      tema={tema}
      fonte={consultadoEm ? `Fonte: BrasilAPI, consultado em ${formatarData(consultadoEm)}` : "Fonte: consulta de CNPJ (BrasilAPI)"}
      tabela={
        <table className="sr-only">
          <caption>{rotuloAria}</caption>
          <thead>
            <tr>
              <th scope="col">Sócio</th>
              <th scope="col">Qualificação</th>
              <th scope="col">Percentual</th>
              <th scope="col">Data de entrada</th>
            </tr>
          </thead>
          <tbody>
            {socios.map((s) => (
              <tr key={s.nome}>
                <td>{s.nome}</td>
                <td>{s.qualificacao ?? "não informado"}</td>
                <td>{s.percentual != null ? formatarPercentual(s.percentual / 100) : "não informado"}</td>
                <td>{s.dataEntrada ? formatarData(s.dataEntrada) : "não informado"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
      className={className}
    >
      <svg role="img" aria-label={rotuloAria} viewBox={`0 0 ${largura} ${altura}`} width="100%" height="auto" style={{ display: "block" }}>
        {ALTURA_CABECALHO > 0 && (
          <g>
            {razaoSocial && (
              <text x={16} y={12 + 16} fontSize="15" fontWeight={700} fill={cores.tinta}>
                {razaoSocial}
              </text>
            )}
            <text x={16} y={12 + 36} fontSize="12" fill={cores.tintaSuave}>
              {[cnpj ? formatarCnpj(cnpj) : null, situacao, capitalSocial != null ? `Capital social ${formatarMoeda(capitalSocial)}` : null]
                .filter(Boolean)
                .join("  ·  ")}
            </text>
          </g>
        )}

        {temPercentual && (
          <g>
            <rect x={16} y={yBarra} width={LARGURA_BARRA} height={16} rx={4} fill={cores.grade} />
            {segmentos.map((segmento, indice) => (
              <rect key={segmento.nome} x={segmento.x} y={yBarra} width={Math.max(0, segmento.largura)} height={16} fill={cor(indice)} />
            ))}
            {restante > 0 && somaPercentuais > 0 && (
              <rect x={xFinal} y={yBarra} width={(restante / escala) * LARGURA_BARRA} height={16} fill={cores.tintaFraca} opacity={0.4} />
            )}
          </g>
        )}

        {socios.map((socio, indice) => {
          const y = 12 + ALTURA_CABECALHO + ALTURA_BARRA_PCT + indice * ALTURA_LINHA_SOCIO;
          return (
            <g key={socio.nome}>
              {temPercentual && socio.percentual != null && <rect x={16} y={y + 9} width={10} height={10} rx={2} fill={cor(indice)} />}
              <text x={temPercentual ? 34 : 16} y={y + 17} fontSize="13" fontWeight={600} fill={cores.tinta}>
                {truncar(socio.nome, 34)}
                {socio.qualificacao ? ` — ${truncar(socio.qualificacao, 24)}` : ""}
              </text>
              <text x={largura - 16} y={y + 17} fontSize="13" textAnchor="end" fill={cores.tintaSuave}>
                {socio.percentual != null ? formatarPercentual(socio.percentual / 100) : "não informado"}
              </text>
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
