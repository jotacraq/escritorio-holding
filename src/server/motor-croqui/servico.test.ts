/**
 * A ponte com o banco: `calcularParaJornada` (`src/server/motor-croqui/servico.ts`)
 * contra um cliente Supabase FALSO.
 *
 * Convertido de `scripts/teste-motor-croqui.ts` §F (Fase 7 · rodada 2) —
 * mesmos casos, mesmos números, agora sob `npm test` / CI.
 *
 * O falso aqui é deliberado e limitado: nenhuma RLS, nenhum trigger e nenhuma
 * RPC é provada por ele (isso continua sendo papel dos roteiros
 * `scripts/verificacao-NNNN.sql`). O que ele prova é o MAPEAMENTO — quais
 * linhas viram `EntradaCroqui` e quantas idas ao banco acontecem.
 */
import { describe, expect, it } from "vitest";

import { calcularParaJornada } from "@/server/motor-croqui/servico";

// ---------------------------------------------------------------------------
// Harness — cada `ok()` do script original vira um `it` do vitest, e cada
// `bloco()` vira um `describe`. As condições são avaliadas na COLETA (o motor
// é puro e síncrono) e asseguradas dentro do `it`: mesmo placar por caso, mas
// quem reporta é o vitest — e o CI reprova o PR.
// ---------------------------------------------------------------------------
interface Caso {
  secao: string;
  nome: string;
  ok: boolean;
  detalhe: string;
}

const casos: Caso[] = [];
let secaoAtual = "geral";

function bloco(nome: string): void {
  secaoAtual = nome;
}

function ok(nome: string, condicao: boolean, detalhe = ""): void {
  casos.push({ secao: secaoAtual, nome, ok: condicao, detalhe });
}

function publicar(): void {
  for (const nome of [...new Set(casos.map((c) => c.secao))]) {
    describe(nome, () => {
      for (const caso of casos.filter((c) => c.secao === nome)) {
        it(caso.nome, () => {
          expect(caso.ok, caso.detalhe || caso.nome).toBe(true);
        });
      }
    });
  }
}

// ---------------------------------------------------------------------------
// F — a ponte com o banco: `calcularParaJornada` contra um Supabase FALSO
//
// Existe porque dois bugs desta fase moravam AQUI, não no motor puro:
//   (a) uma jornada com 10 bens na Ficha entregava `entrada.bens.length === 1`;
//   (b) `croqui.mapa_rubricas` preenchido sobrescrevia a célula do cenário
//       ERRADO, porque o casamento era só pelo nome da rubrica — e o `itcmd` do
//       cenário de doação e o do de inventário são a mesma palavra.
// Nenhum dos dois aparece em teste do motor puro: o motor recebe a entrada
// pronta e calcula certo em cima de uma entrada errada.
// ---------------------------------------------------------------------------

interface ChamadaFalsa {
  tabela: string;
}

/**
 * Cliente Supabase mínimo: encadeia `select/eq/in/order`, resolve como promessa
 * (lista) ou por `maybeSingle()` (primeira linha), e ANOTA cada `from()`. A
 * anotação é o que transforma "reduzi as idas ao banco" em número.
 */
