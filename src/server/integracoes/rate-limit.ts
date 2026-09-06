/**
 * Rate limit em memória por chave, igual ao do webhook Hotmart: vale para
 * uma instância Node (Hostinger Node App). Contém abuso grosseiro; não é
 * distribuído. Mapa limpo de tempos em tempos para não crescer sem teto.
 *
 * Duas portas, o MESMO contador por baixo:
 * - `criarLimitador(n)` — janela fixa de 1 minuto, resposta booleana. É o que
 *   os webhooks usam (chave = IP), e continua idêntico.
 * - `criarLimitadorJanela(n, ms)` — janela de duração livre e resposta com o
 *   `tenteEmS`, para rota autenticada que precisa devolver 429 com
 *   `Retry-After` (achado do pentest da Fase 6 sobre emissão de link).
 */
const LIMITE_ENTRADAS = 5_000;

interface Janela {
  contagem: number;
  expiraEm: number;
}

export interface VeredictoLimite {
  excedido: boolean;
  /** Segundos até a janela virar. `0` quando não excedeu — nada a esperar. */
  tenteEmS: number;
}

/**
 * Núcleo comum. Janela FIXA (não deslizante): a primeira chamada abre a
 * janela, e `expiraEm` é o instante em que a contagem zera. Deslizante exigiria
 * guardar o timestamp de cada chamada — memória por usuário que não se paga
 * num limitador cuja função é conter abuso grosseiro, não medir vazão.
 */
function criarContador(limite: number, janelaMs: number) {
  const contador = new Map<string, Janela>();

  return function registrar(chave: string): VeredictoLimite {
    const agora = Date.now();
    if (contador.size > LIMITE_ENTRADAS) {
      for (const [k, v] of contador) if (v.expiraEm < agora) contador.delete(k);
    }
    const entrada = contador.get(chave);
    if (!entrada || entrada.expiraEm < agora) {
      contador.set(chave, { contagem: 1, expiraEm: agora + janelaMs });
      return { excedido: false, tenteEmS: 0 };
    }
    entrada.contagem += 1;
    const excedido = entrada.contagem > limite;
    // `Math.ceil` para nunca devolver 0 num 429: "tente em 0 s" convida o
    // cliente a repetir na hora e a tomar outro 429.
    return { excedido, tenteEmS: excedido ? Math.max(1, Math.ceil((entrada.expiraEm - agora) / 1000)) : 0 };
  };
}

export function criarLimitador(limitePorMinuto: number) {
  const registrar = criarContador(limitePorMinuto, 60_000);
  return function excedido(chave: string): boolean {
    return registrar(chave).excedido;
  };
}

/**
 * Limitador com janela própria e `tenteEmS` — para rota autenticada, onde a
 * chave é o PERFIL (`perfis_equipe.id`), não o IP: a equipe da Dra. Elaine
 * trabalha atrás de um único IP de escritório, e limitar por IP puniria a
 * sala inteira pelo excesso de uma pessoa. O IP entra só como desempate
 * quando não há usuário (não é o caso das rotas que usam isto hoje).
 */
export function criarLimitadorJanela(limite: number, janelaMs: number) {
  return criarContador(limite, janelaMs);
}

export function ipDaRequisicao(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "desconhecido";
}
