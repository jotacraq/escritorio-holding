"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useFicha360 } from "@/hooks/useFicha360";
import { useBriefingAtual } from "@/hooks/useBriefingAtual";
import { useCroquiDaJornada } from "@/hooks/useCroquiDaJornada";
import { EstadoErro } from "@/components/ui/Estado";
import { EsqueletoFicha, EsqueletoLista } from "@/components/ui/Esqueleto";
import { CabecalhoFicha } from "@/components/ficha360/CabecalhoFicha";
import { PastaDoCliente } from "@/components/pasta/PastaDoCliente";
import { Gaveta } from "@/components/ui/Gaveta";
import { Botao } from "@/components/ui/Botao";
import { LinkBotao } from "@/components/ui/LinkBotao";
import { BarraAcaoMobile } from "@/components/ui/BarraAcaoMobile";
import { derivarPasta, type ItemPasta } from "@/lib/pasta/derivar";
import { sinaisDaFicha } from "@/lib/pasta/sinais";
import { agruparPorSessao, derivarTrilho, type ChaveSessao } from "@/lib/pasta/trilho";
import { ITENS_EM_GAVETA } from "@/lib/pasta/rotas";
import type { ChaveItemPasta } from "@/lib/pasta/catalogo";
import { tabDoItem, interpretarHashFicha, TABS_FICHA, type ChaveTabFicha } from "@/lib/pasta/tabs";
import { TabsFicha, type PainelTabFicha } from "@/components/ficha360/TabsFicha";
import { extrasDaFicha, proximoAgendamentoAtivo } from "@/components/ficha360/api-extras";
import { TrilhoDaFicha, acaoDeAgora } from "@/components/ficha360/TrilhoDaFicha";
import { PrazosDaFicha } from "@/components/ficha360/PrazosDaFicha";
import { AutomacoesFicha } from "@/components/ficha360/AutomacoesFicha";
import { RadarDocumentos } from "@/components/ficha360/RadarDocumentos";
import { RecebidasFicha } from "@/components/ficha360/RecebidasFicha";
import { BarraEnviar } from "@/components/ficha360/BarraEnviar";
import { CartaoCroqui } from "@/components/ficha360/CartaoCroqui";
import type { SinaisSessaoPasta } from "@/components/pasta/PastaDoCliente";
import type { Ficha360 } from "@/lib/api";

/**
 * A Ficha do cliente — Fase 6, com a Fatia 3 (tabs) por cima.
 *
 * O diagnóstico do João, depois de usar a Fase 5: *"A Pasta do cliente está
 * confusa; as abas (briefing, sessão, análise da sessão) estão confusas. Eu
 * não consigo reunir os dados e ver: esse cara, a situação dele é essa, isso
 * vai acontecer, falta isso para terminar."*
 *
 * A Ficha passa a responder cinco perguntas, de cima para baixo, **numa tela
 * só**:
 *   1. QUEM É        — a faixa de identidade + a gaveta "Ficha completa".
 *   2. ONDE ESTÁ     — as 3 sessões (`TrilhoDaFicha`), com a atual aberta.
 *   3. A PRÓXIMA AÇÃO— um botão só, `data-acao-agora`, dentro do trilho.
 *   4. O QUE ENVIAR  — a barra "Enviar": os links desta pessoa, 1 clique.
 *   5. O QUE ACONTECEU / O QUE FALTA — a Pasta, agora dividida em 4 TABS.
 *
 * Fatia 3 (16/09/2026) — pedido literal do João: *"dividir em tabs: sessão ·
 * croqui · holding · documentos. Não podem ocupar o mesmo espaço."* Correção
 * do João na mesma rodada: as 4 tabs nascem **sempre visíveis** — "não
 * preciso ocultar" (sem chave de `configuracoes` para isso). "Foca na sessão
 * hoje" vira só a tab PADRÃO (a que abre primeiro), não uma tab escondida.
 * As 4 tabs vivem em `lib/pasta/tabs.ts`; o catálogo de gavetas
 * (`ITENS_EM_GAVETA`, `CHAVES_EM_GAVETA` logo abaixo) e os deep-links por
 * hash continuam intocados — abrir uma gaveta agora também troca para a tab
 * dona dela (`abrir()`), então o hash de fora continua achando o conteúdo
 * certo.
 *
 * **A barra de abas antiga (por artefato) acabou; esta é outra, por
 * momento.** O deep-link por hash continua funcionando — inclusive os de
 * fora (`hrefDoPasso`, chips do Painel, `#briefing` do cabeçalho) —, só que
 * agora todo hash conhecido abre gaveta E seleciona a tab dela.
 *
 * O croqui virou cartão + botão (`CartaoCroqui`): as 19 tabelas moram em
 * `/croquis/[id]`, e eram ~8.600 px de DOM em toda abertura de Ficha.
 */

