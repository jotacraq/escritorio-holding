import type { SupabaseClient } from "@supabase/supabase-js";
import { APP_URL } from "@/lib/config-publica";
import { registrarErro } from "@/server/erros";
import { provedorSalaManual } from "./manual";
import { provedorSalaN8n } from "./n8n";
import type { NomeProvedorSala, ProvedorSala } from "./tipos";

/** Pede sala para sessões que começam em até 7 dias; retenta 1h depois se o n8n não respondeu. */
const JANELA_DIAS = 7;
const RETENTATIVA_HORAS = 1;
const LIMITE_LOTE = 20;

export interface ResultadoSincronizarSalas {
  provedor: NomeProvedorSala;
  pulada?: "nao_configurado";
  faltam?: string[];
  solicitadas: number;
  falhas: number;
}

export function provedorSalaAtivo(nome: NomeProvedorSala): ProvedorSala {
  return nome === "n8n" ? provedorSalaN8n : provedorSalaManual;
}

async function lerProvedorConfigurado(admin: SupabaseClient): Promise<NomeProvedorSala> {
  const { data } = await admin.from("configuracoes").select("valor").eq("chave", "sala.provedor").maybeSingle<{ valor: unknown }>();
  return data?.valor === "n8n" ? "n8n" : "manual";
}

interface LinhaAgendamentoSemSala {
  id: string;
  inicio_em: string;
  fim_em: string;
  sessoes_viabilidade: {
    id: string;
    jornada_id: string;
    link_sala: string | null;
    sala_solicitada_em: string | null;
    jornadas: { pessoas: { nome: string } | { nome: string }[] | null } | { pessoas: { nome: string } | { nome: string }[] | null }[] | null;
  } | null;
}

/**
 * Etapa 4 do cron (§1.6). Só age com `configuracoes['sala.provedor']='n8n'` E
 * `N8N_WEBHOOK_SALA_URL`/`INTEGRACOES_WEBHOOK_SECRET` presentes; caso contrário
 * devolve `pulada` com o que falta (nomes, nunca valores). Idempotente por
 * `sessoes_viabilidade.sala_solicitada_em`: carimba ANTES de chamar o n8n, para
 * duas passagens do cron não pedirem duas salas.
 */
export async function sincronizarSalas(admin: SupabaseClient): Promise<ResultadoSincronizarSalas> {
  const nome = await lerProvedorConfigurado(admin);
  const provedor = provedorSalaAtivo(nome);
  if (nome === "manual" || !provedor.configurado()) {
    return { provedor: nome, pulada: "nao_configurado", faltam: nome === "manual" ? ["sala.provedor=n8n"] : provedor.faltam(), solicitadas: 0, falhas: 0 };
  }

  const agora = new Date();
  const ate = new Date(agora.getTime() + JANELA_DIAS * 86_400_000);
  const limiteRetentativa = new Date(agora.getTime() - RETENTATIVA_HORAS * 3_600_000);

  const { data, error } = await admin
    .from("agendamentos")
    .select("id, inicio_em, fim_em, sessoes_viabilidade!inner(id, jornada_id, link_sala, sala_solicitada_em, jornadas(pessoas(nome)))")
    .in("status", ["agendado", "confirmado"])
    .gt("inicio_em", agora.toISOString())
    .lte("inicio_em", ate.toISOString())
    .is("sessoes_viabilidade.link_sala", null)
    .order("inicio_em", { ascending: true })
    .limit(LIMITE_LOTE);

  if (error) throw new Error(`falha_ao_listar_sessoes_sem_sala: ${error.message}`);

  const resultado: ResultadoSincronizarSalas = { provedor: nome, solicitadas: 0, falhas: 0 };
  const linhas = (data as unknown as LinhaAgendamentoSemSala[] | null) ?? [];

  for (const linha of linhas) {
    const sessao = linha.sessoes_viabilidade;
    if (!sessao || sessao.link_sala) continue;
    if (sessao.sala_solicitada_em && new Date(sessao.sala_solicitada_em) > limiteRetentativa) continue;

    // Claim antes de chamar: quem carimbou primeiro pede; a outra passagem vê o carimbo.
    const { data: carimbada } = await admin
      .from("sessoes_viabilidade")
      .update({ sala_solicitada_em: agora.toISOString() })
      .eq("id", sessao.id)
      .is("link_sala", null)
      .select("id")
      .maybeSingle();
    if (!carimbada) continue;

    const jornada = Array.isArray(sessao.jornadas) ? sessao.jornadas[0] : sessao.jornadas;
    const pessoa = jornada ? (Array.isArray(jornada.pessoas) ? jornada.pessoas[0] : jornada.pessoas) : null;
    const primeiroNome = (pessoa?.nome ?? "").trim().split(" ")[0] || "cliente";

    const envio = await provedor.solicitar({
      sessao_id: sessao.id,
      jornada_id: sessao.jornada_id,
      inicio_em: linha.inicio_em,
      fim_em: linha.fim_em,
      titulo: `Sessão de Viabilidade — ${primeiroNome}`,
      callback_url: `${APP_URL}/api/webhooks/n8n/sala`,
    });

    if (envio.ok) {
      resultado.solicitadas += 1;
    } else {
      resultado.falhas += 1;
      registrarErro("server/sala/sincronizarSalas#solicitar", new Error(envio.erro), { sessao_id: sessao.id, provedor: nome });
    }
  }

  return resultado;
}
