"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useRecurso } from "@/hooks/useRecurso";
import { useToast } from "@/hooks/useToast";
import { useUsuarioAtual } from "@/hooks/useUsuarioAtual";
import { Botao } from "@/components/ui/Botao";
import { Selo } from "@/components/ui/Selo";
import { formatarDolar, RespostaDoAgente } from "@/components/comunicacao/agente";
import { mensagemDeErro } from "@/components/admin/http";
import { definirAgenteDaJornada, lerAgenteDaJornada } from "@/lib/api/agente";
import { formatarHora } from "@/lib/formatar";
import type { AgenteJornada } from "@/types/agente";

/**
 * A conversa do WhatsApp deste processo, na Ficha (Fase 9).
 *
 * Responde três perguntas que antes só existiam no banco: **o robô falou com
 * esta pessoa?**, **o que ele disse?** e **por que ele está calado?**. A
 * terceira é a que mais custa quando falta: `impedimentos` vem pronto do
 * servidor em texto de gente, e é o que transforma "o agente não respondeu"
 * em diagnóstico.
 *
 * Forma: UMA linha que abre em `<details>` nativo (DS §3.1, "recolher em vez
 * de esconder"), com o resumo do que há dentro no `<summary>` — teclado,
 * Ctrl+F e leitor de tela de graça, sem JS. Nasce fechada.
 *
 * **Não é o histórico de mensagens recebidas.** O que o cliente escreveu vive
 * em Comunicação → Recebidas (uma tela, uma fila) e nos Andamentos; aqui fica
 * o lado do agente, que é o que a Ficha não tinha. O link para a fila está no
 * rodapé do bloco.
 *
 * Quando NÃO aparece: agente desligado, sem pausa e sem nenhuma resposta neste
 * processo — para quem não é admin, o bloco nem chega ao DOM. Uma linha que só
 * diz "nada aconteceu" é a linha que faz a Ficha crescer sem informar (§9.1).
 */

const TITULO = "O que o agente de WhatsApp já respondeu neste processo e por que ele está calado agora.";

/** Só quem o servidor aceitaria (`exigirPapel` no POST) vê os botões. Nunca um botão morto. */
const PAPEIS_QUE_ASSUMEM = new Set(["admin", "advogada", "relacionamento"]);

function resumo(agente: AgenteJornada): string {
  // Quem assumiu vem por nome (`pausado_por_nome`); sem nome — perfil que saiu
  // da equipe — a frase cai para "pela equipe" em vez de mostrar um id.
  if (agente.pausado && agente.pausado_ate) {
    return `Assumida por ${agente.pausado_por_nome ?? "alguém da equipe"} até ${formatarHora(agente.pausado_ate)}`;
  }
  if (!agente.agente_ativo) return "Agente desligado";
  const total = agente.ultimas_respostas.length;
  if (total === 0) return "O agente ainda não falou aqui";
  return `${total} resposta${total === 1 ? "" : "s"} do agente`;
}

