"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ApiError, listarJornadas, type JornadaKanban } from "@/lib/api";
import { EstadoCarregando, EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { Selo } from "@/components/ui/Selo";
import { formatarDataHora, formatarCidadeUf } from "@/lib/formatar";

function ListaJornadas({ itens, vazioTitulo }: { itens: JornadaKanban[]; vazioTitulo: string }) {
  if (itens.length === 0) return <EstadoVazio titulo={vazioTitulo} />;
  return (
    <ul className="flex flex-col gap-2">
      {itens.map((j) => (
        <li key={j.id}>
          <Link
            href={`/sessoes/${j.id}/conduzir`}
            className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-linha bg-papel-elevado px-3.5 py-2.5 transition-colors hover:border-[color:var(--latao)] hover:bg-latao-fraco"
          >
            <span className="flex flex-col">
              <span className="font-medium text-tinta">{j.nome}</span>
              <span className="text-xs text-tinta-fraca">{formatarCidadeUf(j.cidade, j.uf)}</span>
            </span>
            <span className="flex items-center gap-2 text-xs text-tinta-suave">
              {j.proxima_sessao_em && <span>{formatarDataHora(j.proxima_sessao_em)}</span>}
              {j.origem_dado === "exemplo" && <Selo tom="neutro">exemplo</Selo>}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function SelecionarSessaoApp() {
  const [agendadas, setAgendadas] = useState<JornadaKanban[] | null>(null);
  const [realizadas, setRealizadas] = useState<JornadaKanban[] | null>(null);
  const [erro, setErro] = useState<unknown>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const [a, r] = await Promise.all([
        listarJornadas({ etapa: "sessao_agendada" }),
        listarJornadas({ etapa: "sessao_realizada" }),
      ]);
      setAgendadas(a.itens);
      setRealizadas(r.itens);
    } catch (e) {
      setErro(e);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (carregando) return <EstadoCarregando rotulo="Carregando sessões…" />;
  if (erro) {
    const titulo = erro instanceof ApiError && erro.status === 403 ? "Sem permissão para ver as sessões" : "Não deu para carregar";
    return <EstadoErro erro={erro} tentarNovamente={carregar} titulo={titulo} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-serif text-xl font-bold text-tinta">Conduzir sessão</h1>
        <p className="text-sm text-tinta-suave">Escolha a jornada para abrir o roteiro da Sessão de Viabilidade em tela cheia.</p>
      </header>

      <section>
        <h2 className="mb-2 font-serif text-base font-bold text-tinta">A conduzir</h2>
        <ListaJornadas itens={agendadas ?? []} vazioTitulo="Nenhuma sessão agendada aguardando condução" />
      </section>

      <section>
        <h2 className="mb-2 font-serif text-base font-bold text-tinta">Já realizadas</h2>
        <ListaJornadas itens={realizadas ?? []} vazioTitulo="Nenhuma sessão realizada ainda" />
      </section>
    </div>
  );
}
