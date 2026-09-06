import { NextResponse } from "next/server";

/**
 * "A migration ainda não foi aplicada" — degradação honesta, nunca 500.
 *
 * Regra da casa (`tmp/squad/fase7-brief.md`): o código TEM de funcionar sem a
 * migration aplicada; a tela mostra a falta, não quebra. Aqui isso vira 503 com
 * o número da migration no corpo, para a tela dizer exatamente o que falta em
 * vez de "erro interno, contate o suporte".
 *
 * Os códigos vêm de dois mundos:
 *   · PostgREST — `PGRST202` (função não existe no cache do schema),
 *     `PGRST204`/`PGRST205` (coluna/tabela não encontrada);
 *   · Postgres cru — `42883` (função inexistente), `42P01` (tabela inexistente),
 *     `42703` (coluna inexistente).
 * `42501` (permission denied) NÃO entra: aquilo é falha de grant, é erro de
 * verdade, e vira 500 com id rastreável — foi o que derrubou a Fase 6.
 */
const CODIGOS = new Set(["PGRST202", "PGRST204", "PGRST205", "42883", "42P01", "42703"]);

export function migracaoPendente(erro: unknown): boolean {
  if (!erro || typeof erro !== "object") return false;
  const codigo = (erro as { code?: unknown }).code;
  return typeof codigo === "string" && CODIGOS.has(codigo);
}

export function respostaMigracaoPendente(migration: string, oQueFalta: string) {
  return NextResponse.json(
    {
      erro: "migracao_pendente",
      mensagem: `Recurso indisponível: a migration ${migration} ainda não foi aplicada neste banco (${oQueFalta}).`,
      migration,
    },
    { status: 503 },
  );
}
