/**
 * scripts/seed-exemplo-completo.ts
 *
 * UMA jornada de exemplo, de ponta a ponta, para o João percorrer a esteira
 * inteira no sistema — do seminário à holding constituída.
 *
 *   npx tsx scripts/seed-exemplo-completo.ts                    # início da esteira
 *   npx tsx scripts/seed-exemplo-completo.ts --etapa <etapa>    # avança ou rebobina
 *   npx tsx scripts/seed-exemplo-completo.ts --limpar           # remove tudo que criou
 *   npx tsx scripts/seed-exemplo-completo.ts --help
 *
 * ## O que ele cria
 *
 * Pessoa **João Pedro Alves Assunção** (`origem_dado='exemplo'`, e-mail de
 * teste), família, patrimônio, edição de seminário, respostas do seminário e a
 * jornada. A partir daí, cada etapa da esteira acrescenta a camada dela —
 * pagamento, agendamento, sessão, relatório, croqui calculado pelo MOTOR,
 * apresentação, material, radar de documentos e os 19 marcos de execução.
 *
 * Sem argumento a jornada para em `captado`: é o estado para o João comprar,
 * receber a ligação e percorrer a esteira DE VERDADE pelo sistema.
 * `--etapa holding_contratada` monta o estado final completo (é o estado das
 * capturas).
 *
 * ## Três regras que este script não quebra
 *
 * 1. **Nada fora de `origem_dado='exemplo'`.** Toda tabela que tem a coluna
 *    recebe `'exemplo'`; as que não têm ficam penduradas na jornada de
 *    exemplo, que é apagada inteira pelo `--limpar`.
 * 2. **Nenhum número inventado passando por real.** Os parâmetros do método
 *    que faltam para o croqui FECHAR (ITCMD/ITBI/cartório por UF, horas por
 *    ato) são cadastrados com `base_legal` e `notas` começando em
 *    "EXEMPLO — valor ilustrativo, não é a lei". Célula sem insumo continua
 *    saindo como "—".
 * 3. **Nada em `perfis_equipe`.** O autor de tudo é o perfil admin/advogada
 *    que já existe no banco.
 *
 * ## Por que `service_role`
 *
 * As RPCs do croqui (`registrar_croqui_calculo`, `fixar_croqui_calculo`,
 * `registrar_croqui_narrativa`) e as tabelas `pagamentos`, `webhooks_eventos`,
 * `execucoes_ia`, `materiais_gerados` têm EXECUTE/INSERT só para
 * `service_role` desde a 0069/0070 — e DELETE foi revogado de `authenticated`
 * em TODA tabela na 0065b/0065c, então `--limpar` também exige a chave.
 * Sem `SUPABASE_SERVICE_ROLE_KEY` o script recusa e não escreve nada.
 *
 * ## Manifesto
 *
 * `tmp/squad/mock-exemplo.manifesto.json` guarda os ids criados, os
 * parâmetros cadastrados, o valor ANTERIOR das configurações tocadas e o
 * inventário PRÉ do que foi apagado. É o que o `--limpar` lê para desfazer
 * exatamente o que este script fez.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import type {
  EntradaCroqui,
  HorasPorAto,
  ParametroCroqui,
  ParametrosCroqui,
  ResultadoCroqui,
  TabelaFaixas,
} from "../src/types/croqui-calculo";
import { calcularCroqui, chaveMapa } from "../src/server/motor-croqui";
import {
  calcularParaJornada,
  CHAVES_CONFIGURACAO_CROQUI,
  montarEntrada,
  parametrosAusentes,
  registrarCalculo,
  type ConfiguracoesCroqui,
  type FichaDoCroqui,
} from "../src/server/motor-croqui/servico";
import { chaveItemRadar } from "../src/lib/radar/derivar";
import {
  acharOuCriar,
  apagar,
  apagarJornadas,
  apagarPessoas,
  atualizar,
  cancelarMensagensDaJornada,
  carregarEnvLocal,
  clienteAdmin,
  contar,
  DIA,
  ErroSeed,
  ids,
  inserir,
  perfilAutor,
  produtoPorTipo,
  quando,
  RAIZ,
  uidDe,
  type Cliente,
} from "./seed-comum";
import { IDS_PESSOAS_DEMO, limparDemo, rodarDemo } from "./seed-demo";

// ---------------------------------------------------------------------------
// Esteira
// ---------------------------------------------------------------------------

const ETAPAS = [
  "captado",
  "qualificado",
  "sessao_contratada",
  "sessao_agendada",
  "sessao_realizada",
  "croqui_contratado",
  "croqui_apresentado",
  "holding_contratada",
] as const;
type Etapa = (typeof ETAPAS)[number];

const ordemDa = (e: Etapa): number => ETAPAS.indexOf(e);
const NIVEL_PAGO: Record<Etapa, number> = {
  captado: 0,
  qualificado: 0,
  sessao_contratada: 1,
  sessao_agendada: 1,
  sessao_realizada: 1,
  croqui_contratado: 2,
  croqui_apresentado: 2,
  holding_contratada: 3,
};

/**
 * As três etapas que a migration 0084 tranca por dinheiro (TETO, D5): só entra
 * quem tem pagamento APROVADO daquele produto registrado. Para elas a ordem do
 * seed inverte — primeiro o bloco (que grava o pagamento), depois a etapa.
 */
const ETAPAS_PAGAS = new Set<Etapa>(["sessao_contratada", "croqui_contratado", "holding_contratada"]);

// ---------------------------------------------------------------------------
// Identidade do mock — as chaves naturais que tornam o script idempotente
// ---------------------------------------------------------------------------

const MARCA = "EXEMPLO-SICHF-JOAO";
const EMAIL_PESSOA = "joao.assuncao+sichf@example.com";
const NOME_PESSOA = "João Pedro Alves Assunção (exemplo)";
const TELEFONE_PESSOA = "+5521989370272";
/** Não existe coluna de CPF em `pessoas` (0003 e nenhuma migration posterior). */
const CPF_PESSOA = "190.475.647-66";
const CODIGO_EDICAO = "SEM-EXEMPLO-2026";
export const UF = "SP";
export const MUNICIPIO = "São Paulo";
/** 2ª célula: UF de domicílio fiscal mais vantajoso, também de exemplo. */
export const UF_VANTAJOSA = "MG";

const ROTULO_EXEMPLO = "EXEMPLO — valor ilustrativo, não é a lei";
const NOTA_EXEMPLO =
  "EXEMPLO — valor ilustrativo, não é a lei. Cadastrado por scripts/seed-exemplo-completo.ts " +
  "só para a jornada de demonstração fechar. Apagar com --limpar antes de cadastrar o valor real.";

const CAMINHO_MANIFESTO = path.resolve(RAIZ, "tmp", "squad", "mock-exemplo.manifesto.json");

interface Manifesto {
  gerado_em: string;
  marca: string;
  etapa: Etapa | null;
  pessoa_id: string | null;
  jornada_id: string | null;
  edicao_id: string | null;
  croqui_id: string | null;
  croqui_calculo_id: string | null;
  parametros_ids: string[];
  configuracoes_anteriores: Record<string, unknown>;
  links: Array<{ tipo: string; token: string; url: string }>;
  apagados_outros_exemplos: Record<string, number>;
  urls: Record<string, string>;
}

function manifestoVazio(): Manifesto {
  return {
    gerado_em: new Date().toISOString(),
    marca: MARCA,
    etapa: null,
    pessoa_id: null,
    jornada_id: null,
    edicao_id: null,
    croqui_id: null,
    croqui_calculo_id: null,
    parametros_ids: [],
    configuracoes_anteriores: {},
    links: [],
    apagados_outros_exemplos: {},
    urls: {},
  };
}

function lerManifesto(): Manifesto {
  if (!fs.existsSync(CAMINHO_MANIFESTO)) return manifestoVazio();
  try {
    return { ...manifestoVazio(), ...(JSON.parse(fs.readFileSync(CAMINHO_MANIFESTO, "utf8")) as Manifesto) };
  } catch {
    return manifestoVazio();
  }
}

