"use client";

import { useMemo, useState } from "react";
import { Botao } from "@/components/ui/Botao";
import { CabecalhoPagina } from "@/components/ui/CabecalhoPagina";
import { EsqueletoCartao, EsqueletoLista } from "@/components/ui/Esqueleto";
import { EstadoErro } from "@/components/ui/Estado";
import { Kpi } from "@/components/ui/Kpi";
import { TourPrimeiraVez } from "@/components/onboarding/TourPrimeiraVez";
import { useUsuarioAtual } from "@/hooks/useUsuarioAtual";
import { formatarDataHora } from "@/lib/formatar";
import type { PainelDiaNormalizado } from "@/types/painel-ui";
import { usePainelDia } from "./usePainelDia";
import { blocosDoPapel, type ChaveBlocoPainel } from "./blocosPorPapel";
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
 * "sábado, 05 de setembro" → "Sábado, 05 de setembro". `capitalize` do CSS
 * subiria também o "De" do meio, o que a Neuetra bold deixa feio no display.
 */
function comMaiusculaInicial(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Link "ver detalhe" de KPI: alvo de 44px de altura, como manda o design system. */
const CLASSE_LINK_KPI = "inline-flex min-h-11 items-center text-[color:var(--latao)] hover:underline";

/**
 * Enquanto o papel não carregou, valem só os blocos que **todo** papel vê.
 * É o oposto de "mostra tudo e esconde depois": bloco de sistema nunca
 * chega ao DOM de quem não é admin, nem por um quadro de render.
 */
const BLOCOS_ENQUANTO_CARREGA: ChaveBlocoPainel[] = ["sessoes_hoje", "preparo"];

/**
 * Os números do topo — só o que já está carregado; nada de fetch a mais, e
 * só o que o papel de quem olha pode ver. Bloco indisponível vira `null`
 * (travessão + motivo). "Confirmaram presença" só existe quando a view do
 * agente A traz a coluna: sem ela, o KPI diz que a informação ainda não está
 * disponível.
 */
function resumirKpis(dados: PainelDiaNormalizado) {
  const sessoes = dados.sessoesDoDia.situacao === "ok" ? dados.sessoesDoDia.itens : null;
  const temColunaPresenca = sessoes?.some((s) => s.presenca_confirmada_em !== undefined) ?? false;
  return {
    sessoes: sessoes ? sessoes.length : null,
    confirmaram: sessoes && temColunaPresenca ? sessoes.filter((s) => Boolean(s.presenca_confirmada_em)).length : null,
    motivoConfirmaram: !sessoes ? "não carregou" : sessoes.length === 0 ? "sem sessão nas próximas 48 h" : "presença ainda não disponível",
    pagosSemContato: dados.pagosSemContato.situacao === "ok" ? dados.pagosSemContato.itens.length : null,
    travados: dados.pendenciasSistema.situacao === "ok" ? dados.pendenciasSistema.itens.length : null,
  };
}

/**
 * Painel do dia — a primeira tela que a Dra. Elaine vê. Fila do dia em
 * ordem de urgência, não kanban para varrer (ARQUITETURA-FASE-2 §4.6 / §8 UX).
 *
 * Fase 5 §9.1 — **duas visões, decididas pelo papel**: advogada vê sessão,
 * preparo e números; relacionamento vê quem pagou e o que travou; admin vê
 * tudo, em seções rotuladas, com o sistema reduzido a uma linha. Bloco fora
 * da lista do papel não é renderizado — e o que ele buscaria não é buscado
 * (a prova de vida faz o próprio `GET /api/mensagens`; para não-admin esse
 * fetch simplesmente não acontece).
 *
 * Sem polling: uma busca ao montar, e uma sob clique em "Atualizar". O
 * egress do Supabase é da organização inteira e já custou caro num sistema
 * desta casa com aba parada fazendo polling.
 *
 * "Atualizado às" usa `gerado_em` — o instante que o servidor calculou o
 * painel, não o relógio do navegador.
 */
export function PainelDia() {
  const { dados, carregando, erro, recarregar } = usePainelDia();
  const { usuario, carregando: carregandoUsuario } = useUsuarioAtual();
  const semNenhumaCargaAinda = !dados;
  const [versao, setVersao] = useState(0);
  const [tourAberto, setTourAberto] = useState(false);
  const kpis = useMemo(() => (dados ? resumirKpis(dados) : null), [dados]);

  const papel = usuario?.papel ?? null;
  const ehAdmin = papel === "admin";
  const blocos = useMemo(
    () => new Set<ChaveBlocoPainel>(carregandoUsuario ? BLOCOS_ENQUANTO_CARREGA : blocosDoPapel(papel)),
    [carregandoUsuario, papel],
  );
  const ve = (b: ChaveBlocoPainel) => blocos.has(b);

  function atualizar() {
    recarregar();
    setVersao((v) => v + 1);
  }

  return (
    <div className="flex flex-col gap-secao">
      <CabecalhoPagina
        rotulo="Dia a dia"
        titulo={comMaiusculaInicial(FORMATADOR_DATA_TITULO.format(new Date()))}
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
                Não atualizou — mostrando a última carga.
              </span>
            )}
          </>
        }
      />

      {carregando && semNenhumaCargaAinda && (
        <div className="flex flex-col gap-bloco">
          <EsqueletoCartao quantidade={4} rotulo="Carregando o painel do dia…" />
          <EsqueletoLista linhas={3} rotulo="" />
          <EsqueletoLista linhas={2} rotulo="" />
        </div>
      )}

      {Boolean(erro) && semNenhumaCargaAinda && <EstadoErro erro={erro} tentarNovamente={atualizar} titulo="Não deu para carregar o painel" />}

      {dados && kpis && (
        <>
          <section aria-label="Resumo de hoje" className="grid grid-cols-2 gap-cartao xl:grid-cols-4">
            <Kpi
              rotulo="Sessões em 48 h"
              valor={kpis.sessoes}
              motivoVazio="não carregou"
              acao={
                <a href="#sessoes-hoje" className={CLASSE_LINK_KPI}>
                  Ver as sessões
                </a>
              }
            />
            <Kpi rotulo="Confirmaram presença" valor={kpis.confirmaram} unidade={kpis.sessoes ? `de ${kpis.sessoes}` : undefined} motivoVazio={kpis.motivoConfirmaram} />
            {ve("pagos_sem_contato") && (
              <Kpi
                rotulo="Pagaram sem contato"
                valor={kpis.pagosSemContato}
                motivoVazio="não carregou"
                acao={
                  <a href="#pagos-sem-contato" className={CLASSE_LINK_KPI}>
                    Ver quem
                  </a>
                }
              />
            )}
            {ve("travado") && (
              <Kpi
                rotulo="Travado"
                valor={kpis.travados}
                motivoVazio="não carregou"
                acao={
                  <a href="#travado" className={CLASSE_LINK_KPI}>
                    Ver o que
                  </a>
                }
              />
            )}
          </section>

          {/* Seção 1 — o que depende de gente. Para o admin ela é rotulada,
              porque logo abaixo vem a seção do sistema; para os demais papéis
              não há segunda seção, e um rótulo de seção única seria ruído. */}
          <section aria-labelledby={ehAdmin ? "secao-acoes" : undefined} aria-label={ehAdmin ? undefined : "Ações de hoje"} className="flex flex-col gap-bloco">
            {ehAdmin && (
              <h2 id="secao-acoes" className="text-subtitulo font-bold text-tinta">
                Ações de hoje
              </h2>
            )}
            {ve("pagos_sem_contato") && <PagosSemContato estado={dados.pagosSemContato} aoTentarDeNovo={atualizar} />}
            {ve("sessoes_hoje") && <SessoesHoje estado={dados.sessoesDoDia} aoTentarDeNovo={atualizar} />}
            {ve("preparo") && <PreparoPendente estado={dados.pendenciasPreparo} aoTentarDeNovo={atualizar} />}
            {ve("travado") && <Travado estado={dados.pendenciasSistema} papel={papel} aoTentarDeNovo={atualizar} />}
            {ve("numeros") && <NumerosSemana estado={dados.indicadoresSemana} aoTentarDeNovo={atualizar} />}
          </section>

          {/* Seção 2 — sistema. Existe só para o admin, e cabe numa linha. */}
          {ve("sistema") && (
            <section aria-labelledby="secao-sistema" className="flex flex-col gap-item">
              <h2 id="secao-sistema" className="text-subtitulo font-bold text-tinta">
                Sistema
              </h2>
              <ProvaDeVida versao={versao} />
            </section>
          )}
        </>
      )}

      <TourPrimeiraVez forcarAbrir={tourAberto} aoFechar={() => setTourAberto(false)} />
    </div>
  );
}
