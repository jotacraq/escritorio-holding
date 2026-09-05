/**
 * Cenário Patrimonial (0057, agente D) — `GET/PUT /api/jornadas/[id]/cenario`.
 * O sistema não calcula imposto (B26): `calculado` manda só `base_calculo` +
 * `parametro_id`; o banco multiplica com a alíquota carimbada. 409 vem com o
 * código do trigger (`cenario_calculado_exige_parametro`, `parametro_nao_e_percentual`,
 * `cenario_invalido`) — a tela traduz em texto humano.
 */
import { chamar } from "./api";
import type { CorpoGravarRubrica, ParametroMetodo, RespostaCenarioJornada, RespostaGravarRubrica, RespostaParametrosMetodo } from "@/types/cenario";

export function buscarCenario(jornadaId: string): Promise<RespostaCenarioJornada> {
  return chamar<RespostaCenarioJornada>(`/api/jornadas/${jornadaId}/cenario`);
}

export function gravarRubricaCenario(jornadaId: string, corpo: CorpoGravarRubrica): Promise<RespostaGravarRubrica> {
  return chamar<RespostaGravarRubrica>(`/api/jornadas/${jornadaId}/cenario`, {
    method: "PUT",
    body: JSON.stringify(corpo),
  });
}

/** Parâmetro vigente por chave (`GET /api/parametros-metodo`) — `null` = nenhuma versão ativa. */
export function buscarParametrosVigentes(chaves: string[], uf?: string | null, municipio?: string | null): Promise<RespostaParametrosMetodo> {
  const busca = new URLSearchParams({ chaves: chaves.join(",") });
  if (uf) busca.set("uf", uf);
  if (municipio) busca.set("municipio", municipio);
  return chamar<RespostaParametrosMetodo>(`/api/parametros-metodo?${busca.toString()}`);
}

export const ROTULO_ERRO_CENARIO: Record<string, string> = {
  cenario_calculado_exige_parametro: "Para calcular, escolha uma alíquota cadastrada (Admin → Parâmetros). Sem parâmetro, digite o valor.",
  parametro_nao_e_percentual: "O parâmetro escolhido não é uma alíquota (percentual) — só alíquota multiplica a base.",
  parametro_inativo: "Esta alíquota foi desativada. Escolha a versão vigente em Admin → Parâmetros.",
  parametro_jurisdicao_incoerente: "A alíquota escolhida é de outra UF. Use a alíquota da UF do cliente (ou corrija a UF na Ficha).",
  cenario_invalido: "O banco recusou a combinação de procedência e valores. Confira o que foi digitado e tente de novo.",
  parametro_ausente: "Nenhuma alíquota cadastrada para esta rubrica — Admin → Parâmetros.",
};

export function rotularParametro(p: ParametroMetodo): string {
  const juris = [p.uf, p.municipio].filter(Boolean).join(" / ");
  return `${p.valor}% · v${p.versao}${juris ? ` · ${juris}` : ""}${p.base_legal ? ` · ${p.base_legal}` : ""}`;
}
