"use client";

import { useEffect, useState } from "react";
import { atualizarLigacao, criarLigacao, ApiError, type EstiloResposta, type Ficha360, type LigacaoEstrategica, type ProcessoDecisorio, type Ritmo } from "@/lib/api";
import { buscarRoteiroAtivo, ErroFicha360Api } from "@/components/ficha360/api";
import type { ChaveRoteiro, RoteiroBloco } from "@/types/roteiro";
import { Botao } from "@/components/ui/Botao";
import { EstadoCarregando } from "@/components/ui/Estado";
import { formatarDataHora } from "@/lib/formatar";
import { rotulo, titleDe } from "@/lib/vocabulario";

const SINAIS_CONHECIDOS = [
  "interrompe",
  "pede_confirmacao",
  "procura_numeros",
  "fala_de_custos_impostos",
  "fala_de_familia_e_patrimonio",
  "menciona_urgencia",
  "evita_assunto",
  "demonstra_cautela",
];

const ROTULOS_SINAIS: Record<string, string> = {
  interrompe: "Interrompe",
  pede_confirmacao: "Pede confirmação",
  procura_numeros: "Procura números",
  fala_de_custos_impostos: "Fala de custos/impostos",
  fala_de_familia_e_patrimonio: "Fala de família e patrimônio",
  menciona_urgencia: "Menciona urgência",
  evita_assunto: "Evita assunto",
  demonstra_cautela: "Demonstra cautela",
};

/** Trilha "preliminar" (sem seminário) roda o POP 03-B; "seminario" roda o POP 03 — mesmo mapeamento do trigger `ligacoes_estrategicas_roteiro` (0030). */
function vazio(jornadaId: string, trilha: Ficha360["jornada"]["trilha"]): LigacaoEstrategica {
  return {
    jornada_id: jornadaId,
    pop: trilha === "preliminar" ? "03-B" : "03",
    realizada_em: null,
    duracao_segundos: null,
    respostas: {},
    expectativa_principal: null,
    preocupacao_principal: null,
    assunto_atencao_especial: null,
    objecoes_percebidas: [],
    pessoas_mencionadas: [],
    ritmo: null,
    estilo_resposta: null,
    sinais: [],
    frases_marcantes: [],
    processo_decisorio: null,
    decisores_presentes_na_sessao: null,
    observacoes: null,
  };
}

function ListaEditavel({ itens, aoMudar, rotulo, placeholder }: { itens: string[]; aoMudar: (v: string[]) => void; rotulo: string; placeholder: string }) {
  const [novo, setNovo] = useState("");
  function adicionar() {
    if (!novo.trim() || itens.length >= 3) return;
    aoMudar([...itens, novo.trim()]);
    setNovo("");
  }
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-tinta">
        {rotulo} <span className="font-normal text-tinta-fraca">(1 a 3 frases literais)</span>
      </span>
      <ul className="flex flex-col gap-1.5">
        {itens.map((frase, indice) => (
          <li key={indice} className="flex items-start gap-2 rounded-controle bg-papel-fundo px-2.5 py-1.5 text-sm text-tinta">
            <span className="flex-1 italic">&ldquo;{frase}&rdquo;</span>
            <button type="button" onClick={() => aoMudar(itens.filter((_, i) => i !== indice))} className="text-xs text-tinta-fraca hover:text-[color:var(--vermelho)]" aria-label={`Remover frase: ${frase}`}>
              Remover
            </button>
          </li>
        ))}
      </ul>
      {itens.length < 3 && (
        <div className="flex gap-2">
          <input
            value={novo}
            onChange={(e) => setNovo(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), adicionar())}
            placeholder={placeholder}
            className="flex-1 rounded-controle border border-linha-forte bg-papel-elevado px-2.5 py-1.5 text-sm"
          />
          <Botao variante="secundario" className="text-xs" onClick={adicionar}>
            Adicionar
          </Botao>
        </div>
      )}
    </div>
  );
}

/**
 * Roteiro do POP 03 e do POP 03-B vêm do banco (`roteiros_versoes`, chaves
 * `pop_03` e `pop_03b` — ambos semeados na 0030, ver `POPs.md`). Único bloco
 * relevante na definição de cada chave (o primeiro do array): os `campos`
 * viram as perguntas do formulário, `observar`/`proibido` viram os dois
 * avisos abaixo — mesmo vocabulário de `BlocoRoteiro` (modo conduzir),
 * simplificado aqui porque isto é registro pós-ligação, não leitura ao vivo.
 */