/**
 * As onze telas de gaveta chegam por `dynamic()`, não por `import` estático.
 *
 * Motivo medido (06/09/2026, Playwright + `getEntriesByType("resource")`, dev,
 * cache frio): a Ficha baixava 8.091 KB de JS para desenhar a dobra, e onze
 * desses módulos — os maiores do projeto: `RelatorioAba` 624 linhas,
 * `PatrimonioAba` 547, `BriefingAba` 397 — só são montados quando alguém
 * ABRE a gaveta. `Gaveta` devolve `null` fechada, então o `dynamic` nem é
 * renderizado até o clique: o módulo não entra na carga inicial.
 *
 * `ssr` fica no padrão (`true`): a Ficha inteira é `"use client"`, e desligar
 * SSR aqui só mudaria o HTML inicial de uma tela que já nasce vazia.
 *
 * O `loading` não é enfeite: é o que a pessoa vê no primeiro clique de cada
 * gaveta, enquanto o chunk vem. Rodapé da gaveta e foco continuam com a
 * `Gaveta` (o fallback vive DENTRO dela), então nada de acessibilidade muda.
 */
const FormularioAba = dynamic(() => import("@/components/ficha360/FormularioAba").then((m) => m.FormularioAba), {
  loading: () => <EsqueletoLista linhas={6} rotulo="Abrindo o formulário…" />,
});
const LigacaoAba = dynamic(() => import("@/components/ficha360/LigacaoAba").then((m) => m.LigacaoAba), {
  loading: () => <EsqueletoLista linhas={6} rotulo="Abrindo o contato…" />,
});
const PatrimonioAba = dynamic(() => import("@/components/ficha360/PatrimonioAba").then((m) => m.PatrimonioAba), {
  loading: () => <EsqueletoLista linhas={6} rotulo="Abrindo o patrimônio…" />,
});
const DocumentosAba = dynamic(() => import("@/components/ficha360/DocumentosAba").then((m) => m.DocumentosAba), {
  loading: () => <EsqueletoLista linhas={6} rotulo="Abrindo os documentos…" />,
});
const SessaoAba = dynamic(() => import("@/components/ficha360/SessaoAba").then((m) => m.SessaoAba), {
  loading: () => <EsqueletoLista linhas={6} rotulo="Abrindo a sessão…" />,
});
const RelatorioAba = dynamic(() => import("@/components/ficha360/RelatorioAba").then((m) => m.RelatorioAba), {
  loading: () => <EsqueletoLista linhas={6} rotulo="Abrindo o relatório…" />,
});
const BriefingAba = dynamic(() => import("@/components/briefing/BriefingAba").then((m) => m.BriefingAba), {
  loading: () => <EsqueletoLista linhas={6} rotulo="Abrindo o briefing…" />,
});
const MaterialAba = dynamic(() => import("@/components/ficha360/MaterialAba").then((m) => m.MaterialAba), {
  loading: () => <EsqueletoLista linhas={6} rotulo="Abrindo o material…" />,
});
const AnaliseSessaoAba = dynamic(() => import("@/components/ficha360/AnaliseSessaoAba").then((m) => m.AnaliseSessaoAba), {
  loading: () => <EsqueletoLista linhas={6} rotulo="Abrindo a análise…" />,
});
const RetrospectoAba = dynamic(() => import("@/components/ficha360/RetrospectoAba").then((m) => m.RetrospectoAba), {
  loading: () => <EsqueletoLista linhas={6} rotulo="Abrindo o retrospecto…" />,
});
const TimelineAba = dynamic(() => import("@/components/ficha360/TimelineAba").then((m) => m.TimelineAba), {
  loading: () => <EsqueletoLista linhas={6} rotulo="Abrindo o histórico…" />,
});
const DiagnosticoSv = dynamic(() => import("@/components/ficha360/DiagnosticoSv").then((m) => m.DiagnosticoSv), {
  loading: () => <EsqueletoLista linhas={6} rotulo="Abrindo o diagnóstico…" />,
});

