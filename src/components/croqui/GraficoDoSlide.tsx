import {
  ArvoreFamiliar,
  BarrasComparativas,
  BarrasComposicao,
  DiagramaCelulas,
  GraficoIndisponivel,
  LinhaDoTempo,
  MatrizCriterios,
  formatarPercentual,
  type TemaGrafico,
} from "@/components/graficos";
import type { CroquiSlide, Familiar, PatrimonioItem, Pessoa } from "@/lib/api";
import type { CenarioPatrimonial, CenarioRubrica, CenarioTotais, ParametroMetodo } from "@/types/cenario";
import {
  calcularConcentracaoPatrimonial,
  mapearAlocacaoParaCelulas,
  mapearCenarioParaEconomia,
  mapearCriteriosParaMatriz,
  mapearFamiliaParaArvore,
  mapearPatrimonioParaComposicao,
  mapearRecomendacaoParaColuna,
} from "./mapeamentoGraficos";

export type TipoSlide = CroquiSlide["tipo"];

/** Item da `arquitetura.alocacao` v2 (schema-analise-v2.ts) como chega à tela:
 * `GET /api/croquis/[id]?modo=apresentacao` manda só `celula` + `item`
 * (a `categoria` é leitura interna do método); no editor, a análise completa
 * traz a categoria também. */
export interface AlocacaoSlide {
  celula: string;
  item: string;
  categoria?: "fato_declarado" | "dado_documental" | "inferencia" | "ponto_a_validar";
}

/** Grade do Cenário Patrimonial (agente D, 0057) — a MESMA forma de
 * `GET /api/jornadas/[id]/cenario` e de `Ficha360.cenarios` (agente A):
 * totais por cenário (`total` null enquanto houver rubrica ausente) + rubricas
 * com procedência, para a legenda dizer de onde veio cada número. */
export interface DadosCenarioCroqui {
  cenarios: CenarioPatrimonial[];
  rubricas: CenarioRubrica[];
  totais: CenarioTotais[];
  /** `parametros_metodo` carimbados nas rubricas `calculado` — para "alíquota X% (parâmetro vY)". */
  parametros?: Record<string, ParametroMetodo>;
}

/** Tudo que os gráficos do croqui podem precisar, num único pacote — reunido
 * uma vez por tela (Editor / Análise / Apresentação) para não repetir busca
 * de dado em cada slide. Cada campo é honesto sobre o que falta: `null`
 * nunca vira "vazio silencioso", vira `<GraficoIndisponivel>` (§3.4).
 * `undefined` (campo não informado pela tela) é diferente de `null` (a tela
 * procurou e não havia): o Modo Apresentação completa os `undefined` com uma
 * leitura própria — ver `apiCroqui.ts`. */
export interface DadosGraficosCroqui {
  pessoa: Pick<Pessoa, "id" | "nome"> | null;
  familiares: Familiar[] | null;
  patrimonio: PatrimonioItem[] | null;
  /** Forma ENXUTA: so o que a matriz desenha. O Modo Apresentacao manda
   *  exatamente isto — categoria e peso_na_decisao sao leitura interna do
   *  metodo e nunca chegam ao navegador que esta na frente da familia. */
  criterios: Array<{ criterio: string; resposta: { texto: string } }> | null;
  recomendacaoArquitetura: string | null;
  /** Fase 4 (§4.5): alocação v2 (Cofre/Veículo/Destino) — slides 7-10. */
  alocacao?: AlocacaoSlide[] | null;
  /** Fase 4 (§4.5): Cenário Patrimonial — slide "economia". */
  cenario?: DadosCenarioCroqui | null;
}

/** Slides que o método (§3.4) associa a um gráfico. Os demais (legado,
 * controle, investimento) não têm gráfico — o slide é só texto, de propósito. */
const SLIDES_COM_GRAFICO = new Set<TipoSlide>([
  "familia",
  "patrimonio",
  "risco",
  "alternativas",
  "celula_1",
  "celula_2",
  "celula_3",
  "controle_arquitetura",
  "economia",
  "implementacao",
]);

export function slideTemGrafico(tipo: TipoSlide): boolean {
  return SLIDES_COM_GRAFICO.has(tipo);
}

const CELULAS_DA_RECOMENDACAO: Record<string, TipoSlide> = {
  "1_celula": "celula_1",
  "2_celulas": "celula_2",
  "3_celulas": "celula_3",
};

/**
 * O roteador tipo→gráfico (§3.4), num único lugar — a Ficha 360 (editor e
 * análise) e o Modo Apresentação chamam o MESMO componente, para nunca haver
 * dois desenhos diferentes do mesmo dado.
 */
