import type { SupabaseClient } from "@supabase/supabase-js";
import { lerConfiguracoes } from "@/server/integracoes/config";

/**
 * As 7 chaves de `configuracoes['agente_whatsapp.*']` (0088), lidas de uma vez.
 *
 * REGRA DURA: `ativo` só é `true` quando a chave existe E vale exatamente
 * `true`. Chave ausente (0088 não aplicada), falha de leitura, valor de outro
 * tipo — tudo cai em `false`. O agente desligado é o default, e o default é o
 * estado seguro: o webhook continua GRAVANDO a mensagem e não responde nada.
 *
 * Os tetos têm padrão de código só para o caso de a chave sumir do banco; o
 * valor de verdade é o do banco, que o João muda em Admin sem deploy.
 */
export const CHAVE_ATIVO = "agente_whatsapp.ativo";
export const CHAVE_SILENCIO_HUMANO = "agente_whatsapp.silencio_humano_minutos";
export const CHAVE_ESQUIVAS = "agente_whatsapp.esquivas_ate_humano";
export const CHAVE_INTERVALO_LINK = "agente_whatsapp.intervalo_link_horas";
export const CHAVE_TETO_RESPOSTAS_HORA = "agente_whatsapp.teto_respostas_hora";
export const CHAVE_TETO_IA_JORNADA_DIA = "agente_whatsapp.teto_ia_jornada_dia";
export const CHAVE_TETO_IA_DIA = "agente_whatsapp.teto_ia_dia";

export const CHAVES_AGENTE = [
  CHAVE_ATIVO,
  CHAVE_SILENCIO_HUMANO,
  CHAVE_ESQUIVAS,
  CHAVE_INTERVALO_LINK,
  CHAVE_TETO_RESPOSTAS_HORA,
  CHAVE_TETO_IA_JORNADA_DIA,
  CHAVE_TETO_IA_DIA,
] as const;

export interface ConfigAgente {
  ativo: boolean;
  silencioHumanoMinutos: number;
  esquivasAteHumano: number;
  intervaloLinkHoras: number;
  tetoRespostasHora: number;
  tetoIaJornadaDia: number;
  tetoIaDia: number;
}

export const CONFIG_PADRAO: ConfigAgente = {
  ativo: false,
  silencioHumanoMinutos: 30,
  esquivasAteHumano: 2,
  intervaloLinkHoras: 6,
  tetoRespostasHora: 6,
  tetoIaJornadaDia: 10,
  tetoIaDia: 100,
};

function inteiroPositivo(valor: unknown, padrao: number): number {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : padrao;
}

/**
 * Zero é valor VÁLIDO nos dois tetos de IA: é como se desliga só a IA e se
 * mantém as respostas fixas. Ler `0` como "inválido, use o padrão 100" faria a
 * tela dizer uma coisa e o agente fazer outra — e ainda gastaria dinheiro.
 * (O schema de `server/admin/configuracoes.ts` aceita `min(0)` nestas duas.)
 */
function inteiroNaoNegativo(valor: unknown, padrao: number): number {
  const n = Number(valor);
  return Number.isInteger(n) && n >= 0 ? n : padrao;
}

/** Função pura: o mapa cru de `configuracoes` vira `ConfigAgente`. Testável sem banco. */
export function montarConfigAgente(bruto: Map<string, { valor: unknown }>): ConfigAgente {
  return {
    // `=== true` e não `Boolean(...)`: a string "false" do jsonb seria truthy.
    ativo: bruto.get(CHAVE_ATIVO)?.valor === true,
    silencioHumanoMinutos: inteiroPositivo(bruto.get(CHAVE_SILENCIO_HUMANO)?.valor, CONFIG_PADRAO.silencioHumanoMinutos),
    esquivasAteHumano: inteiroPositivo(bruto.get(CHAVE_ESQUIVAS)?.valor, CONFIG_PADRAO.esquivasAteHumano),
    intervaloLinkHoras: inteiroPositivo(bruto.get(CHAVE_INTERVALO_LINK)?.valor, CONFIG_PADRAO.intervaloLinkHoras),
    tetoRespostasHora: inteiroPositivo(bruto.get(CHAVE_TETO_RESPOSTAS_HORA)?.valor, CONFIG_PADRAO.tetoRespostasHora),
    tetoIaJornadaDia: inteiroNaoNegativo(bruto.get(CHAVE_TETO_IA_JORNADA_DIA)?.valor, CONFIG_PADRAO.tetoIaJornadaDia),
    tetoIaDia: inteiroNaoNegativo(bruto.get(CHAVE_TETO_IA_DIA)?.valor, CONFIG_PADRAO.tetoIaDia),
  };
}

export async function lerConfigAgente(admin: SupabaseClient): Promise<ConfigAgente> {
  try {
    const mapa = await lerConfiguracoes(admin, [...CHAVES_AGENTE]);
    return montarConfigAgente(mapa);
  } catch {
    // Falha de leitura NUNCA liga o agente: `ativo` continua false.
    return { ...CONFIG_PADRAO };
  }
}
