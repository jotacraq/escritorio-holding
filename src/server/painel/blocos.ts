import { CHAVES_BLOCO_PAINEL, blocosDoPapel, ehChaveBlocoPainel, type ChaveBlocoPainel } from "@/lib/blocosPorPapel";
import { erroValidacao } from "@/server/erros";
import type { PapelEquipe } from "@/types/banco";
import type { RespostaPainel } from "@/types/agenda";

/**
 * Quem decide o que `GET /api/painel` consulta — extraído do route handler para
 * ser importável (e, portanto, verificável fora de um request).
 *
 * A regra nasceu de um achado BAIXO do pentest da Fase 5: `BLOCOS_POR_PAPEL`
 * vivia só no componente, então a tela escondia o bloco e o JSON entregava tudo
 * a todo papel interno. Gate de UI por papel precisa de gêmeo no servidor,
 * senão é só CSS.
 */

/**
 * Bloco da matriz -> chave da resposta + view. Blocos ainda sem fonte (croquis,
 * documentos, execucao, parametros_divergentes) simplesmente não aparecem aqui:
 * pedi-los é legítimo e não devolve nada — é o que a Onda 2 vai mudar plugando
 * a fonte, sem tocar nesta regra.
 */
export const FONTE_DO_BLOCO = {
  sessoes_hoje: { campo: "sessoes_do_dia", view: "vw_sessoes_do_dia" },
  preparo: { campo: "pendencias_preparo", view: "vw_pendencias_preparo" },
  pagos_sem_contato: { campo: "pagos_sem_contato", view: "vw_pagos_sem_contato" },
  sistema: { campo: "pendencias_sistema", view: "vw_pendencias_sistema" },
  numeros: { campo: "indicadores_semana", view: "vw_indicadores_pop01" },
} as const satisfies Partial<Record<ChaveBlocoPainel, { campo: keyof RespostaPainel; view: string }>>;

export type BlocoComFonte = keyof typeof FONTE_DO_BLOCO;

/**
 * O que este papel pode receber. Não confia no `papel` do navegador: quem
 * chama passa o que `exigirInterno()` leu de `perfis_equipe` com a sessão
 * validada por `auth.getUser()`.
 *
 * `sistema` é a ÚNICA exceção à matriz e entra para todo papel interno de
 * propósito: `vw_pendencias_sistema` alimenta o bloco `sistema` (admin), o
 * bloco `travado` (relacionamento) e a tela de Comunicação (advogada), e o
 * corte que importa é por TIPO de linha (`pendenciaVisivelPara`), não por
 * bloco. Tirar a view de quem não tem o bloco esconderia "sessão sem sala" de
 * quem conduz a sessão — é a divergência já registrada em `blocosPorPapel.ts`.
 */
export function blocosPermitidos(papel: PapelEquipe): Set<BlocoComFonte> {
  const daMatriz = new Set<ChaveBlocoPainel>(blocosDoPapel(papel));
  const permitidos = new Set<BlocoComFonte>(["sistema"]);
  for (const bloco of Object.keys(FONTE_DO_BLOCO) as BlocoComFonte[]) {
    if (daMatriz.has(bloco)) permitidos.add(bloco);
  }
  return permitidos;
}

/**
 * `?blocos=a,b,c` -> conjunto validado. `null` = parâmetro ausente, que
 * significa "tudo que o papel vê" (o comportamento de sempre).
 *
 * Chave desconhecida vira 422 nomeando as válidas, em vez de um painel
 * silenciosamente vazio — um erro de digitação no front não pode parecer "não
 * há nada pendente".
 */
export function lerBlocosPedidos(parametros: URLSearchParams): Set<ChaveBlocoPainel> | null {
  const bruto = parametros.get("blocos");
  if (bruto === null) return null;

  const partes = bruto
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (partes.length === 0 || partes.length > CHAVES_BLOCO_PAINEL.length) {
    throw erroValidacao(
      { validos: CHAVES_BLOCO_PAINEL },
      `Informe de 1 a ${CHAVES_BLOCO_PAINEL.length} blocos em \`blocos\`, separados por vírgula.`,
    );
  }

  const desconhecidos = partes.filter((p) => !ehChaveBlocoPainel(p));
  if (desconhecidos.length > 0) {
    throw erroValidacao({ desconhecidos, validos: CHAVES_BLOCO_PAINEL }, "Bloco desconhecido em `blocos`.");
  }

  return new Set(partes.filter(ehChaveBlocoPainel));
}

/** A interseção que a rota executa: o papel manda, o `?blocos=` só reduz. */
export function blocosAConsultar(papel: PapelEquipe, pedidos: Set<ChaveBlocoPainel> | null): BlocoComFonte[] {
  return [...blocosPermitidos(papel)].filter((bloco) => pedidos === null || pedidos.has(bloco));
}
