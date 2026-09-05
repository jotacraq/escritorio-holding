import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Contexto do Agente do Croqui (a IA pós-Sessão de Viabilidade). Diferente do
 * Briefing (§4.3), esta IA PRECISA de valores reais de patrimônio para propor
 * arquitetura e economia — é o próprio trabalho dela. Mesmo assim é allowlist,
 * não `select *`: nunca inclui CPF, endereço completo ou conteúdo de documento
 * (IR, contrato social) — só os campos estruturados já registrados na ficha.
 * A transcrição da SV é recebida no corpo do request (nunca lida do banco: não
 * fica persistida fora do necessário) e passada adiante como está.
 */
export interface ContextoAnaliseCroqui {
  pessoa: {
    nome: string;
    cidade: string | null;
    uf: string | null;
    profissao: string | null;
    estado_civil: string | null;
  };
  familiares: Array<{
    parentesco: string;
    nome: string | null;
    idade: number | null;
    ocupacao: string | null;
    regime_casamento: string | null;
    dependente_financeiro: boolean | null;
  }>;
  patrimonio: Array<{
    tipo: string;
    descricao: string;
    valor_historico: number | null;
    valor_mercado: number | null;
    destinacao: string | null;
    valor_locacao_mensal: number | null;
    detalhes: Record<string, unknown>;
  }>;
  formulario: Record<string, unknown> | null;
  ligacao: Record<string, unknown> | null;
  relatorio_sessao: Record<string, unknown> | null;
  /**
   * Cenário Patrimonial (0057, agente D — `vw_cenarios_totais`): TOTAL por
   * cenário, e só quando nenhuma rubrica está `ausente` (a view devolve null
   * caso contrário). São números DIGITADOS pela advogada (ou multiplicados de
   * base × alíquota que ela digitou) — a IA recebe para escrever "economia"
   * como DIFERENÇA entre dois totais e nada mais; nunca calcula imposto nem
   * inventa alíquota (B26). `null` = view ainda não existe ou nada foi
   * digitado: o slide "economia" vira ponto a validar.
   */
  cenario: Array<{ cenario: string; total: number | null; rubricas_ausentes: number }> | null;
  transcricao_sessao: string;
}

/**
 * Leitura TOLERANTE de `vw_cenarios_totais`: a view é da 0057 (agente D, mesma
 * onda) e pode não existir neste banco ainda. Tabela/view ausente → `null`,
 * nunca erro — o croqui continua saindo sem o cenário, como hoje.
 */
export async function lerCenarioTolerante(
  supabase: SupabaseClient,
  jornadaId: string,
): Promise<ContextoAnaliseCroqui["cenario"]> {
  const { data, error } = await supabase
    .from("vw_cenarios_totais")
    .select("cenario, total, rubricas_ausentes")
    .eq("jornada_id", jornadaId);
  if (error || !data) return null;
  const linhas = data as Array<{ cenario: string; total: number | string | null; rubricas_ausentes: number | string | null }>;
  if (linhas.length === 0) return null;
  return linhas.map((l) => ({
    cenario: l.cenario,
    total: l.total == null ? null : Number(l.total),
    rubricas_ausentes: Number(l.rubricas_ausentes ?? 0),
  }));
}

export async function montarContextoAnaliseCroqui(
  supabaseAdmin: SupabaseClient,
  params: { jornadaId: string; pessoaId: string; transcricaoSessao: string },
): Promise<ContextoAnaliseCroqui> {
  const { jornadaId, pessoaId, transcricaoSessao } = params;

  const [pessoaRes, familiaresRes, patrimonioRes, formularioRes, ligacaoRes, sessaoRes, cenario] = await Promise.all([
    supabaseAdmin
      .from("pessoas")
      .select("nome, cidade, uf, profissao, estado_civil")
      .eq("id", pessoaId)
      .maybeSingle(),
    supabaseAdmin
      .from("familiares")
      .select("parentesco, nome, idade, ocupacao, regime_casamento, dependente_financeiro")
      .eq("pessoa_id", pessoaId),
    supabaseAdmin
      .from("patrimonio_itens")
      .select("tipo, descricao, valor_historico, valor_mercado, destinacao, valor_locacao_mensal, detalhes")
      .eq("pessoa_id", pessoaId),
    supabaseAdmin.from("formularios_respostas").select("respostas").eq("jornada_id", jornadaId).maybeSingle(),
    supabaseAdmin
      .from("ligacoes_estrategicas")
      .select("respostas, expectativa_principal, preocupacao_principal, processo_decisorio")
      .eq("jornada_id", jornadaId)
      .order("realizada_em", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("sessoes_viabilidade")
      .select("id, relatorios_sessao(*)")
      .eq("jornada_id", jornadaId)
      .maybeSingle(),
    lerCenarioTolerante(supabaseAdmin, jornadaId),
  ]);

  const pessoa = pessoaRes.data as
    | { nome: string; cidade: string | null; uf: string | null; profissao: string | null; estado_civil: string | null }
    | null;

  if (!pessoa) {
    throw new Error(`pessoa_nao_encontrada_para_jornada: ${jornadaId}`);
  }

  const relatorioBruto = sessaoRes.data as { relatorios_sessao?: Record<string, unknown> | Record<string, unknown>[] } | null;
  const relatorio = Array.isArray(relatorioBruto?.relatorios_sessao)
    ? (relatorioBruto?.relatorios_sessao[0] ?? null)
    : (relatorioBruto?.relatorios_sessao ?? null);

  return {
    pessoa: {
      nome: pessoa.nome,
      cidade: pessoa.cidade,
      uf: pessoa.uf,
      profissao: pessoa.profissao,
      estado_civil: pessoa.estado_civil,
    },
    familiares: (familiaresRes.data ?? []) as ContextoAnaliseCroqui["familiares"],
    patrimonio: (patrimonioRes.data ?? []) as ContextoAnaliseCroqui["patrimonio"],
    formulario: (formularioRes.data as { respostas: Record<string, unknown> } | null)?.respostas ?? null,
    ligacao: (ligacaoRes.data as Record<string, unknown> | null) ?? null,
    relatorio_sessao: relatorio,
    cenario,
    transcricao_sessao: transcricaoSessao,
  };
}
