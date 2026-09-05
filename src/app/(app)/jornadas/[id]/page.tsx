"use client";

import { use, useEffect, useState } from "react";
import { useFicha360 } from "@/hooks/useFicha360";
import { useBriefingAtual } from "@/hooks/useBriefingAtual";
import { useCroquiDaJornada } from "@/hooks/useCroquiDaJornada";
import { contarRevisaoSlides } from "@/lib/croqui";
import { EstadoErro } from "@/components/ui/Estado";
import { EsqueletoFicha } from "@/components/ui/Esqueleto";
import { CabecalhoFicha } from "@/components/ficha360/CabecalhoFicha";
import { Abas, type DefinicaoAba } from "@/components/ui/Abas";
import { PastaDoCliente } from "@/components/pasta/PastaDoCliente";
import { Gaveta } from "@/components/ui/Gaveta";
import { derivarPasta } from "@/lib/pasta/derivar";
import { ITENS_EM_GAVETA } from "@/lib/pasta/rotas";
import type { ChaveItemPasta } from "@/lib/pasta/catalogo";
import { FormularioAba } from "@/components/ficha360/FormularioAba";
import { LigacaoAba } from "@/components/ficha360/LigacaoAba";
import { LinksAba } from "@/components/ficha360/LinksAba";
import { PatrimonioAba } from "@/components/ficha360/PatrimonioAba";
import { DocumentosAba } from "@/components/ficha360/DocumentosAba";
import { SessaoAba } from "@/components/ficha360/SessaoAba";
import { RelatorioAba } from "@/components/ficha360/RelatorioAba";
import { BriefingAba } from "@/components/briefing/BriefingAba";
import { MaterialAba } from "@/components/ficha360/MaterialAba";
import { PesquisaPublicaAba } from "@/components/ficha360/PesquisaPublicaAba";
import { CroquiAba } from "@/components/ficha360/CroquiAba";
import { AnaliseSessaoAba } from "@/components/ficha360/AnaliseSessaoAba";
import { TimelineAba } from "@/components/ficha360/TimelineAba";
import { DiagnosticoSv } from "@/components/ficha360/DiagnosticoSv";
import { extrasDaFicha, proximoAgendamentoAtivo } from "@/components/ficha360/api-extras";
import type { SinaisSessaoPasta } from "@/components/pasta/PastaDoCliente";
import type { Ficha360 } from "@/lib/api";

/** Rótulo de cada Gaveta migrada (Camada 2) — mesmo nome de negócio da aba original. */
const TITULO_GAVETA: Partial<Record<ChaveItemPasta, string>> = {
  formulario: "Formulário",
  ligacao: "Ligação",
  links: "Links",
  documentos: "Documentos",
  patrimonio: "Patrimônio",
};

