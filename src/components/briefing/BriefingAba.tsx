"use client";

import { useCallback, useEffect, useState } from "react";
import { buscarBriefing, gerarBriefing, listarBriefingsDaJornada, ApiError, type Briefing } from "@/lib/api";
import { useRecurso } from "@/hooks/useRecurso";
import { formatarDataHora, formatarMoeda } from "@/lib/formatar";
import { Botao } from "@/components/ui/Botao";
import { EstadoCarregando, EstadoVazio } from "@/components/ui/Estado";
import { BadgeConfianca, Chip, FraseComFidelidade, Hipotese, ListaEvidencias } from "@/components/briefing/atomos";
import {
  rotularArquetipo,
  rotularDisc,
  rotularNivel,
  rotularNivelAutoridade,
  rotularProbabilidade,
  rotularRitmo,
  rotularSimNao,
  rotularTom,
  tomProbabilidade,
  type BriefingConteudoV2,
} from "@/components/briefing/tipos";

const ROTULOS_FONTE: Record<string, string> = {
  formulario: "Formulário estratégico",
  ligacao_observacoes: "Observações da ligação",
  transcricao: "Transcrição da ligação",
  patrimonio_faixa: "Faixa de patrimônio",
};

function Secao({ numero, titulo, hipotese, children }: { numero: number; titulo: string; hipotese?: string[]; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5 border-t border-linha pt-4 first:border-t-0 first:pt-0">
      <h3 className="font-serif text-base font-semibold text-tinta">
        <span className="mr-2 font-mono text-sm text-tinta-fraca">{String(numero).padStart(2, "0")}</span>
        {titulo}
        <Hipotese evidencias={hipotese} />
      </h3>
      <div className="text-sm leading-relaxed text-tinta">{children}</div>
    </section>
  );
}

