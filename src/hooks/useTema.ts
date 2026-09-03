"use client";

import { useCallback, useEffect, useState } from "react";

type Tema = "claro" | "escuro";

const CHAVE_ARMAZENAMENTO = "sic-hf-tema";

function lerTemaAtual(): Tema {
  if (typeof document === "undefined") return "claro";
  return document.documentElement.classList.contains("dark") ? "escuro" : "claro";
}

/**
 * O tema já é aplicado antes da hidratação por um script inline no <head>
 * (ver src/app/layout.tsx) — este hook só sincroniza estado React com a
 * classe já presente no <html>, para não haver flash de conteúdo errado.
 */
export function useTema() {
  const [tema, setTema] = useState<Tema>("claro");

  useEffect(() => {
    // Padrão canônico de tema com SSR: renderizar "claro" no servidor (sem
    // acesso a `document`) e corrigir uma vez no cliente, depois do script
    // bloqueante já ter aplicado a classe real — assim não há flash nem
    // mismatch de hidratação. Não é fetch; é leitura de um sistema externo
    // (o DOM) após montar, exatamente o caso que a própria regra descreve
    // como uso legítimo de efeito.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTema(lerTemaAtual());
  }, []);

  const alternar = useCallback(() => {
    const proximo = lerTemaAtual() === "claro" ? "escuro" : "claro";
    document.documentElement.classList.toggle("dark", proximo === "escuro");
    window.localStorage.setItem(CHAVE_ARMAZENAMENTO, proximo);
    setTema(proximo);
  }, []);

  return { tema, alternar };
}

export const SCRIPT_TEMA_INICIAL = `
(function () {
  try {
    var salvo = localStorage.getItem('${CHAVE_ARMAZENAMENTO}');
    var escuro = salvo ? salvo === 'escuro' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (escuro) document.documentElement.classList.add('dark');
  } catch (erro) {}
})();
`;
