"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { adicionarFamiliar, criarAgendamento, listarFamiliares, ApiError, type Familiar, type Ficha360, type SessaoViabilidade } from "@/lib/api";
import { useToast } from "@/hooks/useToast";
import { formatarDataHora } from "@/lib/formatar";
import { Botao } from "@/components/ui/Botao";
import { Campo, Entrada } from "@/components/ui/Campo";
import { Cartao } from "@/components/ui/Cartao";
import { EsqueletoLinha } from "@/components/ui/Esqueleto";
import { EstadoVazio } from "@/components/ui/Estado";
import { Passos } from "@/components/ui/Passos";
import { Selo, type TomSelo } from "@/components/ui/Selo";
import { LinhaAgendamento } from "@/components/agenda/LinhaAgendamento";
import { FormularioAgendamento } from "@/components/agenda/FormularioAgendamento";
import { extrasDaFicha, proximoAgendamentoAtivo } from "./api-extras";
import { SessaoPresenca } from "./SessaoPresenca";
import { SessaoSala } from "./SessaoSala";
import { SessaoLigacaoIa } from "./SessaoLigacaoIa";
import { SessaoTarefaCroqui } from "./SessaoTarefaCroqui";

const ROTULOS_RESULTADO: Record<NonNullable<SessaoViabilidade["resultado"]>, { rotulo: string; tom: TomSelo }> = {
  fechou: { rotulo: "Fechou", tom: "verde" },
  nao_fechou: { rotulo: "Não fechou", tom: "vermelho" },
  indefinido: { rotulo: "Indefinido", tom: "neutro" },
};

type ChaveEtapaSessao = "horario" | "confirmacao" | "sala" | "presenca";

const ORDEM_ETAPAS: ChaveEtapaSessao[] = ["horario", "confirmacao", "sala", "presenca"];

const ROTULO_ETAPA: Record<ChaveEtapaSessao, string> = {
  horario: "Horário",
  confirmacao: "Confirmação",
  sala: "Sala",
  presenca: "Presença",
};

const QUEM_ETAPA: Record<ChaveEtapaSessao, string> = {
  horario: "Equipe",
  confirmacao: "Cliente",
  sala: "Equipe",
  presenca: "Advogada",
};

/**
 * Aba Sessão, Fase 5 (§1 ponto 2 do pedido do João).
 *
 * ANTES: quatro cartões idênticos empilhados (Agendamento, Sala, Ligação por
 * IA, Família), cada um com duas linhas de explicação e um botão, sem ordem
 * de leitura. Quem chegava não sabia por onde começar — e a Ligação por IA
 * aparecia mesmo com a sessão já marcada, oferecendo o que não serve.
 *
 * AGORA: **uma linha de passos** — Horário → Confirmação → Sala → Presença —
 * com o passo atual aceso e só o bloco dele aberto. Os outros continuam a um
 * clique (a linha é navegável pelo teclado, `ui/Passos` já faz isso); nada
 * sumiu. A Ligação por IA só aparece quando não há horário ativo; quando há,
 * vira uma linha "não se aplica". Família e resultado viram linha, não cartão.
 *
 * Cada bloco continua sendo o MESMO componente de antes, com as mesmas props
 * e a mesma regra de negócio — a mudança é de ordem e de texto, não de
 * comportamento.
 */
