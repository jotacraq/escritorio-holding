/**
 * Rate limit em memória por chave (IP), igual ao do webhook Hotmart: vale para
 * uma instância Node (Hostinger Node App). Contém abuso grosseiro; não é
 * distribuído. Mapa limpo de tempos em tempos para não crescer sem teto.
 */
const LIMITE_ENTRADAS = 5_000;

interface Janela {
  contagem: number;
  expiraEm: number;
}

export function criarLimitador(limitePorMinuto: number) {
  const contador = new Map<string, Janela>();

  return function excedido(chave: string): boolean {
    const agora = Date.now();
    if (contador.size > LIMITE_ENTRADAS) {
      for (const [k, v] of contador) if (v.expiraEm < agora) contador.delete(k);
    }
    const entrada = contador.get(chave);
    if (!entrada || entrada.expiraEm < agora) {
      contador.set(chave, { contagem: 1, expiraEm: agora + 60_000 });
      return false;
    }
    entrada.contagem += 1;
    return entrada.contagem > limitePorMinuto;
  };
}

export function ipDaRequisicao(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "desconhecido";
}
