"use client";

import { useCallback, useState } from "react";
import type { PayloadConfirmacaoPublico } from "@/types/publico-ui";
import { abrirLinkConfirmacao, conferirTipo, confirmarPresencaPublico, ErroLinkPublico } from "@/components/publico/cliente";
import { useRecurso } from "@/hooks/useRecurso";
import { CarregandoPublico, ErroTemporarioPublico } from "@/components/publico/CarregandoPublico";
import { TelaLinkInvalido } from "@/components/publico/TelaLinkInvalido";
import { BotaoPublico, CartaoPublico, ContatoEquipe, IconeFeito, RotuloPublico } from "@/components/publico/atomos";
import { formatarCarimboCurto, formatarDiaPorExtenso, formatarHoraSimples } from "@/components/publico/datas";

/**
 * `/p/c/[token]` — confirmação de presença com UM toque (ARQUITETURA-FASE-4.md
 * §1.2). O link chega na mensagem D-7; a pessoa abre no celular, lê o dia e a
 * hora e toca em "Confirmo minha presença". Nada de login, nada de PII além
 * do primeiro nome — a resposta da rota já é só isso.
 *
 * Estados, em ordem de aparecimento: carregando → convite (botão) →
 * confirmando → confirmada. Fora do caminho feliz: já confirmada (sem botão,
 * diz quando), link inválido (tela única, sem oráculo), horário remarcado
 * (409 `agendamento_indisponivel`: a equipe manda link novo), muitas
 * tentativas (429) e falha passageira — cada uma com o que fazer.
 */
type Fase =
  | { tipo: "convite" }
  | { tipo: "confirmada"; confirmadaEm: string; inicioEm: string; jaEstava: boolean }
  | { tipo: "remarcado" }
  | { tipo: "link_invalido" };

function DiaEHora({ inicioEm, fimEm }: { inicioEm: string; fimEm: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-titulo font-bold text-tinta sm:text-display">{formatarDiaPorExtenso(inicioEm)}</p>
      <p className="text-subtitulo text-tinta">
        das <span className="font-bold">{formatarHoraSimples(inicioEm)}</span> às <span className="font-bold">{formatarHoraSimples(fimEm)}</span>
      </p>
      <p className="text-sm text-tinta-suave">Horário de São Paulo · online, pelo link que chega no seu e-mail no dia.</p>
    </div>
  );
}

function OQueAconteceAgora() {
  return (
    <CartaoPublico como="section" className="flex flex-col gap-4">
      <RotuloPublico>O que acontece agora</RotuloPublico>
      <ol className="flex flex-col gap-3">
        {[
          "No dia da sessão, o link da sala chega no seu e-mail.",
          "A sala abre 10 minutos antes do horário — entre com calma.",
          "Se puder, esteja com quem decide junto com você: a conversa rende mais.",
        ].map((texto, i) => (
          <li key={i} className="flex items-start gap-3 text-corpo text-tinta">
            <span
              aria-hidden="true"
              className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[color:var(--latao-cta)] text-sm font-bold text-[color:var(--latao-cta-texto)]"
            >
              {i + 1}
            </span>
            <span className="leading-relaxed">{texto}</span>
          </li>
        ))}
      </ol>
    </CartaoPublico>
  );
}

function TelaConfirmada({ nome, payload, confirmadaEm, jaEstava }: { nome: string; payload: PayloadConfirmacaoPublico; confirmadaEm: string; jaEstava: boolean }) {
  return (
    <div className="flex flex-col gap-6" aria-live="polite">
      <div className="flex flex-col items-center gap-4 text-center">
        <IconeFeito />
        <div className="flex flex-col gap-2">
          <RotuloPublico>Sessão de Viabilidade</RotuloPublico>
          <h1 className="text-tinta">
            {jaEstava ? "Presença já confirmada" : "Confirmado!"} Nos vemos {formatarDiaPorExtenso(payload.inicio_em).toLowerCase()} às {formatarHoraSimples(payload.inicio_em)}.
          </h1>
          <p className="text-tinta-suave">
            {jaEstava ? `${nome}, você confirmou em ${formatarCarimboCurto(confirmadaEm)}. Não precisa fazer nada agora.` : `Obrigada, ${nome}. A equipe da Dra. Elaine já foi avisada.`}
          </p>
        </div>
      </div>

      <OQueAconteceAgora />

      <ContatoEquipe antes="Precisa mudar o horário?" />
    </div>
  );
}

