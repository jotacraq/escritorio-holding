/**
 * scripts/testar-json-schema-estrito.ts
 *
 * Prova B1-3 (Frente 1 — migração de provedor de IA para OpenRouter): o JSON
 * Schema gerado por `paraJsonSchemaEstrito()` para `BriefingSchema` nunca
 * contém, em nenhuma profundidade, as chaves de validação que o `strict:true`
 * do OpenRouter rejeita (`minLength`, `minimum`, `maximum`, `exclusiveMinimum`,
 * `exclusiveMaximum`). Isso NÃO afrouxa a validação real — `schema.safeParse()`
 * em `src/server/ia/executar.ts` continua validando com força total; este
 * schema é só o guia de forma que vai para o modelo.
 *
 * MODO DE USO:
 *   npx tsx scripts/testar-json-schema-estrito.ts
 *
 * Sem framework de teste no projeto (nenhum vitest/jest no package.json) —
 * script standalone, mesmo padrão de `scripts/importar-transcricoes.ts`.
 * Sai com código 1 em qualquer falha (para uso em CI, se algum dia existir).
 */
import { paraJsonSchemaEstrito } from "../src/server/ia/provedor/json-schema-estrito";
import { BriefingSchema } from "../src/server/ia/schema-briefing";
import { CroquiAnaliseSchema } from "../src/server/ia/schema-croqui-analise";

const CHAVES_PROIBIDAS = ["minLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"];

function coletarChavesProibidas(valor: unknown, caminho: string, achados: string[]): void {
  if (Array.isArray(valor)) {
    valor.forEach((item, indice) => coletarChavesProibidas(item, `${caminho}[${indice}]`, achados));
    return;
  }
  if (valor !== null && typeof valor === "object") {
    for (const [chave, filho] of Object.entries(valor as Record<string, unknown>)) {
      const caminhoFilho = `${caminho}.${chave}`;
      if (CHAVES_PROIBIDAS.includes(chave)) {
        achados.push(caminhoFilho);
      }
      coletarChavesProibidas(filho, caminhoFilho, achados);
    }
  }
}

let falhas = 0;

function testar(nome: string, schema: Parameters<typeof paraJsonSchemaEstrito>[0]): void {
  const jsonSchema = paraJsonSchemaEstrito(schema);
  const achados: string[] = [];
  coletarChavesProibidas(jsonSchema, nome, achados);

  if (achados.length > 0) {
    falhas++;
    console.error(`FALHOU — ${nome}: encontradas ${achados.length} chave(s) proibida(s):`);
    for (const caminho of achados) console.error(`  - ${caminho}`);
  } else {
    console.log(`OK — ${nome}: nenhuma das 5 chaves proibidas (${CHAVES_PROIBIDAS.join(", ")}) encontrada.`);
  }
}

// Confirma primeiro que o schema BRUTO (sem a limpeza) de fato contém alguma
// dessas chaves — senão o teste passaria mesmo com `paraJsonSchemaEstrito`
// quebrado (BriefingSchema tem `.int().min(0).max(100)` em `grau_confianca`,
// entre outros campos, então isso é esperado sempre gerar minimum/maximum).
import { z } from "zod";
const brutoBriefing = z.toJSONSchema(BriefingSchema, { target: "draft-2020-12" });
const achadosNoBruto: string[] = [];
coletarChavesProibidas(brutoBriefing, "bruto(BriefingSchema)", achadosNoBruto);
if (achadosNoBruto.length === 0) {
  falhas++;
  console.error(
    "FALHOU — sanity check: o schema BRUTO de BriefingSchema não contém nenhuma chave proibida. " +
      "O teste não prova nada se a fonte não tiver o que remover — confira BriefingSchema.",
  );
} else {
  console.log(`OK — sanity check: schema bruto de BriefingSchema contém ${achadosNoBruto.length} chave(s) (esperado, prova que a remoção faz efeito).`);
}

testar("BriefingSchema", BriefingSchema);
testar("CroquiAnaliseSchema", CroquiAnaliseSchema);

if (falhas > 0) {
  console.error(`\n${falhas} verificação(ões) falharam.`);
  process.exit(1);
}
console.log("\nTodas as verificações passaram.");
