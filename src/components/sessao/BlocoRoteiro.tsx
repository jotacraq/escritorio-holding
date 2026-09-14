"use client";

import type { RoteiroBloco } from "@/types/roteiro";
import { useNotaLocal } from "@/components/sessao/useNotasLocais";
import { AreaTexto, Campo } from "@/components/ui/Campo";

/**
 * B73 (pedido do Marcio, 11-14/09): "o roteiro a IA quem tem que entender e
 * ir orientando, o visual deve ser... uma visão abrangente do todo da
 * sessão". O roteiro v4 foi importado como TEXTO CORRIDO — cada bloco tem
 * UMA fala de até 4.274 caracteres, `campos`/`observar` vazios em todos os
 * 13 blocos (medido, ver Diário). Renderizar `fala.texto`/`bloco.acao`
 * inteiros era o "texto muito grande"/"paredão" que ele apontou — não é CSS,
 * é o dado. Decisão: o roteiro NÃO vai mais para a tela como documento. Ele
 * é insumo da IA (via `PainelCopiloto`/briefing); aqui mostra só a
 * localização no fluxo — número, título e progresso — igual a um quadro de
 * estado, nunca um script a ler. `bloco.objetivo`, quando existe e é curto,
 * ainda cabe numa linha; nunca falas, nunca `acao`/`proibido`/`observar`
 * (o mosaico de `PainelCopiloto` — "Falta neste bloco" — já cobre o que
 * falta preencher/observar, vindo do servidor, não do texto do roteiro).
 *
 * A anotação rápida (`useNotaLocal`) continua — é ação da advogada, não
 * conteúdo do roteiro.
 */
export function BlocoRoteiro({ sessaoId, bloco, indice, total }: { sessaoId: string; bloco: RoteiroBloco; indice: number; total: number }) {
  const nota = useNotaLocal(sessaoId, bloco.id);

  return (
    <div aria-labelledby="titulo-parte-atual" className="flex flex-col gap-2">
      <p className="text-rotulo font-medium uppercase text-[color:var(--latao)]">
        Parte {String(indice).padStart(2, "0")} de {total - 1}
      </p>
      <h2 id="titulo-parte-atual" className="text-subtitulo font-bold leading-snug text-tinta">
        {bloco.titulo}
      </h2>
      {bloco.objetivo && <p className="text-sm text-tinta-suave">{bloco.objetivo}</p>}

      <div className="nao-imprimir mt-1">
        <Campo rotulo="Anotação rápida desta parte" ajuda="Fica só neste navegador — não entra no prontuário." id={`nota-${bloco.id}`}>
          <AreaTexto value={nota.valor} onChange={(e) => nota.salvar(e.target.value)} rows={2} placeholder="Ex.: filho mais velho hesitou ao falar do imóvel da praia…" />
        </Campo>
      </div>
    </div>
  );
}
