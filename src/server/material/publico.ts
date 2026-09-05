import type { Celula, ChaveTabela, LinhaTabela, ResultadoCroqui, Tabela } from "@/types/croqui-calculo";
import { CHAVES_TABELA, MOTOR_VERSAO, TABELAS_VISIVEIS_AO_CLIENTE } from "@/types/croqui-calculo";

/**
 * A TRAVA do croqui dentro do link público (`/p/m`), aplicada na SERIALIZAÇÃO.
 *
 * O recorte de cliente existia só no navegador (`TABELAS_VISIVEIS_AO_CLIENTE`
 * filtrando na renderização, e `lerCroquiPublico.ts` limpando a célula). Isso é
 * uma declaração, não uma trava: o payload já atravessou a rede, e honorários,
 * horas por ato, deduções e condição de pagamento ficavam a uma aba de devtools
 * de distância — num link sem sessão, que fica com o cliente para sempre.
 *
 * Aqui o servidor decide o que sai do banco. Duas regras:
 *
 * 1. **Tabela fora de `TABELAS_VISIVEIS_AO_CLIENTE` não é serializada.** T15
 *    (horas por ato), T16 (honorários), T17 (deduções) e T18 (pagamento) são
 *    margem e negociação do escritório. Na apresentação projetada, autenticada,
 *    as 19 continuam aparecendo — são superfícies diferentes, com públicos
 *    diferentes.
 * 2. **A célula sai sem rastro interno.** `formula` carrega o rótulo e a VERSÃO
 *    do parâmetro ("ITCMD doação · v3"); `motivo` e `falta` contam ao cliente o
 *    que o escritório ainda não cadastrou; `fonte: "percentual_fallback"` diz
 *    que a tabela de emolumentos daquela UF não existe no banco. Nada disso é
 *    conversa de cliente.
 *
 * O que **sobra** é `valor` e uma procedência de duas posições. `ausente`
 * continua `ausente` porque a lei "ausência nunca é zero" não é privada: sem
 * ela o `—` viraria "R$ 0,00" na folha que a família leva para casa.
 * `digitado` e `calculado` colapsam em `calculado` — a distinção "este número o
 * escritório digitou" é auditoria interna.
 */

/** Procedência que o cliente pode ver: ou tem número, ou ainda não fechou. */
type ProcedenciaPublica = "calculado" | "ausente";

interface CelulaPublica {
  valor: number | null;
  procedencia: ProcedenciaPublica;
}

const CHAVES_CONHECIDAS = new Set<string>(CHAVES_TABELA);

function celulaPublica(celula: Celula): CelulaPublica {
  if (celula.procedencia === "ausente" || celula.valor === null || !Number.isFinite(celula.valor)) {
    // Sem número não existe célula preenchida — e sem `valor: null` explícito o
    // consumidor teria de adivinhar. Ausência viaja como ausência.
    return { valor: null, procedencia: "ausente" };
  }
  return { valor: celula.valor, procedencia: "calculado" };
}

function linhaPublica(linha: LinhaTabela): LinhaTabela {
  const celulas: Record<string, Celula> = {};
  for (const [coluna, celula] of Object.entries(linha.celulas)) {
    celulas[coluna] = celulaPublica(celula);
  }
  return {
    chave: linha.chave,
    rotulo: linha.rotulo,
    ...(linha.destaque ? { destaque: true } : {}),
    ...(linha.unidade ? { unidade: linha.unidade } : {}),
    celulas,
  };
}

function tabelaPublica(tabela: Tabela): Tabela {
  return {
    chave: tabela.chave,
    titulo: tabela.titulo,
    ...(tabela.nota ? { nota: tabela.nota } : {}),
    ...(tabela.unidade ? { unidade: tabela.unidade } : {}),
    // A coluna leva só rótulo e unidade — é cabeçalho, não tem procedência.
    colunas: tabela.colunas.map((c) => ({ chave: c.chave, rotulo: c.rotulo, ...(c.unidade ? { unidade: c.unidade } : {}) })),
    linhas: tabela.linhas.map(linhaPublica),
    // `falta` nomeia a chave do parâmetro que o escritório não cadastrou.
    falta: [],
  };
}

/**
 * Recorta um `ResultadoCroqui` para o link público. Devolve `null` quando não
 * sobra tabela nenhuma — seção que não existe é melhor do que seção vazia.
 *
 * Lê sem confiar na forma: o croqui pode chegar de `materiais_gerados.conteudo`
 * (jsonb livre) ou de `croqui_calculos.resultado` de uma versão antiga do motor.
 */
export function recortarCroquiParaCliente(bruto: unknown): ResultadoCroqui | null {
  if (!bruto || typeof bruto !== "object") return null;
  const candidato = bruto as Partial<ResultadoCroqui>;
  if (candidato.motor_versao !== MOTOR_VERSAO) return null;
  if (!candidato.tabelas || typeof candidato.tabelas !== "object") return null;

  const tabelas: ResultadoCroqui["tabelas"] = {};
  for (const [chave, tabela] of Object.entries(candidato.tabelas)) {
    if (!CHAVES_CONHECIDAS.has(chave)) continue;
    if (!TABELAS_VISIVEIS_AO_CLIENTE.has(chave as ChaveTabela)) continue;
    if (!tabela || typeof tabela !== "object") continue;
    const t = tabela as Tabela;
    if (!Array.isArray(t.colunas) || !Array.isArray(t.linhas)) continue;
    tabelas[chave as ChaveTabela] = tabelaPublica(t);
  }
  if (Object.keys(tabelas).length === 0) return null;

  return {
    motor_versao: MOTOR_VERSAO,
    gerado_em: typeof candidato.gerado_em === "string" ? candidato.gerado_em : "",
    tabelas,
    // Falta e divergência de parâmetro são conversa interna, sempre.
    faltas: [],
    divergencias: [],
  };
}

/**
 * Passa o payload do link `material` pelo recorte antes de ele virar resposta
 * HTTP. Idempotente e tolerante: payload sem `croqui` sai idêntico (é o caso de
 * hoje — `app.payload_link_material` ainda não carrega o campo), e croqui que
 * não sobrevive ao recorte **some do objeto**, em vez de virar `null` e obrigar
 * cada consumidor a tratar mais um estado.
 *
 * Chamado por `GET /api/publico/[token]`. É a única porta por onde o payload de
 * `/p/m` sai do servidor: se amanhã a RPC passar a devolver as 19 tabelas, as
 * quatro internas morrem aqui, sem deploy de front.
 */
export function sanitizarPayloadMaterialPublico(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const objeto = payload as Record<string, unknown>;
  if (!("croqui" in objeto)) return payload;

  const recortado = recortarCroquiParaCliente(objeto.croqui);
  const saida: Record<string, unknown> = { ...objeto };
  if (recortado) saida.croqui = recortado;
  else delete saida.croqui;
  return saida;
}