function ConteudoBriefing({ briefing }: { briefing: Briefing }) {
  // `Briefing.conteudo` (lib/api.ts) ainda reflete o schema v1 — o dado real
  // que chega do servidor é v2 (ver tipos.ts). Cast documentado, não fantasia.
  const c = briefing.conteudo as unknown as BriefingConteudoV2;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-linha bg-papel-fundo px-3.5 py-2.5">
        <BadgeConfianca valor={briefing.grau_confianca} />
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-tinta-suave">
          <span className="font-medium text-tinta">Fontes usadas:</span>
          {briefing.fontes_usadas.length === 0 ? (
            <span className="italic">nenhuma fonte estruturada</span>
          ) : (
            briefing.fontes_usadas.map((f) => (
              <span key={f} className="rounded-sm border border-linha-forte bg-papel-elevado px-1.5 py-0.5">{ROTULOS_FONTE[f] ?? f}</span>
            ))
          )}
        </div>
      </div>

      {(briefing.modo_reduzido ?? !briefing.fontes_usadas.includes("transcricao")) && (
        <p role="note" className="rounded-sm border border-ambar-borda bg-ambar-fraco px-3 py-2 text-sm text-[color:var(--ambar)]">
          Briefing sem transcrição — consentimento de tratamento por IA não registrado.
        </p>
      )}

      {c.lacunas.length > 0 && (
        <div role="note" className="rounded-sm border border-ambar-borda bg-ambar-fraco px-3.5 py-2.5">
          <p className="text-sm font-semibold text-[color:var(--ambar)]">Lacunas — o que faltou para uma análise mais firme</p>
          <ul className="mt-1 list-inside list-disc text-sm text-[color:var(--ambar)]">
            {c.lacunas.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        </div>
      )}

      <Secao numero={1} titulo="Resumo executivo">{c.resumo_executivo}</Secao>

      <Secao numero={2} titulo="Perfil DISC" hipotese={c.perfil_disc.evidencias}>
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip tom="azul">{rotularDisc(c.perfil_disc.predominante)}</Chip>
          {c.perfil_disc.secundario && <Chip>secundário: {rotularDisc(c.perfil_disc.secundario)}</Chip>}
          <span className="text-xs text-tinta-fraca">confiança {c.perfil_disc.confianca}%</span>
        </div>
        <ListaEvidencias evidencias={c.perfil_disc.evidencias} />
      </Secao>

      <Secao numero={3} titulo="Arquétipo patrimonial" hipotese={c.arquetipo_patrimonial.evidencias}>
        <p><strong>{rotularArquetipo(c.arquetipo_patrimonial.escolhido)}</strong> — {c.arquetipo_patrimonial.justificativa}</p>
        <ListaEvidencias evidencias={c.arquetipo_patrimonial.evidencias} />
      </Secao>

      <Secao numero={4} titulo="Motivadores">
        <p><strong>O que protege:</strong> {c.o_que_protege.objeto} — {c.o_que_protege.justificativa}</p>
        <p className="mt-1"><strong>Motivador principal:</strong> {c.motivadores.principal}</p>
        {c.motivadores.secundarios.length > 0 && <p className="text-tinta-suave">Secundários: {c.motivadores.secundarios.join(", ")}</p>}
        <p className="text-tinta-suave">{c.motivadores.justificativa}</p>
      </Secao>

      <Secao numero={5} titulo="Objeções prováveis">
        <ol className="flex flex-col gap-2">
          {c.objecoes_provaveis.map((o, i) => (
            <li key={i}>
              <strong>{o.objecao}</strong> <Chip tom={tomProbabilidade(o.probabilidade)}>{rotularProbabilidade(o.probabilidade)}</Chip>
              <p className="text-tinta-suave">{o.justificativa}</p>
            </li>
          ))}
        </ol>
      </Secao>

      <Secao numero={6} titulo="Linguagem recomendada">
        <div className="flex flex-wrap gap-1.5">
          {c.linguagem_recomendada.tom.map((t) => <Chip key={t}>{rotularTom(t)}</Chip>)}
        </div>
        <p className="mt-1.5 text-tinta-suave">{c.linguagem_recomendada.justificativa}</p>
      </Secao>

      <Secao numero={7} titulo="Pontos de atenção — o que não fazer">
        <ul className="list-inside list-disc">
          {c.pontos_de_atencao.map((p, i) => <li key={i}><strong>{p.nao_fazer}</strong> — {p.motivo}</li>)}
        </ul>
      </Secao>

      <Secao numero={8} titulo="Perguntas a aprofundar">
        <ul className="list-inside list-disc">
          {c.perguntas_para_aprofundar.map((p, i) => <li key={i}>{p.pergunta} <span className="text-tinta-suave">— {p.motivo}</span></li>)}
        </ul>
      </Secao>

      <Secao numero={9} titulo="Frases do cliente para o fechamento">
        <ul className="flex flex-col gap-1.5">
          {c.frases_para_o_fechamento.map((f, i) => (
            <li key={i}>
              <FraseComFidelidade frase={f.frase_literal} />
              <p className="text-tinta-suave">Como usar: {f.como_usar}</p>
            </li>
          ))}
        </ul>
      </Secao>

      <Secao numero={10} titulo="Estratégia da sessão">
        <p><strong>Ritmo:</strong> <Chip>{rotularRitmo(c.estrategia_sessao.ritmo)}</Chip>{c.estrategia_sessao.ritmo_nota && <span className="ml-1.5 text-tinta-suave">— {c.estrategia_sessao.ritmo_nota}</span>}</p>
        <p className="mt-1"><strong>Mais tempo em:</strong> {c.estrategia_sessao.mais_tempo_em.join(", ") || "—"}</p>
        <p><strong>Menos tempo em:</strong> {c.estrategia_sessao.menos_tempo_em.join(", ") || "—"}</p>
        <p><strong>Momento de apresentar o croqui:</strong> {c.estrategia_sessao.momento_croqui}</p>
        <p><strong>Momento de apresentar o investimento:</strong> {c.estrategia_sessao.momento_investimento}</p>
        <p><strong>Tratamento de objeções:</strong> {c.estrategia_sessao.tratamento_objecoes}</p>
      </Secao>

      <Secao numero={11} titulo="Estratégia de fechamento">{c.estrategia_fechamento}</Secao>

      <Secao numero={12} titulo="Grau de confiança da análise">
        <BadgeConfianca valor={c.grau_confianca} />
      </Secao>

      <section className="flex flex-col gap-1.5 border-t border-linha pt-4">
        <h3 className="font-serif text-base font-semibold text-tinta">Processo decisório (POP 03)</h3>
        <p><strong>Velocidade:</strong> <Chip>{rotularNivel(c.processo_decisorio.velocidade)}</Chip>{c.processo_decisorio.velocidade_nota && <span className="ml-1.5 text-tinta-suave">— {c.processo_decisorio.velocidade_nota}</span>}</p>
        <p><strong>Necessidade de segurança:</strong> <Chip>{rotularNivel(c.processo_decisorio.necessidade_seguranca)}</Chip>{c.processo_decisorio.necessidade_seguranca_nota && <span className="ml-1.5 text-tinta-suave">— {c.processo_decisorio.necessidade_seguranca_nota}</span>}</p>
        <p><strong>Necessidade de validação:</strong> <Chip>{rotularNivel(c.processo_decisorio.necessidade_validacao)}</Chip>{c.processo_decisorio.necessidade_validacao_nota && <span className="ml-1.5 text-tinta-suave">— {c.processo_decisorio.necessidade_validacao_nota}</span>}</p>
        <p><strong>Necessidade de detalhe:</strong> <Chip>{rotularNivel(c.processo_decisorio.necessidade_detalhe)}</Chip>{c.processo_decisorio.necessidade_detalhe_nota && <span className="ml-1.5 text-tinta-suave">— {c.processo_decisorio.necessidade_detalhe_nota}</span>}</p>
        {c.processo_decisorio.nivel_autoridade && (
          <p><strong>Nível de autoridade:</strong> <Chip>{rotularNivelAutoridade(c.processo_decisorio.nivel_autoridade)}</Chip>{c.processo_decisorio.nivel_autoridade_nota && <span className="ml-1.5 text-tinta-suave">— {c.processo_decisorio.nivel_autoridade_nota}</span>}</p>
        )}
        {c.processo_decisorio.decisores_presentes_na_sessao && (
          <p><strong>Decisores presentes na sessão:</strong> <Chip>{rotularSimNao(c.processo_decisorio.decisores_presentes_na_sessao)}</Chip>{c.processo_decisorio.decisores_presentes_na_sessao_nota && <span className="ml-1.5 text-tinta-suave">— {c.processo_decisorio.decisores_presentes_na_sessao_nota}</span>}</p>
        )}
        <p><strong>Decisores:</strong> {c.processo_decisorio.decisores.join(", ") || "—"}</p>
      </section>

      <p className="nao-imprimir border-t border-linha pt-3 text-xs text-tinta-fraca">
        Versão {briefing.versao} · gerado em {formatarDataHora(briefing.criado_em)}
        {briefing.prompt_versao && ` · prompt ${briefing.prompt_versao.chave} v${briefing.prompt_versao.versao}`}
        {briefing.custo_usd != null && ` · custo ${formatarMoeda(briefing.custo_usd)}`}
      </p>
    </div>
  );
}

