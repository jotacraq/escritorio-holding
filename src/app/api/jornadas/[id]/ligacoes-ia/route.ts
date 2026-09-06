export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirInterno, exigirPapel } from "@/server/auth";
import { ErroApi, registrarErro, respostaErro } from "@/server/erros";
import { dispararAgora, enfileirarLigacaoIa } from "@/server/ligacao-ia";
import type { LigacaoIa, RespostaLigacaoIa, RespostaListarLigacoesIa } from "@/types/integracoes";
import { COLUNAS_LIGACAO_IA_EQUIPE, projetarParaEquipe } from "@/server/ligacao-ia/tipos";
import { criarLimitadorJanela } from "@/server/integracoes/rate-limit";

const ParametroSchema = z.object({ id: z.string().uuid() });

/**
 * B3 do pentest (06/09/2026): "Ligar por IA agora" não tinha teto. Cada
 * chamada DISCA DE VERDADE — custa dinheiro na Vapi e toca o telefone de um
 * cliente. `uniq_ligacao_ia_ativa` impede duas ligações ativas na mesma
 * jornada, mas cancelar e repedir contorna isso, e nada impedia percorrer
 * jornadas diferentes em sequência.
 *
 * Chave = PERFIL, não IP: a equipe da Dra. Elaine trabalha atrás de um IP só,
 * e limitar por IP puniria a sala inteira pelo excesso de uma pessoa (mesma
 * razão do limitador de emissão de link, Fase 6).
 */
const LIMITE_DISPAROS = 5;
const JANELA_DISPAROS_MS = 10 * 60_000;
const limitarDisparo = criarLimitadorJanela(LIMITE_DISPAROS, JANELA_DISPAROS_MS);

/** GET /api/jornadas/[id]/ligacoes-ia — histórico da jornada (RLS `lia_sel`: toda a equipe). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirInterno();
    const { id: jornadaId } = ParametroSchema.parse(await params);
    const supabase = await criarClienteServidor();
    const { data, error } = await supabase
      .from("ligacoes_ia")
      .select(COLUNAS_LIGACAO_IA_EQUIPE)
      .eq("jornada_id", jornadaId)
      .order("criado_em", { ascending: false })
      .limit(50)
      .returns<LigacaoIa[]>();
    if (error) throw error;
    const resposta: RespostaListarLigacoesIa = { itens: data ?? [] };
    return NextResponse.json(resposta);
  } catch (erro) {
    return respostaErro("GET /api/jornadas/[id]/ligacoes-ia", erro);
  }
}

/**
 * POST /api/jornadas/[id]/ligacoes-ia — botão "Ligar por IA agora" da Ficha →
 * Sessão (B33: sempre disponível, independente de `ligacao_ia.automatica`).
 * Enfileira e dispara na hora; sem n8n configurado vira tarefa humana
 * rotulada (nunca falha silenciosa). Exige service_role: a fila não tem
 * policy de INSERT para authenticated (0053).
 *
 * 201 = ligação nova. 200 = já havia uma `na_fila` e ela foi disparada agora
 * (`decidirColisaoLigacaoAtiva`); 409 `ligacao_ativa` só quando a chamada já
 * está em curso (`discando`/`em_ligacao`).
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const usuario = await exigirPapel("admin", "advogada", "relacionamento");
    const { id: jornadaId } = ParametroSchema.parse(await params);

    // Depois de autenticar (o limite é por perfil) e antes de qualquer trabalho.
    const limite = limitarDisparo(usuario.id);
    if (limite.excedido) {
      return NextResponse.json(
        {
          erro: "rate_limited",
          mensagem: `Muitas ligações pedidas seguidas (máximo ${LIMITE_DISPAROS} a cada ${JANELA_DISPAROS_MS / 60_000} minutos). Tente de novo em ${limite.tenteEmS}s.`,
          tente_em_s: limite.tenteEmS,
        },
        { status: 429, headers: { "Retry-After": String(limite.tenteEmS) } },
      );
    }

    // A trava de ROTA: a jornada precisa existir para quem está logado (RLS).
    const supabase = await criarClienteServidor();
    const { data: jornada, error: erroJornada } = await supabase.from("jornadas").select("id").eq("id", jornadaId).maybeSingle();
    if (erroJornada) throw erroJornada;
    if (!jornada) throw new ErroApi(404, "nao_encontrado", "Jornada não encontrada.");

    let admin;
    try {
      admin = criarClienteAdmin();
    } catch (erroServiceRole) {
      registrarErro("POST /api/jornadas/[id]/ligacoes-ia#service_role", erroServiceRole, { jornada_id: jornadaId });
      throw new ErroApi(503, "servico_indisponivel", "Ligação por IA exige SUPABASE_SERVICE_ROLE_KEY no servidor — indisponível agora.");
    }

    const { ligacao, aviso, reaproveitada } = await enfileirarLigacaoIa(admin, { jornadaId, solicitadaPor: usuario.id });

    // Dispara já (não espera o cron). Falha aqui não desfaz o enfileiramento:
    // a ligação fica visível com o erro e o reaper/cron cuidam do resto.
    let disparo: Awaited<ReturnType<typeof dispararAgora>> = null;
    try {
      disparo = await dispararAgora(admin, ligacao.id);
    } catch (erroDisparo) {
      registrarErro("POST /api/jornadas/[id]/ligacoes-ia#disparar", erroDisparo, { ligacao_id: ligacao.id });
    }

    const { data: atual } = await admin.from("ligacoes_ia").select(COLUNAS_LIGACAO_IA_EQUIPE).eq("id", ligacao.id).maybeSingle<LigacaoIa>();
    // I1 do pentest: o fallback NÃO pode ser a linha crua de `insert().select("*")`
    // (`fila.ts`) — ela traz `token_link_cifrado`, que é justamente a coluna que a
    // 0073b esconde de `authenticated`. Uma leitura que falha não é licença para
    // devolver mais do que a leitura que dá certo devolveria.
    const resposta: RespostaLigacaoIa = {
      ligacao: (atual as LigacaoIa | null) ?? projetarParaEquipe(ligacao),
      ...(aviso ? { aviso } : disparo === "falha" ? { aviso: "A ligação não pôde ser disparada agora; veja o motivo no histórico. O sistema tenta de novo pela régua." } : {}),
    };
    return NextResponse.json(resposta, { status: reaproveitada ? 200 : 201 });
  } catch (erro) {
    return respostaErro("POST /api/jornadas/[id]/ligacoes-ia", erro);
  }
}
