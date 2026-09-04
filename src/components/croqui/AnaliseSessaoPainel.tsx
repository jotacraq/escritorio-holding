"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRecurso } from "@/hooks/useRecurso";
import { Botao } from "@/components/ui/Botao";
import { EstadoCarregando } from "@/components/ui/Estado";
import { SeloDemonstracao, SeloIA } from "@/components/ui/Selo";
import { Chip, BadgeConfianca, type TomChip } from "@/components/briefing/atomos";
import { rotularDisc } from "@/components/briefing/tipos";
import { ROTULO_CATEGORIA_AFIRMACAO, type TemaGrafico } from "@/components/graficos";
import {
  buscarTranscricaoSessao,
  salvarTranscricaoSessao,
  rodarAnaliseSessao,
  mensagemErroAnalise,
  ehAnaliseDeDemonstracao,
  ErroAnalise,
  type AnaliseSessao,
  type Afirmacao,
  type CategoriaAfirmacao,
  type ResultadoAnaliseSessao,
} from "@/components/ficha360/api-analise";
import { detectarVersaoAnalise, converterAnaliseEmSlides } from "./mapeamentoGraficos";
import { rotularRecomendacaoArquitetura } from "./rotulos";
import { GraficoDoSlide, type DadosGraficosCroqui } from "./GraficoDoSlide";
import type { CroquiConteudo } from "@/server/ia/schema-croqui-slides";

const TOM_CATEGORIA: Record<CategoriaAfirmacao, TomChip> = {
  fato_declarado: "neutro",
  dado_documental: "azul",
  inferencia: "ambar",
  ponto_a_validar: "vermelho",
};

function ChipCategoria({ categoria }: { categoria: CategoriaAfirmacao }) {
  return <Chip tom={TOM_CATEGORIA[categoria]}>{ROTULO_CATEGORIA_AFIRMACAO[categoria]}</Chip>;
}

function ListaAfirmacoes({ itens }: { itens: Afirmacao[] }) {
  if (itens.length === 0) return <p className="text-sm text-tinta-fraca">Nenhum item nesta seção.</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {itens.map((item, i) => (
        <li key={i} className="flex flex-wrap items-baseline gap-1.5 text-sm">
          <ChipCategoria categoria={item.categoria} />
          <span className="text-tinta">{item.texto}</span>
        </li>
      ))}
    </ul>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-sm border border-linha px-3.5 py-3">
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-tinta-fraca">{titulo}</h3>
      {children}
    </section>
  );
}

/**
 * U4 (ARQUITETURA-FASE-3.md §2/§5.3) — a Análise da Sessão: colar/ver a
 * transcrição, rodar a mesma IA do Agente do Croqui (§2.1: "é o Agente do
 * Croqui com outro nome" — C16, não duplicamos), ler as 14 seções com o
 * carimbo fato/documento/inferência/ponto-a-validar em CADA afirmação (regra
 * do projeto, não enfeite), e daí produzir o croqui.
 *
 * Onde a IA não teve evidência, a seção aparece vazia (`ListaAfirmacoes`) —
 * nunca um exemplo plausível no lugar. Sem análise nenhuma, o painel mostra
 * o caminho (transcrição + botão), nunca um resultado inventado.
 */
