/**
 * scripts/seed-demo.ts
 *
 * As QUATRO FAMÍLIAS DE DEMONSTRAÇÃO do SIC-HF — um kanban vivo para o João
 * apresentar o sistema à Dra. Elaine e à equipe.
 *
 *   npx tsx scripts/seed-demo.ts              # cria (ou reconcilia) as 4 famílias
 *   npx tsx scripts/seed-demo.ts --limpar     # apaga SÓ o que este script criou
 *   npx tsx scripts/seed-demo.ts --help
 *
 * Os mesmos comandos existem no outro seed (`seed-exemplo-completo.ts --demo`
 * e `--demo --limpar`), porque é lá que a pessoa procura primeiro.
 *
 * ## As quatro
 *
 * | Família     | Etapa                | O que a tela mostra                              |
 * |-------------|----------------------|--------------------------------------------------|
 * | Andrade     | `captado`            | veio do seminário, respondeu o formulário. Nada mais. |
 * | Bittencourt | `sessao_agendada`    | pagou a SV, sessão marcada, BRIEFING pronto      |
 * | Carvalho    | `croqui_contratado`  | croqui EM ELABORAÇÃO: motor calculado + Cenário Patrimonial |
 * | Delmonte    | `holding_contratada` | desfecho `ganha`, execução em andamento (marcos parciais) |
 *
 * ## Cinco regras que este script não quebra
 *
 * 1. **Nada fora de `origem_dado='exemplo'`.** E, dentro do exemplo, nada fora
 *    dos ids determinísticos derivados de `MARCA_DEMO` — a pessoa do João
 *    (outra marca) não é lida nem tocada por nenhum caminho daqui.
 * 2. **Nenhuma chamada de IA.** O briefing da Bittencourt é conteúdo escrito à
 *    mão, gravado por `registrar_briefing` sobre uma `execucoes_ia` com
 *    `modo='demonstracao'` — que é justamente o que faz a 0027 (restaurada
 *    pela 0076) carimbar `origem_dado='exemplo'` no briefing. Sem plano B: se
 *    a RPC recusar, o seed para. Custo: US$ 0,00.
 * 3. **Nenhuma ligação é discada.** `ligacao_ia.automatica` está LIGADO em
 *    produção: o gatilho da 0053 enfileira uma ligação a cada pagamento
 *    aprovado de Sessão de Viabilidade. Os telefones de demonstração são
 *    `+55 00 …` — DDD que não existe — e `telefoneParaLigacao()` os recusa
 *    (`ddd_inexistente`). O script fecha a fila pelo CAMINHO REAL
 *    (`dispararAgora`), que cai no provedor manual e vira TAREFA para a
 *    equipe. Ao fim, zero ligação de demonstração em `na_fila`/`discando`.
 * 4. **O croqui é calculado pelo motor de verdade** (`calcularParaJornada` →
 *    `registrarCalculo` → `fixar_croqui_calculo`), com os parâmetros que já
 *    existem no banco. Se faltar parâmetro, o script PARA e diz qual — croqui
 *    que não fecha não vira mock silencioso.
 * 5. **Idempotente.** Toda linha tem chave natural ou id determinístico:
 *    rodar duas vezes não duplica nada.
 * 6. **Nenhuma mensagem sai.** Os gatilhos da régua (0011/0020/0051) enfileiram
 *    e-mail DE VERDADE dentro da transação do seed, já vencido — e o cron da
 *    Hostinger reivindica a fila a cada 5 minutos. Cada gatilho é selado no
 *    instante seguinte (`selarRegua`), a varredura final repete, e no fim
 *    `auditarMensagens` conta: `enviada`/`enviando` vira AVISO no terminal.
 *
 * ## Por que `service_role`
 *
 * Mesmo motivo do `seed-exemplo-completo.ts`: as RPCs do croqui e do briefing
 * têm EXECUTE só para `service_role`, `pagamentos`/`execucoes_ia` não aceitam
 * INSERT de `authenticated`, e DELETE foi revogado de `authenticated` em toda
 * tabela (0065b/0065c/0069/0070).
 */

import crypto from "node:crypto";
import { chaveItemRadar } from "../src/lib/radar/derivar";
import { dispararAgora } from "../src/server/ligacao-ia";
import { calcularParaJornada, registrarCalculo } from "../src/server/motor-croqui/servico";
import type { LigacaoIa } from "../src/types/integracoes";
import {
  acharOuCriar,
  apagar,
  apagarJornadas,
  apagarPessoas,
  atualizar,
  cancelarMensagensDaJornada,
  carregarEnvLocal,
  clienteAdmin,
  conferirSoExemplo,
  DIA,
  ErroSeed,
  ids,
  inserir,
  perfilAutor,
  produtoPorTipo,
  quando,
  uidDe,
  type Cliente,
} from "./seed-comum";

// ---------------------------------------------------------------------------
// Identidade da demonstração
// ---------------------------------------------------------------------------

/** Marca própria: nenhum id daqui colide com o do `seed-exemplo-completo.ts`. */
export const MARCA_DEMO = "DEMO-SICHF-FAMILIAS";
const uid = (chave: string) => uidDe(MARCA_DEMO, chave);

const CODIGO_EDICAO = "SEM-DEMO-2026";
const ID_EDICAO = uid("edicao");

/** Etapas da esteira, na ordem da 0004. */
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

// ---------------------------------------------------------------------------
// Conteúdo das quatro famílias
// ---------------------------------------------------------------------------

interface BemDemo {
  tipo: string;
  descricao: string;
  ano_aquisicao: number;
  valor_historico: number;
  valor_mercado: number;
  destinacao: string;
  valor_locacao_mensal: number | null;
  detalhes: Record<string, unknown>;
}

interface FamiliarDemo {
  parentesco: string;
  nome: string;
  idade: number;
  ocupacao: string;
  regime_casamento: string | null;
  ano_casamento: number | null;
  dependente_financeiro: boolean;
}

interface BlocoDiagnostico {
  chave: string;
  titulo: string;
  conteudo: string;
  pontos: string[];
  fontes: string[];
  categoria: string;
  visivel_ao_cliente: boolean;
}

interface FamiliaDemo {
  slug: string;
  alvo: Etapa;
  /** Há quantos dias esta família entrou pelo seminário. */
  dias: number;
  nome: string;
  email: string;
  /** SEMPRE `+5500…` — DDD inexistente, recusado por `telefoneParaLigacao`. */
  telefone: string;
  cidade: string;
  uf: string;
  profissao: string;
  faixa_etaria: string;
  estado_civil: string;
  faixa_patrimonio: string | null;
  diasAssistidos: number;
  respostasSeminario: Array<[string, string]>;
  familiares: FamiliarDemo[];
  patrimonio: BemDemo[];
  respostasFormulario?: Record<string, unknown>;
  ligacao?: {
    expectativa_principal: string;
    preocupacao_principal: string;
    objecoes_percebidas: string[];
    pessoas_mencionadas: string[];
    frases_marcantes: string[];
    observacoes: string;
  };
  /** Quando a sessão está/estará marcada, em dias — negativo = futuro. */
  sessaoEmDias?: number;
  briefing?: Record<string, unknown>;
  relatorio?: Record<string, unknown>;
  diagnostico?: BlocoDiagnostico[];
  cenarios?: Array<{
    cenario: string;
    nota: string;
    rubricas: Array<{
      rubrica: string;
      procedencia: "calculado" | "digitado" | "ausente";
      valor?: number;
      base_calculo?: number;
      chaveParametro?: string;
      nota: string;
    }>;
  }>;
  /** Quantos dos 19 marcos de execução já foram concluídos (só `ganha`). */
  marcosConcluidos?: number;
}

const CONSENTIMENTOS = ["comunicacao_email", "comunicacao_whatsapp", "gravacao_sessao", "tratamento_ia"];