function gravarManifesto(m: Manifesto): void {
  fs.mkdirSync(path.dirname(CAMINHO_MANIFESTO), { recursive: true });
  fs.writeFileSync(CAMINHO_MANIFESTO, `${JSON.stringify(m, null, 2)}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// Datas — ~90 dias terminando ontem
// ---------------------------------------------------------------------------

const DATAS = {
  seminario_inicio: quando(90),
  seminario_fim: quando(88),
  captado: quando(88),
  formulario: quando(84),
  qualificado: quando(84),
  pagamento_sv: quando(80),
  boas_vindas: quando(80, 14),
  contato_equipe: quando(78),
  agendou: quando(77),
  sessao_marcada: quando(70, 10),
  confirmou_presenca: quando(72),
  sessao_realizada: quando(70, 10),
  relatorio: quando(69),
  material: quando(68),
  tarefa_croqui: quando(68),
  pagamento_croqui: quando(65),
  documentos_pedidos: quando(64),
  documentos_conferidos: quando(58),
  croqui_calculado: quando(50),
  narrativa: quando(49),
  apresentacao: quando(45, 15),
  exportacao: quando(44),
  pagamento_holding: quando(43),
  execucao_inicio: 42,
  holding: quando(1),
} as const;

// ---------------------------------------------------------------------------
// Parâmetros do método que faltam para o croqui FECHAR
//
// Nenhum destes existe no banco hoje (0062 deixou toda chave com jurisdição
// vazia, de propósito — alíquota de imposto não é palpite de migration). O
// mock cadastra os que a jornada precisa, TODOS rotulados como exemplo em
// `base_legal` e em `notas`, e o `--limpar` apaga exatamente estes ids.
// ---------------------------------------------------------------------------

export interface ParametroExemplo {
  chave: string;
  unidade: "brl" | "percentual" | "faixas" | "meses" | "parcelas";
  uf?: string;
  municipio?: string;
  valor?: number;
  faixas?: TabelaFaixas;
  porque: string;
}

const faixasProgressivas = (linhas: Array<[number | null, number]>): TabelaFaixas => ({
  modo: "progressivo",
  faixas: linhas.map(([ate, aliquota], i) => ({ ordem: i + 1, ate, aliquota })),
});

const faixasUnicas = (linhas: Array<[number | null, number]>): TabelaFaixas => ({
  modo: "faixa_unica",
  faixas: linhas.map(([ate, aliquota], i) => ({ ordem: i + 1, ate, aliquota })),
});

/**
 * ACHADO desta rodada, medido com o próprio motor (prova de mesa, sem gravar):
 * `chavesNecessarias()` (catalogo.ts) NÃO pede `itcmd.faixas.doacao_reforma`
 * nem `itcmd.fixo.celula_3_reforma`, mas `modelos.ts` as consome na coluna
 * "após reforma" — sem elas `parametrosAusentes()` devolve 0 (o 409
 * `parametro_ausente` não dispara) e mesmo assim 12 células saem `ausente`.
 * As duas entram aqui. A correção no catálogo é do dono do motor, não do seed.
 *
 * A ÚNICA célula que continua "—" depois deste cadastro é o ITCMD pós-reforma
 * da 2ª célula: `modelos.ts:116-130` devolve `celulaAusente` FIXO, sem
 * consultar parâmetro nenhum, porque `jurisdicaoDe()` amarra
 * `itcmd.faixas.doacao_reforma` à UF do cliente e não à UF vantajosa. Nenhum
 * cadastro fecha isso — é limitação do motor (CONFLITO 9), e o "—" é o
 * comportamento correto.
 */
export const PARAMETROS_EXEMPLO: ParametroExemplo[] = [
  {
    chave: "itcmd.faixas.heranca",
    unidade: "faixas",
    uf: UF,
    faixas: faixasProgressivas([[1_000_000, 2], [3_000_000, 4], [null, 6]]),
    porque: "T3 (inventário hoje)",
  },
  {
    chave: "itcmd.faixas.heranca_reforma",
    unidade: "faixas",
    uf: UF,
    faixas: faixasProgressivas([[1_000_000, 2], [3_000_000, 4], [6_000_000, 6], [null, 8]]),
    porque: "T5 (inventário pós-reforma)",
  },
  {
    chave: "itcmd.faixas.doacao",
    unidade: "faixas",
    uf: UF,
    faixas: faixasProgressivas([[1_000_000, 2], [3_000_000, 4], [null, 6]]),
    porque: "T6 (doação) e T7 (1 célula)",
  },
  {
    chave: "itcmd.faixas.doacao_reforma",
    unidade: "faixas",
    uf: UF,
    faixas: faixasProgressivas([[1_000_000, 2], [3_000_000, 4], [6_000_000, 6], [null, 8]]),
    porque: "coluna 'após reforma' de T6/T7 e do comparativo geral",
  },
  {
    chave: "itcmd.fixo.celula_3",
    unidade: "brl",
    uf: UF,
    valor: 20_000,
    porque: "T9 (3 células)",
  },
  {
    chave: "itcmd.fixo.celula_3_reforma",
    unidade: "brl",
    uf: UF,
    valor: 26_000,
    porque: "T9 (3 células), coluna após reforma — mesma lacuna de chavesNecessarias()",
  },
  {
    chave: "itcmd.aliquota.domicilio_vantajoso",
    unidade: "percentual",
    uf: UF_VANTAJOSA,
    valor: 2,
    porque: "T8 (2 células) — jurisdição de `configuracoes['croqui.uf_domicilio_vantajoso']`",
  },
  {
    chave: "itbi.aliquota",
    unidade: "percentual",
    uf: UF,
    municipio: MUNICIPIO,
    valor: 3,
    porque: "T14 (comparativo com ITBI)",
  },
  {
    chave: "cartorio.faixas.notas",
    unidade: "faixas",
    uf: UF,
    faixas: faixasUnicas([[500_000, 0.9], [2_000_000, 0.75], [null, 0.6]]),
    porque: "escritura — T3, T5, T6, T7–T9",
  },
  {
    chave: "cartorio.faixas.imoveis",
    unidade: "faixas",
    uf: UF,
    faixas: faixasUnicas([[500_000, 0.6], [2_000_000, 0.5], [null, 0.4]]),
    porque: "registro de imóveis — T3, T5, T6, T7–T9",
  },
  {
    chave: "cartorio.notas.percentual_fallback",
    unidade: "percentual",
    uf: UF,
    valor: 0.8,
    porque: "aproximação exigida pelo catálogo mesmo quando a tabela existe",
  },
  {
    chave: "cartorio.imoveis.percentual_fallback",
    unidade: "percentual",
    uf: UF,
    valor: 0.5,
    porque: "aproximação exigida pelo catálogo mesmo quando a tabela existe",
  },
  {
    chave: "cartorio.certidoes.valor",
    unidade: "brl",
    valor: 2_000,
    porque: "T3/T5/T6 — chave em DIVERGÊNCIA real (2.000 × 7.000); o mock fixa a menor e diz que é exemplo",
  },
  {
    chave: "honorarios.inventario.percentual",
    unidade: "percentual",
    uf: UF,
    valor: 7,
    porque: "T3/T5 — mínimo da tabela da OAB da seccional",
  },
  {
    chave: "membership.mensalidade",
    unidade: "brl",
    valor: 2_000,
    porque: "T19 — chave em DIVERGÊNCIA real (750 × 1.350 × 2.000)",
  },
  {
    chave: "reforma.ibs_cbs.credito.percentual",
    unidade: "percentual",
    valor: 26.5,
    porque: "T10/T12 — chave em DIVERGÊNCIA real (26,5% × 36,92%)",
  },
];

/** 21 atos. Totais do escritório: 50 h (1 célula) · 47 h (2) · 35 h (3) —
 * a nota do Drive confirma que 3 células é o modelo que MENOS horas consome. */
export const HORAS_POR_ATO: HorasPorAto[] = [
  ["Reunião de ajustes e alinhamento", 4, 3, 2],
  ["Qualificação dos envolvidos", 2, 2, 1],
  ["Contrato de prestação de serviços", 2, 2, 1],
  ["Certificado digital da família", 1, 1, 1],
  ["Minuta do contrato social — Destino", 4, 3, 2],
  ["Minuta do contrato social — Veículo", 0, 3, 2],
  ["Minuta do contrato social — Cofre", 0, 0, 2],
  ["Registro na Junta Comercial", 3, 3, 3],
  ["1ª alteração — doação de quotas", 4, 3, 2],
  ["Cálculo e guia do ITCMD", 3, 3, 2],
  ["Acordo de sócios — Destino", 4, 3, 2],
  ["Acordo de sócios — Cofre", 0, 2, 2],
  ["Integralização do patrimônio", 5, 4, 3],
  ["Requerimento de imunidade de ITBI", 3, 3, 2],
  ["Recurso do ITBI", 3, 2, 2],
  ["Registro da propriedade nos cartórios", 4, 3, 2],
  ["Abertura de conta bancária", 2, 2, 1],
  ["Transferência de titularidade de veículos", 1, 1, 1],
  ["Sumário jurídico da estrutura", 2, 2, 2],
  ["Carta de entrega à família", 1, 1, 1],
  ["Reunião de entrega", 2, 1, 1],
].map(([ato, c1, c2, c3]) => ({
  ato: ato as string,
  horas: { celula_1: c1 as number, celula_2: c2 as number, celula_3: c3 as number },
}));

// ---------------------------------------------------------------------------
// Conteúdo do mock
// ---------------------------------------------------------------------------

export const FAMILIA = [
  { parentesco: "conjuge", nome: "Marina Alves Assunção (exemplo)", idade: 49, ocupacao: "Arquiteta", regime_casamento: "comunhão parcial de bens", ano_casamento: 2001, dependente_financeiro: false },
  { parentesco: "filho", nome: "Pedro Alves Assunção (exemplo)", idade: 23, ocupacao: "Engenheiro", regime_casamento: null, ano_casamento: null, dependente_financeiro: false },
  { parentesco: "filho", nome: "Helena Alves Assunção (exemplo)", idade: 20, ocupacao: "Estudante de Direito", regime_casamento: null, ano_casamento: null, dependente_financeiro: true },
  { parentesco: "filho", nome: "Rafael Alves Assunção (exemplo)", idade: 16, ocupacao: "Estudante", regime_casamento: null, ano_casamento: null, dependente_financeiro: true },
];

export const PATRIMONIO = [
  { tipo: "imovel", descricao: "Apartamento — Vila Nova Conceição, São Paulo/SP (residência)", ano_aquisicao: 2009, valor_historico: 980_000, valor_mercado: 3_400_000, destinacao: "residencia", valor_locacao_mensal: null, detalhes: {} },
  { tipo: "imovel", descricao: "Sala comercial — Av. Paulista, São Paulo/SP (locada)", ano_aquisicao: 2014, valor_historico: 620_000, valor_mercado: 1_450_000, destinacao: "locacao", valor_locacao_mensal: 9_800, detalhes: {} },
  { tipo: "imovel", descricao: "Galpão logístico — Guarulhos/SP (uso da empresa)", ano_aquisicao: 2017, valor_historico: 1_150_000, valor_mercado: 2_300_000, destinacao: "uso da empresa", valor_locacao_mensal: null, detalhes: {} },
  { tipo: "imovel", descricao: "Casa de praia — Riviera de São Lourenço/SP", ano_aquisicao: 2019, valor_historico: 890_000, valor_mercado: 1_600_000, destinacao: "uso", valor_locacao_mensal: null, detalhes: { vender_para_levantar: true } },
  { tipo: "empresa", descricao: "Assunção Distribuição Ltda. — 80% das quotas", ano_aquisicao: 2005, valor_historico: 1_200_000, valor_mercado: 4_800_000, destinacao: "operacional", valor_locacao_mensal: null, detalhes: { faturamento_mensal: 1_450_000, custo_operacional_mensal: 1_180_000, participacao_percentual: 80 } },
  { tipo: "empresa", descricao: "Assunção Imóveis e Participações Ltda. — 100% das quotas", ano_aquisicao: 2015, valor_historico: 300_000, valor_mercado: 720_000, destinacao: "operacional", valor_locacao_mensal: null, detalhes: { participacao_percentual: 100 } },
  { tipo: "investimento", descricao: "Carteira de renda fixa — banco de investimento", ano_aquisicao: 2018, valor_historico: 1_100_000, valor_mercado: 1_380_000, destinacao: "uso", valor_locacao_mensal: null, detalhes: {} },
  { tipo: "previdencia", descricao: "VGBL — plano familiar", ano_aquisicao: 2012, valor_historico: 420_000, valor_mercado: 540_000, destinacao: "uso", valor_locacao_mensal: null, detalhes: {} },
  { tipo: "veiculo", descricao: "Toyota SW4 2023 — placa de exemplo", ano_aquisicao: 2023, valor_historico: 320_000, valor_mercado: 290_000, destinacao: "uso", valor_locacao_mensal: null, detalhes: {} },
];

const RESPOSTAS_SEMINARIO: Array<[string, string]> = [
  ["O que te trouxe ao seminário?", "Meu pai faleceu sem inventário aberto e a família levou quatro anos para resolver. Não quero isso para os meus filhos."],
  ["Qual sua maior preocupação hoje?", "A empresa. Ela sustenta a família toda e só eu opero. Se eu faltar amanhã, ninguém sabe onde estão as coisas."],
  ["Você já ouviu falar de holding familiar?", "Já, mas achava que era coisa de quem tem cem milhões. Descobri no seminário que não é."],
  ["Quem decide com você as questões financeiras?", "Minha esposa. Nada grande passa sem ela."],
  ["O que você espera da Sessão de Viabilidade?", "Saber quanto custa hoje não fazer nada, em número, e quanto custa fazer."],
];

const RESPOSTAS_FORMULARIO: Record<string, unknown> = {
  p1: "João Pedro Alves Assunção",
  p2: "São Paulo/SP",
  p3: "Empresário — distribuição",
  p4: "45-54",
  p5: "casado",
  p6: 3,
  p7: false,
  p8: true,
  p9: "Acima de R$ 2 milhões",
  p10: ["Imóveis", "Veículos", "Investimentos", "Previdência", "Empresa"],
  p11: 4,
  p12: "Vi de perto o inventário do meu pai travar a família por quatro anos. Quero organizar antes.",
  p13: "Que a empresa pare se eu faltar, e que os três filhos briguem por causa dela.",
  p14: "Decidimos em conjunto",
  p15: true,
  p16: "Quero ver o número: quanto custa não fazer nada e quanto custa fazer.",
  p17: false,
};


/** Conteúdo do material pós-sessão (mesma peça nos dois modos: supabase-js e SQL). */
const CONTEUDO_MATERIAL = {
  titulo: "Empresa e patrimônio pessoal: por que separar",
  blocos: [
    { tipo: "paragrafo", texto: "João, você disse na ligação: “se eu faltar amanhã, ninguém sabe onde estão as coisas”. Este material trata exatamente disso." },
    { tipo: "titulo", texto: "O que acontece com a operação num inventário" },
    { tipo: "lista", itens: [
      "As quotas entram no espólio e ficam indisponíveis enquanto o processo corre.",
      "Decisão societária passa a depender de alvará judicial.",
      "O imposto e os honorários vencem antes de a família ter acesso ao caixa.",
    ] },
    { tipo: "titulo", texto: "O que a separação muda" },
    { tipo: "lista", itens: [
      "O patrimônio deixa de estar no nome da pessoa física e passa a ter regra escrita.",
      "O controle continua com você enquanto você quiser.",
      "A sucessão vira alteração contratual, não processo judicial.",
    ] },
    { tipo: "paragrafo", texto: "Os números do seu caso estão no Croqui Estrutural — este material é o mapa, não a conta." },
  ],
    };

// ---------------------------------------------------------------------------
// Blocos por etapa
// ---------------------------------------------------------------------------

interface Contexto {
  db: Cliente;
  perfilId: string;
  pessoaId: string;
  jornadaId: string;
  edicaoId: string;
  manifesto: Manifesto;
  registrar: (linha: string) => void;
}

/** Evento de timeline com data retroativa, idempotente pelo título. */
async function evento(
  ctx: Contexto,
  tipo: string,
  titulo: string,
  ocorridoEm: string,
  descricao?: string,
  dados: Record<string, unknown> = {},
): Promise<void> {
  const { data } = await ctx.db
    .from("eventos_timeline")
    .select("id")
    .eq("jornada_id", ctx.jornadaId)
    .eq("tipo", tipo)
    .eq("titulo", titulo)
    .maybeSingle();
  if (data) return;
  await inserir(ctx.db, "eventos_timeline", {
    jornada_id: ctx.jornadaId,
    tipo,
    titulo,
    descricao: descricao ?? null,
    dados,
    ator_perfil_id: ctx.perfilId,
    ator_tipo: "humano",
    ocorrido_em: ocorridoEm,
  });
}

/**
 * Pagamento + o evento de webhook que o originou.
 *
 * ## Por que passa pela RPC, e nao por um INSERT
 *
 * ACHADO desta rodada: `service_role` NAO consegue inserir direto em
 * `pagamentos`. O gatilho `app.regua_boas_vindas` (0011) chama
 * `app.enfileirar_mensagem`, e a 0013/0051 revogaram EXECUTE dessa funcao de
 * `public, anon, authenticated` — como `service_role` herda de PUBLIC, ficou
 * sem EXECUTE tambem. O INSERT morre com `42501 permission denied for function
 * enfileirar_mensagem`. Em producao nada quebra porque o webhook da Hotmart
 * chama `public.processar_pagamento_hotmart`, que e `security definer` e roda
 * como dono — mas qualquer escrita direta em `pagamentos` por service_role
 * (um "registrar pagamento manual" no admin, por exemplo) bateria no mesmo
 * muro. Esta no relatorio.
 *
 * Consequencia aqui: o seed usa a MESMA RPC do webhook. Fidelidade maior, de
 * quebra — a jornada avanca pelo caminho real de producao.
 *
 * A RPC casa o produto por `produtos.hotmart_produto_id`, hoje NULL nos tres
 * (BLOQUEIO B7). O seed carimba um id de exemplo, chama, e DEVOLVE o campo ao
 * que era — inclusive se a chamada falhar.
 */
async function pagamento(
  ctx: Contexto,
  sufixo: string,
  tipoProduto: string,
  valor: number,
  pagoEm: string,
): Promise<void> {
  const externo = `${MARCA}-${sufixo}`;
  const bruto = {
    exemplo: true,
    marca: MARCA,
    observacao: "Payload sintetico do seed de exemplo — nao veio da Hotmart.",
    transaction: externo,
    product: tipoProduto,
    price: { value: valor, currency_code: "BRL" },
    buyer: { name: NOME_PESSOA, email: EMAIL_PESSOA },
    purchase_date: pagoEm,
  };

  await acharOuCriar(ctx.db, "webhooks_eventos", { origem: "exemplo", evento_externo_id: externo }, {
    tipo_evento: "PURCHASE_APPROVED",
    assinatura_valida: true,
    bruto,
    processado_em: pagoEm,
    recebido_em: pagoEm,
  });

  const { count } = await ctx.db
    .from("pagamentos")
    .select("*", { count: "exact", head: true })
    .eq("transacao_externa_id", externo);
  if ((count ?? 0) > 0) return;

  // Só a Sessão de Viabilidade precisa da RPC: `app.regua_boas_vindas` (0011)
  // dispara APENAS para `sessao_viabilidade`, e é ele que chama a função sem
  // EXECUTE para service_role. Croqui e holding entram por INSERT direto — e
  // TÊM de entrar, porque `processar_pagamento_hotmart` exige uma jornada
  // ABERTA: quando a jornada já virou `ganha` (holding fechada), a RPC abre uma
  // jornada NOVA em `captado` e pendura o pagamento nela. Foi o que aconteceu
  // na primeira rodada desta sessão — jornada fantasma na Esteira.
  const produtoId = await produtoPorTipo(ctx.db, tipoProduto);
  if (tipoProduto !== "sessao_viabilidade") {
    await inserir(ctx.db, "pagamentos", {
      jornada_id: ctx.jornadaId,
      pessoa_id: ctx.pessoaId,
      produto_id: produtoId,
      origem: "exemplo",
      transacao_externa_id: externo,
      status: "aprovado",
      valor,
      moeda: "BRL",
      parcelas: 1,
      comprador_email: EMAIL_PESSOA,
      comprador_nome: NOME_PESSOA,
      comprador_telefone: TELEFONE_PESSOA,
      pago_em: pagoEm,
      bruto,
      criado_em: pagoEm,
    });
    return;
  }

  const { data: antes } = await ctx.db
    .from("produtos")
    .select("hotmart_produto_id")
    .eq("id", produtoId)
    .maybeSingle();
  const anterior = (antes as { hotmart_produto_id: string | null } | null)?.hotmart_produto_id ?? null;
  const marcador = `${MARCA}-PROD-${tipoProduto}`;

  try {
    if (anterior === null) {
      await atualizar(ctx.db, "produtos", { id: produtoId }, { hotmart_produto_id: marcador });
    }
    const { error } = await ctx.db.rpc("processar_pagamento_hotmart", {
      p_hotmart_produto_id: anterior ?? marcador,
      p_transacao_externa_id: externo,
      p_status: "aprovado",
      p_valor: valor,
      p_moeda: "BRL",
      p_parcelas: 1,
      p_comprador_email: EMAIL_PESSOA,
      p_comprador_nome: NOME_PESSOA,
      p_comprador_telefone: TELEFONE_PESSOA,
      p_pago_em: pagoEm,
      p_bruto: bruto,
    });
    if (error) throw new ErroSeed(`processar_pagamento_hotmart(${sufixo}): ${error.code ?? ""} ${error.message}`);
  } finally {
    // Devolver o campo e obrigatorio mesmo com erro: `hotmart_produto_id` e
    // configuracao de producao (B7), nao do seed.
    if (anterior === null) {
      await atualizar(ctx.db, "produtos", { id: produtoId }, { hotmart_produto_id: null });
    }
  }
  // `app.regua_boas_vindas` (0011:104) acabou de enfileirar e-mail e WhatsApp
  // com `agendada_para = now()` — ja vencidos. O cron da Hostinger (a cada 5
  // min) reivindica tudo que esta `pendente` e vencido: entre este ponto e a
  // varredura do fim do seed havia uma janela real de mensagem saindo para o
  // e-mail ficticio (achado M1 do pentest, 06/09). Selar aqui reduz a janela
  // ao tempo de uma consulta.
  const nSeladas = await cancelarMensagensDaJornada(ctx.db, [ctx.jornadaId], { agendadaPara: DATAS.boas_vindas });
  if (nSeladas > 0) console.log(`  ${nSeladas} mensagem(ns) da regua canceladas na hora (pagamento ${sufixo})`);
}

async function linkPublico(ctx: Contexto, tipo: string, expiraEmDias: number): Promise<string> {
  const jaTem = ctx.manifesto.links.find((l) => l.tipo === tipo);
  if (jaTem) {
    const { count } = await ctx.db
      .from("links_publicos")
      .select("*", { count: "exact", head: true })
      .eq("jornada_id", ctx.jornadaId)
      .eq("tipo", tipo);
    if ((count ?? 0) > 0) return jaTem.token;
  }
  const pepper = process.env.LINK_PUBLICO_PEPPER;
  if (!pepper || pepper.length < 16) {
    throw new ErroSeed("LINK_PUBLICO_PEPPER ausente/curta em .env.local — sem ela o link público não abre.");
  }
  const token = crypto.randomBytes(32).toString("base64url");
  await inserir(ctx.db, "links_publicos", {
    id: ID.link(tipo),
    jornada_id: ctx.jornadaId,
    // `ck_link_confirmacao_agendamento` (0051): link de confirmação de presença
    // SEM agendamento é link que não sabe o que confirma — o banco recusa.
    agendamento_id: tipo === "confirmacao" ? ID.agendamento : null,
    tipo,
    token_hash: crypto.createHash("sha256").update(token + pepper, "utf8").digest("hex"),
    token_prefixo: token.slice(0, 6),
    estado: "ativo",
    expira_em: new Date(Date.now() + expiraEmDias * DIA).toISOString(),
    criado_por: ctx.perfilId,
    origem_dado: "exemplo",
  });
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const rota = tipo === "material" ? "m" : tipo === "documentos" ? "d" : tipo === "agendamento" ? "a" : tipo === "confirmacao" ? "c" : "f";
  ctx.manifesto.links = [...ctx.manifesto.links.filter((l) => l.tipo !== tipo), { tipo, token, url: `${base}/p/${rota}/${token}` }];
  return token;
}

// --- captado ---------------------------------------------------------------

async function blocoCaptado(ctx: Contexto): Promise<void> {
  for (const [pergunta, resposta] of RESPOSTAS_SEMINARIO) {
    await acharOuCriar(ctx.db, "respostas_seminario", { pessoa_id: ctx.pessoaId, edicao_id: ctx.edicaoId, pergunta }, {
      resposta,
      origem: "manual",
      origem_dado: "exemplo",
      criado_por: ctx.perfilId,
      criado_em: DATAS.captado,
    });
  }
  for (const tipo of ["comunicacao_email", "comunicacao_whatsapp", "gravacao_sessao", "tratamento_ia"]) {
    await acharOuCriar(ctx.db, "consentimentos", { pessoa_id: ctx.pessoaId, tipo }, {
      concedido: true,
      texto_apresentado: `Você autoriza (${tipo})? — texto de exemplo, registrado pelo seed de demonstração.`,
      versao_texto: "exemplo-v1",
      canal: "formulario",
      registrado_por: ctx.perfilId,
      concedido_em: DATAS.captado,
    });
  }
  await evento(ctx, "etapa", "Entrou pela edição do seminário", DATAS.captado, "Assistiu aos 3 dias.");
  ctx.registrar("captado · respostas do seminário, consentimentos, participação");
}

// --- qualificado -----------------------------------------------------------

async function blocoQualificado(ctx: Contexto): Promise<void> {
  for (const f of FAMILIA) {
    await acharOuCriar(ctx.db, "familiares", { pessoa_id: ctx.pessoaId, parentesco: f.parentesco, nome: f.nome }, {
      registrado_na_jornada_id: ctx.jornadaId,
      idade: f.idade,
      ocupacao: f.ocupacao,
      regime_casamento: f.regime_casamento,
      ano_casamento: f.ano_casamento,
      dependente_financeiro: f.dependente_financeiro,
      ativo: true,
      criado_em: DATAS.qualificado,
    });
  }
  for (const b of PATRIMONIO) {
    await acharOuCriar(ctx.db, "patrimonio_itens", { pessoa_id: ctx.pessoaId, descricao: b.descricao }, {
      registrado_na_jornada_id: ctx.jornadaId,
      tipo: b.tipo,
      ano_aquisicao: b.ano_aquisicao,
      valor_historico: b.valor_historico,
      valor_mercado: b.valor_mercado,
      destinacao: b.destinacao,
      valor_locacao_mensal: b.valor_locacao_mensal,
      detalhes: b.detalhes,
      origem_valor: "digitado",
      ativo: true,
      criado_por: ctx.perfilId,
      criado_em: DATAS.qualificado,
    });
  }

  const { data: formulario } = await ctx.db
    .from("formularios")
    .select("id")
    .eq("chave", "estrategico")
    .eq("ativo", true)
    .order("versao", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (formulario) {
    await acharOuCriar(ctx.db, "formularios_respostas", { jornada_id: ctx.jornadaId }, {
      formulario_id: (formulario as { id: string }).id,
      respostas: RESPOSTAS_FORMULARIO,
      origem: "sistema",
      origem_dado: "exemplo",
      respondido_em: DATAS.formulario,
    });
  }
  await atualizar(ctx.db, "jornadas", { id: ctx.jornadaId }, { faixa_patrimonio_declarada: "Acima de R$ 2 milhões" });
  await evento(ctx, "formulario", "Formulário Estratégico respondido", DATAS.formulario);
  await evento(ctx, "patrimonio", "Patrimônio e família registrados", DATAS.qualificado, `${PATRIMONIO.length} bens · ${FAMILIA.length} familiares`);
  ctx.registrar(`qualificado · ${FAMILIA.length} familiares, ${PATRIMONIO.length} bens, formulário`);
}

// --- sessao_contratada -----------------------------------------------------

async function blocoSessaoContratada(ctx: Contexto): Promise<void> {
  await pagamento(ctx, "SV", "sessao_viabilidade", 2000, DATAS.pagamento_sv);
  await evento(ctx, "pagamento", "Sessão de Viabilidade paga", DATAS.pagamento_sv, "R$ 2.000,00");
  await evento(ctx, "mensagem", "Boas-vindas enviadas", DATAS.boas_vindas, "E-mail completo + aviso de que a equipe vai ligar.");

  await acharOuCriar(ctx.db, "ligacoes_estrategicas", { jornada_id: ctx.jornadaId, pop: "03" }, {
    realizada_em: DATAS.contato_equipe,
    duracao_segundos: 337,
    colaborador_id: ctx.perfilId,
    respostas: {
      expectativa: "Ver o número: custo de não fazer nada × custo de fazer",
      preocupacao: "A empresa parar se ele faltar; briga entre os três filhos",
      processo_decisorio: "Decide junto com a esposa",
    },
    expectativa_principal: "Ver, em número, quanto custa não fazer nada e quanto custa fazer.",
    preocupacao_principal: "A operação parar e os três filhos brigarem pela empresa.",
    assunto_atencao_especial: "O pai dele morreu sem inventário aberto; o assunto é sensível.",
    objecoes_percebidas: ["Vai comparar o preço com o de um contador", "Quer entender por que 3 células e não 1"],
    pessoas_mencionadas: ["Marina (esposa, decide junto)", "Pedro, Helena e Rafael (filhos)", "sócio minoritário com 20%"],
    ritmo: "rapido",
    estilo_resposta: "objetiva",
    sinais: ["procura_numeros", "interrompe", "demonstra_cautela"],
    frases_marcantes: [
      "Meu pai morreu e a gente levou quatro anos para resolver. Não quero isso para os meus filhos.",
      "Se eu faltar amanhã, ninguém sabe onde estão as coisas.",
    ],
    processo_decisorio: "decisor_conjunto",
    decisores_presentes_na_sessao: true,
    observacoes: "Contato humano da equipe (exemplo). Chegou com perguntas escritas; quer número, não conceito.",
    origem_dado: "exemplo",
    criado_por: ctx.perfilId,
    criado_em: DATAS.contato_equipe,
  });
  await evento(ctx, "ligacao", "Contato da equipe registrado", DATAS.contato_equipe, "5 min · decide junto com a esposa");
  ctx.registrar("sessao_contratada · pagamento da SV, webhook, boas-vindas, contato da equipe");
}

// --- sessao_agendada -------------------------------------------------------

async function sessaoDaJornada(ctx: Contexto): Promise<string> {
  const { linha } = await acharOuCriar<{ id: string }>(ctx.db, "sessoes_viabilidade", { jornada_id: ctx.jornadaId }, {
    id: ID.sessao,
    advogada_id: ctx.perfilId,
    link_sala: "https://meet.example.com/sic-hf-exemplo-joao",
    link_sala_origem: "manual",
    link_sala_atualizado_em: DATAS.agendou,
    criado_em: DATAS.agendou,
  });
  return linha.id;
}

async function blocoSessaoAgendada(ctx: Contexto): Promise<void> {
  const sessaoId = await sessaoDaJornada(ctx);
  const inicio = DATAS.sessao_marcada;
  const fim = new Date(new Date(inicio).getTime() + 60 * 60 * 1000).toISOString();
  await acharOuCriar(ctx.db, "agendamentos", { sessao_id: sessaoId, inicio_em: inicio }, {
    id: ID.agendamento,
    fim_em: fim,
    status: "confirmado",
    origem: "cliente",
    advogada_id: ctx.perfilId,
    criado_por: ctx.perfilId,
    criado_em: DATAS.agendou,
    presenca_confirmada_em: DATAS.confirmou_presenca,
    presenca_confirmada_via: "link",
  });
  await linkPublico(ctx, "confirmacao", 400);
  await evento(ctx, "agendamento", "Sessão agendada pelo cliente", DATAS.agendou);
  await evento(ctx, "agendamento", "Presença confirmada pelo cliente", DATAS.confirmou_presenca, "Confirmou pelo link.");
  ctx.registrar("sessao_agendada · sessão, agendamento confirmado, presença confirmada");
}

// --- sessao_realizada ------------------------------------------------------

const BLOCOS_DIAGNOSTICO = [
  {
    chave: "situacao_familiar",
    titulo: "Situação familiar",
    conteudo:
      "Casado sob comunhão parcial desde 2001, três filhos (23, 20 e 16). Dois já fora de casa; o caçula é menor. A esposa participa das decisões financeiras.",
    pontos: ["Três núcleos futuros", "Um herdeiro menor de idade", "Cônjuge decide junto"],
    fontes: ["formulario", "ligacao"],
    categoria: "fato_declarado",
    visivel_ao_cliente: true,
  },
  {
    chave: "concentracao_patrimonial",
    titulo: "Onde o patrimônio está concentrado",
    conteudo:
      "A operação (80% das quotas da distribuidora) é a maior parcela do patrimônio e a única fonte de renda da família. Quatro imóveis, um deles usado pela empresa.",
    pontos: ["Empresa operacional relevante", "Imóvel de renda com aluguel mensal", "Imóvel de uso da própria operação"],
    fontes: ["patrimonio", "relatorio"],
    categoria: "dado_documental",
    visivel_ao_cliente: true,
  },
  {
    chave: "risco_de_inercia",
    titulo: "O que acontece se nada for feito",
    conteudo:
      "Inventário com a operação dentro do espólio: as quotas ficam indisponíveis enquanto o processo corre, e a família precisa de liquidez para o ITCMD e os honorários.",
    pontos: ["Operação exposta ao bloqueio", "Necessidade de caixa no pior momento"],
    fontes: ["relatorio"],
    categoria: "inferencia",
    visivel_ao_cliente: true,
  },
  {
    chave: "o_que_falta",
    titulo: "O que falta para fechar o croqui",
    conteudo:
      "Declaração de IR do titular e da esposa, contrato social das duas empresas, matrícula dos quatro imóveis e o CRLV do veículo.",
    pontos: ["Radar de documentos aberto na aba Sessão"],
    fontes: ["radar"],
    categoria: "ponto_a_validar",
    visivel_ao_cliente: false,
  },
];

async function blocoSessaoRealizada(ctx: Contexto): Promise<void> {
  const sessaoId = await sessaoDaJornada(ctx);
  await atualizar(ctx.db, "sessoes_viabilidade", { id: sessaoId }, {
    realizada_em: DATAS.sessao_realizada,
    resultado: "fechou",
    motivo_resultado: "Contratou o croqui na própria sessão.",
  });
  // `.neq` evita reescrever o mesmo valor: `trg_timeline_agendamento` dispara em
  // UPDATE e gravaria um evento novo a cada rodada (idempotência da timeline).
  await ctx.db.from("agendamentos").update({ status: "realizado" }).eq("sessao_id", sessaoId).neq("status", "realizado");

  await acharOuCriar(ctx.db, "relatorios_sessao", { sessao_id: sessaoId }, {
    acompanhado: true,
    quem_acompanha: "Marina (esposa)",
    acompanhante_decide: true,
    acompanhante_assistiu: true,
    data_contratacao: DATAS.pagamento_sv.slice(0, 10),
    valor_pago_sessao: 2000,
    parcelas: 1,
    motivacao_cliente: "Viu o inventário do pai travar a família por quatro anos.",
    receita_familiar_mensal: 62_000,
    ideia_custo_inventario: "Achava que ficava em torno de R$ 80 mil; nunca fez a conta.",
    reserva_ou_seguro: "Seguro de vida de R$ 500 mil, sem reserva de liquidez para inventário.",
    ciente_itcmd: true,
    preocupacao_predominante: "Continuidade da operação e convivência entre os três filhos.",
    como_deseja_organizar: "Manter o controle enquanto viver e deixar regra escrita para depois.",
    motiva_evitar_inventario: "Tempo e bloqueio da empresa, mais que o custo.",
    interesse_imediato: "Alto — quer começar ainda neste trimestre.",
    relacao_filhos_terceiros: "Filho mais velho já trabalha na empresa; os outros dois, não.",
    porque_nos_procurou: "Assistiu aos três dias do seminário e se identificou com o caso do inventário.",
    falta_planejamento_preocupa: "Sim, principalmente pelo filho menor.",
    resultado_sessao: "Fechou o croqui na sessão.",
    tributos: { exemplo: true, observacao: "Números do croqui vêm do motor, não deste campo." },
    consideracoes_apresentacao_croqui:
      "Começar pelo custo da inércia. Ele responde a número, não a conceito. A esposa precisa estar na apresentação.",
    criado_por: ctx.perfilId,
    criado_em: DATAS.relatorio,
  });

  const { data: diag } = await ctx.db
    .from("diagnosticos_sv")
    .select("id")
    .eq("jornada_id", ctx.jornadaId)
    .eq("atual", true)
    .maybeSingle();
  if (!diag) {
    // 0071: sob service_role a RPC exige o autor DECLARADO (p_criado_por), validado por
    // app.perfil_ve_patrimonio — sem ele responde 22004 (a trava do Fable pegou isso).
    const { error } = await ctx.db.rpc("registrar_diagnostico_sv", {
      p_jornada_id: ctx.jornadaId,
      p_analise_id: null,
      p_blocos: BLOCOS_DIAGNOSTICO,
      p_criado_por: ctx.perfilId,
    });
    // ACHADO: `registrar_diagnostico_sv` (0058) é a ÚNICA RPC desta família que
    // ainda pergunta pela SESSÃO (`if not app.ve_patrimonio()`), e desde a 0061
    // essa função é `coalesce(..., false)`. Sob `service_role` não existe
    // `auth.uid()`, então ela responde 42501 — as irmãs do croqui foram
    // convertidas para o autor DECLARADO (`p_criado_por`) na 0069/0070, esta
    // não. Enquanto isso não muda, o seed grava pelo mesmo caminho que a RPC
    // usaria: `service_role` ignora a RLS, o CHECK `ck_blocos_validos` continua
    // valendo e o autor é carimbado explicitamente. Está no relatório.
    if (error && error.code === "42501") {
      ctx.registrar("diagnóstico: RPC recusou service_role (42501) — gravando pelo mesmo caminho, com autor declarado");
      const { data: ultima } = await ctx.db
        .from("diagnosticos_sv")
        .select("versao")
        .eq("jornada_id", ctx.jornadaId)
        .order("versao", { ascending: false })
        .limit(1)
        .maybeSingle();
      await atualizar(ctx.db, "diagnosticos_sv", { jornada_id: ctx.jornadaId, atual: true }, { atual: false });
      await inserir(ctx.db, "diagnosticos_sv", {
        jornada_id: ctx.jornadaId,
        versao: ((ultima as { versao: number } | null)?.versao ?? 0) + 1,
        analise_id: null,
        blocos: BLOCOS_DIAGNOSTICO,
        atual: true,
        criado_por: ctx.perfilId,
        atualizado_por: ctx.perfilId,
        criado_em: DATAS.relatorio,
      });
    } else if (error) {
      throw new ErroSeed(`registrar_diagnostico_sv: ${error.code ?? ""} ${error.message}`);
    }
  }

  await materialAprovado(ctx);
  await radarDeDocumentos(ctx, false);

  await acharOuCriar(ctx.db, "tarefas", { jornada_id: ctx.jornadaId, titulo: "Montar o croqui estrutural" }, {
    descricao: "Cliente contratou na sessão. Aguardando IR e contrato social.",
    responsavel_id: ctx.perfilId,
    vence_em: DATAS.croqui_calculado.slice(0, 10),
    origem: "sistema",
    tipo: "croqui_montar",
    criado_por: ctx.perfilId,
    criado_em: DATAS.tarefa_croqui,
  });

  await evento(ctx, "relatorio", "Relatório da Sessão preenchido", DATAS.relatorio);
  await evento(ctx, "diagnostico", "Diagnóstico da SV montado", DATAS.relatorio);
  await evento(ctx, "documento", "Documentos pedidos ao cliente", DATAS.documentos_pedidos);
  ctx.registrar("sessao_realizada · relatório, diagnóstico, material aprovado, radar, tarefa do croqui");
}

async function materialAprovado(ctx: Contexto): Promise<void> {
  const { data: modelo } = await ctx.db
    .from("materiais_modelos")
    .select("id")
    .eq("chave", "empresa")
    .eq("ativo", true)
    .order("versao", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: qualquer } = modelo
    ? { data: modelo }
    : await ctx.db.from("materiais_modelos").select("id").eq("ativo", true).limit(1).maybeSingle();
  if (!qualquer) throw new ErroSeed("Nenhum modelo de material ativo — o mock não cria modelo novo.");

  await acharOuCriar(ctx.db, "materiais_gerados", { jornada_id: ctx.jornadaId, versao: 1 }, {
    modelo_id: (qualquer as { id: string }).id,
    execucao_id: null,
    dor_principal: "Que a empresa pare se eu faltar, e que os três filhos briguem por causa dela.",
    fonte_dor: "ligacao",
    conteudo: CONTEUDO_MATERIAL,

    origem_dado: "exemplo",
    aprovado_por: ctx.perfilId,
    aprovado_em: DATAS.material,
    atual: true,
    criado_em: DATAS.material,
  });
  await linkPublico(ctx, "material", 400);
  await evento(ctx, "mensagem", "Material pós-sessão aprovado e enviado", DATAS.material);
}

async function radarDeDocumentos(ctx: Contexto, conferir: boolean): Promise<void> {
  const familiares = await ctx.db
    .from("familiares")
    .select("id, parentesco")
    .eq("pessoa_id", ctx.pessoaId)
    .eq("ativo", true);
  const bens = await ctx.db
    .from("patrimonio_itens")
    .select("id, tipo")
    .eq("pessoa_id", ctx.pessoaId)
    .eq("ativo", true);

  const itens: Array<{ chave: string; item_ref: string | null; tipo: string }> = [
    { chave: chaveItemRadar("coleta", "imposto_renda", null), item_ref: null, tipo: "imposto_renda" },
    { chave: chaveItemRadar("coleta", "comprovante_residencia", null), item_ref: null, tipo: "comprovante_residencia" },
  ];
  for (const f of ((familiares.data as Array<{ id: string; parentesco: string }> | null) ?? [])) {
    if (f.parentesco.startsWith("conjuge")) {
      itens.push({ chave: chaveItemRadar("coleta", "imposto_renda", f.id), item_ref: f.id, tipo: "imposto_renda" });
      itens.push({ chave: chaveItemRadar("coleta", "certidao_casamento", f.id), item_ref: f.id, tipo: "certidao_casamento" });
    } else if (f.parentesco.startsWith("filho")) {
      itens.push({ chave: chaveItemRadar("coleta", "certidao_nascimento", f.id), item_ref: f.id, tipo: "certidao_nascimento" });
    }
  }
  for (const b of ((bens.data as Array<{ id: string; tipo: string }> | null) ?? [])) {
    if (b.tipo === "imovel") itens.push({ chave: chaveItemRadar("coleta", "matricula_imovel", b.id), item_ref: b.id, tipo: "matricula_imovel" });
    if (b.tipo === "empresa") itens.push({ chave: chaveItemRadar("coleta", "contrato_social", b.id), item_ref: b.id, tipo: "contrato_social" });
    if (b.tipo === "veiculo") itens.push({ chave: chaveItemRadar("coleta", "crlv", b.id), item_ref: b.id, tipo: "crlv" });
    if (b.tipo === "investimento") itens.push({ chave: chaveItemRadar("coleta", "extrato_investimento", b.id), item_ref: b.id, tipo: "extrato_investimento" });
  }

  for (const item of itens) {
    await acharOuCriar(ctx.db, "documentos_pedidos", { jornada_id: ctx.jornadaId, chave: item.chave }, {
      item_ref: item.item_ref,
      tipo: item.tipo,
      pedido_em: DATAS.documentos_pedidos,
      pedido_por: ctx.perfilId,
      criado_em: DATAS.documentos_pedidos,
    });
  }
  if (conferir) {
    await ctx.db
      .from("documentos_pedidos")
      .update({ conferido_em: DATAS.documentos_conferidos, conferido_por: ctx.perfilId })
      .eq("jornada_id", ctx.jornadaId)
      .is("conferido_em", null);
  }
  await linkPublico(ctx, "documentos", 400);
}

// --- croqui_contratado -----------------------------------------------------

const SLIDES_CROQUI = [
  ["legado", "O que você quer proteger", "Abrir pela frase dele: quatro anos de inventário do pai."],
  ["controle", "Quem decide, e até quando", "Controle permanece com o fundador enquanto ele quiser."],
  ["familia", "A família hoje", "Três filhos, um menor. Cônjuge decide junto."],
  ["patrimonio", "O que existe hoje", "Nove bens ativos, com valor de DIRPF e de mercado."],
  ["risco", "O custo de não fazer nada", "Inventário com a operação dentro do espólio."],
  ["alternativas", "Os caminhos possíveis", "Inventário · doação · 1, 2 e 3 células."],
  ["celula_1", "Uma célula", "Mais simples de montar, menos separação de funções."],
  ["celula_2", "Duas células", "Separa destino e veículo; usa domicílio fiscal vantajoso."],
  ["celula_3", "Três células", "Separa destino, veículo e cofre. Menos horas de trabalho."],
  ["controle_arquitetura", "Por que esta arquitetura", "Empresa operacional relevante + três núcleos futuros."],
  ["economia", "A diferença em número", "Comparativo geral e ITBI — leitura direto do motor."],
  ["implementacao", "Como se faz", "19 marcos, do contrato à entrega à família."],
  ["investimento", "O investimento", "Honorários, deduções, sinal e parcelamento."],
].map(([tipo, titulo, objetivo], i) => ({
  id: `slide-${i + 1}`,
  ordem: i + 1,
  tipo,
  titulo,
  objetivo,
  pergunta_ao_cliente: null,
  conteudo: { origem: "exemplo", nota: "Slide de demonstração. Os números vêm do cálculo do motor, não deste texto." },
  revisado: true,
}));

const NARRATIVA_EXEMPLO = {
  como_apresentar: [
    { tabela: "composicao_familiar", texto: "Comece pela família: três filhos, um menor, cônjuge que decide junto. É o que define a arquitetura." },
    { tabela: "inventario_atual", texto: "Este é o custo da inércia. Leia devagar e pare no total — ele pediu número, não conceito." },
    { tabela: "comparativo_geral", texto: "Ponha os cinco caminhos lado a lado. Deixe ele mesmo apontar a diferença." },
    { tabela: "itbi", texto: "Explique que a imunidade de ITBI é requerimento, não automatismo — e que o croqui já prevê o recurso." },
    { tabela: "payback", texto: "Feche com o tempo de retorno. Ele é empresário; pensa em prazo." },
  ],
  arquitetura: {
    recomendacao: "celula_3",
    justificativa:
      "Empresa operacional relevante, imóvel de renda, imóvel usado pela própria operação e três núcleos familiares futuros com níveis diferentes de participação. Separar destino, veículo e cofre é o que permite dar regra diferente a cada filho sem parar a operação.",
    criterios: [
      { criterio: "quantidade_de_nucleos_familiares", resposta: "Três filhos, três núcleos futuros." },
      { criterio: "empresa_operacional_relevante", resposta: "Distribuidora com 80% das quotas dele; é a renda da família." },
      { criterio: "imoveis_de_renda", resposta: "Uma sala comercial locada, com aluguel mensal declarado." },
      { criterio: "patrimonio_pessoal_relevante", resposta: "Quatro imóveis, carteira de renda fixa e previdência." },
      { criterio: "concentracao_em_empresa", resposta: "A operação é a maior parcela do patrimônio de mercado." },
      { criterio: "niveis_diferentes_de_participacao_dos_herdeiros", resposta: "O filho mais velho já trabalha na empresa; os outros dois, não." },
      { criterio: "fundador_deseja_permanecer_no_controle", resposta: "Declarado na sessão: quer manter o controle enquanto viver." },
      { criterio: "necessidade_de_separar_patrimonio_gestao_e_destino", resposta: "Sim — imóvel de uso da operação misturado com patrimônio pessoal." },
      { criterio: "beneficio_justifica_a_complexidade", resposta: "Sim; o comparativo geral mostra a diferença contra o inventário." },
    ],
  },
  perguntas: [
    { pergunta: "Se a operação parasse por seis meses, a família consegue se manter?", motivo: "Traz o risco de bloqueio para o concreto, sem discurso." },
    { pergunta: "Você já conversou com o Pedro sobre ele assumir a operação?", motivo: "Testa se a sucessão de gestão está combinada ou só suposta." },
    { pergunta: "A Marina participa das decisões da empresa hoje?", motivo: "Ela decide junto; precisa estar na apresentação." },
  ],
  objecoes: [
    { objecao: "Meu contador disse que dá para fazer mais barato.", resposta_recomendada: "Mostrar a tabela de horas por ato: o preço é hora de trabalho, e o comparativo mostra o que se evita." },
    { objecao: "Por que três células e não uma?", resposta_recomendada: "Ir ao critério de níveis diferentes de participação: uma célula não permite regra diferente por filho." },
  ],
  fechamento:
    "João, você me disse que levou quatro anos para resolver o inventário do seu pai. O que está nesta mesa é a decisão de não repetir isso — e o número que você pediu está na tabela do comparativo.",
  grau_confianca: 82,
  lacunas: [
    "Valor de mercado das quotas é estimativa declarada, não avaliação.",
    "Alíquotas de ITCMD/ITBI e tabela de cartório desta demonstração são EXEMPLO, não a lei vigente.",
  ],
};

async function blocoCroquiContratado(ctx: Contexto): Promise<void> {
  await pagamento(ctx, "CROQUI", "croqui_estrutural", 4500, DATAS.pagamento_croqui);
  await evento(ctx, "pagamento", "Croqui Estrutural pago", DATAS.pagamento_croqui, "R$ 4.500,00 (com incentivo)");
  await radarDeDocumentos(ctx, true);
  await evento(ctx, "documento", "Documentos conferidos", DATAS.documentos_conferidos);

  const { linha: croqui } = await acharOuCriar<{ id: string; status: string }>(
    ctx.db,
    "croquis",
    { jornada_id: ctx.jornadaId, versao: 1 },
    {
      id: ID.croqui,
      titulo: "Croqui Estrutural — Família Assunção (exemplo)",
      status: "rascunho",
      conteudo: { slides: SLIDES_CROQUI },
      criado_por: ctx.perfilId,
      criado_em: DATAS.croqui_calculado,
    },
  );
  ctx.manifesto.croqui_id = croqui.id;

  await calcularCroquiDeVerdade(ctx, croqui.id);
  await narrativaDoCroqui(ctx, croqui.id);
  await ctx.db.from("croquis").update({ status: "pronto" }).eq("id", croqui.id).eq("status", "rascunho");
  await evento(ctx, "croqui", "Croqui pronto", DATAS.croqui_calculado, undefined, { croqui_id: croqui.id, status: "pronto" });
  ctx.registrar("croqui_contratado · pagamento, documentos conferidos, croqui calculado pelo motor + narrativa");
}

/**
 * O croqui é calculado pelo MOTOR e gravado por `registrarCalculo` — o mesmo
 * caminho de `POST /api/jornadas/[id]/croqui-calculo`. Se sobrar parâmetro
 * ausente, `registrarCalculo` devolve 409 e o script PARA: croqui que não
 * fecha não vira mock silencioso.
 */
async function calcularCroquiDeVerdade(ctx: Contexto, croquiId: string): Promise<void> {
  const { data: ja } = await ctx.db
    .from("croqui_calculos")
    .select("id")
    .eq("jornada_id", ctx.jornadaId)
    .eq("atual", true)
    .maybeSingle();
  if (ja) {
    ctx.manifesto.croqui_calculo_id = (ja as { id: string }).id;
    return;
  }

  const previa = await calcularParaJornada(ctx.db, ctx.jornadaId);
  if (previa.ausentes.length > 0) {
    throw new ErroSeed(
      `O motor ainda vê ${previa.ausentes.length} parâmetro(s) ausente(s): ` +
        previa.ausentes.map((a) => `${a.chave}${a.uf ? `/${a.uf}` : ""}${a.municipio ? `/${a.municipio}` : ""}`).join(", "),
    );
  }

  const calculo = await registrarCalculo(ctx.db, ctx.jornadaId, {
    croqui_id: croquiId,
    nota: "Cálculo da jornada de exemplo — parâmetros rotulados como EXEMPLO.",
    criadoPor: ctx.perfilId,
  });
  ctx.manifesto.croqui_calculo_id = calculo.id;

  // Versão fixada explicitamente: é o caminho que a gaveta de versões usa.
  const { error } = await ctx.db.rpc("fixar_croqui_calculo", { p_id: calculo.id, p_criado_por: ctx.perfilId });
  if (error) throw new ErroSeed(`fixar_croqui_calculo: ${error.code ?? ""} ${error.message}`);

  const faltas = (calculo.resultado as { faltas?: unknown[] } | null)?.faltas ?? [];
  const tabelas = Object.keys((calculo.resultado as { tabelas?: Record<string, unknown> } | null)?.tabelas ?? {});
  ctx.registrar(`croqui calculado: ${tabelas.length} tabelas · ${faltas.length} falta(s) agregada(s) · versão ${calculo.versao} fixada`);
}

/**
 * A narrativa é conteúdo de exemplo escrito à mão — o prompt
 * `agente_croqui_narrativa` está INATIVO e nenhuma chamada de IA é feita aqui.
 * A execução em `execucoes_ia` nasce com `modo='demonstracao'`, que é o que faz
 * a RPC carimbar `origem_dado='exemplo'` na narrativa.
 */
async function narrativaDoCroqui(ctx: Contexto, croquiId: string): Promise<void> {
  const { data: ja } = await ctx.db
    .from("croqui_narrativas")
    .select("id")
    .eq("croqui_id", croquiId)
    .eq("atual", true)
    .maybeSingle();
  if (ja) return;

  const { data: prompt } = await ctx.db
    .from("prompts_versoes")
    .select("id, modelo_padrao")
    .eq("chave", "agente_croqui_narrativa")
    .order("versao", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!prompt) {
    ctx.registrar("narrativa PULADA: prompt `agente_croqui_narrativa` não existe neste banco (0066 não aplicada?)");
    return;
  }

  const { linha: execucao } = await acharOuCriar<{ id: string }>(
    ctx.db,
    "execucoes_ia",
    { jornada_id: ctx.jornadaId, hash_entrada: `${MARCA}-narrativa` },
    {
      prompt_versao_id: (prompt as { id: string }).id,
      modelo: (prompt as { modelo_padrao: string }).modelo_padrao,
      status: "concluida",
      modo: "demonstracao",
      tokens_entrada: 0,
      tokens_saida: 0,
      custo_usd: 0,
      latencia_ms: 0,
      criado_por: ctx.perfilId,
      criado_em: DATAS.narrativa,
      concluido_em: DATAS.narrativa,
    },
  );

  const { error } = await ctx.db.rpc("registrar_croqui_narrativa", {
    p_croqui_id: croquiId,
    p_execucao_id: execucao.id,
    p_conteudo: NARRATIVA_EXEMPLO,
    p_grau_confianca: NARRATIVA_EXEMPLO.grau_confianca,
    p_schema_versao: 3,
    p_criado_por: ctx.perfilId,
  });
  if (error) throw new ErroSeed(`registrar_croqui_narrativa: ${error.code ?? ""} ${error.message}`);
}

// --- croqui_apresentado ----------------------------------------------------

async function blocoCroquiApresentado(ctx: Contexto): Promise<void> {
  const croquiId = ctx.manifesto.croqui_id;
  if (!croquiId) throw new ErroSeed("croqui_id ausente no manifesto — rode a etapa croqui_contratado antes.");

  const encerrada = new Date(new Date(DATAS.apresentacao).getTime() + 78 * 60 * 1000).toISOString();
  await acharOuCriar(ctx.db, "croqui_apresentacoes", { croqui_id: croquiId, iniciada_em: DATAS.apresentacao }, {
    encerrada_em: encerrada,
    slides_vistos: SLIDES_CROQUI.length,
    apresentador_id: ctx.perfilId,
  });
  await ctx.db.from("croquis").update({ status: "apresentado" }).eq("id", croquiId).neq("status", "apresentado");

  await evento(ctx, "croqui", "Croqui apresentado", DATAS.apresentacao, "78 min · 13 slides · cliente e cônjuge presentes", {
    croqui_id: croquiId,
    status: "apresentado",
  });
  await evento(ctx, "croqui_exportacao", "Relatório do Croqui exportado (.docx)", DATAS.exportacao, undefined, {
    croqui_id: croquiId,
    destino: "download",
  });
  ctx.registrar("croqui_apresentado · apresentação iniciada e encerrada, relatório exportado");
}

// --- holding_contratada ----------------------------------------------------

async function blocoHoldingContratada(ctx: Contexto): Promise<void> {
  await pagamento(ctx, "HOLDING", "holding", 63_000, DATAS.pagamento_holding);
  await evento(ctx, "pagamento", "Holding contratada", DATAS.pagamento_holding);

  const { data: marcos, error } = await ctx.db
    .from("execucao_marcos")
    .select("id, ordem, rotulo")
    .order("ordem", { ascending: true });
  if (error) throw new ErroSeed(`execucao_marcos: ${error.message}`);
  const lista = (marcos as Array<{ id: string; ordem: number; rotulo: string }> | null) ?? [];
  if (lista.length === 0) throw new ErroSeed("Nenhum marco em execucao_marcos — a 0067 não foi aplicada.");

  const passo = (DATAS.execucao_inicio - 1) / Math.max(1, lista.length - 1);
  for (const [i, marco] of lista.entries()) {
    const { count } = await ctx.db
      .from("execucao_jornada_marcos")
      .select("*", { count: "exact", head: true })
      .eq("jornada_id", ctx.jornadaId)
      .eq("marco_id", marco.id);
    if ((count ?? 0) > 0) continue;
    await inserir(ctx.db, "execucao_jornada_marcos", {
      jornada_id: ctx.jornadaId,
      marco_id: marco.id,
      concluido_em: quando(Math.round(DATAS.execucao_inicio - i * passo)),
      concluido_por: ctx.perfilId,
      nota: i === lista.length - 1 ? "Sistema entregue à família (exemplo)." : null,
    });
  }
  await evento(ctx, "execucao", "Execução concluída", DATAS.holding, `${lista.length} marcos concluídos`);
  ctx.registrar(`holding_contratada · pagamento + ${lista.length} marcos de execução concluídos`);
}

// ---------------------------------------------------------------------------
// Etapa da jornada — move o estado respeitando a máquina de estados
// ---------------------------------------------------------------------------

async function moverAte(ctx: Contexto, alvo: Etapa): Promise<void> {
  const { data } = await ctx.db.from("jornadas").select("etapa, desfecho, nivel_pago").eq("id", ctx.jornadaId).single();
  const atual = (data as { etapa: Etapa; desfecho: string }).etapa;
  if (atual === alvo) {
    await atualizar(ctx.db, "jornadas", { id: ctx.jornadaId }, { nivel_pago: NIVEL_PAGO[alvo] });
    return;
  }
  // Regressão NÃO é erro aqui: o laço de blocos chama esta função uma vez por
  // etapa, de `captado` em diante, e a jornada pode já estar adiante (rodada
  // anterior, ou uma etapa que o próprio pagamento avançou pela RPC). O
  // rebobinar de verdade acontece uma vez só, no começo de `main`, apagando e
  // recriando a pessoa — a máquina de estados da 0004 não deixa etapa voltar.
  if (ordemDa(alvo) < ordemDa(atual)) return;
  // Sobe uma etapa por vez: `transicoes_permitidas` só admite passos adjacentes.
  for (let i = ordemDa(atual) + 1; i <= ordemDa(alvo); i += 1) {
    const proxima = ETAPAS[i];
    await atualizar(ctx.db, "jornadas", { id: ctx.jornadaId }, {
      nivel_pago: NIVEL_PAGO[proxima],
      etapa: proxima,
      ...(proxima === "holding_contratada" ? { desfecho: "ganha", motivo_desfecho: "Holding contratada" } : {}),
    });
  }
}

/** Backdata as transições e os eventos que os triggers gravaram com `now()`. */
const DATA_DA_ETAPA: Record<Etapa, string> = {
  captado: DATAS.captado,
  qualificado: DATAS.qualificado,
  sessao_contratada: DATAS.pagamento_sv,
  sessao_agendada: DATAS.agendou,
  sessao_realizada: DATAS.sessao_realizada,
  croqui_contratado: DATAS.pagamento_croqui,
  croqui_apresentado: DATAS.apresentacao,
  holding_contratada: DATAS.holding,
};

/**
 * Retroage o que os gatilhos escreveram com `now()`.
 *
 * Sem isto a jornada de 90 dias aparece inteira como "hoje": a Pasta, o trilho
 * e a linha do tempo passam a mentir sobre a ORDEM dos fatos, que é a única
 * coisa que a tela do cliente serve para responder. O recorte é `ocorrido_em >
 * hoje 00:00` — evento antigo legítimo não é tocado.
 */
async function ajustarCronologia(ctx: Contexto): Promise<void> {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const corte = hoje.toISOString();

  // (1) transições de etapa
  const { data: transicoes } = await ctx.db
    .from("jornadas_transicoes")
    .select("id, para_etapa")
    .eq("jornada_id", ctx.jornadaId);
  for (const t of ((transicoes as Array<{ id: string; para_etapa: Etapa | null }> | null) ?? [])) {
    if (!t.para_etapa) continue;
    await ctx.db
      .from("jornadas_transicoes")
      .update({ ocorrido_em: DATA_DA_ETAPA[t.para_etapa], ator_perfil_id: ctx.perfilId })
      .eq("id", t.id);
  }

  // (2) marcos de execução: cada evento na data em que o marco foi concluído
  const { data: marcos } = await ctx.db
    .from("execucao_jornada_marcos")
    .select("marco_id, concluido_em")
    .eq("jornada_id", ctx.jornadaId);
  const dataDoMarco = new Map(
    ((marcos as Array<{ marco_id: string; concluido_em: string }> | null) ?? []).map((m) => [m.marco_id, m.concluido_em]),
  );

  // (3) pagamentos: cada evento na data do seu
  const { data: pags } = await ctx.db
    .from("pagamentos")
    .select("id, pago_em")
    .eq("jornada_id", ctx.jornadaId);
  const dataDoPagamento = new Map(
    ((pags as Array<{ id: string; pago_em: string | null }> | null) ?? []).map((p) => [p.id, p.pago_em]),
  );

  // (4) o resto, por tipo (e por título quando o mesmo tipo cobre dois fatos)
  const { data: eventos } = await ctx.db
    .from("eventos_timeline")
    .select("id, tipo, titulo, dados")
    .eq("jornada_id", ctx.jornadaId)
    .gt("ocorrido_em", corte);

  const porTipo: Record<string, string> = {
    etapa: DATAS.captado,
    familia: DATAS.qualificado,
    patrimonio: DATAS.qualificado,
    formulario: DATAS.formulario,
    ligacao: DATAS.contato_equipe,
    mensagem: DATAS.boas_vindas,
    relatorio: DATAS.relatorio,
    diagnostico: DATAS.relatorio,
    documento: DATAS.documentos_pedidos,
    documento_pedido: DATAS.documentos_pedidos,
    croqui: DATAS.croqui_calculado,
    croqui_calculo: DATAS.croqui_calculado,
    croqui_narrativa: DATAS.narrativa,
    croqui_exportacao: DATAS.exportacao,
    agendamento: DATAS.agendou,
    execucao: DATAS.holding,
    pagamento: DATAS.pagamento_sv,
  };

  type Evento = { id: string; tipo: string; titulo: string; dados: Record<string, unknown> | null };
  for (const e of ((eventos as Evento[] | null) ?? [])) {
    let quandoEvento = porTipo[e.tipo] ?? DATAS.captado;

    if (e.tipo === "etapa") {
      // "Etapa: X → Y" e "Desfecho: ganha"
      const destino = ETAPAS.find((et) => e.titulo.endsWith(et));
      if (destino) quandoEvento = DATA_DA_ETAPA[destino];
      else if (e.titulo.startsWith("Desfecho")) quandoEvento = DATAS.holding;
    } else if (e.tipo === "agendamento") {
      quandoEvento = e.titulo.includes("realizado") ? DATAS.sessao_realizada : DATAS.agendou;
    } else if (e.tipo === "documento_pedido") {
      quandoEvento = e.titulo.includes("conferido") ? DATAS.documentos_conferidos : DATAS.documentos_pedidos;
    } else if (e.tipo === "croqui") {
      quandoEvento = e.titulo.includes("apresentado") ? DATAS.apresentacao : DATAS.croqui_calculado;
    } else if (e.tipo === "execucao") {
      const marcoId = e.dados?.marco_id;
      quandoEvento = (typeof marcoId === "string" ? dataDoMarco.get(marcoId) : null) ?? DATAS.holding;
    } else if (e.tipo === "pagamento") {
      const pagamentoId = e.dados?.pagamento_id;
      quandoEvento =
        (typeof pagamentoId === "string" ? dataDoPagamento.get(pagamentoId) : null) ?? DATAS.pagamento_sv;
    }

    await ctx.db.from("eventos_timeline").update({ ocorrido_em: quandoEvento }).eq("id", e.id);
  }
}

// ---------------------------------------------------------------------------
// Parâmetros e configurações
// ---------------------------------------------------------------------------

async function cadastrarParametros(ctx: Contexto): Promise<void> {
  const criados: string[] = [];
  for (const p of PARAMETROS_EXEMPLO) {
    let q = ctx.db.from("parametros_metodo").select("id").eq("chave", p.chave).eq("ativo", true);
    q = p.uf ? q.eq("uf", p.uf) : q.is("uf", null);
    q = p.municipio ? q.eq("municipio", p.municipio) : q.is("municipio", null);
    const { data } = await q.maybeSingle();
    if (data) continue;

    const linha = await inserir<{ id: string }>(ctx.db, "parametros_metodo", {
      chave: p.chave,
      valor: p.unidade === "faixas" ? null : p.valor,
      faixas: p.unidade === "faixas" ? p.faixas : null,
      unidade: p.unidade,
      uf: p.uf ?? null,
      municipio: p.municipio ?? null,
      base_legal: `${ROTULO_EXEMPLO} — usado em ${p.porque}.`,
      ativo: true,
      ativado_em: new Date().toISOString(),
      ativado_por: ctx.perfilId,
      criado_por: ctx.perfilId,
      notas: `${NOTA_EXEMPLO} Usado em ${p.porque}.`,
    });
    criados.push(linha.id);
  }
  ctx.manifesto.parametros_ids = [...new Set([...ctx.manifesto.parametros_ids, ...criados])];
  ctx.registrar(`parâmetros do método: ${criados.length} cadastrado(s) como EXEMPLO (${PARAMETROS_EXEMPLO.length - criados.length} já existiam)`);
}

async function ajustarConfiguracoes(ctx: Contexto): Promise<void> {
  const alvos: Array<[string, unknown]> = [
    ["croqui.horas_por_ato", HORAS_POR_ATO],
    ["croqui.uf_domicilio_vantajoso", UF_VANTAJOSA],
  ];
  for (const [chave, valor] of alvos) {
    const { data } = await ctx.db.from("configuracoes").select("valor").eq("chave", chave).maybeSingle();
    const anterior = (data as { valor: unknown } | null)?.valor ?? null;
    const vazia =
      anterior === null ||
      anterior === "" ||
      (Array.isArray(anterior) && anterior.length === 0) ||
      (typeof anterior === "object" && anterior !== null && Object.keys(anterior).length === 0);
    if (!vazia) {
      ctx.registrar(`configuracoes['${chave}'] já tem valor real — NÃO tocada.`);
      continue;
    }
    if (!(chave in ctx.manifesto.configuracoes_anteriores)) {
      ctx.manifesto.configuracoes_anteriores[chave] = anterior;
    }
    await atualizar(ctx.db, "configuracoes", { chave }, { valor });
    ctx.registrar(`configuracoes['${chave}'] preenchida (anterior guardado no manifesto)`);
  }
}

// ---------------------------------------------------------------------------
// Limpeza
// ---------------------------------------------------------------------------

/** Apaga só as camadas ACIMA da etapa alvo — é o que permite rebobinar. */
async function limparAcimaDe(ctx: Contexto, alvo: Etapa): Promise<void> {
  const db = ctx.db;
  const j = ctx.jornadaId;
  const croquiIds = await ids(db, "croquis", "id", { jornada_id: j });

  if (ordemDa(alvo) < ordemDa("holding_contratada")) {
    await apagar(db, "execucao_jornada_marcos", { jornada_id: j });
    await apagar(db, "pagamentos", { origem: "exemplo", transacao_externa_id: `${MARCA}-HOLDING` });
    await apagar(db, "webhooks_eventos", { origem: "exemplo", evento_externo_id: `${MARCA}-HOLDING` });
  }
  if (ordemDa(alvo) < ordemDa("croqui_apresentado") && croquiIds.length) {
    await apagar(db, "croqui_apresentacoes", { croqui_id: croquiIds });
    await apagar(db, "eventos_timeline", { jornada_id: j, tipo: "croqui_exportacao" });
    await atualizar(db, "croquis", { jornada_id: j }, { status: "pronto" });
  }
  if (ordemDa(alvo) < ordemDa("croqui_contratado")) {
    if (croquiIds.length) await apagar(db, "croqui_narrativas", { croqui_id: croquiIds });
    await apagar(db, "croqui_calculos", { jornada_id: j });
    await apagar(db, "execucoes_ia", { jornada_id: j });
    await apagar(db, "croquis", { jornada_id: j });
    await apagar(db, "pagamentos", { origem: "exemplo", transacao_externa_id: `${MARCA}-CROQUI` });
    await apagar(db, "webhooks_eventos", { origem: "exemplo", evento_externo_id: `${MARCA}-CROQUI` });
    ctx.manifesto.croqui_id = null;
    ctx.manifesto.croqui_calculo_id = null;
  }
  if (ordemDa(alvo) < ordemDa("sessao_realizada")) {
    await apagar(db, "diagnosticos_sv", { jornada_id: j });
    await apagar(db, "materiais_gerados", { jornada_id: j });
    await apagar(db, "documentos_pedidos", { jornada_id: j });
    await apagar(db, "tarefas", { jornada_id: j });
    const sessaoIds = await ids(db, "sessoes_viabilidade", "id", { jornada_id: j });
    if (sessaoIds.length) {
      await apagar(db, "relatorios_sessao", { sessao_id: sessaoIds });
      await atualizar(db, "sessoes_viabilidade", { jornada_id: j }, { realizada_em: null, resultado: null, motivo_resultado: null });
    }
  }
  if (ordemDa(alvo) < ordemDa("sessao_agendada")) {
    const sessaoIds = await ids(db, "sessoes_viabilidade", "id", { jornada_id: j });
    if (sessaoIds.length) await apagar(db, "agendamentos", { sessao_id: sessaoIds });
    await apagar(db, "sessoes_viabilidade", { jornada_id: j });
  }
  if (ordemDa(alvo) < ordemDa("sessao_contratada")) {
    await apagar(db, "ligacoes_estrategicas", { jornada_id: j });
    await apagar(db, "pagamentos", { origem: "exemplo", transacao_externa_id: `${MARCA}-SV` });
    await apagar(db, "webhooks_eventos", { origem: "exemplo", evento_externo_id: `${MARCA}-SV` });
  }
  if (ordemDa(alvo) < ordemDa("qualificado")) {
    await apagar(db, "formularios_respostas", { jornada_id: j });
  }
}

async function limparTudo(db: Cliente, manifesto: Manifesto, registrar: (s: string) => void): Promise<void> {
  // Limpa TODO dado de exemplo, não só o do João: é o mesmo recorte que o seed
  // usa para abrir espaço (ordem do dono do produto) e o mesmo do limpar-joao.sql.
  const pessoaIds = await ids(db, "pessoas", "id", { origem_dado: "exemplo" });
  registrar(`PRÉ: ${pessoaIds.length} pessoa(s) origem_dado='exemplo' no banco`);
  const conta = await apagarPessoas(db, pessoaIds);
  // Jornada de exemplo pendurada em pessoa `real` (fixture de QA).
  const orfas = await ids(db, "jornadas", "id", { origem_dado: "exemplo" });
  if (orfas.length > 0) {
    registrar(`  ${orfas.length} jornada(s) de exemplo órfã(s) (pessoa origem_dado='real')`);
    for (const [t, n] of Object.entries(await apagarJornadas(db, orfas))) conta[t] = (conta[t] ?? 0) + n;
  }

  const marcados = [`${MARCA}-SV`, `${MARCA}-CROQUI`, `${MARCA}-HOLDING`];
  const nPag = await apagar(db, "pagamentos", { origem: "exemplo", transacao_externa_id: marcados });
  const nWh = await apagar(db, "webhooks_eventos", { origem: "exemplo", evento_externo_id: marcados });
  if (nPag) conta.pagamentos = (conta.pagamentos ?? 0) + nPag;
  if (nWh) conta.webhooks_eventos = (conta.webhooks_eventos ?? 0) + nWh;

  if (manifesto.parametros_ids.length > 0) {
    conta.parametros_metodo = await apagar(db, "parametros_metodo", { id: manifesto.parametros_ids });
  }
  for (const [chave, anterior] of Object.entries(manifesto.configuracoes_anteriores)) {
    // LIMITAÇÃO do PostgREST: `{"valor": null}` vira SQL NULL, não o jsonb
    // `null` que estava lá — e `configuracoes.valor` é NOT NULL. Não dá para
    // restaurar isso por aqui. Em vez de falhar em silêncio (ou de inventar um
    // "" que o motor leria como UF vazia), o script deixa o SQL de uma linha.
    if (anterior === null) {
      registrar(
        `configuracoes['${chave}'] NÃO restaurada: o valor anterior era o jsonb null, que o PostgREST não escreve.
` +
          `    Rode como postgres:  update configuracoes set valor = 'null'::jsonb where chave = '${chave}';`,
      );
      continue;
    }
    const { error } = await db.from("configuracoes").update({ valor: anterior }).eq("chave", chave);
    if (error) throw new ErroSeed(`restaurar configuracoes['${chave}']: ${error.message}`);
    registrar(`configuracoes['${chave}'] restaurada para o valor anterior`);
  }
  // Edições de exemplo que ficaram sem ninguém.
  for (const edicaoId of await ids(db, "edicoes_seminario", "id", { origem_dado: "exemplo" })) {
    const usos =
      (await contar(db, "participacoes_seminario", { edicao_id: edicaoId })) +
      (await contar(db, "jornadas", { edicao_id: edicaoId })) +
      (await contar(db, "respostas_seminario", { edicao_id: edicaoId }));
    if (usos === 0) conta.edicoes_seminario = (conta.edicoes_seminario ?? 0) + (await apagar(db, "edicoes_seminario", { id: edicaoId }));
  }

  const total = Object.values(conta).reduce((a, b) => a + b, 0);
  for (const [t, n] of Object.entries(conta).sort()) registrar(`  − ${t}: ${n}`);
  registrar(`TOTAL removido: ${total} linha(s)`);
  if (fs.existsSync(CAMINHO_MANIFESTO)) fs.rmSync(CAMINHO_MANIFESTO);
}

/**
 * Apaga TODA pessoa/jornada `origem_dado='exemplo'` que NÃO é a do João —
 * ordem direta do dono do produto (05/09). Irreversível: o inventário PRÉ vai
 * para o manifesto ANTES do primeiro DELETE. Nada com `origem_dado='real'`,
 * nada em `perfis_equipe`, nada em `parametros_metodo`/`configuracoes` reais.
 */
async function apagarOutrosExemplos(db: Cliente, manterPessoaId: string | null, manifesto: Manifesto, registrar: (s: string) => void): Promise<void> {
  const todas = await ids(db, "pessoas", "id", { origem_dado: "exemplo" });
  // As 4 famílias de demonstração (scripts/seed-demo.ts) sobrevivem a esta
  // varredura DE PROPÓSITO: elas são o kanban que o João vai apresentar, e
  // "rodar o seed da minha jornada apagou a apresentação" é exatamente o tipo
  // de perda silenciosa que esta base não aceita. Quem quer removê-las tem um
  // comando que diz isso: `--demo --limpar`.
  const demoVivas = todas.filter((id) => IDS_PESSOAS_DEMO.includes(id));
  const alvo = todas.filter((id) => id !== manterPessoaId && !IDS_PESSOAS_DEMO.includes(id));
  if (demoVivas.length > 0) {
    registrar(
      `${demoVivas.length} pessoa(s) de DEMONSTRAÇÃO preservada(s) — remova com: npx tsx scripts/seed-demo.ts --limpar`,
    );
  }
  const jornadasDemo = await ids(db, "jornadas", "id", { pessoa_id: demoVivas });
  const jornadasSoltas = (await ids(db, "jornadas", "id", { origem_dado: "exemplo" })).filter(
    (id) => !jornadasDemo.includes(id),
  );

  const pre: Record<string, number> = {
    pessoas_exemplo: todas.length,
    pessoas_a_apagar: alvo.length,
    jornadas_exemplo: jornadasSoltas.length,
  };
  manifesto.apagados_outros_exemplos = pre;
  gravarManifesto(manifesto);
  registrar(`PRÉ: ${todas.length} pessoa(s) de exemplo no banco · ${alvo.length} serão apagadas · ${jornadasSoltas.length} jornada(s) de exemplo`);

  if (alvo.length === 0) {
    registrar("Nada a apagar — nenhuma outra pessoa de exemplo.");
    return;
  }
  const conta = await apagarPessoas(db, alvo);
  // Jornadas de exemplo penduradas em pessoa `real` (a "(exemplo)" de QA).
  const orfas = (await ids(db, "jornadas", "id", { origem_dado: "exemplo" })).filter(
    (id) => id !== manifesto.jornada_id && !jornadasDemo.includes(id),
  );
  Object.assign(conta, await apagarJornadas(db, orfas));

  manifesto.apagados_outros_exemplos = { ...pre, ...conta };
  for (const [t, n] of Object.entries(conta).sort()) registrar(`  − ${t}: ${n}`);
}

// ---------------------------------------------------------------------------
// Gerador de SQL (`--sql`) — o mesmo mock, sem `service_role`
//
// O orquestrador roda SQL como `postgres` pelo MCP do Supabase: ignora RLS e
// executa qualquer RPC. Este modo emite UM arquivo transacional
// (`begin; … commit;`) com tudo o que o modo supabase-js faria.
//
// Três coisas que este gerador NÃO faz por atalho:
//
//  1. **Não duplica a fonte de dados.** Família, patrimônio, respostas,
//     parâmetros, horas por ato, slides, narrativa e blocos do diagnóstico são
//     as MESMAS constantes que o modo supabase-js usa. Um emissor diferente,
//     um dado só.
//  2. **Não inventa o cálculo do croqui.** `calcularCroqui` roda aqui, com a
//     entrada montada por `montarEntrada` (o de produção) e os parâmetros
//     lidos do banco + os que o próprio arquivo cadastra. O JSON vai embutido
//     em `registrar_croqui_calculo`, que é exatamente o que
//     `registrarCalculo()` mandaria pelo `service_role`. Se sobrar parâmetro
//     ausente, o gerador PARA.
//  3. **Não deixa a timeline mentir.** Os gatilhos escrevem
//     `eventos_timeline` com `now()`; o arquivo termina retroagindo cada
//     evento para a data da fase (e cada marco de execução para a data em que
//     foi concluído).
//
// Como `postgres` não tem `auth.uid()`, os carimbos de autor são DECLARADOS —
// `p_criado_por` nas RPCs e `criado_por`/`concluido_por` nos inserts — que é o
// mesmo caminho do `service_role` (0069/0070). E é justamente por `auth.uid()`
// ser nulo que `app.protege_execucao_marco` NÃO sobrescreve o
// `concluido_em` retroativo dos 19 marcos.
// ---------------------------------------------------------------------------

const uid = (chave: string) => uidDe(MARCA, chave);

const ID = {
  edicao: uid("edicao"),
  pessoa: uid("pessoa"),
  jornada: uid("jornada"),
  sessao: uid("sessao"),
  agendamento: uid("agendamento"),
  croqui: uid("croqui"),
  execucaoIa: uid("execucao_ia"),
  material: uid("material"),
  apresentacao: uid("apresentacao"),
  bem: (i: number) => uid(`bem:${i}`),
  familiar: (i: number) => uid(`familiar:${i}`),
  parametro: (p: ParametroExemplo) => uid(`param:${p.chave}:${p.uf ?? ""}:${p.municipio ?? ""}`),
  link: (tipo: string) => uid(`link:${tipo}`),
};

function lit(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  return `'${v.replace(/'/g, "''")}'`;
}

