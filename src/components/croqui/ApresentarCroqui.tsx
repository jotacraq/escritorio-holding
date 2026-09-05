"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ResultadoCroqui } from "@/types/croqui-calculo";
import type { CroquiNarrativa } from "@/server/ia/schema-croqui-narrativa";
import { calcularCroqui } from "@/server/motor-croqui";
import { registrarApresentacaoCroqui } from "@/lib/api";
import { useRecurso } from "@/hooks/useRecurso";
import { useToast } from "@/hooks/useToast";
import { EstadoCarregando, EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { Apresentacao, CORES_APRESENTACAO } from "./Apresentacao";
import { DeckTabelas } from "./DeckTabelas";
import { TelaCheiaApresentacao } from "./TelaCheiaApresentacao";
import { PALETA_PROJECAO } from "./paletasTabela";
import { buscarCroquiCalculo } from "./apiCroquiCalculo";
import { buscarNarrativaOpcional } from "./apiNarrativa";
import { montarSlidesDoCroqui } from "./slidesDoMetodo";

/**
 * O croqui projetado para a família — as tabelas do método, não prosa gerada.
 *
 * Reaproveita a `Apresentacao` genérica (teclado, progresso, notas atrás do N,
 * tela cheia, toque, impressão) e entra só com os slides. A versão fixada é a
 * que se apresenta quando existe: a família vê o número que foi gravado e
 * versionado, não um recálculo do momento. Sem versão fixada, calcula da
 * ficha e a barra avisa.
 *
 * A apresentação é REGISTRADA (`POST /api/croquis/[id]/apresentacao`): abrir
 * grava `iniciar`, sair grava `encerrar` com quantos slides foram vistos, e é
 * o `encerrar` que faz o servidor avançar a etapa `croqui_apresentado`. Sem
 * isso o passo "Croqui" do trilho só andava à mão no Kanban — foi assim que a
 * Fase 5 nasceu, ao trocar o `ModoApresentacao` por esta tela. Registro é
 * best-effort: falha vira aviso curto, nunca trava o projetor.
 */
export function ApresentarCroqui({
  croquiId,
  jornadaId,
  titulo,
}: {
  /** Ausente = tela aberta fora da rota do croqui: apresenta, não registra. */
  croquiId?: string | null;
  jornadaId: string;
  titulo: string;
}) {
  const router = useRouter();
  const { notificar } = useToast();
  const buscar = useCallback(() => buscarCroquiCalculo(jornadaId), [jornadaId]);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, [jornadaId]);

  const resultado = useMemo<ResultadoCroqui | null>(() => {
    if (!dados) return null;
    if (dados.atual) return dados.atual.resultado;
    return calcularCroqui(dados.entrada, dados.parametros);
  }, [dados]);

  // Notas do apresentador (tecla N): a narrativa atual, quando a bancada já
  // ativou o prompt. Extra silencioso — ver `apiNarrativa.ts`.
  const [narrativa, setNarrativa] = useState<CroquiNarrativa | null>(null);
  useEffect(() => {
    if (!croquiId) return;
    let vivo = true;
    buscarNarrativaOpcional(croquiId).then((n) => {
      if (vivo) setNarrativa(n);
    });
    return () => {
      vivo = false;
    };
  }, [croquiId]);

  const slides = useMemo(
    () => (resultado ? montarSlidesDoCroqui({ resultado, narrativa }) : []),
    [resultado, narrativa],
  );

  // O maior slide alcançado — o que o `encerrar` grava. `ref` e não estado:
  // ninguém redesenha por causa disto, e o valor é lido uma vez, no clique.
  const maiorVisto = useRef(0);
  const aoMudarSlide = useCallback((indice: number) => {
    maiorVisto.current = Math.max(maiorVisto.current, indice);
  }, []);

  // "Iniciar" só quando há deck de verdade: registrar uma apresentação que
  // caiu no estado vazio inventaria reunião que não houve — e é o `encerrar`
  // que avança a etapa da jornada.
  const iniciada = useRef(false);
  const temSlides = slides.length > 0;
  useEffect(() => {
    if (!croquiId || !temSlides || iniciada.current) return;
    iniciada.current = true;
    registrarApresentacaoCroqui(croquiId, { acao: "iniciar" }).catch(() => {
      iniciada.current = false;
      notificar({
        tom: "aviso",
        titulo: "Apresentação não registrada",
        descricao: "Ela abre normalmente; o registro na ficha pode faltar.",
      });
    });
  }, [croquiId, temSlides, notificar]);

  const encerrar = useCallback(() => {
    if (croquiId && iniciada.current) {
      registrarApresentacaoCroqui(croquiId, {
        acao: "encerrar",
        slides_vistos: maiorVisto.current + 1,
      }).catch(() => {
        notificar({
          tom: "aviso",
          titulo: "Encerramento não registrado",
          descricao: "Marque o croqui como apresentado na ficha.",
        });
      });
    }
    router.back();
  }, [croquiId, router, notificar]);

  // O deck impresso são as mesmas 19 tabelas outra vez (~750 nós de DOM), e
  // ele só é VISTO no `@media print`. Montá-lo junto com a apresentação custa
  // exatamente no instante em que a advogada abre o projetor e quer o
  // primeiro slide — então ele entra depois, na primeira folga do navegador.
  //
  // Deliberadamente NÃO em `beforeprint`: o handler é síncrono, mas o
  // re-render do React não é, e o navegador pode tirar a foto da página antes
  // de o deck existir. Página em branco na hora de imprimir para a família
  // não vale o milissegundo economizado.
  const [deckPronto, setDeckPronto] = useState(false);
  useEffect(() => {
    const ocioso = window.requestIdleCallback;
    if (typeof ocioso === "function") {
      const id = ocioso(() => setDeckPronto(true), { timeout: 2000 });
      return () => window.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(() => setDeckPronto(true), 200);
    return () => window.clearTimeout(id);
  }, []);

  if (carregando) {
    return (
      <TelaCheiaApresentacao>
        <EstadoCarregando rotulo="Carregando o croqui…" />
      </TelaCheiaApresentacao>
    );
  }
  if (erro) {
    return (
      <TelaCheiaApresentacao>
        <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não deu para abrir a apresentação" />
      </TelaCheiaApresentacao>
    );
  }
  if (!resultado || slides.length === 0) {
    return (
      <TelaCheiaApresentacao>
        <EstadoVazio
          titulo="Nada a apresentar"
          descricao="Complete o patrimônio e os parâmetros antes de apresentar."
        />
      </TelaCheiaApresentacao>
    );
  }

  return (
    <Apresentacao
      titulo={titulo}
      slides={slides}
      aoSair={encerrar}
      aoMudarSlide={aoMudarSlide}
      aviso={
        dados?.atual ? undefined : (
          <span
            className="rounded-controle border px-2 py-0.5 text-legenda font-medium"
            style={{ borderColor: PALETA_PROJECAO.atencao, color: PALETA_PROJECAO.atencao }}
          >
            Não fixado
          </span>
        )
      }
      impressao={deckPronto ? <DeckTabelas resultado={resultado} titulo={titulo} /> : null}
      rotuloSair="Encerrar"
    />
  );
}

export { CORES_APRESENTACAO };
