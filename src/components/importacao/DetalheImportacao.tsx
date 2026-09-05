"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { listarEquipe, type MembroEquipe } from "@/lib/api";
import { useRecurso } from "@/hooks/useRecurso";
import { useToast } from "@/hooks/useToast";
import { Botao } from "@/components/ui/Botao";
import { CabecalhoPagina } from "@/components/ui/CabecalhoPagina";
import { Cartao } from "@/components/ui/Cartao";
import { ConfirmarAcao } from "@/components/ui/ConfirmarAcao";
import { EsqueletoFicha } from "@/components/ui/Esqueleto";
import { EstadoErro } from "@/components/ui/Estado";
import { Passos } from "@/components/ui/Passos";
import { Selo } from "@/components/ui/Selo";
import { formatarDataHora } from "@/lib/formatar";
import type { Importacao } from "@/types/importacao";
import { ApiError, buscarImportacao, cancelarImportacao, confirmarImportacao } from "./api";
import { PASSOS_IMPORTACAO, ROTULO_CAMPO, frasePlural, rotuloPergunta } from "./campos";
import { ROTULO_STATUS } from "./ListaImportacoes";
import { ResumoImportacao } from "./ResumoImportacao";
import { TabelaLinhasImportacao } from "./TabelaLinhasImportacao";

/** O efeito por extenso, com os números REAIS desta importação — regra do
 * CLAUDE.md para ação de efeito amplo. Nada de "tem certeza?". */
function efeitoDeConfirmar(i: Importacao): string {
  const grava = `Vai gravar ${frasePlural(i.pessoas_novas, "pessoa nova", "pessoas novas")} e ${frasePlural(i.jornadas_novas, "jornada nova", "jornadas novas")}.`;
  const fora = `Ficam de fora, sem gravar nada: ${frasePlural(i.pessoas_existentes, "pessoa que já participou desta edição", "pessoas que já participaram desta edição")}, ${frasePlural(i.ignoradas, "linha com jornada já aberta", "linhas com jornada já aberta")} e ${frasePlural(i.com_erro, "linha com erro", "linhas com erro")}.`;
  const garantia = "Nenhuma pessoa existente é sobrescrita e nenhuma linha é apagada. Reverter depois exige pedido ao time de tecnologia.";
  const nada = i.pessoas_novas + i.jornadas_novas === 0 ? " Atenção: nenhuma linha vai gerar pessoa ou jornada nova — confirmar só fecha esta importação como processada." : "";
  return `${grava} ${fora} ${garantia}${nada}`;
}

/** Detalhe de UMA importação — serve tanto para a prévia (fase 2: ver o
 * estrago antes de causar) quanto para o resultado já confirmado (mesma
 * tela, porque as duas fases olham exatamente para as mesmas contagens e a
 * mesma tabela de linhas; só o que muda é se o botão "Confirmar" aparece). */
