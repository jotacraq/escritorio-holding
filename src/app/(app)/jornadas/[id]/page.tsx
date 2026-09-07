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
import { derivarPasta } from "@/lib/pasta/derivar";
import { sinaisDaFicha } from "@/lib/pasta/sinais";
import { agruparPorSessao, derivarTrilho } from "@/lib/pasta/trilho";
import { ITENS_EM_GAVETA } from "@/lib/pasta/rotas";
import type { ChaveItemPasta } from "@/lib/pasta/catalogo";
import { extrasDaFicha, proximoAgendamentoAtivo } from "@/components/ficha360/api-extras";
import { TrilhoDaFicha, acaoDeAgora } from "@/components/ficha360/TrilhoDaFicha";
import { PrazosDaFicha } from "@/components/ficha360/PrazosDaFicha";
import { AutomacoesFicha } from "@/components/ficha360/AutomacoesFicha";
import { RadarDocumentos } from "@/components/ficha360/RadarDocumentos";
import { BarraEnviar } from "@/components/ficha360/BarraEnviar";
import { CartaoCroqui } from "@/components/ficha360/CartaoCroqui";
import type { SinaisSessaoPasta } from "@/components/pasta/PastaDoCliente";
import type { Ficha360 } from "@/lib/api";

/**
 * A Ficha do cliente — Fase 6.
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
 *   5. O QUE ACONTECEU / O QUE FALTA — a Pasta, agrupada pelas 3 sessões.
 *
 * **A barra de abas acabou.** Não há mais "Ver tudo" nem uma fileira de nove
 * nomes: cada artefato é um cartão da Pasta que abre a MESMA tela de antes,
 * agora numa gaveta. O deep-link por hash continua funcionando — inclusive os
 * de fora (`hrefDoPasso`, chips do Painel, `#briefing` do cabeçalho) —, só que
 * agora todo hash conhecido abre gaveta, em vez de uns abrirem gaveta e outros
 * trocarem uma aba.
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
  "diagnostico_sv",
  "material",
  "historico",
  // Aliases dos hashes antigos, para link salvo/colado não morrer.
  "links",
  "analise-sessao",
  "relatorio",
  "diagnostico",
  "timeline",
]);

/** Hash antigo -> chave nova. Um link colado no WhatsApp da equipe continua abrindo. */
const ALIAS_HASH: Record<string, string> = {
  "analise-sessao": "analise_sessao",
  relatorio: "relatorio_sv",
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

  // Qual das 3 sessoes esta acesa — a mesma derivacao do trilho, para a Pasta
  // abrir o grupo certo. `sinaisDaFicha` e puro e ja e chamado pelo trilho;
  // repetir a chamada e barato e mantem UMA fonte de verdade (nao ha estado
  // compartilhado que possa dessincronizar).
  const sessaoAtual = agruparPorSessao(derivarTrilho(sinaisDaFicha(ficha))).find((b) => b.estado === "atual")?.chave ?? null;

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
  const abrir = useCallback((chave: ChaveItemPasta | string) => setGavetaAberta(String(chave)), []);
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

  // Deep-link por hash. Todo hash conhecido abre gaveta; hash de aba antiga
  // passa pelo alias. `#enviar` rola até a barra em vez de abrir gaveta.
  useEffect(() => {
    function aplicar() {
      const bruto = window.location.hash.slice(1);
      if (!bruto) return;
      const chave = ALIAS_HASH[bruto] ?? bruto;
      if (chave === "enviar") {
        barraRef.current?.scrollIntoView({ block: "center" });
        return;
      }
      // O croqui não é gaveta: é cartão + botão para `/croquis/[id]`. Um
      // `#croqui` vindo da Pasta ou de um link antigo leva ao cartão.
      if (chave === "croqui") {
        // O cartao do croqui vive dentro de um `<details>` que nasce SEMPRE
        // fechado (Fase 7). Abrir antes de rolar, senao o link leva a um
        // titulo e o cartao continua escondido.
        croquiRef.current?.querySelector("details")?.setAttribute("open", "");
        croquiRef.current?.scrollIntoView({ block: "center" });
        return;
      }
      if (CHAVES_EM_GAVETA.has(chave)) setGavetaAberta(chave);
    }
    aplicar();
    window.addEventListener("hashchange", aplicar);
    return () => window.removeEventListener("hashchange", aplicar);
  }, []);

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

      {/* O QUE ENVIAR. */}
      <div ref={barraRef} id="enviar">
        <BarraEnviar jornadaId={id} ficha={ficha} />
      </div>

      {/* O QUE JÁ ACONTECEU / O QUE FALTA. O histórico anda junto: são as duas
          formas de olhar para trás, e cada uma numa linha própria custava
          55 px de dobra por nada. */}
      <div className="flex flex-wrap items-center gap-item">
        <div className="min-w-0 flex-1">
          <AutomacoesFicha jornadaId={id} />
        </div>
        <button
          type="button"
          onClick={() => abrir("historico")}
          className="nao-imprimir inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-controle border border-linha-forte bg-papel-elevado px-3 text-sm font-medium text-tinta transition-colors duration-[var(--transicao-rapida)] hover:border-[color:var(--latao)]"
        >
          Histórico
        </button>
      </div>
      <PastaDoCliente itens={pasta} aoAbrirGaveta={abrir} sinaisSessao={sinaisSessao} sessaoAtual={sessaoAtual} />

      {/* A sessão 2 (Croqui estrutural) é onde IR e contrato social vivem — o
          radar de documentos e o croqui pertencem a ela, não a blocos soltos
          no meio da ficha. O radar lê patrimônio e família: fora do recorte,
          nem é montado (a rota recusaria).

          Fase 7: os dois nascem RECOLHIDOS, um `<details>` cada, com o que há
          dentro no cabeçalho ("15 de 18 prontos · 3 a pedir", "Croqui
          Estrutural"). Na Fase 6 eles abriam sozinhos a partir da segunda
          sessão e a Ficha avançada media 1.503 px — o dobro da dobra útil de
          quem trabalha a 1440×900. Nada some: espera ser pedido.

          Fase 8 — `[&>*]:min-w-0` na grade: item de grade nasce com
          `min-width: auto`, então a trilha cresce até o min-content do filho, e
          o par Documentos/Croqui esticava a Ficha para 489 px de largura num
          viewport de 360 px (medido, com as gavetas abertas). Com o piso em
          zero, o conteúdo quebra dentro da coluna em vez de esticá-la. */}
      {podeVerPatrimonio && (
        <div className="grid items-start gap-x-cartao gap-y-item [&>*]:min-w-0 sm:grid-cols-2">
          <RadarDocumentos jornadaId={id} aoAtualizar={recarregar} recolhivel />
          <div ref={croquiRef} id="croqui">
            <CartaoCroqui estadoCroqui={estadoCroqui} recolhivel />
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* As gavetas. Mesmos componentes das antigas abas, mesmas props,     */}
      {/* mesmos gates de papel — o que mudou é que agora nenhuma delas      */}
      {/* ocupa a dobra da tela até alguém pedir.                            */}
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
