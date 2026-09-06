"use client";

import { useMemo } from "react";
import { Gaveta } from "@/components/ui/Gaveta";
import { SeloStub } from "@/components/ui/Selo";
import { AssistenteFormulario } from "@/components/publico/AssistenteFormulario";
import type { PerguntaPublica } from "@/components/publico/CampoPerguntaPublico";
import type { PerguntaDefinicao } from "@/lib/formulario/definicao";

/**
 * "Pré-visualizar como cliente" — SEM link real (docs/ARQUITETURA-FASE-7.md §A5.2).
 *
 * Não se emite `links_publicos` para pré-visualizar: seria um link de verdade
 * numa jornada de verdade, com linha na timeline, e a barra "Enviar" revogaria
 * o link que o cliente já tem na mão. Também não se cria rota em `/p/*`: aquele
 * espaço é anônimo, e qualquer um leria a definição do POP 02 antes do cliente.
 *
 * O que se faz: montar o MESMO componente do formulário público
 * (`AssistenteFormulario`) com dados em memória, dentro de `.area-publica` — a
 * classe que traz o tema claro, a tipografia grande e o alvo de toque de 44 px
 * das páginas do cliente — numa moldura de celular. A prévia é fiel por
 * construção, porque é o mesmo componente e o mesmo CSS.
 */
export function FormularioPrevia({
  aberta,
  aoFechar,
  definicao,
  versao,
}: {
  aberta: boolean;
  aoFechar: () => void;
  definicao: PerguntaDefinicao[];
  /** Aparece no rótulo: a prévia é sempre de uma versão que ainda não existe. */
  versao: number;
}) {
  // O assistente só sabe ler perguntas; `opcoes` entra como `unknown` e é
  // normalizada lá dentro, então os dois formatos de `definicao` funcionam.
  const perguntas = useMemo(() => definicao as unknown as PerguntaPublica[], [definicao]);

  return (
    <Gaveta
      aberta={aberta}
      aoFechar={aoFechar}
      rotulo="Pré-visualização"
      titulo={`Como o cliente vê a v${versao}`}
      descricao="Nada é enviado e ninguém recebe nada. Nenhum link é emitido."
    >
      <div className="flex flex-col gap-item">
        <SeloStub texto="Pré-visualização — nada é enviado e ninguém recebe nada." />
        {/*
         * Moldura de celular: 390 px é a largura do aparelho mais comum entre os
         * clientes (iPhone 12–15). A `.area-publica` redeclara os tokens de cor
         * do tema claro, então a prévia não muda quando o Admin está no escuro —
         * o cliente sempre vê a versão clara.
         */}
        <div className="mx-auto w-full max-w-[390px] overflow-hidden rounded-cartao border border-linha-forte shadow-cartao">
          <div className="area-publica bg-papel-fundo px-4 py-6">
            {perguntas.length === 0 ? (
              <p className="text-sm text-tinta-suave">Não há pergunta nenhuma nesta versão — o cliente abriria o link e não veria nada para responder.</p>
            ) : (
              <AssistenteFormulario
                // A prévia recomeça do zero a cada abertura: `key` amarrada ao
                // conteúdo evita mostrar o rascunho de respostas da prévia anterior.
                key={`previa-${perguntas.length}-${perguntas.map((p) => p.id).join("|")}`}
                primeiroNome="Cliente"
                definicao={perguntas}
                consentimentos={[]}
                aoConcluir={async () => aoFechar()}
                modoPrevia
              />
            )}
          </div>
        </div>
      </div>
    </Gaveta>
  );
}
