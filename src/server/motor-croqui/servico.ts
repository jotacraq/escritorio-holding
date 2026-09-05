import type { SupabaseClient } from "@supabase/supabase-js";
import type { Familiar, PatrimonioItem } from "@/types/banco";
import type {
  ClasseBem,
  CroquiCalculo,
  CroquiCalculoResumo,
  DivergenciaParametro,
  EntradaCroqui,
  FaltaParametro,
  HorasPorAto,
  ModeloHolding,
  OverrideCelula,
  ParametroCroqui,
  ParametrosCroqui,
  RespostaCroquiCalculo,
  ResultadoCroqui,
  TabelaFaixas,
} from "@/types/croqui-calculo";
import { MODELOS_CROQUI } from "@/types/croqui-calculo";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { ErroApi, erroConflito, erroNaoEncontrado, registrarErro } from "@/server/erros";
import { calcularCroqui } from "./calcular";
import { CATALOGO_PARAMETROS, chavesNecessarias, jurisdicaoDe, type ChaveParametroCroqui } from "./catalogo";
import { chaveMapa } from "./contexto";
import { MODELO_REFERENCIA_PADRAO } from "./dominio";

/**
 * Ponte entre o motor PURO e o banco. Só isto aqui fala com o Supabase — o
 * `index.ts` do motor continua importável no cliente (simulador ao vivo).
 *
 * Regra que sustenta a segurança do simulador: o servidor **monta a entrada e
 * carrega os parâmetros por conta própria** e recalcula. Nada do que o
 * navegador manda vira número gravado.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cliente vem sem generic Database
type Cliente = SupabaseClient<any, any, any>;

const CLASSES: ClasseBem[] = ["imovel", "veiculo", "investimento", "previdencia", "empresa", "outro"];

const classeDe = (tipo: string): ClasseBem =>
  (CLASSES as string[]).includes(tipo) ? (tipo as ClasseBem) : "outro";

type Destinacao = "uso" | "locacao" | "venda" | "operacional";

function destinacaoDe(valor: string | null): Destinacao | null {
  if (!valor) return null;
  const normalizado = valor
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  if (normalizado.includes("loca")) return "locacao";
  if (normalizado.includes("venda")) return "venda";
  if (normalizado.includes("empresa") || normalizado.includes("operacional")) return "operacional";
  if (normalizado.includes("resid") || normalizado.includes("uso")) return "uso";
  return null;
}

const numero = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};

/** Faturamento e custo da operação vivem em `patrimonio_itens.detalhes` (0007). */
function operacionalDe(itens: PatrimonioItem[]): EntradaCroqui["operacional"] {
  const empresas = itens.filter((i) => i.tipo === "empresa");
  if (empresas.length === 0) return null;
  let faturamento: number | null = null;
  let custo: number | null = null;
  for (const e of empresas) {
    const d = e.detalhes ?? {};
    const f = numero(d.faturamento_mensal) ?? numero(d.faturamento);
    const c = numero(d.custo_operacional_mensal) ?? numero(d.custo_operacional);
    if (f !== null) faturamento = (faturamento ?? 0) + f;
    if (c !== null) custo = (custo ?? 0) + c;
  }
  // Empresa sem faturamento declarado: a tabela existe e a célula fica ausente
  // com o motivo — não some, e não vira zero.
  return { faturamento_mensal: faturamento, custo_operacional_mensal: custo };
}

function familiaDe(familiares: Familiar[]): EntradaCroqui["familia"] {
  const conta = (p: string) =>
    familiares.filter((f) => (f.parentesco ?? "").toLowerCase().startsWith(p)).length;
  const conjuge = familiares.find((f) => (f.parentesco ?? "").toLowerCase().startsWith("conjuge") || (f.parentesco ?? "").toLowerCase().startsWith("cônjuge"));
  const filhos = conta("filho");
  const netos = conta("neto");
  return {
    regime_bens: conjuge?.regime_casamento ?? familiares.find((f) => f.regime_casamento)?.regime_casamento ?? null,
    tem_conjuge: Boolean(conjuge),
    filhos: familiares.length > 0 ? filhos : null,
    netos: familiares.length > 0 ? netos : null,
    nucleos: filhos > 0 ? filhos : null,
  };
}

