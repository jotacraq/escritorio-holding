"use client";

import type { FiltrosJornadas, MembroEquipe, OrigemLead } from "@/lib/api";
import { Botao } from "@/components/ui/Botao";
import { Campo, Entrada, Opcao, Selecao } from "@/components/ui/Campo";

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

export function haFiltroAtivo(filtros: FiltrosJornadas, mostrarFechadas: boolean): boolean {
  return Boolean(filtros.busca || filtros.edicao_id || filtros.origem || filtros.responsavel_id || mostrarFechadas);
}

export function FiltrosEsteira({
  filtros,
  aoMudar,
  aoLimpar,
  opcoesEdicoes,
  equipe,
  mostrarFechadas,
  aoAlternarFechadas,
}: {
  filtros: FiltrosJornadas;
  aoMudar: (parcial: Partial<FiltrosJornadas>) => void;
  aoLimpar: () => void;
  opcoesEdicoes: OpcaoEdicao[];
  equipe: MembroEquipe[] | null;
  mostrarFechadas: boolean;
  aoAlternarFechadas: (valor: boolean) => void;
}) {
  const ativo = haFiltroAtivo(filtros, mostrarFechadas);

  return (
    <form
      role="search"
      aria-label="Filtrar a esteira"
      noValidate
      onSubmit={(e) => e.preventDefault()}
      className="grid grid-cols-1 items-end gap-x-4 gap-y-4 sm:grid-cols-2 xl:grid-cols-[minmax(220px,1.4fr)_1fr_1fr_1fr_auto]"
    >
      <Campo rotulo="Buscar por nome" id="filtro-busca">
        <Entrada type="search" value={filtros.busca ?? ""} onChange={(e) => aoMudar({ busca: e.target.value || undefined })} placeholder="Nome da pessoa…" autoComplete="off" />
      </Campo>

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
        <Opcao tipo="checkbox" rotulo="Mostrar fechadas" checked={mostrarFechadas} onChange={(e) => aoAlternarFechadas(e.target.checked)} className="min-w-0" />
        {ativo && (
          <Botao variante="fantasma" onClick={aoLimpar}>
            Limpar filtros
          </Botao>
        )}
      </div>
    </form>
  );
}
