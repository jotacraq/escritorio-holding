import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ContatoEquipe } from "@/components/publico/atomos";

/**
 * Shell das páginas públicas (Fase 2, §2 e §2.5) — onde o CLIENTE, não a
 * equipe, responde o formulário, escolhe horário e envia documento pelo
 * celular. Regras que valem para todo `src/app/(publico)/**`:
 *
 * - Sem navegação interna, sem link para o sistema, sem nada que nomeie
 *   "esteira", "jornada", "briefing" ou qualquer termo operacional — quem
 *   está aqui é o cliente da Dra. Elaine, não a equipe.
 * - Não monta cliente Supabase de sessão: página pública não tem cookie.
 *   As 4 rotas de `/api/publico/**` (onda 1, B-1A) são as únicas que falam
 *   com o banco, por RPC `security definer` com token — nunca por aqui.
 * - Mobile-first de verdade: tipografia grande e alvo de toque generoso
 *   (classe `.area-publica` em `globals.css`) — quem responde é, muitas
 *   vezes, alguém de 60+ anos, no celular, sem ajuda por perto.
 * - `robots: noindex` aqui é defesa em profundidade; o cabeçalho HTTP
 *   `X-Robots-Tag` de verdade é responsabilidade das rotas de API (§2.5,
 *   onda 1, B-1A) — os dois não se substituem.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default function LayoutPublico({ children }: { children: ReactNode }) {
  return (
    <div className="area-publica flex min-h-screen flex-col bg-papel-fundo">
      <header className="px-5 pb-2 pt-7 text-center sm:px-8 sm:pt-9">
        <p className="text-publico tracking-[0.08em] font-medium uppercase text-tinta-fraca">Planejamento Patrimonial</p>
        {/* O rótulo acima subiu de 12 para 16px (piso público); o nome sobe
            junto, senão os dois ficariam do mesmo tamanho e a hierarquia do
            cabeçalho — o que é seção, o que é escritório — desapareceria. */}
        <p className="mt-1.5 text-[1.25rem] font-bold leading-tight text-tinta">Time Holding Brasil · Dra. Elaine Montenegro</p>
      </header>

      <main id="conteudo-principal" className="mx-auto flex w-full max-w-lg flex-1 flex-col px-5 py-7 sm:px-6 sm:py-8">
        {children}
      </main>

      {/*
       * Rodapé ÚNICO das 5 páginas públicas (Fase 7 r2, §UX2.3). Antes só a
       * tela de link inválido e as de agendamento/confirmação diziam como
       * falar com o escritório — quem travava no formulário, no envio de
       * documento ou no material ficava sem saída. `ContatoEquipe` é o mesmo
       * componente das telas: sem `NEXT_PUBLIC_CONTATO_*` ele diz "fale com
       * quem te enviou este link", nunca um número inventado.
       * Fase 8: o piso tipográfico da ÁREA PÚBLICA é **1rem (16px)**, não os
       * 12–13px da área da equipe. Medido em 07/09 nas 4 páginas: o rodapé
       * saía a 13px e o rótulo do cabeçalho a 12px, na tela de quem tem 60+
       * anos e nenhum seletor de escala para corrigir.
       */}
      <footer className="mt-auto flex flex-col items-center gap-1.5 border-t border-linha px-5 py-6 text-center leading-relaxed sm:px-8">
        <ContatoEquipe antes="Alguma dúvida sobre este link?" />
        <p className="text-publico text-tinta-fraca">Este link é pessoal e sigiloso — não encaminhe para terceiros.</p>
      </footer>
    </div>
  );
}