const ts = (iso: string) => `${lit(iso)}::timestamptz`;
const uuid = (v: string | null) => (v ? `${lit(v)}::uuid` : "null");

/** JSON em dollar-quoting, como o orquestrador pediu. Recusa se o rótulo colidir. */
function json(v: unknown): string {
  const texto = JSON.stringify(v);
  if (texto.includes("$json$")) throw new ErroSeed("payload contém o rótulo $json$ — trocar o rótulo do dollar-quoting.");
  return `$json$${texto}$json$::jsonb`;
}

/** Array de texto do Postgres. */
const arr = (xs: string[]) => (xs.length === 0 ? "'{}'::text[]" : `array[${xs.map(lit).join(", ")}]::text[]`);

/** Subselect do perfil autor: admin/advogada ATIVO, sem id fixo no arquivo. */
const PERFIL = "(select id from perfis_equipe where papel in ('advogada','admin') and ativo order by papel limit 1)";
const PRODUTO = (tipo: string) => `(select id from produtos where tipo = ${lit(tipo)} limit 1)`;

/** Hash do token do link — o token bruto vai no manifesto, nunca no banco. */
function tokenELhash(tipo: string): { token: string; hash: string } {
  const pepper = process.env.LINK_PUBLICO_PEPPER;
  if (!pepper || pepper.length < 16) {
    throw new ErroSeed("LINK_PUBLICO_PEPPER ausente/curta em .env.local — sem ela o link público não abre.");
  }
  // Determinístico DE PROPÓSITO: o arquivo tem de poder rodar 2× e devolver o
  // mesmo `/p/m/<token>` que já está no manifesto e nas capturas.
  const token = crypto.createHash("sha256").update(`${MARCA}:token:${tipo}:${pepper}`).digest("base64url");
  return { token, hash: crypto.createHash("sha256").update(token + pepper, "utf8").digest("hex") };
}