export const FAMILIAS: FamiliaDemo[] = [
  // -------------------------------------------------------------------------
  // 1 · captado — o topo da esteira, ainda sem nada além do seminário
  // -------------------------------------------------------------------------
  {
    slug: "andrade",
    alvo: "captado",
    dias: 6,
    nome: "Antônio Ribeiro de Andrade (demonstração)",
    email: "antonio.andrade@exemplo.com.br",
    telefone: "+5500900000001",
    cidade: "Sorocaba",
    uf: "SP",
    profissao: "Comerciante aposentado",
    faixa_etaria: "65-74",
    estado_civil: "viuvo",
    faixa_patrimonio: "R$ 500 mil a R$ 1 milhão",
    diasAssistidos: 3,
    respostasSeminario: [
      ["O que te trouxe ao seminário?", "Minha esposa faleceu no ano passado e o inventário ainda não terminou. Não quero deixar isso para os meus dois filhos."],
      ["Qual sua maior preocupação hoje?", "A casa e a loja estão no meu nome. Se acontecer alguma coisa comigo, eles não vão saber por onde começar."],
      ["Você já ouviu falar de holding familiar?", "Ouvi no seminário pela primeira vez. Achava que era coisa de gente muito rica."],
      ["O que você espera de uma conversa com a equipe?", "Entender se, no meu caso, vale a pena — e quanto custa."],
    ],
    familiares: [],
    patrimonio: [],
  },

  // -------------------------------------------------------------------------
  // 2 · sessao_agendada — pagou a SV, sessão na agenda, briefing pronto
  // -------------------------------------------------------------------------
  {
    slug: "bittencourt",
    alvo: "sessao_agendada",
    dias: 24,
    nome: "Cláudia Bittencourt Nogueira (demonstração)",
    email: "claudia.bittencourt@exemplo.com.br",
    telefone: "+5500900000002",
    cidade: "São Paulo",
    uf: "SP",
    profissao: "Cirurgiã-dentista — clínica própria",
    faixa_etaria: "45-54",
    estado_civil: "casado",
    faixa_patrimonio: "R$ 1 milhão a R$ 2 milhões",
    diasAssistidos: 3,
    sessaoEmDias: -2,
    respostasSeminario: [
      ["O que te trouxe ao seminário?", "Tenho uma clínica com o meu marido e dois filhos adolescentes. Nunca paramos para pensar no que acontece se um de nós faltar."],
      ["Qual sua maior preocupação hoje?", "A clínica não anda sem nós dois. E o apartamento que a gente aluga é a renda que paga a escola."],
      ["Quem decide com você as questões financeiras?", "Meu marido. A gente decide junto, sempre."],
      ["O que você espera da Sessão de Viabilidade?", "Saber se faz sentido para o nosso tamanho de patrimônio, sem enrolação."],
    ],
    familiares: [
      { parentesco: "conjuge", nome: "Rodrigo Nogueira (demonstração)", idade: 51, ocupacao: "Cirurgião-dentista", regime_casamento: "comunhão parcial de bens", ano_casamento: 2006, dependente_financeiro: false },
      { parentesco: "filho", nome: "Beatriz Bittencourt Nogueira (demonstração)", idade: 17, ocupacao: "Estudante", regime_casamento: null, ano_casamento: null, dependente_financeiro: true },
      { parentesco: "filho", nome: "Tomás Bittencourt Nogueira (demonstração)", idade: 14, ocupacao: "Estudante", regime_casamento: null, ano_casamento: null, dependente_financeiro: true },
    ],
    patrimonio: [
      { tipo: "imovel", descricao: "Apartamento — Perdizes, São Paulo/SP (residência)", ano_aquisicao: 2011, valor_historico: 520_000, valor_mercado: 1_150_000, destinacao: "residencia", valor_locacao_mensal: null, detalhes: {} },
      { tipo: "imovel", descricao: "Apartamento — Pinheiros, São Paulo/SP (locado)", ano_aquisicao: 2018, valor_historico: 430_000, valor_mercado: 720_000, destinacao: "locacao", valor_locacao_mensal: 3_900, detalhes: {} },
      { tipo: "empresa", descricao: "Clínica Bittencourt Nogueira Ltda. — 50% das quotas", ano_aquisicao: 2009, valor_historico: 180_000, valor_mercado: 640_000, destinacao: "operacional", valor_locacao_mensal: null, detalhes: { faturamento_mensal: 185_000, custo_operacional_mensal: 142_000, participacao_percentual: 50 } },
      { tipo: "investimento", descricao: "Fundo de renda fixa — reserva da família", ano_aquisicao: 2016, valor_historico: 210_000, valor_mercado: 268_000, destinacao: "uso", valor_locacao_mensal: null, detalhes: {} },
      { tipo: "veiculo", descricao: "Volvo XC40 2022 — placa de demonstração", ano_aquisicao: 2022, valor_historico: 245_000, valor_mercado: 198_000, destinacao: "uso", valor_locacao_mensal: null, detalhes: {} },
    ],
    respostasFormulario: {
      p1: "Cláudia Bittencourt Nogueira",
      p2: "São Paulo/SP",
      p3: "Cirurgiã-dentista — clínica própria",
      p4: "45-54",
      p5: "casado",
      p6: 2,
      p7: false,
      p8: true,
      p9: "R$ 1 milhão a R$ 2 milhões",
      p10: ["Imóveis", "Veículos", "Investimentos", "Empresa"],
      p11: 3,
      p12: "Vi uma colega perder a clínica num inventário. Não quero repetir isso.",
      p13: "Que a clínica pare e os meninos fiquem sem a renda do aluguel.",
      p14: "Decidimos em conjunto",
      p15: true,
      p16: "Quero saber se vale para o nosso tamanho, e quanto custa.",
      p17: false,
    },
    ligacao: {
      expectativa_principal: "Entender se o porte do patrimônio dela justifica a estrutura.",
      preocupacao_principal: "A clínica depender dos dois sócios, que são o casal.",
      objecoes_percebidas: ["Acha que holding é para patrimônio muito maior", "Vai querer conversar com o contador antes"],
      pessoas_mencionadas: ["Rodrigo (marido e sócio)", "Beatriz e Tomás (filhos adolescentes)"],
      frases_marcantes: [
        "A clínica não anda sem nós dois.",
        "Uma colega minha perdeu a clínica num inventário.",
      ],
      observacoes: "Contato da equipe (demonstração). Objetiva, pergunta preço cedo, decide junto com o marido.",
    },
    briefing: {
      resumo_executivo:
        "Casal de sócios na mesma clínica, dois filhos menores, patrimônio concentrado em imóvel de residência e na operação. Decide em conjunto e pede número antes de conceito. A dúvida real não é se quer organizar — é se o porte dela justifica a estrutura.",
      perfil_disc: {
        predominante: "C",
        secundario: "D",
        confianca: 74,
        evidencias: [
          "Pediu, na ligação, o critério de porte antes de qualquer explicação de estrutura.",
          "Respondeu ao formulário inteiro, inclusive os campos opcionais.",
        ],
      },
      arquetipo_patrimonial: {
        escolhido: "Profissional liberal com operação familiar",
        justificativa: "A renda vem do trabalho dos dois sócios; o patrimônio acumulado é imobiliário e de reserva, não de participações.",
        evidencias: ["Clínica com 50% das quotas dela", "Apartamento locado como renda declarada"],
      },
      o_que_protege: {
        objeto: "A continuidade da clínica e a renda do aluguel que paga a escola dos filhos.",
        justificativa: "Foi o que ela nomeou duas vezes, sem ser perguntada.",
      },
      motivadores: {
        principal: "Evitar que os filhos menores fiquem sem renda enquanto um inventário corre.",
        secundarios: ["Não repetir o caso da colega", "Organizar antes de os filhos ficarem maiores"],
        justificativa: "Os dois filhos são menores; qualquer bloqueio cai sobre eles.",
      },
      objecoes_provaveis: [
        { objecao: "Meu patrimônio é pequeno demais para holding.", probabilidade: "alta", justificativa: "Disse isso com essas palavras no seminário e na ligação." },
        { objecao: "Preciso falar com o meu contador.", probabilidade: "media", justificativa: "Mencionou o contador como quem 'cuida da clínica'." },
      ],
      processo_decisorio: {
        velocidade: "media",
        necessidade_seguranca: "alta",
        necessidade_validacao: "alta",
        necessidade_detalhe: "alta",
        nivel_autoridade: "decisao_conjunta",
        decisores_presentes_na_sessao: "sim",
        decisores: ["Cláudia", "Rodrigo (marido e sócio)"],
      },
      linguagem_recomendada: {
        tom: ["objetiva", "tecnica"],
        justificativa: "Profissional de saúde, acostumada a protocolo. Analogia solta soa como venda.",
      },
      pontos_de_atencao: [
        { nao_fazer: "Falar em 'proteção patrimonial' sem número.", motivo: "Ela lê isso como discurso comercial e fecha." },
        { nao_fazer: "Conduzir a sessão só com ela.", motivo: "O marido é sócio e decide junto; sem ele não há decisão." },
      ],
      perguntas_para_aprofundar: [
        { pergunta: "Se um de vocês dois parasse de atender por seis meses, a clínica se mantém?", motivo: "Traz a dependência dos sócios para o concreto." },
        { pergunta: "O aluguel do apartamento de Pinheiros é a renda de quê, hoje?", motivo: "Ela já ligou esse aluguel à escola dos filhos — confirmar transforma isso em critério." },
      ],
      frases_para_o_fechamento: [
        { frase_literal: "A clínica não anda sem nós dois.", como_usar: "Usar ao explicar por que a estrutura separa operação de patrimônio." },
        { frase_literal: "Uma colega minha perdeu a clínica num inventário.", como_usar: "Abrir o custo da inércia com o caso que ela própria trouxe." },
      ],
      estrategia_sessao: {
        ritmo: "medio",
        mais_tempo_em: ["custo da inércia", "critério de porte"],
        menos_tempo_em: ["história do escritório"],
        momento_croqui: "Depois de ela mesma dizer que o porte justifica.",
        momento_investimento: "No fim, junto do comparativo.",
        tratamento_objecoes: "Responder 'patrimônio pequeno' com a conta do inventário do próprio caso, não com regra geral.",
      },
      estrategia_fechamento:
        "Fechar pela conta: o custo do inventário dela, hoje, contra o custo de organizar. Com o marido na sala.",
      grau_confianca: 74,
      lacunas: [
        "Valor de mercado das quotas da clínica é declaração, não avaliação.",
        "Não há transcrição de sessão — o briefing é de demonstração, escrito à mão, sem IA.",
      ],
    },
  },

  // -------------------------------------------------------------------------
  // 3 · croqui_contratado — CROQUI EM ELABORAÇÃO
  // -------------------------------------------------------------------------
  {
    slug: "carvalho",
    alvo: "croqui_contratado",
    dias: 52,
    nome: "Ubirajara Carvalho Pontes (demonstração)",
    email: "ubirajara.carvalho@exemplo.com.br",
    telefone: "+5500900000003",
    cidade: "São Paulo",
    uf: "SP",
    profissao: "Empresário — construção civil",
    faixa_etaria: "55-64",
    estado_civil: "casado",
    faixa_patrimonio: "Acima de R$ 2 milhões",
    diasAssistidos: 3,
    sessaoEmDias: 38,
    respostasSeminario: [
      ["O que te trouxe ao seminário?", "Tenho três filhos de dois casamentos. Se eu morrer hoje, eles se entendem no papel e não na prática."],
      ["Qual sua maior preocupação hoje?", "A construtora. Meu filho mais velho toca a obra comigo; os outros dois nunca entraram."],
      ["Você já ouviu falar de holding familiar?", "Já montei uma há dez anos com um contador. Nunca funcionou como me venderam."],
      ["O que você espera da Sessão de Viabilidade?", "Quero ver a conta, não a promessa."],
    ],
    familiares: [
      { parentesco: "conjuge", nome: "Vera Lúcia Pontes (demonstração)", idade: 54, ocupacao: "Administradora", regime_casamento: "separação total de bens", ano_casamento: 2012, dependente_financeiro: false },
      { parentesco: "filho", nome: "Ubirajara Carvalho Pontes Filho (demonstração)", idade: 31, ocupacao: "Engenheiro civil — trabalha na construtora", regime_casamento: null, ano_casamento: null, dependente_financeiro: false },
      { parentesco: "filho", nome: "Letícia Carvalho Pontes (demonstração)", idade: 27, ocupacao: "Médica veterinária", regime_casamento: null, ano_casamento: null, dependente_financeiro: false },
      { parentesco: "filho", nome: "Otávio Carvalho Pontes (demonstração)", idade: 15, ocupacao: "Estudante", regime_casamento: null, ano_casamento: null, dependente_financeiro: true },
    ],
    patrimonio: [
      { tipo: "imovel", descricao: "Casa — Alto de Pinheiros, São Paulo/SP (residência)", ano_aquisicao: 2013, valor_historico: 1_900_000, valor_mercado: 4_700_000, destinacao: "residencia", valor_locacao_mensal: null, detalhes: {} },
      { tipo: "imovel", descricao: "Três lojas — Lapa, São Paulo/SP (locadas)", ano_aquisicao: 2008, valor_historico: 940_000, valor_mercado: 2_600_000, destinacao: "locacao", valor_locacao_mensal: 17_400, detalhes: {} },
      { tipo: "imovel", descricao: "Terreno — Barueri/SP (estoque da construtora)", ano_aquisicao: 2019, valor_historico: 1_250_000, valor_mercado: 2_100_000, destinacao: "uso da empresa", valor_locacao_mensal: null, detalhes: {} },
      { tipo: "imovel", descricao: "Apartamento — Guarujá/SP (uso da família)", ano_aquisicao: 2016, valor_historico: 680_000, valor_mercado: 1_100_000, destinacao: "uso", valor_locacao_mensal: null, detalhes: { vender_para_levantar: true } },
      { tipo: "empresa", descricao: "Carvalho Pontes Construções Ltda. — 70% das quotas", ano_aquisicao: 2002, valor_historico: 900_000, valor_mercado: 6_200_000, destinacao: "operacional", valor_locacao_mensal: null, detalhes: { faturamento_mensal: 2_100_000, custo_operacional_mensal: 1_780_000, participacao_percentual: 70 } },
      { tipo: "empresa", descricao: "CP Incorporações SPE Ltda. — 100% das quotas", ano_aquisicao: 2020, valor_historico: 400_000, valor_mercado: 980_000, destinacao: "operacional", valor_locacao_mensal: null, detalhes: { participacao_percentual: 100 } },
      { tipo: "investimento", descricao: "Carteira multimercado — banco de investimento", ano_aquisicao: 2015, valor_historico: 1_400_000, valor_mercado: 1_820_000, destinacao: "uso", valor_locacao_mensal: null, detalhes: {} },
      { tipo: "previdencia", descricao: "PGBL — plano do titular", ano_aquisicao: 2010, valor_historico: 560_000, valor_mercado: 690_000, destinacao: "uso", valor_locacao_mensal: null, detalhes: {} },
      { tipo: "veiculo", descricao: "Ram Rampage 2024 — placa de demonstração", ano_aquisicao: 2024, valor_historico: 340_000, valor_mercado: 310_000, destinacao: "uso", valor_locacao_mensal: null, detalhes: {} },
    ],
    respostasFormulario: {
      p1: "Ubirajara Carvalho Pontes",
      p2: "São Paulo/SP",
      p3: "Empresário — construção civil",
      p4: "55-64",
      p5: "casado",
      p6: 3,
      p7: true,
      p8: true,
      p9: "Acima de R$ 2 milhões",
      p10: ["Imóveis", "Veículos", "Investimentos", "Previdência", "Empresa"],
      p11: 5,
      p12: "Três filhos de dois casamentos e uma construtora no meio. Quero regra escrita.",
      p13: "Que os três briguem pela construtora e a obra pare.",
      p14: "Decido sozinho, mas ouço minha esposa",
      p15: true,
      p16: "Quero a conta: inventário contra estrutura.",
      p17: true,
    },
    ligacao: {
      expectativa_principal: "Ver a conta do inventário contra a da estrutura, com o patrimônio dele.",
      preocupacao_principal: "Os três filhos, de dois casamentos, com envolvimentos diferentes na construtora.",
      objecoes_percebidas: ["Já montou uma holding que 'não funcionou'", "Vai comparar com o preço do contador antigo"],
      pessoas_mencionadas: ["Vera (esposa, separação total)", "Ubirajara Filho (trabalha na obra)", "Letícia e Otávio"],
      frases_marcantes: [
        "Se eu morrer hoje, eles se entendem no papel e não na prática.",
        "Já montei uma holding há dez anos. Nunca funcionou como me venderam.",
      ],
      observacoes: "Contato da equipe (demonstração). Cético por experiência anterior; responde a número e a documento.",
    },
    relatorio: {
      acompanhado: true,
      quem_acompanha: "Vera (esposa)",
      acompanhante_decide: false,
      acompanhante_assistiu: true,
      valor_pago_sessao: 2000,
      parcelas: 1,
      motivacao_cliente: "Três filhos de dois casamentos e uma construtora operacional no meio.",
      receita_familiar_mensal: 148_000,
      ideia_custo_inventario: "Nunca calculou; achava que ficava 'na casa dos R$ 200 mil'.",
      reserva_ou_seguro: "Seguro de vida de R$ 1 milhão; sem reserva específica para inventário.",
      ciente_itcmd: true,
      preocupacao_predominante: "Continuidade da obra e convivência entre os três filhos.",
      como_deseja_organizar: "Controle com ele enquanto viver; regra diferente por filho.",
      motiva_evitar_inventario: "O bloqueio da operação, mais que o custo.",
      interesse_imediato: "Alto — pediu o croqui na própria sessão.",
      relacao_filhos_terceiros: "O mais velho trabalha na construtora; os outros dois, não.",
      porque_nos_procurou: "Assistiu aos três dias e reconheceu o caso dele no exemplo do sócio.",
      falta_planejamento_preocupa: "Sim, principalmente pelo filho menor do segundo casamento.",
      resultado_sessao: "Contratou o croqui na sessão.",
      tributos: { exemplo: true, observacao: "Os números do croqui vêm do motor, não deste campo." },
      consideracoes_apresentacao_croqui:
        "Começar reconhecendo a holding anterior que não funcionou e mostrar, no papel, o que muda. Ele responde a documento.",
    },
    diagnostico: [
      {
        chave: "situacao_familiar",
        titulo: "Situação familiar",
        conteudo:
          "Três filhos de dois casamentos (31, 27 e 15), o mais velho já dentro da operação e o caçula menor de idade. Casado em separação total de bens desde 2012.",
        pontos: ["Três núcleos futuros com envolvimento desigual", "Um herdeiro menor", "Regime de separação total"],
        fontes: ["formulario", "ligacao"],
        categoria: "fato_declarado",
        visivel_ao_cliente: true,
      },
      {
        chave: "concentracao_patrimonial",
        titulo: "Onde o patrimônio está concentrado",
        conteudo:
          "A construtora responde pela maior parcela do valor de mercado e por toda a renda operacional. Quatro imóveis, um deles estoque da própria empresa.",
        pontos: ["Empresa operacional relevante", "Três lojas locadas com aluguel declarado", "Terreno usado pela operação"],
        fontes: ["patrimonio", "relatorio"],
        categoria: "dado_documental",
        visivel_ao_cliente: true,
      },
      {
        chave: "risco_de_inercia",
        titulo: "O que acontece se nada for feito",
        conteudo:
          "Com as quotas no espólio, a obra depende de alvará para cada decisão societária, e o ITCMD vence antes de a família ter acesso ao caixa.",
        pontos: ["Operação exposta ao bloqueio", "Necessidade de liquidez no pior momento"],
        fontes: ["relatorio"],
        categoria: "inferencia",
        visivel_ao_cliente: true,
      },
      {
        chave: "o_que_falta",
        titulo: "O que falta para fechar o croqui",
        conteudo: "IR do titular e da esposa, contrato social das duas empresas, matrícula dos quatro imóveis e o CRLV do veículo.",
        pontos: ["Radar de documentos aberto na aba Sessão"],
        fontes: ["radar"],
        categoria: "ponto_a_validar",
        visivel_ao_cliente: false,
      },
    ],
    cenarios: [
      {
        cenario: "inventario",
        nota: "Cenário de demonstração — o custo da inércia com os valores declarados pela família.",
        rubricas: [
          {
            rubrica: "itcmd",
            procedencia: "digitado",
            valor: 800_000,
            nota: "Digitado pela advogada a partir da tabela progressiva de SP (a chave de ITCMD do método é faixas, não alíquota única).",
          },
          {
            rubrica: "honorarios_advocaticios",
            procedencia: "calculado",
            base_calculo: 20_500_000,
            chaveParametro: "honorarios.inventario.percentual",
            nota: "Percentual vigente de honorários de inventário em SP, aplicado ao patrimônio de mercado.",
          },
          {
            rubrica: "custas_cartorio",
            procedencia: "calculado",
            base_calculo: 10_500_000,
            chaveParametro: "cartorio.imoveis.percentual_fallback",
            nota: "Fallback percentual de cartório de imóveis (SP) sobre o valor de mercado dos imóveis.",
          },
        ],
      },
      {
        cenario: "holding_3_celulas",
        nota: "Cenário de demonstração — a estrutura recomendada, ainda com uma rubrica em aberto.",
        rubricas: [
          {
            rubrica: "itbi",
            procedencia: "calculado",
            base_calculo: 10_500_000,
            chaveParametro: "itbi.aliquota",
            nota: "Hipótese de ITBI devido caso a imunidade seja negada — o croqui prevê o recurso.",
          },
          {
            rubrica: "honorarios_holding",
            procedencia: "digitado",
            valor: 74_000,
            nota: "Honorários da constituição, conforme a tabela de horas por ato.",
          },
          {
            rubrica: "manutencao_anual",
            procedencia: "ausente",
            nota: "Contabilidade das três células ainda não cotada — a tela mostra vazio, não zero.",
          },
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  // 4 · holding_contratada / ganha — execução em andamento
  // -------------------------------------------------------------------------
  {
    slug: "delmonte",
    alvo: "holding_contratada",
    dias: 96,
    nome: "Heloísa Delmonte Sampaio (demonstração)",
    email: "heloisa.delmonte@exemplo.com.br",
    telefone: "+5500900000004",
    cidade: "São Paulo",
    uf: "SP",
    profissao: "Empresária — rede de farmácias",
    faixa_etaria: "55-64",
    estado_civil: "divorciado",
    faixa_patrimonio: "Acima de R$ 2 milhões",
    diasAssistidos: 3,
    sessaoEmDias: 80,
    marcosConcluidos: 8,
    respostasSeminario: [
      ["O que te trouxe ao seminário?", "Sou divorciada, tenho dois filhos e uma rede de sete farmácias. Quero deixar tudo escrito antes de me aposentar."],
      ["Qual sua maior preocupação hoje?", "Que a rede seja vendida às pressas por preço de banana quando eu sair."],
      ["Você já ouviu falar de holding familiar?", "Sim, minha contadora fala nisso há anos. Nunca saí do lugar."],
      ["O que você espera da Sessão de Viabilidade?", "Um plano com prazo, não uma apresentação."],
    ],
    familiares: [
      { parentesco: "filho", nome: "Marcos Delmonte Sampaio (demonstração)", idade: 34, ocupacao: "Farmacêutico — gerente regional da rede", regime_casamento: "comunhão parcial de bens", ano_casamento: 2019, dependente_financeiro: false },
      { parentesco: "filho", nome: "Isabela Delmonte Sampaio (demonstração)", idade: 29, ocupacao: "Arquiteta", regime_casamento: null, ano_casamento: null, dependente_financeiro: false },
    ],
    patrimonio: [
      { tipo: "imovel", descricao: "Apartamento — Itaim Bibi, São Paulo/SP (residência)", ano_aquisicao: 2007, valor_historico: 1_100_000, valor_mercado: 3_900_000, destinacao: "residencia", valor_locacao_mensal: null, detalhes: {} },
      { tipo: "imovel", descricao: "Dois pontos comerciais — Zona Leste, São Paulo/SP (usados pela rede)", ano_aquisicao: 2012, valor_historico: 1_400_000, valor_mercado: 3_100_000, destinacao: "uso da empresa", valor_locacao_mensal: null, detalhes: {} },
      { tipo: "imovel", descricao: "Sala comercial — Berrini, São Paulo/SP (locada)", ano_aquisicao: 2017, valor_historico: 780_000, valor_mercado: 1_350_000, destinacao: "locacao", valor_locacao_mensal: 8_600, detalhes: {} },
      { tipo: "empresa", descricao: "Delmonte Farma Ltda. — 100% das quotas (7 lojas)", ano_aquisicao: 1999, valor_historico: 1_600_000, valor_mercado: 9_400_000, destinacao: "operacional", valor_locacao_mensal: null, detalhes: { faturamento_mensal: 3_600_000, custo_operacional_mensal: 3_120_000, participacao_percentual: 100 } },
      { tipo: "investimento", descricao: "Tesouro Direto e CDB — reserva pessoal", ano_aquisicao: 2014, valor_historico: 900_000, valor_mercado: 1_240_000, destinacao: "uso", valor_locacao_mensal: null, detalhes: {} },
      { tipo: "veiculo", descricao: "Volvo XC60 2023 — placa de demonstração", ano_aquisicao: 2023, valor_historico: 390_000, valor_mercado: 352_000, destinacao: "uso", valor_locacao_mensal: null, detalhes: {} },
    ],
    respostasFormulario: {
      p1: "Heloísa Delmonte Sampaio",
      p2: "São Paulo/SP",
      p3: "Empresária — rede de farmácias",
      p4: "55-64",
      p5: "divorciado",
      p6: 2,
      p7: false,
      p8: true,
      p9: "Acima de R$ 2 milhões",
      p10: ["Imóveis", "Veículos", "Investimentos", "Empresa"],
      p11: 5,
      p12: "Quero deixar a rede organizada antes de me aposentar.",
      p13: "Que vendam a rede às pressas quando eu sair.",
      p14: "Decido sozinha",
      p15: true,
      p16: "Um plano com prazo.",
      p17: true,
    },
    ligacao: {
      expectativa_principal: "Um plano com prazo para sair da operação sem vender a rede.",
      preocupacao_principal: "Venda apressada da rede na ausência dela.",
      objecoes_percebidas: ["A contadora já falava nisso — vai querer entender o que muda"],
      pessoas_mencionadas: ["Marcos (filho, gerente regional)", "Isabela (filha, fora da operação)"],
      frases_marcantes: [
        "Que a rede seja vendida às pressas por preço de banana quando eu sair.",
        "Minha contadora fala nisso há anos. Nunca saí do lugar.",
      ],
      observacoes: "Contato da equipe (demonstração). Decisora única, ritmo rápido, cobra prazo.",
    },
    relatorio: {
      acompanhado: false,
      acompanhante_decide: false,
      acompanhante_assistiu: false,
      valor_pago_sessao: 2000,
      parcelas: 1,
      motivacao_cliente: "Sair da operação com a rede organizada, sem venda forçada.",
      receita_familiar_mensal: 210_000,
      ideia_custo_inventario: "Nunca calculou.",
      reserva_ou_seguro: "Sem seguro; reserva pessoal em renda fixa.",
      ciente_itcmd: true,
      preocupacao_predominante: "Venda apressada da rede.",
      como_deseja_organizar: "Transferir gestão ao filho e manter a filha no resultado, não na gestão.",
      motiva_evitar_inventario: "O risco de venda forçada.",
      interesse_imediato: "Alto.",
      relacao_filhos_terceiros: "O filho é gerente regional; a filha não tem relação com a rede.",
      porque_nos_procurou: "Seminário, indicada por outra empresária do setor.",
      falta_planejamento_preocupa: "Sim.",
      resultado_sessao: "Contratou o croqui na sessão e a holding depois da apresentação.",
      tributos: { exemplo: true, observacao: "Os números do croqui vêm do motor, não deste campo." },
      consideracoes_apresentacao_croqui: "Ela quer prazo. Fechar pelo cronograma de execução, não pelo tributo.",
    },
    diagnostico: [
      {
        chave: "situacao_familiar",
        titulo: "Situação familiar",
        conteudo: "Divorciada, dois filhos adultos (34 e 29). O filho é gerente regional da rede; a filha não tem relação com a operação.",
        pontos: ["Dois núcleos com envolvimento desigual", "Decisora única"],
        fontes: ["formulario", "ligacao"],
        categoria: "fato_declarado",
        visivel_ao_cliente: true,
      },
      {
        chave: "concentracao_patrimonial",
        titulo: "Onde o patrimônio está concentrado",
        conteudo: "A rede de sete farmácias responde pela maior parte do valor de mercado; dois imóveis são usados pela própria operação.",
        pontos: ["Empresa operacional dominante", "Imóveis de uso da operação misturados ao patrimônio pessoal"],
        fontes: ["patrimonio", "relatorio"],
        categoria: "dado_documental",
        visivel_ao_cliente: true,
      },
      {
        chave: "risco_de_inercia",
        titulo: "O que acontece se nada for feito",
        conteudo: "Sem regra escrita, a saída dela transforma a rede em ativo a liquidar, com desconto de venda forçada.",
        pontos: ["Risco de deságio na venda", "Gestão sem sucessor formalizado"],
        fontes: ["relatorio"],
        categoria: "inferencia",
        visivel_ao_cliente: true,
      },
    ],
  },
];

/** Ids determinísticos — o que `--limpar` recalcula sem depender de manifesto. */
export const IDS_PESSOAS_DEMO = FAMILIAS.map((f) => uid(`pessoa:${f.slug}`));
export const IDS_JORNADAS_DEMO = FAMILIAS.map((f) => uid(`jornada:${f.slug}`));

// ---------------------------------------------------------------------------
// Datas por família
// ---------------------------------------------------------------------------

interface DatasFamilia {
  seminario_inicio: string;
  seminario_fim: string;
  captado: string;
  formulario: string;
  qualificado: string;
  pagamento_sv: string;
  boas_vindas: string;
  contato_equipe: string;
  agendou: string;
  sessao: string;
  confirmou_presenca: string;
  relatorio: string;
  material: string;
  documentos_pedidos: string;
  pagamento_croqui: string;
  documentos_conferidos: string;
  croqui_calculado: string;
  apresentacao: string;
  pagamento_holding: string;
  execucao_inicio: number;
  holding: string;
}

function datasDa(f: FamiliaDemo): DatasFamilia {
  const d = f.dias;
  const sessao = quando(f.sessaoEmDias ?? d - 14, 10);
  return {
    seminario_inicio: quando(d + 2),
    seminario_fim: quando(d),
    captado: quando(d),
    formulario: quando(d - 3),
    qualificado: quando(d - 3),
    pagamento_sv: quando(d - 6),
    boas_vindas: quando(d - 6, 14),
    contato_equipe: quando(d - 8),
    agendou: quando(d - 9),
    sessao,
    confirmou_presenca: quando(d - 10),
    relatorio: quando(d - 15),
    material: quando(d - 16),
    documentos_pedidos: quando(d - 16),
    pagamento_croqui: quando(d - 18),
    documentos_conferidos: quando(d - 22),
    croqui_calculado: quando(d - 26),
    apresentacao: quando(d - 30, 15),
    pagamento_holding: quando(d - 32),
    execucao_inicio: d - 34,
    holding: quando(d - 34),
  };
}

// ---------------------------------------------------------------------------
// Contexto de montagem
// ---------------------------------------------------------------------------

interface Ctx {
  db: Cliente;
  perfilId: string;
  edicaoId: string;
  familia: FamiliaDemo;
  datas: DatasFamilia;
  pessoaId: string;
  jornadaId: string;
  registrar: (s: string) => void;
}

/** Evento de timeline com data retroativa, idempotente pelo título. */
async function evento(ctx: Ctx, tipo: string, titulo: string, ocorridoEm: string, descricao?: string): Promise<void> {
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
    dados: {},
    ator_perfil_id: ctx.perfilId,
    ator_tipo: "humano",
    ocorrido_em: ocorridoEm,
  });
}

/**
 * Fecha a fila da régua NO MESMO instante em que o gatilho a abriu.
 *
 * `app.regua_boas_vindas` (0011:104) enfileira com `agendada_para = now()`: a
 * mensagem já nasce vencida, e o cron da Hostinger (a cada 5 min) reivindica
 * tudo que está `pendente` e vencido. Deixar isso para a varredura do fim de
 * `ajustarCronologia` abria uma janela de segundos a minutos por família em que
 * o cron podia mandar e-mail REAL para `@exemplo.com.br` — bounce na reputação
 * do domínio do Resend (achado M1 do pentest, 06/09). Agora a janela é o tempo
 * de uma consulta.
 *
 * `agendadaPara` só é passado quando a data do gatilho é `now()`: a régua do
 * agendamento e a do pós-sessão já datam a partir da sessão da família, que é
 * a data verdadeira — reescrevê-la faria a tela de Mensagens mentir.
 */
async function selarRegua(ctx: Ctx, ondeVeio: string, agendadaPara?: string): Promise<void> {
  const n = await cancelarMensagensDaJornada(ctx.db, [ctx.jornadaId], { agendadaPara });
  if (n > 0) ctx.registrar(`  ${n} mensagem(ns) da régua cancelada(s) na hora — ${ondeVeio}`);
}

/**
 * Pagamento + o webhook que o originou.
 *
 * A Sessão de Viabilidade passa pela RPC `processar_pagamento_hotmart` (mesmo
 * caminho do webhook de produção) porque `service_role` NÃO consegue inserir
 * direto em `pagamentos`: o gatilho `app.regua_boas_vindas` (0011) chama
 * `app.enfileirar_mensagem`, cujo EXECUTE foi revogado de PUBLIC (0013/0051) —
 * e `service_role` herda de PUBLIC. Croqui e holding entram por INSERT direto,
 * e TÊM de entrar: a RPC exige jornada ABERTA e abriria uma jornada fantasma
 * depois que o desfecho vira `ganha`.
 */
async function pagamento(ctx: Ctx, sufixo: string, tipoProduto: string, valor: number, pagoEm: string): Promise<void> {
  const externo = `${MARCA_DEMO}-${ctx.familia.slug.toUpperCase()}-${sufixo}`;
  const bruto = {
    exemplo: true,
    marca: MARCA_DEMO,
    observacao: "Payload sintético do seed de demonstração — não veio da Hotmart.",
    transaction: externo,
    product: tipoProduto,
    price: { value: valor, currency_code: "BRL" },
    buyer: { name: ctx.familia.nome, email: ctx.familia.email },
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
      comprador_email: ctx.familia.email,
      comprador_nome: ctx.familia.nome,
      comprador_telefone: ctx.familia.telefone,
      pago_em: pagoEm,
      bruto,
      criado_em: pagoEm,
    });
    // `regua_boas_vindas` só enfileira para Sessão de Viabilidade, mas o
    // gatilho roda em TODO pagamento: selar aqui custa uma consulta e não
    // depende de o `if` do banco continuar igual amanhã.
    await selarRegua(ctx, `pagamento ${sufixo}`, ctx.datas.boas_vindas);
    return;
  }

  const { data: antes } = await ctx.db.from("produtos").select("hotmart_produto_id").eq("id", produtoId).maybeSingle();
  const anterior = (antes as { hotmart_produto_id: string | null } | null)?.hotmart_produto_id ?? null;
  const marcador = `${MARCA_DEMO}-PROD-${tipoProduto}`;
  try {
    if (anterior === null) await atualizar(ctx.db, "produtos", { id: produtoId }, { hotmart_produto_id: marcador });
    const { error } = await ctx.db.rpc("processar_pagamento_hotmart", {
      p_hotmart_produto_id: anterior ?? marcador,
      p_transacao_externa_id: externo,
      p_status: "aprovado",
      p_valor: valor,
      p_moeda: "BRL",
      p_parcelas: 1,
      p_comprador_email: ctx.familia.email,
      p_comprador_nome: ctx.familia.nome,
      p_comprador_telefone: ctx.familia.telefone,
      p_pago_em: pagoEm,
      p_bruto: bruto,
    });
    if (error) throw new ErroSeed(`processar_pagamento_hotmart(${ctx.familia.slug}/${sufixo}): ${error.code ?? ""} ${error.message}`);
  } finally {
    // Devolver o campo é obrigatório mesmo com erro: `hotmart_produto_id` é
    // configuração de produção (B7), não do seed.
    if (anterior === null) await atualizar(ctx.db, "produtos", { id: produtoId }, { hotmart_produto_id: null });
  }
  // PRIMEIRA coisa depois da RPC: as duas mensagens de boas-vindas que
  // `app.regua_boas_vindas` acabou de enfileirar com `agendada_para = now()`.
  await selarRegua(ctx, `pagamento ${sufixo} (régua de boas-vindas)`, ctx.datas.boas_vindas);
}

