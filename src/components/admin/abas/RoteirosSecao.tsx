"use client";

import { useCallback, useMemo, useState } from "react";
import { useRecurso } from "@/hooks/useRecurso";
import { useToast } from "@/hooks/useToast";
import { Botao } from "@/components/ui/Botao";
import { Cartao } from "@/components/ui/Cartao";
import { ConfirmarAcao } from "@/components/ui/ConfirmarAcao";
import { EsqueletoLista } from "@/components/ui/Esqueleto";
import { EstadoCarregando, EstadoErro } from "@/components/ui/Estado";
import { Selo } from "@/components/ui/Selo";
import { formatarDataHora } from "@/lib/formatar";
import { contarMudancas, diffRoteiro, rotuloTipoItem, temFalaDeSim, type DiferencaRoteiro } from "@/lib/roteiro/diff";
import type { ChaveRoteiro, RoteiroDefinicao } from "@/types/roteiro";
import { ativarRoteiroVersao, buscarRoteiroVersao, listarRoteiros, type RoteiroVersaoResumoAdmin } from "../adminApi";
import { mensagemDeErro } from "../http";
import { SeloAtivo, autoriaDeVersao } from "../comum";

/**
 * A metade "Roteiros" da aba "Formulário e roteiros" (§A5.3).
 *
 * Arquivo separado porque é outro domínio: o formulário é a definição do POP
 * 02 e vive de um editor; o roteiro é texto de condução de sessão e vive de
 * comparação entre versões. Só a aba (`FormulariosRoteirosAba`) monta os dois.
 */

const ROTULO_CHAVE_ROTEIRO: Record<ChaveRoteiro, { titulo: string; descricao: string }> = {
  sessao_viabilidade: { titulo: "Sessão de Viabilidade", descricao: "O roteiro que a Dra. Elaine conduz na sessão — inclui a fala do 1º SIM (sigilo e gravação)." },
  pop_03: { titulo: "POP 03 — Ligação estratégica", descricao: "O roteiro da ligação que antecede a sessão." },
  pop_03b: { titulo: "POP 03b — Retomada", descricao: "O roteiro de quem não atendeu ou remarcou." },
};

const CHAVES_ROTEIRO = Object.keys(ROTULO_CHAVE_ROTEIRO) as ChaveRoteiro[];

// ---------------------------------------------------------------------------
// Sub-seção "Roteiros" — o BLOQUEIO B15 ganha botão
// ---------------------------------------------------------------------------