/**
 * Purga de TODO dado de exemplo (o do João inclusive — ele é recriado logo
 * depois). Ordem ditada pelas FKs, a mesma de `apagarJornadas`. É o que torna
 * o arquivo idempotente: apaga por chave estável e recria.
 */
function sqlPurga(): string {
  const P = "_alvo_pessoas";
  const J = "_alvo_jornadas";
  const linhas: string[] = [
    `create temporary table ${P} on commit drop as`,
    `  select id from pessoas where origem_dado = 'exemplo';`,
    `create temporary table ${J} on commit drop as`,
    `  select id from jornadas where origem_dado = 'exemplo' or pessoa_id in (select id from ${P});`,
    `create temporary table _alvo_croquis on commit drop as`,
    `  select id from croquis where jornada_id in (select id from ${J});`,
    `create temporary table _alvo_sessoes on commit drop as`,
    `  select id from sessoes_viabilidade where jornada_id in (select id from ${J});`,
    `create temporary table _alvo_links on commit drop as`,
    `  select id from links_publicos where jornada_id in (select id from ${J});`,
    `create temporary table _alvo_cenarios on commit drop as`,
    `  select id from cenarios_patrimoniais where jornada_id in (select id from ${J});`,
    "",
    "-- PRÉ: quanto existe antes de qualquer DELETE (regra da casa: contar quem muda de valor).",
    "do $$ declare n_p int; n_j int; begin",
    `  select count(*) into n_p from ${P};`,
    `  select count(*) into n_j from ${J};`,
    "  raise notice 'PRE: % pessoa(s) origem_dado=exemplo, % jornada(s) de exemplo', n_p, n_j;",
    "end $$;",
    "",
  ];
  const porCroqui = ["croqui_narrativas", "croqui_apresentacoes", "croqui_analises"];
  for (const t of porCroqui) linhas.push(`delete from ${t} where croqui_id in (select id from _alvo_croquis);`);
  linhas.push(
    `delete from croqui_calculos           where jornada_id in (select id from ${J});`,
    `delete from croquis                   where jornada_id in (select id from ${J});`,
    `delete from diagnosticos_sv           where jornada_id in (select id from ${J});`,
    "delete from cenario_rubricas          where cenario_id in (select id from _alvo_cenarios);",
    `delete from cenarios_patrimoniais     where jornada_id in (select id from ${J});`,
    `delete from execucao_jornada_marcos   where jornada_id in (select id from ${J});`,
    `delete from materiais_gerados         where jornada_id in (select id from ${J});`,
    `delete from documentos_pedidos        where jornada_id in (select id from ${J});`,
    `delete from documentos                where jornada_id in (select id from ${J});`,
    `delete from mensagens_agendadas       where jornada_id in (select id from ${J});`,
    "delete from links_publicos_acessos    where link_id in (select id from _alvo_links);",
    "delete from agendamentos_sugestoes    where link_id in (select id from _alvo_links);",
    `delete from ligacoes_ia               where jornada_id in (select id from ${J});`,
    `delete from links_publicos            where jornada_id in (select id from ${J});`,
    "delete from relatorios_sessao         where sessao_id in (select id from _alvo_sessoes);",
    "delete from agendamentos              where sessao_id in (select id from _alvo_sessoes);",
    `delete from sessoes_viabilidade       where jornada_id in (select id from ${J});`,
    `delete from ligacoes_estrategicas     where jornada_id in (select id from ${J});`,
    `delete from formularios_respostas     where jornada_id in (select id from ${J});`,
    `delete from tarefas                   where jornada_id in (select id from ${J});`,
    `delete from ofertas                   where jornada_id in (select id from ${J});`,
    `delete from pagamentos                where jornada_id in (select id from ${J});`,
    `delete from briefings                 where jornada_id in (select id from ${J});`,
    `delete from execucoes_ia              where jornada_id in (select id from ${J});`,
    `delete from eventos_timeline          where jornada_id in (select id from ${J});`,
    `delete from jornadas_transicoes       where jornada_id in (select id from ${J});`,
    `delete from jornadas                  where id in (select id from ${J});`,
    "",
    "-- webhooks do exemplo não pendem de jornada: saem pela marca.",
    `delete from webhooks_eventos where origem = 'exemplo' and evento_externo_id like ${lit(`${MARCA}-%`)};`,
    `delete from pagamentos      where origem = 'exemplo' and transacao_externa_id like ${lit(`${MARCA}-%`)};`,
    "",
    `delete from respostas_seminario      where pessoa_id in (select id from ${P});`,
    `delete from consentimentos           where pessoa_id in (select id from ${P});`,
    `delete from familiares               where pessoa_id in (select id from ${P});`,
    `delete from patrimonio_itens         where pessoa_id in (select id from ${P});`,
    `delete from participacoes_seminario  where pessoa_id in (select id from ${P});`,
    `delete from documentos               where pessoa_id in (select id from ${P});`,
    `delete from pessoas                  where id in (select id from ${P});`,
    "",
    "-- Edicoes de seminario de exemplo que ficaram sem ninguem. Sem isto, o INSERT",
    "-- novo colidiria com o UNIQUE de `codigo` de uma edicao criada por uma rodada",
    "-- anterior (o `on conflict (id)` nao cobre esse indice) e a transacao cairia.",
    "delete from edicoes_seminario e where e.origem_dado = 'exemplo'",
    "  and not exists (select 1 from participacoes_seminario p where p.edicao_id = e.id)",
    "  and not exists (select 1 from jornadas j where j.edicao_id = e.id)",
    "  and not exists (select 1 from respostas_seminario r where r.edicao_id = e.id);",
  );
  return linhas.join("\n");
}

