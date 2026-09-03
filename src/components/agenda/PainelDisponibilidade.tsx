"use client";

import { useCallback, useState } from "react";
import { useRecurso } from "@/hooks/useRecurso";
import { Botao } from "@/components/ui/Botao";
import { Selo } from "@/components/ui/Selo";
import { EstadoCarregando, EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { ApiError, atualizarDisponibilidade, listarDisponibilidades } from "./api";
import { ROTULO_DIA_SEMANA, formatarDataCalendario, formatarHoraSql } from "./rotulos";
import { FormularioDisponibilidade } from "./FormularioDisponibilidade";
import { SeletorAdvogada, useMembrosComAgenda } from "./SeletorAdvogada";
import { PreviaSlots } from "./PreviaSlots";

function LinhaDisponibilidade({ disponibilidade, aoAtualizar }: { disponibilidade: import("@/types/agenda").Disponibilidade; aoAtualizar: () => void }) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function alternarAtiva() {
    setOcupado(true);
    setErro(null);
    try {
      await atualizarDisponibilidade(disponibilidade.id, { ativa: !disponibilidade.ativa });
      aoAtualizar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível atualizar esta janela.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-linha bg-papel-elevado p-3">
      <div>
        <p className="font-medium text-tinta">
          {ROTULO_DIA_SEMANA[disponibilidade.dia_semana]} · {formatarHoraSql(disponibilidade.hora_inicio)}–{formatarHoraSql(disponibilidade.hora_fim)}
        </p>
        <p className="text-xs text-tinta-suave">
          Sessões de {disponibilidade.duracao_minutos} min · vale de {formatarDataCalendario(disponibilidade.vale_de)}
          {disponibilidade.vale_ate ? ` até ${formatarDataCalendario(disponibilidade.vale_ate)}` : ", sem data de término"}
        </p>
        {erro && <p role="alert" className="text-xs text-[color:var(--vermelho)]">{erro}</p>}
      </div>
      <div className="flex items-center gap-2">
        <Selo tom={disponibilidade.ativa ? "verde" : "neutro"}>{disponibilidade.ativa ? "Ativa" : "Inativa"}</Selo>
        <Botao variante="fantasma" className="text-xs" carregando={ocupado} onClick={alternarAtiva}>
          {disponibilidade.ativa ? "Desativar" : "Reativar"}
        </Botao>
      </div>
    </li>
  );
}

export function PainelDisponibilidade() {
  const membros = useMembrosComAgenda();
  const [advogadaId, setAdvogadaId] = useState("");

  const efetiva = advogadaId || membros?.[0]?.id || "";

  const buscar = useCallback(() => listarDisponibilidades({ advogada_id: efetiva || undefined }), [efetiva]);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, [efetiva]);

  // A prévia de slots é um componente à parte, com seu próprio fetch — criar
  // ou (des)ativar uma janela não muda as PROPS dela (mesma advogada, mesmo
  // período), então sem isto ela ficaria mostrando um cálculo desatualizado
  // até a página recarregar. `key` força remontar (= refazer o cálculo) só
  // quando algo aqui embaixo de fato muda.
  const [versaoSlots, setVersaoSlots] = useState(0);
  function aoMudarJanelas() {
    recarregar();
    setVersaoSlots((v) => v + 1);
  }

  if (membros === null) return <EstadoCarregando rotulo="Carregando equipe…" />;
  if (membros.length === 0) {
    return <EstadoVazio titulo="Nenhum membro de equipe cadastrado" descricao="Cadastre a advogada em Admin → Equipe antes de configurar a agenda." />;
  }

  return (
    <div className="flex flex-col gap-4">
      <SeletorAdvogada membros={membros} valor={efetiva} aoMudar={setAdvogadaId} id="disp-advogada" />

      {efetiva && (
        <>
          <FormularioDisponibilidade advogadaId={efetiva} aoCriar={aoMudarJanelas} />

          {carregando && <EstadoCarregando rotulo="Carregando janelas…" />}
          {!carregando && erro && <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não deu para carregar as janelas" />}
          {!carregando && !erro && dados && dados.disponibilidades.length === 0 && (
            <EstadoVazio titulo="Nenhuma janela de disponibilidade" descricao="Adicione ao menos uma janela para que o link de agendamento tenha horário para oferecer." />
          )}
          {!carregando && !erro && dados && dados.disponibilidades.length > 0 && (
            <ul className="flex flex-col gap-2">
              {dados.disponibilidades.map((d) => (
                <LinhaDisponibilidade key={d.id} disponibilidade={d} aoAtualizar={aoMudarJanelas} />
              ))}
            </ul>
          )}

          <PreviaSlots key={versaoSlots} advogadaId={efetiva} />
        </>
      )}
    </div>
  );
}
