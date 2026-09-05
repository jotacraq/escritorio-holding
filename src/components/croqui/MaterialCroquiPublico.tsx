"use client";

import { useMemo } from "react";
import type { ResultadoCroqui } from "@/types/croqui-calculo";
import { montarBlocos } from "./blocosCroqui";
import { visivelAoCliente } from "./formatoTabela";
import { TabelaCroqui } from "./TabelaCroqui";

/**
 * As tabelas do croqui dentro do material público (`/p/m/[token]`) — o que o
 * cliente leva para casa depois da sessão.
 *
 * Três camadas, porque este é um link sem sessão — e nenhuma delas é a
 * trava de verdade, que precisa estar no SERVIDOR (ver a nota em
 * `TABELAS_VISIVEIS_AO_CLIENTE`): o que chega aqui já atravessou a rede.
 *
 * 1. **Recorte por `visivelAoCliente`.** Horas por ato, honorários, deduções
 *    e condição de pagamento NÃO saem daqui — é a margem e a negociação do
 *    escritório. Na apresentação (advogada autenticada, projetando) elas
 *    aparecem; são superfícies com públicos diferentes.
 * 2. **Nenhuma chave de parâmetro, nenhum painel de falta.** Célula sem
 *    insumo mostra `—`, e ponto. O cliente não precisa saber que falta
 *    cadastrar ITCMD de MG; precisa não ver "R$ 0,00" no lugar.
 * 3. **Validação de forma e limpeza antes de renderizar**
 *    (`lerCroquiPublico.ts`): o payload do link é dado de rede, e cada célula
 *    vem com fórmula, chave e versão de parâmetro que são conversa interna.
 */

export function MaterialCroquiPublico({ resultado }: { resultado: ResultadoCroqui }) {
  const blocos = useMemo(() => montarBlocos(resultado, visivelAoCliente), [resultado]);
  if (blocos.length === 0) return null;

  return (
    <section aria-labelledby="croqui-publico" className="flex flex-col gap-6">
      <h2 id="croqui-publico" className="text-titulo font-bold text-tinta">
        Os números do seu croqui
      </h2>
      {blocos.map((bloco) => (
        <div key={bloco.rotulo} className="flex flex-col gap-4">
          <p className="text-rotulo font-medium uppercase text-tinta-fraca">{bloco.rotulo}</p>
          {bloco.tabelas.map((tabela) => (
            <TabelaCroqui key={tabela.chave} tabela={tabela} nivelTitulo="h3" superficie="publico" />
          ))}
        </div>
      ))}
      <p className="text-xs text-tinta-fraca">
        <span aria-hidden="true">—</span> valor ainda não fechado.
      </p>
    </section>
  );
}