export function RecebidasFicha({ jornadaId }: { jornadaId: string }) {
  const { usuario } = useUsuarioAtual();
  const { notificar } = useToast();
  const buscar = useCallback(() => lerAgenteDaJornada(jornadaId), [jornadaId]);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, [jornadaId]);
  const [agindo, setAgindo] = useState<"assumir" | "devolver" | null>(null);

  const ehAdmin = usuario?.papel === "admin";

  if (carregando && !dados) return null;

  if (erro || !dados) {
    // Leitura indisponível é conserto de sistema: só o admin precisa saber.
    if (!ehAdmin) return null;
    return (
      <section className="flex flex-wrap items-center gap-x-item gap-y-0.5 rounded-cartao border border-linha bg-papel-elevado px-3 py-2">
        <h2 className="text-sm font-bold text-tinta" title={TITULO}>
          Conversa no WhatsApp
        </h2>
        <span className="text-sm text-tinta-suave">Leitura indisponível</span>
        <button type="button" onClick={recarregar} className="inline-flex min-h-11 items-center text-sm font-medium text-[color:var(--latao)] underline underline-offset-2">
          Tentar de novo
        </button>
      </section>
    );
  }

  const relevante = dados.agente_ativo || dados.pausado || dados.ultimas_respostas.length > 0;
  if (!relevante && !ehAdmin) return null;

  /**
   * "Assumir conversa" só existe quando há de quem assumir. Com o agente
   * desligado e sem pausa, o botão pausaria um robô que já está calado — e a
   * pessoa concluiria, com razão, que clicou em algo que não fez nada.
   */
  const podeAssumir = PAPEIS_QUE_ASSUMEM.has(usuario?.papel ?? "") && (dados.agente_ativo || dados.pausado);

  async function agir(acao: "assumir" | "devolver") {
    setAgindo(acao);
    try {
      await definirAgenteDaJornada(jornadaId, acao);
      notificar(
        acao === "assumir"
          ? { tom: "sucesso", titulo: "Conversa assumida", descricao: "O agente não responde mais nesta conversa até você devolver." }
          : { tom: "sucesso", titulo: "Devolvida ao agente", descricao: "O agente volta a responder esta conversa." },
      );
      recarregar();
    } catch (e) {
      notificar({
        tom: "erro",
        titulo: acao === "assumir" ? "Não foi possível assumir" : "Não foi possível devolver",
        descricao: mensagemDeErro(e, "Tente de novo em instantes."),
      });
    } finally {
      setAgindo(null);
    }
  }

  return (
    <details
      // Deep-link `#conversa` (trava da Fase 9): a pagina tenta abrir este
      // <details> pelo DOM antes de o bloco existir. Sincronizacao com o DOM no
      // ref, sem estado: quem chega pelo hash encontra o bloco aberto.
      ref={(el) => {
        if (el && typeof window !== "undefined" && window.location.hash === "#conversa") el.open = true;
      }}
      className="group rounded-cartao border border-linha bg-papel-elevado px-3 py-1"
    >
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-item gap-y-0.5 text-sm marker:content-none">
        <span className="font-bold text-tinta" title={TITULO}>
          Conversa no WhatsApp
        </span>
        <span className="text-tinta-suave">{resumo(dados)}</span>
        {dados.pausado && <Selo tom="ambar">Equipe no comando</Selo>}
        <span className="ml-auto text-legenda font-medium text-[color:var(--latao)]">
          <span className="group-open:hidden">ver</span>
          <span className="hidden group-open:inline">esconder</span>
        </span>
      </summary>

      <div className="flex flex-col gap-cartao px-1 pb-3 pt-2">
        {dados.impedimentos.length > 0 && (
          <div className="rounded-controle border border-linha bg-papel px-3.5 py-2.5">
            <p className="text-legenda font-medium uppercase text-tinta-fraca">Por que o agente está calado</p>
            <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4 text-sm text-tinta-suave">
              {dados.impedimentos.map((motivo) => (
                <li key={motivo}>{motivo}</li>
              ))}
            </ul>
          </div>
        )}

        {podeAssumir && (
          <div className="flex flex-wrap items-center gap-alvo">
            {dados.pausado ? (
              <Botao
                variante="secundario"
                tamanho="compacto"
                carregando={agindo === "devolver"}
                onClick={() => agir("devolver")}
                title="O agente volta a responder esta conversa a partir de agora."
              >
                Devolver ao agente
              </Botao>
            ) : (
              <Botao
                variante="secundario"
                tamanho="compacto"
                carregando={agindo === "assumir"}
                onClick={() => agir("assumir")}
                title="O agente para de responder esta conversa. Reversível pelo botão 'Devolver ao agente'."
              >
                Assumir conversa
              </Botao>
            )}
            {dados.pausado && dados.pausado_ate && (
              <span className="text-legenda text-tinta-suave">
                Pausado até <time dateTime={dados.pausado_ate}>{formatarHora(dados.pausado_ate)}</time>{" "}
                {dados.pausado_por_nome ? `por ${dados.pausado_por_nome}` : "pela equipe"}
              </span>
            )}
          </div>
        )}

        {/* Custo é informação de gestão — mesmo recorte de quem vê o Custo de IA
            no Admin (admin + advogada). Zero é dito por extenso, nunca omitido:
            "nenhuma resposta custou IA hoje" é a boa notícia que se quer ler. */}
        {(ehAdmin || usuario?.papel === "advogada") && (
          <p className="text-legenda text-tinta-fraca" title="Soma do custo de IA das respostas do agente neste processo, hoje.">
            Custo de IA hoje: {formatarDolar(dados.custo_usd_hoje) ?? "US$ 0,00"}
          </p>
        )}

        {dados.ultimas_respostas.length === 0 ? (
          <p className="text-sm text-tinta-suave">Nenhuma resposta do agente neste processo.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-linha">
            {dados.ultimas_respostas.map((resposta) => (
              <li key={resposta.id} className="py-3 first:pt-0 last:pb-0">
                <RespostaDoAgente resposta={resposta} />
              </li>
            ))}
          </ul>
        )}

        <Link href="/mensagens#recebidas" className="inline-flex min-h-11 items-center text-sm font-medium text-[color:var(--latao)] underline underline-offset-2">
          Ver o que o cliente escreveu
        </Link>
      </div>
    </details>
  );
}
