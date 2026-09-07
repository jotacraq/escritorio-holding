import { z } from "zod";
import type { ConfiguracaoChave, ConfiguracaoChaveSomenteLeitura } from "@/types/admin";

/**
 * `configuracoes` (0027) nega INSERT/DELETE de propósito: chave nova é
 * migration, nunca escrita livre pela tela — evita "chave fantasma" que
 * nenhum código lê. A rota (`PATCH /api/admin/configuracoes/[chave]`) só
 * aceita UPDATE de uma das chaves abaixo, e valida o FORMATO do `valor`
 * contra o schema exato desta chave — nunca aceita jsonb arbitrário.
 *
 * Os limites (`.max(...)`) não vêm do método (nenhum POP define teto de
 * cooldown ou de slots) — são sanidade operacional para impedir um valor
 * digitado errado de travar o sistema (ex.: `agenda.duracao_padrao_minutos`
 * em 0 ou 100000). BLOQUEIO B12 do plano: os PADRÕES em si não vêm do método.
 *
 * Fase 4: as chaves de integração (`sala.provedor`, `regua.canal_whatsapp`,
 * `ligacao_ia.*`) e do método (`material.*`, `cenario.rubricas`,
 * `croqui.exige_revisao_para_pronto`) entram com o mesmo rigor — enum fechado
 * onde o servidor lê por nome (`server/integracoes/config.ts`).
 */
