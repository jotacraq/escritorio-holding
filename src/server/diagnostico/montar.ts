import type { Familiar, PatrimonioItem, Pessoa, RelatorioSessao } from "@/types/banco";
import {
  ROTULO_CENARIO,
  type BlocoDiagnostico,
  type CenarioRubrica,
  type CenarioTotais,
  type ParametroMetodo,
  type TipoCenario,
} from "@/types/cenario";
import type { CroquiAnalise } from "@/server/ia/schema-croqui-analise";
import type { CroquiAnaliseV2 } from "@/server/croqui/schema-analise-v2";

/**
 * `montarDiagnostico` — FUNÇÃO PURA. Zero IA, zero I/O, zero data/aleatório.
 * Deriva os 7 blocos do Diagnóstico da SV (ARQUITETURA-FASE-4 §4.7) dos fatos
 * que já existem. Regras que valem para todos os blocos:
 *   - nada inventado: sem dado, o bloco diz "sem registro" e vai para
 *     `o_que_falta`; nunca um exemplo plausível;
 *   - `visivel_ao_cliente` nasce `false` em TODOS (B31); a advogada liga
 *     bloco a bloco na tela; `o_que_falta` é sempre interno (CHECK no banco);
 *   - a categoria do bloco é a MAIS FRACA das afirmações que ele reúne
 *     (fato → dado → inferência → ponto a validar) — nunca promove.
 *
 * Testes de mesa (em comentário, porque o projeto não tem runner):
 *   1. entrada vazia (sem familiares, sem patrimônio, sem análise, sem cenário)
 *      → 7 blocos; os 6 primeiros com conteudo "Sem registro..." e
 *      categoria 'ponto_a_validar'; `o_que_falta` lista os 6.
 *   2. 2 familiares + 3 bens com valor_mercado + análise v2 com 2 riscos e
 *      recomendação '2_celulas' + cenário inventário completo (total 55 001)
 *      → mapa_patrimonial.pontos tem 3 linhas e 1 linha de total declarado;
 *        riscos_identificados.pontos tem 2; arquitetura_recomendada.conteudo
 *        cita "2 células"; cenario_patrimonial.pontos tem "Inventário: R$ 55.001,00";
 *        o_que_falta NÃO cita esses blocos.
 *   3. cenário com rubrica ausente → cenario_patrimonial cita "faltam N
 *      rubricas" e NÃO mostra total; o_que_falta cita as rubricas ausentes.
 *   4. análise com recomendacao 'ponto_a_validar' → arquitetura_recomendada
 *      categoria 'ponto_a_validar', conteudo diz que a análise não fechou.
 */

export interface EntradaDiagnostico {
  pessoa: Pick<Pessoa, "nome"> | null;
  familiares: Familiar[] | null;
  patrimonio: PatrimonioItem[] | null;
  relatorio: RelatorioSessao | null;
  /** análise atual do Agente do Croqui (v1 ou v2) — `null` quando não há */
  analise: { id: string; schema_versao: number; conteudo: CroquiAnalise | CroquiAnaliseV2 } | null;
  cenarios: { totais: CenarioTotais[]; rubricas: CenarioRubrica[]; cenarioIdPorTipo: Record<string, TipoCenario> };
  /** parâmetros carimbados nas rubricas `calculado` (id → linha) */
  parametros: Record<string, ParametroMetodo>;
}

type Categoria = BlocoDiagnostico["categoria"];
const ORDEM_CATEGORIA: Categoria[] = ["fato_declarado", "dado_documental", "inferencia", "ponto_a_validar"];

function maisFraca(categorias: Categoria[]): Categoria {
  if (categorias.length === 0) return "ponto_a_validar";
  return categorias.reduce((pior, atual) =>
    ORDEM_CATEGORIA.indexOf(atual) > ORDEM_CATEGORIA.indexOf(pior) ? atual : pior,
  );
}

export function formatarBrl(valor: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 }).format(valor);
}

const ROTULO_TIPO_BEM: Record<PatrimonioItem["tipo"], string> = {
  imovel: "Imóvel",
  veiculo: "Veículo",
  investimento: "Investimento",
  previdencia: "Previdência",
  empresa: "Empresa",
  outro: "Outro",
};

const ROTULO_RECOMENDACAO: Record<string, string> = {
  "1_celula": "1 célula",
  "2_celulas": "2 células",
  "3_celulas": "3 células",
};

function bloco(
  chave: BlocoDiagnostico["chave"],
  titulo: string,
  conteudo: string,
  pontos: string[],
  fontes: string[],
  categoria: Categoria,
): BlocoDiagnostico {
  return { chave, titulo, conteudo, pontos, fontes, categoria, visivel_ao_cliente: false };
}

