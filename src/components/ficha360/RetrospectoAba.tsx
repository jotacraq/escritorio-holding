"use client";

import { useCallback } from "react";
import { chamar } from "@/lib/api";
import { useRecurso } from "@/hooks/useRecurso";
import type { RetrospectoDaSessao } from "@/types/copiloto";
import { CorpoRetrospecto } from "@/components/sessao/copiloto/CorpoRetrospecto";
import { caminhoRetrospecto } from "@/components/sessao/copiloto/PopupRetrospecto";
import { EstadoCarregando, EstadoVazio } from "@/components/ui/Estado";
import { Botao } from "@/components/ui/Botao";

/**
 * Fase 13, FE-8 — "consultar depois da sessão" (pedido literal do dono).
 *
 * **Zero página nova e zero corpo novo.** A Ficha 360 já tem a aba "Sessão" e
 * a navegação por hash; o documento em si é o MESMO `CorpoRetrospecto` que o
 * pop-up do encerramento desenha. Um corpo, dois containers — é o item de
 * "otimização" da fase: a tela de consulta não é código novo.
 *
 * **Sem sessão de viabilidade, não há o que consultar** — e a tela diz isso
 * por extenso, em vez de desenhar um documento com seções zeradas. Mesma
 * regra para o 404 (a sessão existe, mas nenhum retrospecto foi gravado: o
 * copiloto não chegou a ser encerrado, ou a montagem falhou). Nunca zeros,
 * nunca um "documento vazio" que se leia como "a sessão não teve nada".
 */
export function RetrospectoAba({ sessaoId }: { sessaoId: string | null }) {
  const buscar = useCallback(async () => {
    if (!sessaoId) return null;
    try {
      return await chamar<RetrospectoDaSessao>(caminhoRetrospecto(sessaoId));
    } catch (erro) {
      // 404 é ESTADO, não falha: nenhum retrospecto foi gravado para esta
      // sessão. Cai no vazio honesto abaixo, nunca no `EstadoErro` com
      // "tentar de novo" — repetir a chamada não faz um documento existir.
      if ((erro as { status?: number } | null)?.status === 404) return null;
      throw erro;
    }
  }, [sessaoId]);

  const { dados, carregando, erro, recarregar } = useRecurso(buscar, [sessaoId]);

  if (carregando && !dados) return <EstadoCarregando rotulo="Abrindo o retrospecto…" />;

  if (erro) {
    return (
      <EstadoVazio
        titulo="Não foi possível abrir o retrospecto"
        descricao="A ficha continua inteira. Tente de novo em instantes."
        acao={
          <Botao variante="primario" onClick={recarregar}>
            Tentar de novo
          </Botao>
        }
      />
    );
  }

  if (!sessaoId) {
    return <EstadoVazio titulo="Ainda não há sessão" descricao="O retrospecto existe a partir do momento em que o copiloto de uma Sessão de Viabilidade é encerrado." />;
  }

  if (!dados) {
    return (
      <EstadoVazio
        titulo="Nenhum retrospecto nesta sessão"
        descricao="O retrospecto é gravado quando o copiloto da sessão é encerrado."
      />
    );
  }

  return (
    <div className="flex flex-col gap-cartao">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {/* Mesmo padrão de download do pop-up e de `croqui/BaixarRelatorio.tsx`:
         * `<a href download>` + `Content-Disposition` da rota. A página não
         * troca ao clicar, e funciona com botão direito / nova aba. */}
        <a
          href={caminhoRetrospecto(sessaoId, "docx")}
          download
          className="inline-flex min-h-11 items-center justify-center rounded-controle border border-linha-forte bg-papel-elevado px-3.5 text-sm font-medium text-tinta transition-colors duration-[var(--transicao-rapida)] hover:border-[color:var(--latao)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--latao-cta)]"
        >
          Baixar (.docx)
        </a>
      </div>
      <CorpoRetrospecto retrospecto={dados} />
    </div>
  );
}