export const SCHEMAS_CONFIGURACAO: Record<ConfiguracaoChave, z.ZodType> = {
  "link.validade_dias": z
    .object({
      formulario: z.number().int().positive().max(365),
      agendamento: z.number().int().positive().max(365),
      documentos: z.number().int().positive().max(365),
      material: z.number().int().positive().max(365),
    })
    .strict(),
  "link.limite_por_minuto": z.number().int().positive().max(1000),
  "link.limite_por_dia": z.number().int().positive().max(100_000),
  // 0028 — teto somando TODOS os tokens por rota pública. Existia no banco
  // desde a 0028 e NUNCA esteve aqui: a tela mostrava o campo e o "Salvar"
  // respondia 404. Mesmo defeito que a 0075 trouxe de novo (abaixo).
  "link.limite_global_por_minuto": z.number().int().positive().max(100_000),
  // 0075 — arquivos por link de documentos. Lido por
  // `app.limite_arquivos_por_link()`; fora de 1..50 (ou ausente) vale 10.
  // O teto de 50 é o MESMO da função no banco — mudar um sem o outro faria a
  // tela aceitar um número que a RPC ignora.
  "link.limite_arquivos": z.number().int().min(1).max(50),
  "ia.cooldown_segundos": z.number().int().min(0).max(86_400),
  "ia.teto_execucoes_dia_por_usuario": z.number().int().positive().max(1000),
  "agenda.duracao_padrao_minutos": z.number().int().positive().max(600),
  "agenda.slots_ofertados_ao_cliente": z.number().int().positive().max(50),
  // 0049 — trava dos 13 slides revisados antes de `pronto` (desligada por decisão de 04/09).
  "croqui.exige_revisao_para_pronto": z.boolean(),
  // 0052 — sala de reunião: "manual" (cola o link na Ficha) | "n8n" (webhook assinado).
  "sala.provedor": z.enum(["manual", "n8n"]),
  // 0054 — WhatsApp da régua: "manual" (fila de copiar) | "chatwoot" (API).
  "regua.canal_whatsapp": z.enum(["manual", "chatwoot"]),
  // 0053 — ligação por IA. `automatica=false` até decisão LGPD (B33).
  "ligacao_ia.provedor": z.enum(["manual", "n8n"]),
  "ligacao_ia.automatica": z.boolean(),
  "ligacao_ia.max_tentativas": z.number().int().min(0).max(10),
  "ligacao_ia.intervalo_retentativa_minutos": z.number().int().positive().max(10_080),
  "ligacao_ia.timeout_minutos": z.number().int().positive().max(240),
  // 0073 — janela de discagem. `dias`: 0 = domingo … 6 = sábado; `inicio`/`fim`
  // em "HH:MM" no `fuso` (IANA). `fim` > `inicio` é conferido aqui e não só na
  // leitura: uma janela impossível salva pela tela viraria "nunca liga" em
  // silêncio. Ver `server/ligacao-ia/janela.ts`.
  "ligacao_ia.janela": z
    .object({
      dias: z.array(z.number().int().min(0).max(6)).min(1).max(7),
      inicio: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "use HH:MM (24 h)"),
      fim: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "use HH:MM (24 h)"),
      fuso: z.string().trim().min(1).max(64),
    })
    .strict()
    .refine((j) => j.fim > j.inicio, { message: "o fim tem de ser depois do início" })
    .refine((j) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: j.fuso });
        return true;
      } catch {
        return false;
      }
    }, { message: "fuso horário desconhecido (use um IANA, ex.: America/Sao_Paulo)" }),
  // 0073 — retenção de voz. `null` = NÃO expurga (é o valor semeado pela
  // migration, `'null'::jsonb`; a decisão de minimização é jurídica, B19).
  // Teto de 5 anos: acima disso é "guardar para sempre" com outro nome.
  //
  // O `0` também vale "desligado" e é o que a TELA envia: `configuracoes.valor`
  // é `jsonb NOT NULL` (0027:152) e o PostgREST traduz um `null` do corpo para
  // SQL NULL, que a coluna recusa (23502). `lerConfiguracaoInteiroOuNulo`
  // trata `0`, `null` e chave ausente exatamente igual: não expurga.
  "ligacao_ia.retencao_dias": z.number().int().min(0).max(1825).nullable(),
  // 0055 — material pós-sessão em PDF.
  "material.anexar_pdf": z.boolean(),
  "material.rodape_juridico": z.string().trim().min(1).max(2000),
  // 0057 — rubricas de UI do Cenário Patrimonial (B37). Mesmo alfabeto de `cenario_rubricas.rubrica`.
  "cenario.rubricas": z
    .array(z.string().regex(/^[a-z][a-z0-9_]{1,40}$/, "rubrica: minúsculas, dígitos e _"))
    .min(1)
    .max(20),
  // 0088 — agente de WhatsApp de onboarding.
  //
  // `ativo` é o interruptor: `false` é o valor semeado e o estado seguro (o
  // webhook grava a mensagem e não responde nada). Sem estes 7 schemas o
  // `PATCH /api/admin/configuracoes/[chave]` respondia 404 e o botão do Admin
  // não salvava — mesmo defeito que `link.limite_global_por_minuto` e
  // `link.limite_arquivos` já tiveram: chave existe no banco, some daqui.
  "agente_whatsapp.ativo": z.boolean(),
  // Silêncio depois que um humano fala, e duração da pausa de "Assumir
  // conversa". `min(1)`: zero equivaleria a "o robô volta a falar por cima do
  // humano no segundo seguinte", que é o defeito que a trava veio evitar.
  // 8 h de teto: acima disso é desligar o agente, e para isso existe `ativo`.
  "agente_whatsapp.silencio_humano_minutos": z.number().int().min(1).max(480),
  // Quantas vezes devolve ao passo antes de chamar a equipe (B57). `min(1)`:
  // 0 faria a primeira mensagem fora do tema virar tarefa direto.
  "agente_whatsapp.esquivas_ate_humano": z.number().int().min(1).max(5),
  // Intervalo mínimo entre duas emissões do MESMO tipo de link. Emitir revoga
  // o anterior (0028): `0` deixaria o cliente derrubar o próprio link a cada
  // mensagem. Teto de 7 dias — além disso o link já expirou sozinho.
  "agente_whatsapp.intervalo_link_horas": z.number().int().min(1).max(168),
  "agente_whatsapp.teto_respostas_hora": z.number().int().min(1).max(60),
  // Orçamento próprio de IA (C3/D19). `min(0)` de propósito: 0 é uma forma
  // legítima de desligar SÓ a IA e manter as respostas fixas.
  "agente_whatsapp.teto_ia_jornada_dia": z.number().int().min(0).max(200),
  "agente_whatsapp.teto_ia_dia": z.number().int().min(0).max(5000),
};

export const CHAVES_CONFIGURACAO = Object.keys(SCHEMAS_CONFIGURACAO) as ConfiguracaoChave[];

/**
 * Escritas só pelo sistema (o cron grava `regua.ultimo_cron_em` a cada
 * passagem). Não têm schema de propósito: um PATCH nelas é 404 — a tela
 * mostra o valor como prova de vida e nunca oferece "Salvar".
 */
export const CHAVES_CONFIGURACAO_SOMENTE_LEITURA: readonly ConfiguracaoChaveSomenteLeitura[] = ["regua.ultimo_cron_em"];

export function ehChaveConfiguracaoConhecida(chave: string): chave is ConfiguracaoChave {
  return Object.prototype.hasOwnProperty.call(SCHEMAS_CONFIGURACAO, chave);
}

export function ehChaveSomenteLeitura(chave: string): chave is ConfiguracaoChaveSomenteLeitura {
  return (CHAVES_CONFIGURACAO_SOMENTE_LEITURA as readonly string[]).includes(chave);
}
