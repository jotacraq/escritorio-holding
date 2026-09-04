export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { createHash } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirVePatrimonio } from "@/server/auth";
import { erroNaoEncontrado, respostaErro } from "@/server/erros";
import { proximaVersaoArquivoOrigem } from "@/server/croqui/transcricao";

const ParametroSchema = z.object({ id: z.string().uuid() });

// Mesmo mínimo de `POST /api/croquis/[id]/analise`: a Agente do Croqui não
// deve rodar sobre um trecho curto e "alucinar" o resto — aqui o motivo é o
// mesmo, aplicado um passo antes, na persistência.
const CorpoSchema = z.object({
  conteudo: z.string().min(200, "conteudo muito curto para ser uma transcrição de sessão"),
});

interface SessaoLookup {
  id: string;
  jornada_id: string;
  realizada_em: string | null;
}

interface TranscricaoRow {
  id: string;
  arquivo_origem: string;
  tamanho_bytes: number;
  sha256: string;
  importado_em: string;
}

async function buscarSessaoOuFalhar(supabase: SupabaseClient, sessaoId: string): Promise<SessaoLookup> {
  const { data, error } = await supabase
    .from("sessoes_viabilidade")
    .select("id, jornada_id, realizada_em")
    .eq("id", sessaoId)
    .maybeSingle<SessaoLookup>();
  if (error) throw error;
  if (!data) throw erroNaoEncontrado("Sessão de Viabilidade não encontrada.");
  return data;
}

/**
 * Nome do cliente da sessão para o `rotulo` (mesmo campo que o Módulo 4 usa
 * para as 70 transcrições históricas, 0032) — PII, guardado como cadastrado,
 * nunca inventado. `jornadas`/`pessoas` são `eh_interno()` para SELECT
 * (0003), e quem chega aqui já passou por `exigirVePatrimonio` (subconjunto).
 */
async function buscarNomePessoaDaJornada(supabase: SupabaseClient, jornadaId: string): Promise<string | null> {
  const { data: jornada, error: erroJornada } = await supabase
    .from("jornadas")
    .select("pessoa_id")
    .eq("id", jornadaId)
    .maybeSingle<{ pessoa_id: string }>();
  if (erroJornada) throw erroJornada;
  if (!jornada) return null;

  const { data: pessoa, error: erroPessoa } = await supabase
    .from("pessoas")
    .select("nome")
    .eq("id", jornada.pessoa_id)
    .maybeSingle<{ nome: string }>();
  if (erroPessoa) throw erroPessoa;
  return pessoa?.nome ?? null;
}

/**
 * Insere a transcrição com o `arquivo_origem` sintético (`sessao:<id>:v<n>`).
 * `arquivo_origem` e `sha256` são `unique` (0032) — duas travas de
 * idempotência diferentes:
 *   - colisão em `sha256`: o MESMO texto já foi persistido antes (em
 *     qualquer versão) → devolve a linha existente, não duplica;
 *   - colisão em `arquivo_origem`: duas requisições concorrentes calcularam
 *     a mesma próxima versão → recalcula e tenta de novo (até 3x).
 */
async function inserirTranscricaoComRetentativa(
  supabase: SupabaseClient,
  sessaoId: string,
  base: {
    tipo: "sessao_viabilidade";
    rotulo: string;
    data_reuniao: string | null;
    jornada_id: string;
    conteudo: string;
    tamanho_bytes: number;
    sha256: string;
  },
): Promise<{ linha: TranscricaoRow; jaExistia: boolean }> {
  const MAX_TENTATIVAS = 3;

  for (let tentativa = 0; tentativa < MAX_TENTATIVAS; tentativa++) {
    const { data: existentes, error: erroExistentes } = await supabase
      .from("transcricoes")
      .select("arquivo_origem")
      .like("arquivo_origem", `sessao:${sessaoId}:v%`);
    if (erroExistentes) throw erroExistentes;

    const arquivoOrigem = proximaVersaoArquivoOrigem(
      sessaoId,
      (existentes ?? []).map((linha) => linha.arquivo_origem as string),
    );

    const { data: inserida, error: erroInsercao } = await supabase
      .from("transcricoes")
      .insert({ ...base, arquivo_origem: arquivoOrigem })
      .select("id, arquivo_origem, tamanho_bytes, sha256, importado_em")
      .single<TranscricaoRow>();

    if (!erroInsercao && inserida) {
      return { linha: inserida, jaExistia: false };
    }

    if (erroInsercao?.code === "23505") {
      if (erroInsercao.message.includes("sha256")) {
        const { data: existente, error: erroExistente } = await supabase
          .from("transcricoes")
          .select("id, arquivo_origem, tamanho_bytes, sha256, importado_em")
          .eq("sha256", base.sha256)
          .single<TranscricaoRow>();
        if (erroExistente || !existente) {
          throw erroExistente ?? new Error("falha_ao_buscar_transcricao_existente");
        }
        return { linha: existente, jaExistia: true };
      }
      // Colisão em arquivo_origem (corrida entre requisições concorrentes) — tenta de novo.
      continue;
    }

    throw erroInsercao ?? new Error("falha_ao_persistir_transcricao");
  }

  throw new Error("falha_ao_persistir_transcricao_apos_retentativas");
}

