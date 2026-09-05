import { resolverUnidade, type Celula, type ChaveTabela, type ColunaTabela, type LinhaTabela, type Tabela, type UnidadeCelula } from "@/types/croqui-calculo";
// Import DIRETO do submódulo, não do barril `@/server/motor-croqui`: este
// arquivo entra no bundle do link PÚBLICO (`/p/m`), e o barril arrasta
// catálogo, faixas e o motor inteiro para uma página que só formata número.
import { formatarCelula, TEXTO_AUSENTE, type TipoValor } from "@/server/motor-croqui/formatar";

/**
 * Camada de APRESENTAÇÃO das 19 tabelas do motor (M4, Fase 5 §4.6/§6.2).
 *
 * O motor carimba a unidade em `Tabela`/`ColunaTabela`/`LinhaTabela` (C1) e a
 * `Celula` continua sendo só valor + procedência. Aqui mora a decisão de COMO
 * cada linha se DESENHA — e só aqui, porque tela, deck, apresentação,
 * simulador e `/p/m` renderizam pelo mesmo caminho.
 *
 * Duas leis herdadas do motor, repetidas de propósito:
 *  1. quem formata é `formatarCelula` (M1) — ausência é `—`, nunca "R$ 0,00";
 *  2. sufixo ("h", "meses") NUNCA gruda em ausência — "— h" é um buraco
 *     disfarçado.
 */

// ---------------------------------------------------------------------------
// Unidade por (tabela, linha, coluna)
// ---------------------------------------------------------------------------

export interface Unidade {
  tipo: TipoValor;
  /** Aparece depois do número; jamais depois de `—`. */
  sufixo?: string;
}

const BRL: Unidade = { tipo: "brl" };
const PERCENTUAL: Unidade = { tipo: "percentual" };
/** Uma casa decimal + a palavra "meses" — resultado de divisão (payback). */
const MESES_FRACIONADOS: Unidade = { tipo: "meses" };
/** Contagem inteira de meses: "6 meses", não "6,0 meses". */
const MESES_INTEIROS: Unidade = { tipo: "numero", sufixo: "meses" };
const CONTAGEM: Unidade = { tipo: "numero" };
const HORAS: Unidade = { tipo: "numero", sufixo: "h" };

/**
 * `UnidadeCelula` (o que o motor carimba) → `Unidade` (o que a tela desenha).
 *
 * O remendo anterior reconstruía a unidade pelo NOME da chave da linha, porque
 * `ParametroCroqui.unidade` era lida em `contexto.ts` e descartada ao virar
 * `Celula`. Uma linha nova chamada `percentual` que fosse R$ renderizava como
 * porcentagem em silêncio. A costura da Fase 5 (C1) fechou o buraco na origem:
 * `Tabela`/`ColunaTabela`/`LinhaTabela` ganharam `unidade?`, `montarTabela` a
 * carimba, e `resolverUnidade` faz a precedência (linha > coluna > tabela >
 * `brl`). Aqui só sobra a tradução para a forma de desenhar.
 */
const POR_UNIDADE: Record<UnidadeCelula, Unidade> = {
  brl: BRL,
  percentual: PERCENTUAL,
  meses: MESES_FRACIONADOS,
  meses_inteiros: MESES_INTEIROS,
  contagem: CONTAGEM,
  horas: HORAS,
};

/** A unidade da célula, vinda do motor. Nunca adivinhada por nome de chave. */
export function unidadeDaCelula(
  tabela: Pick<Tabela, "unidade"> | undefined,
  linha: Pick<LinhaTabela, "unidade"> | undefined,
  coluna: Pick<ColunaTabela, "unidade"> | undefined,
): Unidade {
  return POR_UNIDADE[resolverUnidade(tabela, linha, coluna)];
}

/** Texto final da célula. Ausente sai `—` puro — sem sufixo, sem sinal, sem zero. */
export function textoDaCelula(celula: Celula, unidade: Unidade): string {
  const texto = formatarCelula(celula, unidade.tipo);
  if (texto === TEXTO_AUSENTE || !unidade.sufixo) return texto;
  return `${texto} ${unidade.sufixo}`;
}

// ---------------------------------------------------------------------------
// Procedência — glifo + `title`
// ---------------------------------------------------------------------------

/**
 * Glifo por procedência. `calculado` sem `fonte` especial não ganha marca no
 * modo normal: é a esmagadora maioria das ~250 células, e marcar todas é
 * ruído que ninguém lê. Quem quer ver tudo liga "De onde veio o número" —
 * aí `calculado` aparece como `ƒ`.
 */
export const MARCA_CALCULADO = "ƒ";

export interface MarcaProcedencia {
  /** `null` = não marca no modo normal. */
  glifo: string | null;
  /** Sempre presente: vira `title` e leitura de tela da célula. */
  explicacao: string;
  /** Célula sem insumo — a tela pinta de âmbar. */
  falta: boolean;
}

