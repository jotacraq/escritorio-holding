"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useToast } from "@/hooks/useToast";
import { ITENS_NAVEGACAO } from "@/components/shell/Nav";
import { Botao } from "@/components/ui/Botao";
import { Gaveta } from "@/components/ui/Gaveta";
import { adiarNestaSessao, buscarEstadoOnboarding, foiAdiadoNestaSessao, marcarOnboardingVisto } from "./api-onboarding";

/**
 * Os 5 passos do tour — um por entrada do menu, em português de gente, para
 * quem vive de e-mail e WhatsApp e não entende de sistemas.
 *
 * Fase 6: eram 8 passos para 9 entradas de menu. Agora são 5 para 5. O que
 * era "Conduzir sessão" virou o botão "Conduzir" na linha da Agenda;
 * "Conhecimento" virou o Repertório da IA dentro do Admin; "Indicadores"
 * virou a aba Números de Hoje; "Importações" virou aba do Admin.
 *
 * `rotulo`/`descricao` curtos vêm do próprio menu (`ITENS_NAVEGACAO`); o
 * texto longo é daqui.
 */
interface PassoTour {
  id: string;
  hrefs: string[];
  titulo: string;
  texto: ReactNode;
  icone: ReactNode;
}

const PASSOS: PassoTour[] = [
  {
    id: "hoje",
    hrefs: ["/hoje"],
    titulo: "Hoje",
    icone: <path d="M3 3.5A1.5 1.5 0 0 1 4.5 2h4A1.5 1.5 0 0 1 10 3.5v4A1.5 1.5 0 0 1 8.5 9h-4A1.5 1.5 0 0 1 3 7.5v-4Zm9 0A1.5 1.5 0 0 1 13.5 2h2A1.5 1.5 0 0 1 17 3.5v4A1.5 1.5 0 0 1 15.5 9h-2A1.5 1.5 0 0 1 12 7.5v-4ZM3 12.5A1.5 1.5 0 0 1 4.5 11h2A1.5 1.5 0 0 1 8 12.5v4A1.5 1.5 0 0 1 6.5 18h-2A1.5 1.5 0 0 1 3 16.5v-4Zm9-1A1.5 1.5 0 0 1 13.5 10h4a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5h-4a1.5 1.5 0 0 1-1.5-1.5v-4Z" />,
    texto: (
      <>
        <p>Comece o dia por aqui. A aba “O dia” mostra, em ordem de urgência, o que precisa de você: as sessões marcadas, quem pagou e ainda não recebeu contato, e o que travou.</p>
        <p>A aba “Números” tem o funil por turma do seminário: quantas pessoas fizeram a sessão, contrataram o croqui e a holding.</p>
      </>
    ),
  },
  {
    id: "clientes",
    hrefs: ["/clientes"],
    titulo: "Clientes",
    icone: <path d="M7.5 9a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7.25.5a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5ZM1.5 16.2c0-2.6 2.7-4.7 6-4.7s6 2.1 6 4.7a.8.8 0 0 1-.8.8H2.3a.8.8 0 0 1-.8-.8Zm13.6.8a2.3 2.3 0 0 0 .15-.8c0-1.6-.72-3.03-1.87-4.02a5.3 5.3 0 0 1 1.27-.15c2.5 0 4.35 1.63 4.35 3.67 0 .73-.35 1.3-.98 1.3h-2.92Z" />,
    texto: (
      <>
        <p>Todo mundo, do seminário à holding, em colunas agrupadas pelas três sessões: Viabilidade, Croqui estrutural e Entrega da holding. Cada cartão é uma família e diz o que falta agora.</p>
        <p>Para mudar alguém de coluna, arraste o cartão ou use “Mover”. Clique no nome para abrir a ficha dele.</p>
      </>
    ),
  },
  {
    id: "agenda",
    hrefs: ["/agenda"],
    titulo: "Agenda",
    icone: <path d="M6 2a1 1 0 0 1 1 1v1h6V3a1 1 0 1 1 2 0v1h1a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1V3a1 1 0 0 1 1-1Zm12 7H2v7a.5.5 0 0 0 .5.5h15a.5.5 0 0 0 .5-.5V9Z" />,
    texto: (
      <>
        <p>As Sessões de Viabilidade dos próximos dias e quem já confirmou presença. O botão “Conduzir” na linha da sessão abre o roteiro para você conduzir com a família.</p>
        <p>Na aba “Disponibilidade da equipe” você define os dias e horários em que atende — é de lá que saem as opções que o cliente escolhe no link.</p>
      </>
    ),
  },
  {
    id: "mensagens",
    hrefs: ["/mensagens"],
    titulo: "Mensagens",
    icone: <path d="M2 5.5A2.5 2.5 0 0 1 4.5 3h11A2.5 2.5 0 0 1 18 5.5v6a2.5 2.5 0 0 1-2.5 2.5H9l-4.2 3.15A.75.75 0 0 1 3.6 16.6V14h-.1A2.5 2.5 0 0 1 1 11.5v-6Z" />,
    texto: (
      <>
        <p>Os e-mails e mensagens que o sistema envia sozinho: boas-vindas quando a pessoa paga, pedido de confirmação uma semana antes, link da sala no dia e o material depois da sessão.</p>
        <p>Você vê o que vai sair e quando — e o que falhou, com o motivo.</p>
      </>
    ),
  },
  {
    id: "admin",
    hrefs: ["/admin"],
    titulo: "Admin",
    icone: <path d="M10 2 3 5v5c0 4.2 2.9 7.7 7 8.9 4.1-1.2 7-4.7 7-8.9V5l-7-3Zm0 4.5a2.25 2.25 0 1 1 0 4.5 2.25 2.25 0 0 1 0-4.5ZM6 14.2c.7-1.6 2.2-2.7 4-2.7s3.3 1.1 4 2.7c-1.1 1-2.5 1.7-4 2.1-1.5-.4-2.9-1.1-4-2.1Z" />,
    texto: (
      <>
        <p>Os ajustes do escritório: a equipe, os produtos, os valores do método, os modelos de mensagem e a lista de planilhas importadas.</p>
        <p>Aqui também fica o <strong>Repertório da IA</strong> — o histórico de eventos e reuniões anteriores que a IA usa para analisar cada família. Raramente você precisa entrar; quando algo depende de configuração, Hoje avisa com todas as letras.</p>
      </>
    ),
  },
];