export default function PaginaFicha360({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { ficha, carregando, erro, recarregar } = useFicha360(id);

  // Fase 4 (agente H): recarregar depois de uma ação NÃO derruba a tela —
  // a ficha antiga fica de pé enquanto a nova chega (senão toda ação em
  // gaveta/aba fechava a gaveta e piscava a página inteira). Só a primeira
  // carga mostra o esqueleto; erro só toma a tela quando não há ficha.
  if (carregando && !ficha) return <EsqueletoFicha rotulo="Carregando ficha…" />;
  if (erro && !ficha) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível carregar esta jornada" />;
  if (!ficha) return null;

  return <ConteudoFicha id={id} ficha={ficha} recarregar={recarregar} />;
}

function ConteudoFicha({ id, ficha, recarregar }: { id: string; ficha: Ficha360; recarregar: () => void }) {
  // Busca única do Briefing atual (Tarefa 5) — antes, `CabecalhoFicha` e
  // `BriefingAba` buscavam o mesmo `briefingAtual.id` cada um por conta
  // própria. Elevado para cá, distribuído por prop.
  const { briefing, setBriefing, carregando: carregandoBriefing, erro: erroBriefing } = useBriefingAtual(ficha.briefingAtual?.id ?? null);

  // O backend não manda uma flag "pode ver patrimônio" — manda `null` no lugar
  // do array quando o papel não permite. É esse null que decide a UI aqui.
  const podeVerPatrimonio = ficha.patrimonio !== null;

  // Estado do Croqui elevado para cá (mesma cirurgia de `useBriefingAtual`) —
  // antes `CroquiAba` e `AnaliseSessaoAba` chamavam `useCroquiDaJornada` cada
  // uma por conta própria. O hook é SEMPRE chamado (regra dos hooks do
  // React); `croquiId` já nasce `null` quando não há croqui na timeline, e a
  // prop `croquiAtalho` do cabeçalho é que fica `null` quando o papel não vê
  // patrimônio — não a chamada do hook.
  const estadoCroqui = useCroquiDaJornada({ jornadaId: id, ficha, timeline: ficha.timeline });
  const croquiAtalho = podeVerPatrimonio && estadoCroqui.croquiAtual
    ? { croquiId: estadoCroqui.croquiAtual.id, pendentes: contarRevisaoSlides(estadoCroqui.croquiAtual.conteudo.slides).pendentes }
    : null;
  // Fase 2 de "A Pasta do Cliente" — mesma lista que alimenta o chip
  // "Próxima ação" da faixa vital (CabecalhoFicha), calculada uma vez e
  // compartilhada, não duplicada por componente.
  const pasta = derivarPasta(ficha, podeVerPatrimonio);
  // Link cruzado Briefing ↔ Análise da Sessão (Tarefa 2): a existência da
  // análise vem do evento `analise_sessao` que o trigger `0043` grava na
  // timeline — já carregada em `ficha.timeline`, sem requisição nova.
  // Condicionado a `podeVerPatrimonio` (achado MÉDIO do pentest, 04/09): sem
  // isso, um papel sem acesso a patrimônio via a timeline (que ele recebe
  // sem gate) vazava a EXISTÊNCIA de uma Análise da Sessão que ele não pode
  // ver o conteúdo — metadado institucional que só admin/advogada deveriam
  // saber que existe.
  const temAnaliseSessao = podeVerPatrimonio && ficha.timeline.some((e) => e.tipo === "analise_sessao");

  // Fase 3 — Formulário, Ligação, Links, Documentos e Patrimônio migraram
  // para a Gaveta (Camada 2, ver `ITENS_EM_GAVETA` em `lib/pasta/rotas.ts`) e
  // SAEM do array `abas` — quem os renderiza agora é o bloco de `<Gaveta>`
  // abaixo, com os MESMOS componentes e props (nenhuma lógica duplicada).
  // `Abas` continua existindo para os itens não migrados desta rodada
  // (Relatório, Briefing, Análise da Sessão, Material) e os que não fazem
  // parte da Pasta (Sessão, Pesquisa pública, Croqui, Linha do tempo) — lista
  // PLANA (sem `grupo`), como já era desde a Fase 2. Nenhuma regra de acesso
  // muda: o mesmo `podeVerPatrimonio` que já gateava
  // Patrimônio/Documentos/Relatório/Croqui continua gateando os mesmos itens
  // (agora Patrimônio/Documentos como Gaveta, Relatório/Croqui como aba).
  const abas: DefinicaoAba[] = [
    {
      id: "briefing",
      rotulo: "Briefing",
      conteudo: (
        <BriefingAba
          jornadaId={id}
          briefing={briefing}
          setBriefing={setBriefing}
          carregando={carregandoBriefing}
          erro={erroBriefing}
          temAnaliseSessao={temAnaliseSessao}
        />
      ),
    },
    { id: "sessao", rotulo: "Sessão", conteudo: <SessaoAba jornadaId={id} ficha={ficha} aoAtualizar={recarregar} /> },
  ];

  // Fase 4 (agente H) — sinais da Sessão para o cartão "Sessão" da Pasta:
  // presença (0051), sala e ligação por IA, lidos do MESMO payload da Ficha
  // (`extrasDaFicha` tolera coluna/tabela ausente → "sem informação").
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

  // "Análise da Sessão" (U3/U4, ARQUITETURA-FASE-3.md §5.3) — antes era
  // sub-aba de CroquiAba, a 4 cliques e 3 níveis de aninhamento do Briefing.
  // Mesmo gate `podeVerPatrimonio` que já protegia a sub-aba equivalente
  // dentro de Croqui (ela lê patrimônio/familiares para os gráficos da
  // arquitetura recomendada) — não afrouxa o recorte, só muda de nível.
  if (podeVerPatrimonio) {
    abas.push({
      id: "analise-sessao",
      rotulo: "Análise da Sessão",
      conteudo: <AnaliseSessaoAba jornadaId={id} ficha={ficha} estadoCroqui={estadoCroqui} />,
    });
  }

  // Relatório da SV carrega patrimônio (`exigirVePatrimonio` na rota) — mesmo
  // recorte de Patrimônio/Documentos/Croqui: a aba nem aparece pra quem o
  // servidor negaria.
  if (podeVerPatrimonio) {
    abas.push({ id: "relatorio", rotulo: "Relatório", conteudo: <RelatorioAba jornadaId={id} ficha={ficha} aoAtualizar={recarregar} /> });
  }

  // Diagnóstico da SV (Fase 4 §4.7, 0058) — mesmo gate de patrimônio do
  // Relatório/Cenário: a rota exige `ve_patrimonio`. Página própria em
  // `/jornadas/[id]/diagnostico` para o modo apresentação.
  if (podeVerPatrimonio) {
    abas.push({
      id: "diagnostico",
      rotulo: "Diagnóstico",
      conteudo: <DiagnosticoSv jornadaId={id} hrefApresentar={`/jornadas/${id}/diagnostico?apresentar=1`} aoMudar={recarregar} />,
    });
  }

  abas.push({ id: "material", rotulo: "Material", conteudo: <MaterialAba jornadaId={id} /> });
  abas.push({ id: "pesquisa", rotulo: "Pesquisa pública", conteudo: <PesquisaPublicaAba /> });

  if (podeVerPatrimonio) {
    abas.push({ id: "croqui", rotulo: "Croqui", conteudo: <CroquiAba jornadaId={id} estadoCroqui={estadoCroqui} /> });
  }

  abas.push({ id: "timeline", rotulo: "Linha do tempo", conteudo: <TimelineAba eventos={ficha.timeline} /> });

  // Estado único da Camada 2 (Gaveta) para as 5 chaves migradas — `null` é
  // "nenhuma gaveta aberta". Elevado para este componente (não para dentro
  // de `PastaDoCliente`) porque tanto o cartão da Pasta quanto o chip
  // "Próxima ação" de `CabecalhoFicha` precisam poder abrir a mesma gaveta.
  const [gavetaAberta, setGavetaAberta] = useState<ChaveItemPasta | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <CabecalhoFicha
        ficha={ficha}
        aoAtualizar={recarregar}
        briefing={briefing}
        croquiAtalho={croquiAtalho}
        aoAbrirGaveta={(chave) => setGavetaAberta(chave)}
      />
      <ConteudoPastaOuAbas pasta={pasta} abas={abas} aoMudarGaveta={setGavetaAberta} sinaisSessao={sinaisSessao} />

      <Gaveta aberta={gavetaAberta === "formulario"} aoFechar={() => setGavetaAberta(null)} titulo={TITULO_GAVETA.formulario!}>
        <FormularioAba jornadaId={id} />
      </Gaveta>
      <Gaveta aberta={gavetaAberta === "ligacao"} aoFechar={() => setGavetaAberta(null)} titulo={TITULO_GAVETA.ligacao!}>
        <LigacaoAba jornadaId={id} ligacaoInicial={ficha.ligacao} trilha={ficha.jornada.trilha} aoAtualizar={recarregar} />
      </Gaveta>
      <Gaveta aberta={gavetaAberta === "links"} aoFechar={() => setGavetaAberta(null)} titulo={TITULO_GAVETA.links!}>
        <LinksAba jornadaId={id} />
      </Gaveta>
      {podeVerPatrimonio && (
        <>
          <Gaveta aberta={gavetaAberta === "patrimonio"} aoFechar={() => setGavetaAberta(null)} titulo={TITULO_GAVETA.patrimonio!}>
            <PatrimonioAba jornadaId={id} />
          </Gaveta>
          <Gaveta aberta={gavetaAberta === "documentos"} aoFechar={() => setGavetaAberta(null)} titulo={TITULO_GAVETA.documentos!}>
            <DocumentosAba jornadaId={id} pessoaId={ficha.pessoa.id} documentosIniciais={ficha.documentos} aoAtualizar={recarregar} />
          </Gaveta>
        </>
      )}
    </div>
  );
}

