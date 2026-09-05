"use client";

import { useCallback, useMemo } from "react";
import type { Ficha360 } from "@/lib/api";
import { useRecurso } from "@/hooks/useRecurso";
import { ROTULO_DONO, derivarProximoPasso, hrefDoPasso } from "@/lib/pasta/proximo-passo";
import { sinaisComExecucao, sinaisDaFicha } from "@/lib/pasta/sinais";
import { PASSO_POR_CHAVE, derivarTrilho, passoAtual } from "@/lib/pasta/trilho";
import { ITENS_EM_GAVETA } from "@/lib/pasta/rotas";
import type { ChaveItemPasta } from "@/lib/pasta/catalogo";
import { Trilho, type AcaoTrilho } from "@/components/ui/Trilho";
import { buscarExecucao } from "./api-fase5";

/**
 * O trilho de 9 passos no topo da Ficha (§1.3, §8.1) — a primeira coisa que
 * a advogada vê: onde a família está e QUAL É A ÚNICA COISA a fazer agora.
 *
 * Uma fonte só, três camadas já congeladas:
 *   `sinaisDaFicha(ficha)` + `GET /execucao` → `sinaisComExecucao` →
 *   `derivarTrilho` (posição) e `derivarProximoPasso` (a ação).
 * Este componente não decide nada: monta a ação com o rótulo que
 * `derivarProximoPasso` já escreveu e entrega ao `ui/Trilho`.
 *
 * A execução (0067) é a ÚNICA busca extra: sem ela os três passos finais
 * ficariam "sem informação" para sempre. `indisponivel` (503 antes da
 * migration) não vira zero — os campos continuam `null` e o trilho diz
 * "sem informação", que é a verdade.
 */
export function TrilhoDaFicha({
  ficha,
  aoAbrirGaveta,
}: {
  ficha: Ficha360;
  aoAbrirGaveta: (chave: ChaveItemPasta) => void;
}) {
  const jornadaId = ficha.jornada.id;
  const buscar = useCallback(() => buscarExecucao(jornadaId), [jornadaId]);
  const { dados: execucao } = useRecurso(buscar, [jornadaId]);

  const passos = useMemo(() => {
    const base = sinaisDaFicha(ficha);
    const completos =
      execucao?.estado === "ok"
        ? sinaisComExecucao(base, {
            feitos: execucao.dados.feitos,
            total: execucao.dados.total,
            entregaEm: execucao.dados.entrega_em,
          })
        : base;
    return derivarTrilho(completos);
  }, [ficha, execucao]);

  const { acao, nota, notaTitle } = useMemo<{ acao: AcaoTrilho | null; nota: string | null; notaTitle?: string }>(() => {
    const proximo = derivarProximoPasso(sinaisDaFicha(ficha));
    // "Ninguém" = nada pendente ou sem informação: um botão aqui seria um
    // verbo sem objeto. Vazio rotulado é melhor que ação inventada.
    if (proximo.dono === "ninguem") return { acao: null, nota: null };
    const chave = proximo.chave as ChaveItemPasta;
    if (ITENS_EM_GAVETA.has(chave)) return { acao: { rotulo: proximo.passo, title: proximo.title, onClick: () => aoAbrirGaveta(chave) }, nota: null };
    // Sem rota não há botão — mas o passo continua sendo informação: quem
    // está devendo o quê ("Aguardando a compra · Cliente").
    //
    // Só que a frase só vale quando ela fala do passo ACESO. `derivarTrilho`
    // avança para o primeiro passo não concluído quando o alvo já terminou
    // (regra do M2), então "Aguardando a compra" pode acabar embaixo de
    // "2 de 9 · Ligação" — duas frases se contradizendo na mesma linha. Nesse
    // caso a linha fica só com o resumo: melhor calar do que confundir.
    if (!proximo.rota) {
      const aceso = passoAtual(passos)?.chave ?? null;
      const alvo = PASSO_POR_CHAVE[proximo.chave];
      if (aceso === null || aceso !== alvo) return { acao: null, nota: null };
      // Estado ≤ 4 palavras (§2): na linha fica "aguardando · Cliente"; a
      // frase inteira de `derivarProximoPasso` ("Aguardando a compra da
      // Sessão de Viabilidade") vai para o `title`.
      return { acao: null, nota: `aguardando · ${ROTULO_DONO[proximo.dono]}`, notaTitle: proximo.title ?? proximo.passo };
    }
    return { acao: { rotulo: proximo.passo, title: proximo.title, href: hrefDoPasso(jornadaId, proximo) }, nota: null };
  }, [ficha, jornadaId, aoAbrirGaveta, passos]);

  return (
    <Trilho
      passos={passos}
      variante="completo"
      acao={acao}
      nota={nota}
      notaTitle={notaTitle}
      rotulo="Trilho da jornada"
      className="nao-imprimir rounded-cartao border border-linha-forte bg-papel-elevado px-4 py-3.5 shadow-cartao"
    />
  );
}
