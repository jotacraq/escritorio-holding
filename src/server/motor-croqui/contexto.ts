import type {
  BemCroqui,
  Celula,
  ChaveTabela,
  EntradaCroqui,
  ModeloHolding,
  ParametroCroqui,
  ParametrosCroqui,
  TabelaFaixas,
} from "@/types/croqui-calculo";
import { CATALOGO_PARAMETROS, jurisdicaoDe, type ChaveParametroCroqui } from "./catalogo";
import { celulaAusente, celulaCalculada, celulaDigitada, derivar, somar } from "./celula";
import { aplicarFaixas, ErroFaixasInvalidas } from "./faixas";

/**
 * O contexto de um cálculo: entrada, parâmetros, overrides e os totais do
 * patrimônio. Toda célula do resultado nasce daqui, e é aqui que:
 *
 * - a ausência de parâmetro vira `ausente` com a CHAVE que falta (nunca zero);
 * - a divergência não resolvida (§11.5) trava a célula em vez de escolher um
 *   dos dois valores do escritório;
 * - o override do Cenário Patrimonial (0057) entra como `digitado` ANTES das
 *   somas, para propagar naturalmente pelos totais.
 */

export const chaveMapa = (chave: string, uf?: string | null, municipio?: string | null) =>
  `${chave}|${uf ?? ""}|${municipio ?? ""}`;

export interface TotaisPatrimonio {
  dirpf: Celula;
  mercado: Celula;
  dirpf_imoveis: Celula;
  mercado_imoveis: Celula;
  rendimento_mensal: Celula;
  /** diferença mercado − DIRPF dos imóveis, só as positivas (base do ITBI) */
  valorizacao_imoveis: Celula;
}

const soma = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

export class ContextoCroqui {
  readonly entrada: EntradaCroqui;
  readonly parametros: ParametrosCroqui;
  readonly totais: TotaisPatrimonio;
  private readonly overrides: Map<string, { valor: number; rubrica_id: string }>;
  private readonly divergentes: Map<string, string>;

  constructor(entrada: EntradaCroqui, parametros: ParametrosCroqui) {
    this.entrada = entrada;
    this.parametros = parametros;
    this.overrides = new Map(
      (entrada.overrides ?? []).map((o) => [
        `${o.tabela}|${o.linha}|${o.coluna}`,
        { valor: o.valor, rubrica_id: o.rubrica_id },
      ]),
    );
    this.divergentes = new Map(
      (parametros.divergencias ?? []).map((d) => [
        d.chave,
        `parâmetro em divergência (${d.valores.join(" × ")}) — ${d.onde}`,
      ]),
    );
    this.totais = this.calcularTotais();
  }

  // -------------------------------------------------------------------------
  // Patrimônio
  // -------------------------------------------------------------------------

  get bens(): BemCroqui[] {
    return this.entrada.bens ?? [];
  }

  get imoveis(): BemCroqui[] {
    return this.bens.filter((b) => b.classe === "imovel");
  }

  get temImovel(): boolean {
    return this.imoveis.length > 0;
  }

  /**
   * Valor de um bem já com o override aplicado — é por aqui que T2 e TODOS os
   * totais leem, para que um ajuste da advogada num bem apareça no total sem
   * recálculo separado.
   */
  celulaBem(bem: BemCroqui, campo: "dirpf" | "mercado"): Celula {
    const v = campo === "dirpf" ? bem.valor_dirpf : bem.valor_mercado;
    const base =
      typeof v === "number"
        ? celulaCalculada(v, { formula: campo === "dirpf" ? "declarado no DIRPF" : "avaliação de mercado" })
        : celulaAusente(`"${bem.descricao}" sem ${campo === "dirpf" ? "valor de DIRPF" : "valor de mercado"}`);
    return this.c("formacao_patrimonial", bem.id, campo, base);
  }

  private totalDe(bens: BemCroqui[], campo: "dirpf" | "mercado", rotulo: string): Celula {
    if (bens.length === 0) return celulaCalculada(0, { formula: `sem bens em ${rotulo}` });
    return somar(
      bens.map((b) => this.celulaBem(b, campo)),
      `soma de ${bens.length} ${rotulo}`,
    );
  }

