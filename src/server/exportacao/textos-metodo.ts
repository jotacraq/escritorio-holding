/**
 * Textos FIXOS do método — o que o escritório escreve igual em todo relatório,
 * independente do cliente.
 *
 * Origem: `brain/06 - Materiais/Processo real do escritorio (Drive).md` §4 (a
 * leitura de uma pasta-cliente completa do Drive, 51 arquivos). São **regra de
 * negócio**, não PII: nenhum nome, valor, CPF ou endereço de cliente aparece
 * aqui — e nenhum pode aparecer. Se um dia precisar variar por cliente, o texto
 * sai daqui e vira dado; enquanto for igual para todos, é constante de código
 * e o `.docx` não depende de banco para montar a parte narrativa.
 *
 * A separação existe por um motivo prático: `docx-croqui.ts` renderiza, este
 * arquivo edita. A Dra. Elaine muda uma frase do método sem ninguém tocar em
 * layout de tabela.
 */

import type { ModeloHolding } from "@/types/croqui-calculo";

export interface BlocoTexto {
  titulo: string;
  paragrafos: string[];
}

/**
 * As três células do método, na cascata de controle real: Destino controla
 * Veículo, que controla o Cofre (`CASCATA_CELULAS` em
 * `src/server/motor-croqui/dominio.ts` — a mesma ordem, dita em português).
 */
export const TEXTO_CELULAS: BlocoTexto = {
  titulo: "As três células",
  paragrafos: [
    "Cofre — guarda os bens. Os instituidores mantêm controle absoluto por usufruto vitalício: quem doou continua decidindo e continua recebendo os frutos.",
    "Veículo — fica no meio da cadeia e concentra a gestão e o controle das participações.",
    "Destino — é onde entram os herdeiros, como nu-proprietários. É a célula do planejamento patrimonial propriamente dito.",
    "A cascata de controle é esta: o Destino controla o Veículo, que controla o Cofre. Nenhum herdeiro toca o patrimônio enquanto o usufruto dos instituidores estiver de pé.",
  ],
};

/**
 * O "gatilho" — a Alteração Pós-Morte. É a operação jurídica por trás da frase
 * de vendas "dispara sozinho, sem depender do Estado", e o relatório precisa
 * dizer o que ela faz de concreto, não repetir o slogan.
 */
export const TEXTO_GATILHO: BlocoTexto = {
  titulo: "O gatilho",
  paragrafos: [
    "Cada célula tem uma Alteração Pós-Morte já redigida e guardada. Ela registra o óbito, aplica a cláusula de reversão e direito de acrescer do usufruto — o usufruto do falecido migra integralmente para o cônjuge sobrevivente —, transfere a administração isolada e exclusiva ao sobrevivente e mantém o capital social inalterado.",
    "É um documento que se leva a registro, não um processo que se abre. É essa diferença que o cálculo deste relatório mede em dinheiro e em tempo.",
  ],
};

/**
 * Controle — os dois desenhos possíveis na célula Destino. O relatório não
 * escolhe por ninguém: descreve os dois, porque a escolha é da reunião.
 */
export const TEXTO_CONTROLE: BlocoTexto = {
  titulo: "O controle",
  paragrafos: [
    "Há dois desenhos de controle na célula Destino. No tradicional, os instituidores reservam usufruto vitalício sobre as quotas doadas: voto e frutos continuam com eles. No desenho de Golden Share, o controle vem de uma classe específica de quotas com poder de veto sobre as decisões estruturais — alienação de imóvel, alteração do acordo e endividamento.",
    "As cláusulas que não cabem no contrato social vão para o Acordo de Sócios: mandato sucessório automático (art. 684 do Código Civil), dispensa de inventário com renúncia à apuração de haveres, regra de distribuição dos aluguéis enquanto houver usufruto, Call Option disciplinar dos pais sobre os filhos, Tag Along e Drag Along, e arbitragem sigilosa como foro.",
    "Quando o Acordo de Sócios não é assinado no prazo de sete dias, o escritório colhe um Termo de Ciência: a responsabilidade por conflito societário até a assinatura passa a ser do cliente.",
  ],
};