/**
 * As CINCO configurações que o croqui inteiro consome, numa consulta só.
 *
 * Antes eram cinco `maybeSingle()` de uma linha cada, três delas disparadas
 * DEPOIS do `Promise.all` da ficha sem depender dele — cinco viagens
 * Hostinger → sa-east-1 no primeiro paint das três telas do croqui.
 */
export const CHAVES_CONFIGURACAO_CROQUI = [
  "croqui.uf_domicilio_vantajoso",
  "croqui.mapa_rubricas",
  "croqui.horas_por_ato",
  "croqui.sinal_modelo_referencia",
  "parametros.divergencias",
] as const;

export type ConfiguracoesCroqui = Record<string, unknown>;

export async function lerConfiguracoesCroqui(supabase: Cliente): Promise<ConfiguracoesCroqui> {
  const { data, error } = await supabase
    .from("configuracoes")
    .select("chave, valor")
    .in("chave", [...CHAVES_CONFIGURACAO_CROQUI]);
  if (error) {
    // Configuração ilegível não pode derrubar o croqui: cada consumidor cai no
    // próprio padrão, e o que depende de cadastro vira célula ausente com motivo.
    registrarErro("server/motor-croqui.lerConfiguracoesCroqui", error, {});
    return {};
  }
  const mapa: ConfiguracoesCroqui = {};
  for (const linha of ((data as Array<{ chave: string; valor: unknown }> | null) ?? [])) {
    mapa[linha.chave] = linha.valor;
  }
  return mapa;
}

function config<T>(configuracoes: ConfiguracoesCroqui, chave: string, padrao: T): T {
  const valor = configuracoes[chave];
  return (valor ?? padrao) as T;
}

/**
 * A ficha inteira do croqui numa consulta só: `jornadas` + `pessoas` + os
 * `patrimonio_itens` e `familiares` daquela pessoa, por embedding do PostgREST.
 * Eram quatro viagens (uma para a jornada, três em `Promise.all` que só podiam
 * partir depois dela).
 *
 * `pessoas(...)` é embed TOLERANTE (sem `!inner`) de propósito: pessoa
 * ilegível vira UF/município nulos e célula ausente com motivo, nunca 404 —
 * o mesmo comportamento de antes.
 */
export interface FichaDoCroqui {
  pessoa_id: string;
  uf: string | null;
  cidade: string | null;
  itens: PatrimonioItem[];
  familiares: Familiar[];
}

interface PessoaEmbutida {
  uf: string | null;
  cidade: string | null;
  patrimonio_itens: PatrimonioItem[] | null;
  familiares: Familiar[] | null;
}

const porCriadoEm = <T extends { criado_em?: string | null }>(a: T, b: T): number =>
  (a.criado_em ?? "").localeCompare(b.criado_em ?? "");

export async function lerFichaDoCroqui(supabase: Cliente, jornadaId: string): Promise<FichaDoCroqui> {
  const { data, error } = await supabase
    .from("jornadas")
    .select("id, pessoa_id, pessoas(uf, cidade, patrimonio_itens(*), familiares(*))")
    .eq("id", jornadaId)
    .maybeSingle();
  if (error) {
    registrarErro("server/motor-croqui.lerFichaDoCroqui", error, { jornada_id: jornadaId });
    throw error;
  }
  const linha = data as { id: string; pessoa_id: string; pessoas: PessoaEmbutida | null } | null;
  if (!linha) throw erroNaoEncontrado("Jornada não encontrada.");

  const pessoa = linha.pessoas ?? { uf: null, cidade: null, patrimonio_itens: [], familiares: [] };

  // `ativo` é filtrado AQUI, e não no PostgREST, porque filtro em recurso
  // embutido de 2 níveis é sintaxe frágil e falhar nela devolveria a lista
  // inteira em silêncio. São dezenas de linhas: o corte em memória é barato e
  // é o mesmo corte que o radar e a aba de Patrimônio já fazem.
  const itens = (pessoa.patrimonio_itens ?? []).filter((i) => i.ativo !== false).sort(porCriadoEm);
  const familiares = (pessoa.familiares ?? []).filter((f) => f.ativo !== false).sort(porCriadoEm);

  return { pessoa_id: linha.pessoa_id, uf: pessoa.uf, cidade: pessoa.cidade, itens, familiares };
}

