export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel } from "@/server/auth";
import { erroNaoEncontrado, erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import { criarLimitadorJanela } from "@/server/integracoes/rate-limit";
import { confirmacaoNomeConfere, impedimentoParaAnonimizar } from "@/server/lgpd/anonimizacao";
import { mapearErroTitular } from "@/server/lgpd/erros";
import { expurgarArquivos } from "@/server/lgpd/storage";
import { migracaoPendente, respostaMigracaoPendente } from "@/server/migracao-pendente";
import { CANAIS_PEDIDO_TITULAR, type RespostaAnonimizacao, type SolicitacaoTitular } from "@/types/lgpd";

const ParametroSchema = z.object({ pessoaId: z.string().uuid() });

const CorpoSchema = z.object({
  motivo: z.string().trim().min(10).max(2000),
  base_legal: z.string().trim().min(5).max(2000),
  canal_pedido: z.enum(CANAIS_PEDIDO_TITULAR),
  solicitado_em: z.string().datetime({ offset: true }),
  /** Conferida NO SERVIDOR — tela se burla, `curl` não pode passar. */
  confirmacao_nome: z.string().min(1).max(300),
});

const limitarAnonimizacao = criarLimitadorJanela(2, 60_000);

/**
 * POST /api/admin/titulares/[pessoaId]/anonimizacao — LGPD art. 18, VI.
 *
 * Três tempos, idempotentes (docs/ARQUITETURA-FASE-7.md §B4.1):
 *   1. a rota lê `documentos.caminho` da pessoa (o banco ainda os tem);
 *   2. `anonimizar_titular` faz TUDO em uma transação, sem DELETE;
 *   3. a rota remove os objetos do Storage e chama `confirmar_expurgo_storage`.
 *
 * Se 3 falhar, a resposta continua 200 com `storage.falhos` preenchido e o
 * registro fica com `storage_removido_em: null` — a tela mostra a faixa
 * "arquivos ainda no armazenamento" e o botão de retomada. Nada falha em
 * silêncio, e repetir é seguro.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ pessoaId: string }> }) {
  try {
    const usuario = await exigirPapel("admin");
    const { pessoaId } = ParametroSchema.parse(await params);

    const limite = limitarAnonimizacao(usuario.id);
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

    if (new Date(corpo.solicitado_em).getTime() > Date.now() + 60_000) {
      throw erroValidacao({ solicitado_em: corpo.solicitado_em }, "A data do pedido não pode estar no futuro.");
    }

    const admin = criarClienteAdmin();

    const { data: pessoa, error: erroPessoa } = await admin
      .from("pessoas")
      .select("id, nome, origem_dado, auth_user_id, anonimizada_em")
      .eq("id", pessoaId)
      .maybeSingle();
    if (erroPessoa) {
      if (migracaoPendente(erroPessoa)) {
        return respostaMigracaoPendente("0080", "pessoas.anonimizada_em não existe neste banco");
      }
      throw erroPessoa;
    }
    if (!pessoa) throw erroNaoEncontrado("Pessoa não encontrada.");

    const linha = pessoa as {
      id: string;
      nome: string;
      origem_dado: string;
      auth_user_id: string | null;
      anonimizada_em: string | null;
    };
    const jaEstava = Boolean(linha.anonimizada_em);

    // Quem já foi anonimizado tem o marcador no lugar do nome: exigir o nome
    // digitado ali seria pedir para o operador copiar o marcador. A RPC é
    // idempotente e devolve o registro original.
    if (!jaEstava && !confirmacaoNomeConfere(linha.nome, corpo.confirmacao_nome)) {
      return NextResponse.json(
        {
          erro: "confirmacao_nao_confere",
          mensagem: "O nome digitado não confere com o nome cadastrado desta pessoa.",
        },
        { status: 422 },
      );
    }

    const { data: jornadas, error: erroJornadas } = await admin
      .from("jornadas")
      .select("etapa, desfecho")
      .eq("pessoa_id", pessoaId);
    if (erroJornadas) throw erroJornadas;

    if (!jaEstava) {
      const impedimento = impedimentoParaAnonimizar(
        {
          id: linha.id,
          nome: linha.nome,
          origem_dado: linha.origem_dado === "exemplo" ? "exemplo" : "real",
          auth_user_id: linha.auth_user_id,
          anonimizada_em: linha.anonimizada_em,
        },
        (jornadas ?? []).map((j) => ({
          etapa: String((j as { etapa: string }).etapa),
          desfecho: String((j as { desfecho: string }).desfecho),
        })),
      );
      if (impedimento) {
        return NextResponse.json({ erro: impedimento.codigo, mensagem: impedimento.mensagem }, { status: 422 });
      }
    }

    // TEMPO 1 — os caminhos, enquanto o banco ainda os tem.
    const { data: documentos, error: erroDocumentos } = await admin
      .from("documentos")
      .select("caminho")
      .eq("pessoa_id", pessoaId);
    if (erroDocumentos) throw erroDocumentos;
    const caminhos = (documentos ?? [])
      .map((d) => String((d as { caminho: string }).caminho))
      .filter((c) => c && !c.startsWith("expurgado/"));

    // TEMPO 2 — a transação. Com a SESSÃO: o banco confere `app.eh_admin()` de
    // novo, por baixo da trava de rota.
    const supabase = await criarClienteServidor();
    const { data: solicitacao, error: erroRpc } = await supabase
      .rpc("anonimizar_titular", {
        p_pessoa_id: pessoaId,
        p_motivo: corpo.motivo,
        p_base_legal: corpo.base_legal,
        p_canal: corpo.canal_pedido,
        p_solicitado_em: corpo.solicitado_em,
        p_executado_por: usuario.id,
      })
      .single<SolicitacaoTitular>();

    if (erroRpc) {
      if (migracaoPendente(erroRpc)) {
        return respostaMigracaoPendente("0079 + 0080", "anonimizar_titular não existe neste banco");
      }
      const resposta = mapearErroTitular(erroRpc);
      if (resposta) return resposta;
      registrarErro("api/admin/titulares/anonimizacao POST", erroRpc, { pessoa_id: pessoaId, perfil_id: usuario.id });
      throw erroRpc;
    }

    // TEMPO 3 — Storage + fecho. Falha aqui NÃO derruba a anonimização: vira
    // pendência visível.
    const storage = jaEstava
      ? { removidos: 0, falhos: [] as string[] }
      : await expurgarArquivos(admin, solicitacao.id, caminhos, pessoaId);

    const resposta: RespostaAnonimizacao = {
      solicitacao,
      ja_anonimizada: jaEstava,
      storage,
    };
    return NextResponse.json(resposta);
  } catch (erro) {
    return respostaErro("api/admin/titulares/anonimizacao POST", erro);
  }
}
