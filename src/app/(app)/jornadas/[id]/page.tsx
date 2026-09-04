"use client";

import { use } from "react";
import { useFicha360 } from "@/hooks/useFicha360";
import { useBriefingAtual } from "@/hooks/useBriefingAtual";
import { EstadoCarregando, EstadoErro } from "@/components/ui/Estado";
import { CabecalhoFicha } from "@/components/ficha360/CabecalhoFicha";
import { Abas, type DefinicaoAba } from "@/components/ui/Abas";
import { ChecklistPendencias } from "@/components/ui/ChecklistPendencias";
import { calcularPendencias } from "@/components/ui/pendencias";
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
  // Calculado uma vez e compartilhado entre a faixa vital (CabecalhoFicha,
  // chip "Próxima ação") e o ChecklistPendencias — mesma lista, um cálculo só.
  const pendencias = calcularPendencias(ficha, podeVerPatrimonio);
  // Link cruzado Briefing ↔ Análise da Sessão (Tarefa 2): a existência da
  // análise vem do evento `analise_sessao` que o trigger `0043` grava na
  // timeline — já carregada em `ficha.timeline`, sem requisição nova.
  // Condicionado a `podeVerPatrimonio` (achado MÉDIO do pentest, 04/09): sem
  // isso, um papel sem acesso a patrimônio via a timeline (que ele recebe
  // sem gate) vazava a EXISTÊNCIA de uma Análise da Sessão que ele não pode
  // ver o conteúdo — metadado institucional que só admin/advogada deveriam
  // saber que existe.
  const temAnaliseSessao = podeVerPatrimonio && ficha.timeline.some((e) => e.tipo === "analise_sessao");

  // U3 — 13 abas viram 4 grupos (Preparação · Sessão · Patrimônio · Registro).
  // Nenhuma aba é removida, nenhuma regra de acesso muda: o mesmo
  // `podeVerPatrimonio` que já gateava Patrimônio/Documentos/Relatório/Croqui
  // continua gateando exatamente as mesmas quatro abas — só a ordem de
  // construção mudou, para que o agrupamento em `Abas` saia na sequência que
  // a Dra. Elaine espera em vez da ordem de disponibilidade técnica do dado.
  const abas: DefinicaoAba[] = [
    { id: "formulario", rotulo: "Formulário", grupo: "Preparação", conteudo: <FormularioAba jornadaId={id} /> },
    { id: "ligacao", rotulo: "Ligação", grupo: "Preparação", conteudo: <LigacaoAba jornadaId={id} ligacaoInicial={ficha.ligacao} trilha={ficha.jornada.trilha} aoAtualizar={recarregar} /> },
    { id: "links", rotulo: "Links", grupo: "Preparação", conteudo: <LinksAba jornadaId={id} /> },
    {
      id: "briefing",
      rotulo: "Briefing",
      grupo: "Preparação",
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
    { id: "sessao", rotulo: "Sessão", grupo: "Sessão", conteudo: <SessaoAba jornadaId={id} sessao={ficha.sessao} agendamentos={ficha.agendamentos} aoAtualizar={recarregar} /> },
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
      grupo: "Sessão",
      conteudo: <AnaliseSessaoAba jornadaId={id} ficha={ficha} timeline={ficha.timeline} />,
    });
  }

  // Relatório da SV carrega patrimônio (`exigirVePatrimonio` na rota) — mesmo
  // recorte de Patrimônio/Documentos/Croqui: a aba nem aparece pra quem o
  // servidor negaria.
  if (podeVerPatrimonio) {
    abas.push({ id: "relatorio", rotulo: "Relatório", grupo: "Sessão", conteudo: <RelatorioAba jornadaId={id} ficha={ficha} aoAtualizar={recarregar} /> });
  }

  abas.push({ id: "material", rotulo: "Material", grupo: "Sessão", conteudo: <MaterialAba jornadaId={id} /> });
  abas.push({ id: "pesquisa", rotulo: "Pesquisa pública", grupo: "Sessão", conteudo: <PesquisaPublicaAba /> });

  if (podeVerPatrimonio) {
    abas.push({ id: "patrimonio", rotulo: "Patrimônio", grupo: "Patrimônio", conteudo: <PatrimonioAba jornadaId={id} /> });
    abas.push({
      id: "documentos",
      rotulo: "Documentos",
      grupo: "Patrimônio",
      conteudo: <DocumentosAba jornadaId={id} pessoaId={ficha.pessoa.id} documentosIniciais={ficha.documentos} aoAtualizar={recarregar} />,
    });
    abas.push({ id: "croqui", rotulo: "Croqui", grupo: "Patrimônio", conteudo: <CroquiAba jornadaId={id} ficha={ficha} timeline={ficha.timeline} /> });
  }

  abas.push({ id: "timeline", rotulo: "Linha do tempo", grupo: "Registro", conteudo: <TimelineAba eventos={ficha.timeline} /> });

  return (
    <div className="flex flex-col gap-6">
      <CabecalhoFicha ficha={ficha} aoAtualizar={recarregar} pendencias={pendencias} briefing={briefing} />
      <ChecklistPendencias itens={pendencias} />
      <Abas abas={abas} deepLinkHash />
    </div>
  );
}
