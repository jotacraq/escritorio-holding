import { redirect } from "next/navigation";

/**
 * Fase 2 (§5, F-0): a raiz passa a levar ao Painel do dia, não mais direto
 * à Esteira. Enquanto `/painel` não existir (onda 1, F-1B), o Next cai no
 * `not-found.tsx` de `src/app/(app)/` — que avisa honestamente que a tela
 * está em construção, nunca um 404 cru.
 */
export default function PaginaInicial() {
  redirect("/painel");
}
