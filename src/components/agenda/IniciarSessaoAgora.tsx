"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { criarAgendamento, listarJornadas, ApiError, type JornadaKanban } from "@/lib/api";
import { formatarCidadeUf } from "@/lib/formatar";
import { useToast } from "@/hooks/useToast";
import { Botao } from "@/components/ui/Botao";
import { Campo, Entrada } from "@/components/ui/Campo";
import { Gaveta } from "@/components/ui/Gaveta";
import { gravarLinkSala, linkSalaValido } from "@/components/ficha360/api-sessao";

/**
 * "Iniciar sessão agora" (15/09/2026) — o par do Google Meet: "Nova reunião"
 * ao lado de "Agendar". Ela já abriu o Meet/Zoom com o cliente e cola o link
 * aqui; o sistema cria o agendamento com `inicio_em = agora` e leva direto
 * para `/sessoes/{jornadaId}/conduzir` — sem gerar sala sozinho (decisão do
 * dono: `configuracoes['sala.provedor'] = 'manual'` continua valendo).
 *
 * NENHUM conceito novo no banco: `POST /api/jornadas/[id]/agendamentos` já
 * cria a `sessoes_viabilidade` (1:1 com a jornada) na primeira vez, e um
 * `agendamento` com `origem='equipe'`, `status='agendado'` — a MESMA rota do
 * fluxo "Marcar sessão". A sessão imediata continua aparecendo na agenda, nas
 * métricas e na esteira porque é a mesma tabela, a mesma linha.
 *
 * `fim_em` fica de fora do corpo: o servidor calcula com
 * `configuracoes['agenda.duracao_padrao_minutos']` (ver
 * `src/app/api/jornadas/[id]/agendamentos/route.ts`) — o navegador não lê
 * config de banco.
 *
 * DECISÃO — sessão futura já marcada para o mesmo cliente: a `EXCLUDE
 * CONSTRAINT` (`0008_sessoes_agendamentos_relatorios.sql:36`) trava por
 * ADVOGADA × intervalo de horário, não por jornada/sessão. Então iniciar
 * "agora" enquanto existe um agendamento futuro do MESMO cliente não colide
 * (datas diferentes) e cria um SEGUNDO `agendamentos` ligado à mesma sessão
 * (1:N, o mesmo mecanismo da remarcação — comentário da migration 0104).
 * O agendamento futuro NÃO muda de status sozinho: ele continua
 * agendado/confirmado, e quem decide cancelá-lo ou remarcá-lo é a equipe, na
 * linha da Agenda — a sessão de agora não apaga nem reescreve o compromisso
 * futuro em silêncio.
 */

const MIN_CARACTERES_BUSCA = 2;
const ATRASO_DEBOUNCE_MS = 250;

function jornadaParaOpcao(j: JornadaKanban): { id: string; rotulo: string; descricao: string } {
  const detalhe = [formatarCidadeUf(j.cidade, j.uf), j.faixa_patrimonio_declarada].filter(Boolean).join(" · ");
  return { id: j.id, rotulo: j.nome, descricao: detalhe || j.origem };
}

