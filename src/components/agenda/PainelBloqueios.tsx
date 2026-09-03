"use client";

import { useCallback, useState } from "react";
import { useRecurso } from "@/hooks/useRecurso";
import { Botao } from "@/components/ui/Botao";
import { EstadoCarregando, EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { formatarDataHora } from "@/lib/formatar";
import type { AgendaBloqueio } from "@/types/agenda";
import { ApiError, cancelarBloqueio, listarBloqueios } from "./api";
import { FormularioBloqueio } from "./FormularioBloqueio";
import { SeletorAdvogada, useMembrosComAgenda } from "./SeletorAdvogada";

function LinhaBloqueio({ bloqueio, aoAtualizar }: { bloqueio: AgendaBloqueio; aoAtualizar: () => void }) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function cancelar() {
    setOcupado(true);
    setErro(null);
    try {
      await cancelarBloqueio(bloqueio.id);
      aoAtualizar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível cancelar este bloqueio.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-linha bg-papel-elevado p-3">
      <div>
        <p className="font-medium text-tinta">
          {formatarDataHora(bloqueio.inicio_em)} — {formatarDataHora(bloqueio.fim_em)}
        </p>
        <p className="text-xs text-tinta-suave">{bloqueio.motivo}</p>
        {erro && <p role="alert" className="text-xs text-[color:var(--vermelho)]">{erro}</p>}
      </div>
      {!bloqueio.cancelado_em ? (
        <Botao variante="perigo" className="text-xs" carregando={ocupado} onClick={cancelar}>
          Cancelar bloqueio
        </Botao>
      ) : (
        <span className="text-xs text-tinta-fraca">Cancelado em {formatarDataHora(bloqueio.cancelado_em)}</span>
      )}
    </li>
  );
}

/** Folga, feriado, compromisso fora da agenda — baixa por cancelamento
 * (`cancelado_em`), nunca apagando (mesma convenção do schema inteiro). */
export function PainelBloqueios() {
  const membros = useMembrosComAgenda();
  const [advogadaId, setAdvogadaId] = useState("");
  const efetiva = advogadaId || membros?.[0]?.id || "";

  const buscar = useCallback(() => listarBloqueios({ advogada_id: efetiva || undefined }), [efetiva]);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, [efetiva]);

  if (membros === null) return <EstadoCarregando rotulo="Carregando equipe…" />;
  if (membros.length === 0) {
    return <EstadoVazio titulo="Nenhum membro de equipe cadastrado" descricao="Cadastre a advogada em Admin → Equipe antes de configurar bloqueios." />;
  }

  return (
    <div className="flex flex-col gap-4">
      <SeletorAdvogada membros={membros} valor={efetiva} aoMudar={setAdvogadaId} id="bloq-advogada" />

      {efetiva && (
        <>
          <FormularioBloqueio advogadaId={efetiva} aoCriar={recarregar} />

          {carregando && <EstadoCarregando rotulo="Carregando bloqueios…" />}
          {!carregando && erro && <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não deu para carregar os bloqueios" />}
          {!carregando && !erro && dados && dados.bloqueios.length === 0 && (
            <EstadoVazio titulo="Nenhum bloqueio ativo" descricao="Toda a disponibilidade das janelas está de pé, sem exceção." />
          )}
          {!carregando && !erro && dados && dados.bloqueios.length > 0 && (
            <ul className="flex flex-col gap-2">
              {dados.bloqueios.map((b) => (
                <LinhaBloqueio key={b.id} bloqueio={b} aoAtualizar={recarregar} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
