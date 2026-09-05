import type { Metadata } from "next";
import type { ReactNode } from "react";

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
        <p className="text-rotulo font-medium uppercase text-tinta-fraca">Planejamento Patrimonial</p>
        <p className="mt-1.5 text-subtitulo font-bold leading-tight text-tinta">Time Holding Brasil · Dra. Elaine Montenegro</p>
      </header>

      <main id="conteudo-principal" className="mx-auto flex w-full max-w-lg flex-1 flex-col px-5 py-7 sm:px-6 sm:py-8">
        {children}
      </main>

      <footer className="px-5 py-6 text-center text-xs leading-relaxed text-tinta-fraca sm:px-8">
        <p>Este link é pessoal e sigiloso — não encaminhe para terceiros.</p>
      </footer>
    </div>
  );
}