/**
 * TUDO o que o motor escreve numa célula é texto INTERNO: o motivo da
 * ausência ("falta a alíquota de ITCMD de MG — cadastre em Admin →
 * Parâmetros"), a fórmula ("ITCMD doação · v3" — rótulo do parâmetro mais a
 * VERSÃO dele), a origem ("a tabela de emolumentos desta UF não está
 * cadastrada"). Num link sem sessão isso vira o escritório contando ao
 * cliente o que não terminou de cadastrar.
 *
 * Por isso `publico` corta o RAMO INTEIRO, não só o da ausência: cada estado
 * tem uma frase de cliente, e nenhuma delas cita parâmetro. O `—` continua
 * igual nas duas superfícies — a lei "ausência nunca é zero" não é privada.
 */
const PARA_CLIENTE = {
  ausente: "Valor ainda não fechado.",
  digitado: "Valor informado pelo escritório.",
  estimativa: "Estimativa.",
  calculado: "Calculado pelo método.",
} as const;

export function marcaDaCelula(celula: Celula, publico = false): MarcaProcedencia {
  if (celula.procedencia === "ausente") {
    return {
      glifo: null, // o próprio `—` já é a marca
      explicacao: publico
        ? PARA_CLIENTE.ausente
        : (celula.motivo ?? "Falta cadastrar o parâmetro desta linha."),
      falta: true,
    };
  }

  if (celula.procedencia === "digitado") {
    return {
      glifo: "✎",
      explicacao: publico
        ? PARA_CLIENTE.digitado
        : celula.formula
          ? `Digitado pela advogada · ${celula.formula}`
          : "Digitado pela advogada",
      falta: false,
    };
  }

  if (celula.fonte === "percentual_fallback") {
    return {
      glifo: "≈",
      explicacao: publico
        ? PARA_CLIENTE.estimativa
        : celula.formula
          ? `Estimativa por percentual · ${celula.formula}`
          : "Estimativa por percentual — a tabela de emolumentos desta UF não está cadastrada.",
      falta: false,
    };
  }

  const fonte =
    celula.fonte === "tabela_uf"
      ? "Tabela oficial da UF"
      : celula.fonte === "fixo_metodo"
        ? "Regra fixa do método"
        : "Calculado pelo método";

  return {
    glifo: null,
    explicacao: publico ? PARA_CLIENTE.calculado : celula.formula ? `${fonte} · ${celula.formula}` : fonte,
    falta: false,
  };
}

// ---------------------------------------------------------------------------
// Ordem de leitura — a sequência das 19 abas do escritório
// ---------------------------------------------------------------------------

export interface GrupoTabelas {
  /** ≤ 3 palavras (lei de texto §2.2). */
  rotulo: string;
  tabelas: ChaveTabela[];
}

/**
 * A ordem é a da planilha real (`brain/06 - Materiais/Processo real do
 * escritorio (Drive).md` §2), agrupada pelos seis momentos da apresentação.
 * Reordenar aqui reordena tela, deck e `/p/m` de uma vez.
 *
 * `inventario_reforma` NÃO está na lista: ela não é bloco próprio, é a coluna
 * "após a reforma" de `inventario_atual` (ver `PAREAMENTOS`, em
 * `blocosCroqui.ts`). Uma regra, um lugar.
 */
export const GRUPOS_CROQUI: GrupoTabelas[] = [
  { rotulo: "Retrato", tabelas: ["composicao_familiar", "formacao_patrimonial"] },
  { rotulo: "Sem holding", tabelas: ["inventario_atual", "levantamento_inventario", "doacao"] },
  { rotulo: "Arquiteturas", tabelas: ["celula_1", "celula_2", "celula_3"] },
  { rotulo: "Empresa e aluguel", tabelas: ["operacional_pj", "operacional_locacao"] },
  { rotulo: "Comparação", tabelas: ["comparativo_geral", "itbi", "payback"] },
  {
    rotulo: "Investimento",
    tabelas: ["horas_por_ato", "honorarios", "deducoes", "pagamento", "membership"],
  },
];

// ---------------------------------------------------------------------------
// Recorte público (`/p/m`)
// ---------------------------------------------------------------------------

/**
 * O recorte de cliente do `/p/m` **mora em `src/types/croqui-calculo.ts`** desde
 * a costura da Fase 5 (C1): quem precisa dele é o SERVIDOR, na serialização
 * (`src/server/material/publico.ts`), e um arquivo de `src/components/**` não
 * pode ser importado por rota de API sem arrastar a camada de apresentação.
 *
 * Reexportado aqui para quem já importava daqui — uma lista só, um lugar só.
 * O filtro do navegador continua existindo como segunda camada; a trava é a do
 * servidor.
 */
export { TABELAS_VISIVEIS_AO_CLIENTE, visivelAoCliente } from "@/types/croqui-calculo";
