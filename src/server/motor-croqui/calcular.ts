import type {
  ChaveTabela,
  EntradaCroqui,
  FaltaAgregada,
  ModeloCroqui,
  ModeloHolding,
  ParametrosCroqui,
  ResultadoCroqui,
  Tabela,
} from "@/types/croqui-calculo";
import { MODELOS_CROQUI, MOTOR_VERSAO } from "@/types/croqui-calculo";
import { ContextoCroqui } from "./contexto";
import { MODELO_REFERENCIA_PADRAO } from "./dominio";
import { montarComparativo, montarItbi, type ItemComparativo } from "./tabelas/comparativos";
import { montarHonorarios } from "./tabelas/honorarios";
import { montarInventario } from "./tabelas/inventario";
import { montarCelula, montarDoacao } from "./tabelas/modelos";
import { montarOperacionalLocacao, montarOperacionalPj, montarPayback } from "./tabelas/operacional";
import { montarComposicaoFamiliar, montarFormacaoPatrimonial } from "./tabelas/patrimonio";

/**
 * `calcularCroqui` — a única conta do croqui.
 *
 * Função PURA: zero I/O, zero IA, zero `server-only`. Roda no servidor (para
 * gravar a versão em `croqui_calculos`) e no cliente (simulador ao vivo da
 * Sessão de Viabilidade), com o MESMO código — é o que garante que o número da
 * tela, o do `.docx` e o do banco são o mesmo número.
 *
 * Contrato: NUNCA lança. Falha de tabela vira tabela ausente do resultado;
 * falha de célula vira `ausente` com motivo. Uma exceção aqui derrubaria a
 * sessão com o cliente na tela.
 */

const MODELOS_HOLDING_TODOS: ModeloHolding[] = ["celula_1", "celula_2", "celula_3"];

/** Executa o montador de uma tabela sem deixar exceção escapar. */
function protegido<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

function agregarFaltas(tabelas: Partial<Record<ChaveTabela, Tabela>>): FaltaAgregada[] {
  const mapa = new Map<string, FaltaAgregada>();
  for (const tabela of Object.values(tabelas)) {
    if (!tabela) continue;
    for (const f of tabela.falta) {
      const k = `${f.chave}|${f.uf ?? ""}|${f.municipio ?? ""}`;
      const atual = mapa.get(k);
      if (atual) {
        if (!atual.tabelas.includes(tabela.chave)) atual.tabelas.push(tabela.chave);
      } else {
        mapa.set(k, { ...f, tabelas: [tabela.chave] });
      }
    }
  }
  return [...mapa.values()];
}