interface ParametroDoBanco {
  id: string;
  chave: string;
  versao: number;
  valor: number | null;
  faixas: TabelaFaixas | null;
  unidade: string;
  uf: string | null;
  municipio: string | null;
  base_legal: string | null;
}

/** Lê o que já existe no banco para montar o snapshot do motor com ids REAIS. */
async function lerContextoDoBanco(db: Cliente): Promise<{
  parametros: ParametroDoBanco[];
  configuracoes: Record<string, unknown>;
  marcos: Array<{ id: string; ordem: number; rotulo: string }>;
}> {
  const pm = await db
    .from("parametros_metodo")
    .select("id, chave, versao, valor, faixas, unidade, uf, municipio, base_legal")
    .eq("ativo", true);
  if (pm.error) throw new ErroSeed(`parametros_metodo: ${pm.error.message}`);
  const cfg = await db.from("configuracoes").select("chave, valor").in("chave", [...CHAVES_CONFIGURACAO_CROQUI]);
  if (cfg.error) throw new ErroSeed(`configuracoes: ${cfg.error.message}`);
  const mk = await db.from("execucao_marcos").select("id, ordem, rotulo").order("ordem", { ascending: true });
  if (mk.error) throw new ErroSeed(`execucao_marcos: ${mk.error.message}`);

  const configuracoes: Record<string, unknown> = {};
  for (const c of ((cfg.data as Array<{ chave: string; valor: unknown }> | null) ?? [])) configuracoes[c.chave] = c.valor;

  return {
    parametros: ((pm.data as ParametroDoBanco[] | null) ?? []).map((p) => ({ ...p, valor: p.valor === null ? null : Number(p.valor) })),
    configuracoes,
    marcos: (mk.data as Array<{ id: string; ordem: number; rotulo: string }> | null) ?? [],
  };
}

/** Entrada + parâmetros + resultado do motor, com os ids que o SQL vai gravar. */
function calcularParaOSql(doBanco: Awaited<ReturnType<typeof lerContextoDoBanco>>): {
  entrada: EntradaCroqui;
  parametros: ParametrosCroqui;
  resultado: ResultadoCroqui;
} {
  const ficha = {
    pessoa_id: ID.pessoa,
    uf: UF,
    cidade: MUNICIPIO,
    itens: PATRIMONIO.map((b, i) => ({
      id: ID.bem(i),
      pessoa_id: ID.pessoa,
      registrado_na_jornada_id: ID.jornada,
      tipo: b.tipo,
      descricao: b.descricao,
      ano_aquisicao: b.ano_aquisicao,
      valor_historico: b.valor_historico,
      valor_mercado: b.valor_mercado,
      destinacao: b.destinacao,
      valor_locacao_mensal: b.valor_locacao_mensal,
      detalhes: b.detalhes,
      ativo: true,
      criado_em: DATAS.qualificado,
    })),
    familiares: FAMILIA.map((f, i) => ({
      id: ID.familiar(i),
      pessoa_id: ID.pessoa,
      parentesco: f.parentesco,
      nome: f.nome,
      idade: f.idade,
      ocupacao: f.ocupacao,
      regime_casamento: f.regime_casamento,
      ano_casamento: f.ano_casamento,
      dependente_financeiro: f.dependente_financeiro,
      ativo: true,
      criado_em: DATAS.qualificado,
    })),
  } as unknown as FichaDoCroqui;

  const configuracoes: ConfiguracoesCroqui = {
    ...doBanco.configuracoes,
    "croqui.horas_por_ato": HORAS_POR_ATO,
    "croqui.uf_domicilio_vantajoso": UF_VANTAJOSA,
  };
  const entrada = montarEntrada(ID.jornada, ficha, configuracoes, []);

  const itens: Record<string, ParametroCroqui> = {};
  for (const p of doBanco.parametros) {
    itens[chaveMapa(p.chave, p.uf, p.municipio)] = {
      id: p.id,
      chave: p.chave,
      versao: p.versao,
      unidade: p.unidade as ParametroCroqui["unidade"],
      valor: p.valor,
      faixas: p.faixas,
      uf: p.uf,
      municipio: p.municipio,
      base_legal: p.base_legal,
    };
  }
  for (const p of PARAMETROS_EXEMPLO) {
    const k = chaveMapa(p.chave, p.uf ?? null, p.municipio ?? null);
    if (itens[k]) continue;
    itens[k] = {
      id: ID.parametro(p),
      chave: p.chave,
      versao: 1,
      unidade: p.unidade,
      valor: p.unidade === "faixas" ? null : (p.valor ?? null),
      faixas: p.unidade === "faixas" ? (p.faixas ?? null) : null,
      uf: p.uf ?? null,
      municipio: p.municipio ?? null,
      base_legal: `${ROTULO_EXEMPLO} — usado em ${p.porque}.`,
    };
  }

  const referencia = configuracoes["croqui.sinal_modelo_referencia"];
  const parametros: ParametrosCroqui = {
    itens,
    horas_por_ato: HORAS_POR_ATO,
    sinal_modelo_referencia:
      referencia === "celula_1" || referencia === "celula_2" || referencia === "celula_3" ? referencia : "celula_3",
    divergencias: (Array.isArray(configuracoes["parametros.divergencias"])
      ? configuracoes["parametros.divergencias"]
      : []) as ParametrosCroqui["divergencias"],
  };

  const ausentes = parametrosAusentes(entrada, parametros);
  if (ausentes.length > 0) {
    throw new ErroSeed(
      `o motor ainda vê ${ausentes.length} parâmetro(s) ausente(s) — o SQL geraria um croqui que não fecha: ` +
        ausentes.map((a) => `${a.chave}${a.uf ? `/${a.uf}` : ""}`).join(", "),
    );
  }

  // Data FIXA: o snapshot precisa ser reproduzível entre duas gerações.
  return { entrada, parametros, resultado: calcularCroqui(entrada, parametros, new Date(DATAS.croqui_calculado)) };
}

/** `insert … on conflict (id) do nothing` — recriar é sempre seguro. */
function ins(tabela: string, campos: Record<string, string>, conflito = "(id) do nothing"): string {
  const cols = Object.keys(campos);
  return (
    `insert into ${tabela} (${cols.join(", ")})\nvalues (${cols.map((c) => campos[c]).join(", ")})\non conflict ${conflito};`
  );
}

function sqlParametros(): string {
  const partes: string[] = [
    "-- Parâmetros do método que faltam para o croqui FECHAR.",
    "-- TODOS com base_legal e notas começando em \"EXEMPLO — valor ilustrativo, não é a lei\".",
    "-- `versao = 1` explícita: o trigger app.parametros_metodo_versao só numera quando vem nula,",
    "-- e aqui o id é fixo para o --limpar apagar exatamente estas linhas.",
  ];
  for (const p of PARAMETROS_EXEMPLO) {
    partes.push(
      ins("parametros_metodo", {
        id: uuid(ID.parametro(p)),
        chave: lit(p.chave),
        versao: "1",
        valor: p.unidade === "faixas" ? "null" : lit(p.valor ?? null),
        faixas: p.unidade === "faixas" ? json(p.faixas) : "null",
        unidade: lit(p.unidade),
        uf: lit(p.uf ?? null),
        municipio: lit(p.municipio ?? null),
        base_legal: lit(`${ROTULO_EXEMPLO} — usado em ${p.porque}.`),
        ativo: "true",
        ativado_em: "now()",
        ativado_por: PERFIL,
        criado_por: PERFIL,
        notas: lit(`${NOTA_EXEMPLO} Usado em ${p.porque}.`),
      }),
    );
  }
  return partes.join("\n");
}