  private calcularTotais(): TotaisPatrimonio {
    const imoveis = this.imoveis;
    const rendimentos = this.bens
      .map((b) => b.valor_locacao_mensal)
      .filter((v): v is number => typeof v === "number" && v > 0);

    const valorizacao = imoveis.map((b) =>
      derivar([this.celulaBem(b, "mercado"), this.celulaBem(b, "dirpf")], ([m, d]) => Math.max(0, m - d)),
    );

    return {
      dirpf: this.totalDe(this.bens, "dirpf", "bens (DIRPF)"),
      mercado: this.totalDe(this.bens, "mercado", "bens (mercado)"),
      dirpf_imoveis: this.totalDe(imoveis, "dirpf", "imóveis (DIRPF)"),
      mercado_imoveis: this.totalDe(imoveis, "mercado", "imóveis (mercado)"),
      rendimento_mensal: celulaCalculada(soma(rendimentos), {
        formula: `soma do aluguel mensal de ${rendimentos.length} bem(ns)`,
      }),
      valorizacao_imoveis:
        imoveis.length === 0
          ? celulaCalculada(0, { formula: "sem imóveis" })
          : somar(valorizacao, "soma das valorizações positivas (mercado − DIRPF) dos imóveis"),
    };
  }

  /** Base de cálculo do modelo: mercado ou DIRPF, conforme `BASE_ITCMD`. */
  baseDe(tipo: "mercado" | "dirpf"): Celula {
    return tipo === "dirpf" ? this.totais.dirpf : this.totais.mercado;
  }

  // -------------------------------------------------------------------------
  // Parâmetros
  // -------------------------------------------------------------------------

  parametro(chave: ChaveParametroCroqui): ParametroCroqui | undefined {
    const j = jurisdicaoDe(this.entrada, chave);
    return this.parametros.itens[chaveMapa(chave, j.uf ?? null, j.municipio ?? null)];
  }

  private ausentePorChave(chave: ChaveParametroCroqui): Celula {
    const j = jurisdicaoDe(this.entrada, chave);
    const d = CATALOGO_PARAMETROS[chave];
    const divergencia = this.divergentes.get(chave);
    const ondeCadastrar = j.uf
      ? `${d.rotulo} (${j.uf}${j.municipio ? ` · ${j.municipio}` : ""})`
      : d.rotulo;
    if (divergencia) {
      return celulaAusente(`${ondeCadastrar}: ${divergencia}`, [j]);
    }
    if (d.jurisdicao !== "nenhuma" && !j.uf) {
      return celulaAusente(`${d.rotulo}: falta a UF do cliente na Ficha`, [j]);
    }
    return celulaAusente(`falta cadastrar ${ondeCadastrar} em Admin → Parâmetros`, [j]);
  }

  /** Escalar (brl, percentual, meses, parcelas) como célula. */
  valorDe(chave: ChaveParametroCroqui): Celula {
    const p = this.parametro(chave);
    if (!p || typeof p.valor !== "number") return this.ausentePorChave(chave);
    return celulaCalculada(p.valor, {
      parametro_id: p.id,
      parametro_chave: p.chave,
      formula: `${CATALOGO_PARAMETROS[chave].rotulo} · v${p.versao}`,
    });
  }

  faixasDe(chave: ChaveParametroCroqui): TabelaFaixas | null {
    const p = this.parametro(chave);
    return p?.faixas ?? null;
  }

  /** `base × parâmetro%`, com propagação e carimbo da versão do parâmetro. */
  percentualSobre(chave: ChaveParametroCroqui, base: Celula, rotuloBase: string): Celula {
    const p = this.parametro(chave);
    if (!p || typeof p.valor !== "number") {
      const ausente = this.ausentePorChave(chave);
      return base.procedencia === "ausente" ? this.juntar(base, ausente) : ausente;
    }
    return derivar([base], ([b]) => b * (p.valor as number) / 100, {
      parametro_id: p.id,
      parametro_chave: p.chave,
      aliquota: p.valor,
      formula: `${p.valor}% sobre ${rotuloBase}`,
    });
  }

