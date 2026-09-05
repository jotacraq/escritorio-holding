import type {
  EntradaCroqui,
  FaltaParametro,
  ModeloCroqui,
  UnidadeParametroCroqui,
} from "@/types/croqui-calculo";

/**
 * Catálogo de parâmetros do Motor do Croqui (§4.4). Cada chave declara
 * unidade, jurisdição e se a base legal é obrigatória — é o contrato que a
 * tela de Admin → Parâmetros e a 0062 (seed) leem.
 *
 * Duas regras que este arquivo existe para sustentar:
 *
 * - **B30 intacto:** nada com jurisdição é semeado. ITCMD, ITBI, cartório por
 *   UF e honorário de inventário nascem VAZIOS e só entram por cadastro com
 *   base legal. Alíquota de imposto não é palpite de migration.
 * - **Divergência não vira escolha:** três chaves têm dois valores diferentes
 *   no material do próprio escritório (§11.5). Ficam `divergente: true`,
 *   travam a tabela que dependem delas e aparecem no Painel do admin — o
 *   motor NUNCA escolhe um dos dois.
 */

export const CHAVES_PARAMETRO_CROQUI = [
  // 1–4 · ITCMD por faixa, hoje e pós-reforma
  "itcmd.faixas.heranca",
  "itcmd.faixas.doacao",
  "itcmd.faixas.heranca_reforma",
  "itcmd.faixas.doacao_reforma",
  // 5–6 · ITCMD da 3ª célula (parâmetro dedicado, não o artifício da planilha)
  "itcmd.fixo.celula_3",
  "itcmd.fixo.celula_3_reforma",
  // 7 · 2ª célula (domicílio fiscal vantajoso)
  "itcmd.aliquota.domicilio_vantajoso",
  // 8 · ITBI
  "itbi.aliquota",
  // 9–12 · cartório: tabela da UF (verdade) e percentual (fallback)
  "cartorio.faixas.notas",
  "cartorio.faixas.imoveis",
  "cartorio.notas.percentual_fallback",
  "cartorio.imoveis.percentual_fallback",
  // 13 · certidões (DIVERGENTE: 2.000 × 7.000)
  "cartorio.certidoes.valor",
  // 14 · honorários do inventário (mínimo OAB)
  "honorarios.inventario.percentual",
  // 15–16 · tabelas federais
  "ir.faixas.ganho_capital",
  "ir.faixas.irpf_mensal",
  // 17 · venda forçada
  "venda_forcada.desagio.percentual",
  // 18–23 · custo de constituição por modelo
  "holding.junta_comercial.celula_1",
  "holding.junta_comercial.celula_2",
  "holding.junta_comercial.celula_3",
  "holding.contabilidade.celula_1",
  "holding.contabilidade.celula_2",
  "holding.contabilidade.celula_3",
  // 24–25 · honorários da holding (fórmula: hora × horas + operacional)
  "honorarios.hora",
  "honorarios.operacional.percentual",
  // 26–30 · deduções da cadeia comercial
  "honorarios.sv.padrao",
  "incentivo.resolvedor.sv",
  "honorarios.croqui.padrao",
  "honorarios.croqui.incentivo",
  "incentivo.resolvedor.croqui",
  // 31–33 · incentivo sobre o saldo e parcelamento
  "incentivo.resolvedor.saldo.percentual",
  "pagamento.sinal.percentual",
  "pagamento.parcelas.max",
  // 34–35 · membership (DIVERGENTE: 1 plano × 3 planos)
  "membership.mensalidade",
  "membership.meses_isentos",
  // 36–39 · reforma tributária e locação via PJ
  "reforma.ibs_cbs.debito.percentual",
  "reforma.ibs_cbs.credito.percentual",
  "reforma.irpj_csll.percentual",
  "locacao.pj.presumido.percentual",
  // 40–41 · premissas do payback e do risco operacional
  "payback.cdi_anual.percentual",
  "operacional.risco_bloqueio.meses",
] as const;

export type ChaveParametroCroqui = (typeof CHAVES_PARAMETRO_CROQUI)[number];

export type Jurisdicao = "nenhuma" | "uf" | "uf_municipio";

