/**
 * Direitos do titular (LGPD art. 18) — cliente HTTP da aba do Admin.
 *
 * Todas as rotas são `admin`. A exportação NÃO passa por `chamar`: a resposta é
 * um arquivo (JSON ou PDF), não JSON de contrato — quem baixa precisa do
 * `Blob` e do `X-Solicitacao-Id` do cabeçalho, que é o número do protocolo que
 * a tela mostra depois.
 */
import { ApiError, chamar } from "./nucleo";
import {
  CANAIS_PEDIDO_TITULAR,
  type CanalPedidoTitular,
  type InventarioTitular,
  type RespostaAnonimizacao,
  type SolicitacaoTitular,
} from "@/types/lgpd";

/**
 * Os contratos moram em `@/types/lgpd` — este arquivo REEXPORTA, não redeclara.
 *
 * Até a rodada 3 havia duas cópias das mesmas 6 formas, e elas já tinham
 * divergido: `storage_removido` (a trilha do expurgo, 0081) existia só no lado
 * do servidor, então a tela do Admin não sabia que ela existe. Duas cópias de
 * um contrato é o contrato já divergindo — a de cá some, a de `@/types` fica.
 */
export { CANAIS_PEDIDO_TITULAR };
export type {
  CanalPedidoTitular,
  DocumentoDoTitular,
  InventarioTitular,
  LinhaInventario,
  /** Inclui `storage_removido`, que a cópia local não tinha. */
  ResultadoSolicitacao,
  RespostaAnonimizacao,
  SolicitacaoTitular,
  TipoSolicitacaoTitular,
} from "@/types/lgpd";

/**
 * O que a TELA preenche antes de exportar ou encerrar. Não é contrato de
 * resposta do servidor (por isso não está em `@/types/lgpd`): é o corpo que
 * esta camada monta e envia.
 */
export interface PedidoDoTitular {
  motivo: string;
  base_legal: string;
  canal_pedido: CanalPedidoTitular;
  solicitado_em: string;
}

export function buscarInventarioTitular(pessoaId: string) {
  return chamar<InventarioTitular>(`/api/admin/titulares/${pessoaId}/inventario`);
}

export interface ArquivoExportado {
  blob: Blob;
  nomeArquivo: string;
  solicitacaoId: string | null;
}

/**
 * Baixa o dossiê. O REGISTRO é gravado no servidor antes de o arquivo sair —
 * não existe exportação sem rastro de quem a tirou.
 */
export async function exportarDadosDoTitular(
  pessoaId: string,
  pedido: PedidoDoTitular & { formato: "json" | "pdf" },
): Promise<ArquivoExportado> {
  const resposta = await fetch(`/api/admin/titulares/${pessoaId}/exportacoes`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(pedido),
  });

  if (!resposta.ok) {
    const corpo = (await resposta.json().catch(() => null)) as { erro?: string; mensagem?: string } | null;
    throw new ApiError(
      corpo?.mensagem || `Falha ao exportar (${resposta.status})`,
      resposta.status,
      corpo?.erro,
    );
  }

  const disposicao = resposta.headers.get("Content-Disposition") ?? "";
  const casado = /filename="([^"]+)"/.exec(disposicao);
  return {
    blob: await resposta.blob(),
    nomeArquivo: casado?.[1] ?? `dossie-${pessoaId}.${pedido.formato}`,
    solicitacaoId: resposta.headers.get("X-Solicitacao-Id"),
  };
}

/**
 * Encerra o tratamento. Irreversível.
 *
 * `confirmacao_nome` precisa ser igual ao nome cadastrado — conferido no
 * SERVIDOR (422 `confirmacao_nao_confere`), não só na tela. Outros 422:
 * `origem_dado_exemplo`, `titular_com_login`, `holding_em_execucao`.
 */
export function anonimizarTitular(pessoaId: string, pedido: PedidoDoTitular & { confirmacao_nome: string }) {
  return chamar<RespostaAnonimizacao>(`/api/admin/titulares/${pessoaId}/anonimizacao`, {
    method: "POST",
    body: JSON.stringify(pedido),
  });
}

/** Retomada do expurgo de arquivos quando o Storage falhou. Idempotente. */
export function concluirExpurgoTitular(pessoaId: string, solicitacaoId: string) {
  return chamar<{ solicitacao: SolicitacaoTitular; removidos: number; falhos: string[] }>(
    `/api/admin/titulares/${pessoaId}/anonimizacao/expurgo`,
    { method: "POST", body: JSON.stringify({ solicitacao_id: solicitacaoId }) },
  );
}
