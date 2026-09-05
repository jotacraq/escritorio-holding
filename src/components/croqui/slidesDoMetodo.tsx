import type { ChaveTabela, ResultadoCroqui, Tabela } from "@/types/croqui-calculo";
import type { SlideApresentacao } from "@/types/publico-ui";
import { formatarCelula } from "@/server/motor-croqui/formatar";
import type { CroquiNarrativa } from "@/server/ia/schema-croqui-narrativa";
import { melhorEconomia, resolverTabelas } from "./blocosCroqui";
import { SUPERFICIES, type Superficie } from "./paletasTabela";
import { TabelaCroqui } from "./TabelaCroqui";

/**
 * Os slides do método, montados a partir do `ResultadoCroqui`.
 *
 * A sequência é a do deck real do escritório (`brain/06 - Materiais/Modelo
 * real do Croqui e da Sessao (Drive).md` §3, 17 slides), com o `payback` do
 * §4.6 acrescentado onde ele vende: logo depois da comparação. **Slide cuja
 * tabela não fechou não existe** — o motor não devolve tabela sem insumo, e
 * aqui isso vira slide a menos, não slide com "R$ 0,00".
 *
 * Duas frases do método são FIXAS e não passam por IA (são a espinha do
 * discurso, não uma sugestão de redação): a virada "holding deixa de ser
 * opção" e "Quem não tem vida eterna não deveria ter bens em seu nome" —
 * cofre · gatilho · controle.
 *
 * A IA, quando existe narrativa (v3), entra SÓ nas notas do apresentador
 * (tecla N): `como_apresentar` por tabela, perguntas, objeções e fechamento.
 * Sem narrativa, os slides saem com as tabelas e as frases do método — nunca
 * com um espaço reservado dizendo "a IA ainda não escreveu".
 */

export interface SlideDoMetodo {
  id: string;
  titulo: string;
  /** Tabelas que este slide mostra, na ordem. */
  tabelas: ChaveTabela[];
  /** Texto fixo do método, quando o slide é discurso e não número. */
  frase?: string;
  /** Pontos fixos do método abaixo da frase. */
  pontos?: string[];
}

/** A sequência do deck do escritório. Reordenar aqui reordena a reunião. */
export const SLIDES_DO_METODO: SlideDoMetodo[] = [
  { id: "familia", titulo: "Composição familiar", tabelas: ["composicao_familiar"] },
  { id: "patrimonio", titulo: "Formação patrimonial", tabelas: ["formacao_patrimonial"] },
  {
    id: "necessidade",
    titulo: "Por que a holding deixa de ser opção",
    tabelas: [],
    frase: "O inventário não é uma possibilidade. É uma certeza com data desconhecida.",
    pontos: [
      "O custo não é escolhido pela família — é imposto por lei e por prazo.",
      "Quem paga é quem fica, com o dinheiro que ainda não tem.",
    ],
  },
  {
    id: "inventario",
    titulo: "O que custa não fazer nada",
    // `inventario_atual` já vem pareada com a coluna "após a reforma".
    tabelas: ["inventario_atual", "levantamento_inventario"],
  },
  { id: "doacao", titulo: "E se doar em vida?", tabelas: ["doacao"] },
  {
    id: "como_funciona",
    titulo: "Quem não tem vida eterna não deveria ter bens em seu nome",
    tabelas: [],
    frase: "A holding faz três coisas, nesta ordem.",
    pontos: [
      "Cofre — os bens saem do nome da pessoa e entram no da empresa.",
      "Gatilho — a sucessão já está escrita e dispara sozinha, sem depender do Estado.",
      "Controle — quem construiu o patrimônio continua mandando nele, em vida.",
    ],
  },
  { id: "celula_1", titulo: "Uma célula", tabelas: ["celula_1"] },
  { id: "celula_2", titulo: "Duas células", tabelas: ["celula_2"] },
  { id: "celula_3", titulo: "Três células", tabelas: ["celula_3"] },
  { id: "comparativo", titulo: "Todos os caminhos, lado a lado", tabelas: ["comparativo_geral"] },
  { id: "itbi", titulo: "Atenção ao ITBI", tabelas: ["itbi"] },
  { id: "payback", titulo: "Em quanto tempo se paga", tabelas: ["payback"] },
  { id: "operacional", titulo: "A empresa que já existe", tabelas: ["operacional_pj"] },
  { id: "locacao", titulo: "Os aluguéis daqui para a frente", tabelas: ["operacional_locacao"] },
  { id: "horas", titulo: "O trabalho por trás", tabelas: ["horas_por_ato"] },
  { id: "honorarios", titulo: "Honorários", tabelas: ["honorarios"] },
  { id: "deducoes", titulo: "O que já foi pago abate", tabelas: ["deducoes"] },
  { id: "pagamento", titulo: "Forma de pagamento", tabelas: ["pagamento"] },
  { id: "membership", titulo: "Acompanhamento depois", tabelas: ["membership"] },
];

export interface SlideResolvido {
  slide: SlideDoMetodo;
  tabelas: Tabela[];
}

/**
 * A sequência de slides que este resultado consegue sustentar. Fonte única da
 * apresentação projetada e do deck impresso/`.docx` — as duas superfícies
 * mostram os mesmos slides, na mesma ordem, ou não é o mesmo croqui.
 */
export function resolverSlides(resultado: ResultadoCroqui): SlideResolvido[] {
  return SLIDES_DO_METODO.map((slide) => ({
    slide,
    tabelas: resolverTabelas(slide.tabelas, resultado),
  })).filter(({ slide, tabelas }) => tabelas.length > 0 || Boolean(slide.frase));
}

