"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useToast } from "@/hooks/useToast";
import { useRecurso } from "@/hooks/useRecurso";
import { formatarMoeda, formatarRelativo } from "@/lib/formatar";
import type { Tarefa } from "@/types/banco";
import { Botao } from "@/components/ui/Botao";
import { Campo, Entrada } from "@/components/ui/Campo";
import { ConfirmarAcao } from "@/components/ui/ConfirmarAcao";
import { EsqueletoLista } from "@/components/ui/Esqueleto";
import { EstadoErro } from "@/components/ui/Estado";
import { Selo } from "@/components/ui/Selo";
import { emitirLink, ErroFicha360Api } from "./api";
import { buscarTarefa, concluirTarefa, renderizarMensagemTarefa, type MensagemCroquiPronta, type PendenciaMensagemCroqui } from "./api-tarefas";

/** Cada pendência diz o que falta E onde resolver — nunca só o código. */
const PENDENCIA: Record<PendenciaMensagemCroqui, { texto: string; href?: string; acao?: string }> = {
  url_checkout_ausente: { texto: "Link de checkout do Croqui não cadastrado — a mensagem sai com “te mando o link em seguida”.", href: "/admin#produtos", acao: "Admin → Produtos" },
  oferta_ausente: { texto: "Nenhuma oferta do Croqui registrada nesta sessão — a mensagem cita “o valor que combinamos”.", href: "#sessao", acao: "Registrar a oferta no Modo Conduzir" },
  data_apresentacao_ausente: { texto: "Sem agendamento da apresentação do Croqui — a mensagem diz “vamos combinar a data”." },
  link_documentos_ausente: { texto: "Sem link de documentos (IR e contrato social) — gere abaixo para incluir na mensagem." },
  template_ausente: { texto: "Template “croqui_convite” inativo ou ausente — a mensagem abaixo é um esqueleto.", href: "/admin#templates", acao: "Admin → Templates" },
};

const ICONE_COPIAR = (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="7" y="7" width="9.5" height="9.5" rx="1.5" />
    <path d="M13 7V5a1.5 1.5 0 0 0-1.5-1.5h-6A1.5 1.5 0 0 0 4 5v6A1.5 1.5 0 0 0 5.5 12.5H7" />
  </svg>
);

/**
 * "Dra. Elaine envia pessoalmente" como tarefa assistida (Fase 4 §1.4): o
 * sistema abre a tarefa `enviar_link_croqui` quando a sessão fecha, monta a
 * mensagem do template `croqui_convite` com o que existe (valor da oferta,
 * data da apresentação, checkout do produto, link `/p/d`) e rotula o que
 * falta. A advogada copia, manda pelo WhatsApp dela e marca como enviado.
 * Nada é enviado pelo sistema aqui — é uma tarefa humana com tudo pronto.
 */