/**
 * Emite o link público e DESCARTA o token (I6 do pentest).
 *
 * O banco só guarda `token_hash` (sha256 de token+pepper) e o prefixo — a 0072
 * fez isso de propósito: nem o service_role relê uma URL emitida. O seed não
 * imprime nem persiste o token em lugar nenhum, então o link EXISTE na Ficha
 * (a tela mostra o estado, a validade, os usos) mas ninguém o possui. Para
 * abrir `/p/*` numa demonstração, reemita pela Ficha — a reemissão é o
 * caminho normal do produto, e a Ficha mostra o token novo uma única vez.
 */
async function linkPublico(ctx: Ctx, tipo: string, agendamentoId: string | null): Promise<void> {
  const pepper = process.env.LINK_PUBLICO_PEPPER;
  if (!pepper || pepper.length < 16) {
    ctx.registrar(`  link '${tipo}' PULADO: LINK_PUBLICO_PEPPER ausente/curta em .env.local`);
    return;
  }
  const id = uid(`link:${ctx.familia.slug}:${tipo}`);
  const { count } = await ctx.db.from("links_publicos").select("*", { count: "exact", head: true }).eq("id", id);
  if ((count ?? 0) > 0) return;
  const token = crypto.randomBytes(32).toString("base64url");
  await inserir(ctx.db, "links_publicos", {
    id,
    jornada_id: ctx.jornadaId,
    // `ck_link_confirmacao_agendamento` (0051): link de confirmação sem
    // agendamento é link que não sabe o que confirma — o banco recusa.
    agendamento_id: tipo === "confirmacao" ? agendamentoId : null,
    tipo,
    token_hash: crypto.createHash("sha256").update(token + pepper, "utf8").digest("hex"),
    token_prefixo: token.slice(0, 6),
    estado: "ativo",
    expira_em: new Date(Date.now() + 400 * DIA).toISOString(),
    criado_por: ctx.perfilId,
    origem_dado: "exemplo",
  });
}

