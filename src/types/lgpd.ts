/**
 * Direitos do titular (LGPD art. 18) — contratos de `/api/admin/titulares/**`.
 * Migrations 0079 (valor de enum) e 0080 (tabela + RPCs).
 *
 * Regra que atravessa este arquivo: **seção sem registro é lista vazia**, nunca
 * zero inventado, nunca placeholder. Quem lê o dossiê tem de conseguir provar o
 * que o sistema guardava — e o que ele nunca guardou.
 */

export type TipoSolicitacaoTitular = "exportacao" | "anonimizacao";

export const CANAIS_PEDIDO_TITULAR = [
  "email",
  "whatsapp",
  "telefone",
  "presencial",
  "oficio",
  "iniciativa_do_escritorio",
] as const;

export type CanalPedidoTitular = (typeof CANAIS_PEDIDO_TITULAR)[number];

export interface ResultadoSolicitacao {
  /** `{"familiares": 3, "documentos": 2, …}` — o que a RPC alterou. */
  tabelas?: Record<string, number>;
  /** Caminhos no Storage que ainda não foram removidos. */
  storage_pendente?: string[];
  /** Trilha do que JÁ saiu do bucket — acumulada a cada retomada (0081). */
  storage_removido?: string[];
  /**
   * Carimbo do fecho. Só é preenchido quando `storage_pendente` esvazia: um
   * expurgo pela metade não é um expurgo feito, e é esse `null` que mantém a
   * linha na fila de `vw_pendencias_sistema` (0081).
   */
  storage_removido_em?: string | null;
  /** Ex.: `gravacao_e_transcricao_originais_vivem_na_vapi`. */
  avisos?: string[];
}

export interface SolicitacaoTitular {
  id: string;
  pessoa_id: string;
  tipo: TipoSolicitacaoTitular;
  motivo: string;
  base_legal: string;
  canal_pedido: CanalPedidoTitular;
  solicitado_em: string;
  executado_em: string;
  executado_por: string;
  resultado: ResultadoSolicitacao;
  criado_em: string;
}

export interface LinhaInventario {
  tabela: string;
  /** Nome que a tela mostra — vocabulário do negócio, sem nome de tabela. */
  rotulo: string;
  /** `null` quando a contagem falhou (tabela ausente, RLS): vazio é vazio. */
  linhas: number | null;
}

export interface DocumentoDoTitular {
  id: string;
  tipo: string;
  nome_arquivo: string;
  tamanho_bytes: number;
  mime: string;
  criado_em: string;
}

export interface InventarioTitular {
  pessoa: {
    id: string;
    nome: string;
    origem_dado: "real" | "exemplo";
    anonimizada_em: string | null;
  };
  tabelas: LinhaInventario[];
  documentos: DocumentoDoTitular[];
  solicitacoes: SolicitacaoTitular[];
  /** Por que a anonimização está bloqueada, se estiver. `null` = pode. */
  impedimento: { codigo: string; mensagem: string } | null;
}

// ---------------------------------------------------------------------------
// Dossiê exportado (JSON e PDF saem da MESMA estrutura)
// ---------------------------------------------------------------------------

export interface PerguntaRespondida {
  id: string;
  rotulo: string;
  resposta_valor: unknown;
  resposta_rotulo: string;
}

export interface SecaoFormularioDossie {
  formulario_id: string;
  chave: string;
  versao: number;
  respondido_em: string;
  perguntas: PerguntaRespondida[];
}

export interface MetadadosDossie {
  gerado_em: string;
  gerado_por: { id: string; nome: string };
  solicitacao_id: string;
  /** 1 = seções nomeadas à mão (até a 0080); 2 = seções derivadas do inventário. */
  versao_esquema: 2;
  sistema: "SIC-HF";
  /** `configuracoes['escritorio.razao_social']`; `null` quando não configurado. */
  controlador: string | null;
  tabelas_incluidas: string[];
  /** Sempre explícitas. O que NÃO está no pacote é dito, não omitido. */
  observacoes: string[];
}

/** Uma tabela do inventário virando bloco legível do pacote. */
export interface SecaoDossie {
  tabela: string;
  /** Vocabulário do negócio — o mesmo rótulo que a tela do inventário mostra. */
  rotulo: string;
  /** Sem registro é `[]`, nunca zero inventado. */
  linhas: Record<string, unknown>[];
}

/**
 * BLOQUEIO B47 — o que a EQUIPE e a IA escreveram SOBRE o titular, separado do
 * que o titular declarou. Entra no pacote por padrão (é dado pessoal dele);
 * retirar de uma entrega específica é decisão da Dra. Elaine, registrada no
 * pedido.
 */
export interface AnotacoesInternasDossie {
  aviso: string;
  secoes: SecaoDossie[];
}

export interface DossieTitular {
  _metadados: MetadadosDossie;
  /** Cadastro, sem as colunas que viraram anotação interna. */
  pessoa: Record<string, unknown> | null;
  formularios: SecaoFormularioDossie[];
  documentos: DocumentoDoTitular[];
  /** Uma seção por tabela do inventário, na ordem do inventário. */
  secoes: SecaoDossie[];
  anotacoes_internas: AnotacoesInternasDossie;
}
export interface RespostaAnonimizacao {
  solicitacao: SolicitacaoTitular;
  ja_anonimizada: boolean;
  storage: { removidos: number; falhos: string[] };
}
