"use client";

import { useCallback, useMemo, useState } from "react";
import { useRecurso } from "@/hooks/useRecurso";
import { Abas } from "@/components/ui/Abas";
import { Botao } from "@/components/ui/Botao";
import { CabecalhoPagina } from "@/components/ui/CabecalhoPagina";
import { Campo, Selecao } from "@/components/ui/Campo";
import { Cartao } from "@/components/ui/Cartao";
import { EsqueletoLista } from "@/components/ui/Esqueleto";
import { EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { Selo } from "@/components/ui/Selo";
import { formatarDataHora } from "@/lib/formatar";
import {
  buscarPendenciasSistema,
  listarMensagens,
  listarMensagensRecebidas,
  type CanalMensagem,
  type MensagemDaFila,
  type StatusMensagem,
} from "./api-comunicacao";
import { ROTULO_GRUPO, agruparPorQuando } from "./humanizar";
import { ItemMensagem } from "./ItemMensagem";
import { PendenciasSistema, filtrarPendenciasDeComunicacao } from "./PendenciasSistema";
import { ProvaDeVidaCron } from "./ProvaDeVidaCron";
import { Recebidas } from "./Recebidas";

type FiltroCanal = CanalMensagem | "todos";

const ICONE_ATUALIZAR = (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 10a6 6 0 1 1-1.8-4.3" />
    <path d="M16 3v4h-4" />
  </svg>
);

/**
 * Comunicação = "O que vai sair e quando". Três fontes, um fetch cada ao
 * montar + botão Atualizar + refetch após ação — sem polling (egress do
 * Supabase é da organização, armadilha 10). Ordem na tela: a régua está
 * viva? → o que depende de alguém → a agenda de saídas → recebidas → histórico.
 */
export function ComunicacaoApp() {
  const buscarPendentes = useCallback(() => listarMensagens({ status: "pendente" }), []);
  const pendentes = useRecurso(buscarPendentes, []);

  const buscarRecebidas = useCallback(() => listarMensagensRecebidas({ limite: 100 }), []);
  const recebidas = useRecurso(buscarRecebidas, []);

  const buscarPendencias = useCallback(() => buscarPendenciasSistema(), []);
  const pendencias = useRecurso(buscarPendencias, []);

  const [canal, setCanal] = useState<FiltroCanal>("todos");

  function atualizarTudo() {
    pendentes.recarregar();
    recebidas.recarregar();
    pendencias.recarregar();
  }

  const itensFiltrados = useMemo(() => {
    const itens = pendentes.dados?.itens ?? [];
    return canal === "todos" ? itens : itens.filter((m) => m.canal === canal);
  }, [pendentes.dados, canal]);

  const grupos = useMemo(() => agruparPorQuando(itensFiltrados), [itensFiltrados]);
  const totalWhatsapp = (pendentes.dados?.itens ?? []).filter((m) => m.canal === "whatsapp").length;
  const pendenciasDaTela = useMemo(() => filtrarPendenciasDeComunicacao(pendencias.dados ?? []), [pendencias.dados]);
  const semVinculo = recebidas.dados?.disponivel ? recebidas.dados.itens.filter((m) => !m.pessoa_id).length : 0;
  const atualizando = pendentes.carregando || recebidas.carregando || pendencias.carregando;
  // Carimbo do último fetch da fila (muda quando `dados` muda), não do render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const atualizadoEm = useMemo(() => new Date().toISOString(), [pendentes.dados]);

  return (
    <div className="flex flex-col gap-8">
      <CabecalhoPagina
        rotulo="Dia a dia"
        titulo="Comunicação"
        descricao="O que vai sair para cada cliente, quando e por qual canal. E-mail sai sozinho quando a régua roda; WhatsApp sai pela sua mão."
        acoes={
          <Botao variante="secundario" icone={ICONE_ATUALIZAR} carregando={atualizando} onClick={atualizarTudo}>
            Atualizar
          </Botao>
        }
        meta={
          pendentes.dados ? (
            <>
              <Selo tom="neutro">{pendentes.dados.itens.length} a sair</Selo>
              {totalWhatsapp > 0 && <Selo tom="ambar">{totalWhatsapp} por WhatsApp, pela sua mão</Selo>}
              <span>Atualizado em {formatarDataHora(atualizadoEm)}</span>
            </>
          ) : undefined
        }
      />

      {pendentes.dados && <ProvaDeVidaCron regua={pendentes.dados.regua} />}

      {pendenciasDaTela.length > 0 && <PendenciasSistema itens={pendenciasDaTela} />}

      <Abas
        semMoldura
        deepLinkHash
        abas={[
          {
            id: "a-sair",
            rotulo: "O que vai sair",
            extra: pendentes.dados ? <Selo tom="neutro">{pendentes.dados.itens.length}</Selo> : undefined,
            conteudo: (
              <AgendaDeSaidas
                grupos={grupos}
                totalSemFiltro={pendentes.dados?.itens.length ?? 0}
                carregando={pendentes.carregando}
                erro={pendentes.erro}
                recarregar={pendentes.recarregar}
                canal={canal}
                aoMudarCanal={setCanal}
              />
            ),
          },
          {
            id: "recebidas",
            rotulo: "Recebidas",
            extra: semVinculo > 0 ? <Selo tom="ambar">{semVinculo}</Selo> : undefined,
            conteudo: <Recebidas dados={recebidas.dados} carregando={recebidas.carregando} erro={recebidas.erro} recarregar={recebidas.recarregar} />,
          },
          { id: "historico", rotulo: "Enviadas e falhas", conteudo: <Historico /> },
        ]}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aba 1 — agenda de saídas, agrupada por quando
// ---------------------------------------------------------------------------

function FiltroDeCanal({ canal, aoMudar }: { canal: FiltroCanal; aoMudar: (c: FiltroCanal) => void }) {
  const opcoes: { id: FiltroCanal; rotulo: string }[] = [
    { id: "todos", rotulo: "Todos os canais" },
    { id: "whatsapp", rotulo: "WhatsApp" },
    { id: "email", rotulo: "E-mail" },
  ];
  return (
    <div role="group" aria-label="Filtrar por canal" className="flex flex-wrap gap-2">
      {opcoes.map((o) => {
        const ativo = o.id === canal;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={ativo}
            onClick={() => aoMudar(o.id)}
            className={`min-h-11 rounded-pilula border px-4 text-sm font-medium transition-colors duration-[var(--transicao-rapida)] ${
              ativo ? "border-[color:var(--latao)] bg-latao-fraco text-tinta" : "border-linha-forte bg-papel-elevado text-tinta-suave hover:border-[color:var(--latao)] hover:text-tinta"
            }`}
          >
            {o.rotulo}
          </button>
        );
      })}
    </div>
  );
}

function AgendaDeSaidas({
  grupos,
  totalSemFiltro,
  carregando,
  erro,
  recarregar,
  canal,
  aoMudarCanal,
}: {
  grupos: ReturnType<typeof agruparPorQuando>;
  totalSemFiltro: number;
  carregando: boolean;
  erro: unknown;
  recarregar: () => void;
  canal: FiltroCanal;
  aoMudarCanal: (c: FiltroCanal) => void;
}) {
  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível carregar a fila" />;
  if (carregando && totalSemFiltro === 0 && grupos.length === 0) return <EsqueletoLista linhas={4} rotulo="Carregando a fila…" />;

  return (
    <div className="flex flex-col gap-6">
      <FiltroDeCanal canal={canal} aoMudar={aoMudarCanal} />

      {totalSemFiltro === 0 && (
        <EstadoVazio
          ilustracao="sucesso"
          titulo="Nada pendente para sair"
          descricao="Toda mensagem agendada já foi enviada. Novas entram sozinhas quando um cliente compra, agenda ou realiza a sessão."
        />
      )}
      {totalSemFiltro > 0 && grupos.length === 0 && (
        <EstadoVazio compacto titulo="Nada neste canal" descricao="Há mensagens pendentes no outro canal — troque o filtro acima." />
      )}

      {grupos.map(({ grupo, itens }) => (
        <Cartao
          key={grupo}
          preenchimento="sem"
          como="section"
          realce={grupo === "atrasada" ? "ambar" : undefined}
          rotulo={ROTULO_GRUPO[grupo].titulo}
          titulo={`${itens.length} ${itens.length === 1 ? "mensagem" : "mensagens"}`}
          descricao={ROTULO_GRUPO[grupo].descricao || undefined}
        >
          <ul className="divide-y divide-linha">
            {itens.map((m) => (
              <ItemMensagem key={m.id} mensagem={m} modo="agenda" aoMudar={recarregar} />
            ))}
          </ul>
        </Cartao>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aba 3 — histórico (enviadas, falhas, canceladas)
// ---------------------------------------------------------------------------

const STATUS_HISTORICO: { id: StatusMensagem; rotulo: string }[] = [
  { id: "enviada", rotulo: "Enviadas" },
  { id: "falhou", rotulo: "Falhas" },
  { id: "cancelada", rotulo: "Canceladas" },
];

function Historico() {
  const [status, setStatus] = useState<StatusMensagem>("enviada");
  const [canal, setCanal] = useState<FiltroCanal>("todos");
  const buscar = useCallback(() => listarMensagens({ status, canal: canal === "todos" ? undefined : canal }), [status, canal]);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, [status, canal]);

  // A API devolve por `agendada_para` crescente; histórico lê melhor do mais recente para o mais antigo.
  const ordenados = useMemo<MensagemDaFila[]>(() => [...(dados?.itens ?? [])].reverse(), [dados]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <Campo rotulo="Mostrar" className="sm:w-56">
          <Selecao value={status} onChange={(e) => setStatus(e.target.value as StatusMensagem)}>
            {STATUS_HISTORICO.map((s) => (
              <option key={s.id} value={s.id}>
                {s.rotulo}
              </option>
            ))}
          </Selecao>
        </Campo>
        <FiltroDeCanal canal={canal} aoMudar={setCanal} />
      </div>

      {erro ? <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível carregar o histórico" /> : null}
      {!erro && carregando && !dados && <EsqueletoLista linhas={4} rotulo="Carregando o histórico…" />}
      {!erro && dados && ordenados.length === 0 && (
        <EstadoVazio compacto titulo={`Nenhuma mensagem ${STATUS_HISTORICO.find((s) => s.id === status)?.rotulo.toLowerCase() ?? ""}`} descricao="Nada registrado com este filtro." />
      )}
      {!erro && ordenados.length > 0 && (
        <Cartao preenchimento="sem" rotulo="Histórico" titulo={`${ordenados.length} ${ordenados.length === 1 ? "mensagem" : "mensagens"}`} descricao={ordenados.length >= 200 ? "Mostrando as 200 mais recentes." : undefined}>
          <ul className="divide-y divide-linha">
            {ordenados.map((m) => (
              <ItemMensagem key={m.id} mensagem={m} modo="historico" aoMudar={recarregar} />
            ))}
          </ul>
        </Cartao>
      )}
    </div>
  );
}
