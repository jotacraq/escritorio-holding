"use client";

import { useCallback, useMemo } from "react";
import type { DesfechoJornada, Ficha360 } from "@/lib/api";
import { useRecurso } from "@/hooks/useRecurso";
import { ROTULO_DONO, derivarProximoPasso, hrefDoPasso } from "@/lib/pasta/proximo-passo";
import { sinaisComExecucao, sinaisDaFicha } from "@/lib/pasta/sinais";
import { PASSO_POR_CHAVE, agruparPorSessao, derivarTrilho, passoAtual } from "@/lib/pasta/trilho";
import { ITENS_EM_GAVETA } from "@/lib/pasta/rotas";
import type { ChaveItemPasta } from "@/lib/pasta/catalogo";
import { Trilho, type AcaoTrilho } from "@/components/ui/Trilho";
import { buscarExecucao } from "./api-fase5";

/**
 * Onde a família está + a ÚNICA coisa a fazer agora — o topo da Ficha.
 *
 * Fase 6: os 9 passos passaram a ser desenhados AGRUPADOS nas três sessões que
 * são a espinha do produto (Viabilidade · Croqui estrutural · Entrega da
 * holding). O agrupamento é `agruparPorSessao`, função pura sobre o mesmo
 * `derivarTrilho` de sempre — nenhum enum, nenhuma coluna, nenhuma regra do
 * trilho mudou. O João: *"eu preciso bater o olho e ver o todo"*; nove
 * marcadores respondem isso a quem já sabe o método, três respondem a quem
 * não sabe.
 *
 * Uma fonte só, três camadas já congeladas:
 *   `sinaisDaFicha(ficha)` + `GET /execucao` -> `sinaisComExecucao` ->
 *   `derivarTrilho` (posição) e `derivarProximoPasso` (a ação).
 * Este componente não decide nada.
 *
 * A execução (0067) é a ÚNICA busca extra: sem ela os três passos finais
 * ficariam "sem informação" para sempre. `indisponivel` (503 antes da
 * migration) não vira zero.
 *
 * `aoCopiarLink` (Fase 6 §5.5): quando o próximo passo É mandar um link para o
 * cliente, o botão da ação de agora vira o botão de copiar aquele link — em
 * vez de abrir uma gaveta onde o operador ainda teria de achar o botão certo.
 */

/**
 * Como o desfecho aparece no resumo do trilho. Sem isto, uma jornada GANHA
 * ficava "8 de 9 · Parado" — o trilho chamando de parada uma venda fechada.
 */
const ROTULO_DESFECHO: Record<DesfechoJornada, string> = {
  aberta: "Aberta",
  ganha: "Ganha",
  perdida: "Perdida",
  descartada: "Descartada",
  congelada: "Congelada",
};

/** Passo do trilho -> tipo de link. Só os passos que se resolvem MANDANDO um link. */
const LINK_DO_PASSO: Partial<Record<ChaveItemPasta | string, { tipo: string; rotulo: string }>> = {
  formulario: { tipo: "formulario", rotulo: "Copiar link do formulário" },
  links: { tipo: "agendamento", rotulo: "Copiar link do agendamento" },
  confirmar_presenca: { tipo: "confirmacao", rotulo: "Copiar link de confirmação" },
  documentos: { tipo: "documentos", rotulo: "Copiar link dos documentos" },
};

export function TrilhoDaFicha({
  ficha,
  aoAbrirGaveta,
  aoCopiarLink,
}: {
  ficha: Ficha360;
  aoAbrirGaveta: (chave: ChaveItemPasta) => void;
  /** Recebe o tipo de link a copiar. `undefined` = a Ficha não oferece a barra "Enviar". */
  aoCopiarLink?: (tipo: string) => void;
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

  const sessoes = useMemo(() => agruparPorSessao(passos), [passos]);

  const { acao, nota, notaTitle } = useMemo<{ acao: AcaoTrilho | null; nota: string | null; notaTitle?: string }>(() => {
    const proximo = derivarProximoPasso(sinaisDaFicha(ficha));
    // "Ninguém" = nada pendente ou sem informação: um botão aqui seria um
    // verbo sem objeto. Vazio rotulado é melhor que ação inventada.
    if (proximo.dono === "ninguem") return { acao: null, nota: null };

    // §5.5 — o passo que se resolve mandando um link vira o botão de copiar.
    const link = LINK_DO_PASSO[proximo.chave];
    if (link && aoCopiarLink) {
      return { acao: { rotulo: link.rotulo, title: proximo.title ?? proximo.passo, onClick: () => aoCopiarLink(link.tipo) }, nota: null };
    }

    const chave = proximo.chave as ChaveItemPasta;
    if (ITENS_EM_GAVETA.has(chave)) return { acao: { rotulo: proximo.passo, title: proximo.title, onClick: () => aoAbrirGaveta(chave) }, nota: null };

    // Sem rota não há botão — mas o passo continua sendo informação: quem
    // está devendo o quê ("Aguardando a compra · Cliente").
    //
    // Só que a frase só vale quando ela fala do passo ACESO. `derivarTrilho`
    // avança para o primeiro passo não concluído quando o alvo já terminou,
    // então "Aguardando a compra" pode acabar embaixo de "Contato" — duas
    // frases se contradizendo na mesma linha. Nesse caso a linha fica só com
    // o resumo: melhor calar do que confundir.
    if (!proximo.rota) {
      const aceso = passoAtual(passos)?.chave ?? null;
      const alvo = PASSO_POR_CHAVE[proximo.chave];
      if (aceso === null || aceso !== alvo) return { acao: null, nota: null };
      return { acao: null, nota: `aguardando · ${ROTULO_DONO[proximo.dono]}`, notaTitle: proximo.title ?? proximo.passo };
    }
    return { acao: { rotulo: proximo.passo, title: proximo.title, href: hrefDoPasso(jornadaId, proximo) }, nota: null };
  }, [ficha, jornadaId, aoAbrirGaveta, aoCopiarLink, passos]);

  return (
    <Trilho
      passos={passos}
      sessoes={sessoes}
      variante="sessoes"
      acao={acao}
      nota={nota}
      notaTitle={notaTitle}
      desfecho={ficha.jornada.desfecho === "aberta" ? null : ROTULO_DESFECHO[ficha.jornada.desfecho]}
      rotulo="As três sessões desta jornada"
      className="nao-imprimir rounded-cartao border border-linha-forte bg-papel-elevado px-cartao py-item shadow-cartao"
    />
  );
}
