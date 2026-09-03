"use client";

import { use } from "react";
import { useFicha360 } from "@/hooks/useFicha360";
import { EstadoCarregando, EstadoErro } from "@/components/ui/Estado";
import { CabecalhoFicha } from "@/components/ficha360/CabecalhoFicha";
import { Abas, type DefinicaoAba } from "@/components/ui/Abas";
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
import { TimelineAba } from "@/components/ficha360/TimelineAba";

export default function PaginaFicha360({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { ficha, carregando, erro, recarregar } = useFicha360(id);

  if (carregando) return <EstadoCarregando rotulo="Carregando ficha…" />;
  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível carregar esta jornada" />;
  if (!ficha) return null;

  // O backend não manda uma flag "pode ver patrimônio" — manda `null` no lugar
  // do array quando o papel não permite. É esse null que decide a UI aqui.
  const podeVerPatrimonio = ficha.patrimonio !== null;

  const abas: DefinicaoAba[] = [
    { id: "formulario", rotulo: "Formulário", conteudo: <FormularioAba jornadaId={id} /> },
    { id: "ligacao", rotulo: "Ligação", conteudo: <LigacaoAba jornadaId={id} ligacaoInicial={ficha.ligacao} trilha={ficha.jornada.trilha} aoAtualizar={recarregar} /> },
    { id: "links", rotulo: "Links", conteudo: <LinksAba jornadaId={id} /> },
  ];

  if (podeVerPatrimonio) {
    abas.push({ id: "patrimonio", rotulo: "Patrimônio", conteudo: <PatrimonioAba jornadaId={id} /> });
    abas.push({
      id: "documentos",
      rotulo: "Documentos",
      conteudo: <DocumentosAba jornadaId={id} pessoaId={ficha.pessoa.id} documentosIniciais={ficha.documentos} aoAtualizar={recarregar} />,
    });
  }

  abas.push({ id: "sessao", rotulo: "Sessão", conteudo: <SessaoAba jornadaId={id} sessao={ficha.sessao} agendamentos={ficha.agendamentos} aoAtualizar={recarregar} /> });

  // Relatório da SV carrega patrimônio (`exigirVePatrimonio` na rota) — mesmo
  // recorte de Patrimônio/Documentos/Croqui: a aba nem aparece pra quem o
  // servidor negaria.
  if (podeVerPatrimonio) {
    abas.push({ id: "relatorio", rotulo: "Relatório", conteudo: <RelatorioAba jornadaId={id} ficha={ficha} aoAtualizar={recarregar} /> });
  }

  abas.push({ id: "briefing", rotulo: "Briefing", conteudo: <BriefingAba jornadaId={id} briefingAtualId={ficha.briefingAtual?.id ?? null} /> });
  abas.push({ id: "material", rotulo: "Material", conteudo: <MaterialAba jornadaId={id} /> });
  abas.push({ id: "pesquisa", rotulo: "Pesquisa pública", conteudo: <PesquisaPublicaAba /> });

  if (podeVerPatrimonio) {
    abas.push({ id: "croqui", rotulo: "Croqui", conteudo: <CroquiAba jornadaId={id} timeline={ficha.timeline} /> });
  }

  abas.push({ id: "timeline", rotulo: "Linha do tempo", conteudo: <TimelineAba eventos={ficha.timeline} /> });

  return (
    <div className="flex flex-col gap-6">
      <CabecalhoFicha ficha={ficha} aoAtualizar={recarregar} />
      <Abas abas={abas} />
    </div>
  );
}
