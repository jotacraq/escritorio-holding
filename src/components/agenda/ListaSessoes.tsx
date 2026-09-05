"use client";

import { useCallback, useMemo } from "react";
import { useRecurso } from "@/hooks/useRecurso";
import { Cartao } from "@/components/ui/Cartao";
import { EsqueletoLista } from "@/components/ui/Esqueleto";
import { EstadoErro, EstadoIndisponivel, EstadoVazio } from "@/components/ui/Estado";
import { Kpi } from "@/components/ui/Kpi";
import { LinkBotao } from "@/components/painel/LinkBotao";
import type { AgendamentoAgenda } from "@/types/agenda";
import { listarAgendamentos } from "./api-agendamentos";
import { LinhaAgendamento } from "./LinhaAgendamento";
import { estadoPresenca } from "./SeloPresenca";

const DIA_MS = 24 * 60 * 60 * 1000;
const FORMATO_DIA = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "long" });
const FORMATO_CHAVE_DIA = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });

interface GrupoDia {
  chave: string;
  titulo: string;
  itens: AgendamentoAgenda[];
}

function chaveDoDia(iso: string): string {
  return FORMATO_CHAVE_DIA.format(new Date(iso));
}

function tituloDoDia(iso: string, agora: number): string {
  const chave = chaveDoDia(iso);
  if (chave === chaveDoDia(new Date(agora).toISOString())) return "Hoje";
  if (chave === chaveDoDia(new Date(agora + DIA_MS).toISOString())) return "Amanhã";
  const texto = FORMATO_DIA.format(new Date(iso));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function agruparPorDia(itens: AgendamentoAgenda[], agora: number): GrupoDia[] {
  const grupos = new Map<string, GrupoDia>();
  for (const item of [...itens].sort((a, b) => a.inicio_em.localeCompare(b.inicio_em))) {
    const chave = chaveDoDia(item.inicio_em);
    if (!grupos.has(chave)) grupos.set(chave, { chave, titulo: tituloDoDia(item.inicio_em, agora), itens: [] });
    grupos.get(chave)!.itens.push(item);
  }
  return Array.from(grupos.values());
}

function BlocoDias({ grupos, aoAtualizar }: { grupos: GrupoDia[]; aoAtualizar: () => void }) {
  return (
    <div className="flex flex-col">
      {grupos.map((grupo) => (
        <section key={grupo.chave} aria-label={grupo.titulo} className="border-t border-linha first:border-t-0">
          <h3 className="sticky top-0 z-[1] bg-papel-elevado/95 px-5 py-2.5 text-rotulo font-medium uppercase text-tinta-fraca backdrop-blur sm:px-6">{grupo.titulo}</h3>
          <ul className="divide-y divide-linha border-t border-linha">
            {grupo.itens.map((a) => (
              <LinhaAgendamento key={a.id} agendamento={a} aoAtualizar={aoAtualizar} mostrarPessoa mostrarData={false} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * Aba "Sessões" da Agenda — responde de cara a pergunta do brain: "quais
 * sessões acontecem nos próximos 7 dias e quais já confirmaram presença?".
 * Três KPIs no topo (só do que está carregado), o cartão "Próximos 7 dias"
 * em destaque agrupado por dia (Hoje · Amanhã · dia da semana) e, abaixo,
 * "Mais adiante". Uma busca ao montar; toda ação recarrega.
 *
 * "Confirmaram" só existe quando `GET /api/agendamentos` traz
 * `presenca_confirmada_em` (0051, agente A); sem a coluna, o KPI mostra
 * travessão e diz por quê — nunca zero.
 */
export function ListaSessoes() {
  // "Agora" é o instante em que a lista foi carregada — medido junto com o
  // dado, não no render (que precisa ser puro e idempotente).
  const buscar = useCallback(async () => {
    const resultado = await listarAgendamentos();
    return { resultado, carregadoEm: Date.now() };
  }, []);
  const { dados: carga, carregando, erro, recarregar } = useRecurso(buscar, []);
  const dados = carga?.resultado;
  const agora = carga?.carregadoEm ?? 0;

  const resumo = useMemo(() => {
    const itens = dados?.itens ?? [];
    const limite = agora + 7 * DIA_MS;
    const proximos = itens.filter((a) => Date.parse(a.inicio_em) <= limite);
    const depois = itens.filter((a) => Date.parse(a.inicio_em) > limite);
    const temColunaPresenca = itens.some((a) => Object.prototype.hasOwnProperty.call(a, "presenca_confirmada_em"));
    const confirmaram = temColunaPresenca ? proximos.filter((a) => estadoPresenca(a.presenca_confirmada_em, a.inicio_em, agora) === "confirmada").length : null;
    const semResposta = temColunaPresenca ? proximos.filter((a) => estadoPresenca(a.presenca_confirmada_em, a.inicio_em, agora) === "sem_resposta").length : null;
    return {
      proximos,
      depois,
      confirmaram,
      semResposta,
      gruposProximos: agruparPorDia(proximos, agora),
      gruposDepois: agruparPorDia(depois, agora),
    };
  }, [dados, agora]);

  if (carregando && !carga) return <EsqueletoLista linhas={4} rotulo="Carregando a agenda…" />;
  if (Boolean(erro) && !carga) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não deu para carregar a agenda" />;
  if (carga && dados === null) return <EstadoIndisponivel titulo="Lista global de agendamentos ainda não disponível" />;
  if (!dados) return null;

  const temAlgo = dados.itens.length > 0;
  const motivoConfirmaram = !temAlgo ? "nenhuma sessão marcada" : "confirmação de presença ainda não disponível";

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Resumo dos próximos 7 dias" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Kpi rotulo="Nos 7 dias" valor={resumo.proximos.length} />
        <Kpi rotulo="Confirmaram presença" valor={resumo.confirmaram} unidade={resumo.confirmaram !== null && resumo.proximos.length > 0 ? `de ${resumo.proximos.length}` : undefined} motivoVazio={motivoConfirmaram} />
        <Kpi rotulo="Sem resposta a menos de 3 dias" valor={resumo.semResposta} motivoVazio={motivoConfirmaram} />
      </section>

      <Cartao
        rotulo="Em destaque"
        titulo="Próximos 7 dias"
        preenchimento="sem"
        realce="latao"
      >
        {resumo.proximos.length === 0 ? (
          <div className="p-5 sm:p-6">
            <EstadoVazio
              ilustracao="agenda"
              titulo="Nenhuma sessão nos próximos 7 dias"
              descricao="A Sessão de Viabilidade é marcada pela Pasta do Cliente (aba Sessão) ou pelo link de agendamento que o cliente recebe."
              acao={<LinkBotao href="/esteira" variante="cta" tamanho="normal">Abrir a esteira</LinkBotao>}
            />
          </div>
        ) : (
          <BlocoDias grupos={resumo.gruposProximos} aoAtualizar={recarregar} />
        )}
      </Cartao>

      {resumo.depois.length > 0 && (
        <Cartao rotulo="Depois" titulo="Mais adiante" acao={<span className="text-xs text-tinta-fraca">{resumo.depois.length}</span>} preenchimento="sem">
          <BlocoDias grupos={resumo.gruposDepois} aoAtualizar={recarregar} />
        </Cartao>
      )}
    </div>
  );
}
