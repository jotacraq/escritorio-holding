import { CroquiAnaliseV2Schema, type CroquiAnaliseV2 } from "@/server/croqui/schema-analise-v2";
import { gerarSlidesDaAnalise } from "@/server/croqui/gerar-slides";
import type { CroquiConteudo } from "@/server/ia/schema-croqui-slides";
import type { Familiar, PatrimonioItem, Pessoa } from "@/lib/api";
import type {
  CategoriaAfirmacaoGrafico,
  CelulaArquitetura,
  CelulaTipo,
  CriterioMatriz,
  ItemAlocado,
  ItemComposicaoPatrimonial,
  NivelAtendimento,
  NucleoFamiliar,
  PapelFamiliar,
  PessoaArvore,
  ResumoProcedencia,
} from "@/components/graficos";
import { ROTULO_CENARIO, type CenarioRubrica, type TipoCenario } from "@/types/cenario";
import type { DadosCenarioCroqui } from "./GraficoDoSlide";
import { rotularCriterio } from "./rotulos";

/**
 * Funções PURAS de mapeamento dado→gráfico (ARQUITETURA-FASE-3.md §3.4/§3.5:
 * "componentes de gráfico são puros… não importam `@/lib/api`, não fazem
 * fetch"). Este módulo é o único lugar, na fronteira do agente H, que
 * conhece a forma do `Croqui`/`Ficha360` E a forma dos gráficos — a ponte
 * entre os dois vive aqui, não dentro dos componentes de `src/components/
 * graficos/**` (intocados) nem espalhada em cada tela consumidora.
 *
 * `gerarSlidesDaAnalise` (`@/server/croqui/gerar-slides`) é reaproveitada
 * (não reimplementada — C16/§3.3) por importação direta: é função pura, zero
 * I/O, zero `server-only` no repo (confirmado por grep), então bundlar num
 * componente cliente é seguro e é exatamente o "ninguém duplica a ponte
 * análise→slides" que a arquitetura pede.
 */

// ---------------------------------------------------------------------------
// Versão da análise — detectada pela FORMA, não por um campo que a API não
// expõe (`croqui_analises.schema_versao`, 0043, não está no SELECT de
// `GET /api/croquis/[id]` hoje — pedido ao backend, ver relatório da onda).
// Enquanto o prompt v2 do `agente_croqui_analise` não existir, toda análise
// real falha o parse de `CroquiAnaliseV2Schema` e cai em v1 — o que é
// exatamente a realidade hoje (`gerar-slides.ts`, cabeçalho).
// ---------------------------------------------------------------------------
export function detectarVersaoAnalise(conteudo: unknown): 1 | 2 {
  return CroquiAnaliseV2Schema.safeParse(conteudo).success ? 2 : 1;
}

export function analiseComoV2SeForma(conteudo: unknown): CroquiAnaliseV2 | null {
  const resultado = CroquiAnaliseV2Schema.safeParse(conteudo);
  return resultado.success ? resultado.data : null;
}

/**
 * A ponte análise→13 slides, do jeito que a tela chama (ARQUITETURA-FASE-3.md
 * §3.3): detecta a versão pela forma e delega para a função canônica —
 * nunca reimplementa a lógica de mapeamento tipo↔slide.
 */
export function converterAnaliseEmSlides(conteudo: unknown, base?: CroquiConteudo): { versao: 1 | 2; conteudo: CroquiConteudo } {
  const versao = detectarVersaoAnalise(conteudo);
  return { versao, conteudo: gerarSlidesDaAnalise(conteudo, versao, base) };
}

// ---------------------------------------------------------------------------
// Família → ArvoreFamiliar (slide "familia", §3.4)
// ---------------------------------------------------------------------------

/**
 * `familiares.parentesco` é texto livre (sem enum no banco — confirmado em
 * `src/lib/api.ts`/`schema-croqui-slides.ts`). Normalização por substring é
 * uma heurística de EXIBIÇÃO, não uma reclassificação de dado: o texto
 * original continua intacto em qualquer tela que edite o familiar.
 */
export function normalizarPapelFamiliar(parentesco: string): PapelFamiliar {
  const p = parentesco.trim().toLowerCase();
  if (/(c[ôo]njuge|esposa|esposo|marido|companheir)/.test(p)) return "conjuge";
  if (/net[ao]/.test(p)) return "neto";
  if (/filh[ao]|entead[ao]/.test(p)) return "filho";
  return "outro";
}