export function SessaoAba({ jornadaId, ficha, aoAtualizar }: { jornadaId: string; ficha: Ficha360; aoAtualizar: () => void }) {
  const extras = extrasDaFicha(ficha);
  const sessao = ficha.sessao;
  const proximo = proximoAgendamentoAtivo(extras.agendamentos);
  const tarefaCroqui = extras.tarefasAbertas.find((t) => t.tipo === "enviar_link_croqui") ?? null;
  const tarefaLigar = extras.tarefasAbertas.find((t) => t.tipo === "ligar_para_agendar") ?? null;
  const [criando, setCriando] = useState(false);

  const feitos = useMemo<Record<ChaveEtapaSessao, boolean>>(() => {
    const realizada = Boolean(sessao?.realizada_em);
    return {
      horario: proximo !== null || realizada,
      confirmacao: Boolean(proximo?.presenca_confirmada_em) || realizada,
      sala: Boolean(extras.sessao?.link_sala),
      presenca: realizada,
    };
  }, [proximo, sessao, extras.sessao]);

  // O passo aceso é o primeiro não concluído (e o último quando tudo está
  // feito) — mesma regra do trilho da jornada, na escala da sessão.
  const etapaAtual = ORDEM_ETAPAS.find((chave) => !feitos[chave]) ?? ORDEM_ETAPAS[ORDEM_ETAPAS.length - 1];
  const [aberta, setAberta] = useState<ChaveEtapaSessao | null>(null);
  const etapaVisivel = aberta ?? etapaAtual;

  // ATENÇÃO: `ui/Passos` deriva "feito" pelo ÍNDICE (`i < indiceAtual`), então
  // `atual` tem de ser sempre o passo REAL — nunca o que o usuário abriu para
  // olhar. Passando o passo aberto, clicar em "Sala" carimbava check verde em
  // "Horário" e "Confirmação" numa sessão que não tem nem horário marcado:
  // dado inventado na tela. Quem sinaliza o que está aberto é o título do
  // bloco abaixo, não o stepper.

  return (
    <div className="flex flex-col gap-bloco">
      {tarefaCroqui && (
        <Cartao rotulo="Depois da sessão" titulo="Enviar o link do Croqui" realce="ambar">
          <SessaoTarefaCroqui jornadaId={jornadaId} tarefa={tarefaCroqui} aoAtualizar={aoAtualizar} />
        </Cartao>
      )}

      <Cartao titulo="Sessão de Viabilidade" preenchimento="normal">
        <div className="flex flex-col gap-cartao">
          <Passos
            passos={ORDEM_ETAPAS.map((chave) => ({ id: chave, rotulo: ROTULO_ETAPA[chave], quem: QUEM_ETAPA[chave] }))}
            atual={etapaAtual}
            rotulo="Passos da sessão"
            aoEscolher={(id) => setAberta(id as ChaveEtapaSessao)}
          />

          <div className="flex flex-col gap-item border-t border-linha pt-4">
            <h3 className="text-sm font-bold text-tinta">
              {ROTULO_ETAPA[etapaVisivel]}
              {etapaVisivel !== etapaAtual && <span className="ml-2 font-normal text-tinta-fraca">· fora do passo atual</span>}
            </h3>
            {etapaVisivel === "horario" && (
              <BlocoHorario
                ficha={ficha}
                jornadaId={jornadaId}
                proximoInicioEm={proximo?.inicio_em ?? null}
                realizadaEm={sessao?.realizada_em ?? null}
                criando={criando}
                setCriando={setCriando}
                aoAtualizar={aoAtualizar}
              />
            )}
            {etapaVisivel === "confirmacao" && <SessaoPresenca agendamento={proximo} aoAtualizar={aoAtualizar} />}
            {etapaVisivel === "sala" && <SessaoSala sessao={extras.sessao} temAgendamentoAtivo={proximo !== null} aoAtualizar={aoAtualizar} />}
            {etapaVisivel === "presenca" && <BlocoPresenca jornadaId={jornadaId} sessao={sessao} />}
          </div>
        </div>
      </Cartao>

      {/* §1 ponto 3 — se não serve, não ocupa a tela. Com horário ativo a
          ligação por IA vira uma linha de estado, não um cartão com botão. */}
      {proximo === null ? (
        <Cartao titulo="Ligação por IA">
          <SessaoLigacaoIa
            jornadaId={jornadaId}
            ligacao={extras.ligacaoIaAtual}
            disponivel={extras.ligacaoIaDisponivel}
            tarefaLigarAberta={tarefaLigar}
            temAgendamentoAtivo={false}
            aoAtualizar={aoAtualizar}
          />
        </Cartao>
      ) : (
        <p className="flex min-h-9 flex-wrap items-center gap-x-2 rounded-controle border border-dashed border-linha bg-transparent px-3.5 py-2 text-sm text-tinta-suave">
          <span className="font-medium text-tinta">Ligação por IA</span>
          <span>· não se aplica · horário já marcado</span>
        </p>
      )}

      <ComposicaoFamiliar jornadaId={jornadaId} />
    </div>
  );
}

