import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarErro } from "@/server/erros";
import type { TipoLinkQualquer } from "@/types/publico";

/**
 * Evento de timeline para "link público emitido".
 *
 * Existe porque a Pasta do Cliente não tinha COMO saber que um link já foi
 * enviado: `Ficha360` não traz `links[]` e, até aqui, `eventos_timeline` não
 * tinha tipo para isso — o item `links` de `lib/pasta/derivar.ts` ficava preso
 * em `ainda_nao` com a nota "Ver na aba Links", que é exatamente o "não sei"
 * disfarçado de estado que a regra da casa proíbe. Com o evento, `derivar.ts`
 * lê da MESMA `ficha.timeline` que já vem no payload da Ficha 360: zero query
 * nova, zero N+1.
 *
 * `eventos_timeline.tipo` é `text` sem CHECK (0014:10, confirmado na 0070:34) —
 * tipo novo NÃO precisa de migration. Por isso a 0074 não toca nesta tabela.
 *
 * O que NUNCA entra em `dados`: o token, e nem o `token_prefixo`. O `link_id`
 * basta para correlacionar com `links_publicos`, e material de token não se
 * duplica por comodidade (regra dura 2 da Fase 2).
 *
 * Falha aqui NÃO derruba a emissão: o link já existe e é válido, e a timeline
 * é registro secundário — mesmo tratamento de `api/tarefas/[id]` PATCH#timeline.
 */
const ROTULO_TIPO: Record<TipoLinkQualquer, string> = {
  formulario: "formulário",
  agendamento: "agendamento",
  confirmacao: "confirmação de presença",
  documentos: "documentos",
  material: "material",
};

export async function registrarLinkNaTimeline(
  supabase: SupabaseClient,
  parametros: {
    jornadaId: string;
    tipo: TipoLinkQualquer;
    linkId: string;
    /** `perfis_equipe.id` de quem emitiu; `null` quando quem emite é a régua/cron. */
    atorPerfilId: string | null;
    contexto: string;
  },
): Promise<void> {
  const { jornadaId, tipo, linkId, atorPerfilId, contexto } = parametros;
  const { error } = await supabase.from("eventos_timeline").insert({
    jornada_id: jornadaId,
    tipo: "link",
    titulo: `Link de ${ROTULO_TIPO[tipo]} emitido`,
    descricao: null,
    dados: { tipo_link: tipo, link_id: linkId },
    ator_perfil_id: atorPerfilId,
    ator_tipo: atorPerfilId ? "humano" : "sistema",
  });
  if (error) {
    registrarErro(`${contexto}#timeline_link`, error, { jornada_id: jornadaId, tipo_link: tipo });
  }
}
