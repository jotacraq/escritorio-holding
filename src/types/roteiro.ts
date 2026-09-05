/**
 * Tipos de `roteiros_versoes` (0030) e de `ofertas` (0011 — tabela já existia,
 * mas nunca tinha tela nem tipo: fora da fronteira de `banco.ts`, que cobre
 * 0001-0008/0014-0016; ver comentário de topo daquele arquivo. `Oferta` mora
 * aqui porque a única rota que a escreve — `POST /api/jornadas/[id]/ofertas`
 * — é desta entrega).
 *
 * `SessaoViabilidade`/`LigacaoEstrategica` ganharam coluna nova em 0030
 * (`roteiro_versao_id`, e `sims` em sessão) — em vez de editar `banco.ts`
 * (fora da minha fronteira), estendo por composição aqui. Import de tipo é
 * livre; edição do arquivo não.
 */

import type { LigacaoEstrategica, SessaoViabilidade } from "@/types/banco";

// ---------------------------------------------------------------------------
// roteiros_versoes (0030)
// ---------------------------------------------------------------------------

export type ChaveRoteiro = "sessao_viabilidade" | "pop_03" | "pop_03b";

/** As 4 falas do 1º bloco de `sessao_viabilidade` carregam este marcador —
 * é a chave que `registrar_sim_sessao` usa para achar o texto congelado do
 * 1º SIM. Os outros blocos/falas nunca têm este campo. */
export type SimIdentificador = "sigilo_gravacao" | "licitude" | "decisores" | "proximo_passo";

export interface RoteiroFala {
  id: string;
  locutor: string | null;
  texto: string;
  sim?: SimIdentificador;
  rotulo_sim?: string;
}

export interface RoteiroCampo {
  id: string;
  rotulo: string;
  tipo: string;
  opcoes?: string[];
}

export interface RoteiroBloco {
  id: string;
  titulo: string;
  objetivo: string | null;
  acao: string | null;
  falas: RoteiroFala[];
  campos: RoteiroCampo[];
  observar: string[];
  proibido: string[];
}

export interface RoteiroDefinicao {
  blocos: RoteiroBloco[];
}

/** Linha completa — inclui `definicao` (pode passar de 20 KB na v4 do script). */
export interface RoteiroVersao {
  id: string;
  chave: ChaveRoteiro;
  versao: number;
  titulo: string;
  definicao: RoteiroDefinicao;
  ativo: boolean;
  notas: string | null;
  criado_em: string;
  criado_por: string | null;
}

/** Lista — SEM `definicao` (mesmo corte de `PromptVersaoResumo` em `admin.ts`:
 * payload pesado, a tela de detalhe busca a versão completa). */
export type RoteiroVersaoResumo = Omit<RoteiroVersao, "definicao">;

// ---------------------------------------------------------------------------
// Os 4 SIMs (POP 05) — sessoes_viabilidade.sims (0030)
// ---------------------------------------------------------------------------

export interface SimEstado {
  ok: boolean;
  em: string;
  registrado_por: string | null;
}

/** Só 3 chaves — o 1º SIM (sigilo/gravação) NUNCA mora aqui, vira linha em
 * `consentimentos` (ver NOTA da migration 0030). */
export interface SimsSessao {
  licitude?: SimEstado;
  decisores?: SimEstado;
  proximo_passo?: SimEstado;
}

/** `sessoes_viabilidade` com as colunas que a 0030 acrescentou. */
export interface SessaoViabilidadeComRoteiro extends SessaoViabilidade {
  roteiro_versao_id: string | null;
  sims: SimsSessao;
}

/** `ligacoes_estrategicas` com a coluna que a 0030 acrescentou. */
export interface LigacaoEstrategicaComRoteiro extends LigacaoEstrategica {
  roteiro_versao_id: string | null;
}

/** Resposta de `POST /api/sessoes/[id]/sims` quando `sim` é `sigilo_gravacao`:
 * o registro fica em `consentimentos`, devolvido junto para a tela não
 * precisar de uma segunda chamada. */
export interface ConsentimentoGravacao {
  id: string;
  pessoa_id: string;
  concedido: boolean;
  texto_apresentado: string;
  versao_texto: string;
  canal: string;
  registrado_por: string | null;
  concedido_em: string;
}

// ---------------------------------------------------------------------------
// ofertas (0011) — primeira tela/tipo/rota desta tabela (CONFLITO C8)
// ---------------------------------------------------------------------------

export type CondicaoOferta = "padrao" | "incentivo_resolvedor";

export interface Oferta {
  id: string;
  jornada_id: string;
  produto_id: string;
  valor_padrao: number;
  valor_ofertado: number;
  condicao: CondicaoOferta;
  valida_ate: string | null;
  ofertada_em: string;
  ofertada_por: string | null;
  aceita: boolean | null;
  criado_em: string;
}
