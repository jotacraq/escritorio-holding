"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ResultadoCroqui } from "@/types/croqui-calculo";
import { fixarCroquiCalculo } from "./apiCroquiCalculo";

/**
 * "Fixar versão" — o mesmo fluxo nas duas telas que o oferecem (o croqui e o
 * simulador). Estava escrito duas vezes, e as duas cópias já tinham divergido:
 * uma tratava a divergência servidor × tela, a outra não.
 *
 * O servidor SEMPRE recalcula com a ficha e os parâmetros vigentes; o corpo
 * não carrega resultado. Quando o que estava na tela era outra premissa (o
 * simulador com um valor de mercado alterado), `divergiu` fica `true` e a
 * tela diz isso — nunca deixa a advogada achar que gravou o que via.
 */
export interface FixarCroqui {
  fixar: () => Promise<void>;
  fixando: boolean;
  erro: unknown;
  /** A versão gravada saiu diferente do que estava na tela. */
  divergiu: boolean;
  limparDivergencia: () => void;
}

export function useFixarCroqui({
  jornadaId,
  croquiId = null,
  /** O que está na tela agora. Lido por `ref`: não entra nas dependências,
   *  senão o callback é recriado a cada tecla do simulador e prende um
   *  `ResultadoCroqui` inteiro por geração de render. */
  resultadoNaTela,
  aoFixar,
}: {
  jornadaId: string;
  croquiId?: string | null;
  resultadoNaTela?: ResultadoCroqui | null;
  aoFixar?: () => void;
}): FixarCroqui {
  const [fixando, setFixando] = useState(false);
  const [erro, setErro] = useState<unknown>(null);
  const [divergiu, setDivergiu] = useState(false);

  // Sincronizados em efeito, não no corpo do render (react-hooks/refs). Só
  // são LIDOS dentro do `fixar`, que roda num clique — depois do commit, com
  // o valor do render mais recente já dentro do ref.
  const naTela = useRef<ResultadoCroqui | null>(null);
  const aoFixarRef = useRef(aoFixar);
  useEffect(() => {
    naTela.current = resultadoNaTela ?? null;
    aoFixarRef.current = aoFixar;
  });

  const fixar = useCallback(async () => {
    setFixando(true);
    setErro(null);
    setDivergiu(false);
    try {
      const { calculo } = await fixarCroquiCalculo(jornadaId, croquiId ? { croqui_id: croquiId } : {});
      // Comparação FRIA: roda uma vez, depois do await, num clique explícito.
      const antes = naTela.current;
      if (antes && JSON.stringify(calculo.resultado.tabelas) !== JSON.stringify(antes.tabelas)) {
        setDivergiu(true);
      }
      aoFixarRef.current?.();
    } catch (e) {
      setErro(e);
    } finally {
      setFixando(false);
    }
  }, [jornadaId, croquiId]);

  const limparDivergencia = useCallback(() => setDivergiu(false), []);

  return { fixar, fixando, erro, divergiu, limparDivergencia };
}
