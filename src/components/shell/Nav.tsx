"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const ICONES: Record<string, ReactNode> = {
  painel: (
    <path d="M3 3.5A1.5 1.5 0 0 1 4.5 2h4A1.5 1.5 0 0 1 10 3.5v4A1.5 1.5 0 0 1 8.5 9h-4A1.5 1.5 0 0 1 3 7.5v-4Zm9 0A1.5 1.5 0 0 1 13.5 2h2A1.5 1.5 0 0 1 17 3.5v4A1.5 1.5 0 0 1 15.5 9h-2A1.5 1.5 0 0 1 12 7.5v-4ZM3 12.5A1.5 1.5 0 0 1 4.5 11h2A1.5 1.5 0 0 1 8 12.5v4A1.5 1.5 0 0 1 6.5 18h-2A1.5 1.5 0 0 1 3 16.5v-4Zm9-1A1.5 1.5 0 0 1 13.5 10h4a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5h-4a1.5 1.5 0 0 1-1.5-1.5v-4Z" />
  ),
  esteira: (
    <path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h4A1.5 1.5 0 0 1 10 4.5v11A1.5 1.5 0 0 1 8.5 17h-4A1.5 1.5 0 0 1 3 15.5v-11Zm9-1A1.5 1.5 0 0 1 13.5 2h2A1.5 1.5 0 0 1 17 3.5v6A1.5 1.5 0 0 1 15.5 11h-2A1.5 1.5 0 0 1 12 9.5v-6Zm0 9A1.5 1.5 0 0 1 13.5 11h2a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-2a1.5 1.5 0 0 1-1.5-1.5v-3Z" />
  ),
  agenda: (
    <path d="M6 2a1 1 0 0 1 1 1v1h6V3a1 1 0 1 1 2 0v1h1a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1V3a1 1 0 0 1 1-1Zm12 7H2v7a.5.5 0 0 0 .5.5h15a.5.5 0 0 0 .5-.5V9Z" />
  ),
  sessoes: (
    <path d="M4 3.5A1.5 1.5 0 0 1 5.5 2h9A1.5 1.5 0 0 1 16 3.5v13a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 16.5v-13Zm3 2.5a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2H7Zm0 4a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2H7Zm0 4a1 1 0 1 0 0 2h3a1 1 0 1 0 0-2H7Z" />
  ),
  comunicacao: (
    <path d="M2 5.5A2.5 2.5 0 0 1 4.5 3h11A2.5 2.5 0 0 1 18 5.5v6a2.5 2.5 0 0 1-2.5 2.5H9l-4.2 3.15A.75.75 0 0 1 3.6 16.6V14h-.1A2.5 2.5 0 0 1 1 11.5v-6Z" />
  ),
  indicadores: (
    <path d="M3 3a1 1 0 0 1 1 1v11h13a1 1 0 1 1 0 2H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm13.5 2.4a1 1 0 0 1 .1 1.41l-4.3 4.9a1 1 0 0 1-1.44.06L8.5 9.5l-3.02 3.44a1 1 0 1 1-1.5-1.32l3.75-4.28a1 1 0 0 1 1.44-.06l2.36 2.27 3.56-4.06a1 1 0 0 1 1.41-.1Z" />
  ),
  admin: (
    <path d="M10 2 3 5v5c0 4.2 2.9 7.7 7 8.9 4.1-1.2 7-4.7 7-8.9V5l-7-3Zm0 4.5a2.25 2.25 0 1 1 0 4.5 2.25 2.25 0 0 1 0-4.5ZM6 14.2c.7-1.6 2.2-2.7 4-2.7s3.3 1.1 4 2.7c-1.1 1-2.5 1.7-4 2.1-1.5-.4-2.9-1.1-4-2.1Z" />
  ),
  conhecimento: (
    <path d="M3 4.2A1.2 1.2 0 0 1 4.2 3h4.6c.85 0 1.66.34 2.2.94A3.15 3.15 0 0 1 13.2 3h2.6A1.2 1.2 0 0 1 17 4.2v10.6a1.2 1.2 0 0 1-1.2 1.2h-3.51a2 2 0 0 0-1.42.59l-.29.29a1 1 0 0 1-1.16 0l-.29-.29a2 2 0 0 0-1.42-.59H4.2A1.2 1.2 0 0 1 3 14.8V4.2ZM9.25 6.1v8.4c.34.08.66.22.96.4V7.53a1.4 1.4 0 0 0-.96-1.43Z" />
  ),
  importacoes: (
    <path d="M10 2a1 1 0 0 1 1 1v7.59l1.8-1.8a1 1 0 1 1 1.4 1.42l-3.5 3.5a1 1 0 0 1-1.4 0l-3.5-3.5a1 1 0 1 1 1.4-1.42l1.8 1.8V3a1 1 0 0 1 1-1ZM4 13a1 1 0 0 1 1 1v1.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V14a1 1 0 1 1 2 0v1.5A2.5 2.5 0 0 1 14.5 18h-9A2.5 2.5 0 0 1 3 15.5V14a1 1 0 0 1 1-1Z" />
  ),
};

