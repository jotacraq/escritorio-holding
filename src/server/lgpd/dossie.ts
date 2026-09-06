import type { SupabaseClient } from "@supabase/supabase-js";
import { lerDefinicao, rotuloDaResposta } from "@/lib/formulario/definicao";
import type {
  DocumentoDoTitular,
  DossieTitular,
  MetadadosDossie,
  SecaoDossie,
  SecaoFormularioDossie,
} from "@/types/lgpd";
import {
  COLUNA_DO_ESCOPO,
  INVENTARIO_TITULAR,
  chavesVazias,
  valoresDoEscopo,
  type ChavesDoTitular,
} from "./inventario";

/**
 * Dossiê do titular (LGPD art. 18, II e V — acesso e portabilidade).
 *
 * Duas metades separadas de propósito:
 *   · `carregarDadosDoTitular` — a parte de IO, com `service_role` (a rota já
 *     provou que quem chama é admin, e a leitura precisa atravessar a RLS de
 *     todas as tabelas do inventário).
 *   · `montarDossie` — PURA, testada em `dossie.test.ts`. É onde mora a regra
 *     que o Fable cobra: seção sem registro é `[]`, nunca zero inventado; e as
 *     `observacoes` dizem o que NÃO está no pacote em vez de omitir.
 *
 * AS SEÇÕES SÃO DERIVADAS DE `INVENTARIO_TITULAR` (correção M3 do pentest r3).
 * Antes havia duas listas — 21 tabelas no dossiê contra 29 no inventário —, e a
 * tela dizia "Transcrições: 4" para um pacote que não trazia nenhuma. Uma lista
 * só: acrescentar tabela no inventário passa a acrescentá-la no JSON e no PDF.
 *
 * Duas tabelas do inventário NÃO viram seção genérica porque já têm seção
 * própria, mais legível: `formularios_respostas` (vira pergunta→resposta contra
 * a versão respondida) e `documentos` (vira a lista de arquivos com metadado).
 * As duas continuam declaradas em `tabelas_incluidas`.
 */

type Linha = Record<string, unknown>;

/** Tabelas com seção dedicada — não entram no bloco genérico. */
const COM_SECAO_PROPRIA = new Set(["formularios_respostas", "documentos"]);

export interface RespostaFormularioBruta {
  linha: Linha;
  /** A definição da versão em que a pessoa respondeu — não a versão ativa. */
  formulario: { id: string; chave: string; versao: number; definicao: unknown } | null;
}

export interface DadosBrutosTitular {
  pessoa: Linha | null;
  /** Uma entrada por tabela do inventário. Tabela sem linha é `[]`. */
  tabelas: Record<string, Linha[]>;
  formularios: RespostaFormularioBruta[];
  documentos: DocumentoDoTitular[];
}

export interface ContextoDossie {
  gerado_por: { id: string; nome: string };
  solicitacao_id: string;
  controlador: string | null;
  gerado_em?: string;
}

/** A raiz: `pessoas` não está no inventário porque o inventário É dela. */
export const TABELA_RAIZ = "pessoas";

/** Toda tabela que o dossiê cobre. Vira `_metadados.tabelas_incluidas`. */
export const TABELAS_DO_DOSSIE: readonly string[] = [
  TABELA_RAIZ,
  ...INVENTARIO_TITULAR.map((d) => d.tabela),
];

/** Colunas de `pessoas` que são anotação do escritório, não declaração dela. */
export const CAMPOS_INTERNOS_PESSOA = ["observacoes"] as const;

/**
 * Colunas que saem no pacote com um texto no lugar do valor. A URL da gravação
 * é um endereço no provedor de voz que expira e não pertence ao titular; o que
 * ele tem direito de saber é que a gravação existe e onde ela vive.
 */
const SUBSTITUICOES: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  ligacoes_ia: Object.freeze({
    gravacao_url: "gravação guardada pelo provedor de telefonia (Vapi) — o endereço do arquivo não faz parte deste pacote",
  }),
});

