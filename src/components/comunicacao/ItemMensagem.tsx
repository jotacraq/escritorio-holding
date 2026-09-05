"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/hooks/useToast";
import { Botao } from "@/components/ui/Botao";
import { Selo } from "@/components/ui/Selo";
import { formatarData, formatarDataHora, formatarHora, formatarRelativo, formatarTelefone, linkWhatsapp } from "@/lib/formatar";
import { mensagemDeErro } from "@/components/admin/http";
import { marcarMensagemEnviada, prepararMensagem, type MensagemDaFila } from "./api-comunicacao";
import { ROTULO_STATUS, TOM_STATUS, rotuloCanal, rotuloTemplate } from "./humanizar";

const ICONE_COPIAR = (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="7" y="7" width="10" height="10" rx="2" />
    <path d="M13 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
  </svg>
);

const ICONE_OK = (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4.5 10.5l3.6 3.5 7.4-8" />
  </svg>
);

interface Props {
  mensagem: MensagemDaFila;
  /** `agenda` = lista "o que vai sair" (hora à esquerda); `historico` = enviadas/falhas (data completa). */
  modo: "agenda" | "historico";
  aoMudar: () => void;
}

type NotaLocal = { tom: "aviso" | "erro"; texto: string; jornadaId?: string } | null;

/**
 * Uma linha da fila. WhatsApp pendente é a única que age: "Preparar e
 * copiar" chama `POST …/preparar` (resolve `{{link_*}}` e congela o texto) e
 * SÓ ENTÃO copia — placeholder literal nunca chega ao cliente. 409 vira
 * aviso humano com link para a Ficha; 503 vira "envio indisponível".
 */