// ---------------------------------------------------------------------------
// Blocos por etapa
// ---------------------------------------------------------------------------

async function blocoCaptado(ctx: Ctx): Promise<void> {
  for (const [pergunta, resposta] of ctx.familia.respostasSeminario) {
    await acharOuCriar(ctx.db, "respostas_seminario", { pessoa_id: ctx.pessoaId, edicao_id: ctx.edicaoId, pergunta }, {
      resposta,
      origem: "manual",
      origem_dado: "exemplo",
      criado_por: ctx.perfilId,
      criado_em: ctx.datas.captado,
    });
  }
  for (const tipo of CONSENTIMENTOS) {
    await acharOuCriar(ctx.db, "consentimentos", { pessoa_id: ctx.pessoaId, tipo }, {
      concedido: true,
      texto_apresentado: `Você autoriza (${tipo})? — texto de demonstração, registrado pelo seed.`,
      versao_texto: "demo-v1",
      canal: "formulario",
      registrado_por: ctx.perfilId,
      concedido_em: ctx.datas.captado,
    });
  }
  await evento(ctx, "etapa", "Entrou pela edição do seminário", ctx.datas.captado, `Assistiu a ${ctx.familia.diasAssistidos} dias.`);
}

async function blocoQualificado(ctx: Ctx): Promise<void> {
  for (const f of ctx.familia.familiares) {
    await acharOuCriar(ctx.db, "familiares", { pessoa_id: ctx.pessoaId, parentesco: f.parentesco, nome: f.nome }, {
      registrado_na_jornada_id: ctx.jornadaId,
      idade: f.idade,
      ocupacao: f.ocupacao,
      regime_casamento: f.regime_casamento,
      ano_casamento: f.ano_casamento,
      dependente_financeiro: f.dependente_financeiro,
      ativo: true,
      criado_em: ctx.datas.qualificado,
    });
  }
  for (const b of ctx.familia.patrimonio) {
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
      criado_em: ctx.datas.qualificado,
    });
  }
  if (ctx.familia.respostasFormulario) {
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
        respostas: ctx.familia.respostasFormulario,
        origem: "sistema",
        origem_dado: "exemplo",
        respondido_em: ctx.datas.formulario,
      });
      await evento(ctx, "formulario", "Formulário Estratégico respondido", ctx.datas.formulario);
    }
  }
  if (ctx.familia.faixa_patrimonio) {
    await atualizar(ctx.db, "jornadas", { id: ctx.jornadaId }, { faixa_patrimonio_declarada: ctx.familia.faixa_patrimonio });
  }
  await evento(
    ctx,
    "patrimonio",
    "Patrimônio e família registrados",
    ctx.datas.qualificado,
    `${ctx.familia.patrimonio.length} bens · ${ctx.familia.familiares.length} familiares`,
  );
}

