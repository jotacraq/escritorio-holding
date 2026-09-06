import {
  CHAVE_FORMULARIO_ESTRATEGICO,
  LIMITE_OPCOES,
  chaveFormularioValida,
  lerDefinicao,
  normalizarOpcoes,
  rotuloDaResposta,
  validarDefinicao,
  type PerguntaDefinicao,
  type ProblemaDefinicao,
  type TipoPergunta,
} from "@/lib/formulario/definicao";

/**
 * Definição do Formulário Estratégico (POP 02) — porta do SERVIDOR.
 *
 * Este arquivo NÃO tem regra própria. O núcleo puro vive em
 * `src/lib/formulario/definicao.ts` porque é o único que roda nos DOIS lados
 * (navegador e servidor); a direção `@/server` → `@/lib` é a permitida, a
 * inversa não existe. Até o pentest da rodada 3 havia dois validadores gêmeos
 * em TypeScript — o do servidor e o do editor —, e a mesma regra escrita duas
 * vezes é uma regra que já está divergindo (o teto de opções da 0081, por
 * exemplo, teria de nascer nos dois).
 *
 * O que sobra aqui é a ADAPTAÇÃO ao contrato HTTP: `ErroDefinicao.pergunta` é o
 * nome do campo que `POST /api/formularios` devolve em `detalhes[]` e que a
 * tela usa para destacar a linha culpada. O banco continua sendo a trava (a
 * rota chama a RPC e o CHECK está lá); isto é a porta de entrada, que recusa
 * cedo e com mensagem legível mesmo antes de a migration ser aplicada.
 */

export {
  CHAVE_FORMULARIO_ESTRATEGICO,
  LIMITE_OPCOES,
  chaveFormularioValida,
  lerDefinicao,
  normalizarOpcoes,
  rotuloDaResposta,
};
export type { PerguntaDefinicao, TipoPergunta };

export interface ErroDefinicao {
  /** Mesmo código do `raise exception` da RPC — a tela pode casar os dois. */
  codigo: string;
  /** Id da pergunta culpada, quando existe. A tela destaca essa linha. */
  pergunta: string | null;
  mensagem: string;
}

/**
 * Valida o corpo cru de `POST /api/formularios` (jsonb do cliente HTTP, não o
 * rascunho tipado da tela) e devolve TODOS os erros de uma vez, na forma que a
 * rota serializa.
 */
export function validarDefinicaoFormulario(definicao: unknown, chave?: string | null): ErroDefinicao[] {
  return validarDefinicao(definicao, chave).map((problema: ProblemaDefinicao) => ({
    codigo: problema.codigo,
    pergunta: problema.perguntaId,
    mensagem: problema.mensagem,
  }));
}
