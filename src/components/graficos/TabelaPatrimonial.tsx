import { GraficoIndisponivel } from "./GraficoIndisponivel";
import { Moldura } from "./Moldura";
import { formatarMoeda, PALETA_GRAFICO, ROTULO_TIPO_BEM } from "./paleta";
import type { GraficoBaseProps, ItemPatrimonialTabela } from "./tipos";

export interface TabelaPatrimonialProps extends GraficoBaseProps {
  itens: ItemPatrimonialTabela[];
  titulo?: string;
  fonte?: string;
}

const NAO_INFORMADO = "—";

/**
 * Diagnóstico da SV — plano "Croqui rico em dados" (Fase C,
 * `brain/Diário/2026-09-04.md`). Diferente dos outros 8 componentes desta
 * pasta, isto NÃO é um gráfico SVG: é uma tabela densa (bem/ativo × custo
 * DIRPF × valor de mercado × rendimento × tributação), o mesmo formato do
 * documento real do escritório. Uma tabela HTML nativa já é acessível por
 * padrão — não duplica em `sr-only`, ao contrário dos irmãos SVG.
 *
 * Regra dura (CLAUDE.md — "nada de dado inventado na tela"): campo `null` é
 * "não informado" (`—`), NUNCA `R$ 0,00`. A linha de total só soma o que
 * existe e avisa quantos itens ficaram de fora da soma — nunca finge que o
 * total é o total real quando falta rubrica.
 *
 * Motor de cálculo (Fase B, "Cenário Patrimonial") ainda não existe — este
 * componente é puro (recebe `itens` pronto por prop) para já poder ser
 * plugado assim que a Fase B for desbloqueada (7 decisões pendentes com o
 * Marcio/Dra. Elaine, ver diário).
 */