/**
 * Os passos de cada modelo. O que muda entre 1, 2 e 3 células no DESENHO —
 * cada afirmação aqui é sustentada por `dominio.ts` (`BASE_ITCMD`,
 * `BASE_CARTORIO_IMOVEIS`, `CASCATA_CELULAS`) ou pela nota do brain. Nada de
 * promessa de economia: o número é a tabela, não o texto.
 */
export const PASSOS_POR_MODELO: Record<ModeloHolding, BlocoTexto> = {
  celula_1: {
    titulo: "Uma célula — como se monta",
    paragrafos: [
      "Constituir uma sociedade holding e integralizar nela o patrimônio.",
      "Doar as quotas aos herdeiros com reserva de usufruto vitalício aos instituidores.",
      "Registrar a alteração societária e recolher o ITCMD da doação.",
      "Nesta arquitetura o ITCMD incide sobre o valor de mercado dos bens.",
    ],
  },
  celula_2: {
    titulo: "Duas células — como se monta",
    paragrafos: [
      "Constituir duas sociedades encadeadas em controle: a de cima controla a que guarda os bens.",
      "A célula de controle é domiciliada na unidade da federação fiscalmente vantajosa — é dela que sai a alíquota de ITCMD aplicada à doação das quotas.",
      "Integralizar o patrimônio, doar as quotas com reserva de usufruto e registrar.",
      "A base do ITCMD continua sendo o valor de mercado.",
    ],
  },
  celula_3: {
    titulo: "Três células — como se monta",
    paragrafos: [
      "Constituir Cofre, Veículo e Destino, nesta ordem de controle: Destino controla Veículo, que controla o Cofre.",
      "Integralizar os bens no Cofre e encadear as participações societárias.",
      "Doar as quotas do Destino aos herdeiros com reserva de usufruto aos instituidores.",
      "É o único dos três modelos em que o ITCMD tem por base o valor histórico declarado no imposto de renda, e não o valor de mercado. É o que faz esta arquitetura custar menos, apesar de ter mais atos de constituição — e é também por isso que ela consome menos horas de trabalho no total.",
    ],
  },
};

/** Como o cliente lê a tabela — a explicação da coluna, não do número. */
export const TEXTO_COMO_LER: BlocoTexto = {
  titulo: "Como ler este relatório",
  paragrafos: [
    "Cada tabela deste relatório é uma conta, com a fórmula registrada. Onde falta um dado ou um parâmetro para fechar a conta, a célula aparece com um travessão e o relatório diz, logo abaixo da tabela, exatamente o que falta.",
    // A frase evita de propósito escrever a cifra zerada por extenso: assim,
    // procurar por ela no arquivo entregue continua sendo um teste válido.
    "Travessão não é zero. Um custo que não pôde ser calculado nunca aparece aqui como um valor zerado.",
  ],
};

/** Aviso que abre o relatório quando ele foi gerado sobre dados de demonstração. */
export const TEXTO_EXEMPLO =
  "Este relatório foi gerado a partir de dados de demonstração. Os valores não correspondem ao patrimônio de nenhum cliente e não devem ser apresentados como cálculo real.";

/** Rodapé jurídico — mesma função do `material.rodape_juridico` da Fase 4. */
export const TEXTO_RODAPE_JURIDICO =
  "Estimativa elaborada com os parâmetros vigentes na data de emissão. Alíquotas, emolumentos e tabelas de custas mudam por ato do poder público e podem alterar os valores aqui apresentados.";

/** Cabeçalho da seção de pendências no fim do documento. */
export const TEXTO_FALTAS: BlocoTexto = {
  titulo: "O que falta para fechar o cálculo",
  paragrafos: [
    "Os itens abaixo impediram o cálculo de uma ou mais linhas deste relatório. Enquanto não forem cadastrados, as células correspondentes seguem com travessão.",
  ],
};

/** Cabeçalho da seção de divergências (§11.5 — parâmetro em duas versões). */
export const TEXTO_DIVERGENCIAS: BlocoTexto = {
  titulo: "Parâmetros em divergência",
  paragrafos: [
    "Os parâmetros abaixo têm mais de um valor em uso no material de origem. O cálculo não escolhe entre eles: trava a tabela que depende do parâmetro até a definição do escritório.",
  ],
};