export function ItemMensagem({ mensagem, modo, aoMudar }: Props) {
  const { notificar } = useToast();
  const router = useRouter();
  const [preparando, setPreparando] = useState(false);
  const [marcando, setMarcando] = useState(false);
  const [corpo, setCorpo] = useState(mensagem.corpo_renderizado ?? "");
  const [pronta, setPronta] = useState(!mensagem.precisa_preparar);
  const [verTexto, setVerTexto] = useState(false);
  const [nota, setNota] = useState<NotaLocal>(null);

  const ehWhatsappPendente = mensagem.canal === "whatsapp" && mensagem.status === "pendente";
  const nome = mensagem.pessoa_nome ?? mensagem.destinatario;
  const destinatario = mensagem.canal === "whatsapp" ? formatarTelefone(mensagem.destinatario) : mensagem.destinatario;
  const linkFicha = `/jornadas/${mensagem.jornada_id}`;

  async function copiarTexto(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch {
      return false;
    }
  }

  async function prepararECopiar() {
    setPreparando(true);
    setNota(null);
    try {
      const resultado = await prepararMensagem(mensagem.id);
      if (resultado.situacao === "falta_dado") {
        const ehSala = resultado.codigo === "sessao_sem_sala";
        const texto = ehSala
          ? "Esta mensagem leva o link da sala, e a sessão ainda não tem um. Cole o link na Ficha → Sessão (ou ligue a integração em Admin → Integrações) e volte aqui."
          : resultado.mensagem;
        setNota({ tom: "aviso", texto, jornadaId: mensagem.jornada_id });
        notificar({
          tom: "aviso",
          titulo: ehSala ? "Sessão sem link da sala" : "Falta um dado para preparar",
          descricao: texto,
          acao: { rotulo: "Abrir a Ficha", aoClicar: () => router.push(`${linkFicha}#sessao`) },
        });
        return;
      }
      if (resultado.situacao === "indisponivel") {
        const texto = "Envio indisponível: falta SUPABASE_SERVICE_ROLE_KEY no servidor. A mensagem continua na fila.";
        setNota({ tom: "erro", texto });
        notificar({ tom: "erro", titulo: "Não foi possível preparar", descricao: texto });
        return;
      }
      setCorpo(resultado.corpo);
      setPronta(true);
      const copiou = await copiarTexto(resultado.corpo);
      const link = linkWhatsapp(mensagem.destinatario, resultado.corpo);
      notificar({
        tom: copiou ? "sucesso" : "aviso",
        titulo: copiou ? "Texto copiado" : "Texto pronto — copie abaixo",
        descricao: copiou ? `Cole no WhatsApp de ${nome} e depois marque como enviada.` : "O navegador bloqueou a área de transferência. O texto está visível na linha.",
        acao: link ? { rotulo: "Abrir no WhatsApp", aoClicar: () => window.open(link, "_blank", "noopener") } : undefined,
      });
      if (!copiou) setVerTexto(true);
    } catch (erro) {
      notificar({ tom: "erro", titulo: "Não foi possível preparar", descricao: mensagemDeErro(erro, "Confira a internet e tente de novo.") });
    } finally {
      setPreparando(false);
    }
  }

  async function marcarEnviada() {
    setMarcando(true);
    try {
      await marcarMensagemEnviada(mensagem.id);
      notificar({ tom: "sucesso", titulo: "Marcada como enviada", descricao: `${rotuloTemplate(mensagem.template_chave)} de ${nome} sai da fila.` });
      aoMudar();
    } catch (erro) {
      notificar({ tom: "erro", titulo: "Não foi possível marcar", descricao: mensagemDeErro(erro, "Tente de novo em instantes.") });
    } finally {
      setMarcando(false);
    }
  }

  const linkWa = pronta && corpo ? linkWhatsapp(mensagem.destinatario, corpo) : null;

  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:gap-5">
      {/* Coluna da hora: o "quando" é o eixo desta lista. */}
      <div className="flex shrink-0 items-baseline gap-2 sm:w-24 sm:flex-col sm:gap-0">
        {modo === "agenda" ? (
          <>
            <time dateTime={mensagem.agendada_para} className="text-titulo font-bold tabular-nums text-tinta">
              {formatarHora(mensagem.agendada_para)}
            </time>
            <span className="text-xs text-tinta-fraca">
              {formatarData(mensagem.agendada_para)} · {formatarRelativo(mensagem.agendada_para)}
            </span>
          </>
        ) : (
          <time dateTime={mensagem.enviada_em ?? mensagem.agendada_para} className="text-sm font-medium tabular-nums text-tinta">
            {formatarDataHora(mensagem.enviada_em ?? mensagem.agendada_para)}
          </time>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-corpo font-bold text-tinta">{rotuloTemplate(mensagem.template_chave)}</p>
          <Selo tom={mensagem.canal === "whatsapp" ? "verde" : "azul"}>{rotuloCanal(mensagem.canal)}</Selo>
          {modo === "historico" && <Selo tom={TOM_STATUS[mensagem.status]}>{ROTULO_STATUS[mensagem.status]}</Selo>}
          {ehWhatsappPendente && <Selo tom="ambar">Sai pela sua mão</Selo>}
        </div>
        <p className="text-sm text-tinta-suave">
          Para{" "}
          <Link href={linkFicha} className="font-medium text-tinta underline-offset-2 hover:underline">
            {nome}
          </Link>
          {mensagem.pessoa_nome && <span className="text-tinta-fraca"> · {destinatario}</span>}
        </p>

        {mensagem.canal === "email" && mensagem.status === "pendente" && mensagem.precisa_preparar && (
          <p className="text-xs text-tinta-fraca">O link desta mensagem é montado na hora do envio.</p>
        )}
        {mensagem.tentativas > 0 && (
          <p className="text-xs text-tinta-fraca">
            {mensagem.tentativas} tentativa{mensagem.tentativas === 1 ? "" : "s"}
            {mensagem.proxima_tentativa_em && mensagem.status === "pendente" && ` · próxima ${formatarRelativo(mensagem.proxima_tentativa_em)}`}
          </p>
        )}
        {mensagem.erro && (
          <p className="text-sm text-[color:var(--vermelho)]" role={modo === "historico" ? undefined : "alert"}>
            {mensagem.erro}
          </p>
        )}

        {nota && (
          <p role={nota.tom === "erro" ? "alert" : "status"} className={`rounded-controle px-3.5 py-2.5 text-sm ${nota.tom === "erro" ? "bg-vermelho-fraco text-[color:var(--vermelho)]" : "bg-ambar-fraco text-[color:var(--ambar)]"}`}>
            {nota.texto}
            {nota.jornadaId && (
              <>
                {" "}
                <Link href={`/jornadas/${nota.jornadaId}#sessao`} className="font-bold underline underline-offset-2">
                  Abrir a Ficha → Sessão
                </Link>
              </>
            )}
          </p>
        )}

        {corpo && (
          <div>
            <button
              type="button"
              onClick={() => setVerTexto((v) => !v)}
              aria-expanded={verTexto}
              className="min-h-11 text-sm font-medium text-[color:var(--latao)] underline-offset-2 hover:underline"
            >
              {verTexto ? "Esconder o texto" : "Ver o texto"}
            </button>
            {verTexto && <p className="mt-1 whitespace-pre-wrap rounded-controle bg-papel px-4 py-3 text-sm leading-relaxed text-tinta">{corpo}</p>}
          </div>
        )}

        {ehWhatsappPendente && (
          <div className="mt-1 flex flex-wrap gap-2">
            <Botao variante="secundario" tamanho="compacto" icone={ICONE_COPIAR} carregando={preparando} onClick={prepararECopiar}>
              Preparar e copiar
            </Botao>
            {linkWa && (
              <a
                href={linkWa}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex min-h-11 items-center justify-center rounded-controle border border-linha-controle bg-papel-elevado px-3.5 text-sm font-medium text-tinta transition-colors duration-[var(--transicao-rapida)] hover:border-[color:var(--latao)] hover:text-[color:var(--latao)]"
              >
                Abrir no WhatsApp
              </a>
            )}
            <Botao variante="secundario" tamanho="compacto" icone={ICONE_OK} carregando={marcando} onClick={marcarEnviada}>
              Marcar como enviada
            </Botao>
          </div>
        )}
      </div>
    </li>
  );
}
