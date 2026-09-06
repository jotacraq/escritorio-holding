/** Números do funil por edição do seminário. */
import { chamar, paraQueryString } from "./nucleo";

export interface IndicadoresEdicao {
  edicao_id: string | null;
  edicao_codigo: string | null;
  edicao_nome: string | null;
  jornadas: number;
  sessoes_contratadas: number;
  sessoes_realizadas: number;
  croquis_contratados: number;
  holdings: number;
  formularios_respondidos: number;
  ligacoes_feitas: number;
}

export function buscarIndicadores(edicaoId?: string) {
  return chamar<{ itens: IndicadoresEdicao[] }>(`/api/indicadores${paraQueryString({ edicao_id: edicaoId })}`);
}
