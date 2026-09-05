/**
 * scripts/medir-schema-narrativa.ts
 *
 * Mede a gramática do `CroquiNarrativaSchema` (Agente do Croqui v3, Fase 5
 * §6.1) com a MESMA fórmula que `POST /api/admin/sonda-schema` usa do outro
 * lado da rede:
 *
 *   Buffer.byteLength(JSON.stringify(paraJsonSchemaEstrito(schema)))
 *
 * Por que existe: o provedor compila o JSON Schema estrito no lado dele e
 * recusa com `400 The compiled grammar is too large` acima de ~3.905 bytes
 * (medido em 04/09/2026). Isso NÃO aparece em `tsc`, `eslint` nem `build` — o
 * sistema fica verde e a IA para de responder. A sonda de rede exige
 * `OPENROUTER_API_KEY`; esta medição não exige nada e roda em CI.
 *
 * MODO DE USO:
 *   npx tsx scripts/medir-schema-narrativa.ts
 *
 * Sai com código 1 acima do teto — para colar o número no comentário da
 * migration antes de ativar o prompt (regra de publicação do §4.6 da Fase 4).
 */
import { paraJsonSchemaEstrito } from "../src/server/ia/provedor/json-schema-estrito";
import { CroquiNarrativaSchema } from "../src/server/ia/schema-croqui-narrativa";
import { CroquiAnaliseV2Schema } from "../src/server/croqui/schema-analise-v2";
import { CroquiAnaliseSchema } from "../src/server/ia/schema-croqui-analise";

/** Teto conhecido: 3.905 bytes compilou, 4.428 não (briefing, 04/09/2026). */
const TETO = 3905;

function medir(nome: string, schema: Parameters<typeof paraJsonSchemaEstrito>[0]): number {
  const esquema = paraJsonSchemaEstrito(schema);
  const bytes = Buffer.byteLength(JSON.stringify(esquema));
  const propriedades = Object.keys((esquema.properties ?? {}) as Record<string, unknown>).length;
  const marca = bytes <= TETO ? "OK " : "ACIMA";
  console.log(`${marca}  ${nome.padEnd(28)} ${String(bytes).padStart(6)} bytes · ${propriedades} propriedades`);
  return bytes;
}

console.log(`Gramática do Agente do Croqui — teto conhecido ${TETO} bytes\n`);

medir("croqui v1 (produção)", CroquiAnaliseSchema);
medir("croqui v2 (inativa, 0059)", CroquiAnaliseV2Schema);
const v3 = medir("croqui v3 narrativa (0066)", CroquiNarrativaSchema);

console.log(
  `\npara colar na migration: croqui_narrativa · ${v3} bytes · ${
    v3 <= TETO ? "abaixo do teto conhecido" : "ACIMA DO TETO — não ativar"
  }`,
);

if (v3 > TETO) process.exit(1);
