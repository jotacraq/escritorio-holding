"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const ICONES: Record<string, ReactNode> = {
  esteira: (
    <path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h4A1.5 1.5 0 0 1 10 4.5v11A1.5 1.5 0 0 1 8.5 17h-4A1.5 1.5 0 0 1 3 15.5v-11Zm9-1A1.5 1.5 0 0 1 13.5 2h2A1.5 1.5 0 0 1 17 3.5v6A1.5 1.5 0 0 1 15.5 11h-2A1.5 1.5 0 0 1 12 9.5v-6Zm0 9A1.5 1.5 0 0 1 13.5 11h2a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-2a1.5 1.5 0 0 1-1.5-1.5v-3Z" />
  ),
  agenda: (
    <path d="M6 2a1 1 0 0 1 1 1v1h6V3a1 1 0 1 1 2 0v1h1a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1V3a1 1 0 0 1 1-1Zm12 7H2v7a.5.5 0 0 0 .5.5h15a.5.5 0 0 0 .5-.5V9Z" />
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
};

const ITENS = [
  { href: "/esteira", rotulo: "Esteira", icone: "esteira" },
  { href: "/agenda", rotulo: "Agenda", icone: "agenda" },
  { href: "/comunicacao", rotulo: "Comunicação", icone: "comunicacao" },
  { href: "/indicadores", rotulo: "Indicadores", icone: "indicadores" },
  { href: "/admin", rotulo: "Admin", icone: "admin" },
] as const;

export function Nav({ aoNavegar }: { aoNavegar?: () => void }) {
  const rota = usePathname();
  return (
    <nav aria-label="Navegação principal" className="flex flex-col gap-0.5">
      {ITENS.map((item) => {
        const ativo = rota === item.href || rota?.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={aoNavegar}
            aria-current={ativo ? "page" : undefined}
            className={`group flex items-center gap-3 rounded-sm border-l-2 px-3 py-2 text-sm transition-colors ${
              ativo
                ? "border-[color:var(--latao)] bg-[color:var(--latao-fraco)] font-medium text-tinta"
                : "border-transparent text-tinta-suave hover:border-linha-forte hover:bg-papel-elevado hover:text-tinta"
            }`}
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 fill-current opacity-80 group-hover:opacity-100">
              {ICONES[item.icone]}
            </svg>
            {item.rotulo}
          </Link>
        );
      })}
    </nav>
  );
}
