"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { listarEquipe, type MembroEquipe } from "@/lib/api";
import { useRecurso } from "@/hooks/useRecurso";
import { Botao } from "@/components/ui/Botao";
import { Selo } from "@/components/ui/Selo";
import { EstadoCarregando, EstadoErro } from "@/components/ui/Estado";
import { formatarDataHora } from "@/lib/formatar";
import type { Importacao } from "@/types/importacao";
import { ApiError, buscarImportacao, cancelarImportacao, confirmarImportacao } from "./api";
import { ResumoImportacao, LinhaTotalLinhas } from "./ResumoImportacao";
import { TabelaLinhasImportacao } from "./TabelaLinhasImportacao";
import { ModalConfirmarImportacao } from "./ModalConfirmarImportacao";

const ROTULO_STATUS: Record<Importacao["status"], { rotulo: string; tom: "verde" | "vermelho" | "azul" | "neutro" }> = {
  previa: { rotulo: "Prévia — aguardando confirmação", tom: "azul" },
  confirmada: { rotulo: "Confirmada", tom: "verde" },
  cancelada: { rotulo: "Cancelada", tom: "neutro" },
};

/** Detalhe de UMA importação — serve tanto para a prévia (fase 2: ver o
 * estrago antes de causar) quanto para o resultado já confirmado (mesma
 * tela, porque as duas fases olham exatamente para as mesmas contagens e a
 * mesma tabela de linhas; só o que muda é se o botão "Confirmar" aparece). */
export function DetalheImportacao({ importacaoId }: { importacaoId: string }) {
  const buscar = useCallback(() => buscarImportacao(importacaoId), [importacaoId]);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, [importacaoId]);

  const [equipe, setEquipe] = useState<MembroEquipe[]>([]);
  useEffect(() => {
    listarEquipe()
      .then((resposta) => setEquipe(resposta?.itens ?? []))
      .catch(() => setEquipe([]));
  }, []);

  const [modalAberto, setModalAberto] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [cancelando, setCancelando] = useState(false);

  function nomeDe(id: string | null): string | null {
    if (!id) return null;
    return equipe.find((m) => m.id === id)?.nome ?? null;
  }

  async function confirmar() {
    setConfirmando(true);
    setErroAcao(null);
    try {
      await confirmarImportacao(importacaoId);
      setModalAberto(false);
      recarregar();
    } catch (e) {
      setErroAcao(e instanceof ApiError ? e.message : "Não foi possível confirmar a importação.");
    } finally {
      setConfirmando(false);
    }
  }

  async function cancelar() {
    setCancelando(true);
    setErroAcao(null);
    try {
      await cancelarImportacao(importacaoId);
      recarregar();
    } catch (e) {
      setErroAcao(e instanceof ApiError ? e.message : "Não foi possível cancelar a importação.");
    } finally {
      setCancelando(false);
    }
  }

  if (carregando) return <EstadoCarregando rotulo="Carregando importação…" />;
  if (erro || !dados) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não deu para carregar esta importação" />;

  const importacao = dados.importacao;
  const status = ROTULO_STATUS[importacao.status];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/importacoes" className="text-xs font-medium text-[color:var(--latao)] hover:underline">
            ← Todas as importações
          </Link>
          <h1 className="font-serif text-xl font-semibold text-tinta">{importacao.arquivo_nome}</h1>
          <p className="text-sm text-tinta-suave">Criada em {formatarDataHora(importacao.criado_em)}{nomeDe(importacao.criado_por) ? ` por ${nomeDe(importacao.criado_por)}` : ""}.</p>
        </div>
        <Selo tom={status.tom}>{status.rotulo}</Selo>
      </div>

      {importacao.status === "previa" && (
        <p className="rounded-sm border border-azul-fraco bg-azul-fraco px-3.5 py-2.5 text-sm text-[color:var(--azul)]">
          Esta é a prévia. Nada foi gravado em pessoas ou jornadas ainda — confira os números e a tabela abaixo antes de
          confirmar. Confirmar não sobrescreve pessoa existente e não apaga nenhuma linha.
        </p>
      )}
      {importacao.status === "confirmada" && (
        <p className="text-sm text-tinta-suave">
          Confirmada em {formatarDataHora(importacao.confirmada_em)}
          {nomeDe(importacao.confirmada_por) ? ` por ${nomeDe(importacao.confirmada_por)}` : ""}. Estes são os números
          reais já gravados.
        </p>
      )}
      {importacao.status === "cancelada" && (
        <p className="text-sm text-tinta-suave">Esta prévia foi cancelada — nada dela foi gravado em pessoas ou jornadas.</p>
      )}

      <ResumoImportacao importacao={importacao} />
      <LinhaTotalLinhas total={importacao.total_linhas} />

      {erroAcao && (
        <p role="alert" className="rounded-sm border border-vermelho-fraco bg-vermelho-fraco px-3.5 py-2.5 text-sm text-[color:var(--vermelho)]">
          {erroAcao}
        </p>
      )}

      {importacao.status === "previa" && (
        <div className="flex flex-wrap gap-2">
          <Botao variante="primario" onClick={() => setModalAberto(true)}>
            Confirmar importação…
          </Botao>
          <Botao variante="perigo" carregando={cancelando} onClick={cancelar}>
            Cancelar (abandonar esta prévia)
          </Botao>
        </div>
      )}

      <div>
        <h2 className="mb-2 font-serif text-lg font-semibold text-tinta">Linhas</h2>
        <TabelaLinhasImportacao importacaoId={importacaoId} />
      </div>

      {modalAberto && (
        <ModalConfirmarImportacao
          importacao={importacao}
          confirmando={confirmando}
          erro={erroAcao}
          aoConfirmar={confirmar}
          aoFechar={() => setModalAberto(false)}
        />
      )}
    </div>
  );
}
