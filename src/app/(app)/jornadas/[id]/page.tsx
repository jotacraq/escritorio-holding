"use client";

import { use, useEffect, useState } from "react";
import { useFicha360 } from "@/hooks/useFicha360";
import { useBriefingAtual } from "@/hooks/useBriefingAtual";
import { useCroquiDaJornada } from "@/hooks/useCroquiDaJornada";
import { contarRevisaoSlides } from "@/lib/croqui";
import { EstadoCarregando, EstadoErro } from "@/components/ui/Estado";
import { CabecalhoFicha } from "@/components/ficha360/CabecalhoFicha";
import { Abas, type DefinicaoAba } from "@/components/ui/Abas";
import { PastaDoCliente } from "@/components/pasta/PastaDoCliente";
import { derivarPasta } from "@/lib/pasta/derivar";
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
import type { Ficha360 } from "@/lib/api";

export default function PaginaFicha360({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { ficha, carregando, erro, recarregar } = useFicha360(id);

  if (carregando) return <EstadoCarregando rotulo="Carregando ficha…" />;
  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível carregar esta jornada" />;
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

  // Fase 2 — a Pasta do Cliente substitui os grupos (Preparação · Sessão ·
  // Patrimônio · Registro) como forma de organizar a tela. `Abas` continua
  // recebendo lista PLANA (sem `grupo`) — a segmentação em grupo escondia 9
  // dos 14 artefatos fora do grupo ativo; a Pasta mostra todos de uma vez e
  // as abas viram só o destino do clique/hash. Nenhuma regra de acesso
  // muda: o mesmo `podeVerPatrimonio` que já gateava
  // Patrimônio/Documentos/Relatório/Croqui continua gateando exatamente as
  // mesmas quatro abas.
  const abas: DefinicaoAba[] = [
    { id: "formulario", rotulo: "Formulário", conteudo: <FormularioAba jornadaId={id} /> },
    { id: "ligacao", rotulo: "Ligação", conteudo: <LigacaoAba jornadaId={id} ligacaoInicial={ficha.ligacao} trilha={ficha.jornada.trilha} aoAtualizar={recarregar} /> },
    { id: "links", rotulo: "Links", conteudo: <LinksAba jornadaId={id} /> },
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
    { id: "sessao", rotulo: "Sessão", conteudo: <SessaoAba jornadaId={id} sessao={ficha.sessao} agendamentos={ficha.agendamentos} aoAtualizar={recarregar} /> },
  ];

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

  abas.push({ id: "material", rotulo: "Material", conteudo: <MaterialAba jornadaId={id} /> });
  abas.push({ id: "pesquisa", rotulo: "Pesquisa pública", conteudo: <PesquisaPublicaAba /> });

  if (podeVerPatrimonio) {
    abas.push({ id: "patrimonio", rotulo: "Patrimônio", conteudo: <PatrimonioAba jornadaId={id} /> });
    abas.push({
      id: "documentos",
      rotulo: "Documentos",
      conteudo: <DocumentosAba jornadaId={id} pessoaId={ficha.pessoa.id} documentosIniciais={ficha.documentos} aoAtualizar={recarregar} />,
    });
    abas.push({ id: "croqui", rotulo: "Croqui", conteudo: <CroquiAba jornadaId={id} estadoCroqui={estadoCroqui} /> });
  }

  abas.push({ id: "timeline", rotulo: "Linha do tempo", conteudo: <TimelineAba eventos={ficha.timeline} /> });

  return (
    <div className="flex flex-col gap-6">
      <CabecalhoFicha ficha={ficha} aoAtualizar={recarregar} briefing={briefing} croquiAtalho={croquiAtalho} />
      <ConteudoPastaOuAbas pasta={pasta} abas={abas} />
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
 */
function ConteudoPastaOuAbas({ pasta, abas }: { pasta: ReturnType<typeof derivarPasta>; abas: DefinicaoAba[] }) {
  const [hash, setHash] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHash(window.location.hash || null);
    function aoMudarHash() {
      setHash(window.location.hash || null);
    }
    window.addEventListener("hashchange", aoMudarHash);
    return () => window.removeEventListener("hashchange", aoMudarHash);
  }, []);

  // Antes de montar (SSR/primeira passada), `hash` é `null` — mesmo estado
  // de "sem hash", então mostramos a Pasta sem flash: ela é o conteúdo
  // padrão real, não um placeholder de carregamento.
  const temHashValido = hash !== null && abas.some((a) => `#${a.id}` === hash);

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
        <PastaDoCliente itens={pasta} />
      </div>
      <div hidden={!temHashValido}>
        <button
          type="button"
          onClick={voltarParaPasta}
          className="nao-imprimir mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-tinta-suave hover:text-tinta"
        >
          ← Voltar à Pasta do Cliente
        </button>
        <Abas abas={abas} deepLinkHash />
      </div>
    </>
  );
}