  /** Tabela progressiva sobre a base, com propagação. */
  porFaixa(chave: ChaveParametroCroqui, base: Celula, rotuloBase: string): Celula {
    const p = this.parametro(chave);
    if (!p || !p.faixas) {
      const ausente = this.ausentePorChave(chave);
      return base.procedencia === "ausente" ? this.juntar(base, ausente) : ausente;
    }
    if (base.procedencia === "ausente" || base.valor === null) return base;
    try {
      const r = aplicarFaixas(base.valor, p.faixas);
      return celulaCalculada(r.valor, {
        parametro_id: p.id,
        parametro_chave: p.chave,
        aliquota: r.aliquota,
        faixa_aplicada: r.faixa_aplicada,
        formula: `${r.formula} — ${rotuloBase}`,
        fonte: "tabela_uf",
      });
    } catch (erro) {
      const motivo =
        erro instanceof ErroFaixasInvalidas
          ? `${CATALOGO_PARAMETROS[chave].rotulo}: ${erro.message}`
          : `${CATALOGO_PARAMETROS[chave].rotulo}: tabela de faixas inválida`;
      return celulaAusente(motivo, [jurisdicaoDe(this.entrada, chave)]);
    }
  }

  /**
   * Cartório: tabela de emolumentos da UF quando cadastrada
   * (`fonte: "tabela_uf"`), senão o percentual de aproximação
   * (`fonte: "percentual_fallback"`), senão `ausente` nomeando as DUAS chaves.
   * A tela e o `.docx` mostram qual das duas entrou — hoje o escritório não
   * sabe distinguir (§4.3, CONFLITO 12).
   */
  cartorio(tipo: "notas" | "imoveis", base: Celula, rotuloBase: string): Celula {
    const chaveFaixas = (tipo === "notas" ? "cartorio.faixas.notas" : "cartorio.faixas.imoveis") as ChaveParametroCroqui;
    const chaveFallback = (
      tipo === "notas" ? "cartorio.notas.percentual_fallback" : "cartorio.imoveis.percentual_fallback"
    ) as ChaveParametroCroqui;

    if (this.faixasDe(chaveFaixas)) return this.porFaixa(chaveFaixas, base, rotuloBase);

    const p = this.parametro(chaveFallback);
    if (p && typeof p.valor === "number") {
      const c = derivar([base], ([b]) => b * (p.valor as number) / 100, {
        parametro_id: p.id,
        parametro_chave: p.chave,
        aliquota: p.valor,
        fonte: "percentual_fallback",
        formula: `${p.valor}% sobre ${rotuloBase} — aproximação: a tabela de emolumentos desta UF não está cadastrada`,
      });
      return c;
    }
    const falta = [jurisdicaoDe(this.entrada, chaveFaixas), jurisdicaoDe(this.entrada, chaveFallback)];
    const uf = this.entrada.uf ?? "sem UF";
    return celulaAusente(
      `falta a tabela de cartório (${tipo === "notas" ? "notas" : "imóveis"}) de ${uf} ou o percentual de aproximação`,
      falta,
    );
  }

  /** Une duas ausências preservando as duas faltas. */
  private juntar(a: Celula, b: Celula): Celula {
    return celulaAusente(
      [a.motivo, b.motivo].filter(Boolean).join(" · "),
      [...(a.falta ?? []), ...(b.falta ?? [])],
    );
  }

  // -------------------------------------------------------------------------
  // Configurações
  // -------------------------------------------------------------------------

  /** Total de horas do modelo (`configuracoes['croqui.horas_por_ato']`).
   * Config vazia → `ausente`, nunca zero (§4.4). */
  horasDoModelo(modelo: ModeloHolding): Celula {
    const linhas = this.parametros.horas_por_ato ?? [];
    if (linhas.length === 0) {
      return celulaAusente(
        "falta a tabela de horas por ato em Admin → Configurações (croqui.horas_por_ato)",
      );
    }
    const total = soma(linhas.map((l) => l.horas[modelo] ?? 0));
    if (total <= 0) {
      return celulaAusente(`a tabela de horas por ato não tem horas para o modelo ${modelo}`);
    }
    return celulaCalculada(total, { formula: `${linhas.length} atos · ${total} h`, fonte: "fixo_metodo" });
  }

  // -------------------------------------------------------------------------
  // Override (gaveta do Cenário Patrimonial)
  // -------------------------------------------------------------------------

  /**
   * Toda célula do resultado passa por aqui. Se a advogada gravou um override
   * para (tabela, linha, coluna), ele SUBSTITUI o cálculo — e como a
   * substituição acontece antes das somas, o total já sai com o valor dela.
   */
  c(tabela: ChaveTabela, linha: string, coluna: string, celula: Celula): Celula {
    const o = this.overrides.get(`${tabela}|${linha}|${coluna}`);
    if (!o) return celula;
    return celulaDigitada(o.valor, o.rubrica_id, "valor ajustado no Cenário Patrimonial");
  }
}