function criarClienteFalso(fontes: Record<string, unknown>, chamadas: ChamadaFalsa[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const from = (tabela: string): any => {
    chamadas.push({ tabela });
    const alvo = fontes[tabela] ?? [];
    const primeira = Array.isArray(alvo) ? (alvo[0] ?? null) : alvo;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api: any = {
      select: () => api,
      eq: () => api,
      in: () => api,
      order: () => api,
      returns: () => api,
      maybeSingle: async () => ({ data: primeira, error: null }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      then: (aceitar: any, recusar: any) => Promise.resolve({ data: alvo, error: null }).then(aceitar, recusar),
    };
    return api;
  };
  return { from };
}

const JORNADA_F = "11111111-1111-4111-8111-111111111111";
const PESSOA_F = "22222222-2222-4222-8222-222222222222";

/** 10 bens ativos + 1 dado baixa, cobrindo classe, DIRPF, mercado e locação. */
function bensDaFicha() {
  const classes = [
    "imovel", "imovel", "imovel", "veiculo", "veiculo",
    "investimento", "previdencia", "empresa", "outro", "imovel",
  ];
  const itens = classes.map((tipo, i) => ({
    id: `bem-${i + 1}`,
    pessoa_id: PESSOA_F,
    tipo,
    descricao: `Bem ${i + 1}`,
    ano_aquisicao: 2010 + i,
    valor_historico: 100_000 + i * 1_000,
    valor_mercado: 200_000 + i * 2_000,
    destinacao: i % 3 === 0 ? "locacao" : "residencia",
    valor_locacao_mensal: i % 3 === 0 ? 2_000 + i * 10 : null,
    detalhes: tipo === "empresa" ? { faturamento_mensal: 50_000, custo_operacional_mensal: 20_000 } : {},
    ativo: true,
    criado_em: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
  }));
  itens.push({
    id: "bem-baixado",
    pessoa_id: PESSOA_F,
    tipo: "imovel",
    descricao: "Imóvel vendido no ano passado",
    ano_aquisicao: 2001,
    valor_historico: 999_999,
    valor_mercado: 999_999,
    destinacao: "residencia",
    valor_locacao_mensal: null,
    detalhes: {},
    ativo: false,
    criado_em: "2026-01-20T00:00:00Z",
  });
  return itens;
}

function fontesF(mapaRubricas: Record<string, unknown>) {
  return {
    jornadas: [
      {
        id: JORNADA_F,
        pessoa_id: PESSOA_F,
        pessoas: {
          uf: "SP",
          cidade: "São Paulo",
          patrimonio_itens: bensDaFicha(),
          familiares: [
            { id: "fam-1", pessoa_id: PESSOA_F, parentesco: "conjuge", nome: "C", regime_casamento: "comunhao parcial", ativo: true, criado_em: "2026-01-01T00:00:00Z" },
            { id: "fam-2", pessoa_id: PESSOA_F, parentesco: "filho", nome: "F1", ativo: true, criado_em: "2026-01-02T00:00:00Z" },
            { id: "fam-3", pessoa_id: PESSOA_F, parentesco: "filho", nome: "F2", ativo: false, criado_em: "2026-01-03T00:00:00Z" },
          ],
        },
      },
    ],
    configuracoes: [
      { chave: "croqui.uf_domicilio_vantajoso", valor: "mg" },
      { chave: "croqui.mapa_rubricas", valor: mapaRubricas },
      { chave: "croqui.horas_por_ato", valor: [] },
      { chave: "croqui.sinal_modelo_referencia", valor: "celula_3" },
      { chave: "parametros.divergencias", valor: [] },
    ],
    cenario_rubricas: [
      { id: "rub-doacao", rubrica: "itcmd", valor: 111, procedencia: "digitado", cenarios_patrimoniais: { jornada_id: JORNADA_F, cenario: "doacao" } },
      { id: "rub-inventario", rubrica: "itcmd", valor: 222, procedencia: "digitado", cenarios_patrimoniais: { jornada_id: JORNADA_F, cenario: "inventario" } },
    ],
    parametros_metodo: [],
  };
}

async function testeF() {
  bloco("F · ponte com o banco (bens da ficha e override por cenário)");

  // (a) todos os bens ativos entram — o bug era `entrada.bens.length === 1`.
  const chamadas: ChamadaFalsa[] = [];
  const cliente = criarClienteFalso(
    fontesF({ "doacao.itcmd": { tabela: "doacao", linha: "itcmd", coluna: "valor" } }),
    chamadas,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const calculo = await calcularParaJornada(cliente as any, JORNADA_F);
  const bens = calculo.entrada.bens;
  const classes = new Set(bens.map((b) => b.classe));

  ok("10 bens ativos entram na entrada (o bem dado baixa não entra)", bens.length === 10, `veio ${bens.length}`);
  ok("nenhum bem perde a classe", bens.every((b) => typeof b.classe === "string" && b.classe.length > 0));
  ok("as 6 classes de `tipo_bem` sobrevivem ao mapeamento", classes.size === 6, `${classes.size} classes`);
  ok("todo bem traz DIRPF e valor de mercado", bens.every((b) => b.valor_dirpf !== null && b.valor_mercado !== null));
  ok(
    "bem de locação traz o aluguel",
    bens.filter((b) => b.destinacao === "locacao").every((b) => b.valor_locacao_mensal !== null),
  );
  ok("são 4 bens de locação", bens.filter((b) => b.destinacao === "locacao").length === 4);
  ok("o bem dado baixa ficou de fora", !bens.some((b) => b.descricao.includes("vendido")));
  ok("empresa alimenta o operacional", calculo.entrada.operacional?.faturamento_mensal === 50_000);
  ok("familiar dado baixa não conta", calculo.entrada.familia.filhos === 1, `filhos=${calculo.entrada.familia.filhos}`);
  ok("uf vantajosa da configuração entra em maiúscula", calculo.entrada.uf_domicilio_vantajoso === "MG");
  ok("T2 lista os 10 bens", (calculo.resultado.tabelas.formacao_patrimonial?.linhas.length ?? 0) >= 10);

  // (b) o override casa rubrica E cenário.
  const overrides = calculo.entrada.overrides;
  ok("mapa 'doacao.itcmd' produz UM override", overrides.length === 1, `veio ${overrides.length}`);
  ok("e é a rubrica do cenário de doação, não a do inventário", overrides[0]?.rubrica_id === "rub-doacao", `veio ${overrides[0]?.rubrica_id}`);
  ok("o valor é o do cenário certo", overrides[0]?.valor === 111);

  // (c) chave sem cenário não casa mais — é o que impedia a 0066 de semear o mapa.
  const chamadas2: ChamadaFalsa[] = [];
  const cliente2 = criarClienteFalso(fontesF({ itcmd: { tabela: "doacao", linha: "itcmd", coluna: "valor" } }), chamadas2);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const semCenario = await calcularParaJornada(cliente2 as any, JORNADA_F);
  ok(
    "mapa só com o nome da rubrica não sobrescreve nada",
    semCenario.entrada.overrides.length === 0,
    `veio ${semCenario.entrada.overrides.length}`,
  );

  // (d) mapa vazio nem consulta `cenario_rubricas`.
  const chamadas3: ChamadaFalsa[] = [];
  const cliente3 = criarClienteFalso(fontesF({}), chamadas3);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await calcularParaJornada(cliente3 as any, JORNADA_F);
  const tabelas3 = chamadas3.map((c) => c.tabela);
  ok("mapa vazio não consulta `cenario_rubricas`", !tabelas3.includes("cenario_rubricas"));
  ok(
    "3 consultas no caminho normal (jornadas, configuracoes, parametros_metodo)",
    chamadas3.length === 3,
    `foram ${chamadas3.length}: ${tabelas3.join(", ")}`,
  );
  ok("`jornadas` é consultada UMA vez", tabelas3.filter((t) => t === "jornadas").length === 1);
  ok("`configuracoes` é consultada UMA vez", tabelas3.filter((t) => t === "configuracoes").length === 1);
  ok(
    "com mapa preenchido são 4 (a quarta é `cenario_rubricas`)",
    chamadas.length === 4,
    `foram ${chamadas.length}: ${chamadas.map((c) => c.tabela).join(", ")}`,
  );
}

await testeF();

publicar();
