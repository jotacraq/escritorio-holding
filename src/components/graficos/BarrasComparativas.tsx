import { GraficoIndisponivel } from "./GraficoIndisponivel";
import { LegendaProcedencia, Moldura } from "./Moldura";
import { formatarMoeda, formatarPercentual, PALETA_GRAFICO } from "./paleta";
import type { GraficoBaseProps, ItemFaltante, ResumoProcedencia } from "./tipos";

export interface BarrasComparativasProps extends GraficoBaseProps {
  /** Custo de NÃO agir (cenário `inventario` da grade, ou digitado). `null` = não computável. */
  custoInventario: number | null | undefined;
  /** Custo projetado da estrutura recomendada. `null` = não computável. */
  custoEstrutura: number | null | undefined;
  rotuloInventario?: string;
  rotuloEstrutura?: string;
  /** Proveniência — quem digitou e quando / qual alíquota e versão de parâmetro. Regra dura: nenhum cálculo automático de imposto. */
  fonte?: string;
  titulo?: string;
  /**
   * Fase 4 (§4.5): quantas rubricas ainda estão `ausente` em cada cenário.
   * `null` = o cenário nem foi iniciado. Quando um total falta, o estado
   * explicativo diz "cenário incompleto — faltam N rubricas", nunca barra zero.
   */
  rubricasAusentes?: { inventario: number | null; estrutura: number | null };
  /** Contagem por procedência (digitado / calculado / ausente) — vira a legenda com glifo + texto. */
  procedencia?: { inventario: ResumoProcedencia | null; estrutura: ResumoProcedencia | null };
}

const LARGURA_PLOTAVEL = 520;
const MARGEM_ESQUERDA = 16;
const ALTURA_ROTULO = 22;
const ALTURA_BARRA = 40;
const ESPACO = 20;

function descreverFalta(rotulo: string, ausentes: number | null | undefined, onde: string): ItemFaltante {
  if (ausentes == null) return { campo: `${rotulo} — cenário ainda não iniciado`, onde };
  if (ausentes === 0) return { campo: `${rotulo} — cenário sem total (confira as rubricas)`, onde };
  return { campo: `${rotulo} — cenário incompleto: falta${ausentes === 1 ? "" : "m"} ${ausentes} rubrica${ausentes === 1 ? "" : "s"}`, onde };
}

/**
 * Slide 11 · Economia (§3.4) — CONFLITO C18. O único gráfico que o sistema
 * NÃO calcula: os dois totais vêm da grade do Cenário Patrimonial (0057) —
 * rubricas digitadas pela advogada ou multiplicadas de base × alíquota que
 * ela digitou (o trigger do banco faz a conta, nunca a tela). Se qualquer
 * total faltar, não desenha — nenhuma suposição de imposto.
 */
export function BarrasComparativas({
  custoInventario,
  custoEstrutura,
  rotuloInventario = "Custo do inventário",
  rotuloEstrutura = "Custo da estrutura",
  fonte = "Fonte: Cenário Patrimonial (digitado pela advogada)",
  titulo = "Custo de agir × custo de não agir",
  rubricasAusentes,
  procedencia,
  tema = "claro",
  modoApresentacao = false,
  className = "",
}: BarrasComparativasProps) {
  const cores = PALETA_GRAFICO[tema];

  if (custoInventario == null || custoEstrutura == null) {
    const faltando: ItemFaltante[] = [];
    if (custoInventario == null) faltando.push(descreverFalta(rotuloInventario, rubricasAusentes?.inventario, "Relatório › Cenário Patrimonial"));
    if (custoEstrutura == null) faltando.push(descreverFalta(rotuloEstrutura, rubricasAusentes?.estrutura, "Relatório › Cenário Patrimonial"));
    return <GraficoIndisponivel titulo={titulo} itensFaltantes={faltando} tema={tema} modoApresentacao={modoApresentacao} className={className} />;
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

  const somaProcedencia = somar(procedencia?.inventario, procedencia?.estrutura);

  return (
    <Moldura
      titulo={titulo}
      tema={tema}
      fonte={fonte}
      legenda={somaProcedencia ? <LegendaProcedencia resumo={somaProcedencia} tema={tema} /> : undefined}
      tabela={
        <div className="sr-only">
          <table>
            <caption>{rotuloAria}</caption>
            <thead>
              <tr>
                <th scope="col">Cenário</th>
                <th scope="col">Custo</th>
                <th scope="col">Procedência</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{rotuloInventario}</td>
                <td>{formatarMoeda(custoInventario)}</td>
                <td>{descreverProcedencia(procedencia?.inventario)}</td>
              </tr>
              <tr>
                <td>{rotuloEstrutura}</td>
                <td>{formatarMoeda(custoEstrutura)}</td>
                <td>{descreverProcedencia(procedencia?.estrutura)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      }
      className={className}
    >
      <svg role="img" aria-label={rotuloAria} viewBox={`0 0 ${largura} ${altura}`} width="100%" style={{ display: "block", height: "auto" }}>
        {linhas.map((linha, indice) => {
          const y = indice * (ALTURA_ROTULO + ALTURA_BARRA + ESPACO);
          const larguraBarra = Math.max(4, (linha.valor / maior) * LARGURA_PLOTAVEL);
          return (
            <g key={linha.rotulo}>
              <text x={MARGEM_ESQUERDA} y={y + 16} fontSize="15" fontWeight={700} fill={cores.tinta}>
                {linha.rotulo}
              </text>
              {/* Valor sempre ancorado na margem direita fixa — nunca "persegue" a ponta
                  da barra (isso é o que causava o rótulo estourar o viewBox quando a
                  barra chegava perto do máximo). */}
              <text x={MARGEM_ESQUERDA + LARGURA_PLOTAVEL} y={y + 16} fontSize="15" fontWeight={700} textAnchor="end" fill={linha.cor}>
                {formatarMoeda(linha.valor)}
              </text>
              <rect x={MARGEM_ESQUERDA} y={y + ALTURA_ROTULO} width={LARGURA_PLOTAVEL} height={ALTURA_BARRA} rx={5} fill={cores.grade} />
              <rect x={MARGEM_ESQUERDA} y={y + ALTURA_ROTULO} width={larguraBarra} height={ALTURA_BARRA} rx={5} fill={linha.cor} />
            </g>
          );
        })}
        <text x={MARGEM_ESQUERDA} y={altura - 14} fontSize="14" fontWeight={700} fill={estruturaMenor ? cores.bom : cores.ruim}>
          {fraseDiferenca}
        </text>
      </svg>
    </Moldura>
  );
}

function somar(a?: ResumoProcedencia | null, b?: ResumoProcedencia | null): ResumoProcedencia | null {
  if (!a && !b) return null;
  return {
    digitado: (a?.digitado ?? 0) + (b?.digitado ?? 0),
    calculado: (a?.calculado ?? 0) + (b?.calculado ?? 0),
    ausente: (a?.ausente ?? 0) + (b?.ausente ?? 0),
    total: (a?.total ?? 0) + (b?.total ?? 0),
  };
}

function descreverProcedencia(resumo?: ResumoProcedencia | null): string {
  if (!resumo) return "sem rubricas";
  return `${resumo.digitado} digitada(s), ${resumo.calculado} calculada(s), ${resumo.ausente} ausente(s)`;
}
