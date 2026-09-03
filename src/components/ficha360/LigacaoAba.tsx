"use client";

import { useState } from "react";
import { atualizarLigacao, criarLigacao, ApiError, type EstiloResposta, type Ficha360, type LigacaoEstrategica, type ProcessoDecisorio, type Ritmo } from "@/lib/api";
import { Botao } from "@/components/ui/Botao";
import { SeloStub } from "@/components/ui/Selo";
import { formatarDataHora } from "@/lib/formatar";

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

const PERGUNTAS_ROTEIRO = [
  { id: "p1", texto: "Qual resposta espera encontrar na Sessão de Viabilidade?" },
  { id: "p2", texto: "Que assunto do seminário comentou com a família?" },
  { id: "p3", texto: "Prefere detalhe técnico primeiro ou aplicação prática primeiro?" },
  { id: "p4", texto: "A família decide na hora ou conversa antes?" },
  { id: "p5", texto: "Que assunto merece atenção especial da Dra. Elaine?" },
];

function vazio(jornadaId: string): LigacaoEstrategica {
  return {
    jornada_id: jornadaId,
    pop: "03",
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
          <li key={indice} className="flex items-start gap-2 rounded-sm bg-papel-fundo px-2.5 py-1.5 text-sm text-tinta">
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
            className="flex-1 rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5 text-sm"
          />
          <Botao variante="secundario" className="text-xs" onClick={adicionar}>
            Adicionar
          </Botao>
        </div>
      )}
    </div>
  );
}

export function LigacaoAba({ jornadaId, ligacaoInicial, trilha, aoAtualizar }: { jornadaId: string; ligacaoInicial: LigacaoEstrategica | null; trilha: Ficha360["jornada"]["trilha"]; aoAtualizar: () => void }) {
  const [ligacao, setLigacao] = useState<LigacaoEstrategica>(ligacaoInicial ?? vazio(jornadaId));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvoEm, setSalvoEm] = useState<string | null>(null);

  if (trilha === "preliminar") {
    return <SeloStub texto="POP 03-B (trilha preliminar, sem seminário) — desenhado no schema, não implementado nesta fase do MVP." />;
  }

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
      <p className="text-xs text-tinta-fraca">
        POP 03 · Ligação Estratégica{ligacaoInicial?.realizada_em && ` · registrada em ${formatarDataHora(ligacaoInicial.realizada_em)}`}
      </p>

      <fieldset className="flex flex-col gap-3 border-t border-linha pt-4">
        <legend className="font-serif text-base font-semibold text-tinta">Roteiro (5 perguntas)</legend>
        {PERGUNTAS_ROTEIRO.map((p) => (
          <div key={p.id} className="flex flex-col gap-1">
            <label htmlFor={`ligacao-${p.id}`} className="text-sm font-medium text-tinta">
              {p.texto}
            </label>
            <textarea
              id={`ligacao-${p.id}`}
              rows={2}
              value={ligacao.respostas[p.id] ?? ""}
              onChange={(e) => setLigacao((l) => ({ ...l, respostas: { ...l.respostas, [p.id]: e.target.value } }))}
              className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5 text-sm"
            />
          </div>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-3 border-t border-linha pt-4">
        <legend className="font-serif text-base font-semibold text-tinta">Registro obrigatório</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="expectativa" className="text-sm font-medium text-tinta">Expectativa principal</label>
            <input id="expectativa" value={ligacao.expectativa_principal ?? ""} onChange={(e) => setLigacao((l) => ({ ...l, expectativa_principal: e.target.value }))} className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="preocupacao" className="text-sm font-medium text-tinta">Preocupação percebida</label>
            <input id="preocupacao" value={ligacao.preocupacao_principal ?? ""} onChange={(e) => setLigacao((l) => ({ ...l, preocupacao_principal: e.target.value }))} className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5 text-sm" />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="assunto-atencao" className="text-sm font-medium text-tinta">Assunto que merece atenção especial</label>
          <input id="assunto-atencao" value={ligacao.assunto_atencao_especial ?? ""} onChange={(e) => setLigacao((l) => ({ ...l, assunto_atencao_especial: e.target.value }))} className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5 text-sm" />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3 border-t border-linha pt-4">
        <legend className="font-serif text-base font-semibold text-tinta">Observação comportamental (objetiva)</legend>
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
            className="h-4 w-4 rounded-sm accent-[color:var(--latao)]"
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