/**
 * Decide o que aparece abaixo do cabeçalho: sem hash na URL, a Pasta do
 * Cliente (tela raiz nova, Fase 2); com hash (`#briefing`, `#croqui`, ...),
 * o conteúdo da aba correspondente, como já funcionava. `Abas` continua sem
 * mudança de comportamento — só passa a ficar oculta quando não há hash.
 * Leitura de `window.location.hash` fica neste componente, não em `Abas`
 * (que não deveria saber da existência da Pasta) — mesmo padrão de "ler
 * sistema externo uma vez após montar" de `useTema.ts`.
 *
 * Fase 3 — deep-link dos 5 itens migrados para Gaveta: escolhida a opção (a)
 * do plano (`brain/Diário/2026-09-04.md`) — este componente também decide
 * abrir a Gaveta quando o hash bate com um item de `ITENS_EM_GAVETA`, em vez
 * de tratá-lo como "aba válida". Resultado: acessar `#documentos` direto
 * continua funcionando — abre a Gaveta de Documentos por cima da Pasta —
 * sem precisar de link morto nem de duplicar a Gaveta como aba de `Abas`.
 */
function ConteudoPastaOuAbas({
  pasta,
  abas,
  aoMudarGaveta,
  sinaisSessao,
}: {
  pasta: ReturnType<typeof derivarPasta>;
  abas: DefinicaoAba[];
  aoMudarGaveta: (chave: ChaveItemPasta | null) => void;
  sinaisSessao: SinaisSessaoPasta;
}) {
  const [hash, setHash] = useState<string | null>(null);

  useEffect(() => {
    function aplicarHash(valor: string | null) {
      setHash(valor);
      const chave = valor?.slice(1) as ChaveItemPasta | undefined;
      if (chave && ITENS_EM_GAVETA.has(chave)) aoMudarGaveta(chave);
    }
    aplicarHash(window.location.hash || null);
    function aoMudarHash() {
      aplicarHash(window.location.hash || null);
    }
    window.addEventListener("hashchange", aoMudarHash);
    return () => window.removeEventListener("hashchange", aoMudarHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Item migrado (`#formulario`, `#documentos`, ...) não conta como "aba
  // válida" — a Gaveta é quem mostra o conteúdo, a Pasta continua por trás.
  const chaveDoHash = hash?.slice(1) as ChaveItemPasta | undefined;
  const hashEhItemEmGaveta = !!chaveDoHash && ITENS_EM_GAVETA.has(chaveDoHash);

  // Antes de montar (SSR/primeira passada), `hash` é `null` — mesmo estado
  // de "sem hash", então mostramos a Pasta sem flash: ela é o conteúdo
  // padrão real, não um placeholder de carregamento.
  const temHashValido = !hashEhItemEmGaveta && hash !== null && abas.some((a) => `#${a.id}` === hash);

  function voltarParaPasta() {
    // Mesmo motivo do `onClick` em `PastaDoCliente`: só reescrever o hash
    // não é garantia de que o listener de `hashchange` seja avisado a
    // tempo — disparamos o evento manualmente para o retorno ser síncrono.
    history.pushState(null, "", window.location.pathname + window.location.search);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }

  return (
    <>
      <div hidden={temHashValido}>
        <PastaDoCliente itens={pasta} aoAbrirGaveta={aoMudarGaveta} sinaisSessao={sinaisSessao} />
      </div>
      <div hidden={!temHashValido}>
        <button
          type="button"
          onClick={voltarParaPasta}
          className="nao-imprimir mb-2 inline-flex min-h-11 items-center gap-1.5 rounded-controle text-sm font-medium text-tinta-suave hover:text-tinta"
        >
          ← Voltar à Pasta do Cliente
        </button>
        <Abas abas={abas} deepLinkHash />
      </div>
    </>
  );
}
