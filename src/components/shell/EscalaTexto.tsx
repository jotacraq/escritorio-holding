"use client";

import { useEffect, useState } from "react";

/**
 * Escala de texto do usuário (Fase 8, D22 e bloqueio B55).
 *
 * O conflito era real e não tinha resposta única: o João usou a V2 em
 * produção e pediu corpo de 14px ("tá tudo muito grande, tenho que escrolar
 * muito"); a pesquisa de acessibilidade para 55+ exige piso de 16px. As duas
 * exigências são verdadeiras — para pessoas diferentes. Então quem escolhe é
 * quem usa, e o padrão é o que o João aprovou (B55: `Padrão`, 14px). A Dra.
 * Elaine troca em um clique, e a escolha fica.
 *
 * O que muda é UMA variável (`--fator-escala`), que multiplica só os degraus
 * tipográficos. O alvo de 44px, o ritmo vertical e a área pública não se
 * mexem — ver o comentário da trava em `globals.css`.
 *
 * `<fieldset>` com rádios NATIVOS de propósito: setas do teclado, leitor de
 * tela e "só um marcado" vêm de graça e não têm como quebrar. O visual de
 * segmento é `peer-checked`, o alvo continua ≥ 44px.
 */

export const CHAVE_ESCALA = "sic-hf-escala";

export const ESCALAS = [
  { valor: "padrao", rotulo: "Padrão", px: 14 },
  { valor: "media", rotulo: "Média", px: 16 },
  { valor: "grande", rotulo: "Grande", px: 18 },
] as const;

export type ValorEscala = (typeof ESCALAS)[number]["valor"];

const VALIDOS: readonly string[] = ESCALAS.map((e) => e.valor);

/**
 * Aplica a escala salva ANTES do primeiro paint. Roda como script inline (ver
 * `AppShell`), pelo mesmo motivo do script de tema: aplicar só no `useEffect`
 * faria a página nascer em 14px e pular para 18px na frente de quem escolheu
 * 18px — justamente a pessoa que menos enxerga o texto pequeno.
 *
 * `try/catch` obrigatório: `localStorage` lança em janela anônima com cookies
 * de terceiros bloqueados e em iframe restrito. Falhou? Fica no padrão.
 */
export const SCRIPT_ESCALA_INICIAL = `
(function () {
  try {
    var salvo = localStorage.getItem('${CHAVE_ESCALA}');
    var valor = (salvo === 'media' || salvo === 'grande') ? salvo : 'padrao';
    document.documentElement.setAttribute('data-escala', valor);
  } catch (erro) {
    document.documentElement.setAttribute('data-escala', 'padrao');
  }
})();
`;

function lerEscalaAtual(): ValorEscala {
  if (typeof document === "undefined") return "padrao";
  const atual = document.documentElement.getAttribute("data-escala");
  return atual && VALIDOS.includes(atual) ? (atual as ValorEscala) : "padrao";
}

export function EscalaTexto({ className = "" }: { className?: string }) {
  const [escala, setEscala] = useState<ValorEscala>("padrao");

  useEffect(() => {
    // Leitura de sistema externo (o DOM) depois de montar, igual a `useTema`:
    // no servidor não há `document`, e decidir no primeiro render causaria
    // descompasso de hidratação.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEscala(lerEscalaAtual());
  }, []);

  function escolher(valor: ValorEscala) {
    document.documentElement.setAttribute("data-escala", valor);
    setEscala(valor);
    try {
      window.localStorage.setItem(CHAVE_ESCALA, valor);
    } catch {
      // Sem armazenamento, a escolha vale para esta sessão e nada quebra —
      // preferência não é dado, e travar a tela por causa dela seria pior.
    }
  }

  return (
    <fieldset className={`flex flex-wrap items-center gap-alvo ${className}`}>
      <legend className="mb-1 text-rotulo font-medium uppercase text-tinta-fraca">Tamanho do texto</legend>
      {/* `w-full` + `flex-1`: em "Grande" os três rótulos crescem junto com a
          escala e, com largura de conteúdo, o terceiro vazava para fora da
          lateral de 17rem (medido a 1440×900). Dividindo a largura disponível
          em três, o controle acompanha a própria escala que ele controla. */}
      <div className="flex w-full rounded-pilula border border-linha-forte bg-papel-elevado p-0.5">
        {ESCALAS.map((opcao) => {
          const id = `escala-${opcao.valor}`;
          const marcada = escala === opcao.valor;
          return (
            <span key={opcao.valor} className="flex min-w-0 flex-1">
              <input
                type="radio"
                id={id}
                name="escala-de-texto"
                value={opcao.valor}
                checked={marcada}
                onChange={() => escolher(opcao.valor)}
                className="peer sr-only"
              />
              <label
                htmlFor={id}
                title={`Corpo de texto em ${opcao.px} pixels`}
                className="flex min-h-11 w-full cursor-pointer items-center justify-center rounded-pilula px-2 text-center text-sm font-medium text-tinta-suave transition-colors duration-[var(--transicao-rapida)] hover:text-tinta peer-checked:bg-latao-fraco peer-checked:font-bold peer-checked:text-[color:var(--latao)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[color:var(--latao)]"
              >
                {opcao.rotulo}
              </label>
            </span>
          );
        })}
      </div>
    </fieldset>
  );
}
