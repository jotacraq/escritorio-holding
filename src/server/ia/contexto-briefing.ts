import type { SupabaseClient } from "@supabase/supabase-js";
import { temConsentimento } from "./consentimento";
import type { SinaisCompletude } from "./completude";

/**
 * Contexto que entra no prompt do Briefing Estratégico — ARQUITETURA.md §4.3.
 * ALLOWLIST, nunca denylist: só os campos abaixo saem para a Anthropic. Nunca
 * entram, em hipótese nenhuma: CPF/RG, endereço completo, dados bancários, valor
 * absoluto de patrimônio (só faixa), conteúdo de documento, anexos, ou dado de
 * fonte pública sobre terceiros.
 *
 * Fase 4 (ARQUITETURA-FASE-4.md §5, "modelo do Juliano" — todas as fontes):
 * ganha `seminario` (respostas das pesquisas + dias assistidos), `empresas`
 * (cadastro público de CNPJ já consultado, 0044) e `ligacao_ia` (resumo/
 * transcrição da ligação por IA, 0053). `pesquisas_publicas` NÃO entra —
 * `check (entra_no_briefing = false)` da 0036 (BLOQUEIO B4); nenhum código
 * aqui lê essa tabela. Nenhuma chamada de IA nova: é a MESMA execução com
 * contexto maior (custo: §5.3, medido pela bancada em `bytesContexto`).
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
    /** L7: só as chaves que NÃO duplicam um campo nomeado abaixo (bytes à toa fora). */
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
  /**
   * Seminário: o que a pessoa respondeu nas pesquisas (importadas via
   * `respostas_seminario`, 0059) e quantos dias assistiu. Até 12 respostas,
   * 400 caracteres cada. `null` quando não há nada — nunca lista vazia
   * fingindo fonte.
   */
  seminario: {
    edicao_codigo: string | null;
    dias_assistidos: number | null;
    respostas: Array<{ pergunta: string; resposta: string }>;
  } | null;
  /**
   * Cadastro PÚBLICO de empresa (Receita Federal via BrasilAPI, `consultas_cnpj`),
   * ligado à pessoa por `patrimonio_itens.detalhes->>'cnpj'`. Capital em FAIXA,
   * nunca valor. `socios` (nomes do QSA — pessoa física de terceiro, B21) só
   * sob `tratamento_ia`; sem consentimento vai só a quantidade.
   */
  empresas: Array<{
    razao_social: string | null;
    cnae_descricao: string | null;
    capital_social_faixa: string | null;
    situacao: string | null;
    socios_quantidade: number;
    socios?: string[];
  }>;
  /**
   * Ligação por IA (F2, `ligacoes_ia` — tabela do agente B, carregada de forma
   * TOLERANTE: ausente → null). `transcricao` na MESMA posição da transcrição
   * humana: só sob `tratamento_ia`. Sem exceção nova de LGPD (B33).
   */
  ligacao_ia: {
    resultado: string | null;
    resumo: string | null;
    transcricao: string | null;
    transcricao_truncada: boolean;
  } | null;
}

export interface MontagemContexto {
  contexto: ContextoBriefing;
  fontesUsadas: string[];
  modoReduzido: boolean;
  /**
   * Sinais para a porta de completude (L4, ARQUITETURA-FASE-3.md §1.7) — dos
   * MESMOS dados já buscados acima, zero query nova. `calcularCompletude()`
   * (completude.ts) aplica os pesos de `configuracoes.ia.completude_pesos`.
   */
  sinaisCompletude: SinaisCompletude;
}