async function blocoSessaoContratada(ctx: Ctx): Promise<void> {
  await pagamento(ctx, "SV", "sessao_viabilidade", 2000, ctx.datas.pagamento_sv);
  await evento(ctx, "pagamento", "Sessão de Viabilidade paga", ctx.datas.pagamento_sv, "R$ 2.000,00");
  if (ctx.familia.ligacao) {
    await acharOuCriar(ctx.db, "ligacoes_estrategicas", { jornada_id: ctx.jornadaId, pop: "03" }, {
      realizada_em: ctx.datas.contato_equipe,
      duracao_segundos: 296,
      colaborador_id: ctx.perfilId,
      respostas: {
        expectativa: ctx.familia.ligacao.expectativa_principal,
        preocupacao: ctx.familia.ligacao.preocupacao_principal,
      },
      expectativa_principal: ctx.familia.ligacao.expectativa_principal,
      preocupacao_principal: ctx.familia.ligacao.preocupacao_principal,
      objecoes_percebidas: ctx.familia.ligacao.objecoes_percebidas,
      pessoas_mencionadas: ctx.familia.ligacao.pessoas_mencionadas,
      ritmo: "rapido",
      estilo_resposta: "objetiva",
      sinais: ["procura_numeros"],
      frases_marcantes: ctx.familia.ligacao.frases_marcantes,
      observacoes: ctx.familia.ligacao.observacoes,
      origem_dado: "exemplo",
      criado_por: ctx.perfilId,
      criado_em: ctx.datas.contato_equipe,
    });
    await evento(ctx, "ligacao", "Contato da equipe registrado", ctx.datas.contato_equipe);
  }
}

async function sessaoDaJornada(ctx: Ctx): Promise<string> {
  const { linha } = await acharOuCriar<{ id: string }>(ctx.db, "sessoes_viabilidade", { jornada_id: ctx.jornadaId }, {
    id: uid(`sessao:${ctx.familia.slug}`),
    advogada_id: ctx.perfilId,
    link_sala: `https://meet.example.com/sic-hf-demo-${ctx.familia.slug}`,
    link_sala_origem: "manual",
    link_sala_atualizado_em: ctx.datas.agendou,
    criado_em: ctx.datas.agendou,
  });
  return linha.id;
}

async function blocoSessaoAgendada(ctx: Ctx): Promise<void> {
  const sessaoId = await sessaoDaJornada(ctx);
  const agendamentoId = uid(`agendamento:${ctx.familia.slug}`);
  const inicio = ctx.datas.sessao;
  const fim = new Date(new Date(inicio).getTime() + 60 * 60 * 1000).toISOString();
  await acharOuCriar(ctx.db, "agendamentos", { sessao_id: sessaoId, inicio_em: inicio }, {
    id: agendamentoId,
    fim_em: fim,
    status: "confirmado",
    origem: "cliente",
    advogada_id: ctx.perfilId,
    criado_por: ctx.perfilId,
    criado_em: ctx.datas.agendou,
    presenca_confirmada_em: ctx.datas.confirmou_presenca,
    presenca_confirmada_via: "link",
  });
  // `app.regua_agendamento` (0051:753) acabou de enfileirar `dia_da_sessao`
  // (`inicio_em - 10 min`) e, se a sessão estiver a mais de 7 dias, a
  // `confirmacao_d7`. Nas famílias cuja sessão JÁ passou, as duas nascem
  // vencidas — mesmo risco de cron do M1.
  await selarRegua(ctx, "régua do agendamento");
  await linkPublico(ctx, "confirmacao", agendamentoId);
  await evento(ctx, "agendamento", "Sessão agendada pelo cliente", ctx.datas.agendou);

  if (ctx.familia.briefing) await briefingDeDemonstracao(ctx);
}

/**
 * Briefing sem IA. A execução nasce com `modo='demonstracao'`, e é isso que
 * faz `registrar_briefing` (0027) carimbar `origem_dado='exemplo'` no
 * briefing — a tela sabe, sozinha, que aquilo é demonstração.
 */
async function briefingDeDemonstracao(ctx: Ctx): Promise<void> {
  const { count } = await ctx.db
    .from("briefings")
    .select("*", { count: "exact", head: true })
    .eq("jornada_id", ctx.jornadaId);
  if ((count ?? 0) > 0) return;

  const { data: prompt } = await ctx.db
    .from("prompts_versoes")
    .select("id, modelo_padrao")
    .eq("chave", "protocolo_01_briefing")
    .eq("ativo", true)
    .order("versao", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!prompt) {
    ctx.registrar("  briefing PULADO: nenhum prompt `protocolo_01_briefing` ativo neste banco");
    return;
  }

  const { linha: execucao } = await acharOuCriar<{ id: string }>(
    ctx.db,
    "execucoes_ia",
    { jornada_id: ctx.jornadaId, hash_entrada: `${MARCA_DEMO}-briefing-${ctx.familia.slug}` },
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
      criado_em: ctx.datas.agendou,
      concluido_em: ctx.datas.agendou,
    },
  );

  const conteudo = ctx.familia.briefing as Record<string, unknown>;
  const fontes = ["formulario", "ligacao_observacoes", "patrimonio_faixa", "seminario"];
  const grau = (conteudo.grau_confianca as number) ?? 70;
  const { error } = await ctx.db.rpc("registrar_briefing", {
    p_jornada_id: ctx.jornadaId,
    p_execucao_id: execucao.id,
    p_conteudo: conteudo,
    p_grau_confianca: grau,
    p_fontes_usadas: fontes,
    p_modo_reduzido: true,
  });
  // Sem plano B: a 0076 devolveu a derivação de `origem_dado` a partir de
  // `execucoes_ia.modo` (a 0042 a tinha perdido ao recriar a função sobre o
  // corpo da 0009), e a 0077 passou a exigir que a execução seja DA MESMA
  // jornada. Com as duas aplicadas, o INSERT direto que existia aqui virou
  // código morto — e código morto de escrita em produção é o que envelhece
  // errado. Se a RPC falhar, o seed PARA com a mensagem do banco: briefing que
  // não passa pela função é briefing sem a trava da 0027.
  if (error) {
    throw new ErroSeed(`registrar_briefing(${ctx.familia.slug}): ${error.code ?? ""} ${error.message}`);
  }
  await evento(ctx, "briefing", "Briefing Estratégico gerado (demonstração)", ctx.datas.agendou, "Conteúdo de exemplo — nenhuma chamada de IA.");
}

async function blocoSessaoRealizada(ctx: Ctx): Promise<void> {
  const sessaoId = await sessaoDaJornada(ctx);
  await atualizar(ctx.db, "sessoes_viabilidade", { id: sessaoId }, {
    realizada_em: ctx.datas.sessao,
    resultado: "fechou",
    motivo_resultado: "Contratou o croqui na própria sessão.",
  });
  // `.neq` evita reescrever o mesmo valor: `trg_timeline_agendamento` dispara
  // em UPDATE e gravaria um evento novo a cada rodada.
  await ctx.db.from("agendamentos").update({ status: "realizado" }).eq("sessao_id", sessaoId).neq("status", "realizado");
  // `app.regua_pos_sessao` (0020:65) enfileirou o e-mail de pós-sessão para
  // `realizada_em + 2h` — data no passado nestas famílias, logo já vencida.
  await selarRegua(ctx, "régua do pós-sessão");

  if (ctx.familia.relatorio) {
    await acharOuCriar(ctx.db, "relatorios_sessao", { sessao_id: sessaoId }, {
      ...ctx.familia.relatorio,
      data_contratacao: ctx.datas.pagamento_sv.slice(0, 10),
      criado_por: ctx.perfilId,
      criado_em: ctx.datas.relatorio,
    });
    await evento(ctx, "relatorio", "Relatório da Sessão preenchido", ctx.datas.relatorio);
  }

  if (ctx.familia.diagnostico) {
    const { data: diag } = await ctx.db
      .from("diagnosticos_sv")
      .select("id")
      .eq("jornada_id", ctx.jornadaId)
      .eq("atual", true)
      .maybeSingle();
    if (!diag) {
      // `registrar_diagnostico_sv` (0058) ainda pergunta pela SESSÃO
      // (`app.ve_patrimonio()`), que sob `service_role` é false — as irmãs do
      // croqui foram convertidas para autor DECLARADO na 0069/0070, esta não.
      // Tenta a RPC; no 42501 grava pelo mesmo caminho, com autor declarado.
      const { error } = await ctx.db.rpc("registrar_diagnostico_sv", {
        p_jornada_id: ctx.jornadaId,
        p_analise_id: null,
        p_blocos: ctx.familia.diagnostico,
        p_criado_por: ctx.perfilId,
      });
      if (error && error.code === "42501") {
        await atualizar(ctx.db, "diagnosticos_sv", { jornada_id: ctx.jornadaId, atual: true }, { atual: false });
        await inserir(ctx.db, "diagnosticos_sv", {
          jornada_id: ctx.jornadaId,
          versao: 1,
          analise_id: null,
          blocos: ctx.familia.diagnostico,
          atual: true,
          criado_por: ctx.perfilId,
          atualizado_por: ctx.perfilId,
          criado_em: ctx.datas.relatorio,
        });
      } else if (error) {
        throw new ErroSeed(`registrar_diagnostico_sv(${ctx.familia.slug}): ${error.code ?? ""} ${error.message}`);
      }
      await evento(ctx, "diagnostico", "Diagnóstico da SV montado", ctx.datas.relatorio);
    }
  }

  await radarDeDocumentos(ctx, false);
  // A família que está COM O CROQUI EM ELABORAÇÃO tem esta tarefa viva, vencendo
  // depois de amanhã — é o que a tela "Hoje" precisa ter para não ficar vazia numa
  // apresentação. Quem já passou dela a conclui em `historiarTarefas`.
  const venceCroqui =
    ctx.familia.alvo === "croqui_contratado" ? quando(-2).slice(0, 10) : ctx.datas.croqui_calculado.slice(0, 10);
  await acharOuCriar(ctx.db, "tarefas", { jornada_id: ctx.jornadaId, titulo: "Montar o croqui estrutural" }, {
    descricao: "Cliente contratou na sessão. Aguardando IR e contrato social.",
    responsavel_id: ctx.perfilId,
    vence_em: venceCroqui,
    origem: "sistema",
    criado_por: ctx.perfilId,
    criado_em: ctx.datas.relatorio,
  });
  await evento(ctx, "documento", "Documentos pedidos ao cliente", ctx.datas.documentos_pedidos);
}

