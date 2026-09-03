"use client";

import { listarProximosAgendamentos } from "@/lib/api";
import { useRecurso } from "@/hooks/useRecurso";
import { EstadoCarregando, EstadoIndisponivel, EstadoVazio } from "@/components/ui/Estado";
import { LinhaAgendamento } from "@/components/agenda/LinhaAgendamento";

export default function PaginaAgenda() {
  const { dados, carregando, recarregar } = useRecurso(listarProximosAgendamentos, []);
  const itens = dados?.itens;
  const indisponivel = dados === null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-tinta">Agenda</h1>
        <p className="text-sm text-tinta-suave">Próximas Sessões de Viabilidade. Criar e remarcar acontece na ficha de cada jornada.</p>
      </div>

      {carregando && <EstadoCarregando rotulo="Carregando agenda…" />}

      {!carregando && indisponivel && <EstadoIndisponivel titulo="Lista global de agendamentos ainda não disponível" />}

      {!carregando && itens && itens.length === 0 && (
        <EstadoVazio titulo="Nenhum agendamento próximo" descricao="Agende uma Sessão de Viabilidade a partir da ficha da jornada." />
      )}

      {!carregando && itens && itens.length > 0 && (
        <ul className="flex flex-col gap-2">
          {itens.map((a) => (
            <LinhaAgendamento key={a.id} agendamento={a} aoAtualizar={recarregar} mostrarPessoa />
          ))}
        </ul>
      )}
    </div>
  );
}
