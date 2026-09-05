/**
 * Teto de exportação por usuário. Montar um `.docx` de 19 tabelas custa CPU no
 * mesmo processo que serve as telas — sem teto, um clique preso ou um laço no
 * front derruba o Node App da Hostinger, que roda em UM processo.
 *
 * Em memória de propósito: o deploy é processo único (`output: 'standalone'`,
 * sem Edge, sem serverless) e o repositório não tem Redis. Reiniciou, zerou —
 * aceitável para um teto anti-abuso interno, já que a rota exige sessão de
 * admin/advogada antes de chegar aqui. Se um dia houver mais de um processo,
 * isto vira uma tabela ou um contador no Postgres.
 */

interface Janela {
  ate: number;
  usos: number;
}

const JANELAS = new Map<string, Janela>();
/** Teto de segurança da memória: 5 mil chaves é muito mais que a equipe inteira. */
const MAX_CHAVES = 5000;

export interface ResultadoLimite {
  permitido: boolean;
  /** Segundos até a janela virar — vira `Retry-After` no 429. */
  esperarSegundos: number;
}

/**
 * @param chave  identificador do balde (perfil + operação); NUNCA e-mail ou nome.
 * @param teto   quantas vezes por janela.
 * @param janelaMs tamanho da janela.
 */
export function consumir(chave: string, teto: number, janelaMs: number): ResultadoLimite {
  const agora = Date.now();

  if (JANELAS.size > MAX_CHAVES) {
    for (const [k, v] of JANELAS) if (v.ate <= agora) JANELAS.delete(k);
    // Ainda cheio depois da limpeza: a memória vale mais que a precisão do teto.
    if (JANELAS.size > MAX_CHAVES) JANELAS.clear();
  }

  const atual = JANELAS.get(chave);
  if (!atual || atual.ate <= agora) {
    JANELAS.set(chave, { ate: agora + janelaMs, usos: 1 });
    return { permitido: true, esperarSegundos: 0 };
  }

  if (atual.usos >= teto) {
    return { permitido: false, esperarSegundos: Math.max(1, Math.ceil((atual.ate - agora) / 1000)) };
  }

  atual.usos += 1;
  return { permitido: true, esperarSegundos: 0 };
}

/** Só para teste de mesa — a rota nunca chama. */
export function zerarLimites(): void {
  JANELAS.clear();
}
