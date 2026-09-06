"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const ICONES: Record<string, ReactNode> = {
  hoje: (
    <path d="M3 3.5A1.5 1.5 0 0 1 4.5 2h4A1.5 1.5 0 0 1 10 3.5v4A1.5 1.5 0 0 1 8.5 9h-4A1.5 1.5 0 0 1 3 7.5v-4Zm9 0A1.5 1.5 0 0 1 13.5 2h2A1.5 1.5 0 0 1 17 3.5v4A1.5 1.5 0 0 1 15.5 9h-2A1.5 1.5 0 0 1 12 7.5v-4ZM3 12.5A1.5 1.5 0 0 1 4.5 11h2A1.5 1.5 0 0 1 8 12.5v4A1.5 1.5 0 0 1 6.5 18h-2A1.5 1.5 0 0 1 3 16.5v-4Zm9-1A1.5 1.5 0 0 1 13.5 10h4a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5h-4a1.5 1.5 0 0 1-1.5-1.5v-4Z" />
  ),
  clientes: (
    <path d="M7.5 9a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7.25.5a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5ZM1.5 16.2c0-2.6 2.7-4.7 6-4.7s6 2.1 6 4.7a.8.8 0 0 1-.8.8H2.3a.8.8 0 0 1-.8-.8Zm13.6.8a2.3 2.3 0 0 0 .15-.8c0-1.6-.72-3.03-1.87-4.02a5.3 5.3 0 0 1 1.27-.15c2.5 0 4.35 1.63 4.35 3.67 0 .73-.35 1.3-.98 1.3h-2.92Z" />
  ),
  agenda: (
    <path d="M6 2a1 1 0 0 1 1 1v1h6V3a1 1 0 1 1 2 0v1h1a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1V3a1 1 0 0 1 1-1Zm12 7H2v7a.5.5 0 0 0 .5.5h15a.5.5 0 0 0 .5-.5V9Z" />
  ),
  mensagens: (
    <path d="M2 5.5A2.5 2.5 0 0 1 4.5 3h11A2.5 2.5 0 0 1 18 5.5v6a2.5 2.5 0 0 1-2.5 2.5H9l-4.2 3.15A.75.75 0 0 1 3.6 16.6V14h-.1A2.5 2.5 0 0 1 1 11.5v-6Z" />
  ),
  admin: (
    <path d="M10 2 3 5v5c0 4.2 2.9 7.7 7 8.9 4.1-1.2 7-4.7 7-8.9V5l-7-3Zm0 4.5a2.25 2.25 0 1 1 0 4.5 2.25 2.25 0 0 1 0-4.5ZM6 14.2c.7-1.6 2.2-2.7 4-2.7s3.3 1.1 4 2.7c-1.1 1-2.5 1.7-4 2.1-1.5-.4-2.9-1.1-4-2.1Z" />
  ),
};

export interface ItemNavegacao {
  href: string;
  rotulo: string;
  icone: string;
  /** Uma linha, em português de gente: para que serve esta área. */
  descricao: string;
}

/**
 * Fase 6 — cinco entradas, sem grupos.
 *
 * O João, depois de usar a Fase 5: "as abas não estão fazendo sentido — o que
 * é cada aba? 'Conhecimento'? Que porra é essa?". Nove entradas em quatro
 * grupos exigiam que a pessoa soubesse o vocabulário do sistema antes de
 * navegar. Agora são cinco palavras que quem opera já usa, cada uma com a
 * linha de propósito na tela (não só no `title`).
 *
 * O que absorveu o quê: Painel do dia + Indicadores → **Hoje** (aba
 * "Números"); Esteira → **Clientes**; Conduzir sessão → linha da sessão na
 * **Agenda**; Comunicação → **Mensagens**; Conhecimento → **Admin ·
 * Repertório da IA**; Importações → **Admin · Importações**.
 *
 * `ITENS_NAVEGACAO` continua plano e na mesma ordem — é o que a
 * `PaletaComandos` consome.
 */
export const ITENS_NAVEGACAO: readonly ItemNavegacao[] = [
  { href: "/hoje", rotulo: "Hoje", icone: "hoje", descricao: "O que precisa de você agora." },
  { href: "/clientes", rotulo: "Clientes", icone: "clientes", descricao: "Todo mundo, e em qual das três sessões cada um está." },
  { href: "/agenda", rotulo: "Agenda", icone: "agenda", descricao: "Sessões marcadas e os dias em que a equipe atende." },
  { href: "/mensagens", rotulo: "Mensagens", icone: "mensagens", descricao: "O que vai sair para o cliente e o que já chegou." },
  { href: "/admin", rotulo: "Admin", icone: "admin", descricao: "Ajustes do escritório: equipe, valores, textos e o repertório da IA." },
] as const;

export function itemAtivo(rota: string | null, href: string): boolean {
  return rota === href || Boolean(rota?.startsWith(`${href}/`));
}

/**
 * Navegação principal. Ícone + rótulo + a linha de propósito, que aparece no
 * item ativo e ao passar o mouse/foco nos outros. Alvo ≥ 44px, ativo em
 * laranja (barra + fundo + ícone), nunca só cor.
 */
export function Nav({ aoNavegar }: { aoNavegar?: () => void }) {
  const rota = usePathname();
  return (
    <nav aria-label="Navegação principal" className="flex flex-col gap-1">
      {ITENS_NAVEGACAO.map((item) => {
        const ativo = itemAtivo(rota, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={aoNavegar}
            aria-current={ativo ? "page" : undefined}
            title={item.descricao}
            className={`group relative flex min-h-11 items-start gap-3 rounded-controle px-3 py-2 transition-colors duration-[var(--transicao-rapida)] ${
              ativo ? "bg-latao-fraco text-tinta" : "text-tinta-suave hover:bg-papel-elevado hover:text-tinta focus-visible:bg-papel-elevado"
            }`}
          >
            {ativo && <span aria-hidden="true" className="absolute inset-y-2 left-0 w-1 rounded-full bg-[color:var(--latao-cta)]" />}
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              className={`mt-[3px] h-5 w-5 shrink-0 fill-current transition-colors duration-[var(--transicao-rapida)] ${ativo ? "text-[color:var(--latao)]" : "opacity-70 group-hover:opacity-100"}`}
            >
              {ICONES[item.icone]}
            </svg>
            <span className="flex min-w-0 flex-col">
              <span className={`text-sm leading-5 ${ativo ? "font-bold" : "font-medium"}`}>{item.rotulo}</span>
              <span
                className={`grid transition-[grid-template-rows,opacity] duration-[var(--transicao-normal)] ease-[var(--suavizacao)] ${
                  ativo ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0 group-hover:grid-rows-[1fr] group-hover:opacity-100 group-focus-visible:grid-rows-[1fr] group-focus-visible:opacity-100"
                }`}
              >
                <span className="overflow-hidden text-legenda leading-snug text-tinta-suave">{item.descricao}</span>
              </span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
