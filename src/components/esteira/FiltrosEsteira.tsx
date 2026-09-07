"use client";

import { useState } from "react";
import type { FiltrosJornadas, MembroEquipe, OrigemLead } from "@/lib/api";
import { Botao } from "@/components/ui/Botao";
import { Campo, Entrada, Opcao, Selecao } from "@/components/ui/Campo";
import { rotulo as rotuloDe } from "@/lib/vocabulario";
import { ORDEM_FASES, ROTULO_FASE, type ChaveFase } from "./sessaoDaEtapa";

const ROTULOS_ORIGEM: Record<OrigemLead, string> = {
  seminario: "Seminário",
  indicacao: "Indicação",
  organico: "Orgânico",
  trafego_pago: "Tráfego pago",
  outro: "Outro",
};

export interface OpcaoEdicao {
  id: string;
  codigo: string;
}

export function haFiltroAtivo(filtros: FiltrosJornadas, mostrarFechadas: boolean, fase: ChaveFase | null = null): boolean {
  return Boolean(filtros.busca || filtros.edicao_id || filtros.origem || filtros.responsavel_id || mostrarFechadas || fase);
}

/**
 * Os filtros da lista de Clientes.
 *
 * ## Fase 8 — duas mudanças
 *
 * **(1) Filtro por Fase** (item 9 da pesquisa). O ADVBOX abre a lista com
 * filtro por fase processual, e era o que faltava aqui: dava para buscar por
 * nome, edição, origem e responsável, mas não para perguntar "quem está no
 * Croqui?" — a pergunta que organiza a semana. A fase é o agrupamento nas três
 * sessões que o quadro já mostrava em faixas; o filtro só o traz para a lista.
 * Ele é de TELA, não de rota: `GET /api/jornadas` filtra por uma etapa só e uma
 * fase são até cinco. Filtrar aqui mantém a contagem coerente com o que a
 * página carregou — o mesmo recorte que o resumo por etapa e o quadro usam.
 *
 * **(2) Hierarquia no celular.** A 360 px os quatro campos empilhados ocupavam
 * a dobra inteira: quem abria "Clientes" no telefone via cinco filtros antes da
 * primeira linha da lista. Agora ficam sempre visíveis os dois que respondem
 * "achar" e "recortar" — busca e fase —, e os outros esperam "Mais filtros",
 * que mostra **quantos estão ligados** para nenhum filtro agir escondido
 * (heurística #6). A partir de `md` não há botão nenhum: tudo aparece, como
 * antes.
 */