function RoteiroDeBanco({ chave, rotuloPop, respostas, aoMudarResposta }: { chave: ChaveRoteiro; rotuloPop: string; respostas: Record<string, string>; aoMudarResposta: (id: string, valor: string) => void }) {
  // Estado guarda a `chave` que ele reflete. Quando a prop muda, o próprio
  // corpo do componente (fase de render, não um effect) reseta para
  // "carregando" — padrão React de "ajustar estado quando uma prop muda"
  // (evita setState síncrono dentro do efeito, que dispara render em cascata).
  const [estado, setEstado] = useState<{ chave: ChaveRoteiro; carregando: boolean; bloco: RoteiroBloco | null; erro: string | null }>(() => ({
    chave,
    carregando: true,
    bloco: null,
    erro: null,
  }));

  if (estado.chave !== chave) {
    setEstado({ chave, carregando: true, bloco: null, erro: null });
  }

  useEffect(() => {
    let vivo = true;
    buscarRoteiroAtivo(chave)
      .then((roteiro) => {
        if (!vivo) return;
        setEstado((atual) => (atual.chave === chave ? { ...atual, carregando: false, bloco: roteiro.definicao.blocos[0] ?? null, erro: null } : atual));
      })
      .catch((e) => {
        if (!vivo) return;
        const mensagem = e instanceof ErroFicha360Api ? e.message : "Não foi possível carregar o roteiro.";
        setEstado((atual) => (atual.chave === chave ? { ...atual, carregando: false, erro: mensagem } : atual));
      });
    return () => {
      vivo = false;
    };
  }, [chave]);

  const { carregando, erro, bloco } = estado;

  if (carregando) return <EstadoCarregando rotulo="Carregando roteiro…" />;
  if (erro) return <p role="alert" className="text-sm text-[color:var(--vermelho)]">{erro}</p>;
  if (!bloco) return <p className="text-sm text-tinta-suave" title={rotuloPop}>Nenhuma versão ativa de roteiro.</p>;

  return (
    <>
      {bloco.campos.map((campo) => (
        <div key={campo.id} className="flex flex-col gap-1">
          <label htmlFor={`ligacao-${campo.id}`} className="text-sm font-medium text-tinta">
            {campo.rotulo}
          </label>
          <textarea
            id={`ligacao-${campo.id}`}
            rows={2}
            value={respostas[campo.id] ?? ""}
            onChange={(e) => aoMudarResposta(campo.id, e.target.value)}
            className="rounded-controle border border-linha-forte bg-papel-elevado px-2.5 py-1.5 text-sm"
          />
        </div>
      ))}
      {bloco.observar.length > 0 && (
        <div className="rounded-controle border border-azul bg-azul-fraco px-3 py-2.5">
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-[color:var(--azul)]">Observar na resposta</p>
          <ul className="flex flex-col gap-0.5 text-sm text-[color:var(--azul)]">
            {bloco.observar.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      {bloco.proibido.length > 0 && (
        <div role="alert" className="rounded-controle border-2 border-vermelho bg-vermelho-fraco px-3 py-2.5">
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-[color:var(--vermelho)]">Proibido nesta ligação</p>
          <ul className="flex flex-col gap-0.5 text-sm text-[color:var(--vermelho)]">
            {bloco.proibido.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

export function LigacaoAba({ jornadaId, ligacaoInicial, trilha, aoAtualizar }: { jornadaId: string; ligacaoInicial: LigacaoEstrategica | null; trilha: Ficha360["jornada"]["trilha"]; aoAtualizar: () => void }) {
  const [ligacao, setLigacao] = useState<LigacaoEstrategica>(ligacaoInicial ?? vazio(jornadaId, trilha));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvoEm, setSalvoEm] = useState<string | null>(null);
  const pop03b = ligacao.pop === "03-B";

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      const payload = { ...ligacao, realizada_em: ligacao.realizada_em ?? new Date().toISOString() };
      const res = ligacaoInicial ? await atualizarLigacao(jornadaId, payload) : await criarLigacao(jornadaId, payload);
      setLigacao(res.ligacao);
      setSalvoEm(new Date().toISOString());
      aoAtualizar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar o registro da ligação.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* §9.2: a sigla do método (POP 03 / POP 03-B) sai do fluxo e vai
          para o `title` — o nome humano vem do dicionário único. */}
      <p className="text-xs text-tinta-fraca" title={`${titleDe("pop03")}${pop03b ? "-B" : ""}`}>
        {rotulo("pop03")}
        {pop03b ? " · sem seminário" : ""}
        {ligacaoInicial?.realizada_em && ` · ${formatarDataHora(ligacaoInicial.realizada_em)}`}
      </p>

      <fieldset className="flex flex-col gap-3 border-t border-linha pt-4">
        <legend className="text-base font-bold text-tinta" title={`${titleDe("pop03")}${pop03b ? "-B" : ""}`}>
          Roteiro
        </legend>
        <RoteiroDeBanco
          chave={pop03b ? "pop_03b" : "pop_03"}
          rotuloPop={pop03b ? "POP 03-B" : "POP 03"} /* só `title`/`aria`, ver RoteiroDeBanco */
          respostas={ligacao.respostas}
          aoMudarResposta={(id, valor) => setLigacao((l) => ({ ...l, respostas: { ...l.respostas, [id]: valor } }))}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-3 border-t border-linha pt-4">
        <legend className="text-base font-bold text-tinta">Registro obrigatório</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="expectativa" className="text-sm font-medium text-tinta">Expectativa principal</label>
            <input id="expectativa" value={ligacao.expectativa_principal ?? ""} onChange={(e) => setLigacao((l) => ({ ...l, expectativa_principal: e.target.value }))} className="rounded-controle border border-linha-forte bg-papel-elevado px-2.5 py-1.5 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="preocupacao" className="text-sm font-medium text-tinta">Preocupação percebida</label>
            <input id="preocupacao" value={ligacao.preocupacao_principal ?? ""} onChange={(e) => setLigacao((l) => ({ ...l, preocupacao_principal: e.target.value }))} className="rounded-controle border border-linha-forte bg-papel-elevado px-2.5 py-1.5 text-sm" />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="assunto-atencao" className="text-sm font-medium text-tinta">Assunto que merece atenção especial</label>
          <input id="assunto-atencao" value={ligacao.assunto_atencao_especial ?? ""} onChange={(e) => setLigacao((l) => ({ ...l, assunto_atencao_especial: e.target.value }))} className="rounded-controle border border-linha-forte bg-papel-elevado px-2.5 py-1.5 text-sm" />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3 border-t border-linha pt-4">
        <legend className="text-base font-bold text-tinta">Observação comportamental (objetiva)</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div role="radiogroup" aria-label="Ritmo da fala">
            <span className="text-sm font-medium text-tinta">Ritmo</span>
            <div className="mt-1.5 flex flex-col gap-1.5">
              {(["rapido", "moderado", "pausado"] as Ritmo[]).map((v) => (
                <label key={v} className="flex items-center gap-2 text-sm capitalize">
                  <input type="radio" name="ritmo" checked={ligacao.ritmo === v} onChange={() => setLigacao((l) => ({ ...l, ritmo: v }))} className="h-4 w-4 accent-[color:var(--latao)]" />
                  {v}
                </label>
              ))}
            </div>
          </div>
          <div role="radiogroup" aria-label="Estilo de resposta">
            <span className="text-sm font-medium text-tinta">Estilo de resposta</span>
            <div className="mt-1.5 flex flex-col gap-1.5">
              {([
                ["muito_objetiva", "Muito objetiva"],
                ["objetiva", "Objetiva"],
                ["detalhada", "Detalhada"],
                ["conta_historias", "Conta histórias"],
              ] as [EstiloResposta, string][]).map(([v, rotulo]) => (
                <label key={v} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="estilo" checked={ligacao.estilo_resposta === v} onChange={() => setLigacao((l) => ({ ...l, estilo_resposta: v }))} className="h-4 w-4 accent-[color:var(--latao)]" />
                  {rotulo}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div>
          <span className="text-sm font-medium text-tinta">Sinais observados</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {SINAIS_CONHECIDOS.map((sinal) => {
              const ativo = ligacao.sinais.includes(sinal);
              return (
                <button
                  key={sinal}
                  type="button"
                  aria-pressed={ativo}
                  onClick={() => setLigacao((l) => ({ ...l, sinais: ativo ? l.sinais.filter((s) => s !== sinal) : [...l.sinais, sinal] }))}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium ${ativo ? "border-[color:var(--latao)] bg-[color:var(--latao-fraco)] text-tinta" : "border-linha-forte text-tinta-suave hover:text-tinta"}`}
                >
                  {ROTULOS_SINAIS[sinal]}
                </button>
              );
            })}
          </div>
        </div>

        <ListaEditavel
          itens={ligacao.frases_marcantes}
          aoMudar={(v) => setLigacao((l) => ({ ...l, frases_marcantes: v }))}
          rotulo="Frases marcantes do cliente"
          placeholder="Frase literal do cliente…"
        />

        <div role="radiogroup" aria-label="Processo decisório">
          <span className="text-sm font-medium text-tinta">Processo decisório</span>
          <div className="mt-1.5 flex flex-wrap gap-3">
            {([
              ["decisor_conjunto", "Decisor conjunto"],
              ["influenciador", "Influenciador"],
              ["comunicador", "Comunicador"],
              ["decide_sozinho", "Decide sozinho"],
            ] as [ProcessoDecisorio, string][]).map(([v, rotulo]) => (
              <label key={v} className="flex items-center gap-2 text-sm">
                <input type="radio" name="processo" checked={ligacao.processo_decisorio === v} onChange={() => setLigacao((l) => ({ ...l, processo_decisorio: v }))} className="h-4 w-4 accent-[color:var(--latao)]" />
                {rotulo}
              </label>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-tinta">
          <input
            type="checkbox"
            checked={ligacao.decisores_presentes_na_sessao ?? false}
            onChange={(e) => setLigacao((l) => ({ ...l, decisores_presentes_na_sessao: e.target.checked }))}
            className="h-4 w-4 rounded-controle accent-[color:var(--latao)]"
          />
          Todos os decisores estarão presentes na sessão
        </label>
      </fieldset>

      {erro && <p role="alert" className="text-sm text-[color:var(--vermelho)]">{erro}</p>}
      {salvoEm && !erro && <p role="status" className="text-sm text-[color:var(--verde)]">Registro salvo.</p>}

      <div className="nao-imprimir">
        <Botao variante="primario" carregando={salvando} onClick={salvar}>
          Salvar registro da ligação
        </Botao>
      </div>
    </div>
  );
}
