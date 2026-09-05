import { ApiError, chamar } from "@/lib/api";
import type {
  CroquiCalculo,
  CorpoRegistrarCroquiCalculo,
  RespostaCroquiCalculo,
} from "@/types/croqui-calculo";

/**
 * Cliente de `GET|POST /api/jornadas/[id]/croqui-calculo` (contrato congelado
 * do §11.4). Fica aqui, e não em `src/lib/api.ts`, porque o croqui é a única
 * superfície que consome estas rotas — mas o transporte é o `chamar()` de
 * sempre, não uma segunda pilha HTTP.
 *
 * O 409 `parametro_ausente` devolve, em `detalhes`, a lista de chaves e
 * jurisdições que faltam. Era ali que a informação se perdia: `chamar()`
 * repassava só `detalhe` (singular). Corrigido em `lib/api.ts` para repassar
 * os dois — é o que faz a tela dizer "falta o ITCMD de MG" em vez de "erro
 * ao salvar".
 */

export interface ChaveAusente {
  chave: string;
  rotulo: string;
  uf: string | null;
  municipio: string | null;
}

/** Lê o `detalhes` do 409 sem confiar na forma: dado de rede é `unknown`. */
export function chavesDoErro(erro: unknown): ChaveAusente[] {
  if (!(erro instanceof ApiError) || erro.codigo !== "parametro_ausente") return [];
  const detalhe = erro.detalhe as { chaves?: unknown } | null | undefined;
  if (!detalhe || !Array.isArray(detalhe.chaves)) return [];
  return detalhe.chaves.flatMap((item): ChaveAusente[] => {
    if (!item || typeof item !== "object") return [];
    const bruto = item as Record<string, unknown>;
    if (typeof bruto.chave !== "string") return [];
    return [
      {
        chave: bruto.chave,
        rotulo: typeof bruto.rotulo === "string" ? bruto.rotulo : bruto.chave,
        uf: typeof bruto.uf === "string" ? bruto.uf : null,
        municipio: typeof bruto.municipio === "string" ? bruto.municipio : null,
      },
    ];
  });
}

export function buscarCroquiCalculo(jornadaId: string): Promise<RespostaCroquiCalculo> {
  return chamar<RespostaCroquiCalculo>(`/api/jornadas/${jornadaId}/croqui-calculo`);
}

/**
 * Fixa uma versão. O corpo NÃO carrega resultado: o servidor recalcula com os
 * parâmetros vigentes. Se o simulador estava com premissa diferente da ficha,
 * a versão gravada é a da ficha — e a tela precisa dizer isso.
 */
export function fixarCroquiCalculo(
  jornadaId: string,
  corpo: CorpoRegistrarCroquiCalculo = {},
): Promise<{ calculo: CroquiCalculo }> {
  return chamar<{ calculo: CroquiCalculo }>(`/api/jornadas/${jornadaId}/croqui-calculo`, {
    method: "POST",
    body: JSON.stringify(corpo),
  });
}

/** "Fixar esta versão" de uma versão anterior da gaveta — o servidor troca o
 *  `atual` pela RPC `fixar_croqui_calculo` (0069, só service_role) e devolve a
 *  linha; `ja_era_atual` quando não havia o que trocar. */
export function fixarVersaoCroqui(
  jornadaId: string,
  calculoId: string,
): Promise<{ calculo: CroquiCalculo; ja_era_atual: boolean }> {
  return chamar<{ calculo: CroquiCalculo; ja_era_atual: boolean }>(
    `/api/jornadas/${jornadaId}/croqui-calculo/${calculoId}/fixar`,
    { method: "POST" },
  );
}