async function radarDeDocumentos(ctx: Ctx, conferir: boolean): Promise<void> {
  const familiares = await ctx.db.from("familiares").select("id, parentesco").eq("pessoa_id", ctx.pessoaId).eq("ativo", true);
  const bens = await ctx.db.from("patrimonio_itens").select("id, tipo").eq("pessoa_id", ctx.pessoaId).eq("ativo", true);

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
      pedido_em: ctx.datas.documentos_pedidos,
      pedido_por: ctx.perfilId,
      criado_em: ctx.datas.documentos_pedidos,
    });
  }
  if (conferir) {
    await ctx.db
      .from("documentos_pedidos")
      .update({ conferido_em: ctx.datas.documentos_conferidos, conferido_por: ctx.perfilId })
      .eq("jornada_id", ctx.jornadaId)
      .is("conferido_em", null);
  }
  await linkPublico(ctx, "documentos", null);
}

async function blocoCroquiContratado(ctx: Ctx): Promise<void> {
  await pagamento(ctx, "CROQUI", "croqui_estrutural", 4500, ctx.datas.pagamento_croqui);
  await evento(ctx, "pagamento", "Croqui Estrutural pago", ctx.datas.pagamento_croqui, "R$ 4.500,00 (com incentivo)");
  await radarDeDocumentos(ctx, true);
  await evento(ctx, "documento", "Documentos conferidos", ctx.datas.documentos_conferidos);

  const { linha: croqui } = await acharOuCriar<{ id: string; status: string }>(
    ctx.db,
    "croquis",
    { jornada_id: ctx.jornadaId, versao: 1 },
    {
      id: uid(`croqui:${ctx.familia.slug}`),
      titulo: `Croqui Estrutural — ${ctx.familia.nome.split(" ")[0]} (demonstração)`,
      status: "rascunho",
      conteudo: { slides: [] },
      criado_por: ctx.perfilId,
      criado_em: ctx.datas.croqui_calculado,
    },
  );

  await cenariosPatrimoniais(ctx);
  await calcularCroquiDeVerdade(ctx, croqui.id);

  // A família em `croqui_contratado` é a do croqui EM ELABORAÇÃO: o status
  // fica em `rascunho` de propósito — é o que a Ficha e a Pasta têm de
  // mostrar como "em elaboração". Quem já apresentou passa daqui.
  if (ordemDa(ctx.familia.alvo) > ordemDa("croqui_contratado")) {
    await ctx.db.from("croquis").update({ status: "pronto" }).eq("id", croqui.id).eq("status", "rascunho");
    await evento(ctx, "croqui", "Croqui pronto", ctx.datas.croqui_calculado);
  }
}

/**
 * Cenário Patrimonial pelo caminho real: `cenario_rubricas` com
 * `procedencia='calculado'` obriga o trigger `app.cenario_rubrica_calcula`
 * (0057/0061) a ler o parâmetro vigente, conferir a jurisdição contra a UF da
 * pessoa e multiplicar — a alíquota carimbada é a do banco, nunca a que o
 * script mandaria. Rubrica `ausente` fica vazia e derruba o total para `null`
 * na `vw_cenarios_totais`: é a regra da casa ("vazio é vazio") funcionando.
 */
async function cenariosPatrimoniais(ctx: Ctx): Promise<void> {
  if (!ctx.familia.cenarios) return;
  for (const c of ctx.familia.cenarios) {
    const { linha: cenario } = await acharOuCriar<{ id: string }>(
      ctx.db,
      "cenarios_patrimoniais",
      { jornada_id: ctx.jornadaId, cenario: c.cenario },
      {
        id: uid(`cenario:${ctx.familia.slug}:${c.cenario}`),
        nota: c.nota,
        criado_por: ctx.perfilId,
        atualizado_por: ctx.perfilId,
        criado_em: ctx.datas.croqui_calculado,
      },
    );
    for (const [ordem, r] of c.rubricas.entries()) {
      let parametroId: string | null = null;
      if (r.chaveParametro) {
        let q = ctx.db.from("parametros_metodo").select("id").eq("chave", r.chaveParametro).eq("ativo", true);
        q = q.or(`uf.is.null,uf.eq.${ctx.familia.uf}`);
        const { data } = await q.limit(1).maybeSingle();
        if (!data) {
          ctx.registrar(`  rubrica '${r.rubrica}' PULADA: parâmetro '${r.chaveParametro}' não está cadastrado/ativo`);
          continue;
        }
        parametroId = (data as { id: string }).id;
      }
      await acharOuCriar(ctx.db, "cenario_rubricas", { cenario_id: cenario.id, rubrica: r.rubrica }, {
        ordem,
        procedencia: r.procedencia,
        valor: r.procedencia === "digitado" ? r.valor : null,
        base_calculo: r.procedencia === "calculado" ? r.base_calculo : null,
        parametro_id: parametroId,
        nota: r.nota,
        atualizado_por: ctx.perfilId,
      });
    }
  }
}

/**
 * O croqui é calculado pelo MOTOR e gravado por `registrarCalculo` — o mesmo
 * caminho de `POST /api/jornadas/[id]/croqui-calculo`. Parâmetro ausente PARA
 * o script: croqui que não fecha não vira mock silencioso.
 */
async function calcularCroquiDeVerdade(ctx: Ctx, croquiId: string): Promise<void> {
  const { data: ja } = await ctx.db
    .from("croqui_calculos")
    .select("id")
    .eq("jornada_id", ctx.jornadaId)
    .eq("atual", true)
    .maybeSingle();
  if (ja) return;

  const previa = await calcularParaJornada(ctx.db, ctx.jornadaId);
  if (previa.ausentes.length > 0) {
    throw new ErroSeed(
      `[${ctx.familia.slug}] o motor vê ${previa.ausentes.length} parâmetro(s) ausente(s): ` +
        previa.ausentes.map((a) => `${a.chave}${a.uf ? `/${a.uf}` : ""}${a.municipio ? `/${a.municipio}` : ""}`).join(", ") +
        ". Cadastre em Admin → Parâmetros (ou rode antes o seed-exemplo-completo, que cadastra os de EXEMPLO).",
    );
  }

  const calculo = await registrarCalculo(ctx.db, ctx.jornadaId, {
    croqui_id: croquiId,
    nota: "Cálculo da família de demonstração — parâmetros vigentes no banco.",
    criadoPor: ctx.perfilId,
  });
  const { error } = await ctx.db.rpc("fixar_croqui_calculo", { p_id: calculo.id, p_criado_por: ctx.perfilId });
  if (error) throw new ErroSeed(`fixar_croqui_calculo(${ctx.familia.slug}): ${error.code ?? ""} ${error.message}`);

  const tabelas = Object.keys((calculo.resultado as { tabelas?: Record<string, unknown> } | null)?.tabelas ?? {});
  ctx.registrar(`  croqui calculado pelo motor: ${tabelas.length} tabelas · versão ${calculo.versao} fixada`);
}

async function blocoCroquiApresentado(ctx: Ctx): Promise<void> {
  const croquiId = uid(`croqui:${ctx.familia.slug}`);
  const encerrada = new Date(new Date(ctx.datas.apresentacao).getTime() + 72 * 60 * 1000).toISOString();
  await acharOuCriar(ctx.db, "croqui_apresentacoes", { croqui_id: croquiId, iniciada_em: ctx.datas.apresentacao }, {
    encerrada_em: encerrada,
    slides_vistos: 13,
    apresentador_id: ctx.perfilId,
  });
  await ctx.db.from("croquis").update({ status: "apresentado" }).eq("id", croquiId).neq("status", "apresentado");
  await evento(ctx, "croqui", "Croqui apresentado", ctx.datas.apresentacao, "72 min · cliente presente");
}

async function blocoHoldingContratada(ctx: Ctx): Promise<void> {
  await pagamento(ctx, "HOLDING", "holding", 68_000, ctx.datas.pagamento_holding);
  await evento(ctx, "pagamento", "Holding contratada", ctx.datas.pagamento_holding);

  const { data: marcos, error } = await ctx.db.from("execucao_marcos").select("id, ordem, rotulo").order("ordem", { ascending: true });
  if (error) throw new ErroSeed(`execucao_marcos: ${error.message}`);
  const lista = (marcos as Array<{ id: string; ordem: number; rotulo: string }> | null) ?? [];
  if (lista.length === 0) throw new ErroSeed("Nenhum marco em execucao_marcos — a 0067 não foi aplicada.");

  // EXECUÇÃO EM ANDAMENTO: só os primeiros N marcos ficam concluídos. Os
  // outros continuam abertos — é o que a barra de execução tem de mostrar.
  const concluir = Math.min(ctx.familia.marcosConcluidos ?? Math.ceil(lista.length / 2), lista.length);
  const passo = Math.max(1, Math.floor((ctx.datas.execucao_inicio - 2) / concluir));
  for (const [i, marco] of lista.slice(0, concluir).entries()) {
    const { count } = await ctx.db
      .from("execucao_jornada_marcos")
      .select("*", { count: "exact", head: true })
      .eq("jornada_id", ctx.jornadaId)
      .eq("marco_id", marco.id);
    if ((count ?? 0) > 0) continue;
    await inserir(ctx.db, "execucao_jornada_marcos", {
      jornada_id: ctx.jornadaId,
      marco_id: marco.id,
      concluido_em: quando(Math.max(2, ctx.datas.execucao_inicio - i * passo)),
      concluido_por: ctx.perfilId,
      nota: null,
    });
  }
  ctx.registrar(`  execução em andamento: ${concluir} de ${lista.length} marcos concluídos`);
}

// ---------------------------------------------------------------------------
// Máquina de estados e cronologia
// ---------------------------------------------------------------------------

async function moverAte(ctx: Ctx, alvo: Etapa): Promise<void> {
  const { data } = await ctx.db.from("jornadas").select("etapa").eq("id", ctx.jornadaId).single();
  const atual = (data as { etapa: Etapa }).etapa;
  if (atual === alvo) {
    await atualizar(ctx.db, "jornadas", { id: ctx.jornadaId }, { nivel_pago: NIVEL_PAGO[alvo] });
    return;
  }
  if (ordemDa(alvo) < ordemDa(atual)) return; // a 0004 proíbe regredir; rebobinar é recriar
  for (let i = ordemDa(atual) + 1; i <= ordemDa(alvo); i += 1) {
    const proxima = ETAPAS[i];
    await atualizar(ctx.db, "jornadas", { id: ctx.jornadaId }, {
      nivel_pago: NIVEL_PAGO[proxima],
      etapa: proxima,
      ...(proxima === "holding_contratada" ? { desfecho: "ganha", motivo_desfecho: "Holding contratada" } : {}),
    });
  }
}

