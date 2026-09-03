import type { SupabaseClient } from "@supabase/supabase-js";
import type { CampoImportavel, DadosLinhaImportacao, MapaColunas, ResultadoLinhaImportacao } from "@/types/importacao";
import {
  normalizarDiasAssistidos,
  normalizarEmail,
  normalizarTelefoneBr,
  normalizarTexto,
  normalizarUf,
  TAMANHO_MAXIMO_OBSERVACOES,
} from "./normalizacao";

const TAMANHO_LOTE_CONSULTA = 500;

function emLotes<T>(itens: T[], tamanho: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}

export interface LinhaClassificada {
  numero: number;
  dados: DadosLinhaImportacao;
  resultado: ResultadoLinhaImportacao;
  motivo: string | null;
  pessoa_id: string | null;
}

interface PessoaBanco {
  id: string;
  email: string | null;
  telefone: string | null;
}

/** Estado (real ou simulado por esta mesma importação) de uma identidade —
 * chave é "objeto compartilhado": duas entradas do ledger (por e-mail e por
 * telefone) podem apontar para o MESMO objeto, para que atualizar por uma
 * chave reflita na outra. */
interface Identidade {
  /** `null` = pessoa ainda não existe de verdade — será criada por uma linha
   * 'pessoa_nova' desta mesma importação, na confirmação. */
  pessoaId: string | null;
  /** Número da linha desta importação que introduziu esta identidade, quando
   * `pessoaId` é `null` (referência que `confirmar_importacao` resolve). */
  linhaOrigemNumero: number | null;
  temJornadaAberta: boolean;
  temParticipacaoNestaEdicao: boolean;
  /** "e-mail" | "telefone" — só para compor o texto do `motivo`. */
  chave: string;
}

interface LinhaNormalizada {
  numero: number;
  bruto: Record<string, string>;
  nome: string | null;
  email: string | null;
  telefone: string | null;
  cidade: string | null;
  uf: string | null;
  profissao: string | null;
  faixa_etaria: string | null;
  estado_civil: string | null;
  observacoes: string | null;
  dias_assistidos: number | null;
  avisos: string[];
}

/** Acha, dentro do mapa coluna->campo, a coluna original que alimenta `campo`. */
function colunaDoCampo(mapaColunas: MapaColunas, campo: CampoImportavel): string | undefined {
  return Object.entries(mapaColunas).find(([, alvo]) => alvo === campo)?.[0];
}

function paraDadosNormalizados(linha: LinhaNormalizada) {
  return {
    nome: linha.nome ?? "",
    email: linha.email,
    telefone: linha.telefone,
    cidade: linha.cidade,
    uf: linha.uf,
    profissao: linha.profissao,
    faixa_etaria: linha.faixa_etaria,
    estado_civil: linha.estado_civil,
    observacoes: linha.observacoes,
    dias_assistidos: linha.dias_assistidos,
  };
}

/**
 * Classifica cada linha do arquivo já mapeado, decidindo o que
 * `public.confirmar_importacao` fará — sem gravar nada em
 * `pessoas`/`jornadas`/`participacoes_seminario`, só leitura em lote (nunca
 * N+1: uma consulta por chave de dedupe, nunca uma por linha).
 *
 * Regra: dedupe por e-mail e por telefone (índices únicos parciais de
 * `pessoas`); `uniq_jornada_aberta_por_pessoa` é invariante (0004) —
 * identidade com jornada aberta é ignorada, nunca sobrescrita; participação
 * repetida na MESMA edição não abre jornada nova (evita duplicar por reimportar
 * a mesma lista, ou por linha duplicada dentro do próprio arquivo).
 */
