"use client";

import Link from "next/link";
import { CabecalhoPagina } from "@/components/ui/CabecalhoPagina";
import { Abas, type DefinicaoAba } from "@/components/ui/Abas";
import { ListaSessoes } from "@/components/agenda/ListaSessoes";
import { PainelDisponibilidade } from "@/components/agenda/PainelDisponibilidade";
import { PainelBloqueios } from "@/components/agenda/PainelBloqueios";
import { LinkBotao } from "@/components/ui/LinkBotao";
import { IniciarSessaoAgora } from "@/components/agenda/IniciarSessaoAgora";

/**
 * Agenda. Fase 6, decisão 5 do João: "onde é que a gente define quais dias a
 * equipe vai estar disponível? achei, mas tem que ser fácil de achar".
 *
 * "Horários livres" virou **"Disponibilidade da equipe"** e ganhou entrada
 * direta em três lugares: a aba, uma ação no cabeçalho da Agenda e a paleta
 * de comandos (Ctrl+K). O deep-link `#disponibilidade` já funcionava.
 *
 * 15/09/2026 — par "Iniciar sessão agora" / "Marcar sessão", à moda do Google
 * Meet ("Nova reunião" ao lado de "Agendar"). Fica aqui, não em Hoje: esta
 * já é a tela com o padrão de ação primária + secundária no cabeçalho
 * ("Marcar sessão" era o único CTA), e é o destino natural de quem pensa
 * "preciso marcar/começar uma sessão" — Hoje é fila de trabalho reativa a
 * dado existente (cada bloco espelha algo que já aconteceu), não o lugar de
 * abrir um formulário de criação. "Iniciar sessão agora" assume o lugar de
 * CTA que "Marcar sessão" tinha; "Marcar sessão" recua para secundário —
 * mesmo destino de sempre (`/clientes`).
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
            {/* Correção de 15/09: "Iniciar sessão agora" e "Marcar sessão"
                agora TÊM par no celular — a `BarraAcaoMobile` da aba Sessões
                (`ListaSessoes.tsx`) passou a oferecer os dois na zona do
                polegar. Os dois botões do cabeçalho ficam `max-md:hidden`
                para não duplicar o mesmo par visível logo abaixo. */}
            <IniciarSessaoAgora className="max-md:hidden" />
            <LinkBotao href="/clientes" variante="secundario" className="max-md:hidden">
              Marcar sessão
            </LinkBotao>
            {/* T5 (16/09/2026): "Disponibilidade da equipe" é navegação para
                uma aba desta própria tela, não uma ação — 3 botões era o
                limite do DS e só um pode ser primário (§9 do DS). Vira link
                de texto, mesmo padrão do "← Todas as importações". */}
            <Link
              href="/agenda#disponibilidade"
              className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-[color:var(--latao)] underline-offset-4 hover:underline"
            >
              Disponibilidade da equipe
            </Link>
          </>
        }
      />

      <Abas abas={abas} abaInicial="sessoes" deepLinkHash semMoldura />
    </div>
  );
}
