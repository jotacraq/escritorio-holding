export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { exigirPapel } from "@/server/auth";
import { erroNaoEncontrado, registrarErro, respostaErro } from "@/server/erros";
import { criarLimitadorJanela } from "@/server/integracoes/rate-limit";
import { impedimentoParaAnonimizar } from "@/server/lgpd/anonimizacao";
import { levantarChavesDoTitular } from "@/server/lgpd/dossie";
import { levantarInventario } from "@/server/lgpd/inventario";
import { migracaoPendente } from "@/server/migracao-pendente";
import type { DocumentoDoTitular, InventarioTitular, SolicitacaoTitular } from "@/types/lgpd";

const ParametroSchema = z.object({ pessoaId: z.string().uuid() });

const limitarInventario = criarLimitadorJanela(30, 60_000);

/**
 * GET /api/admin/titulares/[pessoaId]/inventario — "o que o sistema guarda
 * desta pessoa", antes de exportar ou de encerrar o tratamento.
 *
 * Só admin. Lê por `service_role` porque a contagem precisa atravessar a RLS de
 * ~29 tabelas; nenhuma linha de PII trafega — as contagens são `head` e a lista
 * de documentos traz só metadado (nome, tipo, tamanho, data).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ pessoaId: string }> }) {
  try {
    const usuario = await exigirPapel("admin");
    const { pessoaId } = ParametroSchema.parse(await params);

    const limite = limitarInventario(usuario.id);
    if (limite.excedido) {
      return NextResponse.json(
        { erro: "limite_excedido", mensagem: `Tente de novo em ${limite.tenteEmS} s.`, tente_em_s: limite.tenteEmS },
        { status: 429, headers: { "Retry-After": String(limite.tenteEmS) } },
      );
    }

    const admin = criarClienteAdmin();

    const { data: pessoa, error: erroPessoa } = await admin
      .from("pessoas")
      .select("id, nome, origem_dado, auth_user_id, anonimizada_em")
      .eq("id", pessoaId)
      .maybeSingle();

    // Sem a 0080 a coluna `anonimizada_em` não existe: a tela continua de pé,
    // só sem o estado de anonimização (stub honesto, nunca 500).
    let linha = pessoa as Record<string, unknown> | null;
    let semColunas0080 = false;
    if (erroPessoa && migracaoPendente(erroPessoa)) {
      semColunas0080 = true;
      const { data, error } = await admin
        .from("pessoas")
        .select("id, nome, origem_dado, auth_user_id")
        .eq("id", pessoaId)
        .maybeSingle();
      if (error) throw error;
      linha = data as Record<string, unknown> | null;
    } else if (erroPessoa) {
      registrarErro("api/admin/titulares/inventario GET", erroPessoa, { pessoa_id: pessoaId });
      throw erroPessoa;
    }

    if (!linha) throw erroNaoEncontrado("Pessoa não encontrada.");

    const { data: jornadas, error: erroJornadas } = await admin
      .from("jornadas")
      .select("id, etapa, desfecho")
      .eq("pessoa_id", pessoaId);
    if (erroJornadas) throw erroJornadas;

    const jornadaIds = (jornadas ?? []).map((j) => String((j as { id: string }).id));

    // Sessões, croquis e transcrições são os escopos filhos do inventário
    // (`croqui_analises` pendura no croqui; `analises_transcricao`, na
    // transcrição). Três consultas de id em PARALELO, nunca uma por jornada.
    const chaves = await levantarChavesDoTitular(admin, pessoaId, jornadaIds);

    const [tabelas, documentosResposta, solicitacoesResposta] = await Promise.all([
      levantarInventario(admin, chaves),
      admin
        .from("documentos")
        .select("id, tipo, nome_arquivo, tamanho_bytes, mime, criado_em")
        .eq("pessoa_id", pessoaId)
        .order("criado_em", { ascending: false }),
      admin
        .from("titulares_solicitacoes")
        .select("*")
        .eq("pessoa_id", pessoaId)
        .order("executado_em", { ascending: false }),
    ]);

    if (documentosResposta.error) throw documentosResposta.error;

    // A trilha só existe depois da 0080. Sem ela: lista vazia + a tela sabe
    // pela ausência, não por um zero inventado.
    const solicitacoes =
      solicitacoesResposta.error && migracaoPendente(solicitacoesResposta.error)
        ? []
        : ((solicitacoesResposta.data as SolicitacaoTitular[] | null) ?? []);
    if (solicitacoesResposta.error && !migracaoPendente(solicitacoesResposta.error)) {
      throw solicitacoesResposta.error;
    }

    const inventario: InventarioTitular = {
      pessoa: {
        id: String(linha.id),
        nome: String(linha.nome),
        origem_dado: linha.origem_dado === "exemplo" ? "exemplo" : "real",
        anonimizada_em: semColunas0080 ? null : ((linha.anonimizada_em as string | null) ?? null),
      },
      tabelas,
      documentos: ((documentosResposta.data ?? []) as unknown as DocumentoDoTitular[]).map((d) => ({
        id: String(d.id),
        tipo: String(d.tipo),
        nome_arquivo: String(d.nome_arquivo),
        tamanho_bytes: Number(d.tamanho_bytes ?? 0),
        mime: String(d.mime ?? ""),
        criado_em: String(d.criado_em ?? ""),
      })),
      solicitacoes,
      impedimento: impedimentoParaAnonimizar(
        {
          id: String(linha.id),
          nome: String(linha.nome),
          origem_dado: linha.origem_dado === "exemplo" ? "exemplo" : "real",
          auth_user_id: (linha.auth_user_id as string | null) ?? null,
          anonimizada_em: semColunas0080 ? null : ((linha.anonimizada_em as string | null) ?? null),
        },
        (jornadas ?? []).map((j) => ({
          etapa: String((j as { etapa: string }).etapa),
          desfecho: String((j as { desfecho: string }).desfecho),
        })),
      ),
    };

    return NextResponse.json(inventario);
  } catch (erro) {
    return respostaErro("api/admin/titulares/inventario GET", erro);
  }
}