function BlocoHorario({
  ficha,
  jornadaId,
  proximoInicioEm,
  realizadaEm,
  criando,
  setCriando,
  aoAtualizar,
}: {
  ficha: Ficha360;
  jornadaId: string;
  proximoInicioEm: string | null;
  realizadaEm: string | null;
  criando: boolean;
  setCriando: (v: boolean) => void;
  aoAtualizar: () => void;
}) {
  return (
    <div className="flex flex-col gap-cartao">
      {/* Sem horário, quem fala é o estado vazio da lista abaixo (1 linha +
          1 ação): dizer "Nenhum horário ativo" aqui E "Nenhum horário ainda"
          logo abaixo era a mesma frase duas vezes. */}
      {(proximoInicioEm || realizadaEm) && (
        <p className="text-sm font-medium text-tinta">
          {proximoInicioEm ? formatarDataHora(proximoInicioEm) : `Realizada em ${formatarDataHora(realizadaEm!)}`}
        </p>
      )}

      {criando && (
        <div className="rounded-controle border border-linha bg-papel p-4">
          <FormularioAgendamento
            aoCancelar={() => setCriando(false)}
            aoSalvar={async (inicioIso, fimIso) => {
              await criarAgendamento(jornadaId, { inicio_em: inicioIso, fim_em: fimIso });
              setCriando(false);
              aoAtualizar();
            }}
          />
        </div>
      )}

      {ficha.agendamentos.length === 0 && !criando ? (
        <EstadoVazio
          compacto
          titulo="Nenhum horário ainda"
          acao={
            <Botao variante="primario" onClick={() => setCriando(true)}>
              Agendar a sessão
            </Botao>
          }
        />
      ) : (
        ficha.agendamentos.length > 0 && (
          <ul className="divide-y divide-linha rounded-controle border border-linha">
            {ficha.agendamentos.map((a) => (
              <LinhaAgendamento key={a.id} agendamento={a} aoAtualizar={aoAtualizar} />
            ))}
          </ul>
        )
      )}

      {!criando && ficha.agendamentos.length > 0 && (
        <div className="nao-imprimir">
          <Botao variante="secundario" onClick={() => setCriando(true)}>
            + Novo horário
          </Botao>
        </div>
      )}
    </div>
  );
}

function BlocoPresenca({ jornadaId, sessao }: { jornadaId: string; sessao: Ficha360["sessao"] }) {
  const resultado = sessao?.resultado ? ROTULOS_RESULTADO[sessao.resultado] : null;

  return (
    <div className="flex flex-col gap-item">
      {sessao?.realizada_em ? (
        <p className="text-sm font-medium text-tinta">Realizada em {formatarDataHora(sessao.realizada_em)}</p>
      ) : (
        <p className="text-sm text-tinta-suave">Aguardando o dia da sessão</p>
      )}

      {resultado && (
        <div className="flex flex-wrap items-center gap-2">
          <Selo tom={resultado.tom}>{resultado.rotulo}</Selo>
          {sessao?.motivo_resultado && <span className="text-sm text-tinta-suave">{sessao.motivo_resultado}</span>}
        </div>
      )}

      <div className="nao-imprimir">
        <Link
          href={`/sessoes/${jornadaId}/conduzir`}
          className="inline-flex min-h-11 items-center justify-center rounded-pilula border border-transparent bg-[color:var(--latao-cta)] px-4 py-2 text-sm font-medium text-[color:var(--latao-cta-texto)] shadow-[0_3px_0_0_var(--latao-cta-forte)] transition-colors hover:bg-[color:var(--latao-cta-forte)] hover:shadow-none"
        >
          Conduzir sessão
        </Link>
      </div>
    </div>
  );
}

