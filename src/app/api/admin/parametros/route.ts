export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel } from "@/server/auth";
import { erroConflito, erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import { ChaveParametroSchema, CorpoCriarParametroSchema } from "@/server/parametros";
import type { ParametroMetodo, RespostaAdminParametros } from "@/types/cenario";

const QuerySchema = z.object({
  chave: ChaveParametroSchema.optional(),
  prefixo: z
    .string()
    .regex(/^[a-z][a-z0-9_.]{0,60}$/)
    .optional(),
});

/**
 * GET /api/admin/parametros[?chave=itcmd.aliquota | ?prefixo=itcmd.]
 * Histórico completo (todas as versões, ativas ou não) — só admin.
 * Sem parâmetro de imposto cadastrado, `itens` vem vazio e a tela diz
 * (§4.10): "Nenhuma alíquota de ITCMD cadastrada. O sistema não calcula
 * imposto sem uma alíquota com base legal registrada aqui pela Dra. Elaine."
 */
export async function GET(request: NextRequest) {
  try {
    await exigirPapel("admin");
    const query = QuerySchema.safeParse({
      chave: request.nextUrl.searchParams.get("chave") ?? undefined,
      prefixo: request.nextUrl.searchParams.get("prefixo") ?? undefined,
    });
    if (!query.success) throw erroValidacao(query.error.issues);

    const supabase = await criarClienteServidor();
    let consulta = supabase
      .from("parametros_metodo")
      .select("*")
      .order("chave")
      .order("uf", { nullsFirst: true })
      .order("municipio", { nullsFirst: true })
      .order("versao", { ascending: false })
      .limit(500);
    if (query.data.chave) consulta = consulta.eq("chave", query.data.chave);
    if (query.data.prefixo) consulta = consulta.like("chave", `${query.data.prefixo}%`);

    const { data, error } = await consulta;
    if (error) {
      registrarErro("api/admin/parametros GET", error);
      throw error;
    }
    const resposta: RespostaAdminParametros = { itens: (data as ParametroMetodo[] | null) ?? [] };
    return NextResponse.json(resposta);
  } catch (erro) {
    return respostaErro("api/admin/parametros GET", erro);
  }
}

/**
 * POST /api/admin/parametros — cria VERSÃO NOVA (INSERT). Nunca edita valor:
 * a trigger `parametros_metodo_imutavel` recusa UPDATE de valor. `versao`
 * vem do banco (max+1 na chave/jurisdição). `ativar: true` chama
 * `ativar_parametro_metodo` na sequência (atômica no par ativo/inativo).
 * Base legal obrigatória para `itcmd.*`/`itbi.*` — no zod e no CHECK.
 */
export async function POST(request: NextRequest) {
  try {
    const usuario = await exigirPapel("admin");
    const corpo = CorpoCriarParametroSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    const supabase = await criarClienteServidor();
    const { data: criado, error } = await supabase
      .from("parametros_metodo")
      .insert({
        chave: corpo.chave,
        valor: corpo.valor,
        unidade: corpo.unidade,
        uf: corpo.uf ?? null,
        municipio: corpo.municipio ?? null,
        base_legal: corpo.base_legal ?? null,
        vigente_de: corpo.vigente_de,
        notas: corpo.notas ?? null,
        criado_por: usuario.id,
      })
      .select("*")
      .single<ParametroMetodo>();
    if (error) {
      const pg = error as { code?: string; message: string };
      if (pg.code === "23514") {
        throw erroConflito("parametro_invalido", "Parâmetro recusado pelo banco: alíquota de imposto exige base legal e jurisdição.");
      }
      registrarErro("api/admin/parametros POST", error, { chave: corpo.chave });
      throw error;
    }

    let parametro = criado;
    if (corpo.ativar) {
      const { data: ativado, error: erroAtivar } = await supabase
        .rpc("ativar_parametro_metodo", { p_id: criado.id })
        .single<ParametroMetodo>();
      if (erroAtivar) {
        registrarErro("api/admin/parametros POST ativar", erroAtivar, { parametro_id: criado.id });
        throw erroAtivar;
      }
      parametro = ativado;
    }

    return NextResponse.json({ parametro }, { status: 201 });
  } catch (erro) {
    return respostaErro("api/admin/parametros POST", erro);
  }
}
