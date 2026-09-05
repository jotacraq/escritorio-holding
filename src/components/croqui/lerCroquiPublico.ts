import type { ChaveTabela, ResultadoCroqui, Tabela } from "@/types/croqui-calculo";
import { CHAVES_TABELA, MOTOR_VERSAO } from "@/types/croqui-calculo";

/**
 * O LEITOR do croqui dentro de um link público, separado do renderizador de
 * propósito: ele é leve e sem dependências, então pode ser importado
 * estaticamente pelo `/p/m` para decidir se vale carregar as tabelas. O
 * renderizador (`MaterialCroquiPublico.tsx`) entra por `dynamic()`, só quando
 * há croqui.
 */

/**
 * Lê um `ResultadoCroqui` de dentro do payload de um link público, sem
 * confiar na forma. Devolve `null` (seção não aparece) em qualquer dúvida.
 *
 * Existe como leitura tolerante porque o payload do material
 * (`app.payload_link_material`) **ainda não carrega o croqui** — é campo
 * novo, de dono no servidor (`src/server/material/**`, fora desta fronteira).
 * Enquanto não carregar, `null` e nada muda no `/p/m` de hoje; quando
 * carregar, a seção aparece sozinha, sem deploy de front.
 */
export function lerResultadoDoPayload(payload: unknown): ResultadoCroqui | null {
  if (!payload || typeof payload !== "object") return null;
  const bruto = (payload as Record<string, unknown>).croqui;
  if (!bruto || typeof bruto !== "object") return null;

  const candidato = bruto as Partial<ResultadoCroqui>;
  if (candidato.motor_versao !== MOTOR_VERSAO) return null;
  if (!candidato.tabelas || typeof candidato.tabelas !== "object") return null;

  const conhecidas = new Set<string>(CHAVES_TABELA);
  const tabelas: ResultadoCroqui["tabelas"] = {};
  for (const [chave, tabela] of Object.entries(candidato.tabelas)) {
    if (!conhecidas.has(chave)) continue;
    if (!tabela || typeof tabela !== "object") continue;
    const t = tabela as ResultadoCroqui["tabelas"][ChaveTabela];
    if (!t || !Array.isArray(t.colunas) || !Array.isArray(t.linhas)) continue;
    tabelas[chave as ChaveTabela] = semRastroInterno(t);
  }
  if (Object.keys(tabelas).length === 0) return null;

  return {
    motor_versao: MOTOR_VERSAO,
    gerado_em: typeof candidato.gerado_em === "string" ? candidato.gerado_em : "",
    tabelas,
    // Falta e divergência são conversa interna: não vão para o cliente.
    faltas: [],
    divergencias: [],
  };
}

/**
 * Tira da célula tudo que é conversa interna — `formula` (que carrega o
 * rótulo do parâmetro e a VERSÃO dele), `motivo`, `falta`, `parametro_id`,
 * `parametro_chave`, `rubrica_id`. Sobra o que o cliente precisa: valor e
 * procedência.
 *
 * O `superficie="publico"` já impede que esses campos apareçam no `title`,
 * mas eles continuariam no objeto que veio pela rede. Isto não substitui a
 * trava do servidor (ver `TABELAS_VISIVEIS_AO_CLIENTE`) — é a segunda camada,
 * e a única que este glob consegue fechar sozinho.
 */
function semRastroInterno(tabela: Tabela): Tabela {
  return {
    ...tabela,
    falta: [],
    linhas: tabela.linhas.map((linha) => ({
      ...linha,
      celulas: Object.fromEntries(
        Object.entries(linha.celulas).map(([coluna, celula]) => [
          coluna,
          { valor: celula.valor, procedencia: celula.procedencia, ...(celula.fonte ? { fonte: celula.fonte } : {}) },
        ]),
      ),
    })),
  };
}
