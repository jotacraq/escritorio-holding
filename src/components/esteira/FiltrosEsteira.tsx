"use client";

import type { FiltrosJornadas, MembroEquipe, OrigemLead } from "@/lib/api";

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

export function FiltrosEsteira({
  filtros,
  aoMudar,
  opcoesEdicoes,
  equipe,
  mostrarFechadas,
  aoAlternarFechadas,
}: {
  filtros: FiltrosJornadas;
  aoMudar: (parcial: Partial<FiltrosJornadas>) => void;
  opcoesEdicoes: OpcaoEdicao[];
  equipe: MembroEquipe[] | null;
  mostrarFechadas: boolean;
  aoAlternarFechadas: (valor: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-linha pb-4">
      <div className="flex min-w-[220px] flex-1 flex-col gap-1">
        <label htmlFor="filtro-busca" className="text-xs font-medium text-tinta-suave">
          Buscar por nome
        </label>
        <input
          id="filtro-busca"
          type="search"
          defaultValue={filtros.busca ?? ""}
          onChange={(e) => aoMudar({ busca: e.target.value || undefined })}
          placeholder="Nome da pessoa…"
          className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5 text-sm text-tinta placeholder:text-tinta-fraca"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="filtro-edicao" className="text-xs font-medium text-tinta-suave">
          Edição do seminário
        </label>
        <select
          id="filtro-edicao"
          value={filtros.edicao_id ?? ""}
          onChange={(e) => aoMudar({ edicao_id: e.target.value || undefined })}
          className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5 text-sm text-tinta"
        >
          <option value="">Todas</option>
          {opcoesEdicoes.map((op) => (
            <option key={op.id} value={op.id}>
              {op.codigo}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="filtro-origem" className="text-xs font-medium text-tinta-suave">
          Origem
        </label>
        <select
          id="filtro-origem"
          value={filtros.origem ?? ""}
          onChange={(e) => aoMudar({ origem: (e.target.value || undefined) as OrigemLead | undefined })}
          className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5 text-sm text-tinta"
        >
          <option value="">Todas</option>
          {(Object.keys(ROTULOS_ORIGEM) as OrigemLead[]).map((valor) => (
            <option key={valor} value={valor}>
              {ROTULOS_ORIGEM[valor]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="filtro-responsavel" className="text-xs font-medium text-tinta-suave">
          Responsável
        </label>
        <select
          id="filtro-responsavel"
          value={filtros.responsavel_id ?? ""}
          onChange={(e) => aoMudar({ responsavel_id: e.target.value || undefined })}
          disabled={!equipe || equipe.length === 0}
          className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5 text-sm text-tinta disabled:opacity-50"
        >
          <option value="">{equipe && equipe.length > 0 ? "Todos" : "Indisponível"}</option>
          {equipe?.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nome}
            </option>
          ))}
        </select>
      </div>

      <label className="flex items-center gap-2 pb-1.5 text-sm text-tinta">
        <input
          type="checkbox"
          checked={mostrarFechadas}
          onChange={(e) => aoAlternarFechadas(e.target.checked)}
          className="h-4 w-4 rounded-sm border-linha-forte accent-[color:var(--latao)]"
        />
        Mostrar fechadas
      </label>
    </div>
  );
}