/**
 * Monta a `EntradaCroqui` da jornada a partir do que já existe na Ficha:
 * `patrimonio_itens`, `familiares` e `pessoas.uf`. Nenhum dado novo é pedido ao
 * usuário para o croqui existir — o que faltar aparece como célula ausente.
 *
 * **TODO bem ativo da pessoa entra**, com classe, DIRPF, mercado, destinação e
 * locação — nenhum filtro de classe, nenhum corte por valor. A tabela T2 é a
 * lista completa do patrimônio; um bem que some daqui some do croqui inteiro
 * (T3, T6, T7–T9 e o comparativo saem menores sem dizer por quê).
 */
export function montarEntrada(
  jornadaId: string,
  ficha: FichaDoCroqui,
  configuracoes: ConfiguracoesCroqui,
  overrides: OverrideCelula[],
): EntradaCroqui {
  const ufVantajosa = config<string | null>(configuracoes, "croqui.uf_domicilio_vantajoso", null);

  return {
    jornada_id: jornadaId,
    uf: ficha.uf ? ficha.uf.toUpperCase() : null,
    municipio: ficha.cidade,
    uf_domicilio_vantajoso: typeof ufVantajosa === "string" ? ufVantajosa.toUpperCase() : null,
    familia: familiaDe(ficha.familiares),
    bens: ficha.itens.map((i) => ({
      id: i.id,
      classe: classeDe(i.tipo),
      descricao: i.descricao,
      valor_dirpf: numero(i.valor_historico),
      valor_mercado: numero(i.valor_mercado),
      destinacao: destinacaoDe(i.destinacao),
      valor_locacao_mensal: numero(i.valor_locacao_mensal),
      ano_aquisicao: i.ano_aquisicao,
      vender_para_levantar: i.detalhes?.vender_para_levantar === true,
    })),
    operacional: operacionalDe(ficha.itens),
    modelos: [...MODELOS_CROQUI],
    overrides,
  };
}

/** Conveniência para quem só quer a entrada (fora do caminho quente). */
export async function montarEntradaCroqui(supabase: Cliente, jornadaId: string): Promise<EntradaCroqui> {
  const [ficha, configuracoes] = await Promise.all([
    lerFichaDoCroqui(supabase, jornadaId),
    lerConfiguracoesCroqui(supabase),
  ]);
  return montarEntrada(jornadaId, ficha, configuracoes, await lerOverrides(supabase, jornadaId, configuracoes));
}

/**
 * Overrides da gaveta do Cenário Patrimonial (0057). Uma rubrica só vira
 * override quando o mapa `configuracoes['croqui.mapa_rubricas']` diz em qual
 * célula ela entra — rubrica livre continua existindo como "ajuste fora do
 * modelo", sem contaminar o cálculo.
 *
 * **A chave do mapa é `"<cenario>.<rubrica>"`, não `"<rubrica>"`.** A mesma
 * jornada tem um cenário de doação e um de inventário, e os dois têm uma
 * rubrica `itcmd`: casar só pelo nome fazia o ITCMD do cenário de doação
 * sobrescrever a célula do inventário (ou o contrário, conforme a ordem que o
 * banco devolvesse) — em silêncio, sem nenhum sinal na tela. É o BLOQUEIO que o
 * M4 registrou na 0066 e o motivo de `croqui.mapa_rubricas` ter nascido `{}`.
 *
 * `cenarios_patrimoniais.cenario` usa o vocabulário da 0057
 * (`inventario` · `doacao` · `holding_1_celula` · `holding_2_celulas` ·
 * `holding_3_celulas`) — é ele que vai na chave, sem tradução.
 */
export interface DestinoRubrica {
  tabela: string;
  linha: string;
  coluna: string;
}

export function chaveRubrica(cenario: string, rubrica: string): string {
  return `${cenario}.${rubrica}`;
}

