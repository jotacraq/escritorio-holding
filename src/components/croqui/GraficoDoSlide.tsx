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
import type { CriterioArquitetura } from "@/components/ficha360/api-analise";
import type { CroquiSlide, Familiar, PatrimonioItem, Pessoa } from "@/lib/api";
import {
  calcularConcentracaoPatrimonial,
  mapearCriteriosParaMatriz,
  mapearFamiliaParaArvore,
  mapearPatrimonioParaComposicao,
  mapearRecomendacaoParaColuna,
} from "./mapeamentoGraficos";

export type TipoSlide = CroquiSlide["tipo"];

/** Tudo que os gráficos do croqui podem precisar, num único pacote — reunido
 * uma vez por tela (Editor / Análise / Apresentação) para não repetir busca
 * de dado em cada slide. Cada campo é honesto sobre o que falta: `null`
 * nunca vira "vazio silencioso", vira `<GraficoIndisponivel>` (§3.4). */
export interface DadosGraficosCroqui {
  pessoa: Pick<Pessoa, "id" | "nome"> | null;
  familiares: Familiar[] | null;
  patrimonio: PatrimonioItem[] | null;
  /** Forma ENXUTA: so o que a matriz desenha. O Modo Apresentacao manda
   *  exatamente isto — categoria e peso_na_decisao sao leitura interna do
   *  metodo e nunca chegam ao navegador que esta na frente da familia. */
  criterios: Array<{ criterio: string; resposta: { texto: string } }> | null;
  recomendacaoArquitetura: string | null;
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
      // `analise.arquitetura.alocacao` só existe na v2 (prompt ainda não
      // publicado, ver mapeamentoGraficos.ts) — sem isso, nunca inventamos
      // onde cada bem vai; o componente mostra o estado vazio honesto.
      return <DiagramaCelulas celulas={[]} tema={tema} modoApresentacao={modoApresentacao} />;
    }

    case "economia": {
      // `relatorios_sessao.tributos` e `ideia_custo_inventario` ainda são
      // texto livre no Relatório da Sessão, não número (RelatorioAba.tsx,
      // fora desta fronteira) — sem campo numérico, nunca adivinhamos um
      // valor. Pedido ao backend/RelatorioAba no relatório da onda.
      return <BarrasComparativas custoInventario={null} custoEstrutura={null} tema={tema} modoApresentacao={modoApresentacao} />;
    }

    case "implementacao": {
      // `analise.croqui[].pontos` da etapa "implementacao" só existe na v2.
      return <LinhaDoTempo eventos={[]} titulo="Etapas de implementação" tema={tema} modoApresentacao={modoApresentacao} />;
    }

    default:
      return null;
  }
}
