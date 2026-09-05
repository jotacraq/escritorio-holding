"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useToast } from "@/hooks/useToast";
import { ITENS_NAVEGACAO } from "@/components/shell/Nav";
import { Botao } from "@/components/ui/Botao";
import { Gaveta } from "@/components/ui/Gaveta";
import { adiarNestaSessao, buscarEstadoOnboarding, foiAdiadoNestaSessao, marcarOnboardingVisto } from "./api-onboarding";

/**
 * Os 8 passos do tour — um por área do menu, em português de gente, para
 * quem vive de e-mail e WhatsApp. `rotulo`/`descricao` curtos vêm do próprio
 * menu (`ITENS_NAVEGACAO`, só leitura — o shell é de outro time); o texto
 * longo é daqui. Importações + Administração viram um passo só: raramente
 * a advogada entra lá.
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
    id: "painel",
    hrefs: ["/painel"],
    titulo: "Painel do dia",
    icone: <path d="M3 3.5A1.5 1.5 0 0 1 4.5 2h4A1.5 1.5 0 0 1 10 3.5v4A1.5 1.5 0 0 1 8.5 9h-4A1.5 1.5 0 0 1 3 7.5v-4Zm9 0A1.5 1.5 0 0 1 13.5 2h2A1.5 1.5 0 0 1 17 3.5v4A1.5 1.5 0 0 1 15.5 9h-2A1.5 1.5 0 0 1 12 7.5v-4ZM3 12.5A1.5 1.5 0 0 1 4.5 11h2A1.5 1.5 0 0 1 8 12.5v4A1.5 1.5 0 0 1 6.5 18h-2A1.5 1.5 0 0 1 3 16.5v-4Zm9-1A1.5 1.5 0 0 1 13.5 10h4a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5h-4a1.5 1.5 0 0 1-1.5-1.5v-4Z" />,
    texto: (
      <>
        <p>Comece o dia por aqui. O painel mostra, em ordem de urgência, o que precisa de você hoje: as sessões marcadas, quem pagou e ainda não recebeu ligação, e o que travou no sistema.</p>
        <p>Cada linha traz um chip dizendo o próximo passo e de quem ele é — equipe, advogada, cliente ou o próprio sistema.</p>
      </>
    ),
  },
  {
    id: "esteira",
    hrefs: ["/esteira"],
    titulo: "Esteira",
    icone: <path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h4A1.5 1.5 0 0 1 10 4.5v11A1.5 1.5 0 0 1 8.5 17h-4A1.5 1.5 0 0 1 3 15.5v-11Zm9-1A1.5 1.5 0 0 1 13.5 2h2A1.5 1.5 0 0 1 17 3.5v6A1.5 1.5 0 0 1 15.5 11h-2A1.5 1.5 0 0 1 12 9.5v-6Zm0 9A1.5 1.5 0 0 1 13.5 11h2a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-2a1.5 1.5 0 0 1-1.5-1.5v-3Z" />,
    texto: (
      <>
        <p>Todas as pessoas, do seminário à holding, em colunas por etapa. Cada cartão é uma família e diz o que falta agora.</p>
        <p>Para mudar alguém de etapa, arraste o cartão ou use “Mover”. Se preferir não rolar de lado, troque para “Lista por etapa”. Clique no nome para abrir a Pasta do Cliente.</p>
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
        <p>As Sessões de Viabilidade dos próximos dias e quem já confirmou presença. Marcar como realizada, remarcar ou cancelar é feito aqui mesmo.</p>
        <p>Nas outras abas você define os seus horários livres (é deles que saem as opções que o cliente vê no link) e bloqueia folgas e compromissos.</p>
      </>
    ),
  },
  {
    id: "sessoes",
    hrefs: ["/sessoes"],
    titulo: "Conduzir sessão",
    icone: <path d="M4 3.5A1.5 1.5 0 0 1 5.5 2h9A1.5 1.5 0 0 1 16 3.5v13a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 16.5v-13Zm3 2.5a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2H7Zm0 4a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2H7Zm0 4a1 1 0 1 0 0 2h3a1 1 0 1 0 0-2H7Z" />,
    texto: (
      <>
        <p>Durante a Sessão de Viabilidade: o roteiro, os 4 SIMs, o Briefing Estratégico ao lado e o lugar para anotar o que a família disse.</p>
        <p>Não é reunião de vendas — é diagnóstico. A tela existe para você conduzir com a família, sem procurar nada.</p>
      </>
    ),
  },
  {
    id: "comunicacao",
    hrefs: ["/comunicacao"],
    titulo: "Comunicação",
    icone: <path d="M2 5.5A2.5 2.5 0 0 1 4.5 3h11A2.5 2.5 0 0 1 18 5.5v6a2.5 2.5 0 0 1-2.5 2.5H9l-4.2 3.15A.75.75 0 0 1 3.6 16.6V14h-.1A2.5 2.5 0 0 1 1 11.5v-6Z" />,
    texto: (
      <>
        <p>Os e-mails e mensagens de WhatsApp que a régua envia sozinha: boas-vindas quando a pessoa paga, pedido de confirmação uma semana antes, link da sala no dia e o material depois da sessão.</p>
        <p>Você vê o que vai sair e quando — e o que falhou, com o motivo.</p>
      </>
    ),
  },
  {
    id: "conhecimento",
    hrefs: ["/conhecimento"],
    titulo: "Conhecimento",
    icone: <path d="M3 4.2A1.2 1.2 0 0 1 4.2 3h4.6c.85 0 1.66.34 2.2.94A3.15 3.15 0 0 1 13.2 3h2.6A1.2 1.2 0 0 1 17 4.2v10.6a1.2 1.2 0 0 1-1.2 1.2h-3.51a2 2 0 0 0-1.42.59l-.29.29a1 1 0 0 1-1.16 0l-.29-.29a2 2 0 0 0-1.42-.59H4.2A1.2 1.2 0 0 1 3 14.8V4.2ZM9.25 6.1v8.4c.34.08.66.22.96.4V7.53a1.4 1.4 0 0 0-.96-1.43Z" />,
    texto: (
      <>
        <p>Transcrições e casos anteriores para consultar antes de uma sessão: o que já foi dito para famílias parecidas, que objeção apareceu, o que funcionou.</p>
        <p>Busque por uma palavra ou por um tema — é o acervo do método.</p>
      </>
    ),
  },
  {
    id: "indicadores",
    hrefs: ["/indicadores"],
    titulo: "Indicadores",
    icone: <path d="M3 3a1 1 0 0 1 1 1v11h13a1 1 0 1 1 0 2H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm13.5 2.4a1 1 0 0 1 .1 1.41l-4.3 4.9a1 1 0 0 1-1.44.06L8.5 9.5l-3.02 3.44a1 1 0 1 1-1.5-1.32l3.75-4.28a1 1 0 0 1 1.44-.06l2.36 2.27 3.56-4.06a1 1 0 0 1 1.41-.1Z" />,
    texto: (
      <>
        <p>Os números do funil por edição do seminário: quantas pessoas viraram cliente, quantas fizeram a sessão, quantas contrataram o croqui e a holding.</p>
        <p>Sempre por turma de origem — quem entrou em junho é comparado com quem entrou em junho.</p>
      </>
    ),
  },
  {
    id: "administracao",
    hrefs: ["/importacoes", "/admin"],
    titulo: "Importações e Administração",
    icone: <path d="M10 2 3 5v5c0 4.2 2.9 7.7 7 8.9 4.1-1.2 7-4.7 7-8.9V5l-7-3Zm0 4.5a2.25 2.25 0 1 1 0 4.5 2.25 2.25 0 0 1 0-4.5ZM6 14.2c.7-1.6 2.2-2.7 4-2.7s3.3 1.1 4 2.7c-1.1 1-2.5 1.7-4 2.1-1.5-.4-2.9-1.1-4-2.1Z" />,
    texto: (
      <>
        <p>As planilhas do seminário entram por Importações. Em Administração ficam a equipe, os produtos, os modelos de mensagem e as configurações do sistema.</p>
        <p>Raramente você precisa entrar aqui — e quando algo depende de configuração, o painel avisa com todas as letras.</p>
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
      <div className="flex flex-col gap-6">
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

        <div key={passo.id} className="anim-surgir flex flex-col gap-5">
          <div className="flex items-center gap-4">
            <span aria-hidden="true" className="grid h-14 w-14 shrink-0 place-items-center rounded-cartao bg-latao-fraco text-[color:var(--latao)]">
              <svg viewBox="0 0 20 20" className="h-7 w-7 fill-current">
                {passo.icone}
              </svg>
            </span>
            <div className="min-w-0">
              {itemMenu && <p className="text-rotulo font-medium uppercase text-tinta-fraca">{itemMenu.grupo}</p>}
              <h3 className="text-titulo font-bold text-tinta">{passo.titulo}</h3>
            </div>
          </div>

          {itemMenu && <p className="text-sm font-medium text-tinta-suave">{itemMenu.descricao}</p>}

          <div className="flex flex-col gap-3 text-corpo text-tinta">{passo.texto}</div>

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