/** Rótulo de cada gaveta — o nome de negócio, igual ao da Pasta. */
const TITULO_GAVETA: Record<string, string> = {
  formulario: "Formulário",
  ligacao: "Contato da equipe",
  documentos: "Documentos",
  patrimonio: "Patrimônio",
  briefing: "Briefing",
  sessao: "Sessão",
  analise_sessao: "Análise da sessão",
  relatorio_sv: "Relatório da sessão",
  // Fase 13 — "Retrospecto", NUNCA "Relatório": a linha de cima é o
  // documento que a advogada preenche à mão; este é o fechamento do
  // copiloto, gerado pela máquina (§D.1 do plano, `Glossario.md`).
  retrospecto_sv: "Retrospecto da sessão",
  diagnostico_sv: "Diagnóstico",
  material: "Material",
  transcricao: "Histórico",
};

/**
 * Toda chave que abre gaveta nesta tela. `ITENS_EM_GAVETA` (o contrato da
 * Fase 3, em `lib/pasta/rotas.ts`) é o subconjunto que já era gaveta; as
 * demais eram abas e viraram gaveta aqui. `historico` não é item da Pasta —
 * é a linha do tempo, alcançável pelo botão do rodapé e por `#historico`.
 */
const CHAVES_EM_GAVETA = new Set<string>([
  ...ITENS_EM_GAVETA,
  "briefing",
  "sessao",
  "analise_sessao",
  "relatorio_sv",
  "retrospecto_sv",
  "diagnostico_sv",
  "material",
  "historico",
  // Aliases dos hashes antigos, para link salvo/colado não morrer.
  "links",
  "analise-sessao",
  "relatorio",
  "retrospecto",
  "diagnostico",
  "timeline",
]);

/** Hash antigo -> chave nova. Um link colado no WhatsApp da equipe continua abrindo. */
const ALIAS_HASH: Record<string, string> = {
  "analise-sessao": "analise_sessao",
  relatorio: "relatorio_sv",
  // `/jornadas/<id>#retrospecto` é a URL de consulta publicada no pop-up do
  // encerramento (§D.6) — mesmo par hash/chave de `relatorio`.
  retrospecto: "retrospecto_sv",
  diagnostico: "diagnostico_sv",
  timeline: "historico",
  // `links` era a aba de emissão; hoje quem responde por link é a barra "Enviar".
  links: "enviar",
};