export type GrupoNavegacao = "Dia a dia" | "Cliente" | "Método" | "Administração";

export interface ItemNavegacao {
  href: string;
  rotulo: string;
  icone: string;
  /** Uma linha, em português de gente: o que a pessoa faz nesta tela. */
  descricao: string;
  grupo: GrupoNavegacao;
}

/**
 * Agrupamento por área (decidido a partir das rotas em `src/app/(app)/`):
 * - Dia a dia: o que a equipe abre toda manhã.
 * - Cliente: o que se faz com/para uma pessoa específica.
 * - Método: o acervo e os números que sustentam a prática.
 * - Administração: raramente, e só por quem tem papel para isso.
 * `ITENS_NAVEGACAO` continua plano e na mesma ordem (a `PaletaComandos`
 * consome). `gaveta-demo`/`graficos-demo` ficam fora: são telas de
 * desenvolvimento.
 */
export const ITENS_NAVEGACAO: readonly ItemNavegacao[] = [
  { href: "/painel", rotulo: "Painel do dia", icone: "painel", descricao: "O que precisa da sua atenção hoje, em ordem.", grupo: "Dia a dia" },
  { href: "/esteira", rotulo: "Esteira", icone: "esteira", descricao: "Todos os clientes, etapa por etapa, do seminário à holding.", grupo: "Dia a dia" },
  { href: "/agenda", rotulo: "Agenda", icone: "agenda", descricao: "Sessões marcadas e horários livres da equipe.", grupo: "Dia a dia" },
  { href: "/sessoes", rotulo: "Conduzir sessão", icone: "sessoes", descricao: "Roteiro, briefing e anotações durante a Sessão de Viabilidade.", grupo: "Cliente" },
  { href: "/comunicacao", rotulo: "Comunicação", icone: "comunicacao", descricao: "E-mails e mensagens de WhatsApp que a régua envia ao cliente.", grupo: "Cliente" },
  { href: "/conhecimento", rotulo: "Conhecimento", icone: "conhecimento", descricao: "Transcrições e casos anteriores para consultar antes de uma sessão.", grupo: "Método" },
  { href: "/indicadores", rotulo: "Indicadores", icone: "indicadores", descricao: "Os números do funil, por edição do seminário.", grupo: "Método" },
  { href: "/importacoes", rotulo: "Importações", icone: "importacoes", descricao: "Planilhas de alunos e compras que entram no sistema.", grupo: "Administração" },
  { href: "/admin", rotulo: "Administração", icone: "admin", descricao: "Equipe, prompts, produtos, templates e configurações.", grupo: "Administração" },
] as const;

const ORDEM_GRUPOS: GrupoNavegacao[] = ["Dia a dia", "Cliente", "Método", "Administração"];

export function itemAtivo(rota: string | null, href: string): boolean {
  return rota === href || Boolean(rota?.startsWith(`${href}/`));
}

/**
 * Navegação principal. Cada item: ícone + rótulo + descrição de uma linha —
 * a descrição aparece no item ativo e ao passar o mouse/foco nos outros
 * (a auditoria achou que "Esteira"/"Conhecimento" não se explicam só pelo
 * nome). Alvo ≥ 44px, ativo em laranja (barra + fundo + ícone), nunca só cor.
 */
export function Nav({ aoNavegar }: { aoNavegar?: () => void }) {
  const rota = usePathname();
  return (
    <nav aria-label="Navegação principal" className="flex flex-col gap-5">
      {ORDEM_GRUPOS.map((grupo) => {
        const itens = ITENS_NAVEGACAO.filter((i) => i.grupo === grupo);
        if (itens.length === 0) return null;
        return (
          <div key={grupo} className="flex flex-col gap-0.5">
            <p className="mb-1 px-3 text-rotulo font-medium uppercase text-tinta-fraca">{grupo}</p>
            {itens.map((item) => {
              const ativo = itemAtivo(rota, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={aoNavegar}
                  aria-current={ativo ? "page" : undefined}
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
                    <span className={`text-sm leading-6 ${ativo ? "font-bold" : "font-medium"}`}>{item.rotulo}</span>
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
          </div>
        );
      })}
    </nav>
  );
}
