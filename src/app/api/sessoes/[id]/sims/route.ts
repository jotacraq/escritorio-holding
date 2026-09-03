export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno } from "@/server/auth";
import { erroNaoEncontrado, erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import type { ConsentimentoGravacao, SessaoViabilidadeComRoteiro } from "@/types/roteiro";

const ParametroSchema = z.object({ id: z.string().uuid() });

interface SessaoLookup {
  id: string;
  jornada_id: string;
  roteiro_versao_id: string | null;
  sims: SessaoViabilidadeComRoteiro["sims"];
}

/** Uma query só — evita duas idas ao banco para GET/POST pedirem colunas
 * diferentes da mesma linha. */
async function buscarSessaoOuFalhar(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  sessaoId: string,
): Promise<SessaoLookup> {
  const { data, error } = await supabase
    .from("sessoes_viabilidade")
    .select("id, jornada_id, roteiro_versao_id, sims")
    .eq("id", sessaoId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw erroNaoEncontrado("Sessão de Viabilidade não encontrada.");
  return data as SessaoLookup;
}

/**
 * Busca o consentimento de gravação MAIS RECENTE da pessoa da jornada. Não há
 * vínculo direto `consentimentos -> sessao_id` (a tabela é por PESSOA, 0005) —
 * pegar o mais recente é a mesma regra de "vigente" que `app.tem_consentimento`
 * usa no banco (0005), só que em SQL de leitura simples aqui.
 */
async function buscarConsentimentoGravacaoMaisRecente(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  jornadaId: string,
): Promise<ConsentimentoGravacao | null> {
  const { data: jornada, error: erroJornada } = await supabase
    .from("jornadas")
    .select("pessoa_id")
    .eq("id", jornadaId)
    .maybeSingle();
  if (erroJornada) throw erroJornada;
  if (!jornada) return null;

  const { data, error } = await supabase
    .from("consentimentos")
    .select("id, pessoa_id, concedido, texto_apresentado, versao_texto, canal, registrado_por, concedido_em")
    .eq("pessoa_id", (jornada as { pessoa_id: string }).pessoa_id)
    .eq("tipo", "gravacao_sessao")
    .order("concedido_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as ConsentimentoGravacao | null) ?? null;
}

/**
 * GET /api/sessoes/[id]/sims — estado atual dos 4 SIMs: os 3 de condução
 * (`sessoes_viabilidade.sims`) + o 1º (consentimento de gravação), lido de
 * `consentimentos` para a tela não precisar de uma segunda chamada.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirInterno();
    const { id: sessaoId } = ParametroSchema.parse(await params);

    const supabase = await criarClienteServidor();
    const sessao = await buscarSessaoOuFalhar(supabase, sessaoId);
    const consentimentoGravacao = await buscarConsentimentoGravacaoMaisRecente(supabase, sessao.jornada_id);

    return NextResponse.json({
      roteiro_versao_id: sessao.roteiro_versao_id,
      sims: sessao.sims,
      sigilo_gravacao: consentimentoGravacao,
    });
  } catch (erro) {
    return respostaErro("api/sessoes/[id]/sims GET", erro);
  }
}

const CorpoSchema = z.object({
  sim: z.enum(["sigilo_gravacao", "licitude", "decisores", "proximo_passo"]),
  confirmado: z.boolean(),
});

interface ErroPostgrest {
  message: string;
}

/**
 * POST /api/sessoes/[id]/sims — única porta de escrita dos 4 SIMs. Chama
 * `public.registrar_sim_sessao` (0030): o TEXTO do 1º SIM vem do roteiro
 * ativo da sessão (nunca é aceito neste corpo — ver BLOQUEIO B3, "não amplie
 * o texto por conta própria"). Para `sim=sigilo_gravacao`, a rota busca o
 * consentimento recém-gravado para devolver junto (a função retorna só a
 * sessão — ver NOTA na migration sobre por que não misturar dois tipos de
 * linha num retorno composto).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirInterno();
    const { id: sessaoId } = ParametroSchema.parse(await params);
    const corpo = CorpoSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    const supabase = await criarClienteServidor();
    const sessaoAntes = await buscarSessaoOuFalhar(supabase, sessaoId);

    const { data: sessao, error } = await supabase
      .rpc("registrar_sim_sessao", {
        p_sessao_id: sessaoId,
        p_sim: corpo.sim,
        p_confirmado: corpo.confirmado,
      })
      .single<SessaoViabilidadeComRoteiro>();

    if (error) {
      const pg = error as ErroPostgrest;
      if (pg.message.startsWith("sessao_nao_encontrada")) {
        throw erroNaoEncontrado("Sessão de Viabilidade não encontrada.");
      }
      if (pg.message.startsWith("roteiro_nao_configurado") || pg.message.startsWith("texto_consentimento_nao_encontrado")) {
        registrarErro("api/sessoes/[id]/sims POST#roteiro_ausente", error, { sessao_id: sessaoId });
        return NextResponse.json(
          {
            erro: "roteiro_nao_configurado",
            mensagem:
              "Não há roteiro ativo com o 1º SIM configurado — registre a versão do roteiro antes de confirmar sigilo e gravação.",
          },
          { status: 409 },
        );
      }
      registrarErro("api/sessoes/[id]/sims POST", error, { sessao_id: sessaoId, sim: corpo.sim });
      throw error;
    }

    let sigiloGravacao: ConsentimentoGravacao | null = null;
    if (corpo.sim === "sigilo_gravacao") {
      sigiloGravacao = await buscarConsentimentoGravacaoMaisRecente(supabase, sessaoAntes.jornada_id);
    }

    return NextResponse.json({ sessao, sigilo_gravacao: sigiloGravacao });
  } catch (erro) {
    return respostaErro("api/sessoes/[id]/sims POST", erro);
  }
}