/** Só preenche configuração VAZIA, e guarda o valor anterior no manifesto. */
function sqlConfiguracoes(anteriores: Record<string, unknown>): string {
  const alvos: Array<[string, unknown]> = [
    ["croqui.horas_por_ato", HORAS_POR_ATO],
    ["croqui.uf_domicilio_vantajoso", UF_VANTAJOSA],
  ];
  const partes = [
    "-- Configurações: só entram se estiverem VAZIAS. Valor anterior no manifesto,",
    "-- para o limpar-joao.sql restaurar. `parametros.divergencias` NÃO é tocada.",
  ];
  for (const [chave, valor] of alvos) {
    const anterior = anteriores[chave] ?? null;
    partes.push(
      `update configuracoes set valor = ${json(valor)}\n where chave = ${lit(chave)}\n   and (valor is null or valor = 'null'::jsonb or valor = '[]'::jsonb or valor = '{}'::jsonb or valor = '""'::jsonb);` +
        `\n-- anterior: ${JSON.stringify(anterior)}`,
    );
  }
  return partes.join("\n\n");
}

function sqlBase(alvo: Etapa): string {
  const partes: string[] = [];

  partes.push(
    ins("edicoes_seminario", {
      id: uuid(ID.edicao),
      codigo: lit(CODIGO_EDICAO),
      nome: lit("Seminário de exemplo — SIC-HF"),
      inicio_em: lit(DATAS.seminario_inicio.slice(0, 10)),
      fim_em: lit(DATAS.seminario_fim.slice(0, 10)),
      ativa: "true",
      origem_dado: lit("exemplo"),
    }),
  );

  partes.push(
    ins("pessoas", {
      id: uuid(ID.pessoa),
      nome: lit(NOME_PESSOA),
      email: lit(EMAIL_PESSOA),
      telefone: lit(TELEFONE_PESSOA),
      cidade: lit(MUNICIPIO),
      uf: lit(UF),
      profissao: lit("Empresário — distribuição"),
      faixa_etaria: lit("45-54"),
      estado_civil: lit("casado"),
      observacoes: lit(
        `Pessoa de EXEMPLO do seed de demonstração. CPF informado pelo dono do produto: ${CPF_PESSOA} ` +
          "(não há coluna de CPF no schema — 0003 e nenhuma migration posterior criou).",
      ),
      ativo: "true",
      origem_dado: lit("exemplo"),
      criado_por: PERFIL,
      criado_em: ts(DATAS.captado),
    }),
  );

  partes.push(
    ins(
      "participacoes_seminario",
      {
        id: uuid(uid("participacao")),
        pessoa_id: uuid(ID.pessoa),
        edicao_id: uuid(ID.edicao),
        origem: lit("seminario"),
        dias_assistidos: "3",
        registrado_em: ts(DATAS.captado),
        criado_em: ts(DATAS.captado),
      },
      "(pessoa_id, edicao_id) do nothing",
    ),
  );

  for (const [i, [pergunta, resposta]] of RESPOSTAS_SEMINARIO.entries()) {
    partes.push(
      ins(
        "respostas_seminario",
        {
          id: uuid(uid(`resposta:${i}`)),
          pessoa_id: uuid(ID.pessoa),
          edicao_id: uuid(ID.edicao),
          pergunta: lit(pergunta),
          resposta: lit(resposta),
          origem: lit("manual"),
          origem_dado: lit("exemplo"),
          criado_por: PERFIL,
          criado_em: ts(DATAS.captado),
        },
        "(pessoa_id, edicao_id, pergunta) do nothing",
      ),
    );
  }

  for (const [i, tipo] of ["comunicacao_email", "comunicacao_whatsapp", "gravacao_sessao", "tratamento_ia"].entries()) {
    partes.push(
      ins("consentimentos", {
        id: uuid(uid(`consentimento:${tipo}`)),
        pessoa_id: uuid(ID.pessoa),
        tipo: lit(tipo),
        concedido: "true",
        texto_apresentado: lit(`Você autoriza (${tipo})? — texto de EXEMPLO do seed de demonstração.`),
        versao_texto: lit("exemplo-v1"),
        canal: lit("formulario"),
        registrado_por: PERFIL,
        concedido_em: ts(DATAS.captado),
        criado_em: ts(DATAS.captado),
      }),
    );
    void i;
  }

  // A jornada nasce JÁ na etapa alvo. O gatilho de transição só valida UPDATE
  // (0004) — INSERT direto em qualquer etapa é o caminho que a 0016 já usa —,
  // e assim as transições ficam com data retroativa em vez de `now()`.
  const ganhou = alvo === "holding_contratada";
  partes.push(
    ins("jornadas", {
      id: uuid(ID.jornada),
      pessoa_id: uuid(ID.pessoa),
      edicao_id: uuid(ID.edicao),
      origem: lit("seminario"),
      trilha: lit("seminario"),
      etapa: `${lit(alvo)}::etapa_jornada`,
      desfecho: `${lit(ganhou ? "ganha" : "aberta")}::desfecho_jornada`,
      motivo_desfecho: lit(ganhou ? "Holding contratada" : null),
      nivel_pago: String(NIVEL_PAGO[alvo]),
      faixa_patrimonio_declarada: lit(ordemDa(alvo) >= ordemDa("qualificado") ? "Acima de R$ 2 milhões" : null),
      responsavel_id: PERFIL,
      origem_dado: lit("exemplo"),
      entrou_na_etapa_em: ts(DATA_DA_ETAPA[alvo]),
      criado_por: PERFIL,
      criado_em: ts(DATAS.captado),
    }),
  );

  // Transições explícitas: sem elas a Esteira não tem de onde tirar a coorte.
  const caminho = ETAPAS.slice(0, ordemDa(alvo) + 1);
  for (let i = 1; i < caminho.length; i += 1) {
    partes.push(
      ins("jornadas_transicoes", {
        id: uuid(`transicao:${caminho[i]}`),
        jornada_id: uuid(ID.jornada),
        de_etapa: `${lit(caminho[i - 1])}::etapa_jornada`,
        para_etapa: `${lit(caminho[i])}::etapa_jornada`,
        de_desfecho: "'aberta'::desfecho_jornada",
        para_desfecho: `${lit(caminho[i] === "holding_contratada" ? "ganha" : "aberta")}::desfecho_jornada`,
        motivo: lit(caminho[i] === "holding_contratada" ? "Holding contratada" : null),
        ator_perfil_id: PERFIL,
        ator_tipo: lit("humano"),
        ocorrido_em: ts(DATA_DA_ETAPA[caminho[i]]),
      }),
    );
  }
  return partes.join("\n\n");
}

function sqlQualificado(): string {
  const partes: string[] = [];
  for (const [i, f] of FAMILIA.entries()) {
    partes.push(
      ins("familiares", {
        id: uuid(ID.familiar(i)),
        pessoa_id: uuid(ID.pessoa),
        registrado_na_jornada_id: uuid(ID.jornada),
        parentesco: lit(f.parentesco),
        nome: lit(f.nome),
        idade: lit(f.idade),
        ocupacao: lit(f.ocupacao),
        regime_casamento: lit(f.regime_casamento),
        ano_casamento: lit(f.ano_casamento),
        dependente_financeiro: lit(f.dependente_financeiro),
        ativo: "true",
        criado_em: ts(DATAS.qualificado),
      }),
    );
  }
  for (const [i, b] of PATRIMONIO.entries()) {
    partes.push(
      ins("patrimonio_itens", {
        id: uuid(ID.bem(i)),
        pessoa_id: uuid(ID.pessoa),
        registrado_na_jornada_id: uuid(ID.jornada),
        tipo: `${lit(b.tipo)}::tipo_bem`,
        descricao: lit(b.descricao),
        ano_aquisicao: lit(b.ano_aquisicao),
        valor_historico: lit(b.valor_historico),
        valor_mercado: lit(b.valor_mercado),
        destinacao: lit(b.destinacao),
        valor_locacao_mensal: lit(b.valor_locacao_mensal),
        detalhes: json(b.detalhes),
        origem_valor: lit("digitado"),
        ativo: "true",
        criado_por: PERFIL,
        criado_em: ts(DATAS.qualificado),
      }),
    );
  }
  partes.push(
    ins(
      "formularios_respostas",
      {
        id: uuid(uid("formulario_resposta")),
        jornada_id: uuid(ID.jornada),
        formulario_id: "(select id from formularios where chave = 'estrategico' and ativo order by versao desc limit 1)",
        respostas: json(RESPOSTAS_FORMULARIO),
        origem: lit("sistema"),
        origem_dado: lit("exemplo"),
        respondido_em: ts(DATAS.formulario),
        criado_em: ts(DATAS.formulario),
      },
      "(jornada_id) do nothing",
    ),
  );
  return partes.join("\n\n");
}

function sqlPagamento(sufixo: string, tipoProduto: string, valor: number, pagoEm: string): string {
  const externo = `${MARCA}-${sufixo}`;
  const bruto = {
    exemplo: true,
    marca: MARCA,
    observacao: "Payload sintético do seed de exemplo — não veio da Hotmart.",
    transaction: externo,
    product: tipoProduto,
    price: { value: valor, currency_code: "BRL" },
    buyer: { name: NOME_PESSOA, email: EMAIL_PESSOA },
    purchase_date: pagoEm,
  };
  return [
    ins(
      "webhooks_eventos",
      {
        id: uuid(uid(`webhook:${sufixo}`)),
        origem: lit("exemplo"),
        evento_externo_id: lit(externo),
        tipo_evento: lit("PURCHASE_APPROVED"),
        assinatura_valida: "true",
        bruto: json(bruto),
        processado_em: ts(pagoEm),
        recebido_em: ts(pagoEm),
      },
      "(origem, evento_externo_id) do nothing",
    ),
    ins(
      "pagamentos",
      {
        id: uuid(uid(`pagamento:${sufixo}`)),
        jornada_id: uuid(ID.jornada),
        pessoa_id: uuid(ID.pessoa),
        produto_id: PRODUTO(tipoProduto),
        origem: lit("exemplo"),
        transacao_externa_id: lit(externo),
        status: `${lit("aprovado")}::status_pagamento`,
        valor: String(valor),
        moeda: lit("BRL"),
        parcelas: "1",
        comprador_email: lit(EMAIL_PESSOA),
        comprador_nome: lit(NOME_PESSOA),
        comprador_telefone: lit(TELEFONE_PESSOA),
        pago_em: ts(pagoEm),
        bruto: json(bruto),
        criado_em: ts(pagoEm),
      },
      "(origem, transacao_externa_id) do nothing",
    ),
  ].join("\n\n");
}

function sqlLink(tipo: string): string {
  const { hash } = tokenELhash(tipo);
  return ins(
    "links_publicos",
    {
      id: uuid(ID.link(tipo)),
      jornada_id: uuid(ID.jornada),
      // O link de confirmacao de presenca pende do AGENDAMENTO (0051): sem
      // isto `/p/c` nao sabe qual horario esta confirmando.
      agendamento_id: tipo === "confirmacao" ? uuid(ID.agendamento) : "null",
      tipo: `${lit(tipo)}::tipo_link_publico`,
      token_hash: lit(hash),
      token_prefixo: lit(tokenELhash(tipo).token.slice(0, 6)),
      estado: "'ativo'::estado_link_publico",
      expira_em: "now() + interval '400 days'",
      criado_por: PERFIL,
      criado_em: ts(DATAS.material),
      origem_dado: lit("exemplo"),
    },
    "(id) do nothing",
  );
}

function sqlSessaoContratada(): string {
  return [
    sqlPagamento("SV", "sessao_viabilidade", 2000, DATAS.pagamento_sv),
    ins("ligacoes_estrategicas", {
      id: uuid(uid("ligacao")),
      jornada_id: uuid(ID.jornada),
      pop: lit("03"),
      realizada_em: ts(DATAS.contato_equipe),
      duracao_segundos: "337",
      colaborador_id: PERFIL,
      respostas: json({
        expectativa: "Ver o número: custo de não fazer nada × custo de fazer",
        preocupacao: "A empresa parar se ele faltar; briga entre os três filhos",
        processo_decisorio: "Decide junto com a esposa",
      }),
      expectativa_principal: lit("Ver, em número, quanto custa não fazer nada e quanto custa fazer."),
      preocupacao_principal: lit("A operação parar e os três filhos brigarem pela empresa."),
      assunto_atencao_especial: lit("O pai dele morreu sem inventário aberto; o assunto é sensível."),
      objecoes_percebidas: arr(["Vai comparar o preço com o de um contador", "Quer entender por que 3 células e não 1"]),
      pessoas_mencionadas: arr(["Marina (esposa, decide junto)", "Pedro, Helena e Rafael (filhos)", "sócio minoritário com 20%"]),
      ritmo: lit("rapido"),
      estilo_resposta: lit("objetiva"),
      sinais: arr(["procura_numeros", "interrompe", "demonstra_cautela"]),
      frases_marcantes: arr([
        "Meu pai morreu e a gente levou quatro anos para resolver. Não quero isso para os meus filhos.",
        "Se eu faltar amanhã, ninguém sabe onde estão as coisas.",
      ]),
      processo_decisorio: lit("decisor_conjunto"),
      decisores_presentes_na_sessao: "true",
      observacoes: lit("Contato humano da equipe (exemplo). Chegou com perguntas escritas; quer número, não conceito."),
      origem_dado: lit("exemplo"),
      criado_por: PERFIL,
      criado_em: ts(DATAS.contato_equipe),
    }),
    `-- Boas-vindas: o gatilho app.regua_boas_vindas já enfileirou e-mail + WhatsApp.\n` +
      ins("eventos_timeline", {
        id: uuid(uid("evento:boas_vindas")),
        jornada_id: uuid(ID.jornada),
        tipo: lit("mensagem"),
        titulo: lit("Boas-vindas enviadas"),
        descricao: lit("E-mail completo + aviso de que a equipe vai ligar."),
        dados: json({ exemplo: true }),
        ator_perfil_id: PERFIL,
        ator_tipo: lit("sistema"),
        ocorrido_em: ts(DATAS.boas_vindas),
      }),
  ].join("\n\n");
}

function sqlSessaoAgendada(realizada: boolean): string {
  const fim = new Date(new Date(DATAS.sessao_marcada).getTime() + 60 * 60 * 1000).toISOString();
  return [
    ins(
      "sessoes_viabilidade",
      {
        id: uuid(ID.sessao),
        jornada_id: uuid(ID.jornada),
        advogada_id: PERFIL,
        link_sala: lit("https://meet.example.com/sic-hf-exemplo-joao"),
        link_sala_origem: lit("manual"),
        link_sala_atualizado_em: ts(DATAS.agendou),
        realizada_em: realizada ? ts(DATAS.sessao_realizada) : "null",
        resultado: lit(realizada ? "fechou" : null),
        motivo_resultado: lit(realizada ? "Contratou o croqui na própria sessão." : null),
        criado_em: ts(DATAS.agendou),
      },
      "(jornada_id) do nothing",
    ),
    ins("agendamentos", {
      id: uuid(ID.agendamento),
      sessao_id: uuid(ID.sessao),
      inicio_em: ts(DATAS.sessao_marcada),
      fim_em: ts(fim),
      status: `${lit(realizada ? "realizado" : "confirmado")}::status_agendamento`,
      origem: lit("cliente"),
      advogada_id: PERFIL,
      criado_por: PERFIL,
      criado_em: ts(DATAS.agendou),
      presenca_confirmada_em: ts(DATAS.confirmou_presenca),
      presenca_confirmada_via: lit("link"),
    }),
    sqlLink("confirmacao"),
  ].join("\n\n");
}

function sqlSessaoRealizada(): string {
  const partes: string[] = [
    ins(
      "relatorios_sessao",
      {
        id: uuid(uid("relatorio")),
        sessao_id: uuid(ID.sessao),
        acompanhado: "true",
        quem_acompanha: lit("Marina (esposa)"),
        acompanhante_decide: "true",
        acompanhante_assistiu: "true",
        data_contratacao: lit(DATAS.pagamento_sv.slice(0, 10)),
        valor_pago_sessao: "2000",
        parcelas: "1",
        motivacao_cliente: lit("Viu o inventário do pai travar a família por quatro anos."),
        receita_familiar_mensal: "62000",
        ideia_custo_inventario: lit("Achava que ficava em torno de R$ 80 mil; nunca fez a conta."),
        reserva_ou_seguro: lit("Seguro de vida de R$ 500 mil, sem reserva de liquidez para inventário."),
        ciente_itcmd: "true",
        preocupacao_predominante: lit("Continuidade da operação e convivência entre os três filhos."),
        como_deseja_organizar: lit("Manter o controle enquanto viver e deixar regra escrita para depois."),
        motiva_evitar_inventario: lit("Tempo e bloqueio da empresa, mais que o custo."),
        interesse_imediato: lit("Alto — quer começar ainda neste trimestre."),
        relacao_filhos_terceiros: lit("Filho mais velho já trabalha na empresa; os outros dois, não."),
        porque_nos_procurou: lit("Assistiu aos três dias do seminário e se identificou com o caso do inventário."),
        falta_planejamento_preocupa: lit("Sim, principalmente pelo filho menor."),
        resultado_sessao: lit("Fechou o croqui na sessão."),
        tributos: json({ exemplo: true, observacao: "Números do croqui vêm do motor, não deste campo." }),
        consideracoes_apresentacao_croqui: lit(
          "Começar pelo custo da inércia. Ele responde a número, não a conceito. A esposa precisa estar na apresentação.",
        ),
        criado_por: PERFIL,
        criado_em: ts(DATAS.relatorio),
      },
      "(sessao_id) do nothing",
    ),
    [
      "-- Diagnostico da SV pela RPC de verdade. Desde a 0071, sem sessao (postgres/service_role)",
      "-- a RPC exige o autor DECLARADO em p_criado_por, validado por app.perfil_ve_patrimonio.",
      "-- Nada de encarnar claim de sessao: com auth.uid() resolvido, app.protege_execucao_marco",
      "-- sobrescreveria o concluido_em retroativo dos 19 marcos por now().",
      "do $$",
      "declare v_perfil uuid;",
      "begin",
      `  if exists (select 1 from diagnosticos_sv where jornada_id = ${uuid(ID.jornada)}) then`,
      "    raise notice 'diagnostico_sv ja existe para a jornada de exemplo';",
      "    return;",
      "  end if;",
      "  select id into v_perfil from perfis_equipe",
      "   where papel in ('advogada','admin') and ativo",
      "   order by papel limit 1;",
      "  if v_perfil is null then",
      "    raise exception 'nenhum perfil admin/advogada ativo — registrar_diagnostico_sv exige autor';",
      "  end if;",
      `  perform public.registrar_diagnostico_sv(${uuid(ID.jornada)}, null, ${json(BLOCOS_DIAGNOSTICO)}, v_perfil);`,
      "end $$;",
    ].join(String.fromCharCode(10)),
    ins(
      "materiais_gerados",
      {
        id: uuid(ID.material),
        jornada_id: uuid(ID.jornada),
        modelo_id:
          "(select id from materiais_modelos where ativo order by (chave = 'empresa') desc, versao desc limit 1)",
        execucao_id: "null",
        versao: "1",
        dor_principal: lit("Que a empresa pare se eu faltar, e que os três filhos briguem por causa dela."),
        fonte_dor: lit("ligacao"),
        conteudo: json(CONTEUDO_MATERIAL),
        origem_dado: lit("exemplo"),
        aprovado_por: PERFIL,
        aprovado_em: ts(DATAS.material),
        atual: "true",
        criado_em: ts(DATAS.material),
      },
      "(jornada_id, versao) do nothing",
    ),
    sqlLink("material"),
    sqlLink("documentos"),
  ];

  // Radar: uma linha por item, com os ids determinísticos dos bens/familiares.
  for (const [i, item] of itensDoRadar().entries()) {
    partes.push(
      ins(
        "documentos_pedidos",
        {
          id: uuid(uid(`pedido:${i}`)),
          jornada_id: uuid(ID.jornada),
          chave: lit(item.chave),
          item_ref: lit(item.item_ref),
          tipo: lit(item.tipo),
          pedido_em: ts(DATAS.documentos_pedidos),
          pedido_por: PERFIL,
          criado_em: ts(DATAS.documentos_pedidos),
        },
        "(jornada_id, chave) do nothing",
      ),
    );
  }

  partes.push(
    ins("tarefas", {
      id: uuid(uid("tarefa_croqui")),
      jornada_id: uuid(ID.jornada),
      titulo: lit("Montar o croqui estrutural"),
      descricao: lit("Cliente contratou na sessão. Aguardando IR e contrato social."),
      responsavel_id: PERFIL,
      vence_em: lit(DATAS.croqui_calculado.slice(0, 10)),
      origem: lit("sistema"),
      tipo: lit("croqui_montar"),
      criado_por: PERFIL,
      criado_em: ts(DATAS.tarefa_croqui),
    }),
  );
  return partes.join("\n\n");
}

