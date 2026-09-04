"use client";

import { useMemo, useState } from "react";
import type { RoteiroFala, RoteiroVersao, SimIdentificador } from "@/types/roteiro";
import { ErroSessao, registrarSim, type EstadoSims } from "@/components/sessao/api";
import { Botao } from "@/components/ui/Botao";
import { formatarDataHora } from "@/lib/formatar";
import { NUMERO_SIM, ORDEM_SIMS, ROTULO_SIM } from "@/components/sessao/rotulos";

/** Acha, em qualquer bloco do roteiro, a fala marcada com este identificador de SIM. */
function acharFalaDoSim(roteiro: RoteiroVersao, sim: SimIdentificador): RoteiroFala | null {
  for (const bloco of roteiro.definicao.blocos) {
    const fala = bloco.falas.find((f) => f.sim === sim);
    if (fala) return fala;
  }
  return null;
}

function LinhaSim({
  sim,
  fala,
  sessaoId,
  registrado,
  emQue,
  aoRegistrar,
}: {
  sim: SimIdentificador;
  fala: RoteiroFala | null;
  sessaoId: string;
  registrado: boolean | null; // null = não registrado ainda
  emQue: string | null;
  aoRegistrar: (sim: SimIdentificador, confirmado: boolean) => Promise<void>;
}) {
  const [expandido, setExpandido] = useState(false);
  const [enviando, setEnviando] = useState<"sim" | "nao" | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function registrar(confirmado: boolean) {
    setErro(null);
    setEnviando(confirmado ? "sim" : "nao");
    try {
      await aoRegistrar(sim, confirmado);
    } catch (e) {
      setErro(e instanceof ErroSessao ? e.message : "Não deu para registrar. Tente de novo.");
    } finally {
      setEnviando(null);
    }
  }

  const tomBorda =
    registrado === true ? "border-verde" : registrado === false ? "border-vermelho" : "border-linha-forte";

  return (
    <li className={`flex flex-col gap-1.5 rounded-sm border-l-4 bg-papel-elevado px-3 py-2.5 ${tomBorda}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setExpandido((v) => !v)}
          aria-expanded={expandido}
          className="flex items-center gap-2 text-left text-sm font-medium text-tinta"
        >
          <span
            aria-hidden="true"
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-linha-forte text-[11px] font-semibold text-tinta-suave"
          >
            {NUMERO_SIM[sim]}
          </span>
          {ROTULO_SIM[sim]}
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className={`h-3.5 w-3.5 shrink-0 fill-current text-tinta-fraca transition-transform ${expandido ? "rotate-180" : ""}`}
          >
            <path d="M5.5 7.5 10 12l4.5-4.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {registrado === null ? (
          <div className="flex items-center gap-1.5">
            <Botao
              variante="primario"
              className="px-2.5 py-1 text-xs"
              carregando={enviando === "sim"}
              disabled={enviando !== null}
              onClick={() => registrar(true)}
            >
              Cliente disse sim
            </Botao>
            <Botao
              variante="perigo"
              className="px-2.5 py-1 text-xs"
              carregando={enviando === "nao"}
              disabled={enviando !== null}
              onClick={() => registrar(false)}
            >
              Não confirmou
            </Botao>
          </div>
        ) : (
          <span
            className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-medium ${
              registrado ? "bg-verde-fraco text-[color:var(--verde)]" : "bg-vermelho-fraco text-[color:var(--vermelho)]"
            }`}
          >
            {registrado ? "Registrado — SIM" : "Registrado — não confirmou"}
            {emQue && ` · ${formatarDataHora(emQue)}`}
          </span>
        )}
      </div>

      {erro && (
        <p role="alert" className="text-xs text-[color:var(--vermelho)]">
          {erro}
        </p>
      )}

      {expandido && fala && (
        <blockquote className="rounded-sm border border-linha bg-papel px-3 py-2 font-serif text-[15px] italic leading-snug text-tinta-suave">
          “{fala.texto}”
        </blockquote>
      )}
    </li>
  );
}

