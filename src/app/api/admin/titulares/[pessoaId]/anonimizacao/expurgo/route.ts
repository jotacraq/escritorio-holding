export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { exigirPapel } from "@/server/auth";
import { erroConflito, erroNaoEncontrado, erroValidacao, respostaErro } from "@/server/erros";
import { criarLimitadorJanela } from "@/server/integracoes/rate-limit";
import { expurgarArquivos } from "@/server/lgpd/storage";
import { migracaoPendente, respostaMigracaoPendente } from "@/server/migracao-pendente";
import type { SolicitacaoTitular } from "@/types/lgpd";

const ParametroSchema = z.object({ pessoaId: z.string().uuid() });
const CorpoSchema = z.object({ solicitacao_id: z.string().uuid() });

const limitarExpurgo = criarLimitadorJanela(5, 60_000);

/**
 * POST /api/admin/titulares/[pessoaId]/anonimizacao/expurgo — retomada.
 *
 * Existe porque o passo do Storage pode falhar depois de o banco já estar
 * anonimizado (rede, permissão do bucket). Sem esta rota, "2 arquivos ainda no
 * armazenamento" seria um beco sem saída na tela.
 *
 * Idempotente: relê `storage_pendente` do registro, tenta de novo, e o que já
 * saiu não casa mais no `confirmar_expurgo_storage`.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ pessoaId: string }> }) {
  try {
    const usuario = await exigirPapel("admin");
    const { pessoaId } = ParametroSchema.parse(await params);

    const limite = limitarExpurgo(usuario.id);
    if (limite.excedido) {
      return NextResponse.json(
        { erro: "limite_excedido", mensagem: `Tente de novo em ${limite.tenteEmS} s.`, tente_em_s: limite.tenteEmS },
        { status: 429, headers: { "Retry-After": String(limite.tenteEmS) } },
      );
    }

    const corpo = CorpoSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    const admin = criarClienteAdmin();
    const { data, error } = await admin
      .from("titulares_solicitacoes")
      .select("*")
      .eq("id", corpo.solicitacao_id)
      .maybeSingle();

    if (error) {
      if (migracaoPendente(error)) {
        return respostaMigracaoPendente("0080", "titulares_solicitacoes não existe neste banco");
      }
      throw error;
    }
    if (!data) throw erroNaoEncontrado("Solicitação não encontrada.");

    const solicitacao = data as unknown as SolicitacaoTitular;
    if (solicitacao.pessoa_id !== pessoaId) {
      // A solicitação é de outra pessoa: 404, não 403 — não confirmamos a
      // existência de registro de terceiro para quem errou o par.
      throw erroNaoEncontrado("Solicitação não encontrada para esta pessoa.");
    }
    if (solicitacao.tipo !== "anonimizacao") {
      throw erroConflito("tipo_invalido", "Só anonimização tem expurgo de arquivo.");
    }

    const pendentes = (solicitacao.resultado?.storage_pendente ?? []).filter(
      (c) => typeof c === "string" && c && !c.startsWith("expurgado/"),
    );
    if (pendentes.length === 0) {
      return NextResponse.json({ solicitacao, removidos: 0, falhos: [] });
    }

    const { removidos, falhos } = await expurgarArquivos(admin, solicitacao.id, pendentes, pessoaId);

    const { data: atualizada } = await admin
      .from("titulares_solicitacoes")
      .select("*")
      .eq("id", solicitacao.id)
      .maybeSingle();

    return NextResponse.json({
      solicitacao: (atualizada as unknown as SolicitacaoTitular) ?? solicitacao,
      removidos,
      falhos,
    });
  } catch (erro) {
    return respostaErro("api/admin/titulares/anonimizacao/expurgo POST", erro);
  }
}