export const OBSERVACAO_VAPI =
  "A gravação e a transcrição originais da ligação por IA ficam no provedor de voz (Vapi) e não fazem parte deste pacote.";
export const OBSERVACAO_DOCUMENTOS =
  "Os arquivos enviados pelo titular estão listados com seus metadados; o conteúdo é baixado individualmente por link assinado, e cada download fica registrado.";
export const OBSERVACAO_CNPJ =
  "Consultas públicas de CNPJ guardam nomes do quadro societário sem vínculo com o cadastro da pessoa no sistema; por isso não podem ser listadas aqui (BLOQUEIO B45).";
export const OBSERVACAO_ANONIMIZADA =
  "O tratamento dos dados deste titular já foi encerrado: o que aparece abaixo é o que restou depois da anonimização, não o que existia antes.";

/** Texto do BLOQUEIO B47 — vai no JSON, no PDF e no doc de arquitetura. */
export const AVISO_ANOTACOES_INTERNAS =
  "Esta seção reúne as anotações que a equipe e a IA produziram SOBRE o titular ao longo do " +
  "atendimento — impressões da ligação, briefings de preparação da sessão, análises do croqui e " +
  "da transcrição, e observações do cadastro. São dados pessoais dele e por isso entram no " +
  "pacote por padrão. A decisão de retirá-las de uma entrega específica é da Dra. Elaine, cabe " +
  "a ela e precisa ser registrada no pedido — o sistema não retira nada sozinho.";

function secaoFormulario(bruta: RespostaFormularioBruta): SecaoFormularioDossie {
  const respostas = (bruta.linha.respostas ?? {}) as Record<string, unknown>;
  const perguntas = lerDefinicao(bruta.formulario?.definicao);

  return {
    formulario_id: String(bruta.linha.formulario_id ?? bruta.formulario?.id ?? ""),
    chave: bruta.formulario?.chave ?? "",
    versao: bruta.formulario?.versao ?? 0,
    respondido_em: String(bruta.linha.respondido_em ?? ""),
    // Percorre a DEFINIÇÃO, não as respostas: pergunta sem resposta aparece
    // como resposta vazia (o titular tem direito de ver o que foi perguntado),
    // e resposta órfã de pergunta removida também não some.
    perguntas: [
      ...perguntas.map((p) => ({
        id: p.id,
        rotulo: p.rotulo,
        resposta_valor: Object.hasOwn(respostas, p.id) ? respostas[p.id] : null,
        resposta_rotulo: Object.hasOwn(respostas, p.id) ? rotuloDaResposta(p, respostas[p.id]) : "",
      })),
      ...Object.keys(respostas)
        .filter((chave) => !perguntas.some((p) => p.id === chave))
        .map((chave) => ({
          id: chave,
          rotulo: "(pergunta não encontrada na versão respondida)",
          resposta_valor: respostas[chave],
          resposta_rotulo: rotuloDaResposta(null, respostas[chave]),
        })),
    ],
  };
}

/** Aplica as substituições declaradas e devolve uma cópia — nunca muta a fonte. */
function comSubstituicoes(tabela: string, linha: Linha): Linha {
  const regras = SUBSTITUICOES[tabela];
  if (!regras) return { ...linha };
  const saida: Linha = { ...linha };
  for (const [coluna, texto] of Object.entries(regras)) {
    if (saida[coluna] !== null && saida[coluna] !== undefined && saida[coluna] !== "") saida[coluna] = texto;
  }
  return saida;
}