export async function classificarLinhas(
  supabase: SupabaseClient,
  params: {
    cabecalho: string[];
    linhasBrutas: string[][];
    mapaColunas: MapaColunas;
    edicaoId: string;
  },
): Promise<LinhaClassificada[]> {
  const { cabecalho, linhasBrutas, mapaColunas, edicaoId } = params;

  // 1) Normaliza tudo primeiro (puro, sem I/O) e junta as chaves de dedupe.
  const emailsParaBuscar = new Set<string>();
  const telefonesParaBuscar = new Set<string>();

  const linhasNormalizadas: LinhaNormalizada[] = linhasBrutas.map((celulas, indice) => {
    const bruto: Record<string, string> = {};
    cabecalho.forEach((coluna, i) => {
      bruto[coluna] = celulas[i] ?? "";
    });

    const valorDoCampo = (campo: CampoImportavel): string | undefined => {
      const coluna = colunaDoCampo(mapaColunas, campo);
      return coluna !== undefined ? bruto[coluna] : undefined;
    };

    const avisos: string[] = [];
    const email = normalizarEmail(valorDoCampo("email"));
    const telefone = normalizarTelefoneBr(valorDoCampo("telefone"));
    const uf = normalizarUf(valorDoCampo("uf"));
    const diasAssistidos = normalizarDiasAssistidos(valorDoCampo("dias_assistidos"));
    if (email.aviso) avisos.push(email.aviso);
    if (telefone.aviso) avisos.push(telefone.aviso);
    if (uf.aviso) avisos.push(uf.aviso);
    if (diasAssistidos.aviso) avisos.push(diasAssistidos.aviso);

    if (email.valor) emailsParaBuscar.add(email.valor);
    if (telefone.valor) telefonesParaBuscar.add(telefone.valor);

    return {
      numero: indice + 1,
      bruto,
      nome: normalizarTexto(valorDoCampo("nome")),
      email: email.valor,
      telefone: telefone.valor,
      cidade: normalizarTexto(valorDoCampo("cidade")),
      profissao: normalizarTexto(valorDoCampo("profissao")),
      uf: uf.valor,
      faixa_etaria: normalizarTexto(valorDoCampo("faixa_etaria")),
      estado_civil: normalizarTexto(valorDoCampo("estado_civil")),
      observacoes: normalizarTexto(valorDoCampo("observacoes"), TAMANHO_MAXIMO_OBSERVACOES),
      dias_assistidos: diasAssistidos.valor,
      avisos,
    };
  });

  // 2) Busca em lote (nunca N+1): pessoas por e-mail/telefone já normalizados.
  // `pessoas.email` é sempre gravado em minúsculo (convenção existente,
  // `resolverOuCriarPessoa`) — comparar direto contra o valor normalizado é seguro.
  const pessoasPorEmail = new Map<string, PessoaBanco>();
  const pessoasPorTelefone = new Map<string, PessoaBanco>();
  const pessoasEncontradas = new Map<string, PessoaBanco>();

  for (const lote of emLotes([...emailsParaBuscar], TAMANHO_LOTE_CONSULTA)) {
    const { data, error } = await supabase.from("pessoas").select("id, email, telefone").in("email", lote);
    if (error) throw error;
    for (const p of (data ?? []) as PessoaBanco[]) {
      pessoasEncontradas.set(p.id, p);
      if (p.email) pessoasPorEmail.set(p.email, p);
    }
  }
  for (const lote of emLotes([...telefonesParaBuscar], TAMANHO_LOTE_CONSULTA)) {
    const { data, error } = await supabase.from("pessoas").select("id, email, telefone").in("telefone", lote);
    if (error) throw error;
    for (const p of (data ?? []) as PessoaBanco[]) {
      pessoasEncontradas.set(p.id, p);
      if (p.telefone) pessoasPorTelefone.set(p.telefone, p);
    }
  }

  const idsEncontrados = [...pessoasEncontradas.keys()];

  // 3) Jornadas abertas dessas pessoas (uma consulta em lote).
  const pessoasComJornadaAberta = new Set<string>();
  for (const lote of emLotes(idsEncontrados, TAMANHO_LOTE_CONSULTA)) {
    const { data, error } = await supabase.from("jornadas").select("pessoa_id").eq("desfecho", "aberta").in("pessoa_id", lote);
    if (error) throw error;
    for (const j of (data ?? []) as { pessoa_id: string }[]) pessoasComJornadaAberta.add(j.pessoa_id);
  }

  // 4) Participações já registradas NESTA edição, para essas pessoas.
  const pessoasComParticipacaoNestaEdicao = new Set<string>();
  for (const lote of emLotes(idsEncontrados, TAMANHO_LOTE_CONSULTA)) {
    const { data, error } = await supabase
      .from("participacoes_seminario")
      .select("pessoa_id")
      .eq("edicao_id", edicaoId)
      .in("pessoa_id", lote);
    if (error) throw error;
    for (const p of (data ?? []) as { pessoa_id: string }[]) pessoasComParticipacaoNestaEdicao.add(p.pessoa_id);
  }

  // 5) Resolve linha a linha, EM ORDEM, com um "ledger" para duplicata dentro
  // do próprio arquivo (identidade nova introduzida na linha N é vista pelas
  // linhas N+1, N+2, ... deste mesmo arquivo).
  const ledgerPorEmail = new Map<string, Identidade>();
  const ledgerPorTelefone = new Map<string, Identidade>();
  const resultado: LinhaClassificada[] = [];

  for (const linha of linhasNormalizadas) {
    if (!linha.nome) {
      resultado.push({
        numero: linha.numero,
        dados: { bruto: linha.bruto, normalizado: paraDadosNormalizados(linha), ...(linha.avisos.length ? { avisos: linha.avisos } : {}) },
        resultado: "erro",
        motivo: "Nome obrigatório ausente ou vazio.",
        pessoa_id: null,
      });
      continue;
    }

    let identidade: Identidade | undefined;

    if (linha.email && ledgerPorEmail.has(linha.email)) {
      identidade = ledgerPorEmail.get(linha.email);
    } else if (linha.telefone && ledgerPorTelefone.has(linha.telefone)) {
      identidade = ledgerPorTelefone.get(linha.telefone);
    } else if (linha.email && pessoasPorEmail.has(linha.email)) {
      const p = pessoasPorEmail.get(linha.email)!;
      identidade = {
        pessoaId: p.id,
        linhaOrigemNumero: null,
        temJornadaAberta: pessoasComJornadaAberta.has(p.id),
        temParticipacaoNestaEdicao: pessoasComParticipacaoNestaEdicao.has(p.id),
        chave: "e-mail",
      };
    } else if (linha.telefone && pessoasPorTelefone.has(linha.telefone)) {
      const p = pessoasPorTelefone.get(linha.telefone)!;
      identidade = {
        pessoaId: p.id,
        linhaOrigemNumero: null,
        temJornadaAberta: pessoasComJornadaAberta.has(p.id),
        temParticipacaoNestaEdicao: pessoasComParticipacaoNestaEdicao.has(p.id),
        chave: "telefone",
      };
    }

    const registrarNoLedger = (id: Identidade) => {
      if (linha.email) ledgerPorEmail.set(linha.email, id);
      if (linha.telefone) ledgerPorTelefone.set(linha.telefone, id);
    };

    let resultadoLinha: ResultadoLinhaImportacao;
    let motivo: string | null = null;
    let pessoaIdParaGravar: string | null = null;

    if (!identidade) {
      resultadoLinha = "pessoa_nova";
      registrarNoLedger({
        pessoaId: null,
        linhaOrigemNumero: linha.numero,
        temJornadaAberta: true,
        temParticipacaoNestaEdicao: true,
        chave: "",
      });
    } else if (identidade.temParticipacaoNestaEdicao) {
      // Já contabilizada nesta edição — seja de uma importação anterior
      // (pessoaId real, sem linha de origem), seja de uma linha anterior
      // deste MESMO arquivo (linhaOrigemNumero aponta pra ela).
      resultadoLinha = "pessoa_existente";
      pessoaIdParaGravar = identidade.pessoaId;
      motivo =
        identidade.linhaOrigemNumero != null
          ? `duplicata_da_linha:${identidade.linhaOrigemNumero}`
          : `Pessoa já participou desta edição (casou por ${identidade.chave}).`;
    } else if (identidade.temJornadaAberta) {
      // Só alcançável com identidade vinda do banco (pessoaId real): o ledger
      // nunca marca `temJornadaAberta=true` sem marcar `temParticipacaoNestaEdicao=true`
      // junto (ver ramos 'pessoa_nova'/'jornada_nova' abaixo).
      resultadoLinha = "ignorada_jornada_aberta";
      pessoaIdParaGravar = identidade.pessoaId;
      motivo = `Pessoa já tem jornada aberta (casou por ${identidade.chave}). Não é possível abrir outra até fechar a atual.`;
    } else {
      resultadoLinha = "jornada_nova";
      pessoaIdParaGravar = identidade.pessoaId;
      motivo = `Pessoa já existente (casou por ${identidade.chave}); jornada nova aberta para esta edição.`;
      identidade.temJornadaAberta = true;
      identidade.temParticipacaoNestaEdicao = true;
      registrarNoLedger(identidade);
    }

    resultado.push({
      numero: linha.numero,
      dados: {
        bruto: linha.bruto,
        normalizado: paraDadosNormalizados(linha),
        ...(linha.avisos.length ? { avisos: linha.avisos } : {}),
      },
      resultado: resultadoLinha,
      motivo,
      pessoa_id: pessoaIdParaGravar,
    });
  }

  return resultado;
}