export interface OpcoesContextoBriefing {
  /**
   * `false` = monta o contexto como ANTES da Fase 4 (sem seminário, CNPJ,
   * ligação IA e sem o L7). Só a bancada usa, para medir bytes antes/depois
   * sem chamar IA. Produção sempre `true`.
   */
  fontesEstendidas?: boolean;
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

/** Tetos de entrada (custo, §5.3): o que passa disso é cortado, nunca resumido por IA. */
const SEMINARIO_MAX_RESPOSTAS = 12;
const SEMINARIO_MAX_CHARS_RESPOSTA = 400;
const SEMINARIO_MAX_CHARS_PERGUNTA = 200;
const EMPRESAS_MAX = 5;
const LIGACAO_IA_MAX_CHARS_RESUMO = 1500;
const LIGACAO_IA_MAX_CHARS_TRANSCRICAO = 6000;

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

/** Capital social em faixa — nunca o valor (mesma regra de patrimônio: só faixa sai para a IA). */
function faixaCapitalSocial(valor: number | string | null): string | null {
  if (valor == null) return null;
  const n = Number(valor);
  if (!Number.isFinite(n)) return null;
  if (n < 100_000) return "ate_100k";
  if (n < 1_000_000) return "100k_a_1M";
  if (n < 10_000_000) return "1M_a_10M";
  return "acima_de_10M";
}

function cortar(texto: string | null | undefined, max: number): string | null {
  if (!texto) return null;
  const limpo = texto.trim();
  if (limpo.length === 0) return null;
  return limpo.length > max ? limpo.slice(0, max) : limpo;
}

/**
 * L7 (Fase 3): `ligacoes_estrategicas.respostas` repete, em texto livre, o que
 * as colunas nomeadas já carregam (expectativa, preocupação, frases…). Sai
 * toda entrada cujo VALOR já aparece num campo nomeado — comparação por valor,
 * não por nome de chave, porque as chaves do JSONB são as do POP 03 e não
 * batem com o nome das colunas.
 */
function deduplicarRespostasLigacao(
  respostas: Record<string, unknown> | null,
  valoresNomeados: unknown[],
): Record<string, unknown> | null {
  if (!respostas) return null;
  const vistos = new Set<string>();
  for (const v of valoresNomeados) {
    if (typeof v === "string" && v.trim()) vistos.add(v.trim().toLowerCase());
    if (Array.isArray(v)) for (const item of v) if (typeof item === "string" && item.trim()) vistos.add(item.trim().toLowerCase());
  }
  const filtradas = Object.fromEntries(
    Object.entries(respostas).filter(([, valor]) => {
      if (typeof valor === "string") return !vistos.has(valor.trim().toLowerCase());
      if (Array.isArray(valor)) return !valor.every((item) => typeof item === "string" && vistos.has(item.trim().toLowerCase()));
      return true;
    }),
  );
  return Object.keys(filtradas).length > 0 ? filtradas : null;
}

/**
 * Consulta que pode falhar porque a TABELA ainda não existe neste banco
 * (0053 do agente B, 0059 deste agente — migrations da mesma onda, aplicadas
 * pelo orquestrador em ordem). Ausência de tabela é `data: null`, nunca erro:
 * o briefing continua saindo com as fontes que existem.
 */
async function consultarTolerante<T>(consulta: PromiseLike<{ data: T | null; error: unknown }>): Promise<T | null> {
  try {
    const { data, error } = await consulta;
    return error ? null : data;
  } catch {
    return null;
  }
}

interface LinhaRespostaSeminario {
  pergunta: string;
  resposta: string;
}
interface LinhaLigacaoIa {
  resultado: string | null;
  resumo: string | null;
  transcricao: string | null;
}
interface LinhaConsultaCnpj {
  cnpj: string;
  razao_social: string | null;
  cnae_descricao: string | null;
  capital_social: number | string | null;
  situacao: string | null;
  qsa: unknown;
}

function nomesDoQsa(qsa: unknown): string[] {
  if (!Array.isArray(qsa)) return [];
  return qsa
    .map((s) => (s && typeof s === "object" ? (s as { nome_socio?: unknown; nome?: unknown }) : null))
    .map((s) => (typeof s?.nome_socio === "string" ? s.nome_socio : typeof s?.nome === "string" ? s.nome : null))
    .filter((n): n is string => Boolean(n && n.trim()));
}

export async function montarContextoBriefing(
  supabaseAdmin: SupabaseClient,
  jornadaId: string,
  opcoes: OpcoesContextoBriefing = {},
): Promise<MontagemContexto> {
  const fontesEstendidas = opcoes.fontesEstendidas ?? true;

  const { data: jornada, error: erroJornada } = await supabaseAdmin
    .from("jornadas")
    .select("id, pessoa_id, trilha, origem, edicao_id, faixa_patrimonio_declarada")
    .eq("id", jornadaId)
    .maybeSingle();

  if (erroJornada || !jornada) {
    throw new Error(`jornada_nao_encontrada: ${jornadaId}`);
  }

  const [pessoaRes, edicaoRes, formularioRes, familiaresRes, patrimonioRes, ligacaoRes, participacao, respostasSeminario, ligacaoIa] =
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
        .select("tipo, detalhes")
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
      // --- Fase 4: fontes novas (todas tolerantes; `fontesEstendidas=false` pula) ---
      fontesEstendidas && jornada.edicao_id
        ? consultarTolerante<{ dias_assistidos: number | null }>(
            supabaseAdmin
              .from("participacoes_seminario")
              .select("dias_assistidos")
              .eq("pessoa_id", jornada.pessoa_id)
              .eq("edicao_id", jornada.edicao_id)
              .maybeSingle(),
          )
        : Promise.resolve(null),
      fontesEstendidas
        ? consultarTolerante<LinhaRespostaSeminario[]>(
            supabaseAdmin
              .from("respostas_seminario")
              .select("pergunta, resposta")
              .eq("pessoa_id", jornada.pessoa_id)
              .order("criado_em", { ascending: true })
              .limit(SEMINARIO_MAX_RESPOSTAS),
          )
        : Promise.resolve(null),
      fontesEstendidas
        ? consultarTolerante<LinhaLigacaoIa>(
            supabaseAdmin
              .from("ligacoes_ia")
              .select("resultado, resumo, transcricao")
              .eq("jornada_id", jornadaId)
              .eq("status", "concluida")
              .order("encerrada_em", { ascending: false, nullsFirst: false })
              .limit(1)
              .maybeSingle(),
          )
        : Promise.resolve(null),
    ]);

  const pessoa = pessoaRes.data as
    | { nome: string; cidade: string | null; uf: string | null; profissao: string | null; faixa_etaria: string | null; estado_civil: string | null }
    | null;
  const familiares = (familiaresRes.data ?? []) as Array<{
    parentesco: string;
    idade: number | null;
    dependente_financeiro: boolean | null;
  }>;
  const patrimonioItens = (patrimonioRes.data ?? []) as Array<{ tipo: string; detalhes: Record<string, unknown> | null }>;
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

  // CNPJ público (0044): só as empresas cujo CNPJ está na ficha da pessoa
  // (`patrimonio_itens.detalhes->>'cnpj'`) e que já foram consultadas com
  // sucesso (`consultado_em not null`) — este módulo NUNCA dispara consulta
  // externa; lê o cache que a Ficha já preencheu.
  const cnpjs = Array.from(
    new Set(
      patrimonioItens
        .map((item) => item.detalhes?.cnpj)
        .filter((c): c is string => typeof c === "string" && /^[0-9]{14}$/.test(c)),
    ),
  ).slice(0, EMPRESAS_MAX);
  const consultasCnpj =
    fontesEstendidas && cnpjs.length > 0
      ? await consultarTolerante<LinhaConsultaCnpj[]>(
          supabaseAdmin
            .from("consultas_cnpj")
            .select("cnpj, razao_social, cnae_descricao, capital_social, situacao, qsa")
            .in("cnpj", cnpjs)
            .not("consultado_em", "is", null),
        )
      : null;

  const fontesUsadas: string[] = [];
  if (formularioRes.data) fontesUsadas.push("formulario");
  if (ligacao) fontesUsadas.push("ligacao_observacoes");
  if (jornada.faixa_patrimonio_declarada || patrimonioItens.length > 0) fontesUsadas.push("patrimonio_faixa");

  // UMA checagem de consentimento para tudo que é PII sob `tratamento_ia`:
  // transcrição humana, transcrição da ligação IA e nomes do QSA. Só roda se
  // houver algo a proteger — zero RPC quando não há.
  const haAlgoSobConsentimento =
    Boolean(ligacao?.transcricao) ||
    Boolean(ligacaoIa?.transcricao) ||
    (consultasCnpj ?? []).some((c) => nomesDoQsa(c.qsa).length > 0);
  const consentiu = haAlgoSobConsentimento
    ? await temConsentimento(supabaseAdmin, jornada.pessoa_id, "tratamento_ia")
    : false;

  let transcricao: string | null = null;
  let modoReduzido = true;
  if (ligacao?.transcricao && consentiu) {
    transcricao = ligacao.transcricao;
    modoReduzido = false;
    fontesUsadas.push("transcricao");
  }

  const primeiroNome = (pessoa?.nome ?? "").trim().split(/\s+/)[0] ?? "";
  const edicaoCodigo = (edicaoRes.data as { codigo: string } | null)?.codigo ?? null;

  // --- Seminário ---
  const respostas = (respostasSeminario ?? [])
    .map((r) => ({
      pergunta: cortar(r.pergunta, SEMINARIO_MAX_CHARS_PERGUNTA),
      resposta: cortar(r.resposta, SEMINARIO_MAX_CHARS_RESPOSTA),
    }))
    .filter((r): r is { pergunta: string; resposta: string } => Boolean(r.pergunta && r.resposta));
  const diasAssistidos = participacao?.dias_assistidos ?? null;
  const seminario: ContextoBriefing["seminario"] =
    respostas.length > 0 || diasAssistidos != null
      ? { edicao_codigo: edicaoCodigo, dias_assistidos: diasAssistidos, respostas }
      : null;
  if (respostas.length > 0) fontesUsadas.push("seminario_respostas");
  if (diasAssistidos != null) fontesUsadas.push("seminario_participacao");

  // --- Empresas (CNPJ público) ---
  const empresas: ContextoBriefing["empresas"] = (consultasCnpj ?? []).map((c) => {
    const socios = nomesDoQsa(c.qsa);
    return {
      razao_social: c.razao_social,
      cnae_descricao: c.cnae_descricao,
      capital_social_faixa: faixaCapitalSocial(c.capital_social),
      situacao: c.situacao,
      socios_quantidade: socios.length,
      ...(consentiu && socios.length > 0 ? { socios } : {}),
    };
  });
  if (empresas.length > 0) fontesUsadas.push("cnpj");

  // --- Ligação por IA ---
  let ligacaoIaContexto: ContextoBriefing["ligacao_ia"] = null;
  if (ligacaoIa && (ligacaoIa.resumo || ligacaoIa.transcricao)) {
    const transcricaoIaCompleta = consentiu ? (ligacaoIa.transcricao?.trim() ?? "") : "";
    const transcricaoIa = transcricaoIaCompleta ? cortar(transcricaoIaCompleta, LIGACAO_IA_MAX_CHARS_TRANSCRICAO) : null;
    ligacaoIaContexto = {
      resultado: ligacaoIa.resultado,
      resumo: cortar(ligacaoIa.resumo, LIGACAO_IA_MAX_CHARS_RESUMO),
      transcricao: transcricaoIa,
      transcricao_truncada: transcricaoIaCompleta.length > LIGACAO_IA_MAX_CHARS_TRANSCRICAO,
    };
    fontesUsadas.push("ligacao_ia");
    if (transcricaoIa) fontesUsadas.push("ligacao_ia_transcricao");
  }

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
      edicao_codigo: edicaoCodigo,
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
          respostas: fontesEstendidas
            ? deduplicarRespostasLigacao(ligacao.respostas ?? null, [
                ligacao.expectativa_principal,
                ligacao.preocupacao_principal,
                ligacao.assunto_atencao_especial,
                ligacao.objecoes_percebidas,
                ligacao.pessoas_mencionadas,
                ligacao.ritmo,
                ligacao.estilo_resposta,
                ligacao.sinais,
                ligacao.frases_marcantes,
                ligacao.processo_decisorio,
              ])
            : (ligacao.respostas ?? null),
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
    seminario,
    empresas,
    ligacao_ia: ligacaoIaContexto,
  };

  const sinaisCompletude: SinaisCompletude = {
    formulario: Boolean(formularioRes.data),
    ligacao: Boolean(ligacao),
    patrimonio: Boolean(jornada.faixa_patrimonio_declarada) || patrimonioItens.length > 0,
    frases: (ligacao?.frases_marcantes?.length ?? 0) > 0,
    decisorio: Boolean(ligacao?.processo_decisorio),
    familia: familiares.length > 0,
    // Mesma condição que já controla `transcricao`/`modoReduzido` acima —
    // presente E consentida (`tem_consentimento`), nunca só presente.
    transcricao: transcricao !== null,
  };

  return { contexto, fontesUsadas, modoReduzido, sinaisCompletude };
}
