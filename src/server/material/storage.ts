import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarErro } from "@/server/erros";
import { lerConfiguracaoJson } from "@/server/ia/configuracao";
import type { ConteudoMaterial, OrigemDadoMaterial, ResultadoPdfMaterial } from "@/types/material";
import { gerarPdfMaterial, NOME_ARQUIVO_PDF_MATERIAL } from "./pdf";

/**
 * Gera + sobe + registra o PDF de UM material aprovado (§3.3). Chamado pela rota
 * de aprovação (logo depois de `aprovar_material_gerado`) e pelo botão
 * "gerar de novo". Sempre `service_role`: o bucket é privado e só o servidor
 * escreve nele (0012).
 *
 * Regras:
 * - Só material APROVADO. A constraint `ck_pdf_exige_aprovacao` (0055) barra no
 *   banco; aqui é a mesma regra com mensagem legível.
 * - Falha de PDF NUNCA desfaz a aprovação: vira `pdf_erro` (via RPC) + linha
 *   em `erros_servidor`, e a tela oferece "gerar de novo".
 * - Fonte que não carrega vira Helvetica com erro LOGADO — não é falha.
 */

export const BUCKET_MATERIAIS = "documentos-sensiveis";
export const CHAVE_RODAPE_JURIDICO = "material.rodape_juridico";
export const CHAVE_ANEXAR_PDF = "material.anexar_pdf";
const RODAPE_PADRAO =
  "Material educativo elaborado pela equipe do Time Holding Brasil. Não constitui parecer jurídico nem promessa de resultado. Cada caso exige análise individual.";
const URL_ASSINADA_SEGUNDOS = 300;

/** `materiais/{jornada_id}/{material_id}.pdf` — montado SEMPRE no servidor, nunca vem do cliente. */
export function caminhoPdfMaterial(jornadaId: string, materialId: string): string {
  return `materiais/${jornadaId}/${materialId}.pdf`;
}

interface LinhaMaterialParaPdf {
  id: string;
  jornada_id: string;
  versao: number;
  conteudo: ConteudoMaterial;
  origem_dado: OrigemDadoMaterial;
  aprovado_em: string | null;
}

async function registrarErroPdf(supabaseAdmin: SupabaseClient, materialId: string, erro: unknown, contexto: string) {
  const mensagem = erro instanceof Error ? erro.message : String(erro);
  registrarErro(contexto, erro, { material_id: materialId });
  const { error } = await supabaseAdmin.rpc("registrar_pdf_material_erro", {
    p_material_id: materialId,
    p_erro: mensagem,
  });
  if (error) registrarErro(`${contexto}#registrar_pdf_material_erro`, error, { material_id: materialId });
  return mensagem;
}

export async function gerarEGravarPdfMaterial(
  supabaseAdmin: SupabaseClient,
  params: { materialId: string },
): Promise<ResultadoPdfMaterial> {
  const { materialId } = params;
  const contexto = "server/material/storage.gerarEGravarPdfMaterial";

  const { data: material, error: erroMaterial } = await supabaseAdmin
    .from("materiais_gerados")
    .select("id, jornada_id, versao, conteudo, origem_dado, aprovado_em")
    .eq("id", materialId)
    .maybeSingle<LinhaMaterialParaPdf>();
  if (erroMaterial) throw erroMaterial;
  if (!material) return { estado: "falhou", erro: "material_nao_encontrado" };
  if (!material.aprovado_em) return { estado: "falhou", erro: "material_nao_aprovado: rascunho nunca vira PDF" };

  try {
    const { data: jornada } = await supabaseAdmin
      .from("jornadas")
      .select("pessoa_id")
      .eq("id", material.jornada_id)
      .maybeSingle<{ pessoa_id: string }>();
    const { data: pessoa } = jornada
      ? await supabaseAdmin.from("pessoas").select("nome").eq("id", jornada.pessoa_id).maybeSingle<{ nome: string }>()
      : { data: null };
    const primeiroNome = (pessoa?.nome ?? "").trim().split(/\s+/)[0] ?? "";

    const rodape = await lerConfiguracaoJson<string>(supabaseAdmin, CHAVE_RODAPE_JURIDICO, RODAPE_PADRAO);

    const resultado = await gerarPdfMaterial({
      material: material.conteudo,
      primeiroNome,
      aprovadoEm: new Date(material.aprovado_em),
      rodapeJuridico: typeof rodape === "string" && rodape.trim() ? rodape : RODAPE_PADRAO,
      origemDado: material.origem_dado,
    });

    if (resultado.fonte === "helvetica") {
      // §3.6: "Fonte Neuetra não carregou no servidor — PDF saiu em Helvetica."
      registrarErro(`${contexto}#fonte_neuetra_indisponivel`, new Error(resultado.erroFonte ?? "fonte nao carregou"), {
        material_id: materialId,
      });
    }

    const caminho = caminhoPdfMaterial(material.jornada_id, material.id);
    // upsert: regerar sobrescreve o objeto do MESMO material; versão nova de
    // material tem id novo, logo caminho novo — nunca mistura.
    const { error: erroUpload } = await supabaseAdmin.storage
      .from(BUCKET_MATERIAIS)
      .upload(caminho, resultado.pdf, { contentType: "application/pdf", upsert: true });
    if (erroUpload) throw new Error(`falha_ao_subir_pdf: ${erroUpload.message}`);

    const { data: linha, error: erroRegistro } = await supabaseAdmin
      .rpc("registrar_pdf_material", {
        p_material_id: material.id,
        p_caminho: caminho,
        p_bytes: resultado.bytes,
        p_sha256: resultado.sha256,
      })
      .single<{ pdf_gerado_em: string }>();
    if (erroRegistro || !linha) {
      // Objeto já está no bucket sem linha apontando para ele — remove para não
      // deixar órfão (mesmo padrão de `publico/[token]/documento`).
      await supabaseAdmin.storage.from(BUCKET_MATERIAIS).remove([caminho]).catch(() => {});
      throw new Error(`falha_ao_registrar_pdf: ${erroRegistro?.message ?? "sem linha"}`);
    }

    return {
      estado: "gerado",
      pdf_caminho: caminho,
      pdf_bytes: resultado.bytes,
      pdf_gerado_em: linha.pdf_gerado_em,
      fonte: resultado.fonte,
    };
  } catch (erro) {
    const mensagem = await registrarErroPdf(supabaseAdmin, materialId, erro, contexto);
    return { estado: "falhou", erro: mensagem };
  }
}

/** URL assinada de 300 s com `Content-Disposition: attachment` e nome neutro. */
export async function assinarUrlPdfMaterial(
  supabaseAdmin: SupabaseClient,
  caminho: string,
): Promise<{ url: string; expira_em: string }> {
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET_MATERIAIS)
    .createSignedUrl(caminho, URL_ASSINADA_SEGUNDOS, { download: NOME_ARQUIVO_PDF_MATERIAL });
  if (error || !data) {
    throw new Error(`falha_ao_gerar_url_assinada: ${error?.message ?? "sem dados"}`);
  }
  return { url: data.signedUrl, expira_em: new Date(Date.now() + URL_ASSINADA_SEGUNDOS * 1000).toISOString() };
}