export function SessaoTarefaCroqui({ jornadaId, tarefa, aoAtualizar }: { jornadaId: string; tarefa: Tarefa; aoAtualizar: () => void }) {
  const { notificar } = useToast();
  const buscar = useCallback(() => buscarTarefa(tarefa.id), [tarefa.id]);
  const { dados, carregando, erro, recarregar, setDados } = useRecurso(buscar, [tarefa.id]);
  const [gerandoLink, setGerandoLink] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [confirmandoEnvio, setConfirmandoEnvio] = useState(false);
  const [concluindo, setConcluindo] = useState(false);
  const [nota, setNota] = useState("");
  const [linkDocumentos, setLinkDocumentos] = useState<string | null>(null);

  const mensagem: MensagemCroquiPronta | null = dados?.mensagem_pronta ?? null;

  function aplicarMensagem(nova: MensagemCroquiPronta) {
    setDados(dados ? { ...dados, mensagem_pronta: nova } : { tarefa, mensagem_pronta: nova });
  }

  async function gerarLinkDocumentos() {
    setGerandoLink(true);
    try {
      const res = await emitirLink(jornadaId, "documentos");
      setLinkDocumentos(res.link.url);
      const nova = await renderizarMensagemTarefa(tarefa.id, res.link.url);
      aplicarMensagem(nova);
      setCopiado(false);
      notificar({ tom: "sucesso", titulo: "Link de documentos gerado", descricao: "Já está dentro da mensagem abaixo. Ele só aparece agora — se fechar a tela, gere outro (o anterior é revogado)." , duracao: 10000 });
    } catch (e) {
      notificar({ tom: "erro", titulo: "Não foi possível gerar o link de documentos", descricao: e instanceof ErroFicha360Api ? e.message : "Confira a internet e tente de novo." });
    } finally {
      setGerandoLink(false);
    }
  }

  async function copiar() {
    if (!mensagem) return;
    try {
      await navigator.clipboard.writeText(mensagem.corpo);
      setCopiado(true);
      notificar({ tom: "sucesso", titulo: "Mensagem copiada", descricao: "Cole no WhatsApp do cliente e depois marque como enviado." });
    } catch {
      notificar({ tom: "erro", titulo: "Não foi possível copiar", descricao: "Selecione o texto da mensagem e copie à mão (Ctrl+C)." });
    }
  }

  async function marcarEnviado() {
    setConcluindo(true);
    try {
      await concluirTarefa(tarefa.id, nota.trim() || undefined);
      notificar({ tom: "sucesso", titulo: "Marcado como enviado", descricao: "Fica na linha do tempo que o link do croqui foi enviado pessoalmente." });
      setConfirmandoEnvio(false);
      aoAtualizar();
    } catch (e) {
      const codigo = e instanceof ErroFicha360Api ? e.codigo : undefined;
      notificar({
        tom: "erro",
        titulo: codigo === "tarefa_ja_concluida" ? "Esta tarefa já foi concluída" : "Não foi possível marcar como enviado",
        descricao: codigo === "tarefa_ja_concluida" ? "Alguém já marcou — recarregue a ficha." : e instanceof ErroFicha360Api ? e.message : "Confira a internet e tente de novo.",
      });
    } finally {
      setConcluindo(false);
    }
  }

  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível montar a mensagem" />;
  if (carregando) return <EsqueletoLista linhas={4} rotulo="Montando a mensagem pronta…" />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Selo tom="ambar">Tarefa da advogada</Selo>
        {tarefa.vence_em && <span className="text-xs text-tinta-suave">vence {formatarRelativo(tarefa.vence_em)}</span>}
        {mensagem?.valor_croqui != null && <Selo tom="neutro">Croqui: {formatarMoeda(mensagem.valor_croqui)}</Selo>}
      </div>
      <p className="text-sm text-tinta-suave">
        A sessão fechou. O sistema deixou a mensagem pronta; a Dra. Elaine envia pessoalmente pelo WhatsApp com o link de pagamento do Croqui, a data da apresentação e o pedido do IR e do contrato social.
      </p>

      {mensagem && mensagem.pendencias.length > 0 && (
        <div className="rounded-controle border border-ambar-borda bg-ambar-fraco px-3.5 py-2.5">
          <p className="text-sm font-bold text-[color:var(--ambar)]">O que ainda falta nesta mensagem</p>
          <ul className="mt-1 flex flex-col gap-1 text-sm text-[color:var(--ambar)]">
            {mensagem.pendencias.map((p) => (
              <li key={p} className="flex flex-wrap items-baseline gap-x-1.5">
                <span>{PENDENCIA[p].texto}</span>
                {PENDENCIA[p].href && (
                  <Link href={PENDENCIA[p].href!} className="inline-flex min-h-11 items-center font-medium underline underline-offset-2">
                    {PENDENCIA[p].acao}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {mensagem ? (
        <div className="flex flex-col gap-2">
          <p className="text-rotulo font-medium uppercase text-tinta-fraca">Mensagem pronta · WhatsApp</p>
          <pre className="whitespace-pre-wrap rounded-controle border border-linha bg-papel px-4 py-3 font-[inherit] text-sm leading-relaxed text-tinta">{mensagem.corpo}</pre>
        </div>
      ) : (
        <p className="text-sm text-tinta-suave">Esta tarefa não tem mensagem pronta.</p>
      )}

      <div className="nao-imprimir">
        <Campo rotulo="Nota ao marcar como enviado" ajuda="Opcional. Ex.: “enviado no WhatsApp da esposa”. Vai para a linha do tempo." extra="até 500 caracteres">
          <Entrada value={nota} maxLength={500} onChange={(e) => setNota(e.target.value)} />
        </Campo>
      </div>

      <div className="nao-imprimir flex flex-wrap gap-2">
        {mensagem && (
          <Botao variante="primario" icone={ICONE_COPIAR} onClick={copiar}>
            {copiado ? "Copiada — copiar de novo" : "Copiar mensagem"}
          </Botao>
        )}
        {mensagem?.pendencias.includes("link_documentos_ausente") && (
          <Botao variante="secundario" carregando={gerandoLink} onClick={gerarLinkDocumentos}>
            Gerar link de documentos
          </Botao>
        )}
        {linkDocumentos && !mensagem?.pendencias.includes("link_documentos_ausente") && (
          <Botao variante="fantasma" carregando={gerandoLink} onClick={gerarLinkDocumentos}>
            Gerar outro link de documentos
          </Botao>
        )}
        <Botao variante="secundario" onClick={() => setConfirmandoEnvio(true)}>
          Marcar como enviado
        </Botao>
      </div>

      <ConfirmarAcao
        aberto={confirmandoEnvio}
        titulo="Marcar o link do croqui como enviado?"
        efeito="A tarefa é concluída em seu nome, com data e hora, e a linha do tempo registra “Link do croqui enviado pessoalmente”. Não pode ser desfeito — só marque depois de mandar a mensagem ao cliente."
        rotuloConfirmar="Marcar como enviado"
        confirmando={concluindo}
        aoConfirmar={marcarEnviado}
        aoCancelar={() => setConfirmandoEnvio(false)}
      />
    </div>
  );
}
