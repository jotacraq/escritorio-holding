export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel } from "@/server/auth";
import { erroNaoEncontrado, erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import { criarLimitadorJanela } from "@/server/integracoes/rate-limit";
import { mapearErroTitular } from "@/server/lgpd/erros";
import { carregarDadosDoTitular, montarDossie } from "@/server/lgpd/dossie";
import { gerarPdfDossie } from "@/server/lgpd/pdf-dossie";
import { migracaoPendente, respostaMigracaoPendente } from "@/server/migracao-pendente";
import { CANAIS_PEDIDO_TITULAR, type SolicitacaoTitular } from "@/types/lgpd";

const ParametroSchema = z.object({ pessoaId: z.string().uuid() });

const CorpoSchema = z.object({
  motivo: z.string().trim().min(10).max(2000),
  base_legal: z.string().trim().min(5).max(2000),
  canal_pedido: z.enum(CANAIS_PEDIDO_TITULAR),
  solicitado_em: z.string().datetime({ offset: true }).optional(),
  formato: z.enum(["json", "pdf"]).default("json"),
});

/**
 * 3 por minuto. É o menor limite do sistema de propósito: exportação é a
 * operação mais perigosa daqui — PII completa de uma família num arquivo. A
 * chave é o PERFIL, não o IP (a equipe sai toda pelo IP do escritório).
 */
const limitarExportacao = criarLimitadorJanela(3, 60_000);

function nomeDeArquivo(nome: string, extensao: string): string {
  const slug =
    nome
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 60) || "titular";
  return `dossie-${slug}-${new Date().toISOString().slice(0, 10)}.${extensao}`;
}

/**
 * POST /api/admin/titulares/[pessoaId]/exportacoes — LGPD art. 18, II e V.
 *
 * O REGISTRO VEM PRIMEIRO: `registrar_exportacao_titular` grava quem, quando,
 * por quê e sob qual base legal ANTES de o dossiê ser montado. Se a gravação
 * falhar, ninguém exporta — PII saindo sem rastro de quem a tirou é o pior caso
 * desta feature.
 *
 * A RPC roda com a SESSÃO (não `service_role`): o banco confere `app.eh_admin()`
 * de novo, por baixo da trava de rota. A leitura do dossiê é que precisa de
 * `service_role`, porque atravessa a RLS de 21 tabelas.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ pessoaId: string }> }) {
  try {
    const usuario = await exigirPapel("admin");
    const { pessoaId } = ParametroSchema.parse(await params);

    const limite = limitarExportacao(usuario.id);
    if (limite.excedido) {
      return NextResponse.json(
        {
          erro: "limite_excedido",
          mensagem: `Muitas exportações em sequência. Tente de novo em ${limite.tenteEmS} s.`,
          tente_em_s: limite.tenteEmS,
        },
        { status: 429, headers: { "Retry-After": String(limite.tenteEmS) } },
      );
    }

    const corpo = CorpoSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    if (corpo.solicitado_em && new Date(corpo.solicitado_em).getTime() > Date.now() + 60_000) {
      throw erroValidacao({ solicitado_em: corpo.solicitado_em }, "A data do pedido não pode estar no futuro.");
    }

    const supabase = await criarClienteServidor();
    const { data: registro, error: erroRegistro } = await supabase
      .rpc("registrar_exportacao_titular", {
        p_pessoa_id: pessoaId,
        p_motivo: corpo.motivo,
        p_base_legal: corpo.base_legal,
        p_canal: corpo.canal_pedido,
        p_solicitado_em: corpo.solicitado_em ?? new Date().toISOString(),
        p_executado_por: usuario.id,
      })
      .single<SolicitacaoTitular>();

    if (erroRegistro) {
      if (migracaoPendente(erroRegistro)) {
        return respostaMigracaoPendente("0080", "registrar_exportacao_titular não existe neste banco");
      }
      const resposta = mapearErroTitular(erroRegistro);
      if (resposta) return resposta;
      registrarErro("api/admin/titulares/exportacoes POST#registro", erroRegistro, {
        pessoa_id: pessoaId,
        perfil_id: usuario.id,
      });
      throw erroRegistro;
    }

    const admin = criarClienteAdmin();
    const dados = await carregarDadosDoTitular(admin, pessoaId);
    if (!dados.pessoa) throw erroNaoEncontrado("Pessoa não encontrada.");

    const { data: config } = await admin
      .from("configuracoes")
      .select("valor")
      .eq("chave", "escritorio.razao_social")
      .maybeSingle();
    const bruto = (config as { valor?: unknown } | null)?.valor;
    const controlador = typeof bruto === "string" && bruto.trim() ? bruto : null;

    const dossie = montarDossie(dados, {
      gerado_por: { id: usuario.id, nome: usuario.nome },
      solicitacao_id: registro.id,
      controlador,
    });

    const nomeTitular = String(dados.pessoa.nome ?? "titular");

    if (corpo.formato === "pdf") {
      const { pdf, bytes, paginas, fonte, erroFonte } = await gerarPdfDossie({
        dossie,
        solicitacao: registro,
        nomeTitular,
      });
      if (erroFonte) {
        // O PDF sai em Helvetica; quem precisa saber é o log, não o usuário.
        registrarErro("api/admin/titulares/exportacoes POST#fonte", new Error(erroFonte), {
          pessoa_id: pessoaId,
          solicitacao_id: registro.id,
        });
      }
      return new NextResponse(new Uint8Array(pdf), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": String(bytes),
          "Content-Disposition": `attachment; filename="${nomeDeArquivo(nomeTitular, "pdf")}"`,
          "Cache-Control": "no-store, private",
          "X-Solicitacao-Id": registro.id,
          "X-Paginas": String(paginas),
          "X-Fonte": fonte,
        },
      });
    }

    return new NextResponse(JSON.stringify(dossie, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${nomeDeArquivo(nomeTitular, "json")}"`,
        "Cache-Control": "no-store, private",
        "X-Solicitacao-Id": registro.id,
      },
    });
  } catch (erro) {
    return respostaErro("api/admin/titulares/exportacoes POST", erro);
  }
}
