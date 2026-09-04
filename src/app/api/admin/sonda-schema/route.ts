export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { exigirPapel } from "@/server/auth";
import { respostaErro } from "@/server/erros";
import { BriefingSchema } from "@/server/ia/schema-briefing";
import { paraJsonSchemaEstrito } from "@/server/ia/provedor/json-schema-estrito";

/**
 * POST /api/admin/sonda-schema — descobre, contra o provedor de verdade, qual
 * tamanho de schema estrito ele aceita.
 *
 * Por que existe: em 04/09/2026 o briefing parou de sair com
 * `invalid_request_error: The compiled grammar is too large`. O schema só é
 * compilado do outro lado da rede — `tsc`, `eslint` e `build` ficam verdes
 * enquanto o sistema está quebrado. Chutar o limite custaria um deploy de 5
 * minutos por tentativa; um 400 do provedor custa zero token, então a sonda
 * testa vários recortes numa chamada só.
 *
 * `max_tokens: 16` de propósito: a resposta não interessa, só se a gramática
 * compila. Variante que passa é interrompida por limite de tokens, não por erro.
 *
 * Admin-only. Não expõe nada do cliente — só o formato do schema.
 */

interface ResultadoSonda {
  variante: string;
  bytes: number;
  propriedades: number;
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

async function testar(
  nome: string,
  esquema: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Promise<ResultadoSonda> {
  const texto = JSON.stringify(esquema);
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
  return {
    variante: nome,
    bytes: texto.length,
    propriedades: Object.keys((esquema.properties ?? {}) as Record<string, unknown>).length,
    status: resposta.status,
    mensagem: corpo?.error
      ? `${corpo.error.message ?? ""} ${meta ? JSON.stringify(meta).slice(0, 300) : ""}`.trim()
      : "compilou",
  };
}

export async function POST() {
  try {
    await exigirPapel("admin");
    if (!process.env.OPENROUTER_API_KEY?.trim()) {
      return NextResponse.json({ erro: "sem_chave", mensagem: "OPENROUTER_API_KEY ausente." }, { status: 503 });
    }

    const cheio = paraJsonSchemaEstrito(BriefingSchema) as Record<string, unknown>;
    const todas = Object.keys((cheio.properties ?? {}) as Record<string, unknown>);

    // Recortes do maior para o menor: o primeiro que compilar dá o teto real.
    const variantes: Array<[string, string[]]> = [
      ["cheio", todas],
      ["sem_estrategia_sessao", todas.filter((c) => c !== "estrategia_sessao")],
      ["sem_processo_decisorio", todas.filter((c) => c !== "processo_decisorio")],
      ["sem_os_dois", todas.filter((c) => c !== "estrategia_sessao" && c !== "processo_decisorio")],
      ["metade", todas.slice(0, Math.ceil(todas.length / 2))],
      ["so_resumo", ["resumo_executivo", "grau_confianca"]],
    ];

    const resultados: ResultadoSonda[] = [];
    for (const [nome, manter] of variantes) {
      resultados.push(await testar(nome, recortar(cheio, manter)));
    }

    // Segunda pergunta: o provedor aceita campo de raciocinio? O 400 que
    // levou a culpa disso em 04/09/2026 era do schema — entao a pergunta
    // continua aberta, e so a API responde. Schema minimo de proposito: aqui
    // se testa o campo de raciocinio, nao o tamanho da gramatica.
    const minimo = recortar(cheio, ["resumo_executivo", "grau_confianca"]);
    const raciocinio: ResultadoSonda[] = [
      await testar("raciocinio: nenhum", minimo),
      await testar("raciocinio: effort low", minimo, { reasoning: { effort: "low" } }),
      await testar("raciocinio: effort high", minimo, { reasoning: { effort: "high" } }),
      await testar("raciocinio: max_tokens 1024", minimo, { reasoning: { max_tokens: 1024 } }),
      await testar("raciocinio: enabled false", minimo, { reasoning: { enabled: false } }),
    ];

    return NextResponse.json({ resultados, raciocinio });
  } catch (erro) {
    return respostaErro("POST /api/admin/sonda-schema", erro);
  }
}