function temValor(v: unknown): boolean {
  if (v === null || v === undefined || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

/**
 * Separa a linha em duas: o que vai para a seção do titular e o que vai para as
 * anotações internas. A linha interna leva o `id` e as chaves de ligação para
 * ser rastreável — sem isso, uma frase solta não diz de qual ligação saiu.
 */
function partir(linha: Linha, camposInternos: readonly string[]): { publica: Linha; interna: Linha | null } {
  const publica: Linha = {};
  const interna: Linha = {};
  let temAlgo = false;

  for (const [chave, valor] of Object.entries(linha)) {
    if (camposInternos.includes(chave)) {
      if (temValor(valor)) {
        interna[chave] = valor;
        temAlgo = true;
      }
    } else {
      publica[chave] = valor;
    }
  }

  if (!temAlgo) return { publica, interna: null };

  const referencia: Linha = {};
  for (const chave of ["id", "jornada_id", "pessoa_id", "criado_em", "realizada_em", "versao"]) {
    if (linha[chave] !== undefined) referencia[chave] = linha[chave];
  }
  return { publica, interna: { ...referencia, ...interna } };
}

/** Montagem pura: entrada = linhas do banco, saída = o JSON que sai na mão. */
export function montarDossie(dados: DadosBrutosTitular, contexto: ContextoDossie): DossieTitular {
  const secoes: SecaoDossie[] = [];
  const internas: SecaoDossie[] = [];

  // `pessoas` é a raiz e tem tratamento próprio: uma linha, com `observacoes`
  // extraída para as anotações internas.
  let pessoa: Linha | null = null;
  if (dados.pessoa) {
    const { publica, interna } = partir(dados.pessoa, CAMPOS_INTERNOS_PESSOA);
    pessoa = publica;
    if (interna) internas.push({ tabela: TABELA_RAIZ, rotulo: "Observações no cadastro", linhas: [interna] });
  }

  for (const descritor of INVENTARIO_TITULAR) {
    if (COM_SECAO_PROPRIA.has(descritor.tabela)) continue;
    const brutas = (dados.tabelas[descritor.tabela] ?? []).map((l) => comSubstituicoes(descritor.tabela, l));

    if (descritor.interna) {
      internas.push({ tabela: descritor.tabela, rotulo: descritor.rotulo, linhas: brutas });
      continue;
    }

    if (!descritor.camposInternos || descritor.camposInternos.length === 0) {
      secoes.push({ tabela: descritor.tabela, rotulo: descritor.rotulo, linhas: brutas });
      continue;
    }

    const publicas: Linha[] = [];
    const anotacoes: Linha[] = [];
    for (const linha of brutas) {
      const { publica, interna } = partir(linha, descritor.camposInternos);
      publicas.push(publica);
      if (interna) anotacoes.push(interna);
    }
    secoes.push({ tabela: descritor.tabela, rotulo: descritor.rotulo, linhas: publicas });
    internas.push({ tabela: descritor.tabela, rotulo: `${descritor.rotulo} — anotações da equipe`, linhas: anotacoes });
  }

  const observacoes: string[] = [];
  if (dados.pessoa?.anonimizada_em) observacoes.push(OBSERVACAO_ANONIMIZADA);
  if ((dados.tabelas.ligacoes_ia ?? []).length > 0) observacoes.push(OBSERVACAO_VAPI);
  if (dados.documentos.length > 0) observacoes.push(OBSERVACAO_DOCUMENTOS);
  observacoes.push(OBSERVACAO_CNPJ);
  observacoes.push(AVISO_ANOTACOES_INTERNAS);

  const metadados: MetadadosDossie = {
    gerado_em: contexto.gerado_em ?? new Date().toISOString(),
    gerado_por: contexto.gerado_por,
    solicitacao_id: contexto.solicitacao_id,
    versao_esquema: 2,
    sistema: "SIC-HF",
    controlador: contexto.controlador,
    tabelas_incluidas: [...TABELAS_DO_DOSSIE],
    observacoes,
  };

  return {
    _metadados: metadados,
    pessoa,
    formularios: dados.formularios.map(secaoFormulario),
    documentos: dados.documentos,
    secoes,
    anotacoes_internas: { aviso: AVISO_ANOTACOES_INTERNAS, secoes: internas },
  };
}

export function dadosBrutosVazios(): DadosBrutosTitular {
  const tabelas: Record<string, Linha[]> = {};
  for (const d of INVENTARIO_TITULAR) tabelas[d.tabela] = [];
  return { pessoa: null, tabelas, formularios: [], documentos: [] };
}

type Cliente = SupabaseClient;

async function linhas(cliente: Cliente, tabela: string, coluna: string, valores: string[]): Promise<Linha[]> {
  if (valores.length === 0) return [];
  const { data, error } = await cliente.from(tabela).select("*").in(coluna, valores);
  if (error) throw error;
  return (data as Linha[] | null) ?? [];
}

/** Só os ids — usado para descer aos escopos filhos sem trazer PII à toa. */
async function ids(cliente: Cliente, tabela: string, coluna: string, valores: string[]): Promise<string[]> {
  if (valores.length === 0) return [];
  const { data, error } = await cliente.from(tabela).select("id").in(coluna, valores);
  if (error) throw error;
  return ((data as { id: string }[] | null) ?? []).map((l) => String(l.id));
}

/**
 * Descobre as chaves de todos os escopos do titular. Duas idas ao banco em
 * série (jornadas → filhas), nunca uma por linha.
 */
export async function levantarChavesDoTitular(
  cliente: Cliente,
  pessoaId: string,
  jornadaIdsConhecidos?: string[],
): Promise<ChavesDoTitular> {
  const chaves = chavesVazias(pessoaId);
  chaves.jornadaIds = jornadaIdsConhecidos ?? (await ids(cliente, "jornadas", "pessoa_id", [pessoaId]));
  const [sessaoIds, croquiIds, transcricaoIds] = await Promise.all([
    ids(cliente, "sessoes_viabilidade", "jornada_id", chaves.jornadaIds),
    ids(cliente, "croquis", "jornada_id", chaves.jornadaIds),
    ids(cliente, "transcricoes", "jornada_id", chaves.jornadaIds),
  ]);
  chaves.sessaoIds = sessaoIds;
  chaves.croquiIds = croquiIds;
  chaves.transcricaoIds = transcricaoIds;
  return chaves;
}

/**
 * Leitura por `service_role`. Uma consulta por tabela do inventário, todas por
 * coluna indexada e todas em paralelo — nada de N+1 por linha.
 */
export async function carregarDadosDoTitular(
  cliente: Cliente,
  pessoaId: string,
  chavesConhecidas?: ChavesDoTitular,
): Promise<DadosBrutosTitular> {
  const dados = dadosBrutosVazios();

  const { data: pessoa, error: erroPessoa } = await cliente
    .from("pessoas")
    .select("*")
    .eq("id", pessoaId)
    .maybeSingle();
  if (erroPessoa) throw erroPessoa;
  dados.pessoa = (pessoa as Linha | null) ?? null;

  const chaves = chavesConhecidas ?? (await levantarChavesDoTitular(cliente, pessoaId));

  const carregadas = await Promise.all(
    INVENTARIO_TITULAR.map(async (d) => ({
      tabela: d.tabela,
      linhas: await linhas(cliente, d.tabela, COLUNA_DO_ESCOPO[d.por], valoresDoEscopo(chaves, d.por)),
    })),
  );
  for (const { tabela, linhas: lidas } of carregadas) dados.tabelas[tabela] = lidas;

  dados.documentos = (dados.tabelas.documentos ?? []).map((d) => ({
    id: String(d.id),
    tipo: String(d.tipo),
    nome_arquivo: String(d.nome_arquivo),
    tamanho_bytes: Number(d.tamanho_bytes ?? 0),
    mime: String(d.mime ?? ""),
    criado_em: String(d.criado_em ?? ""),
  }));

  // A resposta pertence à VERSÃO em que foi dada: uma consulta só, com `in`,
  // para os formulários citados (nunca uma por resposta).
  const respostasFormulario = dados.tabelas.formularios_respostas ?? [];
  const formularioIds = [...new Set(respostasFormulario.map((r) => String(r.formulario_id)))];
  const definicoes = await linhas(cliente, "formularios", "id", formularioIds);
  dados.formularios = respostasFormulario.map((linha) => {
    const f = definicoes.find((d) => String(d.id) === String(linha.formulario_id));
    return {
      linha,
      formulario: f
        ? { id: String(f.id), chave: String(f.chave), versao: Number(f.versao), definicao: f.definicao }
        : null,
    };
  });

  return dados;
}
