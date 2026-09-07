"use client";

import { useMemo, type ReactNode } from "react";
import type { EtapaJornada, EtapaOrdem, JornadaKanban } from "@/lib/api";
import { formatarCidadeUf } from "@/lib/formatar";
import { rotulo } from "@/lib/vocabulario";
import { Tabela, type ColunaTabela } from "@/components/ui/Tabela";
import { Prazo } from "@/components/ui/Prazo";
import { SeloEstado } from "@/components/ui/SeloEstado";
import { SeloDadoExemplo } from "@/components/ui/Selo";
import {
  compraMaisGrave,
  comprasPorJornada,
  prazoMaisProximoPorJornada,
  type CompraDoProcesso,
  type Fonte,
  type PrazoAberto,
} from "@/components/painel/dadosDeUrgencia";
import { MenuMover } from "./MenuMover";
import { faseDaEtapa, ROTULO_FASE } from "./sessaoDaEtapa";

/**
 * A LISTA — a porta da tela de Clientes na Fase 8.
 *
 * O quadro (kanban) continua existindo e não perdeu nada; ele deixou de ser a
 * primeira coisa que aparece. Num sistema jurídico o advogado chega com um
 * nome na cabeça e quer saber **em que pé está aquele processo**: é uma
 * pergunta de lista, não de quadro. Astrea, Projuris, ADVBOX e Clio abrem em
 * lista com "fase" e "prazo" nas colunas; o quadro é a visão de quem gerencia
 * o fluxo, não a de quem atende.
 *
 * Uma fonte, duas formas (`ui/Tabela`): acima de `md` é `<table>` de verdade,
 * com `scope="col"` — o leitor de tela anuncia "Fase: Croqui estrutural" ao
 * andar pelas células. Abaixo, cada linha vira cartão com pares rótulo/valor,
 * e a 360 px não há rolagem horizontal.
 *
 * As cinco colunas respondem, na ordem: **quem · em que fase · como está o
 * croqui · como está o pagamento · o que vence**. Nenhuma delas escolhe cor:
 * todo estado passa pelo catálogo (`SeloEstado`) e todo prazo por `ui/Prazo`.
 *
 * ## A fase do croqui é a MESMA da Ficha
 *
 * A coluna lê `croqui_fase`, que a 0086 acrescentou a `vw_jornada_kanban` a
 * partir de `vw_croqui_estado` — as seis fases do §B1, derivadas uma vez, no
 * banco. Não é o mesmo que `croqui_status`: medido nesta base, um croqui com
 * `status='rascunho'` e uma versão fixada aparece como **Versão fixada**, que
 * é o que está acontecendo de verdade. `croqui_status` fica como reserva para
 * o dia em que a linha vier de uma origem sem a coluna nova; sem nenhum dos
 * dois, `sem_croqui` — e estado que o catálogo não conhece vira "Sem
 * informação", nunca um rótulo plausível.
 */

/** Linha da lista com o que `vw_jornada_kanban` entrega além do tipo declarado em `lib/api`. */
type LinhaJornada = JornadaKanban & {
  /** `croquis.status` da versão mais recente; `null` = não há croqui. */
  croqui_status?: string | null;
  /** As seis fases derivadas (`vw_croqui_estado`) — chega quando a frente do croqui publicar. */
  croqui_fase?: string | null;
};

export interface AcaoDaLinha {
  rotulo: string;
  aoClicar: (jornada: JornadaKanban) => void;
  variante?: "secundario" | "perigo";
  ocupado?: (jornada: JornadaKanban) => boolean;
}