function Diferencas({ diferencas }: { diferencas: DiferencaRoteiro[] }) {
  if (diferencas.length === 0) {
    return <p className="text-sm text-tinta-suave">Nenhuma diferença: as duas versões dizem exatamente a mesma coisa.</p>;
  }
  const tom: Record<string, string> = { adicionado: "verde", removido: "vermelho", alterado: "ambar" };
  return (
    <div className="flex flex-col gap-item">
      <p className="text-sm text-tinta-suave">
        {diferencas.length} {diferencas.length === 1 ? "bloco muda" : "blocos mudam"} · {contarMudancas(diferencas)} diferenças
      </p>
      {diferencas.map((bloco) => (
        <div key={bloco.blocoId} className="rounded-controle border border-linha">
          <p className="flex flex-wrap items-center gap-2 border-b border-linha px-3 py-2 text-sm font-bold text-tinta">
            {bloco.bloco}
            <Selo tom={(tom[bloco.situacao] ?? "neutro") as "verde" | "vermelho" | "ambar" | "neutro"}>{bloco.situacao}</Selo>
          </p>
          <ul className="divide-y divide-linha">
            {bloco.itens.map((item) => (
              <li key={`${item.tipo}-${item.id}`} className="px-3 py-2">
                <p className="text-legenda text-tinta-fraca">
                  {rotuloTipoItem(item.tipo)} <span className="font-mono">{item.id}</span> · {item.situacao}
                </p>
                <div className="mt-1 grid gap-2 lg:grid-cols-2">
                  <p className="whitespace-pre-wrap rounded-controle bg-papel px-2 py-1 text-sm text-tinta-suave line-through decoration-1">
                    {item.antes ?? "—"}
                  </p>
                  <p className="whitespace-pre-wrap rounded-controle bg-papel px-2 py-1 text-sm text-tinta">{item.depois ?? "—"}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function SecaoRoteiro({ chave }: { chave: ChaveRoteiro }) {
  const buscar = useCallback(() => listarRoteiros(chave), [chave]);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, [chave]);
  const { notificar } = useToast();

  const [definicoes, setDefinicoes] = useState<Record<string, RoteiroDefinicao>>({});
  const [comparandoId, setComparandoId] = useState<string | null>(null);
  const [carregandoId, setCarregandoId] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<RoteiroVersaoResumoAdmin | null>(null);
  const [bloqueio, setBloqueio] = useState<string | null>(null);
  const [ativando, setAtivando] = useState(false);

  const rotulo = ROTULO_CHAVE_ROTEIRO[chave];
  const versoes = useMemo(() => [...(dados?.itens ?? [])].sort((a, b) => b.versao - a.versao), [dados]);
  const ativa = versoes.find((v) => v.ativo) ?? null;

  const carregarDefinicao = useCallback(
    async (id: string): Promise<RoteiroDefinicao | null> => {
      if (definicoes[id]) return definicoes[id];
      setCarregandoId(id);
      try {
        const { roteiro } = await buscarRoteiroVersao(id);
        setDefinicoes((atual) => ({ ...atual, [id]: roteiro.definicao }));
        return roteiro.definicao;
      } catch (e) {
        notificar({ tom: "erro", titulo: "Não foi possível abrir a versão", descricao: mensagemDeErro(e, "Tente de novo em instantes.") });
        return null;
      } finally {
        setCarregandoId(null);
      }
    },
    [definicoes, notificar],
  );

  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo={`Não foi possível carregar ${rotulo.titulo}`} />;
  if (carregando && !dados) return <EsqueletoLista linhas={3} rotulo={`Carregando ${rotulo.titulo}…`} />;

  async function comparar(id: string) {
    if (comparandoId === id) {
      setComparandoId(null);
      return;
    }
    setBloqueio(null);
    const candidata = await carregarDefinicao(id);
    if (!candidata) return;
    if (ativa && ativa.id !== id) await carregarDefinicao(ativa.id);
    setComparandoId(id);
  }

  /**
   * A trava do 1º SIM: ativar em `sessao_viabilidade` uma versão sem a fala
   * marcada `sigilo_gravacao` faz `registrar_sim_sessao` levantar
   * `texto_consentimento_nao_encontrado` — a sessão trava no primeiro passo,
   * com o cliente na chamada. Por isso a definição é lida ANTES de abrir a
   * confirmação, e não só quando alguém resolve comparar.
   */
  async function pedirAtivacao(versao: RoteiroVersaoResumoAdmin) {
    setBloqueio(null);
    const definicao = await carregarDefinicao(versao.id);
    if (!definicao) return;
    if (chave === "sessao_viabilidade" && !temFalaDeSim(definicao, "sigilo_gravacao")) {
      setBloqueio(
        `A v${versao.versao} não tem a fala do 1º SIM (sigilo e gravação). Ativar ia travar o início de toda sessão — o sistema procura essa fala para registrar o consentimento.`,
      );
      setComparandoId(versao.id);
      return;
    }
    setConfirmar(versao);
  }

  async function confirmarAtivacao() {
    if (!confirmar) return;
    setAtivando(true);
    try {
      await ativarRoteiroVersao(confirmar.id);
      notificar({ tom: "sucesso", titulo: `${rotulo.titulo}: v${confirmar.versao} é a oficial`, descricao: "As sessões a partir de agora usam esta versão." });
      setConfirmar(null);
      recarregar();
    } catch (e) {
      notificar({ tom: "erro", titulo: "Não foi possível ativar", descricao: mensagemDeErro(e, "Tente de novo em instantes.") });
    } finally {
      setAtivando(false);
    }
  }

  const diferencas = comparandoId && ativa && definicoes[comparandoId] ? diffRoteiro(definicoes[ativa.id] ?? null, definicoes[comparandoId]) : null;

  return (
    <Cartao
      preenchimento="sem"
      rotulo={chave}
      titulo={rotulo.titulo}
      descricao={rotulo.descricao}
      acao={ativa ? <Selo tom="verde">v{ativa.versao} oficial</Selo> : <Selo tom="ambar">Sem versão oficial</Selo>}
    >
      {versoes.length === 0 ? (
        <p className="px-5 py-4 text-sm text-tinta-suave">Nenhuma versão deste roteiro no banco.</p>
      ) : (
        <ul className="divide-y divide-linha">
          {versoes.map((versao) => (
            <li key={versao.id} className="flex flex-col gap-2 px-5 py-4 sm:px-6">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-tinta">
                    v{versao.versao} — {versao.titulo}
                    <SeloAtivo ativo={versao.ativo} rotuloAtivo="Oficial" rotuloInativo="Histórico" />
                  </p>
                  <p className="text-legenda text-tinta-fraca">
                    {[autoriaDeVersao(versao.criado_em, "criada"), autoriaDeVersao(versao.ativado_em, "ativada")].filter(Boolean).join(" · ") ||
                      `criada em ${formatarDataHora(versao.criado_em)}`}
                  </p>
                  {versao.notas && <p className="mt-1 break-words text-sm text-tinta-suave">{versao.notas}</p>}
                </div>
                {ativa && ativa.id !== versao.id && (
                  <Botao variante="fantasma" tamanho="compacto" carregando={carregandoId === versao.id} aria-expanded={comparandoId === versao.id} onClick={() => void comparar(versao.id)}>
                    {comparandoId === versao.id ? "Esconder a comparação" : "Comparar com a oficial"}
                  </Botao>
                )}
                {!versao.ativo && (
                  <Botao variante="secundario" tamanho="compacto" carregando={carregandoId === versao.id} onClick={() => void pedirAtivacao(versao)}>
                    Ativar esta
                  </Botao>
                )}
              </div>
              {comparandoId === versao.id && (
                <div className="flex flex-col gap-item rounded-controle bg-papel px-3 py-3">
                  {bloqueio && (
                    <p role="alert" className="rounded-controle border border-[color:var(--vermelho)] bg-vermelho-fraco px-3 py-2 text-sm font-medium text-[color:var(--vermelho)]">
                      {bloqueio}
                    </p>
                  )}
                  {diferencas ? <Diferencas diferencas={diferencas} /> : <EstadoCarregando rotulo="Comparando…" />}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmarAcao
        aberto={confirmar !== null}
        titulo="Tornar esta a versão oficial"
        efeito={`As sessões conduzidas a partir de agora usam a v${confirmar?.versao ?? ""}. Sessões já conduzidas mantêm o roteiro com que foram conduzidas.`}
        rotuloConfirmar="Ativar esta"
        confirmando={ativando}
        aoConfirmar={confirmarAtivacao}
        aoCancelar={() => setConfirmar(null)}
      />
    </Cartao>
  );
}

/** As três chaves de roteiro, na ordem em que a sessão acontece. */
export function SecaoRoteiros() {
  return (
    <>
      {CHAVES_ROTEIRO.map((chave) => (
        <SecaoRoteiro key={chave} chave={chave} />
      ))}
    </>
  );
}