export function BriefingAba({ jornadaId, briefingAtualId }: { jornadaId: string; briefingAtualId: string | null }) {
  const buscar = useCallback(() => (briefingAtualId ? buscarBriefing(briefingAtualId) : Promise.resolve(null)), [briefingAtualId]);
  const { dados: briefing, carregando, erro: erroCarregarBruto, setDados: setBriefing } = useRecurso(buscar, [briefingAtualId]);
  const erroCarregar = erroCarregarBruto instanceof ApiError ? erroCarregarBruto : erroCarregarBruto ? new ApiError("Erro ao carregar briefing", 500) : null;

  const [gerando, setGerando] = useState(false);
  const [erroGerar, setErroGerar] = useState<ApiError | null>(null);
  const [historico, setHistorico] = useState<Pick<Briefing, "id" | "versao" | "grau_confianca" | "criado_em">[] | null | undefined>(undefined);
  const [trocandoVersao, setTrocandoVersao] = useState(false);

  useEffect(() => {
    listarBriefingsDaJornada(jornadaId).then((res) => setHistorico(res?.itens ?? null));
  }, [jornadaId]);

  async function gerar(forcar: boolean) {
    setGerando(true);
    setErroGerar(null);
    try {
      const res = await gerarBriefing(jornadaId, forcar);
      const gerado = await buscarBriefing(res.briefing_id);
      setBriefing(gerado);
    } catch (e) {
      setErroGerar(e instanceof ApiError ? e : new ApiError("Não foi possível gerar o briefing.", 500));
    } finally {
      setGerando(false);
    }
  }

  async function trocarVersao(id: string) {
    setTrocandoVersao(true);
    try {
      setBriefing(await buscarBriefing(id));
    } finally {
      setTrocandoVersao(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="nao-imprimir flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <Botao variante="primario" carregando={gerando} onClick={() => gerar(!briefing)}>
            {briefing ? "Regerar briefing" : "Gerar briefing"}
          </Botao>
        </div>
        {historico && historico.length > 1 && (
          <label className="flex items-center gap-2 text-sm">
            Versão
            <select
              value={briefing?.id ?? ""}
              disabled={trocandoVersao}
              onChange={(e) => trocarVersao(e.target.value)}
              className="rounded-sm border border-linha-forte bg-papel-elevado px-2 py-1 disabled:opacity-60"
            >
              {historico.map((h) => (
                <option key={h.id} value={h.id}>v{h.versao} · {formatarDataHora(h.criado_em)}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {erroGerar && (
        <p role="alert" className="rounded-sm border border-vermelho bg-vermelho-fraco px-3 py-2 text-sm text-[color:var(--vermelho)]">
          {erroGerar.status === 503
            ? "O briefing não pôde ser gerado: sem chave de IA configurada ou sem consentimento de tratamento por IA registrado. Nenhum briefing de mentira é mostrado nesta tela."
            : erroGerar.message}
        </p>
      )}

      {carregando && <EstadoCarregando rotulo="Carregando briefing…" />}

      {!carregando && erroCarregar && (
        <p role="alert" className="text-sm text-[color:var(--vermelho)]">{erroCarregar.message}</p>
      )}

      {!carregando && !erroCarregar && !briefing && (
        <EstadoVazio titulo="Nenhum briefing gerado ainda" descricao="Gere o Briefing Estratégico com o botão acima, depois de registrar o formulário e a ligação." />
      )}

      {!carregando && briefing && <ConteudoBriefing briefing={briefing} />}
    </div>
  );
}
