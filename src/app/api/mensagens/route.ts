export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno } from "@/server/auth";
import { registrarErro, respostaErro } from "@/server/erros";

const LIMITE = 200;
/** Cron da Hostinger é a cada 5 min; 15 min sem passagem = parado (mesmo teto de `cron_parado`, 0052). */
const CRON_ATRASADO_MINUTOS = 15;

const FiltrosSchema = z.object({
  status: z.enum(["pendente", "enviando", "enviada", "falhou", "cancelada"]).optional(),
  canal: z.enum(["email", "whatsapp"]).optional(),
});

interface MensagemAgendadaLinha {
  id: string;
  jornada_id: string;
  agendamento_id: string | null;
  canal: "email" | "whatsapp";
  destinatario: string;
  agendada_para: string;
  status: "pendente" | "enviando" | "enviada" | "falhou" | "cancelada";
  corpo_renderizado: string | null;
  erro: string | null;
  enviada_em: string | null;
  tentativas: number;
  proxima_tentativa_em: string | null;
  jornadas: { pessoas: { nome: string } | { nome: string }[] | null } | { pessoas: { nome: string } | { nome: string }[] | null }[] | null;
  mensagens_templates: { chave: string } | { chave: string }[] | null;
}

/** Bloco `regua` da resposta — prova de vida do cron (§1.6). `ultimo_cron_em` null = nunca rodou. */
export interface EstadoRegua {
  ultimo_cron_em: string | null;
  cron_atrasado: boolean;
  /** Texto exato do §1.9 quando atrasado/nunca; null quando está rodando. */
  aviso: string | null;
}

/**
 * GET /api/mensagens — fila de `mensagens_agendadas` para a tela `/comunicacao`
 * (F8): régua automática de e-mail + fila manual de WhatsApp. Junta o nome da
 * pessoa via `jornada_id -> jornadas -> pessoas` e a chave do template
 * (`template_chave`, para a seção "O que vai sair e quando" rotular o motivo:
 * confirmacao_d7 → "Confirmação D-7", dia_da_sessao → "Link da sala", …).
 * `ma_sel` na RLS já exige `app.eh_interno()`; a rota checa de novo.
 *
 * ATENÇÃO: `corpo_renderizado` de mensagem PENDENTE pode ainda ter
 * `{{link_confirmacao}}`/`{{link_sala}}` — a fila manual chama
 * `POST /api/mensagens/[id]/preparar` antes de copiar; nunca copia cru.
 */
export async function GET(request: NextRequest) {
  try {
    await exigirInterno();

    const params = Object.fromEntries(request.nextUrl.searchParams.entries());
    const filtros = FiltrosSchema.parse(params);

    const supabase = await criarClienteServidor();
    let query = supabase
      .from("mensagens_agendadas")
      .select(
        "id, jornada_id, agendamento_id, canal, destinatario, agendada_para, status, corpo_renderizado, erro, enviada_em, tentativas, proxima_tentativa_em, jornadas(pessoas(nome)), mensagens_templates(chave)",
      )
      .order("agendada_para", { ascending: true })
      .limit(LIMITE);

    if (filtros.status) query = query.eq("status", filtros.status);
    if (filtros.canal) query = query.eq("canal", filtros.canal);

    const [{ data, error }, { data: cfg }] = await Promise.all([
      query,
      supabase.from("configuracoes").select("valor").eq("chave", "regua.ultimo_cron_em").maybeSingle<{ valor: unknown }>(),
    ]);

    if (error) {
      registrarErro("api/mensagens GET", error, { filtros });
      throw error;
    }

    const linhas = (data as unknown as MensagemAgendadaLinha[] | null) ?? [];
    const itens = linhas.map((linha) => {
      const jornada = Array.isArray(linha.jornadas) ? linha.jornadas[0] : linha.jornadas;
      const pessoaBruta = jornada ? (Array.isArray(jornada.pessoas) ? jornada.pessoas[0] : jornada.pessoas) : null;
      const template = Array.isArray(linha.mensagens_templates) ? linha.mensagens_templates[0] : linha.mensagens_templates;
      return {
        id: linha.id,
        jornada_id: linha.jornada_id,
        agendamento_id: linha.agendamento_id,
        pessoa_nome: pessoaBruta?.nome,
        canal: linha.canal,
        destinatario: linha.destinatario,
        agendada_para: linha.agendada_para,
        status: linha.status,
        corpo_renderizado: linha.corpo_renderizado,
        /** Placeholder de envio ainda não resolvido — a tela chama `preparar` antes de copiar. */
        precisa_preparar: /\{\{\s*[a-z_]+\s*\}\}/i.test(linha.corpo_renderizado ?? ""),
        erro: linha.erro,
        enviada_em: linha.enviada_em,
        tentativas: linha.tentativas,
        proxima_tentativa_em: linha.proxima_tentativa_em,
        template_chave: template?.chave ?? null,
      };
    });

    const ultimoCronEm = typeof cfg?.valor === "string" ? cfg.valor : null;
    const atrasado = !ultimoCronEm || Date.now() - new Date(ultimoCronEm).getTime() > CRON_ATRASADO_MINUTOS * 60_000;
    const haMinutos = ultimoCronEm ? Math.max(0, Math.floor((Date.now() - new Date(ultimoCronEm).getTime()) / 60_000)) : null;
    const regua: EstadoRegua = {
      ultimo_cron_em: ultimoCronEm,
      cron_atrasado: atrasado,
      aviso: atrasado
        ? `A régua ainda não roda sozinha: falta o cron da Hostinger chamar /api/cron/regua a cada 5 minutos com o CRON_SECRET de produção. Última passagem registrada: ${haMinutos === null ? "nunca" : `há ${haMinutos} min`}.`
        : null,
    };

    return NextResponse.json({ itens, regua });
  } catch (erro) {
    return respostaErro("api/mensagens GET", erro);
  }
}
