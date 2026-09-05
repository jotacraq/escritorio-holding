import { ApiError, chamar } from "@/lib/api";
import type { CroquiNarrativa } from "@/server/ia/schema-croqui-narrativa";

/**
 * Cliente de `GET|POST /api/croquis/[id]/narrativa` — as notas do apresentador.
 *
 * O motor calcula as 19 tabelas; à IA sobra narrar (§6.1). Enquanto o prompt
 * da narrativa está inativo, o `GET` devolve `ativo: false` e o `POST` falha
 * FECHADO com 409 `narrativa_inativa` — a tela usa o `ativo` para NÃO oferecer
 * um botão que só devolveria erro, e rotula a ausência com `SeloStub`.
 *
 * Repare na assimetria do contrato (rota de F1): o `GET` devolve a LINHA
 * gravada (`narrativa.conteudo` é o texto), o `POST` devolve o conteúdo
 * direto. `conteudoDaNarrativa` é o único lugar que sabe disso.
 */

/** Linha de `croqui_narrativas` como o `GET` a devolve. */
export interface NarrativaGravada {
  id: string;
  croqui_id: string;
  versao: number;
  conteudo: CroquiNarrativa;
  grau_confianca: number | null;
  schema_versao: number;
  origem_dado: string;
  criado_em: string;
}

export interface RespostaNarrativa {
  narrativa: NarrativaGravada | null;
  /** `false` = prompt ainda não liberado pela bancada. */
  ativo: boolean;
}

export interface RespostaGerarNarrativa {
  execucao_id: string;
  narrativa_id: string;
  narrativa: CroquiNarrativa;
  custo_usd: number | null;
}

export function buscarNarrativaCroqui(croquiId: string): Promise<RespostaNarrativa> {
  return chamar<RespostaNarrativa>(`/api/croquis/${croquiId}/narrativa`);
}

export function gerarNarrativaCroqui(croquiId: string): Promise<RespostaGerarNarrativa> {
  return chamar<RespostaGerarNarrativa>(`/api/croquis/${croquiId}/narrativa`, { method: "POST" });
}

/** 409 do prompt desligado — não é falha de rede nem culpa de quem clicou. */
export function narrativaInativa(erro: unknown): boolean {
  return erro instanceof ApiError && erro.codigo === "narrativa_inativa";
}

/**
 * A narrativa é um EXTRA da apresentação: prompt inativo, cálculo sem versão
 * fixada ou rede ruim devolvem `null` e o deck abre igual, com as frases do
 * método nas notas. Só o botão de gerar mostra erro — quem projetou não pode
 * ver um alerta na cara da família.
 */
export function buscarNarrativaOpcional(croquiId: string): Promise<CroquiNarrativa | null> {
  return buscarNarrativaCroqui(croquiId)
    .then((r) => r.narrativa?.conteudo ?? null)
    .catch(() => null);
}