export interface DefinicaoParametro {
  chave: ChaveParametroCroqui;
  /** rótulo humano, para a tela de Admin e para o motivo da célula ausente */
  rotulo: string;
  unidade: UnidadeParametroCroqui;
  jurisdicao: Jurisdicao;
  base_legal_obrigatoria: boolean;
  /** default do MÉTODO (regra do escritório). Só existe onde a 0062 semeia. */
  padrao?: number;
  /** true = a 0062 semeia esta chave (nacional, regra do método) */
  semeado: boolean;
  /** true = dois valores conflitantes no material do escritório (§11.5) */
  divergente?: boolean;
  notas?: string;
}

const def = (d: DefinicaoParametro): DefinicaoParametro => d;

export const CATALOGO_PARAMETROS: Record<ChaveParametroCroqui, DefinicaoParametro> = {
  "itcmd.faixas.heranca": def({
    chave: "itcmd.faixas.heranca",
    rotulo: "ITCMD causa mortis",
    unidade: "faixas",
    jurisdicao: "uf",
    base_legal_obrigatoria: true,
    semeado: false,
  }),
  "itcmd.faixas.doacao": def({
    chave: "itcmd.faixas.doacao",
    rotulo: "ITCMD doação",
    unidade: "faixas",
    jurisdicao: "uf",
    base_legal_obrigatoria: true,
    semeado: false,
  }),
  "itcmd.faixas.heranca_reforma": def({
    chave: "itcmd.faixas.heranca_reforma",
    rotulo: "ITCMD causa mortis pós-reforma",
    unidade: "faixas",
    jurisdicao: "uf",
    base_legal_obrigatoria: true,
    semeado: false,
    notas: "Premissa de progressividade obrigatória da EC 132/2023 — cadastro do escritório, não lei vigente.",
  }),
  "itcmd.faixas.doacao_reforma": def({
    chave: "itcmd.faixas.doacao_reforma",
    rotulo: "ITCMD doação pós-reforma",
    unidade: "faixas",
    jurisdicao: "uf",
    base_legal_obrigatoria: true,
    semeado: false,
  }),
  "itcmd.fixo.celula_3": def({
    chave: "itcmd.fixo.celula_3",
    rotulo: "ITCMD da 3ª célula",
    unidade: "brl",
    jurisdicao: "uf",
    base_legal_obrigatoria: true,
    semeado: false,
    notas: "Parâmetro dedicado. A planilha usa 'alíquota da faixa 1 × R$ 10.000' — artifício que o motor não replica.",
  }),
  "itcmd.fixo.celula_3_reforma": def({
    chave: "itcmd.fixo.celula_3_reforma",
    rotulo: "ITCMD da 3ª célula pós-reforma",
    unidade: "brl",
    jurisdicao: "uf",
    base_legal_obrigatoria: true,
    semeado: false,
  }),
  "itcmd.aliquota.domicilio_vantajoso": def({
    chave: "itcmd.aliquota.domicilio_vantajoso",
    rotulo: "ITCMD do domicílio vantajoso",
    unidade: "percentual",
    jurisdicao: "uf",
    base_legal_obrigatoria: true,
    semeado: false,
    notas: "2ª célula. Na planilha está 2% digitado à mão; aqui é parâmetro da UF de destino, com base legal.",
  }),
  "itbi.aliquota": def({
    chave: "itbi.aliquota",
    rotulo: "ITBI",
    unidade: "percentual",
    jurisdicao: "uf_municipio",
    base_legal_obrigatoria: true,
    semeado: false,
  }),
  "cartorio.faixas.notas": def({
    chave: "cartorio.faixas.notas",
    rotulo: "Cartório de notas (tabela da UF)",
    unidade: "faixas",
    jurisdicao: "uf",
    base_legal_obrigatoria: true,
    semeado: false,
    notas: "Tabela de emolumentos do TJ da UF — fonte de verdade. Sem ela, o motor cai no percentual de aproximação.",
  }),
  "cartorio.faixas.imoveis": def({
    chave: "cartorio.faixas.imoveis",
    rotulo: "Cartório de imóveis (tabela da UF)",
    unidade: "faixas",
    jurisdicao: "uf",
    base_legal_obrigatoria: true,
    semeado: false,
  }),
  "cartorio.notas.percentual_fallback": def({
    chave: "cartorio.notas.percentual_fallback",
    rotulo: "Cartório de notas (aproximação)",
    unidade: "percentual",
    jurisdicao: "uf",
    base_legal_obrigatoria: true,
    padrao: 0.8,
    semeado: false,
    notas: "Aproximação de 0,8% usada pela planilha quando a UF não tem tabela. Cadastro por UF — não semeado.",
  }),
  "cartorio.imoveis.percentual_fallback": def({
    chave: "cartorio.imoveis.percentual_fallback",
    rotulo: "Cartório de imóveis (aproximação)",
    unidade: "percentual",
    jurisdicao: "uf",
    base_legal_obrigatoria: true,
    padrao: 0.5,
    semeado: false,
  }),
  "cartorio.certidoes.valor": def({
    chave: "cartorio.certidoes.valor",
    rotulo: "Certidões e custas",
    unidade: "brl",
    jurisdicao: "nenhuma",
    base_legal_obrigatoria: false,
    semeado: false,
    divergente: true,
    notas: "DIVERGÊNCIA: R$ 2.000 na aba 3 × R$ 7.000 nas abas 4–7 da mesma planilha. Trava T3, T5 e T6.",
  }),
  "honorarios.inventario.percentual": def({
    chave: "honorarios.inventario.percentual",
    rotulo: "Honorários do inventário",
    unidade: "percentual",
    jurisdicao: "uf",
    base_legal_obrigatoria: true,
    semeado: false,
    notas: "Mínimo da tabela da OAB da UF (7% na planilha do escritório). Varia por seccional — por isso tem jurisdição.",
  }),
  "ir.faixas.ganho_capital": def({
    chave: "ir.faixas.ganho_capital",
    rotulo: "IR sobre ganho de capital",
    unidade: "faixas",
    jurisdicao: "nenhuma",
    base_legal_obrigatoria: true,
    semeado: true,
    notas: "Tabela federal progressiva: isento até 35.000, depois 15% / 17,5% / 20% / 22,5%.",
  }),
  "ir.faixas.irpf_mensal": def({
    chave: "ir.faixas.irpf_mensal",
    rotulo: "IRPF mensal",
    unidade: "faixas",
    jurisdicao: "nenhuma",
    base_legal_obrigatoria: true,
    semeado: true,
    notas: "Tabela progressiva mensal com parcela a deduzir (carnê-leão do aluguel).",
  }),
  "venda_forcada.desagio.percentual": def({
    chave: "venda_forcada.desagio.percentual",
    rotulo: "Deságio da venda urgente",
    unidade: "percentual",
    jurisdicao: "nenhuma",
    base_legal_obrigatoria: false,
    padrao: 20,
    semeado: true,
  }),
  "holding.junta_comercial.celula_1": def({
    chave: "holding.junta_comercial.celula_1",
    rotulo: "Junta comercial · 1 célula",
    unidade: "brl",
    jurisdicao: "nenhuma",
    base_legal_obrigatoria: false,
    padrao: 3577,
    semeado: true,
    notas: "511 × 7 atos.",
  }),
  "holding.junta_comercial.celula_2": def({
    chave: "holding.junta_comercial.celula_2",
    rotulo: "Junta comercial · 2 células",
    unidade: "brl",
    jurisdicao: "nenhuma",
    base_legal_obrigatoria: false,
    padrao: 3500,
    semeado: true,
    notas: "500 × 7 atos na planilha, contra 511 nas outras duas — diferença de R$ 77 que parece digitação (§11.5-6).",
  }),
  "holding.junta_comercial.celula_3": def({
    chave: "holding.junta_comercial.celula_3",
    rotulo: "Junta comercial · 3 células",
    unidade: "brl",
    jurisdicao: "nenhuma",
    base_legal_obrigatoria: false,
    padrao: 4599,
    semeado: true,
    notas: "511 × 9 atos.",
  }),
  "holding.contabilidade.celula_1": def({
    chave: "holding.contabilidade.celula_1",
    rotulo: "Contabilidade · 1 célula",
    unidade: "brl",
    jurisdicao: "nenhuma",
    base_legal_obrigatoria: false,
    padrao: 2133,
    semeado: true,
    notas: "711 × 3 atos.",
  }),
  "holding.contabilidade.celula_2": def({
    chave: "holding.contabilidade.celula_2",
    rotulo: "Contabilidade · 2 células",
    unidade: "brl",
    jurisdicao: "nenhuma",
    base_legal_obrigatoria: false,
    padrao: 3555,
    semeado: true,
    notas: "711 × 5 atos.",
  }),
  "holding.contabilidade.celula_3": def({
    chave: "holding.contabilidade.celula_3",
    rotulo: "Contabilidade · 3 células",
    unidade: "brl",
    jurisdicao: "nenhuma",
    base_legal_obrigatoria: false,
    padrao: 4266,
    semeado: true,
    notas: "711 × 6 atos.",
  }),
  "honorarios.hora": def({
    chave: "honorarios.hora",
    rotulo: "Hora do método",
    unidade: "brl",
    jurisdicao: "nenhuma",
    base_legal_obrigatoria: false,
    padrao: 1800,
    semeado: true,
  }),
  "honorarios.operacional.percentual": def({
    chave: "honorarios.operacional.percentual",
    rotulo: "Valor operacional",
    unidade: "percentual",
    jurisdicao: "nenhuma",
    base_legal_obrigatoria: false,
    padrao: 10,
    semeado: true,
  }),
  "honorarios.sv.padrao": def({
    chave: "honorarios.sv.padrao",
    rotulo: "Sessão de Viabilidade",
    unidade: "brl",
    jurisdicao: "nenhuma",
    base_legal_obrigatoria: false,
    padrao: 2000,
    semeado: true,
  }),
  "incentivo.resolvedor.sv": def({
    chave: "incentivo.resolvedor.sv",
    rotulo: "Incentivo da Sessão",
    unidade: "brl",
    jurisdicao: "nenhuma",
    base_legal_obrigatoria: false,
    padrao: 2400,
    semeado: true,
  }),
  "honorarios.croqui.padrao": def({
    chave: "honorarios.croqui.padrao",
    rotulo: "Croqui (tabela)",
    unidade: "brl",
    jurisdicao: "nenhuma",
    base_legal_obrigatoria: false,
    padrao: 7200,
    semeado: false,
    notas: "Já semeada pela 0056. Não entra em T17: a dedução usa o valor com incentivo, que é o que o cliente pagou.",
  }),
  "honorarios.croqui.incentivo": def({
    chave: "honorarios.croqui.incentivo",
    rotulo: "Croqui (incentivo)",
    unidade: "brl",
    jurisdicao: "nenhuma",
    base_legal_obrigatoria: false,
    padrao: 4500,
    semeado: false,
    notas: "Já semeada pela 0056.",
  }),
  "incentivo.resolvedor.croqui": def({
    chave: "incentivo.resolvedor.croqui",
    rotulo: "Incentivo do Croqui",
    unidade: "brl",
    jurisdicao: "nenhuma",
    base_legal_obrigatoria: false,
    padrao: 2700,
    semeado: true,
  }),
  "incentivo.resolvedor.saldo.percentual": def({
    chave: "incentivo.resolvedor.saldo.percentual",
    rotulo: "Incentivo sobre o saldo",
    unidade: "percentual",
    jurisdicao: "nenhuma",
    base_legal_obrigatoria: false,
    padrao: 10,
    semeado: true,
    notas: "Sobre o SALDO (B18 = B17 × 0,1), não sobre o honorário cheio.",
  }),
  "pagamento.sinal.percentual": def({
    chave: "pagamento.sinal.percentual",
    rotulo: "Sinal",
    unidade: "percentual",
    jurisdicao: "nenhuma",
    base_legal_obrigatoria: false,
    padrao: 10,
    semeado: true,
    notas: "10% do novo saldo do modelo de referência — igual para os três modelos (B22 = 10% × D19).",
  }),
  "pagamento.parcelas.max": def({
    chave: "pagamento.parcelas.max",
    rotulo: "Parcelas",
    unidade: "parcelas",
    jurisdicao: "nenhuma",
    base_legal_obrigatoria: false,
    padrao: 5,
    semeado: true,
  }),
  "membership.mensalidade": def({
    chave: "membership.mensalidade",
    rotulo: "Membership",
    unidade: "brl",
    jurisdicao: "nenhuma",
    base_legal_obrigatoria: false,
    semeado: false,
    divergente: true,
    notas: "DIVERGÊNCIA: 1 plano (contrato, R$ 2.000) × 3 planos (slide 37). Trava T19.",
  }),
  "membership.meses_isentos": def({
    chave: "membership.meses_isentos",
    rotulo: "Meses isentos",
    unidade: "meses",
    jurisdicao: "nenhuma",
    base_legal_obrigatoria: false,
    padrao: 6,
    semeado: true,
  }),
  "reforma.ibs_cbs.debito.percentual": def({
    chave: "reforma.ibs_cbs.debito.percentual",
    rotulo: "IBS/CBS · débito",
    unidade: "percentual",
    jurisdicao: "nenhuma",
    base_legal_obrigatoria: true,
    padrao: 15.9,
    semeado: true,
  }),
  "reforma.ibs_cbs.credito.percentual": def({
    chave: "reforma.ibs_cbs.credito.percentual",
    rotulo: "IBS/CBS · crédito",
    unidade: "percentual",
    jurisdicao: "nenhuma",
    base_legal_obrigatoria: true,
    semeado: false,
    divergente: true,
    notas: "DIVERGÊNCIA: 26,5% (aba 10) × 36,92% (aba 8) na mesma planilha. Trava T10 e T12.",
  }),
  "reforma.irpj_csll.percentual": def({
    chave: "reforma.irpj_csll.percentual",
    rotulo: "IRPJ/CSLL",
    unidade: "percentual",
    jurisdicao: "nenhuma",
    base_legal_obrigatoria: true,
    padrao: 7.68,
    semeado: true,
  }),
  "locacao.pj.presumido.percentual": def({
    chave: "locacao.pj.presumido.percentual",
    rotulo: "PIS/COFINS do presumido",
    unidade: "percentual",
    jurisdicao: "nenhuma",
    base_legal_obrigatoria: true,
    padrao: 3.65,
    semeado: true,
  }),
  "payback.cdi_anual.percentual": def({
    chave: "payback.cdi_anual.percentual",
    rotulo: "CDI ao ano",
    unidade: "percentual",
    jurisdicao: "nenhuma",
    base_legal_obrigatoria: false,
    padrao: 10,
    semeado: true,
    notas: "Premissa de rendimento, não promessa. A tela mostra como premissa editável.",
  }),
  "operacional.risco_bloqueio.meses": def({
    chave: "operacional.risco_bloqueio.meses",
    rotulo: "Risco de bloqueio",
    unidade: "meses",
    jurisdicao: "nenhuma",
    base_legal_obrigatoria: false,
    padrao: 6,
    semeado: true,
  }),
};