function ComposicaoFamiliar({ jornadaId }: { jornadaId: string }) {
  const { notificar } = useToast();
  const [familiares, setFamiliares] = useState<Familiar[] | null | undefined>(undefined);
  const [novo, setNovo] = useState<{ parentesco: string; nome: string } | null>(null);
  const [erroParentesco, setErroParentesco] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  function carregar() {
    listarFamiliares(jornadaId)
      .then((r) => setFamiliares(r.familiares))
      .catch(() => setFamiliares(null));
  }
  useEffect(carregar, [jornadaId]);

  return (
    <Cartao titulo="Composição familiar" acao={familiares && familiares.length > 0 ? <span className="text-xs text-tinta-fraca">{familiares.length} pessoas</span> : null}>
      <div className="flex flex-col gap-cartao">
        {familiares === undefined ? (
          <div className="flex flex-col gap-2" role="status" aria-label="Carregando familiares">
            <EsqueletoLinha largura="w-1/2" />
            <EsqueletoLinha largura="w-1/3" />
          </div>
        ) : familiares === null ? (
          <p className="text-sm text-tinta-suave">Indisponível para o seu perfil</p>
        ) : familiares.length === 0 && !novo ? (
          <EstadoVazio
            compacto
            titulo="Nenhum familiar registrado"
            acao={
              <Botao variante="secundario" onClick={() => setNovo({ parentesco: "", nome: "" })}>
                Adicionar familiar
              </Botao>
            }
          />
        ) : (
          <ul className="flex flex-wrap gap-item">
            {familiares.map((f) => (
              <li key={f.id} className="inline-flex min-h-9 items-center rounded-pilula border border-linha bg-papel px-3 text-sm text-tinta">
                {f.nome ? `${f.nome} · ` : ""}
                {f.parentesco}
              </li>
            ))}
          </ul>
        )}

        {!novo && familiares !== undefined && familiares !== null && familiares.length > 0 && (
          <div className="nao-imprimir">
            <Botao variante="secundario" onClick={() => setNovo({ parentesco: "", nome: "" })}>
              + Adicionar familiar
            </Botao>
          </div>
        )}

        {novo && (
          <form
            className="nao-imprimir flex flex-col gap-4 rounded-controle border border-linha bg-papel p-4"
            noValidate
            onSubmit={async (e) => {
              e.preventDefault();
              if (!novo.parentesco.trim()) {
                setErroParentesco("Diga o parentesco (cônjuge, filho, neto…).");
                return;
              }
              setSalvando(true);
              setErroParentesco(null);
              try {
                await adicionarFamiliar(jornadaId, {
                  parentesco: novo.parentesco.trim(),
                  nome: novo.nome.trim() || null,
                  idade: null,
                  ocupacao: null,
                  regime_casamento: null,
                  dependente_financeiro: null,
                  observacoes: null,
                });
                notificar({ tom: "sucesso", titulo: "Familiar adicionado" });
                setNovo(null);
                carregar();
              } catch (e2) {
                notificar({
                  tom: "erro",
                  titulo: "Não foi possível adicionar o familiar",
                  descricao: e2 instanceof ApiError ? e2.message : "Confira a internet e tente de novo.",
                });
              } finally {
                setSalvando(false);
              }
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Parentesco" erro={erroParentesco} obrigatorio>
                <Entrada value={novo.parentesco} onChange={(e) => setNovo({ ...novo, parentesco: e.target.value })} placeholder="cônjuge, filho…" autoFocus />
              </Campo>
              <Campo rotulo="Nome" extra="opcional">
                <Entrada value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} />
              </Campo>
            </div>
            <div className="flex flex-wrap gap-2">
              <Botao type="submit" variante="primario" carregando={salvando}>
                Adicionar
              </Botao>
              <Botao variante="fantasma" onClick={() => setNovo(null)} disabled={salvando}>
                Cancelar
              </Botao>
            </div>
          </form>
        )}
      </div>
    </Cartao>
  );
}