/**
 * Retroage o que os gatilhos escreveram com `now()`. Sem isto a jornada de 90
 * dias aparece inteira como "hoje" e a linha do tempo passa a mentir sobre a
 * ORDEM dos fatos — a única coisa que a Pasta serve para responder. O recorte
 * é `ocorrido_em > hoje 00:00`: evento antigo legítimo não é tocado.
 */
async function ajustarCronologia(ctx: Ctx): Promise<void> {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const corte = hoje.toISOString();
  const d = ctx.datas;

  const dataDaEtapa: Record<Etapa, string> = {
    captado: d.captado,
    qualificado: d.qualificado,
    sessao_contratada: d.pagamento_sv,
    sessao_agendada: d.agendou,
    sessao_realizada: d.sessao,
    croqui_contratado: d.pagamento_croqui,
    croqui_apresentado: d.apresentacao,
    holding_contratada: d.holding,
  };

  const { data: transicoes } = await ctx.db
    .from("jornadas_transicoes")
    .select("id, para_etapa")
    .eq("jornada_id", ctx.jornadaId);
  for (const t of ((transicoes as Array<{ id: string; para_etapa: Etapa | null }> | null) ?? [])) {
    if (!t.para_etapa) continue;
    await ctx.db
      .from("jornadas_transicoes")
      .update({ ocorrido_em: dataDaEtapa[t.para_etapa], ator_perfil_id: ctx.perfilId })
      .eq("id", t.id);
  }

  const porTipo: Record<string, string> = {
    etapa: d.captado,
    familia: d.qualificado,
    patrimonio: d.qualificado,
    formulario: d.formulario,
    ligacao: d.contato_equipe,
    mensagem: d.boas_vindas,
    briefing: d.agendou,
    relatorio: d.relatorio,
    diagnostico: d.relatorio,
    documento: d.documentos_pedidos,
    documento_pedido: d.documentos_pedidos,
    cenario: d.croqui_calculado,
    croqui: d.croqui_calculado,
    croqui_calculo: d.croqui_calculado,
    croqui_narrativa: d.croqui_calculado,
    croqui_exportacao: d.apresentacao,
    agendamento: d.agendou,
    execucao: d.holding,
    pagamento: d.pagamento_sv,
    tarefa: d.relatorio,
    ligacao_ia: d.pagamento_sv,
  };

  const { data: eventos } = await ctx.db
    .from("eventos_timeline")
    .select("id, tipo, titulo")
    .eq("jornada_id", ctx.jornadaId)
    .gt("ocorrido_em", corte);

  for (const e of ((eventos as Array<{ id: string; tipo: string; titulo: string }> | null) ?? [])) {
    let quandoEvento = porTipo[e.tipo] ?? d.captado;
    if (e.tipo === "etapa") {
      const destino = ETAPAS.find((et) => e.titulo.endsWith(et));
      if (destino) quandoEvento = dataDaEtapa[destino];
      else if (e.titulo.startsWith("Desfecho")) quandoEvento = d.holding;
    } else if (e.tipo === "agendamento") {
      quandoEvento = e.titulo.includes("realizado") ? d.sessao : d.agendou;
    } else if (e.tipo === "documento_pedido") {
      quandoEvento = e.titulo.includes("conferido") ? d.documentos_conferidos : d.documentos_pedidos;
    } else if (e.tipo === "croqui") {
      quandoEvento = e.titulo.includes("apresentado") ? d.apresentacao : d.croqui_calculado;
    }
    await ctx.db.from("eventos_timeline").update({ ocorrido_em: quandoEvento }).eq("id", e.id);
  }

  // VARREDURA FINAL da régua. O cancelamento de verdade acontece colado em
  // cada gatilho (`selarRegua`); isto aqui é a rede: pega o que qualquer
  // gatilho futuro enfileirar, e pega o `falhou` — se o cron chegou primeiro e
  // não havia chave de envio, a mensagem virou `falhou`, e um filtro
  // só-`pendente` a deixaria como lixo permanente na tela de Pendências.
  const n = await cancelarMensagensDaJornada(ctx.db, [ctx.jornadaId], { agendadaPara: d.boas_vindas });
  if (n > 0) ctx.registrar(`  ${n} mensagem(ns) canceladas na varredura final (destinatário fictício)`);
}

// ---------------------------------------------------------------------------
// Ligação por IA: fechar a fila sem discar
// ---------------------------------------------------------------------------

/**
 * `ligacao_ia.automatica` está LIGADO em produção — o gatilho da 0053 põe uma
 * ligação `na_fila` a cada pagamento aprovado de Sessão de Viabilidade, sem
 * validar o telefone (o gatilho só confere que não é vazio).
 *
 * Em vez de apagar a linha (o que esconderia o comportamento real), o seed
 * fecha a fila pelo CAMINHO DE PRODUÇÃO: `dispararAgora` → `dispararLigacao`
 * → `telefoneParaLigacao` recusa o `+5500…` → provedor MANUAL → tarefa
 * "Ligar para agendar a Sessão de Viabilidade" para a equipe. Nenhum webhook
 * de n8n é chamado (a recusa acontece ANTES da escolha de provedor).
 *
 * Ao fim, nenhuma ligação de demonstração fica em `na_fila`/`discando`.
 */
async function fecharFilaDeLigacoes(db: Cliente, jornadaIds: string[], registrar: (s: string) => void): Promise<void> {
  const { data, error } = await db
    .from("ligacoes_ia")
    .select("*")
    .in("jornada_id", jornadaIds)
    .in("status", ["na_fila", "discando"]);
  if (error) throw new ErroSeed(`ligacoes_ia: ${error.message}`);
  const abertas = (data as LigacaoIa[] | null) ?? [];

  // `discando` é linha que o CRON já reivindicou (`reivindicar_ligacoes_ia`
  // move `na_fila` → `discando` atomicamente). Chamar `dispararLigacao` nela
  // seria reprocessar o que outro dono está processando: duas tarefas "Ligar
  // para agendar a Sessão de Viabilidade" para a mesma ligação (achado I4 do
  // pentest). O seed só reivindica o que ainda é dele — `na_fila` — e deixa o
  // resto para o cron, avisando.
  const emVoo = abertas.filter((l) => l.status === "discando");
  for (const l of emVoo) {
    registrar(
      `ligação ${l.id.slice(0, 8)} (${l.telefone}) está 'discando' — o cron já a reivindicou; NÃO reprocessada ` +
        "(o telefone +5500… continua sendo recusado por telefoneParaLigacao, então ela termina em manual).",
    );
  }

  const naFila = abertas.filter((l) => l.status === "na_fila");
  if (naFila.length === 0) {
    registrar(`ligação por IA: nenhuma ligação de demonstração 'na_fila'${emVoo.length ? ` (${emVoo.length} em 'discando' com o cron)` : ""}`);
    return;
  }
  for (const ligacao of naFila) {
    const resultado = await dispararAgora(db, ligacao.id);
    registrar(`ligação ${ligacao.id.slice(0, 8)} (${ligacao.telefone}) → ${resultado ?? "já processada"}`);
    if (resultado === "disparada") {
      throw new ErroSeed(
        `ligação de demonstração DISPARADA para ${ligacao.telefone} — isto não deveria acontecer. ` +
          "Confira `telefoneParaLigacao` em src/server/integracoes/telefone.ts.",
      );
    }
  }
}

/**
 * Confere, no fim, que NENHUMA mensagem de demonstração escapou para o mundo.
 *
 * O seed sela a régua colada em cada gatilho, mas o cron da Hostinger roda em
 * outro processo e a cada 5 minutos: prova de que a janela não foi usada é
 * medição, não argumento. `enviada` = e-mail que saiu de verdade para um
 * `@exemplo.com.br` (bounce contra a reputação do domínio no Resend);
 * `enviando` = o cron está com a mensagem na mão AGORA.
 */
async function auditarMensagens(db: Cliente, jornadaIds: string[], registrar: (s: string) => void): Promise<void> {
  const { data, error } = await db
    .from("mensagens_agendadas")
    .select("id, canal, destinatario, status, enviada_em, erro")
    .in("jornada_id", jornadaIds);
  if (error) throw new ErroSeed(`auditar mensagens: ${error.code ?? ""} ${error.message}`);
  const linhas = (data as Array<{ id: string; canal: string; destinatario: string; status: string; enviada_em: string | null; erro: string | null }> | null) ?? [];
  const porStatus: Record<string, number> = {};
  for (const m of linhas) porStatus[m.status] = (porStatus[m.status] ?? 0) + 1;
  registrar(
    `mensagens da régua das 4 famílias: ${linhas.length} — ${
      Object.entries(porStatus).sort().map(([s, n]) => `${s} ${n}`).join(" · ") || "nenhuma"
    }`,
  );

  const escaparam = linhas.filter((m) => m.status === "enviada" || m.status === "enviando");
  if (escaparam.length > 0) {
    console.error(
      [
        "",
        "!!! ATENÇÃO — MENSAGEM DE DEMONSTRAÇÃO SAIU (ou está saindo) DO SISTEMA !!!",
        "",
        `${escaparam.length} mensagem(ns) de família de demonstração está(ão) 'enviada'/'enviando'.`,
        "O cron da régua (POST /api/cron/regua, a cada 5 min) reivindicou a fila antes do seed selá-la.",
        "",
        ...escaparam.map((m) => `  · ${m.canal} → ${m.destinatario} (${m.status}, ${m.enviada_em ?? "sem data"})`),
        "",
        "O que fazer: conferir no painel do Resend se houve BOUNCE para @exemplo.com.br",
        "(domínio fictício: todo envio quica e conta contra a reputação do remetente).",
        "Nada a desfazer no banco — a mensagem já saiu.",
        "",
      ].join("\n"),
    );
  }
}

// ---------------------------------------------------------------------------
// Montagem de uma família
// ---------------------------------------------------------------------------

async function montarFamilia(
  db: Cliente,
  perfilId: string,
  edicaoId: string,
  familia: FamiliaDemo,
  registrar: (s: string) => void,
): Promise<Ctx> {
  const datas = datasDa(familia);
  const pessoaId = uid(`pessoa:${familia.slug}`);
  const jornadaId = uid(`jornada:${familia.slug}`);

  const { criou: pessoaNova } = await acharOuCriar<{ id: string }>(db, "pessoas", { id: pessoaId }, {
    nome: familia.nome,
    email: familia.email,
    telefone: familia.telefone,
    cidade: familia.cidade,
    uf: familia.uf,
    profissao: familia.profissao,
    faixa_etaria: familia.faixa_etaria,
    estado_civil: familia.estado_civil,
    observacoes: "Pessoa de DEMONSTRAÇÃO (scripts/seed-demo.ts). Telefone +5500… é inválido de propósito: a ligação por IA não disca nele.",
    ativo: true,
    origem_dado: "exemplo",
    criado_por: perfilId,
    criado_em: datas.captado,
  });
  await acharOuCriar(db, "participacoes_seminario", { pessoa_id: pessoaId, edicao_id: edicaoId }, {
    origem: "seminario",
    dias_assistidos: familia.diasAssistidos,
    registrado_em: datas.captado,
    criado_em: datas.captado,
  });
  await acharOuCriar<{ id: string }>(db, "jornadas", { id: jornadaId }, {
    pessoa_id: pessoaId,
    desfecho: "aberta",
    edicao_id: edicaoId,
    origem: "seminario",
    trilha: "seminario",
    etapa: "captado",
    nivel_pago: 0,
    responsavel_id: perfilId,
    origem_dado: "exemplo",
    entrou_na_etapa_em: datas.captado,
    criado_por: perfilId,
    criado_em: datas.captado,
  });

  const ctx: Ctx = { db, perfilId, edicaoId, familia, datas, pessoaId, jornadaId, registrar };
  registrar(`${familia.slug} · pessoa ${pessoaNova ? "criada" : "reaproveitada"} ${pessoaId.slice(0, 8)} · alvo '${familia.alvo}'`);

  const blocos: Array<[Etapa, (c: Ctx) => Promise<void>]> = [
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
    if (ordemDa(etapa) > ordemDa(familia.alvo)) break;
    // A etapa sobe ANTES do bloco: o piso de nível pago da 0004 recusa etapa
    // abaixo do que o pagamento já pagou.
    await moverAte(ctx, etapa);
    await bloco(ctx);
  }

  // `processar_pagamento_hotmart` abre uma jornada NOVA quando não acha uma
  // aberta — varredura para não deixar jornada fantasma na Esteira. Ela nasce
  // com o DEFAULT `origem_dado='real'` (0011:190), então quem autoriza o DELETE
  // é a pessoa dona: `apagarJornadas` confere que ela é de exemplo e aborta se
  // a jornada não for de exemplo NEM pendurada em pessoa de exemplo (B2).
  const fantasmas = (await ids(db, "jornadas", "id", { pessoa_id: pessoaId })).filter((id) => id !== jornadaId);
  if (fantasmas.length > 0) {
    registrar(`  ${fantasmas.length} jornada(s) fantasma removida(s)`);
    await apagarJornadas(db, fantasmas);
  }

  await ajustarCronologia(ctx);
  return ctx;
}