export function PainelSims({
  roteiro,
  sessaoId,
  estado,
  aoAtualizar,
}: {
  roteiro: RoteiroVersao;
  sessaoId: string;
  estado: EstadoSims;
  aoAtualizar: (novoEstado: EstadoSims) => void;
}) {
  const falasPorSim = useMemo(() => {
    const mapa = new Map<SimIdentificador, RoteiroFala | null>();
    for (const sim of ORDEM_SIMS) mapa.set(sim, acharFalaDoSim(roteiro, sim));
    return mapa;
  }, [roteiro]);

  async function aoRegistrar(sim: SimIdentificador, confirmado: boolean) {
    const resposta = await registrarSim(sessaoId, sim, confirmado);
    aoAtualizar({
      roteiro_versao_id: resposta.sessao.roteiro_versao_id,
      sims: resposta.sessao.sims,
      sigilo_gravacao: sim === "sigilo_gravacao" ? resposta.sigilo_gravacao : estado.sigilo_gravacao,
    });
  }

  const totalRegistrados =
    (estado.sigilo_gravacao ? 1 : 0) + Object.values(estado.sims).filter((s) => s?.ok !== undefined).length;

  return (
    <section aria-labelledby="titulo-sims" className="flex flex-col gap-2 rounded-sm border border-linha bg-papel px-3 py-3 sm:px-4">
      <div className="flex items-center justify-between">
        <h2 id="titulo-sims" className="font-serif text-sm font-semibold text-tinta">
          Os 4 SIMs — PARTE 01
        </h2>
        <span className="text-xs text-tinta-fraca">{totalRegistrados} de 4 registrados</span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {ORDEM_SIMS.map((sim) => {
          if (sim === "sigilo_gravacao") {
            const consentimento = estado.sigilo_gravacao;
            return (
              <LinhaSimGravacao
                key={sim}
                fala={falasPorSim.get(sim) ?? null}
                consentimento={consentimento}
                aoRegistrar={(confirmado) => aoRegistrar(sim, confirmado)}
              />
            );
          }
          const simEstado = estado.sims[sim];
          return (
            <LinhaSim
              key={sim}
              sim={sim}
              fala={falasPorSim.get(sim) ?? null}
              sessaoId={sessaoId}
              registrado={simEstado ? simEstado.ok : null}
              emQue={simEstado?.em ?? null}
              aoRegistrar={aoRegistrar}
            />
          );
        })}
      </ul>
    </section>
  );
}

/**
 * O 1º SIM é registro jurídico, não checagem de condução: mostra o texto
 * CONGELADO que foi de fato apresentado (`texto_apresentado`), não o texto
 * atual do roteiro (que pode ter mudado desde então) — essa é a diferença
 * para as outras 3 linhas.
 */
function LinhaSimGravacao({
  fala,
  consentimento,
  aoRegistrar,
}: {
  fala: RoteiroFala | null;
  consentimento: import("@/types/roteiro").ConsentimentoGravacao | null;
  aoRegistrar: (confirmado: boolean) => Promise<void>;
}) {
  const [expandido, setExpandido] = useState(!consentimento);
  const [enviando, setEnviando] = useState<"sim" | "nao" | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function registrar(confirmado: boolean) {
    setErro(null);
    setEnviando(confirmado ? "sim" : "nao");
    try {
      await aoRegistrar(confirmado);
    } catch (e) {
      setErro(e instanceof ErroSessao ? e.message : "Não deu para registrar. Tente de novo.");
    } finally {
      setEnviando(null);
    }
  }

  const registrado = consentimento?.concedido ?? null;
  const tomBorda = registrado === true ? "border-verde" : registrado === false ? "border-vermelho" : "border-linha-forte";

  return (
    <li className={`flex flex-col gap-1.5 rounded-sm border-l-4 bg-papel-elevado px-3 py-2.5 ${tomBorda}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setExpandido((v) => !v)}
          aria-expanded={expandido}
          className="flex items-center gap-2 text-left text-sm font-medium text-tinta"
        >
          <span
            aria-hidden="true"
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-linha-forte text-[11px] font-semibold text-tinta-suave"
          >
            1
          </span>
          Sigilo e Gravação
          <span className="rounded-sm border border-linha-forte px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-tinta-fraca">
            registro jurídico
          </span>
        </button>

        {!consentimento ? (
          <div className="flex items-center gap-1.5">
            <Botao variante="primario" className="px-2.5 py-1 text-xs" carregando={enviando === "sim"} disabled={enviando !== null} onClick={() => registrar(true)}>
              Cliente disse sim
            </Botao>
            <Botao variante="perigo" className="px-2.5 py-1 text-xs" carregando={enviando === "nao"} disabled={enviando !== null} onClick={() => registrar(false)}>
              Não confirmou
            </Botao>
          </div>
        ) : (
          <span
            className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-medium ${
              registrado ? "bg-verde-fraco text-[color:var(--verde)]" : "bg-vermelho-fraco text-[color:var(--vermelho)]"
            }`}
          >
            {registrado ? "Consentimento concedido" : "Consentimento não concedido"} · {formatarDataHora(consentimento.concedido_em)}
          </span>
        )}
      </div>

      {erro && (
        <p role="alert" className="text-xs text-[color:var(--vermelho)]">
          {erro}
        </p>
      )}

      {expandido && (
        <blockquote className="rounded-sm border border-linha bg-papel px-3 py-2 font-serif text-[15px] italic leading-snug text-tinta-suave">
          “{consentimento?.texto_apresentado ?? fala?.texto ?? "Texto do roteiro não encontrado."}”
        </blockquote>
      )}
      {consentimento && (
        <p className="text-[11px] text-tinta-fraca">
          Texto congelado no momento do registro · versão {consentimento.versao_texto} · canal {consentimento.canal}
        </p>
      )}
    </li>
  );
}
