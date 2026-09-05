"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRecurso } from "@/hooks/useRecurso";
import { useToast } from "@/hooks/useToast";
import { Botao } from "@/components/ui/Botao";
import { Cartao } from "@/components/ui/Cartao";
import { ConfirmarAcao } from "@/components/ui/ConfirmarAcao";
import { EsqueletoLista } from "@/components/ui/Esqueleto";
import { EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { Selo, SeloStub } from "@/components/ui/Selo";
import { formatarDataHora, formatarRelativo } from "@/lib/formatar";
import { buscarPendencias, reenfileirarMensagem, reprocessarWebhook } from "../adminApi";
import { mensagemDeErro } from "../http";
import { IntroAba } from "../comum";
import type { PendenciaSistema, TipoPendenciaSistema } from "@/types/admin";

const ROTULO_TIPO: Record<TipoPendenciaSistema, { titulo: string; descricao: string }> = {
  cron_parado: { titulo: "Régua parada — o cron não passou", descricao: "Nada sai sozinho (e-mail, ligação por IA, sala) até o cron voltar." },
  sessao_sem_sala: { titulo: "Sessão sem link da sala", descricao: "O e-mail do dia fica segurado até alguém colar o link ou a integração responder." },
  webhook_falho: { titulo: "Pagamento que falhou ao processar", descricao: "A Hotmart avisou, o sistema não conseguiu registrar. Venda invisível até resolver." },
  mensagem_falhou: { titulo: "Envio que falhou", descricao: "A régua tentou e o provedor recusou. Reenfileirar manda de novo no próximo ciclo." },
  ligacao_ia_falhou: { titulo: "Ligação por IA falhou", descricao: "Virou tarefa para a equipe ligar — confira na Ficha." },
  link_expirando: { titulo: "Link expirando", descricao: "Link público perto do fim do prazo. Renove pela Ficha se ainda for usado." },
  material_aguardando_aprovacao: { titulo: "Material aguardando aprovação", descricao: "Gerado, mas ninguém aprovou — o cliente não recebe até lá." },
};

/** Ordem de urgência para a Dra. Elaine: o que trava a máquina inteira primeiro. */
const ORDEM: TipoPendenciaSistema[] = ["cron_parado", "sessao_sem_sala", "webhook_falho", "mensagem_falhou", "ligacao_ia_falhou", "material_aguardando_aprovacao", "link_expirando"];

function rotuloDe(tipo: string): { titulo: string; descricao: string } {
  return (ROTULO_TIPO as Record<string, { titulo: string; descricao: string }>)[tipo] ?? { titulo: tipo.replace(/_/g, " "), descricao: "" };
}

/** Link de ação quando não há botão: a tela que resolve. */
function destino(item: PendenciaSistema): { href: string; rotulo: string } | null {
  if (item.tipo === "cron_parado") return { href: "#integracoes", rotulo: "Ver a régua em Integrações" };
  if (item.tipo === "sessao_sem_sala" && item.jornada_id) return { href: `/jornadas/${item.jornada_id}#sessao`, rotulo: "Colar o link da sala" };
  if (item.tipo === "material_aguardando_aprovacao" && item.jornada_id) return { href: `/jornadas/${item.jornada_id}#material`, rotulo: "Aprovar o material" };
  if (item.jornada_id) return { href: `/jornadas/${item.jornada_id}`, rotulo: "Abrir a Ficha" };
  return null;
}

type Confirmacao = { tipo: "webhook" | "mensagem"; item: PendenciaSistema } | null;

/**
 * A aba mais valiosa: o que travou e só apareceria rodando SQL à mão.
 * É FILA — cada item leva a uma ação. Tipos vêm de `vw_pendencias_sistema`
 * (0031 + 0052 + 0053); um tipo que a tela não conhece vira texto legível,
 * nunca derruba a aba.
 */
export function PendenciasAba() {
  const buscar = useCallback(() => buscarPendencias(), []);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, []);
  const [confirmacao, setConfirmacao] = useState<Confirmacao>(null);
  const [executando, setExecutando] = useState(false);
  const { notificar } = useToast();

  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível carregar as pendências" />;
  if (carregando && !dados) return <EsqueletoLista linhas={4} rotulo="Carregando pendências…" />;
  if (!dados) return null;

  const tiposPresentes = Array.from(new Set(dados.sistema.map((i) => i.tipo)));
  const tiposOrdenados = [...ORDEM.filter((t) => tiposPresentes.includes(t)), ...tiposPresentes.filter((t) => !(ORDEM as string[]).includes(t))];

  async function executarConfirmacao() {
    if (!confirmacao) return;
    setExecutando(true);
    try {
      if (confirmacao.tipo === "webhook") {
        await reprocessarWebhook(confirmacao.item.id);
        notificar({ tom: "sucesso", titulo: "Webhook reprocessado", descricao: `"${confirmacao.item.titulo}" foi lido de novo a partir do que a Hotmart mandou.` });
      } else {
        await reenfileirarMensagem(confirmacao.item.id);
        notificar({ tom: "sucesso", titulo: "Mensagem reenfileirada", descricao: "Volta para pendente; o próximo ciclo do cron tenta enviar." });
      }
      setConfirmacao(null);
      recarregar();
    } catch (e) {
      notificar({ tom: "erro", titulo: "Não foi possível executar", descricao: mensagemDeErro(e, "Tente de novo em instantes.") });
    } finally {
      setExecutando(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <IntroAba>O que travou e depende de alguém. Cada linha leva à ação que resolve.</IntroAba>
        <Botao variante="secundario" tamanho="compacto" carregando={carregando} onClick={recarregar}>
          Atualizar
        </Botao>
      </div>

      {dados.sistema.length === 0 ? (
        <EstadoVazio ilustracao="sucesso" titulo="Nada travado no momento" descricao="Pagamentos processados, régua rodando, sessões com sala. Volte aqui quando o Painel do Dia apontar algo." />
      ) : (
        tiposOrdenados.map((tipo) => {
          const itens = dados.sistema.filter((i) => i.tipo === tipo);
          const rotulo = rotuloDe(tipo);
          const acaoBotao = tipo === "webhook_falho" ? { rotulo: "Reprocessar", tipo: "webhook" as const } : tipo === "mensagem_falhou" ? { rotulo: "Reenfileirar", tipo: "mensagem" as const } : null;
          return (
            <Cartao
              key={tipo}
              preenchimento="sem"
              realce={tipo === "cron_parado" || tipo === "webhook_falho" ? "vermelho" : "ambar"}
              titulo={rotulo.titulo}
              descricao={rotulo.descricao}
              acao={<Selo tom={tipo === "cron_parado" || tipo === "webhook_falho" ? "vermelho" : "ambar"}>{itens.length}</Selo>}
            >
              <ul className="divide-y divide-linha">
                {itens.map((item) => {
                  const link = destino(item);
                  return (
                    <li key={`${item.tipo}-${item.id}`} className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-4 sm:px-6">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-tinta">
                          {item.titulo}
                          {item.pessoa_nome && <span className="font-normal text-tinta-suave"> · {item.pessoa_nome}</span>}
                        </p>
                        {item.descricao && <p className="mt-0.5 text-sm text-tinta-suave">{item.descricao}</p>}
                        {item.ocorrido_em && (
                          <p className="mt-0.5 text-xs text-tinta-fraca">
                            {formatarRelativo(item.ocorrido_em)} · {formatarDataHora(item.ocorrido_em)}
                          </p>
                        )}
                      </div>
                      {link && (
                        <Link
                          href={link.href}
                          className="inline-flex min-h-11 items-center rounded-controle border border-linha-controle bg-papel-elevado px-3.5 text-sm font-medium text-tinta transition-colors duration-[var(--transicao-rapida)] hover:border-[color:var(--latao)] hover:text-[color:var(--latao)]"
                        >
                          {link.rotulo}
                        </Link>
                      )}
                      {acaoBotao && (
                        <Botao variante="secundario" tamanho="compacto" onClick={() => setConfirmacao({ tipo: acaoBotao.tipo, item })}>
                          {acaoBotao.rotulo}
                        </Botao>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Cartao>
          );
        })
      )}

      {dados.materiais_aguardando_aprovacao.disponivel === false && !tiposPresentes.includes("material_aguardando_aprovacao") && (
        <SeloStub texto={`Materiais aguardando aprovação: ${dados.materiais_aguardando_aprovacao.motivo}`} />
      )}

      <ConfirmarAcao
        aberto={confirmacao !== null}
        titulo={confirmacao?.tipo === "webhook" ? "Reprocessar webhook" : "Reenfileirar mensagem"}
        efeito={
          confirmacao?.tipo === "webhook"
            ? `Lê de novo o evento "${confirmacao.item.titulo}" a partir do que a Hotmart já mandou e registra o pagamento se a assinatura for válida. Não pede nada à Hotmart.`
            : `Volta a mensagem "${confirmacao?.item.titulo}" para pendente. O próximo ciclo do cron da régua tenta enviar de novo.`
        }
        rotuloConfirmar={confirmacao?.tipo === "webhook" ? "Reprocessar" : "Reenfileirar"}
        confirmando={executando}
        aoConfirmar={executarConfirmacao}
        aoCancelar={() => setConfirmacao(null)}
      />
    </div>
  );
}