/** Os itens do radar, derivados dos ids determinísticos (mesma `chaveItemRadar`). */
function itensDoRadar(): Array<{ chave: string; item_ref: string | null; tipo: string }> {
  const itens: Array<{ chave: string; item_ref: string | null; tipo: string }> = [
    { chave: chaveItemRadar("coleta", "imposto_renda", null), item_ref: null, tipo: "imposto_renda" },
    { chave: chaveItemRadar("coleta", "comprovante_residencia", null), item_ref: null, tipo: "comprovante_residencia" },
  ];
  for (const [i, f] of FAMILIA.entries()) {
    const ref = ID.familiar(i);
    if (f.parentesco.startsWith("conjuge")) {
      itens.push({ chave: chaveItemRadar("coleta", "imposto_renda", ref), item_ref: ref, tipo: "imposto_renda" });
      itens.push({ chave: chaveItemRadar("coleta", "certidao_casamento", ref), item_ref: ref, tipo: "certidao_casamento" });
    } else if (f.parentesco.startsWith("filho")) {
      itens.push({ chave: chaveItemRadar("coleta", "certidao_nascimento", ref), item_ref: ref, tipo: "certidao_nascimento" });
    }
  }
  for (const [i, b] of PATRIMONIO.entries()) {
    const ref = ID.bem(i);
    if (b.tipo === "imovel") itens.push({ chave: chaveItemRadar("coleta", "matricula_imovel", ref), item_ref: ref, tipo: "matricula_imovel" });
    if (b.tipo === "empresa") itens.push({ chave: chaveItemRadar("coleta", "contrato_social", ref), item_ref: ref, tipo: "contrato_social" });
    if (b.tipo === "veiculo") itens.push({ chave: chaveItemRadar("coleta", "crlv", ref), item_ref: ref, tipo: "crlv" });
    if (b.tipo === "investimento") itens.push({ chave: chaveItemRadar("coleta", "extrato_investimento", ref), item_ref: ref, tipo: "extrato_investimento" });
  }
  return itens;
}

function sqlCroquiContratado(motor: ReturnType<typeof calcularParaOSql>): string {
  return [
    sqlPagamento("CROQUI", "croqui_estrutural", 4500, DATAS.pagamento_croqui),
    `-- Radar conferido.\nupdate documentos_pedidos\n   set conferido_em = ${ts(DATAS.documentos_conferidos)}, conferido_por = ${PERFIL}\n where jornada_id = ${uuid(ID.jornada)} and conferido_em is null;`,
    ins(
      "croquis",
      {
        id: uuid(ID.croqui),
        jornada_id: uuid(ID.jornada),
        versao: "1",
        titulo: lit("Croqui Estrutural — Família Assunção (exemplo)"),
        status: "'pronto'::status_croqui",
        conteudo: json({ slides: SLIDES_CROQUI }),
        criado_por: PERFIL,
        criado_em: ts(DATAS.croqui_calculado),
        atualizado_por: PERFIL,
        atualizado_em: ts(DATAS.croqui_calculado),
      },
      "(jornada_id, versao) do nothing",
    ),
    [
      "-- CÁLCULO DO CROQUI. O resultado abaixo saiu do motor determinístico",
      `-- (${motor.resultado.motor_versao}), rodado localmente com a MESMA entrada que este`,
      "-- arquivo grava e com os `parametros_metodo.id` reais. Nada aqui foi digitado:",
      `-- ${Object.keys(motor.resultado.tabelas).length} tabelas, ${motor.resultado.faltas.length} falta(s) agregada(s).`,
      "-- A RPC é a mesma que `registrarCalculo()` chama com service_role.",
      "do $$",
      "declare v_calc croqui_calculos;",
      "begin",
      `  if exists (select 1 from croqui_calculos where jornada_id = ${uuid(ID.jornada)}) then`,
      "    raise notice 'croqui_calculos já existe para a jornada de exemplo — nada a fazer';",
      "  else",
      "    v_calc := public.registrar_croqui_calculo(",
      `      ${uuid(ID.jornada)},`,
      `      ${uuid(ID.croqui)},`,
      `      ${lit(motor.resultado.motor_versao)},`,
      `      ${json(motor.entrada)},`,
      `      ${json(motor.parametros)},`,
      `      ${json(motor.resultado)},`,
      "      'Cálculo da jornada de exemplo — parâmetros rotulados como EXEMPLO.',",
      `      ${PERFIL}`,
      "    );",
      "    perform public.fixar_croqui_calculo(v_calc.id, " + PERFIL + ");",
      "  end if;",
      "end $$;",
    ].join("\n"),
    ins("execucoes_ia", {
      id: uuid(ID.execucaoIa),
      jornada_id: uuid(ID.jornada),
      prompt_versao_id:
        "(select id from prompts_versoes where chave = 'agente_croqui_narrativa' order by versao desc limit 1)",
      modelo: "(select modelo_padrao from prompts_versoes where chave = 'agente_croqui_narrativa' order by versao desc limit 1)",
      status: "'concluida'::status_execucao_ia",
      modo: lit("demonstracao"),
      tokens_entrada: "0",
      tokens_saida: "0",
      custo_usd: "0",
      latencia_ms: "0",
      hash_entrada: lit(`${MARCA}-narrativa`),
      criado_por: PERFIL,
      criado_em: ts(DATAS.narrativa),
      concluido_em: ts(DATAS.narrativa),
    }),
    [
      "-- NARRATIVA: conteúdo de EXEMPLO escrito à mão. Nenhuma chamada de IA — o",
      "-- prompt `agente_croqui_narrativa` está inativo e não se gasta token para mock.",
      "-- `execucoes_ia.modo='demonstracao'` faz a RPC carimbar origem_dado='exemplo'.",
      "do $$ begin",
      `  if not exists (select 1 from croqui_narrativas where croqui_id = ${uuid(ID.croqui)}) then`,
      "    perform public.registrar_croqui_narrativa(",
      `      ${uuid(ID.croqui)}, ${uuid(ID.execucaoIa)}, ${json(NARRATIVA_EXEMPLO)},`,
      `      ${NARRATIVA_EXEMPLO.grau_confianca}::smallint, 3::smallint, ${PERFIL});`,
      "  end if;",
      "end $$;",
    ].join("\n"),
  ].join("\n\n");
}

function sqlCroquiApresentado(): string {
  const encerrada = new Date(new Date(DATAS.apresentacao).getTime() + 78 * 60 * 1000).toISOString();
  return [
    ins("croqui_apresentacoes", {
      id: uuid(ID.apresentacao),
      croqui_id: uuid(ID.croqui),
      iniciada_em: ts(DATAS.apresentacao),
      encerrada_em: ts(encerrada),
      slides_vistos: String(SLIDES_CROQUI.length),
      apresentador_id: PERFIL,
    }),
    `update croquis set status = 'apresentado'::status_croqui, atualizado_em = ${ts(DATAS.apresentacao)}\n where id = ${uuid(ID.croqui)} and status <> 'apresentado';`,
    ins("eventos_timeline", {
      id: uuid(uid("evento:exportacao")),
      jornada_id: uuid(ID.jornada),
      tipo: lit("croqui_exportacao"),
      titulo: lit("Relatório do Croqui exportado (.docx)"),
      descricao: "null",
      dados: json({ croqui_id: ID.croqui, destino: "download" }),
      ator_perfil_id: PERFIL,
      ator_tipo: lit("humano"),
      ocorrido_em: ts(DATAS.exportacao),
    }),
  ].join("\n\n");
}

function sqlHolding(marcos: Array<{ id: string; ordem: number; rotulo: string }>): string {
  const partes = [sqlPagamento("HOLDING", "holding", 63000, DATAS.pagamento_holding)];
  const passo = (DATAS.execucao_inicio - 1) / Math.max(1, marcos.length - 1);
  partes.push(
    "-- 19 marcos de execução. `app.protege_execucao_marco` só sobrescreve\n" +
      "-- concluido_em/por quando auth.uid() resolve um perfil — como postgres é nulo,\n" +
      "-- então as datas retroativas abaixo SOBREVIVEM.",
  );
  for (const [i, m] of marcos.entries()) {
    partes.push(
      ins(
        "execucao_jornada_marcos",
        {
          jornada_id: uuid(ID.jornada),
          marco_id: uuid(m.id),
          concluido_em: ts(quando(Math.round(DATAS.execucao_inicio - i * passo))),
          concluido_por: PERFIL,
          nota: lit(i === marcos.length - 1 ? "Sistema entregue à família (exemplo)." : null),
          criado_em: ts(quando(Math.round(DATAS.execucao_inicio - i * passo))),
        },
        "(jornada_id, marco_id) do nothing",
      ),
    );
  }
  return partes.join("\n\n");
}

/**
 * Os gatilhos gravam `eventos_timeline` com `now()`. Sem isto, uma jornada de
 * 90 dias aparece inteira como "hoje" e a Pasta mente sobre a ordem dos fatos.
 */
function sqlCronologia(): string {
  const mapa: Array<[string, string]> = [
    ["formulario", DATAS.formulario],
    ["patrimonio", DATAS.qualificado],
    ["familia", DATAS.qualificado],
    ["ligacao", DATAS.contato_equipe],
    ["agendamento", DATAS.agendou],
    ["relatorio", DATAS.relatorio],
    ["diagnostico", DATAS.relatorio],
    ["documento", DATAS.documentos_pedidos],
    ["croqui", DATAS.croqui_calculado],
    ["croqui_calculo", DATAS.croqui_calculado],
    ["croqui_narrativa", DATAS.narrativa],
    ["etapa", DATAS.captado],
    ["mensagem", DATAS.boas_vindas],
  ];
  const linhas = [
    "-- (1) A régua de boas-vindas (app.regua_boas_vindas, 0011) enfileirou e-mail e",
    "--     WhatsApp DE VERDADE quando o pagamento da SV entrou, para um endereço",
    "--     FICTÍCIO. Deixar `pendente` é deixar o cron mandando mensagem de mock",
    "--     para o mundo — ficam CANCELADAS. A história continua na linha do tempo,",
    "--     pelo evento, não por uma mensagem que ninguém vai receber.",
    `update mensagens_agendadas set status = 'cancelada'::status_mensagem, agendada_para = ${ts(DATAS.boas_vindas)}` +
      `
 where jornada_id = ${uuid(ID.jornada)} and status = 'pendente';`,
    "",
    "-- (2) Retroage o que os gatilhos escreveram com now(). O recorte por",
    "-- `ocorrido_em > now() - interval '1 hour'` garante que só os eventos DESTA",
    "-- execução se movem — evento antigo legítimo não é tocado.",
  ];
  for (const [tipo, data] of mapa) {
    linhas.push(
      `update eventos_timeline set ocorrido_em = ${ts(data)}\n where jornada_id = ${uuid(ID.jornada)} and tipo = ${lit(tipo)}\n   and ocorrido_em > now() - interval '1 hour';`,
    );
  }
  linhas.push(
    "-- Pagamento: cada um na data do seu.",
    `update eventos_timeline e set ocorrido_em = p.pago_em\n  from pagamentos p\n where e.jornada_id = ${uuid(ID.jornada)} and e.tipo = 'pagamento'\n   and p.jornada_id = e.jornada_id and (e.dados->>'pagamento_id')::uuid = p.id\n   and e.ocorrido_em > now() - interval '1 hour';`,
    "-- Execução: cada marco na data em que foi concluído.",
    `update eventos_timeline e set ocorrido_em = m.concluido_em\n  from execucao_jornada_marcos m\n where e.jornada_id = ${uuid(ID.jornada)} and e.tipo = 'execucao'\n   and m.jornada_id = e.jornada_id and (e.dados->>'marco_id')::uuid = m.marco_id;`,
  );
  return linhas.join("\n\n");
}

/** Relatório final: uma linha por tabela, com o que ficou. */
function sqlContagem(): string {
  const J = uuid(ID.jornada);
  const P = uuid(ID.pessoa);
  const linhas: Array<[string, string]> = [
    ["pessoas", `select count(*) from pessoas where id = ${P}`],
    ["jornadas", `select count(*) from jornadas where id = ${J}`],
    ["jornadas_transicoes", `select count(*) from jornadas_transicoes where jornada_id = ${J}`],
    ["participacoes_seminario", `select count(*) from participacoes_seminario where pessoa_id = ${P}`],
    ["respostas_seminario", `select count(*) from respostas_seminario where pessoa_id = ${P}`],
    ["consentimentos", `select count(*) from consentimentos where pessoa_id = ${P}`],
    ["familiares", `select count(*) from familiares where pessoa_id = ${P}`],
    ["patrimonio_itens", `select count(*) from patrimonio_itens where pessoa_id = ${P}`],
    ["formularios_respostas", `select count(*) from formularios_respostas where jornada_id = ${J}`],
    ["pagamentos", `select count(*) from pagamentos where jornada_id = ${J}`],
    ["webhooks_eventos", `select count(*) from webhooks_eventos where origem = 'exemplo'`],
    ["mensagens_agendadas", `select count(*) from mensagens_agendadas where jornada_id = ${J}`],
    ["ligacoes_estrategicas", `select count(*) from ligacoes_estrategicas where jornada_id = ${J}`],
    ["sessoes_viabilidade", `select count(*) from sessoes_viabilidade where jornada_id = ${J}`],
    ["agendamentos", `select count(*) from agendamentos where sessao_id = ${uuid(ID.sessao)}`],
    ["relatorios_sessao", `select count(*) from relatorios_sessao where sessao_id = ${uuid(ID.sessao)}`],
    ["diagnosticos_sv", `select count(*) from diagnosticos_sv where jornada_id = ${J}`],
    ["materiais_gerados", `select count(*) from materiais_gerados where jornada_id = ${J}`],
    ["documentos_pedidos", `select count(*) from documentos_pedidos where jornada_id = ${J}`],
    ["documentos_pedidos CONFERIDOS", `select count(*) from documentos_pedidos where jornada_id = ${J} and conferido_em is not null`],
    ["links_publicos", `select count(*) from links_publicos where jornada_id = ${J}`],
    ["tarefas", `select count(*) from tarefas where jornada_id = ${J}`],
    ["croquis", `select count(*) from croquis where jornada_id = ${J}`],
    ["croqui_calculos", `select count(*) from croqui_calculos where jornada_id = ${J}`],
    ["croqui_calculos ATUAL", `select count(*) from croqui_calculos where jornada_id = ${J} and atual`],
    ["croqui_narrativas", `select count(*) from croqui_narrativas where croqui_id = ${uuid(ID.croqui)}`],
    ["croqui_apresentacoes", `select count(*) from croqui_apresentacoes where croqui_id = ${uuid(ID.croqui)}`],
    ["execucoes_ia", `select count(*) from execucoes_ia where jornada_id = ${J}`],
    ["execucao_jornada_marcos", `select count(*) from execucao_jornada_marcos where jornada_id = ${J}`],
    ["eventos_timeline", `select count(*) from eventos_timeline where jornada_id = ${J}`],
    ["parametros_metodo EXEMPLO", `select count(*) from parametros_metodo where base_legal like ${lit(`${ROTULO_EXEMPLO}%`)}`],
    ["OUTRAS pessoas de exemplo (tem de ser 0)", `select count(*) from pessoas where origem_dado = 'exemplo' and id <> ${P}`],
  ];
  return (
    "-- Contagem final: cole no relatório.\n" +
    linhas.map(([rotulo, q], i) => `${i === 0 ? "" : "union all "}select ${i + 1} as ordem, ${lit(rotulo)} as tabela, (${q}) as linhas`).join("\n") +
    "\norder by ordem;"
  );
}

/** O desfazer: mesma purga + os parâmetros de exemplo + as configurações. */
function sqlLimpar(anteriores: Record<string, unknown>): string {
  const partes = [
    sqlPurga(),
    "",
    "-- Parâmetros cadastrados pelo seed: apagados por ID (nunca por chave —",
    "-- a chave pode ter uma versão REAL cadastrada depois pela Dra. Elaine).",
    `delete from parametros_metodo where id in (\n  ${PARAMETROS_EXEMPLO.map((p) => uuid(ID.parametro(p))).join(",\n  ")}\n);`,
    "",
    "-- Configurações restauradas ao valor que tinham antes do seed.",
    ...Object.entries(anteriores).map(
      ([chave, valor]) => `update configuracoes set valor = ${json(valor)} where chave = ${lit(chave)};`,
    ),
    "",
    "-- Conferência: tudo abaixo tem de voltar 0.",
    [
      `select 1 as ordem, 'pessoas exemplo'    as tabela, (select count(*) from pessoas  where origem_dado = 'exemplo') as linhas`,
      `union all select 2, 'jornadas exemplo',   (select count(*) from jornadas where origem_dado = 'exemplo')`,
      `union all select 3, 'croqui_calculos',    (select count(*) from croqui_calculos)`,
      `union all select 4, 'parametros EXEMPLO', (select count(*) from parametros_metodo where base_legal like ${lit(`${ROTULO_EXEMPLO}%`)})`,
      `union all select 5, 'pagamentos exemplo', (select count(*) from pagamentos where origem = 'exemplo')`,
      "order by ordem;",
    ].join("\n"),
  ];
  return partes.join("\n");
}

/**
 * Monta o arquivo inteiro. `alvo = "limpar"` gera o desfazer.
 *
 * O arquivo é UMA transação: ou entra tudo, ou não entra nada. Um mock pela
 * metade num banco compartilhado é pior do que nenhum mock.
 */