export function calcularCroqui(
  entrada: EntradaCroqui,
  parametros: ParametrosCroqui,
  /** injetável só para teste e para snapshot determinístico; default `now()` */
  agora: Date = new Date(),
): ResultadoCroqui {
  const vazio: ResultadoCroqui = {
    motor_versao: MOTOR_VERSAO,
    gerado_em: agora.toISOString(),
    tabelas: {},
    faltas: [],
    divergencias: parametros?.divergencias ?? [],
  };

  try {
    const ctx = new ContextoCroqui(entrada, parametros);
    const pedidos = new Set<ModeloCroqui>(entrada.modelos?.length ? entrada.modelos : MODELOS_CROQUI);
    const temHolding = MODELOS_HOLDING_TODOS.some((m) => pedidos.has(m));

    // Honorários e horas primeiro: T7/T8/T9 leem o preço daqui.
    const honorarios = protegido(() => montarHonorarios(ctx));

    // O inventário é a RÉGUA de todas as comparações — calculado sempre, mesmo
    // quando não é publicado, porque `custo_da_inercia` é o denominador de
    // toda economia que o croqui apresenta.
    const inventario = protegido(() => montarInventario(ctx));
    const custoInercia = inventario?.custoInercia ?? {
      valor: null,
      procedencia: "ausente" as const,
      motivo: "não foi possível calcular o custo do inventário",
    };
    const custoInerciaReforma = inventario?.custoInerciaReforma ?? custoInercia;

    const notasInventario = inventario?.notas ?? {
      valor: null,
      procedencia: "ausente" as const,
      motivo: "não foi possível calcular a escritura do inventário",
    };
    const doacao = protegido(() => montarDoacao(ctx, notasInventario, custoInercia));

    const celulas: Partial<Record<ModeloHolding, ReturnType<typeof montarCelula>>> = {};
    for (const modelo of MODELOS_HOLDING_TODOS) {
      const preco = honorarios?.precoTotal[modelo] ?? {
        valor: null,
        procedencia: "ausente" as const,
        motivo: "honorário do modelo indisponível",
      };
      const bloco = protegido(() => montarCelula(ctx, modelo, preco, custoInercia));
      if (bloco) celulas[modelo] = bloco;
    }

    const itensComparativo: ItemComparativo[] = [];
    if (doacao) itensComparativo.push({ modelo: "doacao", total: doacao.total, totalReforma: doacao.totalReforma });
    for (const modelo of MODELOS_HOLDING_TODOS) {
      const bloco = celulas[modelo];
      if (bloco && pedidos.has(modelo)) {
        itensComparativo.push({ modelo, total: bloco.total, totalReforma: bloco.totalReforma });
      }
    }

    const referencia = parametros.sinal_modelo_referencia ?? MODELO_REFERENCIA_PADRAO;
    const custoReferencia = celulas[referencia]?.total ?? {
      valor: null,
      procedencia: "ausente" as const,
      motivo: `o modelo de referência (${referencia}) não pôde ser calculado`,
    };

    const tabelas: Partial<Record<ChaveTabela, Tabela>> = {};
    const publicar = (t: Tabela | null | undefined) => {
      if (t) tabelas[t.chave] = t;
    };

    publicar(protegido(() => montarComposicaoFamiliar(ctx)));
    publicar(protegido(() => montarFormacaoPatrimonial(ctx)));

    if (pedidos.has("inventario") && inventario) {
      publicar(inventario.t3);
      publicar(inventario.t4);
      publicar(inventario.t5);
    }
    if (pedidos.has("doacao") && doacao) publicar(doacao.tabela);
    for (const modelo of MODELOS_HOLDING_TODOS) {
      if (pedidos.has(modelo)) publicar(celulas[modelo]?.tabela);
    }

    publicar(protegido(() => montarOperacionalPj(ctx)));
    if (temHolding && pedidos.has("inventario")) {
      publicar(protegido(() => montarPayback(ctx, custoInercia, custoReferencia)));
    }
    publicar(protegido(() => montarOperacionalLocacao(ctx)));

    if (itensComparativo.length > 0) {
      publicar(protegido(() => montarComparativo(ctx, itensComparativo, custoInercia, custoInerciaReforma)));
    }
    if (temHolding && ctx.temImovel) {
      const itens = MODELOS_HOLDING_TODOS.flatMap((modelo) => {
        const bloco = celulas[modelo];
        return pedidos.has(modelo) && bloco ? [{ modelo, total: bloco.total }] : [];
      });
      if (itens.length > 0) publicar(protegido(() => montarItbi(ctx, itens)));
    }

    if (temHolding && honorarios) {
      publicar(honorarios.t15);
      publicar(honorarios.t16);
      publicar(honorarios.t17);
      publicar(honorarios.t18);
      publicar(honorarios.t19);
    }

    return {
      motor_versao: MOTOR_VERSAO,
      gerado_em: agora.toISOString(),
      tabelas,
      faltas: agregarFaltas(tabelas),
      divergencias: parametros.divergencias ?? [],
    };
  } catch {
    // Rede de segurança: o simulador roda ao vivo na frente do cliente. Mas
    // resultado vazio SEM falta declarada parecia "tudo certo, nada a mostrar"
    // (trava final da Fase 5, item 3): o erro interno vira uma falta nomeada,
    // que a tela mostra como qualquer outra ausência — nunca silêncio.
    return { ...vazio, faltas: [{ chave: "motor.erro_interno", tabelas: [] }] };
  }
}
