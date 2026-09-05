import type { Celula, ChaveTabela, ResultadoCroqui, Tabela } from "@/types/croqui-calculo";
import { CHAVES_TABELA } from "@/types/croqui-calculo";
import { formatarCelula, TEXTO_AUSENTE } from "@/server/motor-croqui/formatar";

/**
 * Contexto do Agente do Croqui **v3 — narrativa** (Fase 5 §6.1).
 *
 * A IA deixou de calcular. Ela recebe as tabelas do motor JÁ RENDERIZADAS em
 * texto e escreve só a condução: como apresentar cada tabela, que pergunta
 * fazer, que objeção esperar, como fechar.
 *
 * Duas decisões que valem mais que o código:
 *
 * 1. **Célula ausente vai como `—`, com o motivo ao lado.** O prompt manda
 *    falar da ausência, nunca estimar. Antes disso, um deck saiu do
 *    escritório dizendo "a família perde aproximadamente R$ 0,00".
 * 2. **Nenhum insumo bruto de patrimônio entra aqui.** O que vai é a tabela
 *    que a família VAI VER na tela. Descrição de bem é rótulo de linha (o
 *    mesmo que aparece no slide), não cadastro; CPF, endereço e documento
 *    nunca passaram nem passam por aqui.
 *
 * Módulo puro: recebe o `ResultadoCroqui` (que a rota já leu de
 * `croqui_calculos` ou recalculou) e devolve texto. Sem I/O, testável.
 */

/** Quanto de texto uma tabela pode ocupar no prompt — corta cauda, não meio. */
const MAX_LINHAS_POR_TABELA = 24;

function textoDaCelulaParaPrompt(celula: Celula | undefined): string {
  if (!celula) return "·";
  if (celula.procedencia === "ausente") {
    return celula.motivo ? `${TEXTO_AUSENTE} (${celula.motivo})` : TEXTO_AUSENTE;
  }
  return formatarCelula(celula);
}

/** Uma tabela em texto tabulado — legível para o modelo, barato em tokens. */
export function renderizarTabela(tabela: Tabela): string {
  const cabecalho = ["", ...tabela.colunas.map((c) => c.rotulo)].join(" | ");
  const linhas = tabela.linhas.slice(0, MAX_LINHAS_POR_TABELA).map((linha) =>
    [linha.rotulo, ...tabela.colunas.map((c) => textoDaCelulaParaPrompt(linha.celulas[c.chave]))].join(" | "),
  );
  const cortadas = tabela.linhas.length - linhas.length;

  return [
    `### ${tabela.chave} — ${tabela.titulo}`,
    ...(tabela.nota ? [tabela.nota] : []),
    cabecalho,
    ...linhas,
    ...(cortadas > 0 ? [`(+${cortadas} linhas omitidas)`] : []),
  ].join("\n");
}

export interface ContextoNarrativaCroqui {
  /** Versão do motor que produziu as tabelas — carimbo de auditoria. */
  motor_versao: string;
  /** As tabelas em texto, na ordem em que a advogada vai apresentar. */
  tabelas: string;
  /** O que o motor NÃO soube calcular, em português. A IA fala disto. */
  ausencias: string[];
  /** Números que o escritório carrega em duas versões — a IA não escolhe. */
  divergencias: string[];
  /** Contexto humano da sessão, quando existe. Nunca inventado. */
  briefing: Record<string, unknown> | null;
  relatorio_sessao: Record<string, unknown> | null;
}

/**
 * Monta o contexto. `ordem` é a das 19 abas do escritório (`CHAVES_TABELA`,
 * do contrato do motor) — a mesma que a tela e o deck seguem. Sobrescrever só
 * faz sentido para narrar um recorte.
 */
export function montarContextoNarrativa(
  resultado: ResultadoCroqui,
  extra: { briefing?: Record<string, unknown> | null; relatorio_sessao?: Record<string, unknown> | null } = {},
  ordem: readonly ChaveTabela[] = CHAVES_TABELA,
): ContextoNarrativaCroqui {
  const presentes = ordem
    .map((chave) => resultado.tabelas[chave])
    .filter((t): t is Tabela => Boolean(t));

  return {
    motor_versao: resultado.motor_versao,
    tabelas: presentes.map(renderizarTabela).join("\n\n"),
    ausencias: resultado.faltas.map((falta) => {
      const onde = falta.municipio ?? falta.uf;
      return `${falta.chave}${onde ? ` (${onde})` : ""} — trava ${falta.tabelas.join(", ")}`;
    }),
    divergencias: resultado.divergencias.map((d) => `${d.chave}: ${d.valores.join(" × ")} (${d.onde})`),
    briefing: extra.briefing ?? null,
    relatorio_sessao: extra.relatorio_sessao ?? null,
  };
}

/**
 * O bloco de contexto que vai no corpo da mensagem do usuário. Texto, não
 * JSON: tabela em pipe custa ~40% menos token que o mesmo dado em objeto, e o
 * modelo lê melhor.
 */
export function contextoComoTexto(contexto: ContextoNarrativaCroqui): string {
  const partes = [
    `## Tabelas do croqui (motor ${contexto.motor_versao})`,
    "Estes números são definitivos. Não recalcule, não arredonde, não estime.",
    `"${TEXTO_AUSENTE}" significa que o parâmetro não está cadastrado: fale da ausência, nunca do valor.`,
    "",
    contexto.tabelas,
  ];

  if (contexto.ausencias.length > 0) {
    partes.push("", "## O que falta cadastrar", ...contexto.ausencias.map((a) => `- ${a}`));
  }
  if (contexto.divergencias.length > 0) {
    partes.push(
      "",
      "## Números em divergência no material do escritório",
      "Não escolha um deles; trate como ponto a validar.",
      ...contexto.divergencias.map((d) => `- ${d}`),
    );
  }
  if (contexto.briefing) {
    partes.push("", "## Briefing Estratégico", JSON.stringify(contexto.briefing));
  }
  if (contexto.relatorio_sessao) {
    partes.push("", "## Relatório da Sessão de Viabilidade", JSON.stringify(contexto.relatorio_sessao));
  }

  return partes.join("\n");
}
