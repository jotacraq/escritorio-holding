/** Formulário Estratégico (POP 02). */
import { chamar } from "./nucleo";

export interface FormularioDefinicaoPergunta {
  id: string;
  bloco: string;
  tipo: "texto" | "texto_longo" | "unica" | "multipla" | "numero" | "sim_nao";
  rotulo: string;
  opcoes?: string[];
  obrigatoria?: boolean;
  /** Nomes de campo como gravados em `formularios.definicao` (ver seed 0016). */
  condicional?: { depende_de: string; contem?: string; igual?: string };
}

export interface Formulario {
  id: string;
  chave: string;
  versao: number;
  definicao: FormularioDefinicaoPergunta[];
}

export interface FormularioResposta {
  id: string;
  formulario_id: string;
  respostas: Record<string, unknown>;
  origem: "sistema" | "typeform" | "importado";
  respondido_em: string;
}

export interface FormularioComResposta {
  formulario: Formulario;
  resposta: FormularioResposta | null;
}

export function buscarFormulario(jornadaId: string) {
  return chamar<FormularioComResposta>(`/api/jornadas/${jornadaId}/formulario`);
}

export function salvarFormulario(jornadaId: string, payload: { formulario_id: string; respostas: Record<string, unknown> }) {
  return chamar<{ resposta: FormularioResposta }>(`/api/jornadas/${jornadaId}/formulario`, { method: "PUT", body: JSON.stringify(payload) });
}

// ---------------------------------------------------------------------------
// Admin → Formulário e roteiros (Fase 7 r3, migration 0078)
//
// Versionamento do POP 02: a aba do Admin LISTA versões, ABRE uma versão
// inteira, PUBLICA a versão N+1 e ATIVA a oficial. Nunca edita `definicao` de
// versão existente — a resposta de um cliente aponta para a versão em que foi
// dada, e reescrever por baixo quebraria essa leitura.
// ---------------------------------------------------------------------------

/** Opção com valor estável e rótulo humano (0078). Versões antigas guardam `string`. */
export interface OpcaoPergunta {
  valor: string;
  rotulo: string;
}

/**
 * Pergunta como o EDITOR do Admin a manipula: `opcoes` aceita os dois formatos
 * (texto solto = legado; `{valor, rotulo}` = 0078 em diante).
 *
 * `FormularioDefinicaoPergunta` (acima) continua declarando `opcoes?: string[]`
 * porque é o contrato HTTP do legado — mas nenhuma tela lê esse campo direto:
 * `CampoPerguntaPublico` e `ficha360/FormularioAba` já passam por
 * `normalizarOpcoes`, que aceita os dois formatos. Alargar o tipo aqui só
 * mudaria a assinatura de quem não o usa mais.
 */
export interface PerguntaVersionada extends Omit<FormularioDefinicaoPergunta, "opcoes"> {
  opcoes?: (string | OpcaoPergunta)[];
}

/** Metadado de versão — a lista NÃO traz `definicao` (payload pesado). */
export interface FormularioVersaoResumo {
  id: string;
  chave: string;
  versao: number;
  ativo: boolean;
  criado_em: string;
  titulo?: string | null;
  notas?: string | null;
  criado_por?: string | null;
  /** Quem carimbou como oficial, e quando. Nulo nas versões anteriores à 0078. */
  ativado_por?: string | null;
  ativado_em?: string | null;
}

export interface FormularioVersao extends FormularioVersaoResumo {
  definicao: PerguntaVersionada[];
}

export interface PublicarFormularioPayload {
  chave: string;
  titulo?: string | null;
  definicao: PerguntaVersionada[];
  notas?: string | null;
  /** `true` publica JÁ ativando (desativa a anterior na mesma transação). */
  ativar: boolean;
}

export function listarVersoesFormulario() {
  return chamar<{ itens: FormularioVersaoResumo[] }>("/api/formularios");
}

export function buscarVersaoFormulario(id: string) {
  return chamar<{ formulario: FormularioVersao }>(`/api/formularios/${id}`);
}

/**
 * 400 com `detalhes: [{codigo, pergunta, mensagem}]` quando a definição não
 * passa; 422 `pergunta_de_sistema_removida` quando some `p1`/`p2`/`p9`/`p16`;
 * 409 quando outra publicação correu junto; 503 `migracao_pendente` quando a
 * 0078 não está aplicada.
 */
export function publicarVersaoFormulario(payload: PublicarFormularioPayload) {
  return chamar<{ formulario: FormularioVersao }>("/api/formularios", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function ativarVersaoFormulario(id: string) {
  return chamar<{ formulario: FormularioVersao }>(`/api/formularios/${id}/ativar`, { method: "POST" });
}
