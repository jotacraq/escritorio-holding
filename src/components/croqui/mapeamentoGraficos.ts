import { CroquiAnaliseV2Schema, type CroquiAnaliseV2 } from "@/server/croqui/schema-analise-v2";
import { gerarSlidesDaAnalise } from "@/server/croqui/gerar-slides";
import type { CroquiConteudo } from "@/server/ia/schema-croqui-slides";
import type { Familiar, PatrimonioItem, Pessoa } from "@/lib/api";
import type { CriterioArquitetura } from "@/components/ficha360/api-analise";
import type { CriterioMatriz, ItemComposicaoPatrimonial, NivelAtendimento, NucleoFamiliar, PapelFamiliar, PessoaArvore } from "@/components/graficos";
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

function nivelDeResposta(criterio: CriterioArquitetura): NivelAtendimento {
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

export function mapearCriteriosParaMatriz(criterios: CriterioArquitetura[]): CriterioMatriz[] {
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
