/**
 * Patrimônio (admin/advogada apenas — servidor nega o resto) e composição
 * familiar (operacional: toda a equipe lê, ao contrário do patrimônio).
 */
import { chamar } from "./nucleo";

export interface PatrimonioItem {
  id: string;
  tipo: "imovel" | "veiculo" | "investimento" | "previdencia" | "empresa" | "outro";
  descricao: string;
  ano_aquisicao: number | null;
  valor_historico: number | null;
  valor_mercado: number | null;
  destinacao: string | null;
  valor_locacao_mensal: number | null;
  detalhes: Record<string, unknown>;
}

export interface Familiar {
  id: string;
  pessoa_id: string;
  parentesco: string;
  nome: string | null;
  idade: number | null;
  ocupacao: string | null;
  regime_casamento: string | null;
  dependente_financeiro: boolean | null;
  observacoes: string | null;
}

export function listarFamiliares(jornadaId: string) {
  return chamar<{ familiares: Familiar[] }>(`/api/jornadas/${jornadaId}/familiares`);
}
export function adicionarFamiliar(jornadaId: string, familiar: Omit<Familiar, "id" | "pessoa_id">) {
  return chamar<{ familiar: Familiar }>(`/api/jornadas/${jornadaId}/familiares`, { method: "POST", body: JSON.stringify(familiar) });
}

export function listarPatrimonio(jornadaId: string) {
  return chamar<{ itens: PatrimonioItem[] }>(`/api/jornadas/${jornadaId}/patrimonio`);
}
export function criarPatrimonio(jornadaId: string, item: Omit<PatrimonioItem, "id">) {
  return chamar<{ item: PatrimonioItem }>(`/api/jornadas/${jornadaId}/patrimonio`, { method: "POST", body: JSON.stringify(item) });
}
export function atualizarPatrimonio(itemId: string, item: Partial<PatrimonioItem>) {
  return chamar<{ item: PatrimonioItem }>(`/api/patrimonio/${itemId}`, { method: "PUT", body: JSON.stringify(item) });
}
export function excluirPatrimonio(itemId: string) {
  return chamar<{ ok: boolean }>(`/api/patrimonio/${itemId}`, { method: "DELETE" });
}
