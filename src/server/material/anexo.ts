import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarErro } from "@/server/erros";
import { lerConfiguracaoBool } from "@/server/ia/configuracao";
import { NOME_ARQUIVO_PDF_MATERIAL } from "./pdf";
import { BUCKET_MATERIAIS, CHAVE_ANEXAR_PDF } from "./storage";

/**
 * Anexo do e-mail `pos_sessao` (§3.3 "Entrega", B35) — CONTRATO com o agente A
 * (dono de `src/server/regua/**`):
 *
 *   const anexo = await lerAnexoPdfMaterial(supabaseAdmin, mensagem.jornada_id);
 *   await enviarEmail({ ..., anexos: anexo ? [anexo] : undefined });
 *
 * Devolve `null` (e o e-mail sai SÓ com o link `/p/m`) quando:
 * - `configuracoes['material.anexar_pdf']` = false;
 * - o material atual aprovado ainda não tem PDF (aprovado antes desta fase, ou
 *   PDF falhou — `pdf_erro` na tela);
 * - o download do Storage falhar (erro registrado, nunca derruba o envio).
 *
 * Lê SEMPRE o material ATUAL e APROVADO — nunca uma versão antiga (tarefa do
 * pentest, Onda 4). Formato do anexo = contrato (ii) do §9:
 * `{ nome: string; conteudoBase64: string }`.
 */

export interface AnexoEmail {
  nome: string;
  conteudoBase64: string;
}

/** Resend aceita até 40 MB por mensagem; um material tem ~100 KB. Teto defensivo. */
const TETO_ANEXO_BYTES = 10 * 1024 * 1024;

export async function lerAnexoPdfMaterial(supabaseAdmin: SupabaseClient, jornadaId: string): Promise<AnexoEmail | null> {
  const contexto = "server/material/anexo.lerAnexoPdfMaterial";
  try {
    const anexar = await lerConfiguracaoBool(supabaseAdmin, CHAVE_ANEXAR_PDF, true);
    if (!anexar) return null;

    const { data: material, error } = await supabaseAdmin
      .from("materiais_gerados")
      .select("id, pdf_caminho, pdf_bytes")
      .eq("jornada_id", jornadaId)
      .eq("atual", true)
      .not("aprovado_em", "is", null)
      .maybeSingle<{ id: string; pdf_caminho: string | null; pdf_bytes: number | null }>();
    if (error) throw error;
    if (!material?.pdf_caminho) return null;
    if ((material.pdf_bytes ?? 0) > TETO_ANEXO_BYTES) {
      registrarErro(`${contexto}#anexo_acima_do_teto`, new Error(`pdf_bytes=${material.pdf_bytes}`), {
        material_id: material.id,
      });
      return null;
    }

    const { data: arquivo, error: erroDownload } = await supabaseAdmin.storage
      .from(BUCKET_MATERIAIS)
      .download(material.pdf_caminho);
    if (erroDownload || !arquivo) {
      throw new Error(`falha_ao_baixar_pdf_material: ${erroDownload?.message ?? "sem dados"}`);
    }

    const bytes = Buffer.from(await arquivo.arrayBuffer());
    return { nome: NOME_ARQUIVO_PDF_MATERIAL, conteudoBase64: bytes.toString("base64") };
  } catch (erro) {
    registrarErro(contexto, erro, { jornada_id: jornadaId });
    return null;
  }
}
