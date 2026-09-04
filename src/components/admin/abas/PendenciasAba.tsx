"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRecurso } from "@/hooks/useRecurso";
import { ApiError } from "@/lib/api";
import { Botao } from "@/components/ui/Botao";
import { EstadoCarregando, EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { SeloStub } from "@/components/ui/Selo";
import { formatarDataHora, formatarRelativo } from "@/lib/formatar";
import { buscarPendencias, reenfileirarMensagem, reprocessarWebhook } from "../adminApi";
import { ConfirmarAcao } from "../ConfirmarAcao";
import { AvisoInline } from "../AvisoInline";
import type { PendenciaSistema, TipoPendenciaSistema } from "@/types/admin";

const ROTULO_TIPO: Record<TipoPendenciaSistema, string> = {
  webhook_falho: "Webhook não processado",
  mensagem_falhou: "Mensagem que falhou",
  link_expirando: "Link expirando",
};

type Confirmacao = { tipo: "webhook" | "mensagem"; item: PendenciaSistema } | null;

/**
 * A aba mais valiosa (briefing da tarefa): o que travou e hoje só apareceria
 * rodando SQL à mão. É FILA — cada item leva a uma ação, não é painel de leitura.
 * `link_expirando` não tem rota de ação nesta migration (nenhuma das 21 rotas
 * renova/revoga link) — fica como item informativo com link para a jornada,
 * de onde a equipe age pelo caminho que já existe.
 */
export function PendenciasAba() {
  const buscar = useCallback(() => buscarPendencias(), []);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, []);
  const [confirmacao, setConfirmacao] = useState<Confirmacao>(null);
  const [executando, setExecutando] = useState(false);
  const [aviso, setAviso] = useState<{ tom: "sucesso" | "erro"; texto: string } | null>(null);

  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível carregar as pendências" />;
  if (carregando && !dados) return <EstadoCarregando rotulo="Carregando pendências…" />;
  if (!dados) return null;

  const porTipo = (tipo: TipoPendenciaSistema) => dados.sistema.filter((item) => item.tipo === tipo);

  async function executarConfirmacao() {
    if (!confirmacao) return;
    setExecutando(true);
    setAviso(null);
    try {
      if (confirmacao.tipo === "webhook") {
        await reprocessarWebhook(confirmacao.item.id);
        setAviso({ tom: "sucesso", texto: `Webhook "${confirmacao.item.titulo}" reiniciado para novo processamento.` });
      } else {
        await reenfileirarMensagem(confirmacao.item.id);
        setAviso({ tom: "sucesso", texto: `Mensagem reenfileirada — volta para "pendente" e o próximo ciclo do cron tenta enviar de novo.` });
      }
      setConfirmacao(null);
      recarregar();
    } catch (e) {
      setAviso({ tom: "erro", texto: e instanceof ApiError ? e.message : "Não foi possível executar a ação." });
    } finally {
      setExecutando(false);
    }
  }

  const semNenhumaPendencia = dados.sistema.length === 0;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-tinta-fraca">
        O que travou e hoje só apareceria rodando SQL à mão. Cada item abaixo leva a uma ação.
      </p>

      {aviso && <AvisoInline tom={aviso.tom}>{aviso.texto}</AvisoInline>}

      {semNenhumaPendencia ? (
        <p className="flex items-center gap-2 rounded-sm border border-verde-fraco bg-verde-fraco px-4 py-3 text-sm font-medium text-[color:var(--verde)]">
          Nada travado no momento.
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          <BlocoPendencia
            titulo={ROTULO_TIPO.webhook_falho}
            itens={porTipo("webhook_falho")}
            aoAgir={(item) => setConfirmacao({ tipo: "webhook", item })}
            rotuloAcao="Reprocessar"
          />
          <BlocoPendencia
            titulo={ROTULO_TIPO.mensagem_falhou}
            itens={porTipo("mensagem_falhou")}
            aoAgir={(item) => setConfirmacao({ tipo: "mensagem", item })}
            rotuloAcao="Reenfileirar"
          />
          <BlocoPendencia titulo={ROTULO_TIPO.link_expirando} itens={porTipo("link_expirando")} />
        </div>
      )}

      <div>
        <h3 className="mb-1.5 font-serif text-base font-bold text-tinta">Materiais aguardando aprovação</h3>
        {dados.materiais_aguardando_aprovacao.disponivel === false ? (
          <SeloStub texto={dados.materiais_aguardando_aprovacao.motivo} />
        ) : (
          <EstadoVazio titulo="Nada aguardando aprovação" />
        )}
      </div>

      <ConfirmarAcao
        aberto={confirmacao !== null}
        titulo={confirmacao?.tipo === "webhook" ? "Reprocessar webhook" : "Reenfileirar mensagem"}
        efeito={
          confirmacao?.tipo === "webhook"
            ? `Zera o erro e soma uma tentativa no evento "${confirmacao.item.titulo}". Isto não reenvia o webhook sozinho — a entrega de fato depende de reenviar pela Hotmart ou da próxima reentrega automática do mesmo evento.`
            : `Volta a mensagem "${confirmacao?.item.titulo}" para o status pendente. O próximo ciclo do cron da régua (/api/cron/regua) tenta enviar de novo.`
        }
        rotuloConfirmar={confirmacao?.tipo === "webhook" ? "Reprocessar" : "Reenfileirar"}
        confirmando={executando}
        aoConfirmar={executarConfirmacao}
        aoCancelar={() => setConfirmacao(null)}
      />
    </div>
  );
}

function BlocoPendencia({
  titulo,
  itens,
  aoAgir,
  rotuloAcao,
}: {
  titulo: string;
  itens: PendenciaSistema[];
  aoAgir?: (item: PendenciaSistema) => void;
  rotuloAcao?: string;
}) {
  if (itens.length === 0) return null;
  return (
    <section className="rounded-sm border border-linha bg-papel-elevado">
      <header className="flex items-center justify-between gap-2 border-b border-linha px-4 py-2.5">
        <h3 className="font-serif text-base font-bold text-tinta">{titulo}</h3>
        <span className="rounded-full bg-latao-fraco px-2 py-0.5 text-xs font-bold tabular-nums text-[color:var(--latao-forte)]">
          {itens.length}
        </span>
      </header>
      <ul className="divide-y divide-linha">
        {itens.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-tinta">{item.titulo}</p>
              <p className="text-xs text-tinta-suave">{item.descricao}</p>
              <p className="mt-0.5 text-[11px] text-tinta-fraca">
                {formatarRelativo(item.ocorrido_em)} · {formatarDataHora(item.ocorrido_em)}
                {item.pessoa_nome ? ` · ${item.pessoa_nome}` : ""}
              </p>
            </div>
            {item.jornada_id && (
              <Link
                href={`/jornadas/${item.jornada_id}`}
                className="whitespace-nowrap text-xs font-medium text-latao-forte underline-offset-2 hover:underline"
              >
                Ver jornada
              </Link>
            )}
            {aoAgir && rotuloAcao && (
              <Botao variante="secundario" className="text-xs" onClick={() => aoAgir(item)}>
                {rotuloAcao}
              </Botao>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
