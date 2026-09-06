import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Testes de unidade da lógica pura do servidor (Fase 7). NÃO substituem a prova
 * no banco: o que depende de RLS, trigger e RPC continua sendo provado pelos
 * roteiros `scripts/verificacao-NNNN.sql` e pelos scripts `tsx` — mock de
 * Supabase esconde exatamente o tipo de bug que esta base já teve (migration
 * não aplicada, grant faltando).
 *
 * Aqui entra só o que é determinístico: janela de discagem, normalização de
 * telefone, HMAC, montagem de payload e o mapeamento Vapi → evento.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    passWithNoTests: false,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
