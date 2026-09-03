import { z } from "zod";

/**
 * Structured output do OpenRouter (`response_format.json_schema.strict:true`,
 * repassado ao provedor Anthropic) rejeita `minLength`/`minimum`/`maximum`/
 * `exclusiveMinimum`/`exclusiveMaximum` no JSON Schema — chaves de VALIDAÇÃO,
 * que o modo strict não suporta. Isto NÃO afrouxa a validação real: é só o
 * guia de forma que vai para o modelo. `schema.safeParse()` em `executar.ts`
 * continua validando com força total depois que a resposta volta.
 */
const CHAVES_REMOVIDAS = new Set([
  "minLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
]);

function removerChavesRecursivo(valor: unknown): unknown {
  if (Array.isArray(valor)) {
    return valor.map(removerChavesRecursivo);
  }
  if (valor !== null && typeof valor === "object") {
    const original = valor as Record<string, unknown>;
    const limpo: Record<string, unknown> = {};
    for (const [chave, filho] of Object.entries(original)) {
      if (CHAVES_REMOVIDAS.has(chave)) continue;
      limpo[chave] = removerChavesRecursivo(filho);
    }
    return limpo;
  }
  return valor;
}

/**
 * Gera o JSON Schema (draft 2020-12) de `schema` e remove recursivamente as
 * chaves que o `strict:true` do OpenRouter recusa, em qualquer profundidade
 * (inclusive dentro de `items`, `$defs`, `properties` aninhadas).
 */
export function paraJsonSchemaEstrito(schema: z.ZodType<unknown>): Record<string, unknown> {
  const bruto = z.toJSONSchema(schema, { target: "draft-2020-12" });
  return removerChavesRecursivo(bruto) as Record<string, unknown>;
}
