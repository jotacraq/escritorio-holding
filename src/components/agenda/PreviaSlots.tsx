"use client";

import { useCallback, useMemo, useState } from "react";
import { useRecurso } from "@/hooks/useRecurso";
import { Campo, Selecao } from "@/components/ui/Campo";
import { Cartao } from "@/components/ui/Cartao";
import { EsqueletoCartao } from "@/components/ui/Esqueleto";
import { EstadoErro, EstadoVazio } from "@/components/ui/Estado";
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
    <Cartao
      rotulo="Conferência"
      titulo="Prévia dos horários livres"
      descricao="É isto que resulta das janelas e bloqueios acima, já descontando antecedência mínima e horizonte configurados em Admin. O conjunto que o cliente vê é fixado no momento em que o link é emitido."
      acao={
        <Campo rotulo="Próximos" id="previa-dias" className="w-36">
          <Selecao value={dias} onChange={(e) => setDias(Number(e.target.value))}>
            <option value={7}>7 dias</option>
            <option value={14}>14 dias</option>
            <option value={30}>30 dias</option>
          </Selecao>
        </Campo>
      }
    >
      {carregando && !dados && <EsqueletoCartao quantidade={3} rotulo="Calculando horários…" />}
      {!carregando && Boolean(erro) && <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não deu para calcular os horários" />}
      {!carregando && !erro && grupos && grupos.size === 0 && (
        <EstadoVazio compacto titulo="Nenhum horário livre neste período" descricao="Confira se há janela ativa cobrindo estes dias e se bloqueios não tomaram o período inteiro." />
      )}
      {!carregando && !erro && grupos && grupos.size > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[...grupos.entries()].map(([dia, slots]) => (
            <div key={dia} className="rounded-controle border border-linha bg-papel p-3">
              <p className="mb-2 text-rotulo font-medium uppercase text-tinta-fraca">{dia}</p>
              <ul className="flex flex-wrap gap-1.5" aria-label={`Horários em ${dia}`}>
                {slots.map((s) => (
                  <li key={s.inicio_em} className="rounded-full border border-linha-forte bg-papel-elevado px-2.5 py-1 text-xs font-medium tabular-nums text-tinta">
                    {formatarHora(s.inicio_em)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Cartao>
  );
}
