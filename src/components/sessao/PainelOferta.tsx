"use client";

import { useState } from "react";
import {
  type CondicaoOferta,
  type Oferta,
  VALOR_INCENTIVO_RESOLVEDOR_CROQUI,
  VALOR_PADRAO_CROQUI,
} from "@/types/roteiro";
import { ErroSessao, marcarOfertaAceita, registrarOferta } from "@/components/sessao/api";
import { Botao } from "@/components/ui/Botao";
import { Selo } from "@/components/ui/Selo";
import { formatarDataHora, formatarMoeda } from "@/lib/formatar";

const ROTULO_CONDICAO: Record<CondicaoOferta, string> = {
  padrao: "Preço padrão",
  incentivo_resolvedor: "Incentivo do Resolvedor",
};

function valorPadraoDaCondicao(condicao: CondicaoOferta): number {
  return condicao === "incentivo_resolvedor" ? VALOR_INCENTIVO_RESOLVEDOR_CROQUI : VALOR_PADRAO_CROQUI;
}

function LinhaOferta({
  jornadaId,
  oferta,
  aoAtualizar,
}: {
  jornadaId: string;
  oferta: Oferta;
  aoAtualizar: (oferta: Oferta) => void;
}) {
  const [enviando, setEnviando] = useState<"sim" | "nao" | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function decidir(aceita: boolean) {
    setErro(null);
    setEnviando(aceita ? "sim" : "nao");
    try {
      aoAtualizar(await marcarOfertaAceita(jornadaId, oferta.id, aceita));
    } catch (e) {
      setErro(e instanceof ErroSessao ? e.message : "Não deu para registrar a decisão. Tente de novo.");
    } finally {
      setEnviando(null);
    }
  }

  return (
    <li className="flex flex-col gap-1.5 rounded-sm border border-linha bg-papel-elevado px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-tinta">{ROTULO_CONDICAO[oferta.condicao]}</span>
          <span className="font-serif text-base font-bold text-tinta">{formatarMoeda(oferta.valor_ofertado)}</span>
          {oferta.condicao === "incentivo_resolvedor" && (
            <span className="text-xs text-tinta-fraca line-through">{formatarMoeda(oferta.valor_padrao)}</span>
          )}
        </div>
        {oferta.aceita === null ? (
          <div className="flex items-center gap-1.5">
            <Botao variante="primario" className="px-2.5 py-1 text-xs" carregando={enviando === "sim"} disabled={enviando !== null} onClick={() => decidir(true)}>
              Sim, fechou
            </Botao>
            <Botao variante="perigo" className="px-2.5 py-1 text-xs" carregando={enviando === "nao"} disabled={enviando !== null} onClick={() => decidir(false)}>
              Não
            </Botao>
          </div>
        ) : oferta.aceita ? (
          <Selo tom="verde">Aceitou</Selo>
        ) : (
          <Selo tom="vermelho">Não aceitou</Selo>
        )}
      </div>
      {erro && (
        <p role="alert" className="text-xs text-[color:var(--vermelho)]">
          {erro}
        </p>
      )}
      <p className="text-[11px] text-tinta-fraca">
        Ofertada em {formatarDataHora(oferta.ofertada_em)}
        {oferta.valida_ate && ` · válida até ${formatarDataHora(oferta.valida_ate)}`}
      </p>
    </li>
  );
}

export function PainelOferta({
  jornadaId,
  ofertas,
  aoAtualizar,
}: {
  jornadaId: string;
  ofertas: Oferta[];
  aoAtualizar: (ofertas: Oferta[]) => void;
}) {
  const [mostrarFormulario, setMostrarFormulario] = useState(ofertas.length === 0);
  const [condicao, setCondicao] = useState<CondicaoOferta>("incentivo_resolvedor");
  const [valorOfertado, setValorOfertado] = useState<number>(valorPadraoDaCondicao("incentivo_resolvedor"));
  const [registrando, setRegistrando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function aoTrocarCondicao(nova: CondicaoOferta) {
    setCondicao(nova);
    setValorOfertado(valorPadraoDaCondicao(nova));
  }

  async function registrar() {
    setErro(null);
    setRegistrando(true);
    try {
      const nova = await registrarOferta(jornadaId, { condicao, valor_ofertado: valorOfertado });
      aoAtualizar([nova, ...ofertas]);
      setMostrarFormulario(false);
    } catch (e) {
      setErro(e instanceof ErroSessao ? e.message : "Não deu para registrar a oferta. Tente de novo.");
    } finally {
      setRegistrando(false);
    }
  }

  function atualizarOfertaNaLista(atualizada: Oferta) {
    aoAtualizar(ofertas.map((o) => (o.id === atualizada.id ? atualizada : o)));
  }

  return (
    <section aria-labelledby="titulo-oferta" className="flex flex-col gap-2 rounded-sm border border-linha bg-papel px-3 py-3 sm:px-4">
      <div className="flex items-center justify-between">
        <h2 id="titulo-oferta" className="font-serif text-sm font-bold text-tinta">
          Oferta do Croqui Estrutural — PARTE 11/12
        </h2>
        {ofertas.length > 0 && !mostrarFormulario && (
          <Botao variante="fantasma" className="px-2 py-1 text-xs" onClick={() => setMostrarFormulario(true)}>
            + Registrar outra oferta
          </Botao>
        )}
      </div>

      {ofertas.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {ofertas.map((o) => (
            <LinhaOferta key={o.id} jornadaId={jornadaId} oferta={o} aoAtualizar={atualizarOfertaNaLista} />
          ))}
        </ul>
      )}

      {mostrarFormulario && (
        <div className="flex flex-col gap-2.5 rounded-sm border border-dashed border-linha-forte px-3 py-3">
          <div role="radiogroup" aria-label="Condição da oferta" className="flex flex-wrap gap-2">
            {(["padrao", "incentivo_resolvedor"] as const).map((opcao) => (
              <label
                key={opcao}
                className={`flex cursor-pointer items-center gap-2 rounded-sm border px-3 py-1.5 text-sm ${
                  condicao === opcao ? "border-[color:var(--latao)] bg-latao-fraco text-tinta" : "border-linha-forte text-tinta-suave"
                }`}
              >
                <input
                  type="radio"
                  name="condicao-oferta"
                  className="sr-only"
                  checked={condicao === opcao}
                  onChange={() => aoTrocarCondicao(opcao)}
                />
                {ROTULO_CONDICAO[opcao]} · {formatarMoeda(valorPadraoDaCondicao(opcao))}
              </label>
            ))}
          </div>

          <label className="flex flex-col gap-1 text-xs text-tinta-fraca">
            Valor ofertado (ajustável — negociação ao vivo)
            <input
              type="number"
              min={0}
              step={100}
              value={valorOfertado}
              onChange={(e) => setValorOfertado(Number(e.target.value))}
              className="w-40 rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1.5 text-sm text-tinta"
            />
          </label>

          {erro && (
            <p role="alert" className="text-xs text-[color:var(--vermelho)]">
              {erro}
            </p>
          )}

          <div className="flex items-center gap-2">
            <Botao variante="primario" carregando={registrando} onClick={registrar}>
              Registrar oferta
            </Botao>
            {ofertas.length > 0 && (
              <Botao variante="fantasma" onClick={() => setMostrarFormulario(false)} disabled={registrando}>
                Cancelar
              </Botao>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
