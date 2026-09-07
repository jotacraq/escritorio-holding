"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRecurso } from "@/hooks/useRecurso";
import { useToast } from "@/hooks/useToast";
import { Botao } from "@/components/ui/Botao";
import { Campo, Selecao } from "@/components/ui/Campo";
import { Cartao } from "@/components/ui/Cartao";
import { ConfirmarAcao } from "@/components/ui/ConfirmarAcao";
import { EsqueletoLista } from "@/components/ui/Esqueleto";
import { EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { Selo, SeloStub } from "@/components/ui/Selo";
import { formatarDataHora, formatarRelativo } from "@/lib/formatar";
import { buscarPendencias, listarProdutos, reenfileirarMensagem, reprocessarWebhook } from "../adminApi";
import { chamar, mensagemDeErro } from "../http";
import type { PendenciaSistema, ProdutoAdmin, TipoPendenciaSistema } from "@/types/admin";

const ROTULO_TIPO: Record<TipoPendenciaSistema, { titulo: string; descricao: string }> = {
  cron_parado: { titulo: "Régua parada — o cron não passou", descricao: "Nada sai sozinho (e-mail, ligação por IA, sala) até o cron voltar." },
  sessao_sem_sala: { titulo: "Sessão sem link da sala", descricao: "O e-mail do dia fica segurado até alguém colar o link ou a integração responder." },
  webhook_falho: { titulo: "Pagamento que falhou ao processar", descricao: "A Hotmart avisou, o sistema não conseguiu registrar. Venda invisível até resolver." },
  mensagem_falhou: { titulo: "Envio que falhou", descricao: "A régua tentou e o provedor recusou. Reenfileirar manda de novo no próximo ciclo." },
  ligacao_ia_falhou: { titulo: "Ligação por IA falhou", descricao: "Virou tarefa para a equipe ligar — confira na Ficha." },
  link_expirando: { titulo: "Link expirando", descricao: "Link público perto do fim do prazo. Renove pela Ficha se ainda for usado." },
  material_aguardando_aprovacao: { titulo: "Material aguardando aprovação", descricao: "Gerado, mas ninguém aprovou — o cliente não recebe até lá." },
};

/**
 * Tipos que a 0080 acrescenta a `vw_pendencias_sistema` (Fase 7 r3, §B4.1) e o
 * que a 0085 acrescenta (Fase 8, D8). Ficam separados porque
 * `TipoPendenciaSistema` é do backend: enquanto a migration não estiver
 * aplicada, a view não emite a linha e a aba simplesmente não a mostra — nada
 * quebra, e nada é inventado.
 */
type TipoPendenciaLgpd = "expurgo_storage_pendente";
type TipoPendenciaPagamento = "produto_nao_mapeado";

const ROTULO_TIPO_LGPD: Record<TipoPendenciaLgpd, { titulo: string; descricao: string }> = {
  expurgo_storage_pendente: {
    titulo: "Expurgo de arquivos pendente",
    descricao: "O tratamento foi encerrado e o banco já está anonimizado, mas os arquivos do cliente continuam no armazenamento. Enquanto isso, a eliminação não está completa.",
  },
};

const ROTULO_TIPO_PAGAMENTO: Record<TipoPendenciaPagamento, { titulo: string; descricao: string }> = {
  produto_nao_mapeado: {
    titulo: "Venda de produto não mapeado",
    descricao: "A Hotmart avisou de uma compra cujo ID de produto não está ligado a nenhum produto daqui. O dinheiro entrou e a jornada não anda até alguém dizer de qual produto se trata.",
  },
};

/** Ordem de urgência para a Dra. Elaine: o que trava a máquina inteira primeiro. */
const ORDEM: (TipoPendenciaSistema | TipoPendenciaLgpd | TipoPendenciaPagamento)[] = [
  "cron_parado",
  "expurgo_storage_pendente",
  "produto_nao_mapeado",
  "sessao_sem_sala",
  "webhook_falho",
  "mensagem_falhou",
  "ligacao_ia_falhou",
  "material_aguardando_aprovacao",
  "link_expirando",
];

/** Os tipos que pedem o realce vermelho: dinheiro parado ou máquina parada. */
const CRITICOS = new Set<string>(["cron_parado", "webhook_falho", "expurgo_storage_pendente", "produto_nao_mapeado"]);

interface RespostaMapear {
  ok: boolean;
  hotmart_produto_id: string;
  produto: { id: string; nome: string };
}

function mapearProdutoDoWebhook(eventoId: string, produtoId: string) {
  return chamar<RespostaMapear>(`/api/admin/webhooks/${eventoId}/mapear-produto`, {
    method: "POST",
    body: JSON.stringify({ produto_id: produtoId }),
  });
}

function rotuloDe(tipo: string): { titulo: string; descricao: string } {
  const mapa = { ...ROTULO_TIPO, ...ROTULO_TIPO_LGPD, ...ROTULO_TIPO_PAGAMENTO } as Record<string, { titulo: string; descricao: string }>;
  return mapa[tipo] ?? { titulo: tipo.replace(/_/g, " "), descricao: "" };
}

/**
 * Link de ação quando não há botão: a tela que resolve.
 *
 * `expurgo_storage_pendente` é a única linha da view que não tem `jornada_id`
 * (a solicitação é da PESSOA, não de uma jornada), e "#titulares" sozinho
 * abria a aba na tela de busca — quem clicava tinha de adivinhar que o titular
 * agora se chama "Titular anonimizado 3f2a1b9c". O marcador que a
 * `anonimizar_titular` grava (0080:355) é derivado do id da pessoa e por isso
 * é ÚNICO: mandá-lo em `?titular=` faz a aba já abrir a pessoa certa, com a
 * MESMA busca que ela faria à mão — nenhuma consulta nova.
 *
 * `recarrega` marca o único destino que NÃO pode ser `<Link>`: mudar a query
 * junto com o hash faz o Next navegar por `pushState`, e `pushState` não
 * dispara `hashchange` — o `Abas` (`deepLinkHash`) nunca saberia que é para
 * trocar de aba, e o clique não faria nada visível. Os outros destinos são
 * hash puro ou rota diferente, onde `<Link>` funciona.
 */
function destino(item: PendenciaSistema): { href: string; rotulo: string; recarrega?: boolean } | null {
  if (item.tipo === "cron_parado") return { href: "#integracoes", rotulo: "Ver a régua em Integrações" };
  // `produto_nao_mapeado` resolve aqui mesmo, no seletor abaixo. O link é a
  // saída alternativa, para quem prefere editar o produto inteiro.
  if (item.tipo === "produto_nao_mapeado") return { href: "#produtos", rotulo: "Abrir Produtos" };
  if (item.tipo === "expurgo_storage_pendente") {
    if (!item.pessoa_nome) return { href: "#titulares", rotulo: "Concluir o expurgo" };
    return { href: `/admin?titular=${encodeURIComponent(item.pessoa_nome)}#titulares`, rotulo: "Concluir o expurgo", recarrega: true };
  }
  if (item.tipo === "sessao_sem_sala" && item.jornada_id) return { href: `/jornadas/${item.jornada_id}#sessao`, rotulo: "Colar o link da sala" };
  if (item.tipo === "material_aguardando_aprovacao" && item.jornada_id) return { href: `/jornadas/${item.jornada_id}#material`, rotulo: "Aprovar o material" };
  if (item.jornada_id) return { href: `/jornadas/${item.jornada_id}`, rotulo: "Abrir a Ficha" };
  return null;
}

const CLASSE_LINK_ACAO =
  "inline-flex min-h-11 items-center rounded-controle border border-linha-controle bg-papel-elevado px-3.5 text-sm font-medium text-tinta transition-colors duration-[var(--transicao-rapida)] hover:border-[color:var(--latao)] hover:text-[color:var(--latao)]";

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
  /** Id do evento cuja gaveta de mapeamento está aberta, e a escolha atual. */
  const [mapeando, setMapeando] = useState<{ eventoId: string; produtoId: string } | null>(null);
  const [produtos, setProdutos] = useState<ProdutoAdmin[] | null>(null);
  const [erroProdutos, setErroProdutos] = useState<string | null>(null);
  const { notificar } = useToast();

  /**
   * A lista de produtos só é buscada quando alguém abre "Mapear para…" — a aba
   * de Pendências não pode pagar uma chamada a mais em toda visita por causa de
   * um caso que quase nunca aparece.
   */
  async function abrirMapeamento(eventoId: string) {
    setMapeando({ eventoId, produtoId: "" });
    if (produtos) return;
    try {
      const resposta = await listarProdutos();
      const ativos = resposta.itens.filter((p) => p.ativo);
      setProdutos(ativos);
      setErroProdutos(ativos.length === 0 ? "Nenhum produto ativo cadastrado. Cadastre em Admin → Produtos." : null);
    } catch (e) {
      setErroProdutos(mensagemDeErro(e, "Não foi possível carregar os produtos."));
    }
  }

  async function confirmarMapeamento() {
    if (!mapeando || !mapeando.produtoId) return;
    setExecutando(true);
    try {
      const resposta = await mapearProdutoDoWebhook(mapeando.eventoId, mapeando.produtoId);
      notificar({
        tom: "sucesso",
        titulo: "Produto mapeado",
        descricao: `ID ${resposta.hotmart_produto_id} ligado a "${resposta.produto.nome}". O evento foi reprocessado com o produto certo.`,
      });
      setMapeando(null);
      setProdutos(null);
      recarregar();
    } catch (e) {
      notificar({ tom: "erro", titulo: "Não foi possível mapear", descricao: mensagemDeErro(e, "Tente de novo em instantes.") });
    } finally {
      setExecutando(false);
    }
  }

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
    <div className="flex flex-col gap-bloco">
      {/* Fase 7 — a `IntroAba` daqui repetia, PALAVRA POR PALAVRA, a
          `descricao` da aba em `AdminApp.tsx:108` ("O que travou e depende de
          alguém. Cada linha leva à ação que resolve."). A linha de propósito
          da aba já é renderizada pelo `Abas`; a segunda cópia era 46 px de
          eco. As outras abas mantêm a intro porque ela ACRESCENTA (a de Custo
          de IA diz que só execução real conta, por exemplo). */}
      <div className="flex flex-wrap items-center justify-end gap-3">
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
              realce={CRITICOS.has(tipo) ? "vermelho" : "ambar"}
              titulo={rotulo.titulo}
              descricao={rotulo.descricao}
              acao={<Selo tom={CRITICOS.has(tipo) ? "vermelho" : "ambar"}>{itens.length}</Selo>}
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
                        {/* A descrição vem do servidor e pode ser um parágrafo
                            inteiro (o passo a passo do envio automático tem 21
                            linhas a 390 px). O §2 vale também para admin: até
                            2 linhas na tela, o texto inteiro no `title`. */}
                        {item.descricao && (
                          <p className="mt-0.5 line-clamp-2 text-sm text-tinta-suave" title={item.descricao}>
                            {item.descricao}
                          </p>
                        )}
                        {item.ocorrido_em && (
                          <p className="mt-0.5 text-legenda text-tinta-fraca">
                            {formatarRelativo(item.ocorrido_em)} · {formatarDataHora(item.ocorrido_em)}
                          </p>
                        )}
                      </div>
                      {link &&
                        (link.recarrega ? (
                          <a href={link.href} className={CLASSE_LINK_ACAO}>
                            {link.rotulo}
                          </a>
                        ) : (
                          <Link href={link.href} className={CLASSE_LINK_ACAO}>
                            {link.rotulo}
                          </Link>
                        ))}
                      {acaoBotao && (
                        <Botao variante="secundario" tamanho="compacto" onClick={() => setConfirmacao({ tipo: acaoBotao.tipo, item })}>
                          {acaoBotao.rotulo}
                        </Botao>
                      )}
                      {tipo === "produto_nao_mapeado" &&
                        (mapeando?.eventoId === item.id ? (
                          <div className="flex w-full flex-wrap items-end gap-3 border-t border-linha pt-3">
                            <div className="min-w-56 flex-1">
                              <Campo rotulo="Este pagamento é de qual produto?" ajuda="O ID da Hotmart é gravado no produto escolhido e o evento é reprocessado na hora.">
                                <Selecao
                                  value={mapeando.produtoId}
                                  onChange={(e) => setMapeando({ eventoId: item.id, produtoId: e.target.value })}
                                  disabled={produtos === null && erroProdutos === null}
                                >
                                  <option value="">Escolha o produto…</option>
                                  {(produtos ?? []).map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.nome}
                                      {p.hotmart_produto_id ? ` (já tem ID ${p.hotmart_produto_id})` : ""}
                                    </option>
                                  ))}
                                </Selecao>
                              </Campo>
                              {erroProdutos && <p className="mt-1 text-legenda text-[color:var(--vermelho)]">{erroProdutos}</p>}
                            </div>
                            <div className="flex gap-2">
                              <Botao variante="fantasma" tamanho="compacto" onClick={() => setMapeando(null)}>
                                Cancelar
                              </Botao>
                              <Botao
                                variante="primario"
                                tamanho="compacto"
                                carregando={executando}
                                disabled={!mapeando.produtoId}
                                onClick={confirmarMapeamento}
                              >
                                Mapear e reprocessar
                              </Botao>
                            </div>
                          </div>
                        ) : (
                          <Botao variante="secundario" tamanho="compacto" onClick={() => abrirMapeamento(item.id)}>
                            Mapear para…
                          </Botao>
                        ))}
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
