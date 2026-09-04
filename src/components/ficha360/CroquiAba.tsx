"use client";

import { useCallback, useMemo, useState } from "react";
import {
  acharCroquiIdNaTimeline,
  buscarCroquiPorId,
  buscarFicha360,
  criarCroqui,
  atualizarCroqui,
  ApiError,
  type EventoTimeline,
} from "@/lib/api";
import { useRecurso } from "@/hooks/useRecurso";
import { useTema } from "@/hooks/useTema";
import { criarEsqueletoSlides } from "@/lib/croqui";
import { EstadoCarregando, EstadoErro } from "@/components/ui/Estado";
import { Botao } from "@/components/ui/Botao";
import { Abas, type DefinicaoAba } from "@/components/ui/Abas";
import { EditorCroqui } from "@/components/croqui/EditorCroqui";
import { AnaliseSessaoPainel } from "@/components/croqui/AnaliseSessaoPainel";
import type { DadosGraficosCroqui } from "@/components/croqui/GraficoDoSlide";
import { type CroquiComAnalises, type ResultadoAnaliseSessao } from "./api-analise";
import type { CroquiConteudo } from "@/server/ia/schema-croqui-slides";

/**
 * A Ficha 360 · Croqui (ARQUITETURA-FASE-3.md §2/§3, onda 3 — agente H).
 * Reúne as duas partes 1 e 2 da entrega deste agente: a Análise da Sessão
 * (U4) e a Revisão/Edição dos 13 slides (§3.6). Nenhuma delas ganhou uma aba
 * de topo própria na Ficha 360 (`src/app/(app)/jornadas/[id]/page.tsx` é
 * fronteira do agente D, onda 1 — fora da fronteira desta entrega) — vivem
 * aqui, como sub-abas do mesmo componente que já é dono do Croqui, com o
 * mesmo componente `Abas` que a Ficha 360 usa em cima. Pedido explícito ao
 * agente D no relatório da onda: mover "Análise da Sessão" para o grupo
 * "Sessão" quando `page.tsx` for tocado de novo — hoje isso exigiria editar
 * um arquivo fora desta fronteira.
 */
