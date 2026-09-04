"use client";

import { useCallback, useEffect, useState } from "react";

type Tema = "claro" | "escuro";

const CHAVE_ARMAZENAMENTO = "sic-hf-tema";
/**
 * Evento próprio (não é o `storage` do navegador, que só dispara em OUTRAS
 * abas): `TemaToggle` e qualquer outro consumidor de `useTema()` montam
 * instâncias de estado INDEPENDENTES entre si (não há Context) — sem isto,
 * um componente que já estava montado (ex.: um gráfico SVG dentro da Ficha
 * 360 aberto na aba Patrimônio) nunca saberia que o botão de tema, em outro
 * lugar da árvore, mudou a classe `.dark` do `<html>`. Descoberto ao validar
 * a Fase 3 §4 (`QuadroSocietario` ficava sempre no tema claro depois do
 * toggle, sem recarregar a página).
 */
const EVENTO_MUDANCA = "sic-hf-tema-mudou";

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

    function aoMudarEmOutroLugar(evento: Event) {
      const detalhe = (evento as CustomEvent<Tema>).detail;
      setTema(detalhe ?? lerTemaAtual());
    }
    window.addEventListener(EVENTO_MUDANCA, aoMudarEmOutroLugar);
    return () => window.removeEventListener(EVENTO_MUDANCA, aoMudarEmOutroLugar);
  }, []);

  const alternar = useCallback(() => {
    const proximo = lerTemaAtual() === "claro" ? "escuro" : "claro";
    document.documentElement.classList.toggle("dark", proximo === "escuro");
    window.localStorage.setItem(CHAVE_ARMAZENAMENTO, proximo);
    setTema(proximo);
    window.dispatchEvent(new CustomEvent<Tema>(EVENTO_MUDANCA, { detail: proximo }));
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