async function lerOverrides(
  supabase: Cliente,
  jornadaId: string,
  configuracoes: ConfiguracoesCroqui,
): Promise<OverrideCelula[]> {
  const mapa = config<Record<string, DestinoRubrica>>(configuracoes, "croqui.mapa_rubricas", {});
  if (!mapa || typeof mapa !== "object" || Object.keys(mapa).length === 0) return [];

  const { data, error } = await supabase
    .from("cenario_rubricas")
    .select("id, rubrica, valor, procedencia, cenarios_patrimoniais!inner(jornada_id, cenario)")
    .eq("procedencia", "digitado")
    .eq("cenarios_patrimoniais.jornada_id", jornadaId);
  if (error) {
    registrarErro("server/motor-croqui.lerOverrides", error, { jornada_id: jornadaId });
    return [];
  }

  type LinhaRubrica = {
    id: string;
    rubrica: string;
    valor: number | null;
    cenarios_patrimoniais: { jornada_id: string; cenario: string } | Array<{ jornada_id: string; cenario: string }> | null;
  };
  const linhas = (data as LinhaRubrica[] | null) ?? [];

  return linhas.flatMap((r) => {
    // PostgREST devolve objeto no embed to-one e array quando a relação é
    // inferida como to-many; aceitar os dois evita override sumir em silêncio.
    const cenarioLinha = Array.isArray(r.cenarios_patrimoniais) ? r.cenarios_patrimoniais[0] : r.cenarios_patrimoniais;
    const cenario = cenarioLinha?.cenario;
    if (!cenario || r.valor === null) return [];
    const destino = mapa[chaveRubrica(cenario, r.rubrica)];
    if (!destino) return [];
    return [{ ...destino, valor: r.valor, rubrica_id: r.id }];
  });
}

// ---------------------------------------------------------------------------
// Parâmetros
// ---------------------------------------------------------------------------

interface LinhaParametro {
  id: string;
  chave: string;
  versao: number;
  valor: number | string | null;
  faixas: TabelaFaixas | null;
  unidade: string;
  uf: string | null;
  municipio: string | null;
  base_legal: string | null;
}

/**
 * Carrega SÓ as chaves que esta entrada exige, cada uma na sua jurisdição —
 * um cliente de 1 célula em SP sem locação não puxa as 41 do catálogo.
 * Uma consulta só: `in (chaves)` + filtro de jurisdição em memória.
 */
export async function carregarParametros(
  supabase: Cliente,
  entrada: EntradaCroqui,
  configuracoes: ConfiguracoesCroqui,
): Promise<ParametrosCroqui> {
  const necessarias = chavesNecessarias(entrada);
  const jurisdicoes = necessarias.map((c) => jurisdicaoDe(entrada, c));

  const itens: Record<string, ParametroCroqui> = {};
  if (necessarias.length > 0) {
    const { data, error } = await supabase
      .from("parametros_metodo")
      .select("id, chave, versao, valor, faixas, unidade, uf, municipio, base_legal")
      .in("chave", necessarias)
      .eq("ativo", true);
    if (error) {
      registrarErro("server/motor-croqui.carregarParametros", error, { jornada_id: entrada.jornada_id });
      throw error;
    }
    for (const linha of ((data as LinhaParametro[] | null) ?? [])) {
      const chave = chaveMapa(linha.chave, linha.uf, linha.municipio);
      itens[chave] = {
        id: linha.id,
        chave: linha.chave,
        versao: linha.versao,
        unidade: linha.unidade as ParametroCroqui["unidade"],
        valor: numero(linha.valor),
        faixas: linha.faixas ?? null,
        uf: linha.uf,
        municipio: linha.municipio,
        base_legal: linha.base_legal,
      };
    }
  }

  // Já vieram na leitura única de `configuracoes` — três `maybeSingle()` de uma
  // linha cada que rodavam DEPOIS do resto, sem depender dele.
  const horas = config<HorasPorAto[]>(configuracoes, "croqui.horas_por_ato", []);
  const referencia = config<string>(configuracoes, "croqui.sinal_modelo_referencia", MODELO_REFERENCIA_PADRAO);
  const divergencias = config<DivergenciaParametro[]>(configuracoes, "parametros.divergencias", []);

  const referenciaValida: ModeloHolding =
    referencia === "celula_1" || referencia === "celula_2" || referencia === "celula_3"
      ? referencia
      : MODELO_REFERENCIA_PADRAO;

  return {
    itens,
    horas_por_ato: Array.isArray(horas) ? horas : [],
    sinal_modelo_referencia: referenciaValida,
    divergencias: (Array.isArray(divergencias) ? divergencias : []).filter((d) =>
      // só as divergências que ESTE cliente encosta
      jurisdicoes.some((j) => j.chave === d.chave),
    ),
  };
}

