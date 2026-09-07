"use client";

import { useCallback } from "react";
import { criarClienteNavegador } from "@/lib/supabase/browser";
import { useRecurso } from "@/hooks/useRecurso";

/**
 * Prazos e estado das compras — as duas informações que a Fase 8 exige nas
 * telas de uso diário e que `GET /api/painel` **não** entrega.
 *
 * ## Por que ler o banco direto, e não uma rota
 *
 * A frente de pagamento (PAG) publicou `vw_pagamentos_jornada`
 * (`0084`, `security_invoker = true`, `grant select to authenticated`) e a
 * reação a evento negativo (`0085`) grava uma linha em `tarefas` com
 * `vence_em`. Nenhuma das duas tem rota HTTP nesta rodada, e `src/app/api/**`
 * é fronteira de outro agente na Fase 8 (§G) — abrir rota aqui seria dois
 * agentes escrevendo o mesmo arquivo.
 *
 * Ler do navegador é seguro porque **a RLS é a mesma**: a view é
 * `security_invoker`, `tarefas` tem `tar_sel ... using app.eh_interno()`
 * (0027:335) e o cliente do navegador só carrega a chave publicável
 * (`lib/supabase/browser.ts`). É o mesmo caminho que `useUsuarioAtual` já usa
 * para `perfis_equipe`. Colunas de dinheiro (`valor`, `transacao_externa_id`)
 * **não** são pedidas: a tela precisa do estado, não do extrato.
 *
 * Quando o PAG expuser `GET /api/pagamentos`, troca-se o corpo destas duas
 * funções e nenhuma tela muda.
 *
 * ## Sem polling
 *
 * Uma leitura ao montar e uma sob "Atualizar" — a mesma regra do
 * `usePainelDia`. O egress do Supabase é da organização inteira e já custou
 * caro nesta casa com aba parada fazendo polling.
 */

/* -------------------------------------------------------------------------- */
/* Estado da fonte                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Três situações, não duas. "ausente" é o caso novo desta fase: a migration da
 * outra frente ainda não rodou neste banco. Mostrar "não carregou" aí seria
 * alarme falso — a tela simplesmente não desenha o bloco e diz por quê no
 * console. "indisponivel" continua sendo falha de verdade (permissão, rede),
 * e essa a pessoa precisa ver.
 */
export type Fonte<T> =
  | { situacao: "ok"; itens: T[] }
  | { situacao: "indisponivel"; motivo: string }
  | { situacao: "ausente"; motivo: string };

/** `42P01`/`PGRST205` = relação inexistente; `PGRST200` = relacionamento não encontrado. */
const CODIGOS_DE_AUSENCIA = new Set(["42P01", "PGRST205", "PGRST200", "PGRST204"]);

function classificarErro<T>(erro: { code?: string; message?: string } | null): Fonte<T> | null {
  if (!erro) return null;
  const codigo = erro.code ?? "";
  const motivo = `${codigo}${codigo && erro.message ? ": " : ""}${erro.message ?? ""}` || "erro sem código";
  if (CODIGOS_DE_AUSENCIA.has(codigo)) return { situacao: "ausente", motivo };
  return { situacao: "indisponivel", motivo };
}

/* -------------------------------------------------------------------------- */
/* Prazos (tarefas abertas)                                                    */
/* -------------------------------------------------------------------------- */

export interface PrazoAberto {
  id: string;
  jornada_id: string | null;
  /** `null` em tarefa criada à mão; os tipos de sistema vêm de `0051`/`0085`. */
  tipo: string | null;
  titulo: string;
  descricao: string | null;
  /** Coluna `date` — quem formata é `ui/Prazo`, que trata `date` como data local. */
  vence_em: string | null;
  origem: string | null;
  /** Nome da pessoa do processo, quando a RLS deixa ler a jornada. */
  nome: string | null;
}

interface LinhaTarefa {
  id: string;
  jornada_id: string | null;
  tipo: string | null;
  titulo: string;
  descricao: string | null;
  vence_em: string | null;
  origem: string | null;
  jornadas: { pessoas: { nome: string } | null } | null;
}

