"use client";

import { useMemo, useState } from "react";
import type { RoteiroFala, RoteiroVersao, SimIdentificador } from "@/types/roteiro";
import { ErroSessao, registrarSim, type EstadoSims } from "@/components/sessao/api";
import { Quadro } from "@/components/ui/Quadro";
import { Selo } from "@/components/ui/Selo";
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

/**
 * Ação por TEXTO, nunca botão redondo (pedido do Marcio, 11-14/09: "o botão
 * da ética e licitude está como um botão redondo"). Continua sendo um
 * `<button>` de verdade — alvo ≥44px, `hover`/`focus-visible` — só sem a
 * forma de pílula colorida do `Botao` primário/perigo: aqui o texto sublinhado
 * chapado é a própria affordance, como link de ação de sistema legado.
 */
function AcaoTexto({
  tom,
  carregando,
  disabled,
  onClick,
  children,
}: {
  tom: "neutro" | "vermelho";
  carregando?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={carregando || undefined}
      className={`flex min-h-11 items-center gap-1.5 rounded-controle px-2 text-sm font-medium underline decoration-1 underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
        tom === "vermelho" ? "text-[color:var(--vermelho)] hover:bg-vermelho-fraco" : "text-tinta hover:bg-papel"
      }`}
    >
      {carregando && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />}
      {children}
    </button>
  );
}

/** Número do SIM — quadrado chapado (`rounded-controle`), nunca círculo. */
function NumeroSim({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-controle border border-linha-forte bg-papel text-legenda font-bold text-tinta-suave"
    >
      {children}
    </span>
  );
}

function LinhaSim({
  sim,
  fala,
  registrado,
  emQue,
  aoRegistrar,
}: {
  sim: SimIdentificador;
  fala: RoteiroFala | null;
  registrado: boolean | null; // null = não registrado ainda
  emQue: string | null;
  aoRegistrar: (sim: SimIdentificador, confirmado: boolean) => Promise<void>;
}) {
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

  return (
    <li className="flex flex-col gap-1 border-b border-linha px-1 py-2 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-h-11 items-center gap-2 text-sm text-tinta">
          <NumeroSim>{NUMERO_SIM[sim]}</NumeroSim>
          {ROTULO_SIM[sim]}
        </span>

        {registrado === null ? (
          <div className="flex items-center gap-1">
            <AcaoTexto tom="neutro" carregando={enviando === "sim"} disabled={enviando !== null} onClick={() => registrar(true)}>
              Cliente disse sim
            </AcaoTexto>
            <AcaoTexto tom="vermelho" carregando={enviando === "nao"} disabled={enviando !== null} onClick={() => registrar(false)}>
              Não confirmou
            </AcaoTexto>
          </div>
        ) : (
          <Selo tom={registrado ? "verde" : "vermelho"}>
            {registrado ? "Registrado — SIM" : "Registrado — não confirmou"}
            {emQue && ` · ${formatarDataHora(emQue)}`}
          </Selo>
        )}
      </div>

      {erro && (
        <p role="alert" className="text-legenda text-[color:var(--vermelho)]">
          {erro}
        </p>
      )}

      {fala && (
        <details className="group">
          <summary className="min-h-6 cursor-pointer list-none text-legenda text-tinta-fraca marker:content-none [&::-webkit-details-marker]:hidden">
            Ver fala do roteiro
          </summary>
          <blockquote className="mt-1 rounded-controle border border-linha bg-papel px-3 py-2 text-sm italic leading-relaxed text-tinta-suave">
            “{fala.texto}”
          </blockquote>
        </details>
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
    <Quadro rotulo="SIMs" acao={<Selo tom={totalRegistrados === 4 ? "verde" : "neutro"}>{totalRegistrados} de 4</Selo>}>
      <ul className="flex flex-col">
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
              registrado={simEstado ? simEstado.ok : null}
              emQue={simEstado?.em ?? null}
              aoRegistrar={aoRegistrar}
            />
          );
        })}
      </ul>
    </Quadro>
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

  return (
    <li className="flex flex-col gap-1 border-b border-linha px-1 py-2 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-h-11 flex-wrap items-center gap-2 text-sm text-tinta">
          <NumeroSim>1</NumeroSim>
          Sigilo e Gravação
          <span className="rounded-controle border border-linha-forte px-1.5 py-0.5 text-legenda font-medium uppercase text-tinta-fraca">registro jurídico</span>
        </span>

        {!consentimento ? (
          <div className="flex items-center gap-1">
            <AcaoTexto tom="neutro" carregando={enviando === "sim"} disabled={enviando !== null} onClick={() => registrar(true)}>
              Cliente disse sim
            </AcaoTexto>
            <AcaoTexto tom="vermelho" carregando={enviando === "nao"} disabled={enviando !== null} onClick={() => registrar(false)}>
              Não confirmou
            </AcaoTexto>
          </div>
        ) : (
          <Selo tom={registrado ? "verde" : "vermelho"}>
            {registrado ? "Consentimento concedido" : "Consentimento não concedido"} · {formatarDataHora(consentimento.concedido_em)}
          </Selo>
        )}
      </div>

      {erro && (
        <p role="alert" className="text-legenda text-[color:var(--vermelho)]">
          {erro}
        </p>
      )}

      <details className="group" open={!consentimento}>
        <summary className="min-h-6 cursor-pointer list-none text-legenda text-tinta-fraca marker:content-none [&::-webkit-details-marker]:hidden">
          Ver texto apresentado
        </summary>
        <blockquote className="mt-1 rounded-controle border border-linha bg-papel px-3 py-2 text-sm italic leading-relaxed text-tinta-suave">
          “{consentimento?.texto_apresentado ?? fala?.texto ?? "Texto do roteiro não encontrado."}”
        </blockquote>
        {consentimento && (
          <p className="mt-1 text-legenda text-tinta-fraca">
            Texto congelado no momento do registro · versão {consentimento.versao_texto} · canal {consentimento.canal}
          </p>
        )}
      </details>
    </li>
  );
}