export function AnaliseSessaoPainel({
  jornadaId,
  sessaoId,
  briefingAtualId,
  ultimaAnaliseSalva,
  dadosGraficos,
  tema,
  aoAnaliseGerada,
  aoAplicarAoCroqui,
}: {
  jornadaId: string;
  sessaoId: string | null;
  /** Id do Briefing atual da jornada (`ficha.briefingAtual?.id`), se houver —
   * só liga o link cruzado "Briefing Estratégico gerado antes desta sessão"
   * quando o dado já carregado no pai confirma que ele existe de verdade.
   * Nunca dispara requisição nova para checar isso (regra do plano). */
  briefingAtualId?: string | null;
  /** A análise mais recente já persistida para o croqui atual (embed de
   * `GET /api/croquis/[id]`), se houver — para reabrir a aba e continuar
   * vendo o resultado sem gastar uma nova execução de IA. */
  ultimaAnaliseSalva: { conteudo: unknown; grau_confianca: number | null; criado_em: string } | null;
  dadosGraficos: DadosGraficosCroqui;
  tema: TemaGrafico;
  aoAnaliseGerada: (resultado: ResultadoAnaliseSessao) => void;
  aoAplicarAoCroqui: (conteudo: CroquiConteudo, versaoDetectada: 1 | 2) => Promise<void>;
}) {
  const buscar = useCallback(() => (sessaoId ? buscarTranscricaoSessao(sessaoId) : Promise.resolve(null)), [sessaoId]);
  const { dados: transcricaoResp, carregando: carregandoTranscricao } = useRecurso(buscar, [sessaoId]);
  const textoPersistido = transcricaoResp?.transcricao?.conteudo ?? "";

  // `null` = a advogada ainda não editou a caixa nesta sessão de tela — mostra
  // o texto persistido assim que ele chegar, sem precisar de um efeito que
  // sincronize estado (a caixa deriva do dado, não copia ele numa cópia à
  // parte). Depois do primeiro toque, o que ela digitou manda.
  const [edicaoManual, setEdicaoManual] = useState<string | null>(null);
  const texto = edicaoManual ?? textoPersistido;

  const [salvando, setSalvando] = useState(false);
  const [erroSalvar, setErroSalvar] = useState<ErroAnalise | null>(null);
  const [salvo, setSalvo] = useState(false);

  async function salvarTranscricao() {
    if (!sessaoId) return;
    setSalvando(true);
    setErroSalvar(null);
    setSalvo(false);
    try {
      await salvarTranscricaoSessao(sessaoId, texto);
      setSalvo(true);
    } catch (e) {
      setErroSalvar(e instanceof ErroAnalise ? e : new ErroAnalise("Não foi possível salvar a transcrição.", 500));
    } finally {
      setSalvando(false);
    }
  }

  const [gerando, setGerando] = useState(false);
  const [erroGerar, setErroGerar] = useState<ErroAnalise | null>(null);
  const [resultado, setResultado] = useState<ResultadoAnaliseSessao | null>(null);

  async function gerar() {
    setGerando(true);
    setErroGerar(null);
    try {
      // Manda o texto no corpo só quando ele diverge do que já está
      // persistido (ou quando não há sessão para persistir em) — assim a
      // rota lê o que está salvo sempre que possível, e nunca perde uma
      // edição feita na caixa e não salva.
      const precisaEnviar = !sessaoId || texto.trim() !== textoPersistido.trim();
      const r = await rodarAnaliseSessao(jornadaId, precisaEnviar ? texto : undefined);
      setResultado(r);
      aoAnaliseGerada(r);
    } catch (e) {
      setErroGerar(e instanceof ErroAnalise ? e : new ErroAnalise("Não foi possível gerar a análise.", 500));
    } finally {
      setGerando(false);
    }
  }

  const analiseAtual: AnaliseSessao | null = resultado?.analise ?? ((ultimaAnaliseSalva?.conteudo as AnaliseSessao | undefined) ?? null);
  const grauConfianca = resultado?.analise.grau_confianca ?? ultimaAnaliseSalva?.grau_confianca ?? null;
  const ehDemo = analiseAtual ? ehAnaliseDeDemonstracao(analiseAtual) : false;
  const versaoDetectada = analiseAtual ? detectarVersaoAnalise(analiseAtual) : null;

  const [aplicando, setAplicando] = useState(false);
  const [erroAplicar, setErroAplicar] = useState<string | null>(null);
  const [aplicado, setAplicado] = useState(false);

  async function aplicar() {
    if (!analiseAtual) return;
    setAplicando(true);
    setErroAplicar(null);
    setAplicado(false);
    try {
      const { versao, conteudo } = converterAnaliseEmSlides(analiseAtual);
      await aoAplicarAoCroqui(conteudo, versao);
      setAplicado(true);
    } catch {
      setErroAplicar("Não foi possível aplicar a análise ao croqui.");
    } finally {
      setAplicando(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {!ehDemo && <SeloIA />}
        <div className="nao-imprimir flex items-center gap-3">
          {briefingAtualId && (
            <a
              href={`/jornadas/${jornadaId}#briefing`}
              className="rounded-sm text-xs text-tinta-suave underline decoration-linha-forte hover:text-tinta"
            >
              Briefing Estratégico gerado antes desta sessão
            </a>
          )}
          {analiseAtual && (
            <Botao variante="secundario" className="text-xs" onClick={() => window.print()}>Salvar em PDF</Botao>
          )}
        </div>
      </div>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-tinta">Transcrição da Sessão de Viabilidade</h3>
          {carregandoTranscricao && <span className="text-xs text-tinta-fraca">Carregando…</span>}
          {transcricaoResp?.transcricao && (
            <span className="text-xs text-tinta-fraca">
              Salva em {new Date(transcricaoResp.transcricao.importado_em).toLocaleDateString("pt-BR")}
              {transcricaoResp.total_versoes > 1 ? ` (v${transcricaoResp.total_versoes})` : ""}
            </span>
          )}
        </div>
        <textarea
          rows={8}
          value={texto}
          onChange={(e) => {
            setEdicaoManual(e.target.value);
            setSalvo(false);
          }}
          placeholder="Cole aqui o texto da transcrição da Sessão de Viabilidade (mínimo de 200 caracteres para uma análise responsável)."
          className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-2 font-sans text-sm"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Botao
            variante="secundario"
            carregando={salvando}
            disabled={!sessaoId || texto.trim().length < 200}
            onClick={salvarTranscricao}
          >
            Salvar transcrição
          </Botao>
          <Botao variante="primario" carregando={gerando} disabled={texto.trim().length < 200} onClick={gerar}>
            {analiseAtual ? "Gerar nova análise" : "Rodar Análise da Sessão"}
          </Botao>
          {!sessaoId && <span className="text-xs text-tinta-fraca">Sem Sessão de Viabilidade registrada — o texto acima é usado direto, sem ficar salvo.</span>}
          {salvo && !erroSalvar && <span role="status" className="text-xs text-[color:var(--verde)]">Transcrição salva.</span>}
        </div>
        {gerando && (
          <p role="status" className="text-xs text-tinta-suave">
            Gerando com IA — isso pode levar até 1 minuto. A tela não travou, aguarde.
          </p>
        )}
        {erroSalvar && <p role="alert" className="text-sm text-[color:var(--vermelho)]">{mensagemErroAnalise(erroSalvar)}</p>}
        {erroGerar && <p role="alert" className="text-sm text-[color:var(--vermelho)]">{mensagemErroAnalise(erroGerar)}</p>}
      </section>

      {resultado?.croqui_criado_agora && (
        <p role="status" className="rounded-sm border border-azul-fraco bg-azul-fraco px-3 py-2 text-sm text-[color:var(--azul)]">
          Um croqui em rascunho foi criado automaticamente para esta jornada — veja no Editor do Croqui, abaixo.
        </p>
      )}

      {!analiseAtual && !gerando && (
        <p className="text-sm text-tinta-suave">Nenhuma análise gerada ainda. Sem análise, esta aba não mostra nada — nenhum exemplo é inventado no lugar dela.</p>
      )}

      {gerando && <EstadoCarregando rotulo="Rodando a Análise da Sessão…" />}

      {analiseAtual && (
        <ConteudoAnalise
          analise={analiseAtual}
          grauConfianca={grauConfianca}
          ehDemo={ehDemo}
          versaoDetectada={versaoDetectada}
          dadosGraficos={dadosGraficos}
          tema={tema}
          onAplicar={aplicar}
          aplicando={aplicando}
          erroAplicar={erroAplicar}
          aplicado={aplicado}
        />
      )}
    </div>
  );
}

function ConteudoAnalise({
  analise,
  grauConfianca,
  ehDemo,
  versaoDetectada,
  dadosGraficos,
  tema,
  onAplicar,
  aplicando,
  erroAplicar,
  aplicado,
}: {
  analise: AnaliseSessao;
  grauConfianca: number | null;
  ehDemo: boolean;
  versaoDetectada: 1 | 2 | null;
  dadosGraficos: DadosGraficosCroqui;
  tema: TemaGrafico;
  onAplicar: () => void;
  aplicando: boolean;
  erroAplicar: string | null;
  aplicado: boolean;
}) {
  const corpo = (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <BadgeConfianca valor={grauConfianca} />
      </div>

      <p className="text-sm leading-relaxed text-tinta">{analise.resumo_executivo}</p>

      <Secao titulo="História"><ListaAfirmacoes itens={analise.historia} /></Secao>
      <Secao titulo="Família"><ListaAfirmacoes itens={analise.familia} /></Secao>
      <Secao titulo="Patrimônio"><ListaAfirmacoes itens={analise.patrimonio} /></Secao>
      <Secao titulo="Empresas"><ListaAfirmacoes itens={analise.empresas} /></Secao>
      <Secao titulo="Objetivos"><ListaAfirmacoes itens={analise.objetivos} /></Secao>
      <Secao titulo="Riscos"><ListaAfirmacoes itens={analise.riscos} /></Secao>

      <Secao titulo="Perfil DISC dos decisores">
        {analise.disc.length === 0 ? (
          <p className="text-sm text-tinta-fraca">Nenhum decisor identificado.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {analise.disc.map((d, i) => (
              <li key={i} className="text-sm">
                <span className="font-medium text-tinta">{d.decisor}</span>{" "}
                <Chip tom="azul">{rotularDisc(d.perfil_predominante)}</Chip>{" "}
                <span className="text-xs text-tinta-fraca">confiança {d.confianca}%</span>
                {d.evidencias.length > 0 && (
                  <ul className="mt-1 flex flex-col gap-0.5 border-l-2 border-linha pl-2.5 text-xs text-tinta-fraca">
                    {d.evidencias.map((ev, j) => (
                      <li key={j}>&ldquo;{ev}&rdquo;</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Secao>

      <Secao titulo="Arquitetura recomendada">
        <p className="mb-2 text-sm text-tinta">
          <strong>{rotularRecomendacaoArquitetura(analise.arquitetura.recomendacao)}</strong> — {analise.arquitetura.justificativa_geral}
        </p>
        <GraficoDoSlide
          tipo="alternativas"
          tema={tema}
          dados={{ ...dadosGraficos, criterios: analise.arquitetura.criterios, recomendacaoArquitetura: analise.arquitetura.recomendacao }}
        />
      </Secao>

      <Secao titulo="Croqui — o que muda em cada slide">
        {versaoDetectada === 2 ? (
          <p className="text-sm text-[color:var(--verde)]">
            Esta análise já está no formato compatível com os 13 slides — use &ldquo;Gerar croqui a partir desta análise&rdquo; abaixo.
          </p>
        ) : (
          <>
            <p className="mb-2 text-sm text-tinta-suave">
              Formato antigo (lista solta, sem correspondência automática com os 13 slides — aguardando o prompt v2 do Agente do Croqui).
              Use as referências abaixo como guia ao editar o croqui manualmente.
            </p>
            <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-tinta">
              {(analise.croqui as string[]).map((linha, i) => (
                <li key={i}>{linha}</li>
              ))}
            </ul>
          </>
        )}
      </Secao>

      <Secao titulo="Perguntas para aprofundar">
        <ul className="flex flex-col gap-1.5 text-sm">
          {analise.perguntas.map((p, i) => (
            <li key={i}>
              <span className="text-tinta">{p.pergunta}</span> <span className="text-tinta-fraca">— {p.motivo}</span>
            </li>
          ))}
        </ul>
      </Secao>

      <Secao titulo="Objeções e resposta recomendada">
        <ul className="flex flex-col gap-1.5 text-sm">
          {analise.objecoes.map((o, i) => (
            <li key={i}>
              <span className="font-medium text-tinta">{o.objecao}</span>
              <p className="text-tinta-suave">{o.resposta_recomendada}</p>
            </li>
          ))}
        </ul>
      </Secao>

      <Secao titulo="Fechamento"><p className="text-sm text-tinta">{analise.fechamento}</p></Secao>

      {analise.lacunas.length > 0 && (
        <p role="note" className="rounded-sm border border-ambar-borda bg-ambar-fraco px-2.5 py-2 text-xs text-[color:var(--ambar)]">
          Lacunas nesta análise: {analise.lacunas.join(" · ")}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-linha pt-3">
        <Botao
          variante="primario"
          carregando={aplicando}
          disabled={versaoDetectada !== 2}
          onClick={onAplicar}
          title={versaoDetectada !== 2 ? "Esta análise ainda não tem o formato tipado por slide (v2) — aplique manualmente no editor por enquanto." : undefined}
        >
          Gerar croqui a partir desta análise
        </Botao>
        {versaoDetectada !== 2 && (
          <span className="text-xs text-tinta-fraca">
            Indisponível para esta análise (formato v1) — edite o croqui manualmente usando as seções acima.
          </span>
        )}
        {aplicado && <span role="status" className="text-xs text-[color:var(--verde)]">Aplicado ao croqui.</span>}
        {aplicado && (
          <Link href="#croqui" className="text-xs text-tinta-suave underline decoration-linha-forte hover:text-tinta">
            Ver no Editor do Croqui
          </Link>
        )}
        {erroAplicar && <span role="alert" className="text-xs text-[color:var(--vermelho)]">{erroAplicar}</span>}
      </div>
    </div>
  );

  if (ehDemo) {
    return <SeloDemonstracao>{corpo}</SeloDemonstracao>;
  }
  return corpo;
}
