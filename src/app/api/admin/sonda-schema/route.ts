export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { exigirPapel } from "@/server/auth";
import { respostaErro } from "@/server/erros";
import { BriefingSchema, BriefingV2Schema } from "@/server/ia/schema-briefing";
import { CroquiAnaliseSchema } from "@/server/ia/schema-croqui-analise";
import { CroquiAnaliseV2Schema } from "@/server/croqui/schema-analise-v2";
import { MaterialConteudoSchema } from "@/server/ia/material";
import { paraJsonSchemaEstrito } from "@/server/ia/provedor/json-schema-estrito";

/**
 * POST /api/admin/sonda-schema — descobre, contra o provedor de verdade, se um
 * schema estrito COMPILA e com quantos bytes.
 *
 * Por que existe: em 04/09/2026 o briefing parou de sair com
 * `invalid_request_error: The compiled grammar is too large`. O schema só é
 * compilado do outro lado da rede — `tsc`, `eslint` e `build` ficam verdes
 * enquanto o sistema está quebrado. Chutar o limite custaria um deploy de 5
 * minutos por tentativa; um 400 do provedor custa zero token, então a sonda
 * testa vários recortes numa chamada só.
 *
 * Generalizada na Fase 4 (ARQUITETURA-FASE-4.md §4.6): corpo
 * `{ "chave": "briefing" | "briefing_v3" | "croqui_v1" | "croqui_v2" | "material",
 *    "raciocinio"?: boolean }`. Sem corpo = `briefing` (compatível com a
 * chamada antiga). Regra de publicação: nenhum INSERT de prompt com
 * `esquema_saida` entra em migration sem o resultado desta sonda colado no
 * comentário (bytes + "compilou") — 0059 depende de `briefing_v3` e `croqui_v2`.
 *
 * `max_tokens: 16` de propósito: a resposta não interessa, só se a gramática
 * compila. Variante que passa é interrompida por limite de tokens, não por erro.
 *
 * Admin-only. Não expõe nada do cliente — só o formato do schema.
 */

const CHAVES = {
  briefing: { schema: BriefingV2Schema, descricao: "Briefing v2 — o que está em produção (prompts v1/v2)" },
  briefing_v3: { schema: BriefingSchema, descricao: "Briefing v3 — v2 + linguagem_do_cliente (0059, ativa só depois desta sonda)" },
  croqui_v1: { schema: CroquiAnaliseSchema, descricao: "Agente do Croqui v1 — o que está em produção" },
  croqui_v2: { schema: CroquiAnaliseV2Schema, descricao: "Agente do Croqui v2 — 13 slides tipados + alocacao + valor_declarado (0059)" },
  material: { schema: MaterialConteudoSchema, descricao: "Material pós-sessão" },
} as const;
type ChaveSonda = keyof typeof CHAVES;

const CorpoSchema = z.object({
  chave: z.enum(Object.keys(CHAVES) as [ChaveSonda, ...ChaveSonda[]]).default("briefing"),
  /** Segunda pergunta (só faz sentido uma vez por provedor): ele aceita campo de raciocínio? */
  raciocinio: z.boolean().default(false),
});

interface ResultadoSonda {
  variante: string;
  bytes: number;
  propriedades: number;
  compila: boolean;
  status: number;
  mensagem: string;
}

/** Remove propriedades do objeto raiz, mantendo `required` coerente. */
function recortar(base: Record<string, unknown>, manter: string[]): Record<string, unknown> {
  const props = base.properties as Record<string, unknown>;
  const novasProps: Record<string, unknown> = {};
  for (const chave of manter) if (chave in props) novasProps[chave] = props[chave];
  return { ...base, properties: novasProps, required: manter.filter((c) => c in props) };
}

/** Tira `minItems`/`maxItems` em qualquer profundidade — para saber se é a CARDINALIDADE (`.length()`) que o provedor recusa. */
function semLimitesDeArray(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(semLimitesDeArray);
  if (valor !== null && typeof valor === "object") {
    const limpo: Record<string, unknown> = {};
    for (const [chave, filho] of Object.entries(valor as Record<string, unknown>)) {
      if (chave === "minItems" || chave === "maxItems") continue;
      limpo[chave] = semLimitesDeArray(filho);
    }
    return limpo;
  }
  return valor;
}

function bytesDe(esquema: Record<string, unknown>): number {
  return Buffer.byteLength(JSON.stringify(esquema));
}

