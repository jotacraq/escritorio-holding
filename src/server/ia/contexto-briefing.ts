import type { SupabaseClient } from "@supabase/supabase-js";
import { temConsentimento } from "./consentimento";

/**
 * Contexto que entra no prompt do Briefing Estratégico — ARQUITETURA.md §4.3.
 * ALLOWLIST, nunca denylist: só os campos abaixo saem para a Anthropic. Nunca
 * entram, em hipótese nenhuma: CPF/RG, endereço completo, dados bancários, valor
 * absoluto de patrimônio (só faixa), conteúdo de documento, anexos, ou dado de
 * fonte pública sobre terceiros.
 */
export interface ContextoBriefing {
  identificacao: {
    primeiro_nome: string;
    faixa_etaria: string | null;
    estado_civil: string | null;
    cidade: string | null;
    uf: string | null;
    profissao: string | null;
  };
  origem: {
    trilha: string;
    edicao_codigo: string | null;
    origem: string;
  };
  formulario: Record<string, unknown> | null;
  patrimonio: {
    faixa_declarada: string | null;
    tipos_de_bem: string[];
    quantidade_imoveis_faixa: string;
  };
  familia: {
    quantidade_filhos: number;
    todos_maiores: boolean;
    ha_dependente: boolean;
    participantes_da_sessao: string[]; // parentesco, nunca nome — minimiza PII de terceiros
  };
  ligacao: {
    respostas: Record<string, unknown> | null;
    expectativa_principal: string | null;
    preocupacao_principal: string | null;
    assunto_atencao_especial: string | null;
    objecoes_percebidas: string[];
    pessoas_mencionadas: string[];
    ritmo: string | null;
    estilo_resposta: string | null;
    sinais: string[];
    frases_marcantes: string[];
    processo_decisorio: string | null;
    decisores_presentes_na_sessao: boolean | null;
  } | null;
  transcricao: string | null; // só presente se app.tem_consentimento(pessoa,'tratamento_ia')
}

export interface MontagemContexto {
  contexto: ContextoBriefing;
  fontesUsadas: string[];
  modoReduzido: boolean;
}

/**
 * MÉDIO 1 (pentest 03/09/2026): `formulario` copiava o JSONB inteiro de
 * `respostas` para o contexto da IA. `p1` é literalmente "Qual seu nome
 * completo?" — o mesmo dado que a linha de baixo (primeiroNome) faz questão de
 * truncar. `p2` ("cidade e estado") já está coberto por `identificacao`. A
 * allowlist do §4.3 vale para o CONTEÚDO, não só para o nome do campo de topo
 * — por isso filtramos por chave de pergunta, não por chave do objeto.
 */
const CHAVES_FORMULARIO_EXCLUIDAS = new Set(["p1", "p2"]);

function filtrarRespostasFormulario(
  respostas: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!respostas) return null;
  const filtradas = Object.fromEntries(
    Object.entries(respostas).filter(([chave]) => !CHAVES_FORMULARIO_EXCLUIDAS.has(chave)),
  );
  return Object.keys(filtradas).length > 0 ? filtradas : null;
}

function bucketQuantidadeImoveis(qtd: number): string {
  if (qtd <= 0) return "0";
  if (qtd <= 2) return "1-2";
  if (qtd <= 5) return "3-5";
  return "6+";
}