export function IniciarSessaoAgora({ className }: { className?: string } = {}) {
  const router = useRouter();
  const { notificar } = useToast();
  const [aberta, setAberta] = useState(false);
  const [consulta, setConsulta] = useState("");
  const [escolhida, setEscolhida] = useState<{ id: string; rotulo: string } | null>(null);
  const [resultados, setResultados] = useState<{ id: string; rotulo: string; descricao: string }[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [erroBusca, setErroBusca] = useState<string | null>(null);
  const [linkSala, setLinkSala] = useState("");
  const [erroLink, setErroLink] = useState<string | null>(null);
  const [erroCliente, setErroCliente] = useState<string | null>(null);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [iniciando, setIniciando] = useState(false);
  const inputBuscaRef = useRef<HTMLInputElement>(null);
  const idListaBusca = useId();

  function abrir() {
    setConsulta("");
    setEscolhida(null);
    setResultados([]);
    setErroBusca(null);
    setLinkSala("");
    setErroLink(null);
    setErroCliente(null);
    setErroEnvio(null);
    setAberta(true);
  }

  function fechar() {
    if (iniciando) return;
    setAberta(false);
  }

  // Busca de cliente — mesma fonte da paleta de comandos (`/api/jornadas`),
  // sem endpoint novo (Ctrl+K já faz essa busca em `PaletaComandos.tsx`).
  useEffect(() => {
    if (!aberta || escolhida) return;
    const termo = consulta.trim();
    if (termo.length < MIN_CARACTERES_BUSCA) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setResultados([]);
      setBuscando(false);
      setErroBusca(null);
      /* eslint-enable react-hooks/set-state-in-effect */
      return;
    }
    let vivo = true;
    setBuscando(true);
    const temporizador = window.setTimeout(() => {
      listarJornadas({ busca: termo, incluir_fechadas: true })
        .then((res) => {
          if (!vivo) return;
          setResultados(res.itens.slice(0, 8).map(jornadaParaOpcao));
          setErroBusca(null);
        })
        .catch((e) => {
          if (!vivo) return;
          setResultados([]);
          setErroBusca(e instanceof ApiError ? e.message : "Não foi possível buscar agora. Tente de novo em instantes.");
        })
        .finally(() => {
          if (vivo) setBuscando(false);
        });
    }, ATRASO_DEBOUNCE_MS);
    return () => {
      vivo = false;
      window.clearTimeout(temporizador);
    };
  }, [consulta, aberta, escolhida]);

  async function iniciar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!escolhida) {
      setErroCliente("Escolha o cliente da sessão.");
      return;
    }
    let linkValidado: string | null = null;
    if (linkSala.trim()) {
      linkValidado = linkSalaValido(linkSala);
      if (!linkValidado) {
        setErroLink("Cole o endereço completo da sala, começando com https:// (Zoom, Meet ou Teams).");
        return;
      }
    }

    setIniciando(true);
    setErroEnvio(null);
    try {
      await criarAgendamento(escolhida.id, { inicio_em: new Date().toISOString() });
      // Link é melhor-esforço: a sessão já nasceu mesmo se a gravação do link
      // falhar — não travar "iniciar agora" por causa de um campo opcional.
      if (linkValidado) {
        try {
          await gravarLinkSala(escolhida.id, linkValidado);
        } catch {
          notificar({ tom: "erro", titulo: "A sessão começou, mas o link da sala não foi salvo", descricao: "Cole o link de novo na Ficha 360, aba Sessão." });
        }
      }
      notificar({ tom: "sucesso", titulo: "Sessão iniciada", descricao: escolhida.rotulo });
      setAberta(false);
      router.push(`/sessoes/${escolhida.id}/conduzir`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Exclusion constraint (23P01, `route.ts`): a advogada já tem outro
        // horário sobreposto. Mensagem específica, nunca genérica.
        setErroEnvio(`Conflito de horário: ${e.message}`);
      } else {
        setErroEnvio(e instanceof ApiError ? e.message : "Não foi possível iniciar a sessão. Confira a internet e tente de novo.");
      }
    } finally {
      setIniciando(false);
    }
  }

  return (
    <>
      <Botao variante="primario" onClick={abrir} className={className}>
        Iniciar sessão agora
      </Botao>

      <Gaveta aberta={aberta} aoFechar={fechar} titulo="Iniciar sessão agora" descricao="Marca o horário como agora mesmo e leva direto para conduzir.">
        <form noValidate onSubmit={iniciar} className="flex flex-col gap-5">
          {!escolhida ? (
            <Campo rotulo="Cliente" erro={erroCliente} obrigatorio ajuda="Nome do cliente ou da jornada.">
              <Entrada
                ref={inputBuscaRef}
                role="combobox"
                aria-expanded={resultados.length > 0}
                aria-controls={idListaBusca}
                aria-autocomplete="list"
                value={consulta}
                onChange={(e) => {
                  setConsulta(e.target.value);
                  setErroCliente(null);
                }}
                placeholder="Digite ao menos 2 letras…"
                autoComplete="off"
              />
            </Campo>
          ) : (
            <Campo rotulo="Cliente" obrigatorio>
              <div className="flex min-h-11 items-center justify-between gap-2 rounded-controle border border-linha-controle bg-papel-elevado px-3.5 py-2">
                <span className="text-sm font-medium text-tinta">{escolhida.rotulo}</span>
                <Botao
                  variante="fantasma"
                  tamanho="compacto"
                  onClick={() => {
                    setEscolhida(null);
                    setConsulta("");
                    window.setTimeout(() => inputBuscaRef.current?.focus(), 0);
                  }}
                >
                  Trocar
                </Botao>
              </div>
            </Campo>
          )}

          {!escolhida && (
            <ul id={idListaBusca} role="listbox" aria-label="Clientes encontrados" className="flex flex-col gap-1 empty:hidden">
              {buscando && (
                <li role="presentation" className="flex items-center gap-2 px-1 py-2 text-sm text-tinta-suave">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-linha-forte border-t-[color:var(--latao-cta)]" aria-hidden="true" />
                  Buscando…
                </li>
              )}
              {!buscando && erroBusca && (
                <li role="presentation" className="px-1 py-2 text-sm text-[color:var(--vermelho)]">
                  {erroBusca}
                </li>
              )}
              {!buscando &&
                !erroBusca &&
                resultados.map((opcao) => (
                  <li key={opcao.id} role="presentation">
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => {
                        setEscolhida({ id: opcao.id, rotulo: opcao.rotulo });
                        setErroCliente(null);
                      }}
                      className="flex min-h-11 w-full flex-col items-start gap-0.5 rounded-controle border border-linha px-3 py-2 text-left transition-colors duration-[var(--transicao-rapida)] hover:border-[color:var(--latao)] hover:bg-papel"
                    >
                      <span className="text-sm font-medium text-tinta">{opcao.rotulo}</span>
                      {opcao.descricao && <span className="text-legenda text-tinta-suave">{opcao.descricao}</span>}
                    </button>
                  </li>
                ))}
              {!buscando && !erroBusca && consulta.trim().length >= MIN_CARACTERES_BUSCA && resultados.length === 0 && (
                <li role="presentation" className="px-1 py-2 text-sm text-tinta-suave">
                  Nenhum cliente com &ldquo;{consulta.trim()}&rdquo;.
                </li>
              )}
            </ul>
          )}

          <Campo
            rotulo="Link da sala"
            erro={erroLink}
            extra="opcional"
            ajuda="Zoom, Google Meet ou Teams. Sem link, a sessão começa do mesmo jeito — só o bot do copiloto (Recall) não tem onde entrar."
          >
            <Entrada
              type="url"
              inputMode="url"
              autoComplete="off"
              value={linkSala}
              onChange={(e) => {
                setLinkSala(e.target.value);
                setErroLink(null);
              }}
              placeholder="https://…"
            />
          </Campo>

          {erroEnvio && (
            <p role="alert" className="rounded-controle border border-[color:var(--vermelho)] bg-vermelho-fraco px-3.5 py-2.5 text-sm text-[color:var(--vermelho)]">
              {erroEnvio}
            </p>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <Botao variante="fantasma" onClick={fechar} disabled={iniciando}>
              Cancelar
            </Botao>
            <Botao type="submit" variante="primario" carregando={iniciando}>
              Iniciar sessão
            </Botao>
          </div>
        </form>
      </Gaveta>
    </>
  );
}