/**
 * O modelo de dados não tem conceito de "núcleo familiar" (tabela
 * `familiares` é plana por pessoa — mesma limitação documentada em
 * `ArvoreFamiliar.tsx`). Um único núcleo agrupando todos os familiares
 * registrados é a representação honesta possível hoje: nenhuma divisão em
 * múltiplos núcleos é inventada sem o dado que a sustente.
 */
export function mapearFamiliaParaArvore(
  pessoa: Pick<Pessoa, "id" | "nome"> | null,
  familiares: Familiar[] | null,
): { instituidores: PessoaArvore[]; nucleos: NucleoFamiliar[] } {
  const instituidores: PessoaArvore[] = pessoa ? [{ id: pessoa.id, nome: pessoa.nome, papel: "instituidor" }] : [];

  const pessoasNucleo: PessoaArvore[] = (familiares ?? []).map((f) => ({
    id: f.id,
    nome: f.nome ?? f.parentesco,
    papel: normalizarPapelFamiliar(f.parentesco),
    idade: f.idade,
    regimeCasamento: f.regime_casamento,
    dependenteFinanceiro: f.dependente_financeiro,
  }));

  const nucleos: NucleoFamiliar[] = pessoasNucleo.length > 0 ? [{ id: "nucleo-1", rotulo: "Núcleo familiar", pessoas: pessoasNucleo }] : [];

  return { instituidores, nucleos };
}

// ---------------------------------------------------------------------------
// Patrimônio → BarrasComposicao (slides "patrimonio" e "risco", §3.4)
// ---------------------------------------------------------------------------

export function mapearPatrimonioParaComposicao(itens: PatrimonioItem[] | null): ItemComposicaoPatrimonial[] {
  // `PatrimonioItem['tipo']` e `TipoBemGrafico` são o mesmo conjunto de 6
  // valores (só a ordem do array difere) — atribuição direta, sem tradução.
  return (itens ?? []).map((item) => ({
    tipo: item.tipo,
    valor_mercado: item.valor_mercado,
    valor_historico: item.valor_historico,
  }));
}

/** Concentração = maior bem ÷ total, só para o slide "risco" (§3.4 — mesma
 * fonte de dado do slide "patrimonio", olhada por outro ângulo: nenhum
 * cálculo de imposto, só soma e razão). `null` quando não há valor nenhum —
 * nunca 0%, que seria uma afirmação, não a ausência de dado. */
export function calcularConcentracaoPatrimonial(itens: PatrimonioItem[] | null): { fracao: number; totalContabilizado: number } | null {
  const valores = (itens ?? [])
    .map((i) => i.valor_mercado ?? i.valor_historico)
    .filter((v): v is number => v != null && v > 0);
  if (valores.length === 0) return null;
  const total = valores.reduce((a, b) => a + b, 0);
  const maior = Math.max(...valores);
  return { fracao: maior / total, totalContabilizado: total };
}

// ---------------------------------------------------------------------------
// Critérios de arquitetura → MatrizCriterios (slide "alternativas", §3.4)
// Já existe no schema v1 (`analise.arquitetura.criterios`, `.length(9)`).
// ---------------------------------------------------------------------------

function nivelDeResposta(criterio: unknown): NivelAtendimento {
  // O schema não carimba "atende/não atende" por célula — carimba uma
  // afirmação livre por critério (`resposta.texto`) e a recomendação GERAL
  // (1/2/3 células) fica em `arquitetura.recomendacao`, fora do array. Não
  // inventamos avaliação por célula que a IA não produziu: a matriz mostra a
  // MESMA resposta nas 3 colunas, com destaque na coluna recomendada — é
  // honesto com o que o dado tem, e ainda assim prova o método (nenhuma
  // holding escolhida antes de revisar os 9 critérios).
  void criterio;
  return "nao_se_aplica";
}

/**
 * Aceita a forma ENXUTA (`criterio` + texto da resposta) porque é só o que
 * esta função lê — `categoria` e `peso_na_decisao` nunca foram usados aqui. O
 * Modo Apresentação manda exatamente essa forma, para não colocar leitura
 * interna do método no navegador que está na frente da família.
 */
export function mapearCriteriosParaMatriz(
  criterios: Array<{ criterio: string; resposta: { texto: string } }>,
): CriterioMatriz[] {
  return criterios.map((c) => {
    const nivel = nivelDeResposta(c);
    const resposta = { nivel, nota: c.resposta.texto };
    return {
      id: c.criterio,
      criterio: rotularCriterio(c.criterio),
      celula1: resposta,
      celula2: resposta,
      celula3: resposta,
    };
  });
}

