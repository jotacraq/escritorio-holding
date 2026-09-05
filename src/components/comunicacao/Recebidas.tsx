"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { listarJornadas, type JornadaKanban } from "@/lib/api";
import { useToast } from "@/hooks/useToast";
import { Botao } from "@/components/ui/Botao";
import { Campo, Entrada } from "@/components/ui/Campo";
import { Cartao } from "@/components/ui/Cartao";
import { EsqueletoLista } from "@/components/ui/Esqueleto";
import { EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { Gaveta } from "@/components/ui/Gaveta";
import { Selo, SeloStub } from "@/components/ui/Selo";
import { formatarDataHora, formatarRelativo, formatarTelefone } from "@/lib/formatar";
import { rotulo, titleDe } from "@/lib/vocabulario";
import { mensagemDeErro } from "@/components/admin/http";
import { vincularMensagemRecebida, type MensagemRecebidaItem, type RespostaMensagensRecebidas } from "./api-comunicacao";

interface Props {
  dados: RespostaMensagensRecebidas | undefined;
  carregando: boolean;
  erro: unknown;
  recarregar: () => void;
}

/**
 * Caixa de entrada do WhatsApp (Chatwoot → `mensagens_recebidas`, 0054).
 * Telefone que casou mostra a pessoa; sem correspondência, "Vincular a uma
 * pessoa" abre a busca. Tabela ausente no banco = "ainda não disponível"
 * rotulado, nunca lista vazia disfarçada.
 */
export function Recebidas({ dados, carregando, erro, recarregar }: Props) {
  const [vinculando, setVinculando] = useState<MensagemRecebidaItem | null>(null);

  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível carregar as mensagens recebidas" />;
  if (carregando && !dados) return <EsqueletoLista linhas={3} rotulo="Carregando mensagens recebidas…" />;
  if (!dados) return null;

  if (!dados.disponivel) {
    // O nome da tabela e o número da migration são conserto de admin (§9.2):
    // ficam no `title`, não no fluxo de quem só queria ler uma resposta.
    return (
      <div title="Tabela mensagens_recebidas (migration 0054) ausente neste banco.">
        <SeloStub texto="Mensagens recebidas ainda não disponíveis." />
      </div>
    );
  }

  if (dados.itens.length === 0) {
    return (
      <EstadoVazio
        ilustracao="busca"
        titulo="Nenhuma mensagem recebida"
        acao={
          <Link
            href="/admin#integracoes"
            className="inline-flex min-h-11 items-center rounded-controle border border-linha-controle bg-papel-elevado px-3.5 text-sm font-medium text-tinta hover:border-[color:var(--latao)] hover:text-[color:var(--latao)]"
          >
            Ver integrações
          </Link>
        }
      />
    );
  }

  const semVinculo = dados.itens.filter((m) => !m.pessoa_id).length;

  return (
    <>
      <Cartao
        preenchimento="sem"
        titulo="Recebidas pelo WhatsApp"
        acao={semVinculo > 0 ? <Selo tom="ambar">{semVinculo} sem pessoa</Selo> : <Selo tom="verde">Todas vinculadas</Selo>}
      >
        <ul className="divide-y divide-linha">
          {dados.itens.map((item) => (
            <li key={item.id} className="flex flex-col gap-2 px-5 py-4 sm:px-6">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {item.pessoa_id ? (
                  <Link
                    href={item.jornada_id ? `/jornadas/${item.jornada_id}` : "#"}
                    aria-disabled={!item.jornada_id}
                    className="text-corpo font-bold text-tinta underline-offset-2 hover:underline"
                  >
                    {item.pessoa_nome ?? "Pessoa vinculada"}
                  </Link>
                ) : (
                  <span className="text-corpo font-bold text-tinta">{item.telefone ? formatarTelefone(item.telefone) : "Sem telefone"}</span>
                )}
                {item.pessoa_id ? (
                  <span className="text-sm text-tinta-fraca">{item.telefone ? formatarTelefone(item.telefone) : ""}</span>
                ) : (
                  <Selo tom="ambar">Sem correspondência</Selo>
                )}
                <time dateTime={item.recebida_em} className="text-xs text-tinta-fraca" title={formatarDataHora(item.recebida_em)}>
                  {formatarRelativo(item.recebida_em)}
                </time>
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-tinta">{item.corpo}</p>
              {item.anexos.length > 0 && (
                <p className="text-xs text-tinta-fraca" title={`Anexo abre na ${rotulo("provedor_whatsapp")} (${titleDe("provedor_whatsapp")}).`}>
                  {item.anexos.length} anexo{item.anexos.length === 1 ? "" : "s"}
                </p>
              )}
              {!item.pessoa_id && (
                <div>
                  <Botao variante="secundario" tamanho="compacto" onClick={() => setVinculando(item)}>
                    Vincular a uma pessoa
                  </Botao>
                </div>
              )}
              {item.pessoa_id && item.vinculada_em && (
                <p className="text-xs text-tinta-fraca">Vinculada à mão em {formatarDataHora(item.vinculada_em)}</p>
              )}
            </li>
          ))}
        </ul>
      </Cartao>

      <VincularPessoa
        key={vinculando?.id ?? "fechada"}
        mensagem={vinculando}
        aoFechar={() => setVinculando(null)}
        aoVincular={() => {
          setVinculando(null);
          recarregar();
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Gaveta: buscar a pessoa e vincular
// ---------------------------------------------------------------------------

const MINIMO_LETRAS = 2;
const ATRASO_MS = 350;

interface PessoaEncontrada {
  pessoa_id: string;
  nome: string;
  telefone: string | null;
  cidade: string | null;
  uf: string | null;
  jornada_id: string;
  desfecho: JornadaKanban["desfecho"];
}

/** A busca já existe em `GET /api/jornadas?busca=` (RPC `buscar_pessoas_por_termo`, índice full-text). Uma pessoa por linha. */
function unicasPorPessoa(itens: JornadaKanban[]): PessoaEncontrada[] {
  const vistas = new Map<string, PessoaEncontrada>();
  for (const j of itens) {
    const atual = vistas.get(j.pessoa_id);
    // Prefere a jornada aberta (é a que a RPC de vínculo vai carimbar).
    if (!atual || (atual.desfecho !== "aberta" && j.desfecho === "aberta")) {
      vistas.set(j.pessoa_id, { pessoa_id: j.pessoa_id, nome: j.nome, telefone: j.telefone, cidade: j.cidade, uf: j.uf, jornada_id: j.id, desfecho: j.desfecho });
    }
  }
  return Array.from(vistas.values());
}

/** O pai passa `key={mensagem.id}`: cada mensagem remonta a gaveta com estado limpo. */
function VincularPessoa({
  mensagem,
  aoFechar,
  aoVincular,
}: {
  mensagem: MensagemRecebidaItem | null;
  aoFechar: () => void;
  aoVincular: () => void;
}) {
  const { notificar } = useToast();
  const [termo, setTermo] = useState("");
  const [resultados, setResultados] = useState<PessoaEncontrada[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [escolhida, setEscolhida] = useState<PessoaEncontrada | null>(null);
  const [salvando, setSalvando] = useState(false);
  const controladorRef = useRef<AbortController | null>(null);

  const aberta = mensagem !== null;

  const buscar = useCallback(async (texto: string) => {
    controladorRef.current?.abort();
    const controlador = new AbortController();
    controladorRef.current = controlador;
    setBuscando(true);
    try {
      const resposta = await listarJornadas({ busca: texto, incluir_fechadas: true });
      if (controlador.signal.aborted) return;
      setResultados(unicasPorPessoa(resposta.itens));
    } catch {
      if (!controlador.signal.aborted) setResultados([]);
    } finally {
      if (!controlador.signal.aborted) setBuscando(false);
    }
  }, []);

  // Só agenda a busca; o estado "menos de 2 letras" é decidido no handler do input.
  useEffect(() => {
    const limpo = termo.trim();
    if (!aberta || limpo.length < MINIMO_LETRAS) return;
    const id = window.setTimeout(() => buscar(limpo), ATRASO_MS);
    return () => window.clearTimeout(id);
  }, [termo, aberta, buscar]);

  function aoDigitar(texto: string) {
    setTermo(texto);
    if (texto.trim().length < MINIMO_LETRAS) {
      controladorRef.current?.abort();
      setResultados(null);
      setBuscando(false);
    }
  }

  async function confirmar() {
    if (!mensagem || !escolhida) return;
    setSalvando(true);
    try {
      await vincularMensagemRecebida(mensagem.id, escolhida.pessoa_id);
      notificar({ tom: "sucesso", titulo: "Mensagem vinculada", descricao: `Agora aparece na linha do tempo de ${escolhida.nome}.` });
      aoVincular();
    } catch (erro) {
      notificar({ tom: "erro", titulo: "Não foi possível vincular", descricao: mensagemDeErro(erro, "Tente de novo em instantes.") });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Gaveta
      aberta={aberta}
      aoFechar={aoFechar}
      rotulo={mensagem?.telefone ? formatarTelefone(mensagem.telefone) : "Mensagem recebida"}
      titulo="Vincular a uma pessoa"
      descricao="Busque pelo nome."
      rodape={
        <div className="flex justify-end gap-2">
          <Botao variante="fantasma" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao variante="primario" disabled={!escolhida} carregando={salvando} onClick={confirmar}>
            Vincular
          </Botao>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {mensagem && <blockquote className="whitespace-pre-wrap rounded-controle bg-papel px-4 py-3 text-sm leading-relaxed text-tinta">{mensagem.corpo}</blockquote>}
        <Campo rotulo="Quem mandou?" ajuda="Pelo menos 2 letras do nome.">
          <Entrada type="search" value={termo} onChange={(e) => aoDigitar(e.target.value)} placeholder="Nome da pessoa" autoComplete="off" />
        </Campo>
        <div aria-live="polite" className="flex flex-col gap-2">
          {buscando && <p className="text-sm text-tinta-suave">Buscando…</p>}
          {!buscando && resultados && resultados.length === 0 && (
            <EstadoVazio
              compacto
              titulo="Ninguém com esse nome"
              acao={
                <Link href="/esteira" className="min-h-11 text-sm font-medium text-[color:var(--latao)] underline-offset-2 hover:underline">
                  Criar no caminho do cliente
                </Link>
              }
            />
          )}
          {resultados && resultados.length > 0 && (
            <ul className="flex flex-col gap-2" role="radiogroup" aria-label="Pessoas encontradas">
              {resultados.map((pessoa) => {
                const marcada = escolhida?.pessoa_id === pessoa.pessoa_id;
                return (
                  <li key={pessoa.pessoa_id}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={marcada}
                      onClick={() => setEscolhida(pessoa)}
                      className={`flex min-h-11 w-full flex-col items-start gap-0.5 rounded-controle border px-4 py-2.5 text-left transition-colors duration-[var(--transicao-rapida)] ${
                        marcada ? "border-[color:var(--latao)] bg-latao-fraco" : "border-linha-forte bg-papel-elevado hover:border-[color:var(--latao)]"
                      }`}
                    >
                      <span className="text-sm font-bold text-tinta">{pessoa.nome}</span>
                      <span className="text-xs text-tinta-suave">
                        {pessoa.telefone ? formatarTelefone(pessoa.telefone) : "sem telefone"}
                        {pessoa.cidade ? ` · ${pessoa.cidade}${pessoa.uf ? `/${pessoa.uf}` : ""}` : ""}
                        {pessoa.desfecho !== "aberta" ? ` · jornada ${pessoa.desfecho}` : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Gaveta>
  );
}