async function testar(
  nome: string,
  esquema: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Promise<ResultadoSonda> {
  const resposta = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "X-Title": "SIC-HF sonda",
    },
    body: JSON.stringify({
      model: process.env.IA_MODELO_PADRAO?.trim() || "anthropic/claude-sonnet-5",
      messages: [{ role: "user", content: "ok" }],
      max_tokens: 16,
      response_format: { type: "json_schema", json_schema: { name: "sonda", strict: true, schema: esquema } },
      provider: { order: ["anthropic"], allow_fallbacks: false, require_parameters: true },
      ...extra,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const corpo = (await resposta.json().catch(() => null)) as
    | { error?: { message?: string; metadata?: unknown } }
    | null;
  const meta = corpo?.error?.metadata;
  const compila = resposta.ok && !corpo?.error;
  return {
    variante: nome,
    bytes: bytesDe(esquema),
    propriedades: Object.keys((esquema.properties ?? {}) as Record<string, unknown>).length,
    compila,
    status: resposta.status,
    mensagem: compila
      ? "compilou"
      : `${corpo?.error?.message ?? `HTTP ${resposta.status}`} ${meta ? JSON.stringify(meta).slice(0, 300) : ""}`.trim(),
  };
}

export async function POST(request: NextRequest) {
  try {
    await exigirPapel("admin");
    if (!process.env.OPENROUTER_API_KEY?.trim()) {
      return NextResponse.json({ erro: "sem_chave", mensagem: "OPENROUTER_API_KEY ausente." }, { status: 503 });
    }

    const corpoBruto = await request.text();
    const corpo = CorpoSchema.parse(corpoBruto.trim() ? JSON.parse(corpoBruto) : {});
    const { schema, descricao } = CHAVES[corpo.chave];

    const cheio = paraJsonSchemaEstrito(schema) as Record<string, unknown>;
    const todas = Object.keys((cheio.properties ?? {}) as Record<string, unknown>);
    const temLimitesDeArray = JSON.stringify(cheio).includes('"minItems"');

    // Recortes do maior para o menor: o primeiro que compilar dá o teto real.
    // As duas maiores seções do schema saem primeiro (por bytes), sem
    // conhecimento de nome de campo — vale para qualquer chave.
    const porTamanho = [...todas].sort(
      (a, b) =>
        JSON.stringify((cheio.properties as Record<string, unknown>)[b]).length -
        JSON.stringify((cheio.properties as Record<string, unknown>)[a]).length,
    );
    const [maior, segunda] = porTamanho;

    const variantes: Array<[string, Record<string, unknown>]> = [["cheio", cheio]];
    if (temLimitesDeArray) variantes.push(["cheio_sem_min_max_items", semLimitesDeArray(cheio) as Record<string, unknown>]);
    if (maior) variantes.push([`sem_${maior}`, recortar(cheio, todas.filter((c) => c !== maior))]);
    if (segunda) variantes.push([`sem_${segunda}`, recortar(cheio, todas.filter((c) => c !== segunda))]);
    if (maior && segunda) variantes.push(["sem_as_duas_maiores", recortar(cheio, todas.filter((c) => c !== maior && c !== segunda))]);
    variantes.push(["metade", recortar(cheio, todas.slice(0, Math.ceil(todas.length / 2)))]);
    variantes.push(["minimo", recortar(cheio, todas.slice(0, 2))]);

    const resultados: ResultadoSonda[] = [];
    for (const [nome, esquema] of variantes) {
      resultados.push(await testar(nome, esquema));
      // A primeira que compila responde a pergunta; as menores só custariam requisição.
      if (nome !== "cheio" && resultados[resultados.length - 1].compila) break;
    }

    // Segunda pergunta (opcional): o provedor aceita campo de raciocinio? O
    // 400 que levou a culpa disso em 04/09/2026 era do schema — a pergunta
    // continua aberta, e so a API responde. Schema minimo de proposito.
    let raciocinio: ResultadoSonda[] | undefined;
    if (corpo.raciocinio) {
      const minimo = recortar(cheio, todas.slice(0, 2));
      raciocinio = [
        await testar("raciocinio: nenhum", minimo),
        await testar("raciocinio: effort low", minimo, { reasoning: { effort: "low" } }),
        await testar("raciocinio: effort high", minimo, { reasoning: { effort: "high" } }),
        await testar("raciocinio: max_tokens 1024", minimo, { reasoning: { max_tokens: 1024 } }),
        await testar("raciocinio: enabled false", minimo, { reasoning: { enabled: false } }),
      ];
    }

    const cheioResultado = resultados[0];
    return NextResponse.json({
      chave: corpo.chave,
      descricao,
      bytes: cheioResultado.bytes,
      compila: cheioResultado.compila,
      // Linha pronta para colar no comentário da migration (regra do §4.6).
      para_colar: `sonda ${new Date().toISOString().slice(0, 10)} · ${corpo.chave} · ${cheioResultado.bytes} bytes · ${cheioResultado.compila ? "compilou" : "NÃO compilou: " + cheioResultado.mensagem}`,
      resultados,
      ...(raciocinio ? { raciocinio } : {}),
    });
  } catch (erro) {
    return respostaErro("POST /api/admin/sonda-schema", erro);
  }
}
