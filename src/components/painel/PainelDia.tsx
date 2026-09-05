"use client";

import { useMemo, useState } from "react";
import { Botao } from "@/components/ui/Botao";
import { CabecalhoPagina } from "@/components/ui/CabecalhoPagina";
import { EsqueletoCartao, EsqueletoLista } from "@/components/ui/Esqueleto";
import { EstadoErro } from "@/components/ui/Estado";
import { Kpi } from "@/components/ui/Kpi";
import { TourPrimeiraVez } from "@/components/onboarding/TourPrimeiraVez";
import { formatarDataHora } from "@/lib/formatar";
import type { PainelDiaNormalizado } from "@/types/painel-ui";
import { usePainelDia } from "./usePainelDia";
import { SessoesHoje } from "./SessoesHoje";
import { PreparoPendente } from "./PreparoPendente";
import { PagosSemContato } from "./PagosSemContato";
import { Travado } from "./Travado";
import { NumerosSemana } from "./NumerosSemana";
import { ProvaDeVida } from "./ProvaDeVida";

const FORMATADOR_DATA_TITULO = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  weekday: "long",
  day: "2-digit",
  month: "long",
});

const ICONE_ATUALIZAR = (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 10a6 6 0 1 1-1.8-4.3M16 3v3.5h-3.5" />
  </svg>
);
const ICONE_AJUDA = (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm-2-8.5a2 2 0 1 1 3 1.7c-.7.4-1 .9-1 1.6M10 14.5h.01" />
  </svg>
);

/**
 * Os quatro números do topo — só o que já está carregado; nada de fetch a
 * mais. Bloco indisponível vira `null` (travessão + motivo). "Confirmaram
 * presença" só existe quando a view do agente A traz a coluna: sem ela, o
 * KPI diz que a informação ainda não está disponível.
 */
function resumirKpis(dados: PainelDiaNormalizado) {
  const sessoes = dados.sessoesDoDia.situacao === "ok" ? dados.sessoesDoDia.itens : null;
  const temColunaPresenca = sessoes?.some((s) => s.presenca_confirmada_em !== undefined) ?? false;
  return {
    sessoes: sessoes ? sessoes.length : null,
    confirmaram: sessoes && temColunaPresenca ? sessoes.filter((s) => Boolean(s.presenca_confirmada_em)).length : null,
    motivoConfirmaram: !sessoes ? "não conseguiu carregar as sessões" : sessoes.length === 0 ? "nenhuma sessão nas próximas 48 h" : "confirmação de presença ainda não disponível",
    pagosSemContato: dados.pagosSemContato.situacao === "ok" ? dados.pagosSemContato.itens.length : null,
    travados: dados.pendenciasSistema.situacao === "ok" ? dados.pendenciasSistema.itens.length : null,
  };
}

/**
 * Painel do dia — a primeira tela que a Dra. Elaine vê. Fila do dia em
 * ordem de urgência, não kanban para varrer (ARQUITETURA-FASE-2 §4.6 / §8 UX).
 *
 * Sem polling: uma busca ao montar, e uma sob clique em "Atualizar". O
 * egress do Supabase é da organização inteira e já custou caro num sistema
 * desta casa com aba parada fazendo polling.
 *
 * "Atualizado às" usa `gerado_em` — o instante que o servidor calculou o
 * painel, não o relógio do navegador — para não afirmar uma frescura que
 * ninguém mediu. Sem esse campo na resposta, o rótulo simplesmente não
 * aparece (vazio nunca vira dado inventado).
 */
export function PainelDia() {
  const { dados, carregando, erro, recarregar } = usePainelDia();
  const semNenhumaCargaAinda = !dados;
  const [versao, setVersao] = useState(0);
  const [tourAberto, setTourAberto] = useState(false);
  const kpis = useMemo(() => (dados ? resumirKpis(dados) : null), [dados]);

  function atualizar() {
    recarregar();
    setVersao((v) => v + 1);
  }

  return (
    <div className="flex flex-col gap-8">
      <CabecalhoPagina
        rotulo="Dia a dia"
        titulo={<span className="capitalize">{FORMATADOR_DATA_TITULO.format(new Date())}</span>}
        descricao="O que precisa da sua atenção agora, em ordem de urgência — não o quadro inteiro para varrer."
        acoes={
          <>
            <Botao variante="fantasma" icone={ICONE_AJUDA} onClick={() => setTourAberto(true)}>
              Como funciona
            </Botao>
            <Botao variante="secundario" icone={ICONE_ATUALIZAR} onClick={atualizar} carregando={carregando}>
              Atualizar
            </Botao>
          </>
        }
        meta={
          <>
            {dados?.geradoEm && <span>Atualizado às {formatarDataHora(dados.geradoEm)}</span>}
            {Boolean(erro) && !semNenhumaCargaAinda && (
              <span role="alert" className="text-[color:var(--vermelho)]">
                Não foi possível atualizar agora — mostrando a última carga bem-sucedida.
              </span>
            )}
          </>
        }
      />

      {carregando && semNenhumaCargaAinda && (
        <div className="flex flex-col gap-6">
          <EsqueletoCartao quantidade={4} rotulo="Carregando o painel do dia…" />
          <EsqueletoLista linhas={3} rotulo="" />
          <EsqueletoLista linhas={2} rotulo="" />
        </div>
      )}

      {Boolean(erro) && semNenhumaCargaAinda && <EstadoErro erro={erro} tentarNovamente={atualizar} titulo="Não deu para carregar o painel" />}

      {dados && kpis && (
        <>
          <section aria-label="Resumo de hoje" className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <Kpi rotulo="Sessões nas próximas 48 h" valor={kpis.sessoes} motivoVazio="não conseguiu carregar as sessões" acao={<a href="#sessoes-hoje" className="text-[color:var(--latao)] hover:underline">Ver as sessões</a>} />
            <Kpi rotulo="Confirmaram presença" valor={kpis.confirmaram} unidade={kpis.sessoes ? `de ${kpis.sessoes}` : undefined} motivoVazio={kpis.motivoConfirmaram} />
            <Kpi rotulo="Pagaram e ninguém ligou" valor={kpis.pagosSemContato} motivoVazio="não conseguiu carregar" acao={<a href="#pagos-sem-contato" className="text-[color:var(--latao)] hover:underline">Ver quem</a>} />
            <Kpi rotulo="Travado no sistema" valor={kpis.travados} motivoVazio="não conseguiu carregar" acao={<a href="#travado" className="text-[color:var(--latao)] hover:underline">Ver o que</a>} />
          </section>

          <div className="flex flex-col gap-6">
            <PagosSemContato estado={dados.pagosSemContato} aoTentarDeNovo={atualizar} />
            <SessoesHoje estado={dados.sessoesDoDia} aoTentarDeNovo={atualizar} />
            <PreparoPendente estado={dados.pendenciasPreparo} aoTentarDeNovo={atualizar} />
            <Travado estado={dados.pendenciasSistema} aoTentarDeNovo={atualizar} />
            <ProvaDeVida versao={versao} />
            <NumerosSemana estado={dados.indicadoresSemana} aoTentarDeNovo={atualizar} />
          </div>
        </>
      )}

      <TourPrimeiraVez forcarAbrir={tourAberto} aoFechar={() => setTourAberto(false)} />
    </div>
  );
}
