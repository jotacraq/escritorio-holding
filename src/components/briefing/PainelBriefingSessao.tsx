"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { buscarBriefing, gerarBriefing, ApiError, type BriefingResumo } from "@/lib/api";
import { useRecurso } from "@/hooks/useRecurso";
import { Botao } from "@/components/ui/Botao";
import { EstadoCarregando } from "@/components/ui/Estado";
import { ConteudoCompacto } from "@/components/briefing/atomos";
import type { BriefingConteudoV2 } from "@/components/briefing/tipos";

/** Chave de localStorage: aberto/fechado é decisão do usuário, sobrevive a F5. */
function chaveAberto(sessaoId: string) {
  return `sic-hf:sessao:${sessaoId}:briefing-aberto`;
}

/**
 * U1 (ARQUITETURA-FASE-3.md §5.3) — o Briefing Estratégico dentro do Modo
 * Conduzir Sessão. É um recorte, não a análise inteira: só o que muda o que
 * a Dra. Elaine diz nos próximos minutos. A aba "Briefing" da Ficha 360
 * (`BriefingAba.tsx`) continua sendo a versão completa, com as 12 seções.
 *
 * Nada aqui é inventado quando falta: sem briefing gerado, mostra o estado
 * real (nenhum briefing) e o caminho de gerar — nunca um exemplo plausível.
 * Marca de fidelidade de frase e score de completude só aparecem quando o
 * backend expuser `verificacao`/`completude_entrada` (ver `tipos.ts`) — hoje
 * não expõe, então ficam ausentes, nunca fabricados.
 */
export function PainelBriefingSessao({
  jornadaId,
  sessaoId,
  briefingAtual,
}: {
  jornadaId: string;
  sessaoId: string;
  briefingAtual: BriefingResumo | null;
}) {
  const buscar = useCallback(
    () => (briefingAtual ? buscarBriefing(briefingAtual.id) : Promise.resolve(null)),
    [briefingAtual],
  );
  const { dados: briefing, carregando, erro: erroCarregarBruto, setDados: setBriefing } = useRecurso(buscar, [briefingAtual?.id ?? null]);
  const erroCarregar = erroCarregarBruto instanceof ApiError ? erroCarregarBruto : erroCarregarBruto ? new ApiError("Erro ao carregar o briefing.", 500) : null;

  const [gerando, setGerando] = useState(false);
  const [erroGerar, setErroGerar] = useState<ApiError | null>(null);

  const [aberto, setAberto] = useState(true);
  useEffect(() => {
    try {
      const salvo = window.localStorage.getItem(chaveAberto(sessaoId));
      // Leitura de um sistema externo (localStorage) após montar — mesmo caso
      // legítimo documentado em `useTema.ts`.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (salvo !== null) setAberto(salvo === "1");
    } catch {
      /* localStorage indisponível — mantém aberto por padrão */
    }
  }, [sessaoId]);

  function alternarAberto() {
    setAberto((atual) => {
      const proximo = !atual;
      try {
        window.localStorage.setItem(chaveAberto(sessaoId), proximo ? "1" : "0");
      } catch {
        /* ok não persistir */
      }
      return proximo;
    });
  }

  async function gerar() {
    setGerando(true);
    setErroGerar(null);
    try {
      const res = await gerarBriefing(jornadaId, false);
      const gerado = await buscarBriefing(res.briefing_id);
      setBriefing(gerado);
    } catch (e) {
      setErroGerar(e instanceof ApiError ? e : new ApiError("Não foi possível gerar o briefing.", 500));
    } finally {
      setGerando(false);
    }
  }

  const c = briefing ? (briefing.conteudo as unknown as BriefingConteudoV2) : null;

  return (
    <aside
      aria-label="Briefing Estratégico"
      className="nao-imprimir flex flex-col rounded-sm border border-linha bg-papel-elevado shadow-[var(--sombra-cartao)] lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)]"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-linha px-3.5 py-2.5">
        <h2 className="font-serif text-sm font-bold text-tinta">Briefing Estratégico</h2>
        <div className="flex items-center gap-1">
          {briefingAtual && (
            <Link
              href={`/jornadas/${jornadaId}#briefing`}
              className="rounded-sm px-1.5 py-1 text-xs text-tinta-suave underline decoration-linha-forte hover:text-tinta"
            >
              Ver completo
            </Link>
          )}
          <button
            type="button"
            aria-expanded={aberto}
            aria-controls="painel-briefing-sessao-conteudo"
            onClick={alternarAberto}
            className="flex items-center gap-1 rounded-sm border border-linha px-2 py-1 text-xs font-medium text-tinta-suave hover:bg-papel-fundo hover:text-tinta"
          >
            {aberto ? "Recolher" : "Mostrar"}
            <svg aria-hidden="true" viewBox="0 0 20 20" className={`h-3 w-3 fill-current transition-transform ${aberto ? "rotate-180" : ""}`}>
              <path d="M5.5 7.5 10 12l4.5-4.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      {aberto && (
        <div id="painel-briefing-sessao-conteudo" className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
          {carregando && <EstadoCarregando rotulo="Carregando briefing…" />}

          {!carregando && erroCarregar && (
            <p role="alert" className="text-sm text-[color:var(--vermelho)]">{erroCarregar.message}</p>
          )}

          {!carregando && !erroCarregar && !briefingAtual && (
            <SemBriefing gerando={gerando} erro={erroGerar} aoGerar={gerar} />
          )}

          {!carregando && !erroCarregar && briefing && c && <ConteudoCompacto briefing={briefing} c={c} />}
        </div>
      )}
    </aside>
  );
}

function SemBriefing({ gerando, erro, aoGerar }: { gerando: boolean; erro: ApiError | null; aoGerar: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2.5 rounded-sm border border-dashed border-linha-forte px-3 py-4 text-sm text-tinta-suave">
      <p className="font-medium text-tinta">Nenhum briefing gerado ainda</p>
      <p>Sem análise, este painel não mostra nada — nenhum exemplo é inventado no lugar dela.</p>
      <Botao variante="primario" carregando={gerando} onClick={aoGerar} className="mt-1">
        Gerar briefing agora
      </Botao>
      {gerando && (
        <p role="status" className="text-xs text-tinta-suave">
          Gerando com IA — isso costuma levar de 30 segundos a 1 minuto. A tela não travou, aguarde.
        </p>
      )}
      {erro && (
        <p role="alert" className="w-full rounded-sm border border-vermelho bg-vermelho-fraco px-2.5 py-2 text-xs text-[color:var(--vermelho)]">
          {mensagemErroGerar(erro)}
        </p>
      )}
    </div>
  );
}

function mensagemErroGerar(erro: ApiError): string {
  if (erro.status === 503) {
    return "Sem chave de IA configurada ou sem consentimento de tratamento por IA registrado. Nenhum briefing de mentira é mostrado aqui.";
  }
  if (erro.status === 409) {
    return "Dados insuficientes para um briefing confiável (formulário/ligação incompletos, ou já existe um briefing atual). Veja a aba Briefing na ficha completa.";
  }
  if (erro.status === 429) {
    return "Limite de gerações de IA atingido por agora. Tente de novo em instantes.";
  }
  return erro.message;
}