/**
 * Tarefas abertas, do prazo mais próximo para o mais distante, com o nome da
 * pessoa vindo pelo relacionamento (`tarefas → jornadas → pessoas`). Sem
 * prazo vai para o fim (`nullsFirst: false`), porque "sem prazo" não é
 * urgente — é indefinido.
 */
export async function buscarPrazosAbertos(limite = 40): Promise<Fonte<PrazoAberto>> {
  const supabase = criarClienteNavegador();
  const { data, error } = await supabase
    .from("tarefas")
    .select("id, jornada_id, tipo, titulo, descricao, vence_em, origem, jornadas(pessoas(nome))")
    .is("concluida_em", null)
    .order("vence_em", { ascending: true, nullsFirst: false })
    .limit(limite);

  const falha = classificarErro<PrazoAberto>(error);
  if (falha) return falha;

  const linhas = (data ?? []) as unknown as LinhaTarefa[];
  return {
    situacao: "ok",
    itens: linhas.map((linha) => ({
      id: linha.id,
      jornada_id: linha.jornada_id,
      tipo: linha.tipo,
      titulo: linha.titulo,
      descricao: linha.descricao,
      vence_em: linha.vence_em,
      origem: linha.origem,
      nome: linha.jornadas?.pessoas?.nome ?? null,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Compras por processo (vw_pagamentos_jornada)                                */
/* -------------------------------------------------------------------------- */

export interface CompraDoProcesso {
  jornada_id: string;
  produto_tipo: string | null;
  produto_nome: string | null;
  /** Valor cru do enum `status_pagamento` — vira selo por `estadoDe("pagamento", …)`. */
  status: string;
  evento_hotmart: string | null;
  evento_em: string | null;
  /** `cancelado | reembolsado | estornado` — o dinheiro voltou. */
  revertido: boolean;
  /** `boleto_gerado | expirado | atrasado` — o dinheiro não entrou ainda. */
  aguardando_dinheiro: boolean;
  /** Só preenchido com `comNomes`; `null` quando a RLS não devolveu a linha. */
  nome?: string | null;
}

export interface OpcoesCompras {
  /** Recorta por processo. Lista vazia devolve `ok` com zero itens, sem ir à rede. */
  jornadaIds?: readonly string[];
  /** Só o que trava: revertido ou aguardando dinheiro. É o recorte do painel do dia. */
  somenteTravadas?: boolean;
  /**
   * Resolve o nome da pessoa numa SEGUNDA consulta, só se houver linha. No dia
   * em que nada trava — que é o dia normal — nenhuma requisição extra sai.
   */
  comNomes?: boolean;
}

/**
 * Estado da compra por (processo, produto). Sem `valor` nem
 * `transacao_externa_id`: a tela mostra em que pé está a compra, não o
 * extrato — menos PII atravessando a rede por princípio.
 */
export async function buscarComprasDosProcessos(opcoes: OpcoesCompras = {}): Promise<Fonte<CompraDoProcesso>> {
  const { jornadaIds, somenteTravadas = false, comNomes = false } = opcoes;
  const supabase = criarClienteNavegador();
  let consulta = supabase
    .from("vw_pagamentos_jornada")
    .select("jornada_id, produto_tipo, produto_nome, status, evento_hotmart, evento_em, revertido, aguardando_dinheiro");

  if (jornadaIds) {
    if (jornadaIds.length === 0) return { situacao: "ok", itens: [] };
    consulta = consulta.in("jornada_id", jornadaIds as string[]);
  }
  if (somenteTravadas) consulta = consulta.or("revertido.eq.true,aguardando_dinheiro.eq.true");

  const { data, error } = await consulta;
  const falha = classificarErro<CompraDoProcesso>(error);
  if (falha) return falha;

  const itens = (data ?? []) as unknown as CompraDoProcesso[];
  if (!comNomes || itens.length === 0) return { situacao: "ok", itens };

  const ids = Array.from(new Set(itens.map((c) => c.jornada_id)));
  const { data: pessoas, error: erroNomes } = await supabase.from("vw_jornada_kanban").select("id, nome").in("id", ids);
  // Falhar aqui não invalida o estado da compra: a linha aparece sem nome (e
  // dizendo que está sem nome), nunca com um nome inventado.
  const mapa = new Map<string, string>();
  if (!erroNomes) for (const linha of (pessoas ?? []) as { id: string; nome: string }[]) mapa.set(linha.id, linha.nome);
  return { situacao: "ok", itens: itens.map((c) => ({ ...c, nome: mapa.get(c.jornada_id) ?? null })) };
}

/* -------------------------------------------------------------------------- */
/* Severidade — a mesma ordem em Hoje, Clientes e Ficha                        */
/* -------------------------------------------------------------------------- */

/**
 * Qual das compras de um processo mandar para a tela quando só cabe uma.
 * A ordem é a da consequência, não a da data: dinheiro que voltou primeiro,
 * dinheiro que não entrou depois, e só então a boa notícia. Sem isto, uma
 * jornada com SV paga e croqui estornado apareceria como "Pago".
 */
export function compraMaisGrave(compras: readonly CompraDoProcesso[]): CompraDoProcesso | null {
  if (compras.length === 0) return null;
  const peso = (c: CompraDoProcesso) => (c.revertido ? 0 : c.aguardando_dinheiro ? 1 : 2);
  return [...compras].sort((a, b) => peso(a) - peso(b))[0];
}

/** Agrupa por processo — é assim que a lista de Clientes e a Ficha consomem. */
export function comprasPorJornada(compras: readonly CompraDoProcesso[]): Map<string, CompraDoProcesso[]> {
  const mapa = new Map<string, CompraDoProcesso[]>();
  for (const compra of compras) {
    const atual = mapa.get(compra.jornada_id);
    if (atual) atual.push(compra);
    else mapa.set(compra.jornada_id, [compra]);
  }
  return mapa;
}

/** Prazo mais próximo por processo — a coluna "Prazo" da lista de Clientes. */
export function prazoMaisProximoPorJornada(prazos: readonly PrazoAberto[]): Map<string, PrazoAberto> {
  const mapa = new Map<string, PrazoAberto>();
  for (const prazo of prazos) {
    if (!prazo.jornada_id) continue;
    const atual = mapa.get(prazo.jornada_id);
    // `vence_em` nulo nunca ganha de uma data: indefinido não é mais urgente.
    if (!atual) mapa.set(prazo.jornada_id, prazo);
    else if (prazo.vence_em && (!atual.vence_em || prazo.vence_em < atual.vence_em)) mapa.set(prazo.jornada_id, prazo);
  }
  return mapa;
}

/* -------------------------------------------------------------------------- */
/* Hooks                                                                        */
/* -------------------------------------------------------------------------- */

/** Prazos abertos. `versao` incrementa no botão "Atualizar" — nunca há polling. */
export function usePrazosAbertos(versao = 0) {
  const buscar = useCallback(() => buscarPrazosAbertos(), []);
  const { dados, carregando, erro } = useRecurso(buscar, [versao]);
  return {
    fonte: dados ?? ({ situacao: "indisponivel", motivo: "carregando" } as Fonte<PrazoAberto>),
    carregando,
    erro,
  };
}

/** Compras dos processos. `jornadaIds` recorta; `undefined` traz tudo que a RLS deixa. */
export function useComprasDosProcessos(opcoes: OpcoesCompras = {}, versao = 0) {
  const { jornadaIds, somenteTravadas = false, comNomes = false } = opcoes;
  const chave = jornadaIds ? jornadaIds.join(",") : "*";
  const buscar = useCallback(
    () =>
      buscarComprasDosProcessos({
        jornadaIds: chave === "*" ? undefined : chave.split(",").filter(Boolean),
        somenteTravadas,
        comNomes,
      }),
    [chave, somenteTravadas, comNomes],
  );
  const { dados, carregando, erro } = useRecurso(buscar, [chave, somenteTravadas, comNomes, versao]);
  return {
    fonte: dados ?? ({ situacao: "indisponivel", motivo: "carregando" } as Fonte<CompraDoProcesso>),
    carregando,
    erro,
  };
}