export default function PaginaFicha360({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { ficha, carregando, erro, recarregar } = useFicha360(id);

  // Recarregar depois de uma ação NÃO derruba a tela — a ficha antiga fica de
  // pé enquanto a nova chega (senão toda ação em gaveta fechava a gaveta e
  // piscava a página inteira). Só a primeira carga mostra o esqueleto.
  if (carregando && !ficha) return <EsqueletoFicha rotulo="Carregando a ficha…" />;
  if (erro && !ficha) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível abrir esta ficha" />;
  if (!ficha) return null;

  return <ConteudoFicha id={id} ficha={ficha} recarregar={recarregar} />;
}

function ConteudoFicha({ id, ficha, recarregar }: { id: string; ficha: Ficha360; recarregar: () => void }) {
  // Busca única do Briefing atual — antes `CabecalhoFicha` e `BriefingAba`
  // buscavam o mesmo `briefingAtual.id` cada um por conta própria.
  const { briefing, setBriefing, carregando: carregandoBriefing, erro: erroBriefing } = useBriefingAtual(ficha.briefingAtual?.id ?? null);

  // O backend não manda uma flag "pode ver patrimônio" — manda `null` no lugar
  // do array quando o papel não permite. É esse null que decide a UI aqui.
  const podeVerPatrimonio = ficha.patrimonio !== null;

  // Estado do Croqui elevado para cá (mesma cirurgia de `useBriefingAtual`).
  // O hook é SEMPRE chamado (regra dos hooks do React); `croquiId` já nasce
  // `null` quando não há croqui na timeline.
  const estadoCroqui = useCroquiDaJornada({ jornadaId: id, ficha, timeline: ficha.timeline });

  // O catalogo nao tem mais item "Links" (ver `lib/pasta/derivar.ts`): a barra
  // "Enviar" esta SEMPRE na tela e responde por todo link publico. O hash
  // `#links` continua chegando aqui: `ALIAS_HASH` o manda para a barra.
  const pasta = derivarPasta(ficha, podeVerPatrimonio);

  // Qual das 3 sessoes esta acesa — a mesma derivacao do trilho (sem dados de
  // execucao), para a Pasta abrir o grupo certo. `TrilhoDaFicha` chama
  // `derivarTrilho(sinaisDaFicha(ficha))` de novo internamente (ele soma a
  // execucao via `sinaisComExecucao`, que so ele busca) — nao ha como
  // eliminar as duas chamadas sem tocar naquele componente, fora do escopo
  // desta rodada (T3). `useMemo` aqui evita, ao menos, recalcular esta metade
  // a cada render deste componente.
  const sessaoAtual = useMemo(() => agruparPorSessao(derivarTrilho(sinaisDaFicha(ficha))).find((b) => b.estado === "atual")?.chave ?? null, [ficha]);

  // Link cruzado Briefing <-> Análise da Sessão: a existência da análise vem do
  // evento `analise_sessao` que o trigger 0043 grava na timeline — já
  // carregada em `ficha.timeline`, sem requisição nova. Condicionado a
  // `podeVerPatrimonio` (achado MÉDIO do pentest, 04/09): sem isso, um papel
  // sem acesso a patrimônio via a timeline (que ele recebe sem gate) vazava a
  // EXISTÊNCIA de uma Análise da Sessão cujo conteúdo ele não pode ver.
  const temAnaliseSessao = podeVerPatrimonio && ficha.timeline.some((e) => e.tipo === "analise_sessao");

  const extras = extrasDaFicha(ficha);
  const proximoAgendamento = proximoAgendamentoAtivo(extras.agendamentos);
  const sinaisSessao: SinaisSessaoPasta = {
    proximaSessaoEm: proximoAgendamento?.inicio_em ?? null,
    presencaConfirmadaEm:
      proximoAgendamento && Object.prototype.hasOwnProperty.call(proximoAgendamento, "presenca_confirmada_em") ? (proximoAgendamento.presenca_confirmada_em ?? null) : undefined,
    presencaConfirmadaVia: proximoAgendamento?.presenca_confirmada_via ?? null,
    temLinkSala: ficha.sessao ? Boolean(ficha.sessao.link_sala) : null,
    ligacaoIaStatus: extras.ligacaoIaAtual?.status ?? null,
  };

  // Um dono só para a gaveta na tela inteira: a Pasta, o trilho, o cabeçalho e
  // o deep-link por hash mexem todos neste estado.
  const [gavetaAberta, setGavetaAberta] = useState<string | null>(null);

  // Tab ativa (Fatia 3). "Sessão" é o padrão — "foca na sessão hoje" (pedido
  // literal). As 4 tabs nascem sempre visíveis (correção do João: "não
  // preciso ocultar") — `TABS_FICHA` é o catálogo inteiro, sem filtro.
  const [tabAtiva, setTabAtiva] = useState<ChaveTabFicha>("sessao");

  // `abrir()` é o ÚNICO caminho para abrir gaveta na Ficha inteira (chip do
  // cabeçalho, trilho, cartão da Pasta, hash de fora). Antes de a Fatia 3
  // existir, isso bastava; agora, se o item mora numa tab diferente da
  // ativa, a tab tem que trocar junto — senão o usuário abre a gaveta pelo
  // chip do cabeçalho e, ao fechar, não entende por que o conteúdo "sumiu"
  // (estava certo, só que na tab que não está selecionada).
  const abrir = useCallback((chave: ChaveItemPasta | string) => {
    const chaveTexto = String(chave);
    const tabDona = tabDoItem(chaveTexto as ChaveItemPasta);
    if (tabDona) setTabAtiva(tabDona);
    setGavetaAberta(chaveTexto);
  }, []);
  const fechar = useCallback(() => setGavetaAberta(null), []);

  // Quando o próximo passo é mandar um link, o botão do trilho rola até a barra
  // "Enviar" e foca o botão daquele link. É o "cadê o link" resolvido no lugar
  // onde o operador estava olhando, sem tirá-lo da ficha.
  const barraRef = useRef<HTMLDivElement>(null);
  const croquiRef = useRef<HTMLDivElement>(null);
  const focarEnvio = useCallback((tipo: string) => {
    const alvo = barraRef.current?.querySelector<HTMLElement>(`[data-envio="${tipo}"] button`);
    barraRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    alvo?.focus();
  }, []);

  // Deep-link por hash. Todo hash conhecido abre gaveta (e troca de tab via
  // `abrir()`); hash de aba antiga passa pelo alias. `#enviar` rola até a
  // barra em vez de abrir gaveta — a barra "Enviar" vive fora das tabs.
  useEffect(() => {
    function aplicar() {
      const bruto = window.location.hash.slice(1);
      // `interpretarHashFicha` (lib/pasta/tabs.ts) é a decisão pura e
      // testada de mesa; aqui só resta EXECUTAR (mexer no DOM, rolar a
      // tela). `ALIAS_HASH`/`CHAVES_EM_GAVETA` continuam exatamente aqui —
      // são o contrato que o plano da Fatia 3 marca como intocado.
      const acao = interpretarHashFicha(bruto, ALIAS_HASH, CHAVES_EM_GAVETA);
      if (acao.tipo === "rolar-ate") {
        barraRef.current?.scrollIntoView({ block: "center" });
        return;
      }
      if (acao.tipo === "abrir-details-na-tab") {
        // `#conversa` (Fase 9) e `#croqui` (Fase 7): os dois blocos vivem
        // dentro de um `<details>` que nasce SEMPRE fechado — abrir ANTES de
        // rolar, senão o link leva a um título e o conteúdo continua
        // escondido. As duas tabs (Sessão/Croqui) são sempre visíveis
        // (Fatia 3), então só falta selecionar e rolar.
        setTabAtiva(acao.tab);
        window.setTimeout(() => {
          const ref = acao.idDoBloco === "conversa" ? null : croquiRef.current;
          const bloco = ref ?? document.getElementById(acao.idDoBloco);
          bloco?.querySelector("details")?.setAttribute("open", "");
          bloco?.scrollIntoView({ block: "center" });
        }, 0);
        return;
      }
      if (acao.tipo === "abrir-gaveta-na-tab") {
        setTabAtiva(acao.tab);
        setGavetaAberta(acao.chave);
        return;
      }
      if (acao.tipo === "abrir-gaveta") abrir(acao.chave);
    }
    aplicar();
    window.addEventListener("hashchange", aplicar);
    return () => window.removeEventListener("hashchange", aplicar);
  }, [abrir]);

  // A MESMA ação do trilho, para a barra do polegar no celular (§C3 M5). Uma
  // derivação só: dois botões dizendo coisas diferentes na mesma tela é o tipo
  // de divergência que esta fase veio matar.
  const acaoAgora = useMemo(() => acaoDeAgora(ficha, { temBarraEnviar: true }), [ficha]);

  return (
    <div className="flex flex-col gap-item">
      <CabecalhoFicha ficha={ficha} aoAtualizar={recarregar} briefing={briefing} aoAbrirGaveta={abrir} />

      {/* ONDE ESTÁ + A AÇÃO DE AGORA. Sticky: some da vista só quem rolou de
          propósito. É o bloco que o contador de aceite mede.

          Abaixo de `md` o botão do trilho fica escondido: como o trilho é
          `sticky top-0`, ele e a `BarraAcaoMobile` ficariam os DOIS na tela ao
          mesmo tempo, com o mesmo verbo — dois botões laranja iguais a 90 px
          um do outro (medido a 390×844). Fica o de baixo, que é o que a mão
          alcança. A ação continua sendo a mesma (`acaoDeAgora`), e no desktop
          nada muda. */}
      <div className="nao-imprimir sticky top-0 z-20 [&_[data-acao-agora]]:hidden md:[&_[data-acao-agora]]:inline-flex">
        <TrilhoDaFicha ficha={ficha} aoAbrirGaveta={abrir} aoCopiarLink={focarEnvio} />
      </div>

      {/* O QUE FALTA E QUANDO VENCE. Uma linha, e só quando há prazo aberto. */}
      <PrazosDaFicha tarefas={ficha.tarefasAbertas} />

      {/* O QUE ENVIAR. Fica fora das tabs — é ação, sobre a pessoa inteira,
          não conteúdo de um momento específico. */}
      <div ref={barraRef} id="enviar">
        <BarraEnviar jornadaId={id} ficha={ficha} />
      </div>

      {/* Fatia 3 — as 4 tabs (`lib/pasta/tabs.ts`). Cada painel só monta o
          conteúdo quando é a tab ativa (`TabsFicha`): `AutomacoesFicha`,
          `RecebidasFicha` e `RadarDocumentos` buscam dado próprio, e uma tab
          fechada não pode gerar requisição — a mesma disciplina que
          `ConduzirSessaoApp.tsx:140` já aplicou aos pollers (achado do
          Fable, 16/09). */}
      <TabsFicha
        tabAtiva={tabAtiva}
        aoTrocarTab={setTabAtiva}
        paineis={TABS_FICHA.map((definicao): PainelTabFicha => ({
          definicao,
          conteudo:
            definicao.chave === "sessao" ? (
              <ConteudoTabSessao id={id} pasta={pasta} sinaisSessao={sinaisSessao} sessaoAtual={sessaoAtual} abrir={abrir} />
            ) : definicao.chave === "documentos" ? (
              podeVerPatrimonio ? (
                <ConteudoTabDocumentos id={id} pasta={pasta} sinaisSessao={sinaisSessao} sessaoAtual={sessaoAtual} recarregar={recarregar} abrir={abrir} />
              ) : (
                <p className="text-sm text-tinta-suave">Sem permissão para ver esta seção.</p>
              )
            ) : definicao.chave === "croqui" ? (
              // Croqui é patrimônio (PII) — mesmo gate que o cartão sempre
              // teve antes das tabs existirem.
              podeVerPatrimonio ? (
                <div ref={croquiRef} id="croqui">
                  <CartaoCroqui estadoCroqui={estadoCroqui} />
                </div>
              ) : (
                <p className="text-sm text-tinta-suave">Sem permissão para ver esta seção.</p>
              )
            ) : (
              // Holding — stub rotulado (CLAUDE.md: "funcionalidade não pronta
              // aparece como stub rotulado, jamais como dado plausível").
              <p className="rounded-cartao border border-linha bg-papel-elevado px-4 py-6 text-sm text-tinta-suave">
                Ainda não há entrega de holding neste sistema.
              </p>
            ),
        }))}
      />

      {/* ---------------------------------------------------------------- */}
      {/* As gavetas. Mesmos componentes das antigas abas, mesmas props,     */}
      {/* mesmos gates de papel — o que mudou é que agora nenhuma delas      */}
      {/* ocupa a dobra da tela até alguém pedir. Ficam fora das tabs de     */}
      {/* propósito: `Gaveta` já devolve `null` fechada (mesmo contrato de   */}
      {/* não-montagem), então abrir uma gaveta a partir de QUALQUER tab —   */}
      {/* inclusive por hash de fora — não depende da árvore da tab.        */}
      {/* ---------------------------------------------------------------- */}
      <Gaveta aberta={gavetaAberta === "formulario"} aoFechar={fechar} rotulo={ficha.pessoa.nome} titulo={TITULO_GAVETA.formulario} largura="larga">
        <FormularioAba jornadaId={id} />
      </Gaveta>

      <Gaveta aberta={gavetaAberta === "ligacao"} aoFechar={fechar} rotulo={ficha.pessoa.nome} titulo={TITULO_GAVETA.ligacao} largura="larga">
        <LigacaoAba jornadaId={id} ligacaoInicial={ficha.ligacao} trilha={ficha.jornada.trilha} aoAtualizar={recarregar} />
      </Gaveta>

      <Gaveta aberta={gavetaAberta === "briefing"} aoFechar={fechar} rotulo={ficha.pessoa.nome} titulo={TITULO_GAVETA.briefing} largura="larga">
        <BriefingAba jornadaId={id} briefing={briefing} setBriefing={setBriefing} carregando={carregandoBriefing} erro={erroBriefing} temAnaliseSessao={temAnaliseSessao} />
      </Gaveta>

      <Gaveta aberta={gavetaAberta === "sessao"} aoFechar={fechar} rotulo={ficha.pessoa.nome} titulo={TITULO_GAVETA.sessao} largura="larga">
        <SessaoAba jornadaId={id} ficha={ficha} aoAtualizar={recarregar} />
      </Gaveta>

      <Gaveta aberta={gavetaAberta === "material"} aoFechar={fechar} rotulo={ficha.pessoa.nome} titulo={TITULO_GAVETA.material} largura="larga">
        <MaterialAba jornadaId={id} />
      </Gaveta>

      <Gaveta aberta={gavetaAberta === "historico"} aoFechar={fechar} rotulo={ficha.pessoa.nome} titulo={TITULO_GAVETA.transcricao} largura="larga">
        <TimelineAba eventos={ficha.timeline} />
      </Gaveta>

      {podeVerPatrimonio && (
        <>
          <Gaveta aberta={gavetaAberta === "patrimonio"} aoFechar={fechar} rotulo={ficha.pessoa.nome} titulo={TITULO_GAVETA.patrimonio} largura="larga">
            <PatrimonioAba jornadaId={id} />
          </Gaveta>
          <Gaveta aberta={gavetaAberta === "documentos"} aoFechar={fechar} rotulo={ficha.pessoa.nome} titulo={TITULO_GAVETA.documentos} largura="larga">
            <DocumentosAba jornadaId={id} pessoaId={ficha.pessoa.id} documentosIniciais={ficha.documentos} aoAtualizar={recarregar} />
          </Gaveta>
          <Gaveta aberta={gavetaAberta === "analise_sessao"} aoFechar={fechar} rotulo={ficha.pessoa.nome} titulo={TITULO_GAVETA.analise_sessao} largura="larga">
            <AnaliseSessaoAba jornadaId={id} ficha={ficha} estadoCroqui={estadoCroqui} />
          </Gaveta>
          <Gaveta aberta={gavetaAberta === "relatorio_sv"} aoFechar={fechar} rotulo={ficha.pessoa.nome} titulo={TITULO_GAVETA.relatorio_sv} largura="larga">
            <RelatorioAba jornadaId={id} ficha={ficha} aoAtualizar={recarregar} />
          </Gaveta>
          {/* Fase 13 — o retrospecto é da SESSÃO (é o fechamento do copiloto
              daquela sessão), então a chave que a rota usa é `ficha.sessao.id`,
              não a jornada. Sem sessão, a gaveta abre com o vazio honesto. */}
          <Gaveta aberta={gavetaAberta === "retrospecto_sv"} aoFechar={fechar} rotulo={ficha.pessoa.nome} titulo={TITULO_GAVETA.retrospecto_sv} largura="larga">
            <RetrospectoAba sessaoId={ficha.sessao?.id ?? null} />
          </Gaveta>
          <Gaveta aberta={gavetaAberta === "diagnostico_sv"} aoFechar={fechar} rotulo={ficha.pessoa.nome} titulo={TITULO_GAVETA.diagnostico_sv} largura="larga">
            <DiagnosticoSv jornadaId={id} hrefApresentar={`/jornadas/${id}/diagnostico?apresentar=1`} aoMudar={recarregar} />
          </Gaveta>
        </>
      )}

      {/* A AÇÃO DE AGORA, na zona do polegar (§C3 M5). No celular o botão do
          trilho fica no topo da página: quem segura o aparelho com uma mão não
          alcança, e no primeiro paint o que se vê é cabeçalho. Aqui a ação vem
          até o polegar e fica lá enquanto a pessoa lê o resto. A `Gaveta`
          aberta cobre a barra, então não há dois botões primários disputando.
          A partir de `md` a barra some — no desktop a ação é a do trilho. */}
      {acaoAgora && !gavetaAberta && (
        <BarraAcaoMobile contexto="O que fazer agora">
          {acaoAgora.tipo === "ir" ? (
            <LinkBotao href={acaoAgora.href} variante="cta" title={acaoAgora.title} className="w-full">
              {acaoAgora.rotulo}
            </LinkBotao>
          ) : (
            <Botao
              variante="primario"
              largo
              title={acaoAgora.title}
              onClick={() => (acaoAgora.tipo === "abrir-gaveta" ? abrir(acaoAgora.chave) : focarEnvio(acaoAgora.tipoDeLink))}
            >
              {acaoAgora.rotulo}
            </Botao>
          )}
        </BarraAcaoMobile>
      )}
    </div>
  );
}

/** Só os itens da Pasta que pertencem a esta tab — `PastaDoCliente` continua sendo a única a decidir estado/agrupamento visual. */
function itensDaTab(pasta: ItemPasta[], tab: ChaveTabFicha): ItemPasta[] {
  return pasta.filter((item) => tabDoItem(item.chave) === tab);
}

/**
 * Tab **Sessão** (padrão) — "foca na sessão hoje". Reúne: o registro
 * discreto do agente de WhatsApp, o botão Histórico e a Pasta filtrada aos
 * artefatos da Sessão de Viabilidade (`lib/pasta/tabs.ts`).
 *
 * Ordem por PESO (a filosofia do João — "o que está pendente e o que fazer
 * agora primeiro, com peso; o resto é linha"): a Pasta (o que falta/o que
 * está pronto) vem primeiro, porque é onde a ação mora; o registro do
 * agente e o histórico vêm depois, como consulta — nunca disputando o
 * primeiro olhar.
 */
function ConteudoTabSessao({
  id,
  pasta,
  sinaisSessao,
  sessaoAtual,
  abrir,
}: {
  id: string;
  pasta: ItemPasta[];
  sinaisSessao: SinaisSessaoPasta;
  sessaoAtual: ChaveSessao | null;
  abrir: (chave: ChaveItemPasta | string) => void;
}) {
  return (
    <>
      <PastaDoCliente itens={itensDaTab(pasta, "sessao")} aoAbrirGaveta={abrir} sinaisSessao={sinaisSessao} sessaoAtual={sessaoAtual} />

      {/* O agente de WhatsApp é REGISTRO, não protagonista (pedido literal do
          João: "se ele respondeu a confirmação de presença, beleza... tem
          que ser objetivo, não pode ser redundante"). Uma linha discreta,
          abaixo do que importa. `items-start`: os dois blocos da esquerda
          são `<details>` que crescem ao abrir, e com `items-center` o botão
          Histórico descia junto até o meio da conversa aberta. */}
      <div className="flex flex-wrap items-start gap-item">
        <div className="flex min-w-0 flex-1 flex-col gap-item">
          <AutomacoesFicha jornadaId={id} />
          <div id="conversa">
            <RecebidasFicha jornadaId={id} />
          </div>
        </div>
        <button
          type="button"
          onClick={() => abrir("historico")}
          className="nao-imprimir inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-controle border border-linha-forte bg-papel-elevado px-3 text-sm font-medium text-tinta transition-colors duration-[var(--transicao-rapida)] hover:border-[color:var(--latao)]"
        >
          Histórico
        </button>
      </div>
    </>
  );
}

/**
 * Tab **Documentos** — patrimônio e documentos recebidos, mais o radar do
 * que falta pedir. Só é montada com `podeVerPatrimonio` (a página já faz
 * esse gate antes de renderizar este componente).
 */
function ConteudoTabDocumentos({
  id,
  pasta,
  sinaisSessao,
  sessaoAtual,
  recarregar,
  abrir,
}: {
  id: string;
  pasta: ItemPasta[];
  sinaisSessao: SinaisSessaoPasta;
  sessaoAtual: ChaveSessao | null;
  recarregar: () => void;
  abrir: (chave: ChaveItemPasta | string) => void;
}) {
  return (
    <>
      <PastaDoCliente itens={itensDaTab(pasta, "documentos")} aoAbrirGaveta={abrir} sinaisSessao={sinaisSessao} sessaoAtual={sessaoAtual} />
      <RadarDocumentos jornadaId={id} aoAtualizar={recarregar} aoAbrirGaveta={abrir} />
    </>
  );
}
