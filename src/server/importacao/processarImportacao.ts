import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarErro } from "@/server/erros";
import { CAMPOS_IMPORTAVEIS } from "@/types/importacao";
import type { CampoImportavel, Importacao, MapaColunas, PerguntasSeminario } from "@/types/importacao";
import { classificarLinhas } from "./classificacao";
import {
  CHAVE_LIMITE_LINHAS,
  CHAVE_TAMANHO_MAXIMO_BYTES,
  LIMITE_LINHAS_PADRAO,
  lerConfiguracaoInt,
  TAMANHO_MAXIMO_BYTES_PADRAO,
} from "./config";
import { decodificarArquivo, parseCsv } from "./csv";
import { ErroImportacao } from "./erros";
import { validarPerguntasSeminario } from "./perguntas";

const TAMANHO_LOTE_INSERT = 500;

function ehCampoImportavel(valor: string): valor is CampoImportavel {
  return (CAMPOS_IMPORTAVEIS as readonly string[]).includes(valor);
}

/**
 * Valida a FORMA do mapa: toda coluna citada existe no cabeçalho real do
 * arquivo, todo alvo é um campo conhecido, nenhum campo recebe duas colunas,
 * e 'nome' está mapeado (é `not null` em `pessoas`). Não valida CONTEÚDO —
 * isso é `classificarLinhas`/`normalizacao.ts`.
 */
function validarMapaColunas(mapaColunas: MapaColunas, cabecalho: string[]): void {
  const colunasDoArquivo = new Set(cabecalho);
  const alvosUsados = new Set<string>();

  for (const [coluna, alvo] of Object.entries(mapaColunas)) {
    if (!colunasDoArquivo.has(coluna)) {
      throw new ErroImportacao(
        `A coluna mapeada "${coluna}" não existe no cabeçalho do arquivo enviado.`,
        "mapeamento_coluna_inexistente",
      );
    }
    if (!ehCampoImportavel(alvo)) {
      throw new ErroImportacao(`"${alvo}" não é um campo importável.`, "mapeamento_campo_invalido");
    }
    if (alvosUsados.has(alvo)) {
      throw new ErroImportacao(
        `Mais de uma coluna mapeada para o campo "${alvo}". Cada campo só pode receber uma coluna.`,
        "mapeamento_campo_duplicado",
      );
    }
    alvosUsados.add(alvo);
  }

  if (!alvosUsados.has("nome")) {
    throw new ErroImportacao("O campo 'nome' precisa estar mapeado a alguma coluna do arquivo.", "mapeamento_sem_nome");
  }
}

export interface ResultadoProcessamento {
  importacao: Importacao;
}

/**
 * Fase 1 (prévia) da importação de leads: decodifica, parseia, classifica
 * (leitura em lote, zero escrita em pessoas/jornadas) e persiste
 * `importacoes` + `importacoes_linhas` com `status='previa'`. A confirmação
 * de verdade é `public.confirmar_importacao` (RPC, transação única — ver
 * `0035_importacao.sql`), chamada só depois que o operador vê este resultado.
 */
