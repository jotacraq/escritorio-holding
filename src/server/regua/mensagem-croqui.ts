import type { SupabaseClient } from "@supabase/supabase-js";
import { APP_URL } from "@/lib/config-publica";
import { formatarBrl, renderizarTemplate } from "./render";

/**
 * Mensagem pronta da tarefa assistida "Enviar link do croqui" (§1.4): a Dra.
 * Elaine envia PESSOALMENTE; o sistema só deixa tudo pronto. Template
 * `croqui_convite` (canal whatsapp, seed v1 na 0051). Nada de dado inventado —
 * cada campo ausente vira frase honesta E entra em `pendencias`, para a tela
 * mostrar o <SeloStub> certo (ex.: "Link de checkout do Croqui não cadastrado
 * — Admin → Produtos").
 */
export type PendenciaMensagemCroqui = "url_checkout_ausente" | "oferta_ausente" | "data_apresentacao_ausente" | "link_documentos_ausente" | "template_ausente";

export interface MensagemCroquiPronta {
  canal: "whatsapp";
  corpo: string;
  pendencias: PendenciaMensagemCroqui[];
  /** Valor da oferta usada (para a tela mostrar de onde veio o número). */
  valor_croqui: number | null;
}

interface OfertaLinha {
  valor_ofertado: number;
  aceita: boolean | null;
  ofertada_em: string;
  produtos: { tipo: string } | { tipo: string }[] | null;
}

/** Link `/p/d/...` gerado pela tela via `POST /api/jornadas/[id]/links {tipo:'documentos'}`; só aceita URL deste app. */
export function linkDocumentosValido(url: string | undefined | null): string | null {
  if (!url) return null;
  return url.startsWith(`${APP_URL}/p/d/`) ? url : null;
}

export async function montarMensagemCroqui(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- cliente de sessão, sem generic Database
  supabase: SupabaseClient<any, any, any>,
  params: { jornadaId: string; linkDocumentos?: string | null },
): Promise<MensagemCroquiPronta> {
  const pendencias: PendenciaMensagemCroqui[] = [];

  const [{ data: template }, { data: jornada }, { data: ofertas }, { data: produtoCroqui }] = await Promise.all([
    supabase
      .from("mensagens_templates")
      .select("corpo")
      .eq("chave", "croqui_convite")
      .eq("canal", "whatsapp")
      .eq("ativo", true)
      .maybeSingle<{ corpo: string }>(),
    supabase.from("jornadas").select("pessoas(nome)").eq("id", params.jornadaId).maybeSingle<{ pessoas: { nome: string } | { nome: string }[] | null }>(),
    supabase
      .from("ofertas")
      .select("valor_ofertado, aceita, ofertada_em, produtos(tipo)")
      .eq("jornada_id", params.jornadaId)
      .order("ofertada_em", { ascending: false })
      .limit(10),
    supabase.from("produtos").select("url_checkout").eq("tipo", "croqui_estrutural").eq("ativo", true).limit(1).maybeSingle<{ url_checkout: string | null }>(),
  ]);

  if (!template) pendencias.push("template_ausente");

  const pessoa = Array.isArray(jornada?.pessoas) ? jornada?.pessoas[0] : jornada?.pessoas;
  const primeiroNome = (pessoa?.nome ?? "").trim().split(" ")[0] || "";

  const ofertasCroqui = ((ofertas as OfertaLinha[] | null) ?? []).filter((o) => {
    const produto = Array.isArray(o.produtos) ? o.produtos[0] : o.produtos;
    return produto?.tipo === "croqui_estrutural";
  });
  const oferta = ofertasCroqui.find((o) => o.aceita === true) ?? ofertasCroqui[0] ?? null;
  if (!oferta) pendencias.push("oferta_ausente");

  const urlCheckout = produtoCroqui?.url_checkout ?? null;
  if (!urlCheckout) pendencias.push("url_checkout_ausente");

  // Não existe "agendamento de apresentação" como dado no sistema (croqui_apresentacoes
  // registra apresentações já FEITAS). Nunca inventa data: frase de combinar.
  pendencias.push("data_apresentacao_ausente");

  const linkDocumentos = linkDocumentosValido(params.linkDocumentos);
  if (!linkDocumentos) pendencias.push("link_documentos_ausente");

  const corpo = template
    ? renderizarTemplate(template.corpo, {
        nome: primeiroNome,
        valor_croqui: oferta ? formatarBrl(Number(oferta.valor_ofertado)) : "o valor que combinamos na sessão",
        link_pagamento: urlCheckout ? `Você pode fazer o pagamento por aqui: ${urlCheckout}` : "Te mando o link de pagamento em seguida.",
        data_apresentacao: "vamos combinar a data juntos assim que o pagamento for confirmado",
        link_documentos: linkDocumentos ? `Você pode enviar por este link seguro: ${linkDocumentos}` : "Vou te mandar um link seguro para o envio em seguida.",
      })
        .replace(/[ \t]+\n/g, "\n")
        .trim()
    : "";

  return { canal: "whatsapp", corpo, pendencias, valor_croqui: oferta ? Number(oferta.valor_ofertado) : null };
}