async function gerarSql(db: Cliente, alvo: Etapa | "limpar", caminho: string, manifesto: Manifesto): Promise<void> {
  const doBanco = await lerContextoDoBanco(db);
  const anteriores: Record<string, unknown> = {
    "croqui.horas_por_ato": doBanco.configuracoes["croqui.horas_por_ato"] ?? null,
    "croqui.uf_domicilio_vantajoso": doBanco.configuracoes["croqui.uf_domicilio_vantajoso"] ?? null,
  };

  const cabecalho = [
    "-- ===========================================================================",
    `-- ${alvo === "limpar" ? "LIMPEZA" : `SEED · jornada de exemplo até '${alvo}'`}`,
    "-- Gerado por scripts/seed-exemplo-completo.ts --sql",
    `-- em ${new Date().toISOString()} contra ${process.env.NEXT_PUBLIC_SUPABASE_URL ?? "(url ausente)"}`,
    "--",
    "-- Rodar como `postgres`/`service_role` (o MCP do Supabase serve). UMA transação:",
    "-- se qualquer passo falhar, nada entra. Re-executável: cada INSERT tem id estável",
    "-- e `on conflict do nothing`, e a purga inicial apaga o exemplo anterior.",
    "--",
    "-- NÃO toca: origem_dado='real', perfis_equipe, prompts_versoes,",
    "-- parametros_metodo reais, configuracoes['parametros.divergencias'].",
    alvo === "limpar"
      ? "--"
      : "-- ATENÇÃO: a purga inicial apaga TODA pessoa/jornada origem_dado='exemplo'\n-- (ordem do dono do produto, 05/09). É irreversível — o `raise notice` do PRÉ\n-- imprime quantas linhas mudam de valor ANTES do primeiro DELETE.",
    "-- ===========================================================================",
    "",
    "begin;",
    "",
    "-- Guarda: sem perfil admin/advogada ativo não há autor para carimbar, e as",
    "-- RPCs do croqui recusam com 42501. Falhar aqui é melhor que falhar no meio.",
    "do $$ begin",
    `  if ${PERFIL} is null then`,
    "    raise exception 'sem perfil admin/advogada ATIVO em perfis_equipe — o seed não inventa autor';",
    "  end if;",
    "end $$;",
    "",
  ].join("\n");

  const blocos: string[] = [];
  const secao = (titulo: string, corpo: string) =>
    blocos.push(`\n-- ---------------------------------------------------------------------------\n-- ${titulo}\n-- ---------------------------------------------------------------------------\n${corpo}`);

  if (alvo === "limpar") {
    secao("Desfazer tudo o que o seed criou", sqlLimpar(anteriores));
  } else {
    const ordem = ordemDa(alvo);
    secao("Purga de TODO dado de exemplo (o do João inclusive — recriado abaixo)", sqlPurga());
    secao("Parâmetros do método (rotulados EXEMPLO)", sqlParametros());
    secao("Configurações do croqui", sqlConfiguracoes(doBanco.configuracoes));
    secao("Pessoa, seminário, consentimentos e a jornada", sqlBase(alvo));
    if (ordem >= ordemDa("qualificado")) secao("Família, patrimônio e formulário", sqlQualificado());
    if (ordem >= ordemDa("sessao_contratada")) secao("Sessão paga e contato da equipe", sqlSessaoContratada());
    if (ordem >= ordemDa("sessao_agendada")) secao("Sessão agendada e presença confirmada", sqlSessaoAgendada(ordem >= ordemDa("sessao_realizada")));
    if (ordem >= ordemDa("sessao_realizada")) secao("Relatório, diagnóstico, material, radar e tarefa", sqlSessaoRealizada());
    if (ordem >= ordemDa("croqui_contratado")) {
      const motor = calcularParaOSql(doBanco);
      manifesto.croqui_calculo_id = null;
      secao("Croqui pago, CALCULADO PELO MOTOR, fixado e narrado", sqlCroquiContratado(motor));
      console.log(
        `  motor: ${Object.keys(motor.resultado.tabelas).length} tabelas · ` +
          `${motor.resultado.faltas.length} falta(s) agregada(s) · entrada com ${motor.entrada.bens.length} bens`,
      );
    }
    if (ordem >= ordemDa("croqui_apresentado")) secao("Apresentação e exportação do relatório", sqlCroquiApresentado());
    if (ordem >= ordemDa("holding_contratada")) secao("Holding contratada e os 19 marcos", sqlHolding(doBanco.marcos));
    secao("Cronologia — retroagir o que os gatilhos escreveram com now()", sqlCronologia());
    secao("Contagem final", sqlContagem());
  }

  const texto = `${cabecalho}${blocos.join("\n")}\n\ncommit;\n`;
  fs.mkdirSync(path.dirname(caminho), { recursive: true });
  fs.writeFileSync(caminho, texto, "utf8");

  // Manifesto: os mesmos campos do modo supabase-js, para o --limpar e para as URLs.
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const rotaDe: Record<string, string> = { material: "m", documentos: "d", confirmacao: "c", agendamento: "a", formulario: "f" };
  manifesto.etapa = alvo === "limpar" ? null : alvo;
  manifesto.pessoa_id = ID.pessoa;
  manifesto.jornada_id = ID.jornada;
  manifesto.edicao_id = ID.edicao;
  manifesto.croqui_id = alvo !== "limpar" && ordemDa(alvo) >= ordemDa("croqui_contratado") ? ID.croqui : null;
  manifesto.parametros_ids = PARAMETROS_EXEMPLO.map((p) => ID.parametro(p));
  manifesto.configuracoes_anteriores = anteriores;
  if (alvo !== "limpar" && ordemDa(alvo) >= ordemDa("sessao_agendada")) {
    manifesto.links = ["confirmacao", ...(ordemDa(alvo) >= ordemDa("sessao_realizada") ? ["material", "documentos"] : [])].map((tipo) => ({
      tipo,
      token: tokenELhash(tipo).token,
      url: `${base}/p/${rotaDe[tipo]}/${tokenELhash(tipo).token}`,
    }));
  }
  // Rotas do menu depois da Fase 6 (`/painel`→`/hoje`, `/esteira`→`/clientes`,
  // `/comunicacao`→`/mensagens`). A Ficha e o Croqui não mudaram de lugar.
  manifesto.urls = {
    hoje: `${base}/hoje`,
    clientes: `${base}/clientes`,
    ficha: `${base}/jornadas/${ID.jornada}`,
    agenda: `${base}/agenda`,
    mensagens: `${base}/mensagens`,
    ...(manifesto.croqui_id
      ? {
          croqui: `${base}/croquis/${ID.croqui}`,
          apresentar: `${base}/croquis/${ID.croqui}/apresentar`,
          simular: `${base}/croquis/${ID.croqui}/simular`,
        }
      : {}),
    ...Object.fromEntries(manifesto.links.map((l) => [`link_${l.tipo}`, l.url])),
  };
  manifesto.gerado_em = new Date().toISOString();
  gravarManifesto(manifesto);

  const linhas = texto.split("\n").length;
  console.log(`  ${caminho}  (${linhas} linhas, ${(texto.length / 1024).toFixed(1)} kB)`);
}

/**
 * Cliente só de LEITURA para o modo `--sql`: usa `service_role` se existir,
 * senão a sessão de um perfil interno (`SEED_EMAIL`/`SEED_SENHA` no ambiente —
 * credencial nunca fica no repositório). Precisa ler `parametros_metodo`,
 * `configuracoes` e `execucao_marcos`, que a RLS fecha para `anon`.
 */
async function clienteLeitura(): Promise<Cliente> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new ErroSeed("NEXT_PUBLIC_SUPABASE_URL ausente em .env.local.");
  const servico = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (servico) return createClient(url, servico, { auth: { autoRefreshToken: false, persistSession: false } });

  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const email = process.env.SEED_EMAIL;
  const senha = process.env.SEED_SENHA;
  if (!anon || !email || !senha) {
    throw new ErroSeed(
      "Para gerar o SQL sem SUPABASE_SERVICE_ROLE_KEY é preciso ler parametros_metodo/configuracoes " +
        "com uma sessão interna. Defina SEED_EMAIL e SEED_SENHA no ambiente (nunca no repositório):\n" +
        '  SEED_EMAIL="..." SEED_SENHA="..." npx tsx scripts/seed-exemplo-completo.ts --sql <arquivo>',
    );
  }
  const db = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await db.auth.signInWithPassword({ email, password: senha });
  if (error) throw new ErroSeed(`login com SEED_EMAIL falhou: ${error.message}`);
  return db;
}

// ---------------------------------------------------------------------------
// Programa
// ---------------------------------------------------------------------------

function ajuda(): void {
  console.log(`
seed-exemplo-completo.ts — a jornada de exemplo do SIC-HF, de ponta a ponta.

  npx tsx scripts/seed-exemplo-completo.ts
      Cria a pessoa de exemplo (João Pedro Alves Assunção) na PRIMEIRA etapa da
      esteira: seminário, respostas, consentimentos. Sem pagamento, sem
      agendamento — pronto para percorrer a esteira de verdade pelo sistema.

  npx tsx scripts/seed-exemplo-completo.ts --etapa <etapa>
      Avança a jornada até <etapa>, criando tudo que aquela etapa exige.
      Etapas válidas, na ordem:
        ${ETAPAS.join("\n        ")}
      A última (holding_contratada) é o estado FINAL completo: croqui calculado
      pelo motor, versão fixada, narrativa, apresentação, material, radar
      conferido e os 19 marcos de execução.

  npx tsx scripts/seed-exemplo-completo.ts --limpar
      Apaga tudo que o script criou: a pessoa de exemplo e sua jornada inteira,
      os parâmetros do método rotulados EXEMPLO e restaura as configurações
      tocadas ao valor anterior (manifesto em tmp/squad/mock-exemplo.manifesto.json).

  npx tsx scripts/seed-exemplo-completo.ts --sql <arquivo.sql> [--etapa <etapa>]
  npx tsx scripts/seed-exemplo-completo.ts --sql <arquivo.sql> --limpar
      NÃO escreve no banco: gera um arquivo SQL transacional (begin; … commit;)
      com tudo o que o modo acima faria, para rodar como postgres/service_role
      (o MCP do Supabase serve). O cálculo do croqui é feito aqui pelo motor e
      embutido no registrar_croqui_calculo. Só LÊ o banco (parametros_metodo,
      configuracoes, execucao_marcos) — com SUPABASE_SERVICE_ROLE_KEY se houver,
      senão com SEED_EMAIL/SEED_SENHA do ambiente.

  npx tsx scripts/seed-exemplo-completo.ts --demo
  npx tsx scripts/seed-exemplo-completo.ts --demo --limpar
      As 4 FAMÍLIAS DE DEMONSTRAÇÃO (Andrade, Bittencourt, Carvalho, Delmonte),
      cada uma numa etapa diferente da esteira, para o kanban de Clientes ter o
      que mostrar numa apresentação. Delega para scripts/seed-demo.ts — é o
      mesmo comando, escrito nos dois lugares porque é onde as pessoas procuram.
      Roteiro da apresentação: docs/APRESENTACAO.md.

Opções:
  --manter-outros-exemplos   não apaga as outras pessoas origem_dado='exemplo'
                             (por padrão elas SÃO apagadas — ordem do dono do produto).
                             As 4 famílias do --demo são preservadas SEMPRE: só
                             "--demo --limpar" (ou o --limpar deste script, que
                             limpa TODO exemplo) as remove.
  --help                     esta tela.

O modo que escreve direto exige SUPABASE_SERVICE_ROLE_KEY; os dois exigem
LINK_PUBLICO_PEPPER (é ela que gera o hash do token dos links públicos).
`);
}

function argumento(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) return process.argv[i + 1];
  const comIgual = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return comIgual?.slice(nome.length + 3);
}
const temFlag = (nome: string) => process.argv.includes(`--${nome}`);

async function main(): Promise<void> {
  carregarEnvLocal();
  if (temFlag("help") || temFlag("h")) return ajuda();

  const linhas: string[] = [];
  const registrar = (s: string) => {
    linhas.push(s);
    console.log(s);
  };

  // --- modo demo: as 4 famílias de demonstração (scripts/seed-demo.ts) -----
  if (temFlag("demo")) {
    const db = clienteAdmin();
    if (temFlag("limpar")) {
      await limparDemo(db, registrar);
      return;
    }
    await rodarDemo(db, registrar);
    return;
  }

  const etapaBruta = argumento("etapa");
  if (etapaBruta && !(ETAPAS as readonly string[]).includes(etapaBruta)) {
    console.error(`Etapa desconhecida: '${etapaBruta}'. Válidas: ${ETAPAS.join(", ")}`);
    process.exit(2);
  }

  // --- modo SQL: gera o arquivo, não escreve no banco ----------------------
  const caminhoSql = argumento("sql");
  if (caminhoSql) {
    const leitura = await clienteLeitura();
    const alvoSql: Etapa | "limpar" = temFlag("limpar") ? "limpar" : ((etapaBruta as Etapa) ?? "captado");
    console.log(`\n=== GERAR SQL · ${alvoSql} ===\n`);
    await gerarSql(leitura, alvoSql, path.resolve(RAIZ, caminhoSql), lerManifesto());
    console.log("\nRodar como postgres/service_role. Nada foi escrito no banco por este comando.\n");
    return;
  }

  const db = clienteAdmin();
  const manifesto = lerManifesto();

  if (temFlag("limpar")) {
    console.log("\n=== LIMPAR ===\n");
    await limparTudo(db, manifesto, registrar);
    console.log("\nPronto. O banco voltou ao estado anterior ao seed (menos os outros exemplos, que são irreversíveis).\n");
    return;
  }

  const alvo: Etapa = (etapaBruta as Etapa) ?? "captado";

  console.log(`\n=== SEED · jornada de exemplo até '${alvo}' ===\n`);

  const perfilId = await perfilAutor(db);

  // --- rebobinar --------------------------------------------------------
  // A máquina de estados da 0004 proíbe etapa REGREDIR (`transicao_invalida`),
  // e `familiares.registrado_na_jornada_id` é RESTRICT — não dá para apagar só
  // a jornada. Rebobinar é, portanto, recriar a pessoa inteira. Como TODO id
  // que importa é determinístico (`ID.*`), a jornada volta com o MESMO uuid:
  // as URLs e as capturas continuam valendo.
  {
    const { data: atual } = await db
      .from("jornadas")
      .select("id, etapa")
      .eq("id", ID.jornada)
      .maybeSingle();
    const etapaAtual = (atual as { etapa: Etapa } | null)?.etapa;
    if (etapaAtual && ordemDa(etapaAtual) > ordemDa(alvo)) {
      registrar(`rebobinando de '${etapaAtual}' para '${alvo}' — a pessoa de exemplo é recriada com os mesmos ids`);
      const conta = await apagarPessoas(db, [ID.pessoa]);
      for (const [t, n] of Object.entries(conta).sort()) registrar(`  − ${t}: ${n}`);
    }
  }

  // --- base: edição + pessoa + jornada -------------------------------------
  const { linha: edicao } = await acharOuCriar<{ id: string }>(db, "edicoes_seminario", { codigo: CODIGO_EDICAO }, {
    id: ID.edicao,
    nome: "Seminário de exemplo — SIC-HF",
    inicio_em: DATAS.seminario_inicio.slice(0, 10),
    fim_em: DATAS.seminario_fim.slice(0, 10),
    ativa: true,
    origem_dado: "exemplo",
  });
  const { linha: pessoa, criou: pessoaNova } = await acharOuCriar<{ id: string }>(db, "pessoas", { email: EMAIL_PESSOA }, {
    id: ID.pessoa,
    nome: NOME_PESSOA,
    telefone: TELEFONE_PESSOA,
    cidade: MUNICIPIO,
    uf: UF,
    profissao: "Empresário — distribuição",
    faixa_etaria: "45-54",
    estado_civil: "casado",
    // `pessoas` não tem coluna de CPF (0003 e nenhuma migration posterior criou).
    observacoes: `Pessoa de EXEMPLO do seed de demonstração. CPF informado pelo dono do produto: ${CPF_PESSOA} (não há coluna de CPF no schema).`,
    ativo: true,
    origem_dado: "exemplo",
    criado_por: perfilId,
    criado_em: DATAS.captado,
  });
  await acharOuCriar(db, "participacoes_seminario", { pessoa_id: pessoa.id, edicao_id: edicao.id }, {
    origem: "seminario",
    dias_assistidos: 3,
    registrado_em: DATAS.captado,
    criado_em: DATAS.captado,
  });
  // Chave natural = a PESSOA, não `desfecho='aberta'`: no estado final o
  // desfecho vira 'ganha' e uma segunda rodada criaria uma jornada nova
  // (duplicando a pessoa na Esteira). `maybeSingle()` também protege: duas
  // jornadas para a mesma pessoa de exemplo viram erro, não silêncio.
  const { linha: jornada } = await acharOuCriar<{ id: string }>(db, "jornadas", { id: ID.jornada }, {
    pessoa_id: pessoa.id,
    desfecho: "aberta",
    edicao_id: edicao.id,
    origem: "seminario",
    trilha: "seminario",
    etapa: "captado",
    nivel_pago: 0,
    responsavel_id: perfilId,
    origem_dado: "exemplo",
    entrou_na_etapa_em: DATAS.captado,
    criado_por: perfilId,
    criado_em: DATAS.captado,
  });

  manifesto.pessoa_id = pessoa.id;
  manifesto.jornada_id = jornada.id;
  manifesto.edicao_id = edicao.id;
  manifesto.etapa = alvo;
  gravarManifesto(manifesto);
  registrar(`pessoa ${pessoaNova ? "criada" : "reaproveitada"}: ${pessoa.id} · jornada ${jornada.id}`);

  // --- os outros exemplos --------------------------------------------------
  if (!temFlag("manter-outros-exemplos")) {
    console.log("\n--- apagando as OUTRAS pessoas de exemplo (ordem do dono do produto) ---\n");
    await apagarOutrosExemplos(db, pessoa.id, manifesto, registrar);
    gravarManifesto(manifesto);
  }

  const ctx: Contexto = { db, perfilId, pessoaId: pessoa.id, jornadaId: jornada.id, edicaoId: edicao.id, manifesto, registrar };

  // --- rebobina, se for o caso --------------------------------------------
  console.log("\n--- montando as camadas ---\n");
  await limparAcimaDe(ctx, alvo);

  await cadastrarParametros(ctx);
  await ajustarConfiguracoes(ctx);

  const blocos: Array<[Etapa, (c: Contexto) => Promise<void>]> = [
    ["captado", blocoCaptado],
    ["qualificado", blocoQualificado],
    ["sessao_contratada", blocoSessaoContratada],
    ["sessao_agendada", blocoSessaoAgendada],
    ["sessao_realizada", blocoSessaoRealizada],
    ["croqui_contratado", blocoCroquiContratado],
    ["croqui_apresentado", blocoCroquiApresentado],
    ["holding_contratada", blocoHoldingContratada],
  ];

  for (const [etapa, bloco] of blocos) {
    if (ordemDa(etapa) > ordemDa(alvo)) break;
    // Etapa NÃO paga: sobe ANTES do bloco — o piso de nível pago da 0004 recusa
    // etapa abaixo do que o pagamento já pagou.
    // Etapa PAGA (0084/D5): o bloco vem primeiro, porque é ele que grava o
    // pagamento, e o TETO só deixa entrar em `sessao_contratada`/
    // `croqui_contratado`/`holding_contratada` com o dinheiro já registrado.
    if (ETAPAS_PAGAS.has(etapa)) {
      await bloco(ctx);
      await moverAte(ctx, etapa);
    } else {
      await moverAte(ctx, etapa);
      await bloco(ctx);
    }
    gravarManifesto(manifesto);
  }
  // Varredura: qualquer OUTRA jornada da pessoa de exemplo é fantasma (só o
  // `processar_pagamento_hotmart` cria uma, e o seed não quer nenhuma).
  {
    const fantasmas = (await ids(db, "jornadas", "id", { pessoa_id: pessoa.id })).filter((id) => id !== ID.jornada);
    if (fantasmas.length > 0) {
      registrar(`${fantasmas.length} jornada(s) fantasma da pessoa de exemplo — removendo`);
      for (const [t, n] of Object.entries(await apagarJornadas(db, fantasmas))) registrar(`  − ${t}: ${n}`);
    }
  }

  await ajustarCronologia(ctx);
  // A régua de boas-vindas enfileirou e-mail e WhatsApp DE VERDADE (o gatilho
  // `app.regua_boas_vindas` roda dentro da RPC do pagamento). O destinatário é
  // fictício: deixar `pendente` é deixar o cron mandando mensagem de mock para
  // o mundo. Ficam canceladas — a história continua na linha do tempo.
  {
    // Varredura final (o cancelamento de verdade acontece colado em cada
    // pagamento). `falhou` entra no filtro: sem chave de envio o cron marca
    // `falhou` em vez de `pendente`, e um filtro só-`pendente` deixaria o lixo
    // para sempre na tela de Pendências.
    const n = await cancelarMensagensDaJornada(ctx.db, [ctx.jornadaId], { agendadaPara: DATAS.boas_vindas });
    if (n > 0) registrar(`${n} mensagem(ns) de exemplo canceladas (destinatário fictício)`);
  }

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  // Link que não existe mais (rebobinada apagou) sai do manifesto: URL de link
  // apagado é URL que dá 404 na mão do João.
  {
    const vivos = new Set(await ids(db, "links_publicos", "tipo", { jornada_id: jornada.id }));
    manifesto.links = manifesto.links.filter((l) => vivos.has(l.tipo));
  }
  // Rotas do menu depois da Fase 6 (`/painel`→`/hoje`, `/esteira`→`/clientes`,
  // `/comunicacao`→`/mensagens`). A Ficha e o Croqui não mudaram de lugar.
  manifesto.urls = {
    hoje: `${base}/hoje`,
    clientes: `${base}/clientes`,
    ficha: `${base}/jornadas/${jornada.id}`,
    agenda: `${base}/agenda`,
    mensagens: `${base}/mensagens`,
    ...(manifesto.croqui_id
      ? {
          croqui: `${base}/croquis/${manifesto.croqui_id}`,
          apresentar: `${base}/croquis/${manifesto.croqui_id}/apresentar`,
          simular: `${base}/croquis/${manifesto.croqui_id}/simular`,
        }
      : {}),
    ...Object.fromEntries(manifesto.links.map((l) => [`link_${l.tipo}`, l.url])),
  };
  manifesto.gerado_em = new Date().toISOString();
  gravarManifesto(manifesto);

  console.log("\n=== URLs ===\n");
  for (const [nome, url] of Object.entries(manifesto.urls)) console.log(`  ${nome.padEnd(16)} ${url}`);
  console.log(`\nManifesto: ${CAMINHO_MANIFESTO}\n`);
}

// `require.main` deixa este arquivo ser IMPORTADO por um teste de mesa sem
// disparar o seed. A prova do motor (tmp/) importa `PARAMETROS_EXEMPLO` e
// `HORAS_POR_ATO` daqui para conferir os MESMOS valores que o seed grava —
// nunca uma cópia que possa divergir em silêncio.
if (require.main === module) {
  main().catch((erro: unknown) => {
    console.error(`\nFALHOU: ${erro instanceof Error ? erro.message : String(erro)}\n`);
    process.exit(1);
  });
}