/**
 * Fecha a história das tarefas que os gatilhos criaram com `now()`.
 *
 * Sem isto a apresentação abre com três "Ligar para agendar a Sessão de
 * Viabilidade" vencendo hoje — inclusive para a família cuja holding já está
 * constituída. Tarefa que ninguém vai fazer treina o time a fechar tudo sem ler.
 *
 * A regra é a história de cada família, não um `delete`: a ligação por IA
 * continua gravada como `concluida/manual` com o motivo `telefone_invalido`, e
 * a tarefa continua lá — concluída na data em que o fato seguinte aconteceu.
 */
async function historiarTarefas(ctx: Ctx): Promise<void> {
  const d = ctx.datas;
  const fechar = async (filtro: { titulo?: string; tipo?: string }, em: string) => {
    let q = ctx.db
      .from("tarefas")
      .update({ concluida_em: em, concluida_por: ctx.perfilId })
      .eq("jornada_id", ctx.jornadaId)
      .is("concluida_em", null);
    if (filtro.titulo) q = q.eq("titulo", filtro.titulo);
    if (filtro.tipo) q = q.eq("tipo", filtro.tipo);
    const { data } = await q.select("id");
    return (data as unknown[] | null)?.length ?? 0;
  };

  // A ligação por IA cai no manual e vira tarefa; nestas famílias a equipe
  // ligou e o cliente agendou — a tarefa morre na data do agendamento.
  const nLigar = await fechar({ tipo: "ligar_para_agendar" }, d.agendou);
  // "Enviar link do croqui" (0051) morre quando o croqui é pago.
  const nLink =
    ordemDa(ctx.familia.alvo) >= ordemDa("croqui_contratado") ? await fechar({ tipo: "enviar_link_croqui" }, d.pagamento_croqui) : 0;
  // Croqui já apresentado = croqui montado.
  const nCroqui =
    ordemDa(ctx.familia.alvo) > ordemDa("croqui_contratado")
      ? await fechar({ titulo: "Montar o croqui estrutural" }, d.croqui_calculado)
      : 0;

  // A ligação em si ganha a data da família: `now()` numa jornada de 3 meses
  // atrás faz a Ficha mentir sobre a ordem dos fatos.
  await ctx.db
    .from("ligacoes_ia")
    .update({ criado_em: d.pagamento_sv, disparada_em: d.contato_equipe, encerrada_em: d.contato_equipe })
    .eq("jornada_id", ctx.jornadaId);

  const total = nLigar + nLink + nCroqui;
  if (total > 0) ctx.registrar(`  ${total} tarefa(s) concluída(s) na data do fato seguinte`);
}

// ---------------------------------------------------------------------------
// Programa
// ---------------------------------------------------------------------------

export async function rodarDemo(db: Cliente, registrar: (s: string) => void): Promise<void> {
  console.log("\n=== SEED DEMO · 4 famílias de demonstração ===\n");
  const perfilId = await perfilAutor(db);

  const { linha: edicao } = await acharOuCriar<{ id: string }>(db, "edicoes_seminario", { id: ID_EDICAO }, {
    codigo: CODIGO_EDICAO,
    nome: "Seminário de demonstração — SIC-HF",
    inicio_em: quando(100).slice(0, 10),
    fim_em: quando(98).slice(0, 10),
    ativa: true,
    origem_dado: "exemplo",
  });

  const montadas: Ctx[] = [];
  for (const familia of FAMILIAS) {
    montadas.push(await montarFamilia(db, perfilId, edicao.id, familia, registrar));
  }
  const jornadaIds = montadas.map((c) => c.jornadaId);

  console.log("\n--- ligação por IA (ligacao_ia.automatica = true em produção) ---\n");
  await fecharFilaDeLigacoes(db, jornadaIds, registrar);
  for (const ctx of montadas) await historiarTarefas(ctx);

  await auditarMensagens(db, jornadaIds, registrar);

  console.log("\n--- estado final ---\n");
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  for (const [i, familia] of FAMILIAS.entries()) {
    const { data } = await db.from("jornadas").select("etapa, desfecho").eq("id", jornadaIds[i]).single();
    const j = data as { etapa: string; desfecho: string };
    registrar(`  ${familia.nome.padEnd(48)} ${j.etapa.padEnd(20)} ${j.desfecho.padEnd(8)} ${base}/jornadas/${jornadaIds[i]}`);
  }
  console.log(`\nKanban: ${base}/clientes · Roteiro da apresentação: docs/APRESENTACAO.md\n`);
}

export async function limparDemo(db: Cliente, registrar: (s: string) => void): Promise<void> {
  console.log("\n=== LIMPAR DEMO ===\n");
  // Recalcula os ids em vez de ler manifesto: o `--limpar` funciona mesmo
  // numa máquina que nunca rodou o `--demo`.
  const vivas = await ids(db, "pessoas", "id", { id: IDS_PESSOAS_DEMO });
  registrar(`PRÉ: ${vivas.length} de ${IDS_PESSOAS_DEMO.length} pessoa(s) de demonstração no banco`);

  // TRAVA (B2 do pentest): este `--limpar` apaga por id determinístico, não por
  // filtro de `origem_dado`. Antes do primeiro DELETE, reafirmar que cada id
  // que EXISTE é `origem_dado='exemplo'`. Qualquer um fora disso aborta tudo,
  // sem apagar nada. `apagarPessoas`/`apagarJornadas` repetem a conferência por
  // dentro — esta aqui é a que fala a língua do comando.
  await conferirSoExemplo(db, "pessoas", IDS_PESSOAS_DEMO);
  await conferirSoExemplo(db, "edicoes_seminario", [ID_EDICAO]);
  registrar(`trava: ${vivas.length} id(s) conferido(s) como origem_dado='exemplo' antes do primeiro DELETE`);

  const conta = await apagarPessoas(db, IDS_PESSOAS_DEMO);

  const marcados = FAMILIAS.flatMap((f) =>
    ["SV", "CROQUI", "HOLDING"].map((s) => `${MARCA_DEMO}-${f.slug.toUpperCase()}-${s}`),
  );
  const nPag = await apagar(db, "pagamentos", { origem: "exemplo", transacao_externa_id: marcados });
  const nWh = await apagar(db, "webhooks_eventos", { origem: "exemplo", evento_externo_id: marcados });
  if (nPag) conta.pagamentos = (conta.pagamentos ?? 0) + nPag;
  if (nWh) conta.webhooks_eventos = (conta.webhooks_eventos ?? 0) + nWh;

  // A edição do seminário só sai se ninguém mais depender dela.
  const usos =
    (await ids(db, "participacoes_seminario", "id", { edicao_id: ID_EDICAO })).length +
    (await ids(db, "jornadas", "id", { edicao_id: ID_EDICAO })).length +
    (await ids(db, "respostas_seminario", "id", { edicao_id: ID_EDICAO })).length;
  if (usos === 0) {
    const n = await apagar(db, "edicoes_seminario", { id: ID_EDICAO });
    if (n) conta.edicoes_seminario = n;
  } else {
    registrar(`edicoes_seminario '${CODIGO_EDICAO}' mantida: ${usos} referência(s) de fora do demo`);
  }

  const total = Object.values(conta).reduce((a, b) => a + b, 0);
  for (const [t, n] of Object.entries(conta).sort()) registrar(`  − ${t}: ${n}`);
  registrar(`TOTAL removido: ${total} linha(s)`);
  console.log("\nA pessoa do João (seed-exemplo-completo.ts) não foi tocada.\n");
}

function ajuda(): void {
  console.log(`
seed-demo.ts — as 4 famílias de demonstração do SIC-HF.

  npx tsx scripts/seed-demo.ts
      Cria (ou reconcilia) as 4 famílias, cada uma numa etapa da esteira:
${FAMILIAS.map((f) => `        · ${f.nome.padEnd(46)} ${f.alvo}`).join("\n")}
      Idempotente: rodar de novo não duplica nada.

  npx tsx scripts/seed-demo.ts --limpar
      Apaga SÓ o que este script criou (ids determinísticos da marca
      ${MARCA_DEMO}). A pessoa do João continua intocada.
      TRAVA: antes do primeiro DELETE, cada id é conferido no banco; se
      algum não for origem_dado='exemplo', o script recusa e não apaga NADA.

Exige SUPABASE_SERVICE_ROLE_KEY; LINK_PUBLICO_PEPPER é opcional (sem ela os
links públicos das famílias não são emitidos, e o script avisa).

O QUE ESTE SCRIPT MEXE EM PRODUÇÃO ALÉM DAS 4 FAMÍLIAS

  · produtos.hotmart_produto_id (TEMPORÁRIO).
    'processar_pagamento_hotmart' acha o produto POR ESSE CAMPO. Quando ele
    está vazio (o normal hoje), o seed grava o marcador
    '${MARCA_DEMO}-PROD-<tipo>' só durante a chamada da RPC e o
    devolve a NULL num 'finally' — inclusive quando a RPC falha. Se o processo
    for morto no meio (SIGKILL/Ctrl-Break/queda de rede), o marcador FICA no
    banco. Como limpar:
      Admin → Produtos → o produto com id da Hotmart começando por
      '${MARCA_DEMO}-PROD' → apagar o conteúdo do campo.
      (SQL: update produtos set hotmart_produto_id = null
             where hotmart_produto_id like '${MARCA_DEMO}-PROD%';)
    Se o campo JÁ tiver o id verdadeiro da Hotmart, o seed não escreve nele.

  · mensagens_agendadas das 4 jornadas.
    Cada pagamento/agendamento/sessão dispara a régua DE VERDADE no banco. O
    seed cancela a fila no instante seguinte a cada gatilho e, no fim, conta:
    qualquer mensagem 'enviada'/'enviando' vira AVISO em vermelho no terminal.

  · links_publicos das 4 jornadas: o seed emite o link e DESCARTA o token
    (só o hash fica no banco, que é o desenho da 0072). Ninguém tem a URL —
    para abrir /p/* de uma família na apresentação, reemita o link pela Ficha.

Roteiro de apresentação: docs/APRESENTACAO.md
`);
}

async function main(): Promise<void> {
  carregarEnvLocal();
  if (process.argv.includes("--help") || process.argv.includes("-h")) return ajuda();
  const registrar = (s: string) => console.log(s);
  const db = clienteAdmin();
  if (process.argv.includes("--limpar")) return limparDemo(db, registrar);
  return rodarDemo(db, registrar);
}

if (require.main === module) {
  main().catch((erro: unknown) => {
    console.error(`\nFALHOU: ${erro instanceof Error ? erro.message : String(erro)}\n`);
    process.exit(1);
  });
}
