"use client";

import { useCallback, useState } from "react";
import { listarMensagens, marcarMensagemEnviada, ApiError, type CanalMensagem, type MensagemAgendada, type StatusMensagem } from "@/lib/api";
import { useRecurso } from "@/hooks/useRecurso";
import { formatarDataHora, linkWhatsapp } from "@/lib/formatar";
import { EstadoCarregando, EstadoIndisponivel, EstadoVazio } from "@/components/ui/Estado";
import { Botao } from "@/components/ui/Botao";
import { Selo } from "@/components/ui/Selo";

const ABAS_STATUS: { id: StatusMensagem | "todas"; rotulo: string }[] = [
  { id: "todas", rotulo: "Todas" },
  { id: "pendente", rotulo: "Pendentes" },
  { id: "enviada", rotulo: "Enviadas" },
  { id: "falhou", rotulo: "Falhas" },
];

const TOM_STATUS: Record<StatusMensagem, "verde" | "vermelho" | "azul" | "neutro"> = {
  pendente: "neutro",
  enviando: "azul",
  enviada: "verde",
  falhou: "vermelho",
  cancelada: "neutro",
};

function LinhaMensagemEmail({ mensagem }: { mensagem: MensagemAgendada }) {
  return (
    <li className="flex flex-col gap-1.5 rounded-sm border border-linha bg-papel-elevado p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-tinta">{mensagem.pessoa_nome ?? mensagem.destinatario}</p>
        <Selo tom={TOM_STATUS[mensagem.status]}>{mensagem.status}</Selo>
      </div>
      <p className="text-xs text-tinta-fraca">
        {mensagem.destinatario} · agendada para {formatarDataHora(mensagem.agendada_para)}
        {mensagem.enviada_em && ` · enviada em ${formatarDataHora(mensagem.enviada_em)}`}
      </p>
      {mensagem.erro && <p className="text-xs text-[color:var(--vermelho)]">{mensagem.erro}</p>}
    </li>
  );
}

function LinhaMensagemWhatsapp({ mensagem, aoMarcarEnviada }: { mensagem: MensagemAgendada; aoMarcarEnviada: (id: string) => void }) {
  const [copiado, setCopiado] = useState(false);
  const [marcando, setMarcando] = useState(false);
  const link = linkWhatsapp(mensagem.destinatario);

  async function copiar() {
    if (!mensagem.corpo_renderizado) return;
    await navigator.clipboard.writeText(mensagem.corpo_renderizado);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2500);
  }

  return (
    <li className="flex flex-col gap-2 rounded-sm border border-linha bg-papel-elevado p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-tinta">{mensagem.pessoa_nome ?? mensagem.destinatario}</p>
        <Selo tom={TOM_STATUS[mensagem.status]}>{mensagem.status}</Selo>
      </div>
      <p className="text-xs text-tinta-fraca">{mensagem.destinatario} · agendada para {formatarDataHora(mensagem.agendada_para)}</p>
      {mensagem.corpo_renderizado && (
        <p className="whitespace-pre-wrap rounded-sm bg-papel-fundo px-2.5 py-2 text-sm text-tinta">{mensagem.corpo_renderizado}</p>
      )}
      {mensagem.status === "pendente" && (
        <div className="flex flex-wrap gap-2">
          <Botao variante="secundario" className="text-xs" onClick={copiar}>{copiado ? "Copiado!" : "Copiar texto"}</Botao>
          {link && (
            <a href={link} target="_blank" rel="noreferrer">
              <Botao variante="secundario" className="text-xs">Abrir no WhatsApp</Botao>
            </a>
          )}
          <Botao
            variante="primario"
            className="text-xs"
            carregando={marcando}
            onClick={async () => {
              setMarcando(true);
              try {
                await marcarMensagemEnviada(mensagem.id);
                aoMarcarEnviada(mensagem.id);
              } finally {
                setMarcando(false);
              }
            }}
          >
            Marcar como enviada
          </Botao>
        </div>
      )}
    </li>
  );
}

export default function PaginaComunicacao() {
  const [canal, setCanal] = useState<CanalMensagem>("whatsapp");
  const [statusFiltro, setStatusFiltro] = useState<StatusMensagem | "todas">("pendente");

  const buscar = useCallback(
    () => listarMensagens({ canal, status: statusFiltro === "todas" ? undefined : statusFiltro }),
    [canal, statusFiltro],
  );
  const { dados, carregando, erro: erroBruto, recarregar } = useRecurso(buscar, [canal, statusFiltro]);
  const itens = dados?.itens;
  const indisponivel = dados === null;
  const erro = erroBruto ? (erroBruto instanceof ApiError ? erroBruto.message : "Erro ao carregar mensagens.") : null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-serif text-2xl font-bold text-tinta">Comunicação</h1>
        <p className="text-sm text-tinta-suave">Fila da régua automática de e-mail e a fila manual de WhatsApp.</p>
      </div>

      <p role="note" className="rounded-sm border border-ambar-borda bg-ambar-fraco px-3.5 py-2.5 text-sm text-[color:var(--ambar)]">
        Envio manual — o sistema não dispara WhatsApp ainda.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-linha pb-3">
        <div className="flex gap-1.5">
          {(["whatsapp", "email"] as CanalMensagem[]).map((c) => (
            <button
              key={c}
              onClick={() => setCanal(c)}
              aria-pressed={canal === c}
              className={`rounded-sm border px-3 py-1.5 text-sm font-medium capitalize ${canal === c ? "border-[color:var(--latao)] bg-[color:var(--latao-fraco)] text-tinta" : "border-linha-forte text-tinta-suave"}`}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          {ABAS_STATUS.map((a) => (
            <button
              key={a.id}
              onClick={() => setStatusFiltro(a.id)}
              aria-pressed={statusFiltro === a.id}
              className={`rounded-sm px-2.5 py-1 text-xs font-medium ${statusFiltro === a.id ? "bg-papel-fundo text-tinta" : "text-tinta-fraca hover:text-tinta"}`}
            >
              {a.rotulo}
            </button>
          ))}
        </div>
      </div>

      {erro && <p role="alert" className="text-sm text-[color:var(--vermelho)]">{erro}</p>}
      {carregando && <EstadoCarregando rotulo="Carregando fila…" />}

      {!carregando && indisponivel && <EstadoIndisponivel titulo="Fila de mensagens ainda não disponível" />}

      {!carregando && itens && itens.length === 0 && <EstadoVazio titulo="Nenhuma mensagem nesta fila" />}

      {!carregando && itens && itens.length > 0 && (
        <ul className="flex flex-col gap-2">
          {itens.map((m) =>
            canal === "whatsapp" ? (
              <LinhaMensagemWhatsapp key={m.id} mensagem={m} aoMarcarEnviada={recarregar} />
            ) : (
              <LinhaMensagemEmail key={m.id} mensagem={m} />
            ),
          )}
        </ul>
      )}
    </div>
  );
}
