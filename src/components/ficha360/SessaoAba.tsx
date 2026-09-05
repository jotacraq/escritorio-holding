"use client";

import { useEffect, useState } from "react";
import { adicionarFamiliar, criarAgendamento, listarFamiliares, ApiError, type Familiar, type Ficha360, type SessaoViabilidade } from "@/lib/api";
import { useToast } from "@/hooks/useToast";
import { formatarDataHora } from "@/lib/formatar";
import { Botao } from "@/components/ui/Botao";
import { Campo, Entrada } from "@/components/ui/Campo";
import { Cartao } from "@/components/ui/Cartao";
import { EsqueletoLinha } from "@/components/ui/Esqueleto";
import { EstadoVazio } from "@/components/ui/Estado";
import { Selo } from "@/components/ui/Selo";
import { LinhaAgendamento } from "@/components/agenda/LinhaAgendamento";
import { FormularioAgendamento } from "@/components/agenda/FormularioAgendamento";
import { extrasDaFicha, proximoAgendamentoAtivo } from "./api-extras";
import { SessaoPresenca } from "./SessaoPresenca";
import { SessaoSala } from "./SessaoSala";
import { SessaoLigacaoIa } from "./SessaoLigacaoIa";
import { SessaoTarefaCroqui } from "./SessaoTarefaCroqui";

const ROTULOS_RESULTADO: Record<NonNullable<SessaoViabilidade["resultado"]>, { rotulo: string; tom: "verde" | "vermelho" | "neutro" }> = {
  fechou: { rotulo: "Fechou", tom: "verde" },
  nao_fechou: { rotulo: "Não fechou", tom: "vermelho" },
  indefinido: { rotulo: "Indefinido", tom: "neutro" },
};

/**
 * Aba Sessão da Ficha 360 (Fase 4, agente H): a esteira da Sessão de
 * Viabilidade em cartões, na ordem em que as coisas acontecem — tarefa da
 * advogada quando existe (é o único alarme), agendamento + presença, sala,
 * ligação por IA, resultado e composição familiar. Tudo lê o payload da
 * Ficha; nenhum polling — ações recarregam a ficha por `aoAtualizar`.
 */
