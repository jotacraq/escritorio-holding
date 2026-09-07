"use client";

import { CabecalhoPagina } from "@/components/ui/CabecalhoPagina";
import { Abas, type DefinicaoAba } from "@/components/ui/Abas";
import { ListaSessoes } from "@/components/agenda/ListaSessoes";
import { PainelDisponibilidade } from "@/components/agenda/PainelDisponibilidade";
import { PainelBloqueios } from "@/components/agenda/PainelBloqueios";
import { LinkBotao } from "@/components/ui/LinkBotao";

/**
 * Agenda. Fase 6, decisão 5 do João: "onde é que a gente define quais dias a
 * equipe vai estar disponível? achei, mas tem que ser fácil de achar".
 *
 * "Horários livres" virou **"Disponibilidade da equipe"** e ganhou entrada
 * direta em três lugares: a aba, uma ação no cabeçalho da Agenda e a paleta
 * de comandos (Ctrl+K). O deep-link `#disponibilidade` já funcionava.
 */
export default function PaginaAgenda() {
  const abas: DefinicaoAba[] = [
    {
      id: "sessoes",
      rotulo: "Sessões",
      descricao: "As Sessões de Viabilidade marcadas, com quem já confirmou presença e o botão para conduzir.",
      conteudo: <ListaSessoes />,
    },
    {
      id: "disponibilidade",
      rotulo: "Disponibilidade da equipe",
      descricao: "Os dias e horários em que a equipe atende — é daqui que saem as opções que o cliente escolhe.",
      conteudo: <PainelDisponibilidade />,
    },
    {
      id: "bloqueios",
      rotulo: "Bloqueios",
      descricao: "Folgas e compromissos que tiram horários da lista, mesmo estando dentro da janela de atendimento.",
      conteudo: <PainelBloqueios />,
    },
  ];

  return (
    <div className="flex flex-col gap-bloco">
      <CabecalhoPagina
        rotulo="Dia a dia"
        titulo="Agenda"
        descricao="Sessões marcadas e os dias em que a equipe atende."
        acoes={
          // Fase 8 §C5: a ação primária da tela fica visível sem rolar, e é a
          // que se faz todo dia. Marcar uma sessão sempre começa por escolher
          // o cliente (o agendamento pertence a um processo), então o botão
          // leva para a lista — é o mesmo caminho que o estado vazio já dizia
          // em palavras, agora como botão.
          <>
            {/* No celular esta ação vive na `BarraAcaoMobile` da aba Sessões
                (zona do polegar). Repetir aqui poria DOIS "Marcar sessão"
                laranja na mesma dobra — para quem lê devagar, dois botões
                iguais são duas perguntas, não uma resposta. */}
            <LinkBotao href="/clientes" variante="cta" className="max-md:hidden">
              Marcar sessão
            </LinkBotao>
            <LinkBotao href="/agenda#disponibilidade" variante="secundario">
              Disponibilidade da equipe
            </LinkBotao>
          </>
        }
      />

      <Abas abas={abas} abaInicial="sessoes" deepLinkHash semMoldura />
    </div>
  );
}
