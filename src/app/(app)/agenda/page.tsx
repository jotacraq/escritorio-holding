"use client";

import { CabecalhoPagina } from "@/components/ui/CabecalhoPagina";
import { Abas, type DefinicaoAba } from "@/components/ui/Abas";
import { ListaSessoes } from "@/components/agenda/ListaSessoes";
import { PainelDisponibilidade } from "@/components/agenda/PainelDisponibilidade";
import { PainelBloqueios } from "@/components/agenda/PainelBloqueios";

export default function PaginaAgenda() {
  const abas: DefinicaoAba[] = [
    { id: "sessoes", rotulo: "Sessões", conteudo: <ListaSessoes /> },
    { id: "disponibilidade", rotulo: "Horários livres", conteudo: <PainelDisponibilidade /> },
    { id: "bloqueios", rotulo: "Bloqueios", conteudo: <PainelBloqueios /> },
  ];

  return (
    <div className="flex flex-col gap-8">
      <CabecalhoPagina
        rotulo="Dia a dia"
        titulo="Agenda"
        descricao="As Sessões de Viabilidade dos próximos dias e quem já confirmou presença. Nas outras abas, os horários livres da advogada e os bloqueios — é daí que saem as opções que o cliente vê no link de agendamento."
      />

      <Abas abas={abas} abaInicial="sessoes" deepLinkHash semMoldura />
    </div>
  );
}