export function DetalheImportacao({ importacaoId }: { importacaoId: string }) {
  const { notificar } = useToast();
  const buscar = useCallback(() => buscarImportacao(importacaoId), [importacaoId]);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, [importacaoId]);

  const [equipe, setEquipe] = useState<MembroEquipe[]>([]);
  useEffect(() => {
    listarEquipe()
      .then((resposta) => setEquipe(resposta?.itens ?? []))
      .catch(() => setEquipe([]));
  }, []);

  const [confirmarAberto, setConfirmarAberto] = useState(false);
  const [cancelarAberto, setCancelarAberto] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [cancelando, setCancelando] = useState(false);

  function nomeDe(id: string | null): string | null {
    if (!id) return null;
    return equipe.find((m) => m.id === id)?.nome ?? null;
  }

  async function confirmar() {
    if (!dados) return;
    setConfirmando(true);
    try {
      const resposta = await confirmarImportacao(importacaoId);
      setConfirmarAberto(false);
      const i = resposta.importacao;
      notificar({
        tom: "sucesso",
        titulo: "Importação confirmada",
        descricao: `${frasePlural(i.pessoas_novas, "pessoa nova", "pessoas novas")} e ${frasePlural(i.jornadas_novas, "jornada nova", "jornadas novas")} gravadas. Elas já aparecem na esteira.`,
      });
      recarregar();
    } catch (e) {
      notificar({
        tom: "erro",
        titulo: "Não foi possível confirmar",
        descricao: e instanceof ApiError ? e.message : "Nada foi gravado. Confira a internet e tente de novo.",
      });
    } finally {
      setConfirmando(false);
    }
  }

  async function cancelar() {
    setCancelando(true);
    try {
      await cancelarImportacao(importacaoId);
      setCancelarAberto(false);
      notificar({ tom: "sucesso", titulo: "Prévia abandonada", descricao: "Nada dela foi gravado. O arquivo continua com você para importar de novo." });
      recarregar();
    } catch (e) {
      notificar({
        tom: "erro",
        titulo: "Não foi possível abandonar a prévia",
        descricao: e instanceof ApiError ? e.message : "Confira a internet e tente de novo.",
      });
    } finally {
      setCancelando(false);
    }
  }

  if (carregando) return <EsqueletoFicha rotulo="Carregando a importação…" />;
  if (erro || !dados) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não deu para carregar esta importação" />;

  const importacao = dados.importacao;
  const status = ROTULO_STATUS[importacao.status];
  const ehPrevia = importacao.status === "previa";
  const mapa = Object.entries(importacao.mapa_colunas);
  const perguntas = importacao.perguntas_seminario ?? [];

  return (
    <div className="flex flex-col gap-8">
      <CabecalhoPagina
        rotulo="Administração · Importações"
        acima={
          <Link href="/importacoes" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-[color:var(--latao)] underline-offset-4 hover:underline">
            ← Todas as importações
          </Link>
        }
        titulo={importacao.arquivo_nome}
        descricao={
          ehPrevia
            ? "Esta é a prévia: nada foi gravado em pessoas ou jornadas ainda. Confira os números e a lista antes de confirmar."
            : importacao.status === "confirmada"
              ? "Importação gravada. Os números abaixo são o que de fato entrou no sistema."
              : "Esta prévia foi abandonada — nada dela foi gravado em pessoas ou jornadas."
        }
        meta={
          <>
            <Selo tom={status.tom}>{status.rotulo}</Selo>
            <span>
              Criada em {formatarDataHora(importacao.criado_em)}
              {nomeDe(importacao.criado_por) ? ` por ${nomeDe(importacao.criado_por)}` : ""}
            </span>
            {importacao.status === "confirmada" && (
              <span>
                · Confirmada em {formatarDataHora(importacao.confirmada_em)}
                {nomeDe(importacao.confirmada_por) ? ` por ${nomeDe(importacao.confirmada_por)}` : ""}
              </span>
            )}
          </>
        }
        acoes={
          ehPrevia ? (
            <>
              <Botao variante="perigo" onClick={() => setCancelarAberto(true)} carregando={cancelando}>
                Abandonar prévia
              </Botao>
              <Botao variante="primario" onClick={() => setConfirmarAberto(true)} carregando={confirmando}>
                Confirmar importação
              </Botao>
            </>
          ) : undefined
        }
      />

      {ehPrevia ? (
        <Passos passos={[...PASSOS_IMPORTACAO]} atual="confirmar" rotulo="Etapas da importação" />
      ) : (
        <Cartao realce={importacao.status === "confirmada" ? "verde" : undefined} preenchimento="compacto">
          <p className="text-sm text-tinta-suave">
            {importacao.status === "confirmada" ? (
              <>
                <strong className="font-bold text-tinta">Concluída.</strong> As pessoas novas já estão na esteira, na etapa de entrada da edição.{" "}
                <Link href="/esteira" className="font-medium text-[color:var(--latao)] underline-offset-4 hover:underline">
                  Abrir a esteira
                </Link>
              </>
            ) : (
              <>
                <strong className="font-bold text-tinta">Cancelada.</strong> Para importar este arquivo, comece uma{" "}
                <Link href="/importacoes/nova" className="font-medium text-[color:var(--latao)] underline-offset-4 hover:underline">
                  nova importação
                </Link>
                .
              </>
            )}
          </p>
        </Cartao>
      )}

      <ResumoImportacao importacao={importacao} />

      <Cartao rotulo="Mapeamento usado" titulo="O que cada coluna virou" descricao="Guardado com a importação — dá para reaproveitar na próxima planilha com o mesmo layout.">
        {mapa.length === 0 && perguntas.length === 0 ? (
          <p className="text-sm text-tinta-fraca">Nenhuma coluna mapeada.</p>
        ) : (
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {mapa.map(([coluna, campo]) => (
              <div key={coluna} className="flex min-h-11 flex-wrap items-center gap-x-2 border-b border-linha py-2 last:border-0 sm:last:border-b">
                <dt className="text-tinta-suave">{coluna}</dt>
                <dd className="flex items-center gap-2 font-medium text-tinta">
                  <span aria-hidden="true" className="text-tinta-fraca">→</span>
                  {ROTULO_CAMPO[campo].replace(" (obrigatório)", "")}
                </dd>
              </div>
            ))}
            {perguntas.map((coluna) => (
              <div key={`pergunta-${coluna}`} className="flex min-h-11 flex-wrap items-center gap-x-2 border-b border-linha py-2 last:border-0 sm:last:border-b">
                <dt className="text-tinta-suave">{coluna}</dt>
                <dd className="flex items-center gap-2 font-medium text-tinta">
                  <span aria-hidden="true" className="text-tinta-fraca">→</span>
                  <Selo tom="latao">{rotuloPergunta(coluna)}</Selo>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </Cartao>

      <TabelaLinhasImportacao importacaoId={importacaoId} />

      <ConfirmarAcao
        aberto={confirmarAberto}
        titulo="Confirmar esta importação?"
        efeito={efeitoDeConfirmar(importacao)}
        rotuloConfirmar="Confirmar importação"
        rotuloCancelar="Voltar"
        confirmando={confirmando}
        aoConfirmar={() => void confirmar()}
        aoCancelar={() => setConfirmarAberto(false)}
      />

      <ConfirmarAcao
        aberto={cancelarAberto}
        titulo="Abandonar esta prévia?"
        efeito="A prévia é marcada como cancelada e sai da lista de pendentes. Nada dela é gravado em pessoas ou jornadas. Para importar este arquivo depois, será preciso subir e mapear de novo."
        rotuloConfirmar="Abandonar prévia"
        rotuloCancelar="Manter prévia"
        perigo
        confirmando={cancelando}
        aoConfirmar={() => void cancelar()}
        aoCancelar={() => setCancelarAberto(false)}
      />
    </div>
  );
}