/**
 * GET /api/sessoes/[id]/transcricao — a transcrição da SV mais recente
 * persistida para esta sessão (para a aba "Análise da Sessão", U4, ver/editar
 * antes de rodar a análise) + quantas versões já existem.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await exigirVePatrimonio();
    const { id: sessaoId } = ParametroSchema.parse(await context.params);

    const supabase = await criarClienteServidor();
    const sessao = await buscarSessaoOuFalhar(supabase, sessaoId);

    const { data: versoes, error: erroVersoes } = await supabase
      .from("transcricoes")
      .select("id, conteudo, tamanho_bytes, sha256, importado_em, arquivo_origem")
      .eq("jornada_id", sessao.jornada_id)
      .eq("tipo", "sessao_viabilidade")
      .order("importado_em", { ascending: false });
    if (erroVersoes) throw erroVersoes;

    const mais_recente = versoes?.[0] ?? null;

    return NextResponse.json({
      transcricao: mais_recente,
      total_versoes: versoes?.length ?? 0,
    });
  } catch (erro) {
    return respostaErro("GET /api/sessoes/[id]/transcricao", erro);
  }
}

/**
 * POST /api/sessoes/[id]/transcricao — persiste a transcrição da Sessão de
 * Viabilidade (ARQUITETURA-FASE-3.md §2.2). Diferente da Análise (que exige
 * `tem_consentimento(pessoa,'tratamento_ia')`), PERSISTIR não exige
 * consentimento: é dado do escritório, em banco do escritório, sob RLS —
 * mesma posição do C14 para as 70 transcrições do Módulo 4. Só ANALISAR
 * (`gerarAnaliseCroqui`) exige.
 *
 * Usa o cliente com SESSÃO (não service_role): a policy `tr_ins_sessao`
 * (0045) é quem decide se a advogada pode inserir — a regra de negócio vive
 * no `with check` do banco, não só aqui na rota (lição do ALTO 1 do pentest
 * da Fase 2).
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await exigirVePatrimonio();
    const { id: sessaoId } = ParametroSchema.parse(await context.params);
    const corpo = CorpoSchema.parse(await request.json());

    const supabase = await criarClienteServidor();
    const sessao = await buscarSessaoOuFalhar(supabase, sessaoId);
    const nomePessoa = await buscarNomePessoaDaJornada(supabase, sessao.jornada_id);

    const { linha, jaExistia } = await inserirTranscricaoComRetentativa(supabase, sessaoId, {
      tipo: "sessao_viabilidade",
      rotulo: nomePessoa ? `Sessão de Viabilidade — ${nomePessoa}` : "Sessão de Viabilidade",
      data_reuniao: sessao.realizada_em ? sessao.realizada_em.slice(0, 10) : null,
      jornada_id: sessao.jornada_id,
      conteudo: corpo.conteudo,
      tamanho_bytes: Buffer.byteLength(corpo.conteudo, "utf-8"),
      sha256: createHash("sha256").update(corpo.conteudo, "utf-8").digest("hex"),
    });

    return NextResponse.json({ transcricao: linha, ja_existia: jaExistia }, { status: jaExistia ? 200 : 201 });
  } catch (erro) {
    return respostaErro("POST /api/sessoes/[id]/transcricao", erro);
  }
}