export function FiltrosEsteira({
  filtros,
  aoMudar,
  aoLimpar,
  opcoesEdicoes,
  equipe,
  mostrarFechadas,
  aoAlternarFechadas,
  fase,
  aoMudarFase,
  contagemPorFase,
}: {
  filtros: FiltrosJornadas;
  aoMudar: (parcial: Partial<FiltrosJornadas>) => void;
  aoLimpar: () => void;
  opcoesEdicoes: OpcaoEdicao[];
  equipe: MembroEquipe[] | null;
  mostrarFechadas: boolean;
  aoAlternarFechadas: (valor: boolean) => void;
  /** `null` = todas as fases. */
  fase: ChaveFase | null;
  aoMudarFase: (fase: ChaveFase | null) => void;
  /** Quantos processos em cada fase, no recorte carregado. */
  contagemPorFase: Readonly<Record<ChaveFase, number>>;
}) {
  const ativo = haFiltroAtivo(filtros, mostrarFechadas, fase);
  const [maisAberto, setMaisAberto] = useState(false);
  const quantosSecundarios = [filtros.edicao_id, filtros.origem, filtros.responsavel_id, mostrarFechadas || undefined].filter(Boolean).length;

  return (
    <form role="search" aria-label="Filtrar a esteira" noValidate onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-item">
      {/* Linha 1 — busca. É o caminho de quem chega com um nome na cabeça, e por isso fica sempre visível, inclusive no celular. */}
      <div className="flex flex-wrap items-end gap-item">
        <div className="min-w-0 flex-1 basis-64">
          <Campo rotulo="Buscar por nome" id="filtro-busca">
            <Entrada type="search" value={filtros.busca ?? ""} onChange={(e) => aoMudar({ busca: e.target.value || undefined })} placeholder="Nome da pessoa…" autoComplete="off" />
          </Campo>
        </div>
        <button
          type="button"
          aria-expanded={maisAberto}
          aria-controls="filtros-secundarios"
          onClick={() => setMaisAberto((v) => !v)}
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-controle border border-linha-forte bg-papel-elevado px-3.5 text-sm font-medium text-tinta transition-colors duration-[var(--transicao-rapida)] hover:border-[color:var(--latao)] md:hidden"
        >
          {maisAberto ? "Menos filtros" : "Mais filtros"}
          {quantosSecundarios > 0 && <span className="rounded-full bg-latao-fraco px-2 py-0.5 text-legenda font-bold tabular-nums">{quantosSecundarios}</span>}
        </button>
      </div>

      {/* Fase — botões, não um `<select>`: o valor ativo fica SEMPRE visível e
          cada fase mostra quantos estão nela. `aria-pressed` diz o estado a
          quem não vê o realce, e o número está no texto: nunca só cor. */}
      <fieldset className="flex flex-wrap items-center gap-alvo border-0 p-0">
        <legend className="sr-only">Filtrar por {rotuloDe("fase").toLowerCase()}</legend>
        <span aria-hidden="true" className="text-rotulo font-medium uppercase text-tinta-fraca">
          {rotuloDe("fase")}
        </span>
        {([null, ...ORDEM_FASES] as (ChaveFase | null)[]).map((opcao) => {
          const ativa = fase === opcao;
          const texto = opcao === null ? "Todas" : ROTULO_FASE[opcao];
          const quantidade = opcao === null ? null : contagemPorFase[opcao];
          return (
            <button
              key={opcao ?? "todas"}
              type="button"
              aria-pressed={ativa}
              onClick={() => aoMudarFase(opcao)}
              className={`inline-flex min-h-11 items-center gap-2 rounded-pilula border px-3.5 text-sm transition-[border-color,box-shadow] duration-[var(--transicao-rapida)] ${
                ativa ? "border-[color:var(--latao)] bg-latao-fraco font-bold text-tinta" : "border-linha-forte bg-papel-elevado font-medium text-tinta hover:border-[color:var(--latao)]"
              }`}
            >
              {texto}
              {quantidade !== null && <span className="text-legenda font-bold tabular-nums text-tinta-suave">{quantidade}</span>}
            </button>
          );
        })}
      </fieldset>

      <div
        id="filtros-secundarios"
        className={`${maisAberto ? "grid" : "hidden"} grid-cols-1 items-end gap-x-4 gap-y-4 sm:grid-cols-2 md:grid xl:grid-cols-[1fr_1fr_1fr_auto]`}
      >
        <Campo rotulo="Edição do seminário" id="filtro-edicao">
          <Selecao value={filtros.edicao_id ?? ""} onChange={(e) => aoMudar({ edicao_id: e.target.value || undefined })}>
            <option value="">Todas</option>
            {opcoesEdicoes.map((op) => (
              <option key={op.id} value={op.id}>
                {op.codigo}
              </option>
            ))}
          </Selecao>
        </Campo>

        <Campo rotulo="Origem" id="filtro-origem">
          <Selecao value={filtros.origem ?? ""} onChange={(e) => aoMudar({ origem: (e.target.value || undefined) as OrigemLead | undefined })}>
            <option value="">Todas</option>
            {(Object.keys(ROTULOS_ORIGEM) as OrigemLead[]).map((valor) => (
              <option key={valor} value={valor}>
                {ROTULOS_ORIGEM[valor]}
              </option>
            ))}
          </Selecao>
        </Campo>

        <Campo rotulo="Responsável" id="filtro-responsavel" ajuda={equipe && equipe.length === 0 ? "Nenhum membro ativo cadastrado." : undefined}>
          <Selecao value={filtros.responsavel_id ?? ""} onChange={(e) => aoMudar({ responsavel_id: e.target.value || undefined })} disabled={!equipe || equipe.length === 0}>
            <option value="">{equipe && equipe.length > 0 ? "Todos" : equipe === null ? "Carregando…" : "Indisponível"}</option>
            {equipe?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome}
              </option>
            ))}
          </Selecao>
        </Campo>

        <div className="flex flex-wrap items-end gap-2">
          <Opcao tipo="checkbox" rotulo="Incluir encerrados" checked={mostrarFechadas} onChange={(e) => aoAlternarFechadas(e.target.checked)} className="min-w-0" />
          {ativo && (
            <Botao variante="fantasma" onClick={aoLimpar}>
              Limpar filtros
            </Botao>
          )}
        </div>
      </div>
    </form>
  );
}
