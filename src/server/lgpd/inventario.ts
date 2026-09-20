import type { SupabaseClient } from "@supabase/supabase-js";
import type { LinhaInventario } from "@/types/lgpd";

/**
 * "O que o sistema guarda desta pessoa" — a contagem que a tela mostra antes de
 * exportar ou encerrar o tratamento, e a LISTA MESTRA de onde o dossiê
 * (`dossie.ts`) deriva as suas seções.
 *
 * Essa segunda função é a correção do achado M3 do pentest da rodada 3: o
 * dossiê tinha a sua própria lista de 21 tabelas, o inventário tinha 29 e a
 * `anonimizar_titular` tocava 36. Quem exportava recebia menos do que a tela
 * dizia existir — e a regra da casa ("o que NÃO está no pacote é dito, não
 * omitido") só funciona se houver UMA lista. Acrescentar tabela aqui passa a
 * acrescentá-la no inventário, no JSON e no PDF de uma vez.
 *
 * Duas regras de leitura:
 *   · rótulo em vocabulário do negócio, nunca nome de tabela na tela;
 *   · contagem que falhou vira `null` (a tela diz "não foi possível contar"), e
 *     tabela sem linha vira `0` de verdade — que a tela mostra como "nenhum
 *     registro", nunca como "0". Zero medido e zero inventado são coisas
 *     diferentes, e é por isso que `null` existe aqui.
 */

/** Por qual coluna a tabela chega até o titular. */
export type EscopoTitular = "pessoa" | "jornada" | "sessao" | "croqui" | "transcricao";

export const COLUNA_DO_ESCOPO: Readonly<Record<EscopoTitular, string>> = Object.freeze({
  pessoa: "pessoa_id",
  jornada: "jornada_id",
  sessao: "sessao_id",
  croqui: "croqui_id",
  transcricao: "transcricao_id",
});

export interface DescritorInventario {
  tabela: string;
  rotulo: string;
  por: EscopoTitular;
  /**
   * Tabela inteira é ANOTAÇÃO INTERNA do escritório sobre o titular (BLOQUEIO
   * B47): sai numa seção separada do dossiê, com aviso próprio.
   */
  interna?: true;
  /**
   * Colunas que são anotação interna dentro de uma tabela que, no resto, é
   * dado do próprio titular. Saem da seção principal e vão para a seção de
   * anotações internas.
   */
  camposInternos?: readonly string[];
}