export function GraficoDoSlide({
  tipo,
  dados,
  tema = "claro",
  modoApresentacao = false,
}: {
  tipo: TipoSlide;
  dados: DadosGraficosCroqui;
  tema?: TemaGrafico;
  modoApresentacao?: boolean;
}) {
  switch (tipo) {
    case "familia": {
      const { instituidores, nucleos } = mapearFamiliaParaArvore(dados.pessoa, dados.familiares);
      return <ArvoreFamiliar instituidores={instituidores} nucleos={nucleos} tema={tema} modoApresentacao={modoApresentacao} />;
    }

    case "patrimonio": {
      const itens = mapearPatrimonioParaComposicao(dados.patrimonio);
      return <BarrasComposicao itens={itens} tema={tema} modoApresentacao={modoApresentacao} />;
    }

    case "risco": {
      const itens = mapearPatrimonioParaComposicao(dados.patrimonio);
      const concentracao = calcularConcentracaoPatrimonial(dados.patrimonio);
      return (
        <div className="flex flex-col gap-2">
          <BarrasComposicao itens={itens} titulo="Concentração patrimonial por tipo de bem" tema={tema} modoApresentacao={modoApresentacao} />
          {concentracao && !modoApresentacao && (
            <p className="text-xs text-tinta-fraca">
              O maior bem representa {formatarPercentual(concentracao.fracao)} do patrimônio com valor registrado.
            </p>
          )}
        </div>
      );
    }

    case "alternativas": {
      if (!dados.criterios || dados.criterios.length === 0) {
        return (
          <GraficoIndisponivel
            titulo="Os 9 critérios de escolha da arquitetura"
            itensFaltantes={[{ campo: "Análise da Sessão com os 9 critérios avaliados", onde: "Análise da Sessão" }]}
            tema={tema}
            modoApresentacao={modoApresentacao}
          />
        );
      }
      const criterios = mapearCriteriosParaMatriz(dados.criterios);
      const recomendacao = dados.recomendacaoArquitetura ? mapearRecomendacaoParaColuna(dados.recomendacaoArquitetura) : undefined;
      return (
        <div className="flex flex-col gap-2">
          <MatrizCriterios criterios={criterios} recomendacao={recomendacao} tema={tema} modoApresentacao={modoApresentacao} />
          {!modoApresentacao && (
            <p className="text-xs text-tinta-fraca">
              Cada critério é a avaliação geral da análise (não por célula) — a coluna recomendada aparece destacada.
            </p>
          )}
        </div>
      );
    }

    case "celula_1":
    case "celula_2":
    case "celula_3":
    case "controle_arquitetura": {
      // A alocação v2 (`arquitetura.alocacao`) diz onde cada bem fica NA
      // ARQUITETURA RECOMENDADA — só. Desenhá-la nos slides das outras
      // alternativas seria inventar uma alocação que a análise não produziu:
      // o diagrama aparece no slide da recomendação e no de Controle.
      const recomendacao = dados.recomendacaoArquitetura;
      const slideDaRecomendacao = recomendacao ? CELULAS_DA_RECOMENDACAO[recomendacao] : undefined;
      const ehSlideDaRecomendacao = tipo === "controle_arquitetura" || tipo === slideDaRecomendacao;
      const arquitetura = recomendacao ? mapearRecomendacaoParaColuna(recomendacao) : undefined;

      if (!ehSlideDaRecomendacao) {
        const rotuloAlternativa = tipo === "celula_1" ? "1 célula" : tipo === "celula_2" ? "2 células" : "3 células";
        return (
          <GraficoIndisponivel
            titulo={`Arquitetura de ${rotuloAlternativa}`}
            itensFaltantes={[
              {
                campo: slideDaRecomendacao
                  ? `A alocação dos bens existe só para a arquitetura recomendada (${arquitetura} ${arquitetura === 1 ? "célula" : "células"})`
                  : "Recomendação de arquitetura (1, 2 ou 3 células)",
                onde: "Análise da Sessão",
              },
            ]}
            tema={tema}
            modoApresentacao={modoApresentacao}
          />
        );
      }

      const celulas = mapearAlocacaoParaCelulas(dados.alocacao ?? null, recomendacao, tipo === "controle_arquitetura" ? (dados.pessoa?.nome ?? null) : null);
      return (
        <DiagramaCelulas
          arquitetura={arquitetura}
          celulas={celulas}
          titulo={tipo === "controle_arquitetura" ? "Controle na arquitetura" : undefined}
          tema={tema}
          modoApresentacao={modoApresentacao}
        />
      );
    }

    case "economia": {
      // Fase 4 (§4.5): os dois números vêm da grade do Cenário Patrimonial
      // (`vw_cenarios_totais`, 0057) — digitados pela advogada ou
      // multiplicados de base × alíquota que ela digitou. Total `null`
      // (rubrica ausente) NUNCA vira barra: fora da apresentação, o estado
      // diz "faltam N rubricas"; na apresentação, o gráfico não aparece.
      const economia = mapearCenarioParaEconomia(dados.cenario ?? null, dados.recomendacaoArquitetura);
      return (
        <BarrasComparativas
          custoInventario={economia.custoInventario}
          custoEstrutura={economia.custoEstrutura}
          rotuloEstrutura={economia.rotuloEstrutura}
          rubricasAusentes={economia.rubricasAusentes}
          procedencia={economia.procedencia}
          fonte={economia.carimbo ?? "Fonte: Cenário Patrimonial — ainda sem número"}
          tema={tema}
          modoApresentacao={modoApresentacao}
        />
      );
    }

    case "implementacao": {
      // `analise.croqui[].pontos` da etapa "implementacao" só existe na v2.
      return <LinhaDoTempo eventos={[]} titulo="Etapas de implementação" tema={tema} modoApresentacao={modoApresentacao} />;
    }

    default:
      return null;
  }
}
