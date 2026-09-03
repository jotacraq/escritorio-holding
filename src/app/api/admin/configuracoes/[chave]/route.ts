export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel } from "@/server/auth";
import { erroNaoEncontrado, erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import { ehChaveConfiguracaoConhecida, SCHEMAS_CONFIGURACAO } from "@/server/admin/configuracoes";
import type { ConfiguracaoAdmin } from "@/types/admin";

const ParametroSchema = z.object({ chave: z.string().trim().min(1).max(100) });

/**
 * PATCH /api/admin/configuracoes/[chave] — regra não negociável: `configuracoes`
 * nega INSERT/DELETE de propósito (0027). Esta rota só faz UPDATE de uma
 * chave que JÁ EXISTE, e valida o FORMATO do `valor` contra o schema exato
 * desta chave (`src/server/admin/configuracoes.ts`) antes de tocar no banco —
 * chave desconhecida ou valor fora do formato nunca chegam a um UPDATE.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ chave: string }> }) {
  try {
    const usuario = await exigirPapel("admin");
    const { chave } = ParametroSchema.parse(await params);

    if (!ehChaveConfiguracaoConhecida(chave)) {
      throw erroNaoEncontrado(
        `Chave '${chave}' não existe. Chave nova é migration, não UPDATE pela tela.`,
      );
    }

    const corpoBruto = await request.json().catch(() => {
      throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
    });

    const schemaDaChave = SCHEMAS_CONFIGURACAO[chave];
    const resultado = schemaDaChave.safeParse((corpoBruto as { valor?: unknown })?.valor);
    if (!resultado.success) {
      throw erroValidacao(resultado.error.issues, `Formato inválido para a chave '${chave}'.`);
    }

    const supabase = await criarClienteServidor();
    const { data: atualizada, error } = await supabase
      .from("configuracoes")
      .update({ valor: resultado.data, atualizado_por: usuario.id })
      .eq("chave", chave)
      .select("*")
      .maybeSingle<ConfiguracaoAdmin>();

    if (error) {
      registrarErro("api/admin/configuracoes/[chave] PATCH", error, { chave });
      throw error;
    }
    if (!atualizada) throw erroNaoEncontrado(`Chave '${chave}' não encontrada.`);

    return NextResponse.json({ configuracao: atualizada });
  } catch (erro) {
    return respostaErro("api/admin/configuracoes/[chave] PATCH", erro);
  }
}