/** As notas do apresentador: narrativa da IA quando existe, senão nada. */
function notasDoSlide(
  slide: SlideDoMetodo,
  narrativa: CroquiNarrativa | null,
  ultimo: boolean,
): string | undefined {
  if (!narrativa) return undefined;

  const partes: string[] = [];
  for (const chave of slide.tabelas) {
    const nota = narrativa.como_apresentar.find((n) => n.tabela === chave);
    if (nota) partes.push(nota.texto);
  }

  if (ultimo) {
    if (narrativa.perguntas.length > 0) {
      partes.push("Perguntas:\n" + narrativa.perguntas.map((p) => `· ${p.pergunta} (${p.motivo})`).join("\n"));
    }
    if (narrativa.objecoes.length > 0) {
      partes.push(
        "Objeções:\n" + narrativa.objecoes.map((o) => `· ${o.objecao} → ${o.resposta_recomendada}`).join("\n"),
      );
    }
    if (narrativa.fechamento) partes.push(`Fechamento:\n${narrativa.fechamento}`);
  }

  return partes.length > 0 ? partes.join("\n\n") : undefined;
}

/**
 * Frase de impacto do slide de comparação, pela MESMA regra do número grande
 * do simulador (`melhorEconomia`). Sem economia calculável, o slide fica só
 * com a tabela — que já diz a verdade sozinha.
 */
function fraseDaEconomia(resultado: ResultadoCroqui): string | null {
  const melhor = melhorEconomia(resultado.tabelas.comparativo_geral);
  if (!melhor) return null;
  return `${melhor.modelo}: ${formatarCelula(melhor.economia)} a menos que o inventário.`;
}

/** Os slides prontos para `Apresentacao`. */
export function montarSlidesDoCroqui({
  resultado,
  narrativa = null,
}: {
  resultado: ResultadoCroqui;
  /** Narrativa v3 da IA. `null` = slides só com método e tabela. */
  narrativa?: CroquiNarrativa | null;
}): SlideApresentacao[] {
  const comConteudo = resolverSlides(resultado);

  return comConteudo.map(({ slide, tabelas }, i) => ({
    id: slide.id,
    titulo: slide.titulo,
    rotulo: `${String(i + 1).padStart(2, "0")} · Croqui Estrutural`,
    corpo: (
      <CorpoSlide
        slide={slide}
        tabelas={tabelas}
        superficie="projecao"
        destaque={slide.id === "comparativo" ? fraseDaEconomia(resultado) : null}
      />
    ),
    notas: notasDoSlide(slide, narrativa, i === comConteudo.length - 1),
  }));
}

/**
 * O corpo de um slide — a frase fixa do método, os pontos, o destaque e as
 * tabelas. UM componente para as duas superfícies: acrescentar um campo a
 * `SlideDoMetodo` não pode aparecer no projetor e sumir na folha.
 */
export function CorpoSlide({
  slide,
  tabelas,
  superficie,
  destaque = null,
  densidade = "projecao",
}: {
  slide: SlideDoMetodo;
  tabelas: Tabela[];
  superficie: Superficie;
  /** Frase de impacto do slide, quando o número existe. */
  destaque?: string | null;
  /** Escala tipográfica: grande no projetor, de leitura no papel. */
  densidade?: "projecao" | "documento";
}) {
  const { paleta } = SUPERFICIES[superficie];
  const projetando = densidade === "projecao";
  const duas = tabelas.length > 1;

  return (
    <div className={`flex w-full flex-col gap-4 ${projetando ? "items-center" : ""}`}>
      {slide.frase && (
        <p
          className={
            projetando
              ? "max-w-3xl text-[clamp(1.125rem,2vw,1.75rem)] leading-relaxed"
              : "max-w-2xl text-base leading-relaxed"
          }
          style={{ color: projetando ? paleta.tinta : paleta.tintaSuave }}
        >
          {slide.frase}
        </p>
      )}

      {slide.pontos && slide.pontos.length > 0 && (
        <ul
          className={`flex flex-col text-left ${
            projetando ? "max-w-3xl gap-3 text-[clamp(1rem,1.5vw,1.375rem)]" : "max-w-2xl gap-1 text-sm"
          }`}
          style={{ color: paleta.tintaSuave }}
        >
          {slide.pontos.map((ponto) => (
            <li key={ponto} className="flex gap-3">
              <span
                aria-hidden="true"
                className={projetando ? "mt-[0.6em] h-2 w-2 shrink-0 rounded-full" : "shrink-0"}
                style={projetando ? { background: paleta.marca } : { color: paleta.marca }}
              >
                {projetando ? "" : "·"}
              </span>
              {ponto}
            </li>
          ))}
        </ul>
      )}

      {destaque && (
        <p
          className={
            projetando ? "text-[clamp(1.25rem,2.4vw,2rem)] font-bold leading-tight" : "text-subtitulo font-bold"
          }
          style={{ color: paleta.marca }}
        >
          {destaque}
        </p>
      )}

      {tabelas.length > 0 && (
        <div
          className={`grid w-full gap-6 text-left ${projetando && duas ? "lg:grid-cols-2" : ""} ${
            projetando ? "" : "max-w-4xl"
          }`}
        >
          {tabelas.map((tabela) => (
            <TabelaCroqui
              key={tabela.chave}
              tabela={tabela}
              superficie={superficie}
              comTitulo={duas}
              nivelTitulo={projetando ? "h2" : "h3"}
            />
          ))}
        </div>
      )}
    </div>
  );
}