export function TabelaPatrimonial({
  itens,
  titulo = "Tabela patrimonial",
  fonte = "Fonte: Aba Patrimônio — custo de origem (DIRPF) e valor de mercado declarados",
  tema = "claro",
  modoApresentacao = false,
  className = "",
}: TabelaPatrimonialProps) {
  const cores = PALETA_GRAFICO[tema];

  if (itens.length === 0) {
    return (
      <GraficoIndisponivel
        titulo={titulo}
        tema={tema}
        modoApresentacao={modoApresentacao}
        className={className}
        itensFaltantes={[{ campo: "Ao menos um bem cadastrado com custo de origem ou valor de mercado", onde: "Aba Patrimônio" }]}
      />
    );
  }

  const somar = (campo: "custoOrigemPF" | "valorMercado" | "rendimentoMensal") =>
    itens.reduce((soma, item) => (item[campo] != null ? soma + item[campo]! : soma), 0);

  const totalCusto = somar("custoOrigemPF");
  const totalMercado = somar("valorMercado");
  const totalRendimento = somar("rendimentoMensal");

  const omitidosCusto = itens.filter((i) => i.custoOrigemPF == null).length;
  const omitidosMercado = itens.filter((i) => i.valorMercado == null).length;
  const omitidosRendimento = itens.filter((i) => i.rendimentoMensal == null).length;

  const notasRodape: string[] = [];
  if (omitidosCusto > 0) notasRodape.push(`${omitidosCusto} ${omitidosCusto === 1 ? "item sem custo de origem informado" : "itens sem custo de origem informado"}, não ${omitidosCusto === 1 ? "somado" : "somados"}`);
  if (omitidosMercado > 0) notasRodape.push(`${omitidosMercado} ${omitidosMercado === 1 ? "item sem valor de mercado informado" : "itens sem valor de mercado informado"}, não ${omitidosMercado === 1 ? "somado" : "somados"}`);
  if (omitidosRendimento > 0) notasRodape.push(`${omitidosRendimento} ${omitidosRendimento === 1 ? "item sem rendimento mensal informado" : "itens sem rendimento mensal informado"}, não ${omitidosRendimento === 1 ? "somado" : "somados"}`);

  const rotuloAria = `Tabela patrimonial com ${itens.length} ${itens.length === 1 ? "bem" : "bens"}. Total geral: custo de origem ${formatarMoeda(totalCusto)}, valor de mercado ${formatarMoeda(totalMercado)}, rendimento mensal ${formatarMoeda(totalRendimento)}.${
    notasRodape.length > 0 ? ` ${notasRodape.join("; ")}.` : ""
  }`;

  return (
    <Moldura titulo={titulo} tema={tema} fonte={fonte} tabela={null} className={className}>
      {/* Tabela HTML nativa: diferente dos irmãos SVG, aqui o conteúdo visível
          JÁ é acessível por padrão (linhas, colunas, cabeçalhos com `scope`).
          `role="img"` esconderia a estrutura de tabela do leitor de tela —
          por isso a proveniência vai só na `caption` (visualmente oculta). */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <caption className="sr-only">{rotuloAria}</caption>
          <thead>
            <tr style={{ borderBottom: `1.5px solid ${cores.linhaForte}` }}>
              <Th align="left" cores={cores}>Bem/Ativo</Th>
              <Th align="left" cores={cores}>Tipo</Th>
              <Th align="right" cores={cores}>Custo (valor DIRPF)</Th>
              <Th align="right" cores={cores}>Valor atual (mercado)</Th>
              <Th align="right" cores={cores}>Rendimento mensal</Th>
              <Th align="left" cores={cores}>Tributação</Th>
            </tr>
          </thead>
          <tbody>
            {itens.map((item, indice) => (
              <tr key={`${item.descricao}-${indice}`} style={{ borderBottom: `1px solid ${cores.linha}` }}>
                <Td cores={cores} peso={600}>{item.descricao}</Td>
                <Td cores={cores}>{ROTULO_TIPO_BEM[item.tipo]}</Td>
                <Td cores={cores} align="right" ausente={item.custoOrigemPF == null}>
                  {item.custoOrigemPF != null ? formatarMoeda(item.custoOrigemPF) : NAO_INFORMADO}
                </Td>
                <Td cores={cores} align="right" ausente={item.valorMercado == null}>
                  {item.valorMercado != null ? formatarMoeda(item.valorMercado) : NAO_INFORMADO}
                </Td>
                <Td cores={cores} align="right" ausente={item.rendimentoMensal == null}>
                  {item.rendimentoMensal != null ? formatarMoeda(item.rendimentoMensal) : NAO_INFORMADO}
                </Td>
                <Td cores={cores} ausente={item.tributacao == null}>{item.tributacao ?? "não informado"}</Td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: `1.5px solid ${cores.linhaForte}` }}>
              <Td cores={cores} peso={700}>TOTAL GERAL</Td>
              <Td cores={cores}></Td>
              <Td cores={cores} align="right" peso={700}>{formatarMoeda(totalCusto)}</Td>
              <Td cores={cores} align="right" peso={700}>{formatarMoeda(totalMercado)}</Td>
              <Td cores={cores} align="right" peso={700}>{formatarMoeda(totalRendimento)}</Td>
              <Td cores={cores}></Td>
            </tr>
          </tfoot>
        </table>
      </div>

      {notasRodape.length > 0 && (
        <p className="mt-2 text-xs" style={{ color: cores.tintaFraca }}>
          {notasRodape.map((nota) => `${nota}.`).join(" ")}
        </p>
      )}
    </Moldura>
  );
}

type Cores = (typeof PALETA_GRAFICO)["claro"];

function Th({ children, align = "left", cores }: { children: React.ReactNode; align?: "left" | "right"; cores: Cores }) {
  return (
    <th scope="col" className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide ${align === "right" ? "text-right" : "text-left"}`} style={{ color: cores.tintaSuave }}>
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  peso = 400,
  ausente = false,
  cores,
}: {
  children?: React.ReactNode;
  align?: "left" | "right";
  peso?: number;
  ausente?: boolean;
  cores: Cores;
}) {
  return (
    <td
      className={`px-3 py-2 ${align === "right" ? "text-right" : "text-left"}`}
      style={{ color: ausente ? cores.tintaFraca : cores.tinta, fontWeight: peso, fontStyle: ausente ? "italic" : "normal" }}
    >
      {children}
    </td>
  );
}
