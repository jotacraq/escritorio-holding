import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Testes de unidade da lógica pura do servidor (Fase 7). NÃO substituem a prova
 * no banco: o que depende de RLS, trigger e RPC continua sendo provado pelos
 * roteiros `scripts/verificacao-NNNN.sql`, rodados à mão contra o Supabase —
 * mock de Supabase esconde exatamente o tipo de bug que esta base já teve
 * (migration não aplicada, grant faltando).
 *
 * Aqui entra só o que é determinístico e roda sem rede:
 *   - motor do croqui (`src/server/motor-croqui/*.test.ts`) e a ponte que monta
 *     a `EntradaCroqui` a partir da Ficha;
 *   - trilho de 9 passos, espinha das 3 sessões, barra "Enviar" e radar de
 *     documentos (`src/lib/**`);
 *   - ligação por IA e integrações: janela de discagem, normalização de
 *     telefone, HMAC, montagem de payload, mapeamento Vapi → evento.
 *
 * Esta é a suíte que o gate do GitHub roda em todo PR (`.github/workflows/ci.yml`).
 * Um caso é condicional e só isso: o bloco E do motor confere contra uma
 * planilha real cuja fixture mora em `tmp/` (não versionada). Sem ela, o caso
 * sai `skipped` — nunca verde silencioso. Rodar com
 * `FIXTURE_MOTOR_CROQUI=tmp/squad/fixture-motor-exemplo.json`.
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