/** Chaves que este cliente exige e que não têm versão ativa na jurisdição dele. */
export function parametrosAusentes(entrada: EntradaCroqui, parametros: ParametrosCroqui): FaltaParametro[] {
  return chavesNecessarias(entrada)
    .map((chave) => jurisdicaoDe(entrada, chave))
    .filter((j) => !parametros.itens[chaveMapa(j.chave, j.uf ?? null, j.municipio ?? null)]);
}

// ---------------------------------------------------------------------------
// Cálculo e persistência
// ---------------------------------------------------------------------------

export interface CalculoDaJornada {
  entrada: EntradaCroqui;
  parametros: ParametrosCroqui;
  resultado: ResultadoCroqui;
  ausentes: FaltaParametro[];
}

/**
 * Monta a entrada, carrega os parâmetros vigentes e calcula. Sem gravar.
 *
 * **Duas ondas de banco, três consultas** (era onze, em cinco ondas):
 *   onda 1 — a ficha inteira (`jornadas`+`pessoas`+`patrimonio_itens`+`familiares`)
 *            em paralelo com as 5 `configuracoes`;
 *   onda 1b — `cenario_rubricas`, **só** quando `croqui.mapa_rubricas` existe
 *            (hoje `{}` ⇒ zero consulta);
 *   onda 2 — `parametros_metodo` das chaves que ESTA entrada exige (depende da
 *            entrada: é a jurisdição do cliente que decide quais chaves entram).
 */
export async function calcularParaJornada(supabase: Cliente, jornadaId: string): Promise<CalculoDaJornada> {
  const [ficha, configuracoes] = await Promise.all([
    lerFichaDoCroqui(supabase, jornadaId),
    lerConfiguracoesCroqui(supabase),
  ]);
  const overrides = await lerOverrides(supabase, jornadaId, configuracoes);
  const entrada = montarEntrada(jornadaId, ficha, configuracoes, overrides);
  const parametros = await carregarParametros(supabase, entrada, configuracoes);
  return {
    entrada,
    parametros,
    resultado: calcularCroqui(entrada, parametros),
    ausentes: parametrosAusentes(entrada, parametros),
  };
}

const RESUMO =
  "id, jornada_id, croqui_id, versao, motor_versao, atual, nota, criado_em, criado_por";

export async function listarCroquiCalculo(supabase: Cliente, jornadaId: string): Promise<RespostaCroquiCalculo> {
  const [atualRes, historicoRes, calculo] = await Promise.all([
    supabase.from("croqui_calculos").select("*").eq("jornada_id", jornadaId).eq("atual", true).maybeSingle(),
    supabase.from("croqui_calculos").select(RESUMO).eq("jornada_id", jornadaId).order("versao", { ascending: false }),
    calcularParaJornada(supabase, jornadaId),
  ]);
  if (atualRes.error) throw atualRes.error;
  if (historicoRes.error) throw historicoRes.error;

  return {
    atual: (atualRes.data as CroquiCalculo | null) ?? null,
    historico: (historicoRes.data as CroquiCalculoResumo[] | null) ?? [],
    entrada: calculo.entrada,
    parametros: calculo.parametros,
    ausentes: calculo.ausentes,
    divergencias: calculo.parametros.divergencias,
  };
}

