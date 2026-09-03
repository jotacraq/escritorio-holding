"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Busca um recurso e expõe carregando/erro/recarregar.
 *
 * Só chama setState dentro do efeito de dentro de `.then/.catch/.finally`
 * (continuação assíncrona) — nunca de forma síncrona no corpo do efeito.
 * `recarregar()` é sempre disparado por um handler de evento (clique em
 * "tentar de novo", troca de filtro), nunca pelo próprio efeito, então o
 * reset de `carregando`/`erro` para uma nova busca acontece ali, fora do
 * efeito — é essa separação que evita a cascata de renders.
 */
export function useRecurso<T>(buscar: () => Promise<T>, deps: unknown[]) {
  const [dados, setDados] = useState<T | undefined>(undefined);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<unknown>(null);
  const [chave, setChave] = useState(0);

  useEffect(() => {
    let vivo = true;
    buscar()
      .then((resultado) => {
        if (!vivo) return;
        setDados(resultado);
        setErro(null);
      })
      .catch((e) => {
        if (vivo) setErro(e);
      })
      .finally(() => {
        if (vivo) setCarregando(false);
      });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, ...deps]);

  const recarregar = useCallback(() => {
    setCarregando(true);
    setErro(null);
    setChave((c) => c + 1);
  }, []);

  return { dados, carregando, erro, recarregar, setDados };
}