export function mapearRecomendacaoParaColuna(recomendacao: string): 1 | 2 | 3 | undefined {
  if (recomendacao === "1_celula") return 1;
  if (recomendacao === "2_celulas") return 2;
  if (recomendacao === "3_celulas") return 3;
  return undefined;
}

// ---------------------------------------------------------------------------
// Alocação v2 → DiagramaCelulas (slides 7-10, Fase 4 §4.5)
// ---------------------------------------------------------------------------

const ORDEM_CELULAS: CelulaTipo[] = ["cofre", "veiculo", "destino", "unica"];

function ehCelula(valor: string): valor is CelulaTipo {
  return (ORDEM_CELULAS as string[]).includes(valor);
}

/**
 * Agrupa `arquitetura.alocacao` (v2) por célula, na ordem do método
 * (Cofre → Veículo → Destino). Regras:
 * - recomendação `1_celula`: tudo numa caixa só ("Estrutura única") — juntar
 *   não inventa: 1 célula É tudo junto;
 * - 2 ou 3 células: só as células que a análise de fato usou (nenhuma caixa
 *   vazia inventada; se a IA usou 3 células com recomendação de 2, mostra as
 *   3 — o dado manda, não a etiqueta);
 * - item com célula desconhecida é ignorado (nunca "chutado" para uma caixa);
 * - `instituidor` (slide Controle) destaca o nome na célula Veículo — ou na
 *   única, quando é 1 célula.
 * Sem alocação → `[]`, e `DiagramaCelulas` mostra o estado honesto.
 */
export function mapearAlocacaoParaCelulas(
  alocacao: Array<{ celula: string; item: string; categoria?: CategoriaAfirmacaoGrafico }> | null,
  recomendacao: string | null,
  instituidor: string | null = null,
): CelulaArquitetura[] {
  if (!alocacao || alocacao.length === 0) return [];
  const validos = alocacao.filter((a) => ehCelula(a.celula) && a.item.trim().length > 0);
  if (validos.length === 0) return [];

  const paraItem = (a: (typeof validos)[number]): ItemAlocado => ({ descricao: a.item, categoria: a.categoria });

  if (recomendacao === "1_celula") {
    return [{ tipo: "unica", itens: validos.map(paraItem), destaqueInstituidor: instituidor }];
  }

  const porCelula = new Map<CelulaTipo, ItemAlocado[]>();
  for (const a of validos) {
    const celula = a.celula as CelulaTipo;
    if (!porCelula.has(celula)) porCelula.set(celula, []);
    porCelula.get(celula)!.push(paraItem(a));
  }
  return ORDEM_CELULAS.filter((c) => porCelula.has(c)).map((tipo) => ({
    tipo,
    itens: porCelula.get(tipo)!,
    destaqueInstituidor: instituidor && (tipo === "veiculo" || (tipo === "unica" && porCelula.size === 1)) ? instituidor : null,
  }));
}

// ---------------------------------------------------------------------------
// Cenário Patrimonial → BarrasComparativas (slide "economia", Fase 4 §4.5)
// ---------------------------------------------------------------------------

const CENARIO_DA_RECOMENDACAO: Record<string, TipoCenario> = {
  "1_celula": "holding_1_celula",
  "2_celulas": "holding_2_celulas",
  "3_celulas": "holding_3_celulas",
};

/** Rótulo humano das rubricas padrão (`configuracoes['cenario.rubricas']`);
 * chave desconhecida só troca `_` por espaço — nunca inventa nome. */
const ROTULO_RUBRICA: Record<string, string> = {
  itcmd: "ITCMD",
  itbi: "ITBI",
  custas_cartorio: "custas de cartório",
  honorarios_advocaticios: "honorários advocatícios",
  honorarios_croqui: "honorários do croqui",
  honorarios_holding: "honorários da holding",
  manutencao_anual: "manutenção anual",
};

function rotularRubrica(chave: string): string {
  return ROTULO_RUBRICA[chave] ?? chave.replace(/_/g, " ");
}

export interface EconomiaSlide {
  custoInventario: number | null;
  custoEstrutura: number | null;
  cenarioEstrutura: TipoCenario | null;
  rotuloEstrutura: string;
  rubricasAusentes: { inventario: number | null; estrutura: number | null };
  procedencia: { inventario: ResumoProcedencia | null; estrutura: ResumoProcedencia | null };
  /** "Fonte: valores digitados pela advogada em DD/MM · ITCMD calculado com alíquota 4% (parâmetro v2)". `null` sem dado. */
  carimbo: string | null;
}