/** Chaves que a 0062 semeia — nacionais e de regra do método. */
export const CHAVES_SEMEADAS: ChaveParametroCroqui[] = CHAVES_PARAMETRO_CROQUI.filter(
  (c) => CATALOGO_PARAMETROS[c].semeado,
);

/** Chaves com divergência aberta (§11.5): travam a tabela, nunca escolhem. */
export const CHAVES_DIVERGENTES: ChaveParametroCroqui[] = CHAVES_PARAMETRO_CROQUI.filter(
  (c) => CATALOGO_PARAMETROS[c].divergente === true,
);

// ---------------------------------------------------------------------------
// chavesNecessarias — o subconjunto que ESTE cliente exige
// ---------------------------------------------------------------------------

const temImovel = (e: EntradaCroqui) => e.bens.some((b) => b.classe === "imovel");
const temLocacao = (e: EntradaCroqui) => e.bens.some((b) => (b.valor_locacao_mensal ?? 0) > 0);

/**
 * Só o que aquele cliente precisa — um cliente de 1 célula em SP sem locação
 * não deve ver "faltam 41 parâmetros". É o que alimenta o aviso "faltam N
 * parâmetros para fechar este croqui" e o 409 da rota.
 */
export function chavesNecessarias(entrada: EntradaCroqui): ChaveParametroCroqui[] {
  const necessarias = new Set<ChaveParametroCroqui>();
  const add = (...chaves: ChaveParametroCroqui[]) => chaves.forEach((c) => necessarias.add(c));
  const modelos = new Set<ModeloCroqui>(entrada.modelos);
  const imovel = temImovel(entrada);
  const locacao = temLocacao(entrada);
  const holding = ["celula_1", "celula_2", "celula_3"].some((m) => modelos.has(m as ModeloCroqui));

  if (locacao) add("ir.faixas.irpf_mensal");

  if (modelos.has("inventario")) {
    add(
      "itcmd.faixas.heranca",
      "itcmd.faixas.heranca_reforma",
      "cartorio.certidoes.valor",
      "honorarios.inventario.percentual",
      "venda_forcada.desagio.percentual",
      "ir.faixas.ganho_capital",
    );
    if (imovel) add("cartorio.faixas.notas", "cartorio.notas.percentual_fallback");
    add("cartorio.faixas.imoveis", "cartorio.imoveis.percentual_fallback");
  }

  if (modelos.has("doacao")) {
    add("itcmd.faixas.doacao", "cartorio.certidoes.valor");
    if (imovel) add("cartorio.faixas.notas", "cartorio.notas.percentual_fallback");
    add("cartorio.faixas.imoveis", "cartorio.imoveis.percentual_fallback");
  }

  if (modelos.has("celula_1")) {
    add("itcmd.faixas.doacao", "holding.junta_comercial.celula_1", "holding.contabilidade.celula_1");
  }
  if (modelos.has("celula_2")) {
    add(
      "itcmd.aliquota.domicilio_vantajoso",
      "holding.junta_comercial.celula_2",
      "holding.contabilidade.celula_2",
    );
  }
  if (modelos.has("celula_3")) {
    add("itcmd.fixo.celula_3", "holding.junta_comercial.celula_3", "holding.contabilidade.celula_3");
  }

  if (holding) {
    add(
      "cartorio.faixas.imoveis",
      "cartorio.imoveis.percentual_fallback",
      "honorarios.hora",
      "honorarios.operacional.percentual",
      "honorarios.sv.padrao",
      "incentivo.resolvedor.sv",
      "honorarios.croqui.incentivo",
      "incentivo.resolvedor.croqui",
      "incentivo.resolvedor.saldo.percentual",
      "pagamento.sinal.percentual",
      "pagamento.parcelas.max",
      "membership.mensalidade",
      "membership.meses_isentos",
    );
    if (imovel) add("itbi.aliquota");
    if (modelos.has("inventario")) {
      if (entrada.cdi_anual === null || entrada.cdi_anual === undefined) add("payback.cdi_anual.percentual");
      if (locacao) {
        add("ir.faixas.irpf_mensal", "reforma.irpj_csll.percentual", "locacao.pj.presumido.percentual");
      }
    }
  }

  if (locacao) {
    add(
      "reforma.ibs_cbs.debito.percentual",
      "reforma.ibs_cbs.credito.percentual",
      "reforma.irpj_csll.percentual",
    );
  }

  if (entrada.operacional) {
    add(
      "reforma.ibs_cbs.debito.percentual",
      "reforma.ibs_cbs.credito.percentual",
      "reforma.irpj_csll.percentual",
      "operacional.risco_bloqueio.meses",
    );
  }

  return CHAVES_PARAMETRO_CROQUI.filter((c) => necessarias.has(c));
}

/** Jurisdição em que a chave precisa existir para ESTE cliente. */
export function jurisdicaoDe(entrada: EntradaCroqui, chave: ChaveParametroCroqui): FaltaParametro {
  const d = CATALOGO_PARAMETROS[chave];
  const uf =
    chave === "itcmd.aliquota.domicilio_vantajoso"
      ? entrada.uf_domicilio_vantajoso ?? undefined
      : entrada.uf ?? undefined;
  if (d.jurisdicao === "uf_municipio") return { chave, uf, municipio: entrada.municipio ?? undefined };
  if (d.jurisdicao === "uf") return { chave, uf };
  return { chave };
}

/**
 * As mesmas chaves, já com a jurisdição em que precisam existir — é o que a
 * rota devolve no 409 e o que a tela usa para linkar "cadastrar em Admin →
 * Parâmetros" já filtrado pela UF do cliente.
 */
export function jurisdicoesNecessarias(entrada: EntradaCroqui): FaltaParametro[] {
  return chavesNecessarias(entrada).map((chave) => jurisdicaoDe(entrada, chave));
}
