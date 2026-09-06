/**
 * Decisão de anonimização — parte PURA.
 *
 * As mesmas três travas que a RPC `anonimizar_titular` (0080) aplica dentro da
 * transação, avaliadas ANTES de chamá-la para que a tela receba 422 com texto
 * humano em vez de um `raise` cru do Postgres — e para que a tela consiga
 * esconder o botão em vez de oferecer um beco sem saída.
 *
 * A trava real continua sendo a do banco: esta função é conveniência de UX e
 * porta de entrada, nunca a única barreira (a rota chama a RPC de qualquer
 * jeito, e a RPC recusa de novo).
 *
 * Sem rede, sem Supabase. Testado em `anonimizacao.test.ts`.
 */

export interface PessoaParaAnonimizar {
  id: string;
  nome: string;
  origem_dado: "real" | "exemplo";
  auth_user_id: string | null;
  anonimizada_em: string | null;
}

export interface JornadaParaAnonimizar {
  etapa: string;
  desfecho: string;
}

export interface Impedimento {
  /** Mesmo prefixo do `raise exception` da RPC — a tela casa os dois. */
  codigo: string;
  mensagem: string;
}

/**
 * `null` = pode anonimizar. Ordem igual à da RPC, para que o código devolvido
 * aqui seja o mesmo que o banco devolveria.
 */
export function impedimentoParaAnonimizar(
  pessoa: PessoaParaAnonimizar,
  jornadas: JornadaParaAnonimizar[],
): Impedimento | null {
  if (pessoa.origem_dado === "exemplo") {
    return {
      codigo: "origem_dado_exemplo",
      mensagem:
        "Esta pessoa é dado de demonstração, não um titular real. Anonimizá-la quebraria a apresentação do sistema.",
    };
  }
  if (pessoa.auth_user_id) {
    return {
      codigo: "titular_com_login",
      mensagem: "Esta pessoa tem conta de acesso ao sistema. A conta precisa ser tratada antes.",
    };
  }
  if (jornadas.some((j) => j.etapa === "holding_contratada" && j.desfecho === "aberta")) {
    return {
      codigo: "holding_em_execucao",
      mensagem:
        "Há holding contratada em execução para este titular. Enquanto o contrato roda, o escritório precisa dos dados para executá-lo.",
    };
  }
  return null;
}

/**
 * Confirmação por nome digitado. Conferida no SERVIDOR porque tela se burla:
 * `curl` na rota tem de esbarrar na mesma trava.
 *
 * Compara depois de `trim` e de colapsar espaço repetido — quem digita "Maria
 * Silva" com dois espaços não está errando o nome. Acento e maiúscula CONTAM:
 * é uma confirmação deliberada de ato irreversível, não um campo de busca.
 */
export function confirmacaoNomeConfere(nomeReal: string, digitado: unknown): boolean {
  if (typeof digitado !== "string") return false;
  const normalizar = (s: string) => s.replace(/\s+/g, " ").trim();
  const alvo = normalizar(nomeReal);
  if (!alvo) return false;
  return normalizar(digitado) === alvo;
}