function resumirProcedencia(rubricas: CenarioRubrica[]): ResumoProcedencia | null {
  if (rubricas.length === 0) return null;
  const resumo: ResumoProcedencia = { digitado: 0, calculado: 0, ausente: 0, total: rubricas.length };
  for (const r of rubricas) resumo[r.procedencia] += 1;
  return resumo;
}

function formatarDiaMes(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }).format(data);
}

/**
 * Lê os dois totais que o slide compara: `inventario` (custo de NÃO agir) e a
 * holding recomendada (custo da estrutura). O único "cálculo" aqui é escolher
 * linhas e contar procedências — nenhum imposto, nenhuma alíquota (B26: quem
 * calcula é o trigger do banco, com base + alíquota que a advogada digitou).
 * Total `null` fica `null`; a tela diz quantas rubricas faltam.
 */
export function mapearCenarioParaEconomia(cenario: DadosCenarioCroqui | null, recomendacao: string | null): EconomiaSlide {
  const cenarioEstrutura = recomendacao ? (CENARIO_DA_RECOMENDACAO[recomendacao] ?? null) : null;
  const rotuloEstrutura = cenarioEstrutura ? `Custo da estrutura · ${ROTULO_CENARIO[cenarioEstrutura]}` : "Custo da estrutura recomendada";

  if (!cenario) {
    return {
      custoInventario: null,
      custoEstrutura: null,
      cenarioEstrutura,
      rotuloEstrutura,
      rubricasAusentes: { inventario: null, estrutura: null },
      procedencia: { inventario: null, estrutura: null },
      carimbo: null,
    };
  }

  const totalDe = (tipo: TipoCenario | null) => (tipo ? (cenario.totais.find((t) => t.cenario === tipo) ?? null) : null);
  const idDe = (tipo: TipoCenario | null) => (tipo ? (cenario.cenarios.find((c) => c.cenario === tipo)?.id ?? null) : null);
  const rubricasDe = (tipo: TipoCenario | null) => {
    const id = idDe(tipo);
    return id ? cenario.rubricas.filter((r) => r.cenario_id === id) : [];
  };

  const linhaInventario = totalDe("inventario");
  const linhaEstrutura = totalDe(cenarioEstrutura);
  const rubricasInventario = rubricasDe("inventario");
  const rubricasEstrutura = rubricasDe(cenarioEstrutura);

  // Carimbo de proveniência: última digitação + cada rubrica calculada com a
  // versão do parâmetro que multiplicou — o "quem digitou e quando" da regra.
  const todas = [...rubricasInventario, ...rubricasEstrutura];
  const partes: string[] = [];
  const digitadas = todas.filter((r) => r.procedencia === "digitado");
  if (digitadas.length > 0) {
    const ultima = digitadas.map((r) => r.atualizado_em).sort().at(-1);
    partes.push(`valores digitados pela advogada${ultima ? ` em ${formatarDiaMes(ultima)}` : ""}`);
  }
  const calculadas = todas.filter((r) => r.procedencia === "calculado");
  const vistas = new Set<string>();
  for (const r of calculadas) {
    const chave = `${r.rubrica}:${r.parametro_id ?? ""}`;
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    const parametro = r.parametro_id ? cenario.parametros?.[r.parametro_id] : undefined;
    const aliquota = r.aliquota != null ? `${String(r.aliquota).replace(".", ",")}%` : null;
    partes.push(
      `${rotularRubrica(r.rubrica)} calculado${aliquota ? ` com alíquota ${aliquota}` : ""}${parametro ? ` (parâmetro v${parametro.versao}${parametro.uf ? ` · ${parametro.uf}` : ""})` : ""}`,
    );
  }

  return {
    custoInventario: linhaInventario?.total ?? null,
    custoEstrutura: linhaEstrutura?.total ?? null,
    cenarioEstrutura,
    rotuloEstrutura,
    rubricasAusentes: {
      inventario: linhaInventario ? linhaInventario.rubricas_ausentes : null,
      estrutura: linhaEstrutura ? linhaEstrutura.rubricas_ausentes : null,
    },
    procedencia: { inventario: resumirProcedencia(rubricasInventario), estrutura: resumirProcedencia(rubricasEstrutura) },
    carimbo: partes.length > 0 ? `Fonte: ${partes.join(" · ")}` : null,
  };
}