/**
 * Grava uma versão nova. O resultado é SEMPRE recalculado aqui — o corpo da
 * requisição não tem como injetar número. Se faltar parâmetro que trava uma
 * tabela, o 409 nomeia as chaves e onde cadastrar.
 *
 * ## Por que a gravação usa `service_role` (0069 — MÉDIO do pentest da Fase 5)
 *
 * "O resultado nunca vem do cliente" era verdade nesta função e MENTIRA no
 * banco: `registrar_croqui_calculo` tinha EXECUTE para `authenticated`, então
 * qualquer sessão admin/advogada chamava a RPC direto em
 * `POST /rest/v1/rpc/registrar_croqui_calculo` com `p_resultado` forjado — e o
 * `.docx`, a apresentação e o `/p/m` passavam a servir aquilo como cálculo
 * reproduzível. A 0069 tirou o EXECUTE de `authenticated`.
 *
 * Consequência para este arquivo, na ordem:
 *  1. a LEITURA (`calcularParaJornada`) continua com o cliente da SESSÃO — é o
 *     que garante que quem pede realmente enxerga aquele patrimônio pela RLS,
 *     e não só passou pelo gate de rota;
 *  2. a ESCRITA vai por `criarClienteAdmin()`, porque agora só `service_role`
 *     executa a RPC;
 *  3. sob `service_role` não há `auth.uid()`, então o AUTOR do snapshot deixa de
 *     ser inferido e passa a ser declarado: `criadoPor` é o `perfis_equipe.id`
 *     que `exigirVePatrimonio()` devolveu na rota, e a própria RPC revalida que
 *     ele é admin/advogada ATIVO antes de gravar;
 *  4. sem `SUPABASE_SERVICE_ROLE_KEY` a resposta é **503 rotulado** — mesmo
 *     padrão de `POST /api/jornadas/[id]/radar/pedir`. Nunca 500 genérico, e
 *     nunca fingir que gravou.
 */
export async function registrarCalculo(
  supabase: Cliente,
  jornadaId: string,
  opcoes: { croqui_id?: string | null; nota?: string | null; criadoPor: string },
): Promise<CroquiCalculo> {
  // Fail-closed ANTES de qualquer trabalho — não só antes de gravar. É o mesmo
  // princípio de `server/radar/pedir.ts` levado um passo adiante: montar a
  // entrada e recarregar os parâmetros são ~8 consultas de patrimônio; gastá-las
  // para descobrir no fim que não há como gravar é custo puro, e um 409
  // `parametro_ausente` respondido por uma instalação que não conseguiria gravar
  // de todo jeito manda o usuário cadastrar parâmetro para nada.
  let admin;
  try {
    admin = criarClienteAdmin();
  } catch (erroServiceRole) {
    registrarErro("server/motor-croqui.registrarCalculo#service_role_ausente", erroServiceRole, {
      jornada_id: jornadaId,
    });
    throw new ErroApi(
      503,
      "servico_indisponivel",
      "Gravar o cálculo do croqui exige SUPABASE_SERVICE_ROLE_KEY — indisponível agora.",
    );
  }

  const { entrada, parametros, resultado, ausentes } = await calcularParaJornada(supabase, jornadaId);

  if (ausentes.length > 0) {
    throw erroConflito(
      "parametro_ausente",
      `Faltam ${ausentes.length} parâmetro(s) para fechar este croqui. Cadastre em Admin → Parâmetros.`,
      {
        chaves: ausentes.map((a) => ({
          chave: a.chave,
          rotulo: CATALOGO_PARAMETROS[a.chave as ChaveParametroCroqui]?.rotulo ?? a.chave,
          uf: a.uf ?? null,
          municipio: a.municipio ?? null,
        })),
      },
    );
  }

  const { data, error } = await admin.rpc("registrar_croqui_calculo", {
    p_jornada_id: jornadaId,
    p_croqui_id: opcoes.croqui_id ?? null,
    p_motor_versao: resultado.motor_versao,
    p_entrada: entrada,
    p_parametros: parametros,
    p_resultado: resultado,
    p_nota: opcoes.nota ?? null,
    p_criado_por: opcoes.criadoPor,
  });
  if (error) {
    registrarErro("server/motor-croqui.registrarCalculo", error, {
      jornada_id: jornadaId,
      perfil_id: opcoes.criadoPor,
    });
    // 42501 aqui não é mais "a sessão não vê patrimônio" (a rota já barrou isso):
    // é o perfil declarado ter sido desativado ou trocado de papel entre o login
    // e o clique. `22004` = `p_criado_por` nulo, que só acontece por bug de
    // chamador. Os dois viram a mesma resposta honesta.
    if (error.code === "42501" || error.code === "22004") {
      throw erroConflito("sem_permissao", "Só admin ou advogada ativa registra o cálculo do croqui.");
    }
    // Banco ainda sem a 0069: a assinatura de 8 parâmetros não existe.
    if (error.code === "PGRST202" || error.code === "42883") {
      throw new ErroApi(
        503,
        "servico_indisponivel",
        "Gravar o cálculo do croqui exige a migration 0069 — indisponível agora.",
      );
    }
    throw error;
  }
  return data as CroquiCalculo;
}
