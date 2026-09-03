export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { criarClienteServidor } from "@/lib/supabase/server";
import { exigirPapel } from "@/server/auth";
import { erroValidacao, registrarErro, respostaErro } from "@/server/erros";
import type { MensagemTemplateAdmin } from "@/types/admin";

/** GET /api/admin/templates — todas as versões, mais recente primeiro por (chave, canal). */
export async function GET() {
  try {
    await exigirPapel("admin");

    const supabase = await criarClienteServidor();
    const { data, error } = await supabase
      .from("mensagens_templates")
      .select("*")
      .order("chave", { ascending: true })
      .order("canal", { ascending: true })
      .order("versao", { ascending: false });

    if (error) {
      registrarErro("api/admin/templates GET", error);
      throw error;
    }

    return NextResponse.json({ itens: (data as MensagemTemplateAdmin[] | null) ?? [] });
  } catch (erro) {
    return respostaErro("api/admin/templates GET", erro);
  }
}

const CorpoSchema = z
  .object({
    chave: z.string().trim().min(1).max(100),
    canal: z.enum(["email", "whatsapp"]),
    assunto: z.string().trim().min(1).max(300).nullish(),
    corpo: z.string().trim().min(1),
    ativar: z.boolean().default(false),
  })
  .refine((corpo) => corpo.canal !== "whatsapp" || !corpo.assunto, {
    message: "Template de WhatsApp não tem assunto.",
    path: ["assunto"],
  });

/**
 * POST /api/admin/templates — SEMPRE cria uma VERSÃO NOVA (regra não
 * negociável: template é dado versionado, nunca se edita a versão em uso).
 * `ativar:true` promove esta versão e despromove a anterior do mesmo
 * (chave, canal) ANTES do INSERT — a unique index parcial
 * (`uniq_template_ativo`) não permite duas ativas ao mesmo tempo. Mesmo
 * padrão já usado em `POST /api/formularios` (fora da minha fronteira, mas é
 * o precedente do projeto para "nova versão + ativar opcional").
 */
export async function POST(request: NextRequest) {
  try {
    await exigirPapel("admin");
    const corpo = CorpoSchema.parse(
      await request.json().catch(() => {
        throw erroValidacao(null, "Corpo da requisição precisa ser JSON válido.");
      }),
    );

    const supabase = await criarClienteServidor();

    const { data: ultima, error: erroUltima } = await supabase
      .from("mensagens_templates")
      .select("versao")
      .eq("chave", corpo.chave)
      .eq("canal", corpo.canal)
      .order("versao", { ascending: false })
      .limit(1)
      .maybeSingle<{ versao: number }>();
    if (erroUltima) throw erroUltima;

    const proximaVersao = (ultima?.versao ?? 0) + 1;

    if (corpo.ativar) {
      const { error: erroDesativar } = await supabase
        .from("mensagens_templates")
        .update({ ativo: false })
        .eq("chave", corpo.chave)
        .eq("canal", corpo.canal)
        .eq("ativo", true);
      if (erroDesativar) {
        registrarErro("api/admin/templates POST#desativar-anterior", erroDesativar, {
          chave: corpo.chave,
          canal: corpo.canal,
        });
        throw erroDesativar;
      }
    }

    const { data: novo, error } = await supabase
      .from("mensagens_templates")
      .insert({
        chave: corpo.chave,
        canal: corpo.canal,
        versao: proximaVersao,
        assunto: corpo.assunto ?? null,
        corpo: corpo.corpo,
        ativo: corpo.ativar,
      })
      .select("*")
      .single<MensagemTemplateAdmin>();

    if (error) {
      registrarErro("api/admin/templates POST", error, { chave: corpo.chave, canal: corpo.canal });
      throw error;
    }

    return NextResponse.json({ template: novo }, { status: 201 });
  } catch (erro) {
    return respostaErro("api/admin/templates POST", erro);
  }
}