interface Props {
  /** Abre o tour por fora (botão "Como funciona"). */
  forcarAbrir?: boolean;
  aoFechar?: () => void;
}

/**
 * Tour de primeira visita em `ui/Gaveta`: abre sozinho uma vez (ou com
 * `?tour=1`), tem 8 passos navegáveis por botão e por setas, "Depois" adia
 * só nesta sessão do navegador e "Entendi, não mostrar de novo" grava na
 * pessoa (`PATCH /api/equipe/me`) — ou no navegador, se a rota ainda não
 * existir, avisando disso no toast.
 */
export function TourPrimeiraVez({ forcarAbrir = false, aoFechar }: Props) {
  const { notificar } = useToast();
  const [autoAberto, setAutoAberto] = useState(false);
  const [indice, setIndice] = useState(0);
  const [gravando, setGravando] = useState(false);

  useEffect(() => {
    let vivo = true;
    const pedidoPorUrl = new URLSearchParams(window.location.search).get("tour") === "1";
    if (pedidoPorUrl) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAutoAberto(true);
      return;
    }
    if (foiAdiadoNestaSessao()) return;
    buscarEstadoOnboarding().then((estado) => {
      if (!vivo) return;
      // Só abre quando há certeza de "nunca viu" (api ou local). Em dúvida, não incomoda.
      if (!estado.visto && estado.fonte !== "desconhecida") setAutoAberto(true);
    });
    return () => {
      vivo = false;
    };
  }, []);

  const aberto = forcarAbrir || autoAberto;

  const fechar = useCallback(
    (motivo: "depois" | "entendi") => {
      if (motivo === "depois") adiarNestaSessao();
      setAutoAberto(false);
      setIndice(0);
      aoFechar?.();
    },
    [aoFechar],
  );

  async function entendi() {
    setGravando(true);
    const fonte = await marcarOnboardingVisto();
    setGravando(false);
    fechar("entendi");
    if (fonte === "api") {
      notificar({ tom: "sucesso", titulo: "Tour dispensado", descricao: "Você pode reabrir quando quiser pelo botão “Como funciona”." });
    } else {
      notificar({
        tom: "info",
        titulo: "Tour dispensado neste navegador",
        descricao: "O registro por pessoa ainda não está disponível no servidor; em outro aparelho o tour pode aparecer de novo.",
      });
    }
  }

  const passo = PASSOS[indice];
  const ultimo = indice === PASSOS.length - 1;
  const itemMenu = ITENS_NAVEGACAO.find((i) => passo.hrefs.includes(i.href));

  // Setas navegam de qualquer lugar da gaveta (o foco inicial está no botão
  // "Fechar" do `Gaveta`, fora do conteúdo) — por isso o ouvinte é global
  // enquanto o tour está aberto, e ignora campos de texto por precaução.
  useEffect(() => {
    if (!aberto) return;
    function aoTeclar(evento: KeyboardEvent) {
      const alvo = evento.target as HTMLElement | null;
      if (alvo && /^(input|textarea|select)$/i.test(alvo.tagName)) return;
      if (evento.key === "ArrowRight") {
        evento.preventDefault();
        setIndice((i) => Math.min(i + 1, PASSOS.length - 1));
      } else if (evento.key === "ArrowLeft") {
        evento.preventDefault();
        setIndice((i) => Math.max(i - 1, 0));
      }
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aberto]);

  if (!aberto) return null;

  return (
    <Gaveta
      aberta
      aoFechar={() => fechar("depois")}
      rotulo={`Passo ${indice + 1} de ${PASSOS.length}`}
      titulo="Como funciona o sistema"
      descricao="Um minuto para conhecer cada área do menu. Use as setas do teclado para avançar."
      largura="normal"
      rodape={
        <>
          <Botao variante="fantasma" onClick={() => fechar("depois")} className="mr-auto">
            Depois
          </Botao>
          {indice > 0 && (
            <Botao variante="secundario" onClick={() => setIndice((i) => i - 1)}>
              Anterior
            </Botao>
          )}
          {ultimo ? (
            <Botao variante="primario" carregando={gravando} onClick={entendi}>
              Entendi, não mostrar de novo
            </Botao>
          ) : (
            <Botao variante="primario" onClick={() => setIndice((i) => i + 1)}>
              Próximo
            </Botao>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-bloco">
        <ol aria-label="Progresso do tour" className="flex items-center gap-1.5">
          {PASSOS.map((p, i) => (
            <li key={p.id} aria-current={i === indice ? "step" : undefined} className="flex">
              <button
                type="button"
                onClick={() => setIndice(i)}
                aria-label={`Passo ${i + 1}: ${p.titulo}`}
                className="grid h-11 w-6 place-items-center"
              >
                <span
                  aria-hidden="true"
                  className={`block h-2 rounded-full transition-[width,background-color] duration-[var(--transicao-normal)] ease-[var(--suavizacao)] ${
                    i === indice ? "w-6 bg-[color:var(--latao-cta)]" : i < indice ? "w-2 bg-[color:var(--latao)]" : "w-2 bg-linha-forte"
                  }`}
                />
              </button>
            </li>
          ))}
        </ol>

        <div key={passo.id} className="anim-surgir flex flex-col gap-bloco">
          <div className="flex items-center gap-cartao">
            <span aria-hidden="true" className="grid h-14 w-14 shrink-0 place-items-center rounded-cartao bg-latao-fraco text-[color:var(--latao)]">
              <svg viewBox="0 0 20 20" className="h-7 w-7 fill-current">
                {passo.icone}
              </svg>
            </span>
            <div className="min-w-0">
              <h3 className="text-titulo font-bold text-tinta">{passo.titulo}</h3>
            </div>
          </div>

          {itemMenu && <p className="text-sm font-medium text-tinta-suave">{itemMenu.descricao}</p>}

          <div className="flex flex-col gap-item text-corpo text-tinta">{passo.texto}</div>

          <div className="flex flex-wrap gap-2">
            {passo.hrefs.map((href) => {
              const item = ITENS_NAVEGACAO.find((i) => i.href === href);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => fechar("depois")}
                  className="inline-flex min-h-11 items-center gap-2 rounded-controle border border-linha-controle bg-papel-elevado px-4 text-sm font-medium text-tinta transition-colors duration-[var(--transicao-rapida)] hover:border-[color:var(--latao)] hover:text-[color:var(--latao)]"
                >
                  Abrir {item?.rotulo ?? href}
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 fill-current">
                    <path d="M7.3 4.7a1 1 0 0 1 1.4 0l5 5a1 1 0 0 1 0 1.4l-5 5a1 1 0 1 1-1.4-1.4l4.3-4.3-4.3-4.3a1 1 0 0 1 0-1.4Z" />
                  </svg>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </Gaveta>
  );
}