export function CroquiAba({ jornadaId, timeline }: { jornadaId: string; timeline: EventoTimeline[] }) {
  const { tema } = useTema();
  const croquiId = acharCroquiIdNaTimeline(timeline);

  const buscarCroqui = useCallback(
    () => (croquiId ? buscarCroquiPorId(croquiId).then((r) => r.croqui as CroquiComAnalises) : Promise.resolve(null)),
    [croquiId],
  );
  const { dados: croqui, carregando: carregandoCroqui, erro: erroCroqui, recarregar: recarregarCroqui } = useRecurso(buscarCroqui, [croquiId]);

  const buscarFicha = useCallback(() => buscarFicha360(jornadaId), [jornadaId]);
  const { dados: ficha, erro: erroFicha } = useRecurso(buscarFicha, [jornadaId]);

  const [criando, setCriando] = useState(false);
  const [erroCriar, setErroCriar] = useState<string | null>(null);
  const [croquiRecemAtualizado, setCroquiRecemAtualizado] = useState<CroquiComAnalises | null>(null);

  const croquiAtual = croquiRecemAtualizado ?? croqui ?? null;

  const sessaoId = ficha?.sessao?.id ?? null;

  const dadosGraficos: DadosGraficosCroqui = useMemo(
    () => ({
      pessoa: ficha ? { id: ficha.pessoa.id, nome: ficha.pessoa.nome } : null,
      familiares: ficha?.familiares ?? null,
      patrimonio: ficha?.patrimonio ?? null,
      criterios: null,
      recomendacaoArquitetura: null,
    }),
    [ficha],
  );

  const ultimaAnaliseSalva = useMemo(() => {
    const lista = croquiAtual?.croqui_analises ?? [];
    if (lista.length === 0) return null;
    const maisRecente = [...lista].sort((a, b) => b.versao - a.versao)[0];
    return { conteudo: maisRecente.conteudo, grau_confianca: maisRecente.grau_confianca, criado_em: maisRecente.criado_em };
  }, [croquiAtual]);

  async function iniciarCroqui() {
    setCriando(true);
    setErroCriar(null);
    try {
      const res = await criarCroqui(jornadaId, { titulo: "Croqui Estrutural", conteudo: { slides: criarEsqueletoSlides() } });
      // A timeline só ganha o evento no próximo carregamento da Ficha 360;
      // mostramos o croqui recém-criado direto da resposta do POST.
      setCroquiRecemAtualizado(res.croqui as CroquiComAnalises);
    } catch (e) {
      setErroCriar(e instanceof ApiError ? e.message : "Não foi possível criar o croqui.");
    } finally {
      setCriando(false);
    }
  }

  async function aoAnaliseGerada(resultado: ResultadoAnaliseSessao) {
    try {
      const r = await buscarCroquiPorId(resultado.croqui_id);
      setCroquiRecemAtualizado(r.croqui as CroquiComAnalises);
    } catch {
      // Best-effort — se falhar, o croqui aparece na próxima vez que a aba recarregar.
      recarregarCroqui();
    }
  }

  async function aoAplicarAoCroqui(conteudo: CroquiConteudo) {
    if (!croquiAtual) throw new Error("sem_croqui_para_aplicar");
    const res = await atualizarCroqui(croquiAtual.id, { conteudo });
    // A resposta do PATCH não reembute `croqui_analises` (a rota não seleciona
    // essa coluna) — preserva o que já estava carregado em vez de perder.
    setCroquiRecemAtualizado({ ...croquiAtual, ...res.croqui, croqui_analises: croquiAtual.croqui_analises });
  }

  // O erro de carregar ESTE croqui (ex.: evento de timeline apontando para um
  // id que não existe mais — drift de dado observado nesta base em mais de
  // uma nota do brain) NÃO pode bloquear a Análise da Sessão: ela não depende
  // deste croqui existir (§2.1 — a análise é insumo do croqui, não o
  // contrário; `POST /api/jornadas/[id]/analise-sessao` cria um rascunho novo
  // sozinho se precisar). Por isso o erro fica preso à sub-aba do Editor, não
  // ao componente inteiro.
  const conteudoEditor = (() => {
    if (croqui === undefined) {
      if (carregandoCroqui) return <EstadoCarregando rotulo="Carregando croqui…" />;
      if (erroCroqui) return <EstadoErro erro={erroCroqui} tentarNovamente={recarregarCroqui} />;
    }
    if (!croquiAtual) {
      return (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-tinta-suave">
            Nenhum croqui iniciado para esta jornada. Iniciar monta o esqueleto dos 13 slides do método — ou rode a Análise da Sessão
            (aba ao lado), que cria o rascunho automaticamente.
          </p>
          {erroCriar && <p role="alert" className="text-sm text-[color:var(--vermelho)]">{erroCriar}</p>}
          <Botao variante="primario" carregando={criando} onClick={iniciarCroqui}>Iniciar croqui</Botao>
        </div>
      );
    }
    return (
      <EditorCroqui
        jornadaId={jornadaId}
        croqui={croquiAtual}
        dadosGraficos={dadosGraficos}
        tema={tema}
        aoAtualizar={recarregarCroqui}
      />
    );
  })();

  const abas: DefinicaoAba[] = [
    {
      id: "analise-sessao",
      rotulo: "Análise da Sessão",
      conteudo: (
        <AnaliseSessaoPainel
          jornadaId={jornadaId}
          sessaoId={sessaoId}
          ultimaAnaliseSalva={ultimaAnaliseSalva}
          dadosGraficos={dadosGraficos}
          tema={tema}
          aoAnaliseGerada={aoAnaliseGerada}
          aoAplicarAoCroqui={aoAplicarAoCroqui}
        />
      ),
    },
    { id: "editor-croqui", rotulo: "Editor do Croqui", conteudo: conteudoEditor },
  ];

  return (
    <div className="flex flex-col gap-3">
      {erroFicha ? (
        <p role="alert" className="text-xs text-[color:var(--ambar)]">
          Não foi possível carregar patrimônio/família para os gráficos deste croqui — o texto continua editável normalmente.
        </p>
      ) : null}
      {croqui !== undefined && erroCroqui ? (
        <p role="alert" className="text-xs text-[color:var(--vermelho)]">
          Não foi possível atualizar o croqui a partir do servidor — o que está na tela é o último estado salvo com sucesso.
        </p>
      ) : null}
      <Abas abas={abas} />
    </div>
  );
}