export async function montarContextoBriefing(
  supabaseAdmin: SupabaseClient,
  jornadaId: string,
): Promise<MontagemContexto> {
  const { data: jornada, error: erroJornada } = await supabaseAdmin
    .from("jornadas")
    .select("id, pessoa_id, trilha, origem, edicao_id, faixa_patrimonio_declarada")
    .eq("id", jornadaId)
    .maybeSingle();

  if (erroJornada || !jornada) {
    throw new Error(`jornada_nao_encontrada: ${jornadaId}`);
  }

  const [pessoaRes, edicaoRes, formularioRes, familiaresRes, patrimonioRes, ligacaoRes] =
    await Promise.all([
      supabaseAdmin
        .from("pessoas")
        .select("nome, cidade, uf, profissao, faixa_etaria, estado_civil")
        .eq("id", jornada.pessoa_id)
        .maybeSingle(),
      jornada.edicao_id
        ? supabaseAdmin.from("edicoes_seminario").select("codigo").eq("id", jornada.edicao_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabaseAdmin
        .from("formularios_respostas")
        .select("respostas")
        .eq("jornada_id", jornadaId)
        .maybeSingle(),
      supabaseAdmin
        .from("familiares")
        .select("parentesco, idade, dependente_financeiro")
        .eq("pessoa_id", jornada.pessoa_id),
      supabaseAdmin
        .from("patrimonio_itens")
        .select("tipo")
        .eq("pessoa_id", jornada.pessoa_id),
      supabaseAdmin
        .from("ligacoes_estrategicas")
        .select(
          "respostas, expectativa_principal, preocupacao_principal, assunto_atencao_especial, " +
            "objecoes_percebidas, pessoas_mencionadas, ritmo, estilo_resposta, sinais, " +
            "frases_marcantes, processo_decisorio, decisores_presentes_na_sessao, transcricao",
        )
        .eq("jornada_id", jornadaId)
        .order("realizada_em", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const pessoa = pessoaRes.data as
    | { nome: string; cidade: string | null; uf: string | null; profissao: string | null; faixa_etaria: string | null; estado_civil: string | null }
    | null;
  const familiares = (familiaresRes.data ?? []) as Array<{
    parentesco: string;
    idade: number | null;
    dependente_financeiro: boolean | null;
  }>;
  const patrimonioItens = (patrimonioRes.data ?? []) as Array<{ tipo: string }>;
  const ligacao = ligacaoRes.data as
    | {
        respostas: Record<string, unknown> | null;
        expectativa_principal: string | null;
        preocupacao_principal: string | null;
        assunto_atencao_especial: string | null;
        objecoes_percebidas: string[] | null;
        pessoas_mencionadas: string[] | null;
        ritmo: string | null;
        estilo_resposta: string | null;
        sinais: string[] | null;
        frases_marcantes: string[] | null;
        processo_decisorio: string | null;
        decisores_presentes_na_sessao: boolean | null;
        transcricao: string | null;
      }
    | null;

  const fontesUsadas: string[] = [];
  if (formularioRes.data) fontesUsadas.push("formulario");
  if (ligacao) fontesUsadas.push("ligacao_observacoes");
  if (jornada.faixa_patrimonio_declarada || patrimonioItens.length > 0) fontesUsadas.push("patrimonio_faixa");

  let transcricao: string | null = null;
  let modoReduzido = true;
  if (ligacao?.transcricao) {
    const consentiu = await temConsentimento(supabaseAdmin, jornada.pessoa_id, "tratamento_ia");
    if (consentiu) {
      transcricao = ligacao.transcricao;
      modoReduzido = false;
      fontesUsadas.push("transcricao");
    }
  }

  const primeiroNome = (pessoa?.nome ?? "").trim().split(/\s+/)[0] ?? "";

  const contexto: ContextoBriefing = {
    identificacao: {
      primeiro_nome: primeiroNome,
      faixa_etaria: pessoa?.faixa_etaria ?? null,
      estado_civil: pessoa?.estado_civil ?? null,
      cidade: pessoa?.cidade ?? null,
      uf: pessoa?.uf ?? null,
      profissao: pessoa?.profissao ?? null,
    },
    origem: {
      trilha: jornada.trilha,
      edicao_codigo: (edicaoRes.data as { codigo: string } | null)?.codigo ?? null,
      origem: jornada.origem,
    },
    formulario: filtrarRespostasFormulario(
      (formularioRes.data as { respostas: Record<string, unknown> } | null)?.respostas ?? null,
    ),
    patrimonio: {
      faixa_declarada: jornada.faixa_patrimonio_declarada ?? null,
      tipos_de_bem: Array.from(new Set(patrimonioItens.map((item) => item.tipo))),
      quantidade_imoveis_faixa: bucketQuantidadeImoveis(
        patrimonioItens.filter((item) => item.tipo === "imovel").length,
      ),
    },
    familia: {
      quantidade_filhos: familiares.filter((f) => f.parentesco === "filho").length,
      todos_maiores: familiares.length === 0 || familiares.every((f) => (f.idade ?? 18) >= 18),
      ha_dependente: familiares.some((f) => f.dependente_financeiro === true),
      participantes_da_sessao: familiares
        .filter((f) => f.dependente_financeiro !== true)
        .map((f) => f.parentesco),
    },
    ligacao: ligacao
      ? {
          respostas: ligacao.respostas ?? null,
          expectativa_principal: ligacao.expectativa_principal,
          preocupacao_principal: ligacao.preocupacao_principal,
          assunto_atencao_especial: ligacao.assunto_atencao_especial,
          objecoes_percebidas: ligacao.objecoes_percebidas ?? [],
          pessoas_mencionadas: ligacao.pessoas_mencionadas ?? [],
          ritmo: ligacao.ritmo,
          estilo_resposta: ligacao.estilo_resposta,
          sinais: ligacao.sinais ?? [],
          frases_marcantes: ligacao.frases_marcantes ?? [],
          processo_decisorio: ligacao.processo_decisorio,
          decisores_presentes_na_sessao: ligacao.decisores_presentes_na_sessao,
        }
      : null,
    transcricao,
  };

  return { contexto, fontesUsadas, modoReduzido };
}