export function TabelaClientes({
  itens,
  etapas,
  fontePrazos,
  fonteCompras,
  idEmMovimento,
  aoMover,
  acaoExtra,
  vazio,
  carregando = false,
  legenda,
}: {
  itens: readonly JornadaKanban[];
  etapas: readonly EtapaOrdem[];
  /** Prazos abertos de todos os processos; `ausente` esconde a coluna. */
  fontePrazos: Fonte<PrazoAberto>;
  /** Compras por processo; `ausente` esconde a coluna. */
  fonteCompras: Fonte<CompraDoProcesso>;
  idEmMovimento?: string | null;
  /** `undefined` = a lista não move ninguém (é o caso dos arquivados). */
  aoMover?: (jornada: JornadaKanban, etapa: EtapaJornada) => void;
  /** Ação própria da lista (ex.: "Desarquivar"). */
  acaoExtra?: AcaoDaLinha;
  vazio?: ReactNode;
  carregando?: boolean;
  legenda: string;
}) {
  const prazoPorJornada = useMemo(
    () => (fontePrazos.situacao === "ok" ? prazoMaisProximoPorJornada(fontePrazos.itens) : new Map<string, PrazoAberto>()),
    [fontePrazos],
  );
  const comprasDaJornada = useMemo(
    () => (fonteCompras.situacao === "ok" ? comprasPorJornada(fonteCompras.itens) : new Map<string, CompraDoProcesso[]>()),
    [fonteCompras],
  );

  const rotuloDaEtapa = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const etapa of etapas) mapa.set(etapa.etapa, etapa.rotulo);
    return mapa;
  }, [etapas]);

  /** As mesmas ações, nos dois formatos — uma fonte, para não divergirem. */
  const acoesDaLinha = (j: JornadaKanban) => (
    <>
      {aoMover && (
        <MenuMover
          etapaAtual={j.etapa}
          etapas={etapas as EtapaOrdem[]}
          ocupado={idEmMovimento === j.id}
          aoEscolher={(destino) => aoMover(j, destino)}
          /* O MESMO verbo do quadro e da lista por etapa (heurística #4): a
             mesma ação nunca muda de nome de uma visão para a outra. */
          rotulo="Mover"
        />
      )}
      {acaoExtra && (
        <button
          type="button"
          disabled={acaoExtra.ocupado?.(j) ?? false}
          onClick={() => acaoExtra.aoClicar(j)}
          className="inline-flex min-h-11 items-center justify-center rounded-controle border border-linha-controle bg-papel-elevado px-3.5 text-sm font-medium text-tinta transition-colors duration-[var(--transicao-rapida)] hover:border-[color:var(--latao)] hover:text-[color:var(--latao)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {acaoExtra.rotulo}
        </button>
      )}
    </>
  );

  const colunas = useMemo<ColunaTabela<LinhaJornada>[]>(() => {
    const base: ColunaTabela<LinhaJornada>[] = [
      {
        chave: "cliente",
        cabecalho: "Cliente",
        // Largura declarada: sem isto, um nome longo empurra a coluna de ação
        // para fora e a tabela passa dos 1440 px (medido).
        classe: "w-[26%] max-w-0",
        celula: (j) => (
          <span className="flex min-w-0 flex-col">
            <span className="flex items-center gap-2">
              <span className="truncate font-bold text-tinta">{j.nome}</span>
              {j.origem_dado === "exemplo" && <SeloDadoExemplo />}
            </span>
            <span className="truncate text-legenda font-normal text-tinta-suave">{formatarCidadeUf(j.cidade, j.uf)}</span>
          </span>
        ),
      },
      {
        // O "matter status" do Clio: onde está, em 1–2 palavras, sem abrir a
        // Ficha. A fase é a das TRÊS sessões; a linha de baixo é a etapa exata.
        chave: "fase",
        cabecalho: rotulo("fase"),
        celula: (j) => (
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium text-tinta">{ROTULO_FASE[faseDaEtapa(j.etapa)]}</span>
            <span className="truncate text-legenda text-tinta-suave">{rotuloDaEtapa.get(j.etapa) ?? j.etapa}</span>
          </span>
        ),
      },
      {
        chave: "croqui",
        cabecalho: "Croqui",
        celula: (j) => (
          <SeloEstado
            dominio="croqui"
            // `croqui_status` nulo é fato, não ausência de informação: a
            // subconsulta da view só devolve nulo quando não existe croqui.
            estado={j.croqui_fase ?? j.croqui_status ?? "sem_croqui"}
          />
        ),
      },
    ];

    if (fonteCompras.situacao !== "ausente") {
      base.push({
        chave: "pagamento",
        cabecalho: "Pagamento",
        celula: (j) => {
          const compras = comprasDaJornada.get(j.id) ?? [];
          const pior = compraMaisGrave(compras);
          if (!pior) return <span className="text-legenda text-tinta-fraca">Sem compra registrada</span>;
          return (
            <span className="flex flex-wrap items-center gap-1">
              <SeloEstado dominio="pagamento" estado={pior.status} detalhe={pior.produto_nome ?? undefined} />
              {compras.length > 1 && <span className="text-legenda text-tinta-fraca">+{compras.length - 1}</span>}
            </span>
          );
        },
      });
    }

    if (fontePrazos.situacao !== "ausente") {
      base.push({
        chave: "prazo",
        cabecalho: rotulo("prazo"),
        celula: (j) => {
          const prazo = prazoPorJornada.get(j.id);
          return <Prazo vence={prazo?.vence_em ?? null} rotulo={prazo?.titulo ?? rotulo("prazo")} />;
        },
      });
    }

    // A coluna de ação não é declarada aqui: a prop `acoes` da `Tabela` (logo
    // abaixo) desenha as MESMAS ações nos dois lugares — última coluna na
    // grade, rodapé no cartão do celular. Era o contorno desta tela, e virou
    // comportamento do componente na rodada FIX da Fase 8.
    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comprasDaJornada, prazoPorJornada, rotuloDaEtapa, fonteCompras.situacao, fontePrazos.situacao, aoMover, acaoExtra, idEmMovimento]);

  return (
    <Tabela
      legenda={legenda}
      colunas={colunas}
      linhas={itens as readonly LinhaJornada[]}
      chaveDaLinha={(j) => j.id}
      hrefDaLinha={(j) => `/jornadas/${j.id}`}
      /* Sem `tituloDoCartao`: assim a `Tabela` usa a PRIMEIRA coluna como
         título do cartão e não a repete nos pares rótulo/valor. Com o título
         próprio, o celular mostrava o nome duas vezes — uma no título e outra
         na linha "CLIENTE" — e perdia a cidade, que vive nessa mesma célula. */
      carregando={carregando}
      vazio={vazio}
      acoes={aoMover || acaoExtra ? acoesDaLinha : undefined}
    />
  );
}