function TelaRemarcado() {
  return (
    <div className="flex flex-col items-center gap-5 py-6 text-center" role="status">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-14 w-14 fill-none stroke-tinta-suave stroke-[1.5]">
        <rect x="3" y="5" width="18" height="16" rx="3" />
        <path strokeLinecap="round" d="M3 10h18M8 3v4M16 3v4" />
      </svg>
      <div className="flex flex-col gap-2">
        <h1 className="text-tinta">Esse horário foi remarcado</h1>
        <p className="max-w-sm text-tinta-suave">A equipe vai te mandar um novo link de confirmação com a data certa. Não precisa fazer nada agora.</p>
      </div>
      <ContatoEquipe antes="Quer adiantar?" />
    </div>
  );
}

function TelaConvite({
  token,
  nome,
  payload,
  aoConfirmar,
  aoRemarcado,
  aoLinkInvalido,
}: {
  token: string;
  nome: string;
  payload: PayloadConfirmacaoPublico;
  aoConfirmar: (confirmadaEm: string, inicioEm: string) => void;
  aoRemarcado: () => void;
  aoLinkInvalido: () => void;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function confirmar() {
    setConfirmando(true);
    setErro(null);
    try {
      const resposta = await confirmarPresencaPublico(token);
      aoConfirmar(resposta.confirmada_em, resposta.inicio_em);
    } catch (e) {
      const codigo = e instanceof ErroLinkPublico ? e.codigo : "erro_desconhecido";
      if (codigo === "agendamento_indisponivel") aoRemarcado();
      else if (codigo === "link_invalido") aoLinkInvalido();
      else if (codigo === "limite_excedido") setErro("Muitas tentativas em pouco tempo. Espere um minuto e toque de novo.");
      else setErro("Não deu para confirmar agora. Pode ser a internet — tente de novo em instantes.");
    } finally {
      setConfirmando(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <RotuloPublico>Sessão de Viabilidade</RotuloPublico>
        <h1 className="text-tinta">Olá, {nome}. Podemos contar com você?</h1>
        <p className="text-tinta-suave">Sua sessão com a Dra. Elaine Montenegro está marcada. Confirme com um toque.</p>
      </div>

      <CartaoPublico como="section" className="flex flex-col gap-6">
        <DiaEHora inicioEm={payload.inicio_em} fimEm={payload.fim_em} />

        <BotaoPublico variante="primario" largo carregando={confirmando} onClick={confirmar} aria-describedby={erro ? "erro-confirmacao" : undefined}>
          {confirmando ? "Confirmando…" : "Confirmo minha presença"}
        </BotaoPublico>

        {erro && (
          <p id="erro-confirmacao" role="alert" className="text-sm font-medium text-[color:var(--vermelho)]">
            {erro}
          </p>
        )}
      </CartaoPublico>

      <ContatoEquipe antes="Não vai conseguir nesse horário?" />
    </div>
  );
}

export function ConfirmacaoPublico({ token }: { token: string }) {
  const buscar = useCallback(() => abrirLinkConfirmacao(token).then((res) => conferirTipo(res, "confirmacao")), [token]);
  const { dados: abertura, carregando, erro, recarregar } = useRecurso(buscar, [token]);
  const [fase, setFase] = useState<Fase>({ tipo: "convite" });

  if (carregando) return <CarregandoPublico />;
  if (erro instanceof ErroLinkPublico && erro.codigo === "link_invalido") return <TelaLinkInvalido />;
  if (erro instanceof ErroLinkPublico && erro.codigo === "agendamento_indisponivel") return <TelaRemarcado />;
  if (erro) return <ErroTemporarioPublico aoTentarNovamente={recarregar} />;
  if (!abertura) return null;

  const nome = abertura.primeiro_nome;
  const payload = abertura.payload;

  if (fase.tipo === "link_invalido") return <TelaLinkInvalido />;
  if (fase.tipo === "remarcado") return <TelaRemarcado />;
  if (fase.tipo === "confirmada") {
    return <TelaConfirmada nome={nome} payload={{ ...payload, inicio_em: fase.inicioEm }} confirmadaEm={fase.confirmadaEm} jaEstava={fase.jaEstava} />;
  }
  if (payload.ja_confirmada_em) {
    return <TelaConfirmada nome={nome} payload={payload} confirmadaEm={payload.ja_confirmada_em} jaEstava />;
  }

  return (
    <TelaConvite
      token={token}
      nome={nome}
      payload={payload}
      aoConfirmar={(confirmadaEm, inicioEm) => setFase({ tipo: "confirmada", confirmadaEm, inicioEm, jaEstava: false })}
      aoRemarcado={() => setFase({ tipo: "remarcado" })}
      aoLinkInvalido={() => setFase({ tipo: "link_invalido" })}
    />
  );
}
