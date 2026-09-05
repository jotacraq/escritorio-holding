/**
 * Camada de acesso às rotas de `/api/admin/**` (B-2B + Fase 4).
 *
 * Núcleo HTTP em `./http.ts` (compartilhado com a tela Comunicação). Aqui só
 * vive o mapa rota → tipo. `ApiError` é importada de `src/lib/api.ts` (não
 * editada) para reaproveitar o tratamento de erro do resto do app.
 *
 * `chamarBruto` só aparece no convite de equipe, onde um 503 é resultado de
 * NEGÓCIO esperado ("linha criada, e-mail indisponível" — CONFLITO C15).
 */

import type {
  ConfiguracaoAdmin,
  CustoIaResposta,
  EdicaoSeminario,
  MensagemTemplateAdmin,
  PapelEquipe,
  PendenciasResposta,
  PerfilEquipeAdmin,
  ProdutoAdmin,
  PromptVersaoAdmin,
  PromptVersaoResumo,
  ResultadoConviteEmail,
} from "@/types/admin";
import type { ChaveIntegracao, RespostaIntegracoes, ResultadoTesteIntegracao } from "@/types/integracoes";
import type { CorpoCriarParametro, ParametroMetodo, RespostaAdminParametros } from "@/types/cenario";
import type {
  CorpoCriarMaterialModelo,
  CorpoEditarMaterialModelo,
  RespostaListarMateriaisModelos,
  RespostaMaterialModelo,
} from "@/types/material";
import { chamar, chamarBruto, erroDaResposta } from "./http";

// ---------------------------------------------------------------------------
// Equipe
// ---------------------------------------------------------------------------

export function listarEquipe() {
  return chamar<{ itens: PerfilEquipeAdmin[] }>("/api/admin/equipe");
}

export interface ResultadoConvite {
  perfil: PerfilEquipeAdmin;
  convite: ResultadoConviteEmail;
}

/**
 * POST /api/admin/equipe — trata 503 (`convite_email_indisponivel`) como
 * resultado de negócio, não erro: a linha em `perfis_equipe` FOI criada
 * (vem em `detalhes.perfil`), só o e-mail não saiu. Qualquer outro status
 * de erro (409 e-mail já convidado, 422 validação) segue lançando `ApiError`.
 */
export async function criarConviteEquipe(payload: { email: string; nome: string; papel: PapelEquipe }): Promise<ResultadoConvite> {
  const { status, corpo } = await chamarBruto<{ perfil: PerfilEquipeAdmin; convite?: ResultadoConviteEmail; detalhes?: { perfil?: PerfilEquipeAdmin } }>(
    "/api/admin/equipe",
    { method: "POST", body: JSON.stringify(payload) },
  );

  if (status === 503) {
    const perfil = corpo?.detalhes?.perfil;
    if (perfil) {
      return { perfil, convite: { enviado: false, motivo: "service_role_ausente" } };
    }
  }

  if (status < 200 || status >= 300) throw erroDaResposta(status, corpo);

  return { perfil: corpo!.perfil, convite: corpo!.convite ?? { enviado: true } };
}