function semRegistro(chave: BlocoDiagnostico["chave"], titulo: string, oQue: string): BlocoDiagnostico {
  return bloco(chave, titulo, `Sem registro de ${oQue} nesta jornada.`, [], [], "ponto_a_validar");
}

export function montarDiagnostico(entrada: EntradaDiagnostico): BlocoDiagnostico[] {
  const faltas: string[] = [];
  const blocos: BlocoDiagnostico[] = [];

  // 1) situação familiar — fatos cadastrados (familiares ativos)
  const familiares = (entrada.familiares ?? []).filter((f) => f.ativo);
  if (familiares.length === 0) {
    blocos.push(semRegistro("situacao_familiar", "Situação familiar", "familiares"));
    faltas.push("Composição familiar não registrada (aba Família).");
  } else {
    const pontos = familiares.map((f) => {
      const partes = [f.parentesco, f.nome ?? null, f.idade != null ? `${f.idade} anos` : null, f.regime_casamento ?? null];
      return partes.filter((p): p is string => !!p).join(" · ");
    });
    const dependentes = familiares.filter((f) => f.dependente_financeiro).length;
    blocos.push(
      bloco(
        "situacao_familiar",
        "Situação familiar",
        `${familiares.length} familiar(es) registrado(s)${dependentes > 0 ? `, ${dependentes} dependente(s) financeiro(s)` : ""}.`,
        pontos,
        ["familiares"],
        "fato_declarado",
      ),
    );
  }

  // 2) mapa patrimonial — bens ativos; total só de quem tem valor_mercado
  const bens = (entrada.patrimonio ?? []).filter((b) => b.ativo);
  if (bens.length === 0) {
    blocos.push(semRegistro("mapa_patrimonial", "Mapa patrimonial", "bens"));
    faltas.push("Patrimônio não registrado (aba Patrimônio).");
  } else {
    const comValor = bens.filter((b) => b.valor_mercado != null);
    const semValor = bens.length - comValor.length;
    const pontos = bens.map((b) => {
      const valor = b.valor_mercado != null ? formatarBrl(b.valor_mercado) : "valor de mercado não informado";
      return `${ROTULO_TIPO_BEM[b.tipo]} · ${b.descricao} · ${valor}`;
    });
    if (comValor.length > 0) {
      const total = comValor.reduce((s, b) => s + (b.valor_mercado ?? 0), 0);
      pontos.push(
        `Total declarado (${comValor.length} de ${bens.length} bens com valor): ${formatarBrl(total)}`,
      );
    }
    if (semValor > 0) faltas.push(`${semValor} bem(ns) sem valor de mercado informado.`);
    blocos.push(
      bloco(
        "mapa_patrimonial",
        "Mapa patrimonial",
        `${bens.length} bem(ns) registrado(s)${semValor > 0 ? `; ${semValor} sem valor de mercado` : ""}.`,
        pontos,
        ["patrimonio_itens"],
        "fato_declarado",
      ),
    );
  }

  // 3) riscos — da análise do Agente do Croqui (v1 ou v2 têm `riscos`)
  const analise = entrada.analise;
  if (!analise || analise.conteudo.riscos.length === 0) {
    blocos.push(semRegistro("riscos_identificados", "Riscos identificados", "análise da sessão"));
    faltas.push(analise ? "A análise não apontou riscos." : "Análise da sessão (Agente do Croqui) ainda não gerada.");
  } else {
    const riscos = analise.conteudo.riscos;
    blocos.push(
      bloco(
        "riscos_identificados",
        "Riscos identificados",
        `${riscos.length} risco(s) apontado(s) na análise da sessão (v${analise.schema_versao}).`,
        riscos.map((r) => r.texto),
        [`croqui_analises:${analise.id}`],
        maisFraca(riscos.map((r) => r.categoria)),
      ),
    );
  }

  // 4) cenário patrimonial — só cenários sem rubrica ausente mostram total
  const totais = entrada.cenarios.totais;
  if (totais.length === 0) {
    blocos.push(semRegistro("cenario_patrimonial", "Cenário patrimonial", "cenário patrimonial"));
    faltas.push("Cenário patrimonial não iniciado (gaveta Cenário no Relatório).");
  } else {
    const pontos: string[] = [];
    const fontes = new Set<string>(["cenarios_patrimoniais"]);
    let algumCompleto = false;
    for (const t of totais) {
      const rotulo = ROTULO_CENARIO[t.cenario] ?? t.cenario;
      if (t.total == null) {
        // 0060: a view nomeia o que falta (padrão nunca gravada ∪ gravada como
        // `ausente`). Banco na 0057 (`rubricas_faltantes` undefined): cai nas
        // gravadas — e nesse caso `total` só é null com uma `ausente` gravada.
        const faltantes =
          t.rubricas_faltantes ??
          entrada.cenarios.rubricas
            .filter((r) => r.cenario_id === t.cenario_id && r.procedencia === "ausente")
            .map((r) => r.rubrica);
        const quantas = faltantes.length > 0 ? faltantes.length : t.rubricas_ausentes;
        pontos.push(`${rotulo}: faltam ${quantas} rubrica(s)`);
        faltas.push(`${rotulo}: rubrica(s) sem valor — ${faltantes.length > 0 ? faltantes.join(", ") : `${quantas}`}.`);
      } else {
        algumCompleto = true;
        pontos.push(`${rotulo}: ${formatarBrl(t.total)}`);
      }
    }
    const calculadas = entrada.cenarios.rubricas.filter((r) => r.procedencia === "calculado" && r.parametro_id);
    for (const r of calculadas) {
      const p = entrada.parametros[r.parametro_id as string];
      if (p) {
        fontes.add(`parametros_metodo:${p.chave}@v${p.versao}`);
        pontos.push(
          `${r.rubrica}: ${formatarBrl(r.valor ?? 0)} = base ${formatarBrl(r.base_calculo ?? 0)} × ${p.valor}% (${p.chave} v${p.versao}${p.uf ? ` · ${p.uf}` : ""})`,
        );
      }
    }
    blocos.push(
      bloco(
        "cenario_patrimonial",
        "Cenário patrimonial",
        algumCompleto
          ? "Comparativo de custo entre os cenários com todas as rubricas preenchidas pela advogada."
          : "Nenhum cenário está completo — os totais só aparecem quando nenhuma rubrica falta.",
        pontos,
        Array.from(fontes),
        algumCompleto ? "dado_documental" : "ponto_a_validar",
      ),
    );
  }

  // 5) arquitetura recomendada — análise `arquitetura`
  if (!analise) {
    blocos.push(semRegistro("arquitetura_recomendada", "Arquitetura recomendada", "análise da sessão"));
  } else {
    const arq = analise.conteudo.arquitetura;
    const rotulo = ROTULO_RECOMENDACAO[arq.recomendacao];
    const criterios = arq.criterios.map((c) => `${c.criterio}: ${c.resposta.texto} (${c.peso_na_decisao})`);
    if (!rotulo) {
      blocos.push(
        bloco(
          "arquitetura_recomendada",
          "Arquitetura recomendada",
          "A análise não fechou uma recomendação — ponto a validar com a advogada.",
          criterios,
          [`croqui_analises:${analise.id}`],
          "ponto_a_validar",
        ),
      );
      faltas.push("Arquitetura (1/2/3 células) ainda sem recomendação fechada.");
    } else {
      blocos.push(
        bloco(
          "arquitetura_recomendada",
          "Arquitetura recomendada",
          `Holding em ${rotulo}. ${arq.justificativa_geral}`.trim(),
          criterios,
          [`croqui_analises:${analise.id}`],
          maisFraca(arq.criterios.map((c) => c.resposta.categoria)),
        ),
      );
    }
  }

  // 6) próximos passos — do relatório da SV (o que a advogada registrou)
  const rel = entrada.relatorio;
  const passos: string[] = [];
  if (rel?.interesse_imediato) passos.push(`Interesse imediato: ${rel.interesse_imediato}`);
  if (rel?.como_deseja_organizar) passos.push(`Como deseja organizar: ${rel.como_deseja_organizar}`);
  if (rel?.consideracoes_apresentacao_croqui) passos.push(`Para o croqui: ${rel.consideracoes_apresentacao_croqui}`);
  if (rel?.resultado_sessao) passos.push(`Resultado da sessão: ${rel.resultado_sessao}`);
  if (passos.length === 0) {
    blocos.push(semRegistro("proximos_passos", "Próximos passos", "relatório da sessão"));
    faltas.push("Relatório da SV sem interesse imediato / próximos passos preenchidos.");
  } else {
    blocos.push(
      bloco("proximos_passos", "Próximos passos", "O que ficou combinado na Sessão de Viabilidade.", passos, ["relatorios_sessao"], "fato_declarado"),
    );
  }

  // 7) o que falta — SEMPRE interno
  blocos.push(
    bloco(
      "o_que_falta",
      "O que falta (interno)",
      faltas.length === 0 ? "Nenhuma lacuna detectada nos dados desta jornada." : `${faltas.length} lacuna(s) para fechar antes de apresentar.`,
      faltas,
      [],
      "inferencia",
    ),
  );

  return blocos;
}