export async function processarNovaImportacao(
  supabase: SupabaseClient,
  params: {
    arquivo: File;
    edicaoId: string;
    mapaColunas: MapaColunas;
    /** Cabeçalhos marcados como "Pergunta do seminário" (Fase 4, `./perguntas.ts`). Ausente = contrato antigo. */
    perguntasSeminario?: PerguntasSeminario | null;
    criadoPor: string;
  },
): Promise<ResultadoProcessamento> {
  const { arquivo, edicaoId, mapaColunas, perguntasSeminario, criadoPor } = params;

  const tamanhoMaximo = await lerConfiguracaoInt(supabase, CHAVE_TAMANHO_MAXIMO_BYTES, TAMANHO_MAXIMO_BYTES_PADRAO);
  const limiteLinhas = await lerConfiguracaoInt(supabase, CHAVE_LIMITE_LINHAS, LIMITE_LINHAS_PADRAO);

  if (arquivo.size <= 0 || arquivo.size > tamanhoMaximo) {
    throw new ErroImportacao(
      `Arquivo precisa ter entre 1 byte e ${tamanhoMaximo} bytes (recebido: ${arquivo.size}).`,
      "tamanho_invalido",
    );
  }
  if (!arquivo.name.toLowerCase().endsWith(".csv")) {
    throw new ErroImportacao("Só arquivos .csv são aceitos.", "extensao_invalida");
  }

  // Lido de uma vez, mas já limitado pelo teto de tamanho acima — não há
  // como isto estourar memória além do teto configurado (padrão 5 MiB).
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const texto = decodificarArquivo(bytes);
  const { cabecalho, linhas } = parseCsv(texto);

  if (cabecalho.length === 0) {
    throw new ErroImportacao("Arquivo vazio ou sem cabeçalho reconhecível.", "arquivo_vazio");
  }
  if (linhas.length === 0) {
    throw new ErroImportacao("Arquivo não tem nenhuma linha de dado (só cabeçalho).", "sem_linhas");
  }
  if (linhas.length > limiteLinhas) {
    throw new ErroImportacao(
      `Arquivo tem ${linhas.length} linhas; o limite atual é ${limiteLinhas}. Divida o arquivo em partes menores ou ajuste o limite em Admin.`,
      "limite_linhas_excedido",
    );
  }

  validarMapaColunas(mapaColunas, cabecalho);
  // Perguntas do seminário ficam fora da classificação (que só conhece campo
  // cadastral): a resposta já está em `dados.bruto[<cabeçalho>]` de toda
  // linha, e é de lá que `confirmar_importacao` (0059) a lê, guiada pela
  // lista salva em `importacoes.perguntas_seminario` abaixo.
  const perguntasValidadas = validarPerguntasSeminario(perguntasSeminario, mapaColunas, cabecalho);

  const linhasClassificadas = await classificarLinhas(supabase, {
    cabecalho,
    linhasBrutas: linhas,
    mapaColunas,
    edicaoId,
  });

  const contagem = {
    pessoas_novas: 0,
    pessoas_existentes: 0,
    jornadas_novas: 0,
    ignoradas: 0,
    com_erro: 0,
  };
  for (const linha of linhasClassificadas) {
    if (linha.resultado === "pessoa_nova") contagem.pessoas_novas++;
    else if (linha.resultado === "pessoa_existente") contagem.pessoas_existentes++;
    else if (linha.resultado === "jornada_nova") contagem.jornadas_novas++;
    else if (linha.resultado === "ignorada_jornada_aberta") contagem.ignoradas++;
    else contagem.com_erro++;
  }
  // Toda linha 'pessoa_nova' TAMBÉM abre jornada nova (pessoa recém-criada
  // nunca tem jornada aberta prévia) — soma às linhas 'jornada_nova' no total
  // de jornadas que a confirmação vai criar (mesma regra em `0035`, dentro de
  // `confirmar_importacao`).
  contagem.jornadas_novas += contagem.pessoas_novas;

  const { data: importacaoInserida, error: erroImportacao } = await supabase
    .from("importacoes")
    .insert({
      edicao_id: edicaoId,
      arquivo_nome: arquivo.name.slice(0, 200),
      mapa_colunas: mapaColunas,
      perguntas_seminario: perguntasValidadas,
      status: "previa",
      total_linhas: linhasClassificadas.length,
      ...contagem,
      criado_por: criadoPor,
    })
    .select("*")
    .single();

  if (erroImportacao) {
    registrarErro("server/importacao.processarNovaImportacao", erroImportacao, { edicao_id: edicaoId });
    throw erroImportacao;
  }

  const importacaoId = (importacaoInserida as Importacao).id;

  // As linhas são inseridas em lotes (evita payload único gigante numa
  // importação de milhares de leads); não há transação de banco cobrindo os
  // vários `insert()` do supabase-js. Para nunca deixar uma prévia
  // INCOMPLETA em status 'previa' (que poderia ser confirmada faltando
  // linha, exatamente a classe de bug "ingestão que poda" já catalogada no
  // histórico do João), qualquer falha no meio do lote marca a importação
  // como 'cancelada' (nunca DELETE) antes de propagar o erro — uma prévia
  // cancelada nunca passa por `confirmar_importacao` (que exige status='previa').
  try {
    for (let i = 0; i < linhasClassificadas.length; i += TAMANHO_LOTE_INSERT) {
      const lote = linhasClassificadas.slice(i, i + TAMANHO_LOTE_INSERT).map((linha) => ({
        importacao_id: importacaoId,
        numero: linha.numero,
        dados: linha.dados,
        resultado: linha.resultado,
        motivo: linha.motivo,
        pessoa_id: linha.pessoa_id,
      }));

      const { error: erroLinhas } = await supabase.from("importacoes_linhas").insert(lote);
      if (erroLinhas) {
        registrarErro("server/importacao.processarNovaImportacao linhas", erroLinhas, {
          importacao_id: importacaoId,
          lote_inicio: i,
        });
        throw erroLinhas;
      }
    }
  } catch (erroLote) {
    const { error: erroCancelar } = await supabase
      .from("importacoes")
      .update({ status: "cancelada" })
      .eq("id", importacaoId)
      .eq("status", "previa");
    if (erroCancelar) {
      registrarErro("server/importacao.processarNovaImportacao cancelamento_por_falha", erroCancelar, {
        importacao_id: importacaoId,
      });
    }
    throw erroLote;
  }

  return { importacao: importacaoInserida as Importacao };
}
