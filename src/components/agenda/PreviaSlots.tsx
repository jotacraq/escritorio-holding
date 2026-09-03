"use client";

import { useCallback, useMemo, useState } from "react";
import { useRecurso } from "@/hooks/useRecurso";
import { EstadoCarregando, EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { formatarData, formatarHora } from "@/lib/formatar";
import { listarSlotsDisponiveis } from "./api";

const DIAS_PADRAO = 7;

function agruparPorDia(slots: { inicio_em: string; fim_em: string }[]): Map<string, typeof slots> {
  const grupos = new Map<string, typeof slots>();
  for (const slot of slots) {
    const chave = formatarData(slot.inicio_em);
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave)!.push(slot);
  }
  return grupos;
}

/**
 * Prévia dos horários que resultam das janelas + bloqueios de hoje — para a
 * advogada conferir ANTES de a oferta ir para o cliente (pedido explícito do
 * briefing). Não é o que o cliente vê (isso é `agendamentos_sugestoes`,
 * pré-computado na emissão do link público); é o cálculo ao vivo de
 * `GET /api/agenda/slots`, uso interno.
 */
export function PreviaSlots({ advogadaId }: { advogadaId: string }) {
  const [dias, setDias] = useState(DIAS_PADRAO);

  const { de, ate } = useMemo(() => {
    const agora = new Date();
    const fim = new Date(agora.getTime() + dias * 24 * 60 * 60 * 1000);
    return { de: agora.toISOString(), ate: fim.toISOString() };
  }, [dias]);

  const buscar = useCallback(() => listarSlotsDisponiveis({ advogada_id: advogadaId, de, ate }), [advogadaId, de, ate]);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, [advogadaId, de, ate]);

  const grupos = dados ? agruparPorDia(dados.slots) : null;

  return (
    <div className="flex flex-col gap-3 rounded-sm border border-linha bg-papel-elevado p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-serif text-base font-semibold text-tinta">Prévia dos horários livres</h2>
          <p className="text-xs text-tinta-suave">
            É isto que resulta das janelas e bloqueios de cima — já descontando antecedência mínima e horizonte
            configurados no sistema (Admin). Não representa o que o cliente vê num link específico: aquele conjunto é
            fixado no momento em que o link é emitido.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-tinta-suave" htmlFor="previa-dias">
          Próximos
          <select
            id="previa-dias"
            value={dias}
            onChange={(e) => setDias(Number(e.target.value))}
            className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1"
          >
            <option value={7}>7 dias</option>
            <option value={14}>14 dias</option>
            <option value={30}>30 dias</option>
          </select>
        </label>
      </div>

      {carregando && <EstadoCarregando rotulo="Calculando horários…" />}
      {!carregando && Boolean(erro) && <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não deu para calcular os horários" />}
      {!carregando && !erro && grupos && grupos.size === 0 && (
        <EstadoVazio
          titulo="Nenhum horário livre neste período"
          descricao="Confira se há janela ativa cobrindo estes dias e se bloqueios não tomaram o período inteiro."
        />
      )}
      {!carregando && !erro && grupos && grupos.size > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[...grupos.entries()].map(([dia, slots]) => (
            <div key={dia} className="rounded-sm border border-linha bg-papel-fundo p-2.5">
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-tinta-fraca">{dia}</p>
              <ul className="flex flex-wrap gap-1.5">
                {slots.map((s) => (
                  <li key={s.inicio_em} className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1 font-mono text-xs text-tinta">
                    {formatarHora(s.inicio_em)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