export function atualizarPerfilEquipe(id: string, patch: { ativo?: boolean; papel?: PapelEquipe; nome?: string }) {
  return chamar<{ perfil: PerfilEquipeAdmin }>(`/api/admin/equipe/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

/** POST /api/admin/equipe/[id]/convite — mesmo tratamento de 503 que `criarConviteEquipe`. */
export async function reenviarConviteEquipe(id: string, perfilAtual: PerfilEquipeAdmin): Promise<ResultadoConvite> {
  const { status, corpo } = await chamarBruto<{ perfil?: PerfilEquipeAdmin; convite?: ResultadoConviteEmail; detalhes?: { perfil?: PerfilEquipeAdmin } }>(
    `/api/admin/equipe/${id}/convite`,
    { method: "POST" },
  );

  if (status === 503) {
    return { perfil: corpo?.detalhes?.perfil ?? perfilAtual, convite: { enviado: false, motivo: "service_role_ausente" } };
  }

  if (status < 200 || status >= 300) throw erroDaResposta(status, corpo);

  return { perfil: corpo?.perfil ?? perfilAtual, convite: corpo?.convite ?? { enviado: true } };
}

// ---------------------------------------------------------------------------
// Produtos
// ---------------------------------------------------------------------------

export function listarProdutos() {
  return chamar<{ itens: ProdutoAdmin[] }>("/api/admin/produtos");
}

export function criarProduto(payload: { tipo: ProdutoAdmin["tipo"]; nome: string; hotmart_produto_id?: string | null; url_checkout?: string | null }) {
  return chamar<{ produto: ProdutoAdmin }>("/api/admin/produtos", { method: "POST", body: JSON.stringify(payload) });
}

export function atualizarProduto(
  id: string,
  patch: { nome?: string; hotmart_produto_id?: string | null; url_checkout?: string | null; ativo?: boolean },
) {
  return chamar<{ produto: ProdutoAdmin }>(`/api/admin/produtos/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

// ---------------------------------------------------------------------------
// Templates de mensagem — sempre versão nova, nunca edita a em uso
// ---------------------------------------------------------------------------

export function listarTemplates() {
  return chamar<{ itens: MensagemTemplateAdmin[] }>("/api/admin/templates");
}

export function criarTemplateVersao(payload: {
  chave: string;
  canal: MensagemTemplateAdmin["canal"];
  assunto?: string | null;
  corpo: string;
  ativar: boolean;
}) {
  return chamar<{ template: MensagemTemplateAdmin }>("/api/admin/templates", { method: "POST", body: JSON.stringify(payload) });
}

export function ativarTemplate(id: string) {
  return chamar<{ template: MensagemTemplateAdmin }>(`/api/admin/templates/${id}/ativar`, { method: "POST" });
}

// ---------------------------------------------------------------------------
// Versões de prompt — sempre versão nova, nunca edita a em uso
// ---------------------------------------------------------------------------

export function listarPrompts() {
  return chamar<{ itens: PromptVersaoResumo[] }>("/api/admin/prompts");
}

export function buscarPrompt(id: string) {
  return chamar<{ prompt: PromptVersaoAdmin }>(`/api/admin/prompts/${id}`);
}

export function criarPromptVersao(payload: {
  chave: string;
  titulo: string;
  corpo_sistema: string;
  modelo_padrao: string;
  effort: PromptVersaoAdmin["effort"];
  notas?: string | null;
  ativar: boolean;
}) {
  return chamar<{ prompt: PromptVersaoAdmin }>("/api/admin/prompts", { method: "POST", body: JSON.stringify(payload) });
}

export function ativarPrompt(id: string) {
  return chamar<{ prompt: PromptVersaoAdmin }>(`/api/admin/prompts/${id}/ativar`, { method: "POST" });
}

// ---------------------------------------------------------------------------
// Edições de seminário
// ---------------------------------------------------------------------------

export function listarEdicoes() {
  return chamar<{ itens: EdicaoSeminario[] }>("/api/admin/edicoes");
}

export function criarEdicao(payload: { codigo: string; nome: string; inicio_em: string; fim_em: string }) {
  return chamar<{ edicao: EdicaoSeminario }>("/api/admin/edicoes", { method: "POST", body: JSON.stringify(payload) });
}

export function atualizarEdicao(id: string, patch: { nome?: string; inicio_em?: string; fim_em?: string; ativa?: boolean }) {
  return chamar<{ edicao: EdicaoSeminario }>(`/api/admin/edicoes/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

// ---------------------------------------------------------------------------
// Configurações — só UPDATE de chave existente
// ---------------------------------------------------------------------------

export function listarConfiguracoes() {
  return chamar<{ itens: ConfiguracaoAdmin[] }>("/api/admin/configuracoes");
}

export function atualizarConfiguracao(chave: string, valor: unknown) {
  return chamar<{ configuracao: ConfiguracaoAdmin }>(`/api/admin/configuracoes/${encodeURIComponent(chave)}`, {
    method: "PATCH",
    body: JSON.stringify({ valor }),
  });
}

// ---------------------------------------------------------------------------
// Custo de IA — admin/advogada (mesmo recorte de quem vê patrimônio)
// ---------------------------------------------------------------------------

export function buscarCustoIa() {
  return chamar<CustoIaResposta>("/api/admin/custo-ia");
}

// ---------------------------------------------------------------------------
// Pendências — a fila, não painel de leitura
// ---------------------------------------------------------------------------

export function buscarPendencias() {
  return chamar<PendenciasResposta>("/api/admin/pendencias");
}

export function reprocessarWebhook(id: string) {
  return chamar<{ ok: boolean }>(`/api/admin/webhooks/${id}/reprocessar`, { method: "POST" });
}

export function reenfileirarMensagem(id: string) {
  return chamar<{ mensagem: unknown }>(`/api/admin/mensagens/${id}/reenfileirar`, { method: "POST" });
}

// ---------------------------------------------------------------------------
// Integrações (Fase 4 §2.6) — estado por variável (só nomes) + "Testar"
// ---------------------------------------------------------------------------

export function listarIntegracoes() {
  return chamar<RespostaIntegracoes>("/api/admin/integracoes");
}

export function testarIntegracao(chave: ChaveIntegracao) {
  return chamar<ResultadoTesteIntegracao>(`/api/admin/integracoes/${chave}/testar`, { method: "POST" });
}

// ---------------------------------------------------------------------------
// Parâmetros do método (0056) — versionado; valor nunca é editado, só versão nova
// ---------------------------------------------------------------------------

export function listarParametros(filtro: { chave?: string; prefixo?: string } = {}) {
  const query = new URLSearchParams();
  if (filtro.chave) query.set("chave", filtro.chave);
  if (filtro.prefixo) query.set("prefixo", filtro.prefixo);
  const sufixo = query.toString();
  return chamar<RespostaAdminParametros>(`/api/admin/parametros${sufixo ? `?${sufixo}` : ""}`);
}

export function criarParametro(corpo: CorpoCriarParametro) {
  return chamar<{ parametro: ParametroMetodo }>("/api/admin/parametros", { method: "POST", body: JSON.stringify(corpo) });
}

export function ativarParametro(id: string) {
  return chamar<{ parametro: ParametroMetodo }>(`/api/admin/parametros/${id}/ativar`, { method: "POST" });
}

// ---------------------------------------------------------------------------
// Modelos de material (0055) — catálogo por dor/arquétipo
// ---------------------------------------------------------------------------

export function listarMateriaisModelos() {
  return chamar<RespostaListarMateriaisModelos>("/api/admin/materiais-modelos");
}

export function criarMaterialModeloVersao(corpo: CorpoCriarMaterialModelo) {
  return chamar<RespostaMaterialModelo>("/api/admin/materiais-modelos", { method: "POST", body: JSON.stringify(corpo) });
}

export function editarMaterialModelo(id: string, patch: CorpoEditarMaterialModelo) {
  return chamar<RespostaMaterialModelo>(`/api/admin/materiais-modelos/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}