export const INVENTARIO_TITULAR: readonly DescritorInventario[] = [
  { tabela: "jornadas", rotulo: "Jornadas", por: "pessoa" },
  { tabela: "consentimentos", rotulo: "Consentimentos", por: "pessoa" },
  { tabela: "familiares", rotulo: "Familiares", por: "pessoa" },
  { tabela: "patrimonio_itens", rotulo: "Bens do patrimônio", por: "pessoa" },
  { tabela: "documentos", rotulo: "Arquivos enviados", por: "pessoa" },
  { tabela: "pagamentos", rotulo: "Pagamentos", por: "pessoa" },
  { tabela: "mensagens_recebidas", rotulo: "Mensagens recebidas", por: "pessoa" },
  { tabela: "respostas_seminario", rotulo: "Respostas do seminário", por: "pessoa" },
  { tabela: "participacoes_seminario", rotulo: "Participações no seminário", por: "pessoa" },
  { tabela: "importacoes_linhas", rotulo: "Linhas de planilha importada", por: "pessoa" },
  { tabela: "formularios_respostas", rotulo: "Formulário estratégico respondido", por: "jornada" },
  // `objecoes_percebidas`, `sinais` e `frases_marcantes` são a LEITURA que a
  // equipe fez da pessoa durante a ligação — não são declaração dela.
  {
    tabela: "ligacoes_estrategicas",
    rotulo: "Ligações estratégicas",
    por: "jornada",
    camposInternos: ["objecoes_percebidas", "sinais", "frases_marcantes"],
  },
  { tabela: "ligacoes_ia", rotulo: "Ligações por IA", por: "jornada" },
  { tabela: "sessoes_viabilidade", rotulo: "Sessões de Viabilidade", por: "jornada" },
  // `conteudo` do briefing é a peça que a IA escreve PARA a equipe conduzir a
  // sessão. O fato de o briefing existir é do titular; o texto é do escritório.
  { tabela: "briefings", rotulo: "Briefings estratégicos", por: "jornada", camposInternos: ["conteudo"] },
  { tabela: "execucoes_ia", rotulo: "Execuções de IA", por: "jornada" },
  { tabela: "croquis", rotulo: "Croquis", por: "jornada" },
  { tabela: "croqui_calculos", rotulo: "Cálculos do croqui", por: "jornada" },
  { tabela: "diagnosticos_sv", rotulo: "Diagnósticos da sessão", por: "jornada" },
  { tabela: "cenarios_patrimoniais", rotulo: "Cenários patrimoniais", por: "jornada" },
  { tabela: "materiais_gerados", rotulo: "Materiais pós-sessão", por: "jornada" },
  { tabela: "mensagens_agendadas", rotulo: "Mensagens enviadas", por: "jornada" },
  { tabela: "eventos_timeline", rotulo: "Eventos da linha do tempo", por: "jornada" },
  { tabela: "tarefas", rotulo: "Tarefas", por: "jornada" },
  { tabela: "links_publicos", rotulo: "Links públicos emitidos", por: "jornada" },
  { tabela: "documentos_pedidos", rotulo: "Documentos pedidos", por: "jornada" },
  { tabela: "transcricoes", rotulo: "Transcrições de reunião", por: "jornada" },
  // 🔴 A FAMÍLIA DO COPILOTO (achado F1 do pentest da Fase 13, 19/09/2026;
  // escopo ampliado por decisão do João no mesmo dia: não só a tabela nova,
  // as QUATRO). Todas nasceram DEPOIS da 0081, que foi a última vez que esta
  // lista e a `anonimizar_titular` foram alinhadas — por isso nenhuma estava
  // aqui, e por isso um titular que exercesse o art. 18 recebia menos do que
  // o sistema realmente guarda dele.
  //
  // As quatro chegam ao titular por `sessao_id` (a Sessão de Viabilidade),
  // nunca por `pessoa_id`: é a sessão que pertence à jornada que pertence à
  // pessoa. `copiloto_retrospectos` também tem `jornada_id`, mas entra por
  // `sessao` como as irmãs — uma chave só para a família inteira.
  //
  // Nenhuma é `interna: true`: o que está guardado aqui é FALA DO TITULAR
  // (transcrição bruta, citação literal de dor/objeção/desejo, inventário de
  // bens que ele declarou em voz alta). A LEITURA que a IA fez em cima disso
  // é anotação do escritório — mas o insumo é dele, e é ele quem tem direito
  // de saber que existe. `copiloto_sugestoes` carrega as duas coisas no mesmo
  // jsonb (`conteudo`), e na dúvida entre "interna" e "do titular" a regra da
  // casa manda mostrar.
  { tabela: "sessoes_copiloto", rotulo: "Sessões do copiloto ao vivo", por: "sessao" },
  { tabela: "sessoes_copiloto_segmentos", rotulo: "Falas transcritas na sessão", por: "sessao" },
  {
    tabela: "copiloto_sugestoes",
    rotulo: "Sugestões do copiloto durante a sessão",
    por: "sessao",
    // A sugestão é a LEITURA da IA sobre a condução — anotação do escritório.
    // A `evidencia` dentro dela é citação literal do titular, mas não há como
    // separar por coluna: `conteudo` é um jsonb só. Marcado como interno com
    // o aviso próprio, que é o tratamento honesto para conteúdo misto.
    camposInternos: ["conteudo"],
  },
  { tabela: "copiloto_retrospectos", rotulo: "Retrospectos da Sessão de Viabilidade", por: "sessao" },
  { tabela: "pesquisas_publicas", rotulo: "Pesquisas em fontes públicas", por: "jornada" },
  { tabela: "relatorios_sessao", rotulo: "Relatórios da sessão", por: "sessao" },
  // Saídas de IA sobre o titular, penduradas no croqui e na transcrição. Não
  // estavam no inventário antes da 0081 e por isso não estavam em lugar nenhum
  // da tela — apesar de a `anonimizar_titular` já as anonimizar.
  { tabela: "croqui_analises", rotulo: "Análises do croqui (IA)", por: "croqui", interna: true },
  { tabela: "analises_transcricao", rotulo: "Análises da transcrição (IA)", por: "transcricao", interna: true },
];

/** As chaves que ligam o titular a cada escopo. */
export interface ChavesDoTitular {
  pessoaId: string;
  jornadaIds: string[];
  sessaoIds: string[];
  croquiIds: string[];
  transcricaoIds: string[];
}

export function chavesVazias(pessoaId: string): ChavesDoTitular {
  return { pessoaId, jornadaIds: [], sessaoIds: [], croquiIds: [], transcricaoIds: [] };
}

export function valoresDoEscopo(chaves: ChavesDoTitular, por: EscopoTitular): string[] {
  switch (por) {
    case "pessoa":
      return [chaves.pessoaId];
    case "jornada":
      return chaves.jornadaIds;
    case "sessao":
      return chaves.sessaoIds;
    case "croqui":
      return chaves.croquiIds;
    case "transcricao":
      return chaves.transcricaoIds;
  }
}

async function contar(
  cliente: SupabaseClient,
  tabela: string,
  coluna: string,
  valores: string[],
): Promise<number | null> {
  if (valores.length === 0) return 0;
  const { count, error } = await cliente
    .from(tabela)
    .select("id", { count: "exact", head: true })
    .in(coluna, valores);
  if (error) return null; // tabela ausente / sem permissão: a tela diz que não contou
  return count ?? 0;
}

/**
 * Uma consulta `head` por tabela (só o cabeçalho de contagem — nenhuma linha
 * de PII trafega), todas em paralelo, todas por coluna indexada.
 */
export async function levantarInventario(
  cliente: SupabaseClient,
  chaves: ChavesDoTitular,
): Promise<LinhaInventario[]> {
  return Promise.all(
    INVENTARIO_TITULAR.map(async (d) => ({
      tabela: d.tabela,
      rotulo: d.rotulo,
      linhas: await contar(cliente, d.tabela, COLUNA_DO_ESCOPO[d.por], valoresDoEscopo(chaves, d.por)),
    })),
  );
}