export function SessaoAba({ jornadaId, ficha, aoAtualizar }: { jornadaId: string; ficha: Ficha360; aoAtualizar: () => void }) {
  const extras = extrasDaFicha(ficha);
  const sessao = ficha.sessao;
  const proximo = proximoAgendamentoAtivo(extras.agendamentos);
  const tarefaCroqui = extras.tarefasAbertas.find((t) => t.tipo === "enviar_link_croqui") ?? null;
  const tarefaLigar = extras.tarefasAbertas.find((t) => t.tipo === "ligar_para_agendar") ?? null;
  const [criando, setCriando] = useState(false);

  return (
    <div className="flex flex-col gap-5">
      {tarefaCroqui && (
        <Cartao rotulo="Depois da sessão" titulo="Enviar o link do Croqui" descricao="Mensagem pronta para a Dra. Elaine mandar pessoalmente." realce="ambar">
          <SessaoTarefaCroqui jornadaId={jornadaId} tarefa={tarefaCroqui} aoAtualizar={aoAtualizar} />
        </Cartao>
      )}

      <Cartao
        rotulo="Sessão de Viabilidade"
        titulo="Agendamento e presença"
        descricao={proximo ? `Próxima sessão em ${formatarDataHora(proximo.inicio_em)}.` : sessao?.realizada_em ? `Sessão realizada em ${formatarDataHora(sessao.realizada_em)}.` : "Nenhum horário ativo."}
      >
        <div className="flex flex-col gap-5">
          {proximo && <SessaoPresenca agendamento={proximo} aoAtualizar={aoAtualizar} />}

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
              titulo="Nenhum agendamento ainda"
              descricao="Marque pela agenda, pelo link de agendamento do cliente ou peça a ligação por IA abaixo."
              acao={
                <Botao variante="primario" onClick={() => setCriando(true)}>
                  Agendar a sessão
                </Botao>
              }
            />
          ) : (
            ficha.agendamentos.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-rotulo font-medium uppercase text-tinta-fraca">Todos os horários</p>
                <ul className="divide-y divide-linha rounded-controle border border-linha">
                  {ficha.agendamentos.map((a) => (
                    <LinhaAgendamento key={a.id} agendamento={a} aoAtualizar={aoAtualizar} />
                  ))}
                </ul>
              </div>
            )
          )}

          {!criando && ficha.agendamentos.length > 0 && (
            <div className="nao-imprimir">
              <Botao variante="secundario" onClick={() => setCriando(true)}>
                + Novo agendamento
              </Botao>
            </div>
          )}
        </div>
      </Cartao>

      <Cartao rotulo="No dia" titulo="Sala da sessão" descricao="O e-mail do dia sai 10 minutos antes, com este link — sem link, a mensagem fica segurada.">
        <SessaoSala sessao={extras.sessao} temAgendamentoAtivo={proximo !== null} aoAtualizar={aoAtualizar} />
      </Cartao>

      <Cartao rotulo="Agendar sem esforço" titulo="Ligação por IA" descricao="A IA liga para o cliente, oferece os horários da equipe e o agendamento cai aqui.">
        <SessaoLigacaoIa
          jornadaId={jornadaId}
          ligacao={extras.ligacaoIaAtual}
          disponivel={extras.ligacaoIaDisponivel}
          tarefaLigarAberta={tarefaLigar}
          temAgendamentoAtivo={proximo !== null}
          aoAtualizar={aoAtualizar}
        />
      </Cartao>

      {sessao?.resultado && (
        <Cartao rotulo="Depois da sessão" titulo="Resultado">
          <div className="flex flex-col gap-1.5">
            <Selo tom={ROTULOS_RESULTADO[sessao.resultado].tom} className="self-start">
              {ROTULOS_RESULTADO[sessao.resultado].rotulo}
            </Selo>
            {sessao.motivo_resultado && <p className="text-sm text-tinta">{sessao.motivo_resultado}</p>}
          </div>
        </Cartao>
      )}

      <ComposicaoFamiliar jornadaId={jornadaId} />
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

  async function salvar() {
    if (!novo?.parentesco.trim()) {
      setErroParentesco("Diga o parentesco (cônjuge, filho, neto…).");
      return;
    }
    setSalvando(true);
    setErroParentesco(null);
    try {
      await adicionarFamiliar(jornadaId, { parentesco: novo.parentesco.trim(), nome: novo.nome.trim() || null, idade: null, ocupacao: null, regime_casamento: null, dependente_financeiro: null, observacoes: null });
      notificar({ tom: "sucesso", titulo: "Familiar adicionado" });
      setNovo(null);
      carregar();
    } catch (e) {
      notificar({ tom: "erro", titulo: "Não foi possível adicionar o familiar", descricao: e instanceof ApiError ? e.message : "Confira a internet e tente de novo." });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Cartao rotulo="Quem está na história" titulo="Composição familiar">
      <div className="flex flex-col gap-4">
        {familiares === undefined ? (
          <div className="flex flex-col gap-2" role="status" aria-label="Carregando familiares">
            <EsqueletoLinha largura="w-1/2" />
            <EsqueletoLinha largura="w-1/3" />
          </div>
        ) : familiares === null ? (
          <p className="text-sm text-tinta-suave">A lista de familiares não está disponível para o seu perfil.</p>
        ) : familiares.length === 0 && !novo ? (
          <EstadoVazio compacto titulo="Nenhum familiar registrado" descricao="Cônjuge, filhos e netos entram no mapa patrimonial e no diagnóstico." />
        ) : (
          <ul className="flex flex-wrap gap-2">
            {familiares.map((f) => (
              <li key={f.id} className="inline-flex min-h-9 items-center rounded-pilula border border-linha bg-papel px-3 text-sm text-tinta">
                {f.nome ? `${f.nome} · ` : ""}
                {f.parentesco}
              </li>
            ))}
          </ul>
        )}

        {!novo && (
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
            onSubmit={(e) => {
              e.preventDefault();
              salvar();
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
