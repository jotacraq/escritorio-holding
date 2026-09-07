"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useRecurso } from "@/hooks/useRecurso";
import { useToast } from "@/hooks/useToast";
import { Botao } from "@/components/ui/Botao";
import { Cartao } from "@/components/ui/Cartao";
import { EsqueletoCartao } from "@/components/ui/Esqueleto";
import { EstadoErro, EstadoVazio } from "@/components/ui/Estado";
import { Kpi } from "@/components/ui/Kpi";
import { Selo, SeloStub } from "@/components/ui/Selo";
import { SeloEstado } from "@/components/ui/SeloEstado";
import { Tabela, type ColunaTabela } from "@/components/ui/Tabela";
import { formatarDataHora, formatarRelativo } from "@/lib/formatar";
import { titleDe } from "@/lib/vocabulario";
import { lerResumoDoAgente } from "@/lib/api/agente";
import type { AgenteResposta, AgenteResumo } from "@/types/agente";
import { formatarConfianca, formatarDolar, rotuloIntencao, situacaoDaResposta } from "@/components/comunicacao/agente";
import { atualizarConfiguracao } from "../adminApi";
import { mensagemDeErro } from "../http";
import { IntroAba, TRACO } from "../comum";

/**
 * Admin → Agente de WhatsApp (Fase 9).
 *
 * É **um interruptor com a conta do dia**, não uma tela de configuração: quem
 * abre aqui quer responder "ele está ligado?", "ele está conseguindo falar?" e
 * "quanto custou hoje?". Os sete parâmetros (silêncio, esquivas, tetos) são
 * fatos de leitura — mudá-los é migration, como toda chave de `configuracoes`.
 *
 * As duas armadilhas que a tela existe para não deixar acontecer:
 *
 *  - **ligado com as variáveis faltando** = ligado e mudo. O sistema não
 *    responde nada e ninguém percebe, porque não há erro em lugar nenhum — o
 *    porteiro simplesmente cala (D8: env presente ≠ env válida);
 *  - **ligado com o prompt inativo** = só respostas fixas. Funciona, mas o
 *    cliente que faz uma pergunta fora do roteiro não recebe resposta redigida,
 *    e isso precisa ser uma escolha, não uma surpresa.
 *
 * As duas viram aviso com a CONSEQUÊNCIA escrita, nunca um selo cinza.
 */

const PARA_QUE_SERVE =
  "Ele só fala com quem está no cadastro e já contratou a Sessão de Viabilidade — e só depois de você ligar aqui.";

const COLUNAS: readonly ColunaTabela<AgenteResposta>[] = [
  { chave: "quando", cabecalho: "Quando", celula: (l) => <time dateTime={l.criado_em} title={formatarDataHora(l.criado_em)}>{formatarRelativo(l.criado_em)}</time> },
  { chave: "intencao", cabecalho: "O que o cliente quis", celula: (l) => rotuloIntencao(l.intencao) },
  { chave: "certeza", cabecalho: "Certeza", numerica: true, celula: (l) => formatarConfianca(l.confianca) ?? TRACO },
  {
    chave: "situacao",
    cabecalho: "Saiu?",
    celula: (l) => {
      const situacao = situacaoDaResposta(l);
      if (situacao === "sem_resposta") return <Selo tom="neutro" title={l.erro ?? "Não havia o que dizer."}>Nada a dizer</Selo>;
      return (
        <SeloEstado
          dominio="mensagem"
          estado={situacao === "enviada" ? "enviada" : "falhou"}
          detalhe={situacao === "enviada" ? undefined : `A central de WhatsApp (${titleDe("provedor_whatsapp")}) recusou o envio.${l.erro ? ` Motivo: ${l.erro}.` : ""} Há tarefa aberta.`}
        />
      );
    },
  },
  { chave: "custo", cabecalho: "Custo", numerica: true, celula: (l) => formatarDolar(l.custo_usd) ?? TRACO },
  { chave: "processo", cabecalho: "Processo", celula: () => "Abrir a Ficha" },
];

export function AgenteWhatsappAba() {
  const buscar = useCallback(() => lerResumoDoAgente(), []);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, []);

  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível ler o agente de WhatsApp" />;
  if (carregando && !dados) return <EsqueletoCartao quantidade={2} rotulo="Abrindo o agente de WhatsApp…" />;
  if (!dados) return null;

  return (
    <div className="flex flex-col gap-bloco">
      <IntroAba>{PARA_QUE_SERVE}</IntroAba>
      <Interruptor resumo={dados} aoMudar={recarregar} />
      <Avisos resumo={dados} />
      <ContaDoDia resumo={dados} />
      <Parametros resumo={dados} />
      <UltimasRespostas respostas={dados.ultimas_respostas} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* O interruptor                                                              */
/* -------------------------------------------------------------------------- */

function Interruptor({ resumo, aoMudar }: { resumo: AgenteResumo; aoMudar: () => void }) {
  const { notificar } = useToast();
  const [salvando, setSalvando] = useState(false);

  /**
   * O interruptor É um `PATCH` de `configuracoes` — a mesma rota, a mesma
   * validação e o mesmo `atualizado_por` de toda chave do sistema; não há um
   * caminho paralelo para ligar o robô. Ligar/desligar não apaga nada: o
   * desligado continua gravando o que o cliente escreve, só não responde.
   */
  async function alternar() {
    setSalvando(true);
    try {
      await atualizarConfiguracao("agente_whatsapp.ativo", !resumo.ativo);
      notificar(
        resumo.ativo
          ? { tom: "sucesso", titulo: "Agente desligado", descricao: "Mensagens continuam sendo registradas; nenhuma resposta sai." }
          : { tom: "sucesso", titulo: "Agente ligado", descricao: "Ele passa a responder quem está no cadastro e já contratou." },
      );
      aoMudar();
    } catch (e) {
      notificar({ tom: "erro", titulo: "Não foi possível salvar", descricao: mensagemDeErro(e, "Tente de novo em instantes.") });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Cartao
      rotulo="Interruptor"
      titulo={resumo.ativo ? "O agente está ligado" : "O agente está desligado"}
      tituloTitle="Enquanto está desligado, o webhook continua gravando o que o cliente escreve — o que não acontece é a resposta."
      descricao={resumo.ativo ? "Ele responde no fio da conversa, no mesmo instante em que o cliente escreve." : "Nada sai. O que o cliente escreve continua sendo registrado em Mensagens → Recebidas."}
      acao={<Selo tom={resumo.ativo ? "verde" : "neutro"}>{resumo.ativo ? "Ligado" : "Desligado"}</Selo>}
    >
      <Botao
        variante={resumo.ativo ? "secundario" : "primario"}
        carregando={salvando}
        onClick={alternar}
        title={resumo.ativo ? "Desligar para o agente parar de responder. Nada é apagado." : "Ligar para o agente começar a responder quem está no cadastro."}
      >
        {resumo.ativo ? "Desligar o agente" : "Ligar o agente"}
      </Botao>
    </Cartao>
  );
}

/* -------------------------------------------------------------------------- */
/* Os dois avisos que mudam o que o cliente recebe                            */
/* -------------------------------------------------------------------------- */

function Avisos({ resumo }: { resumo: AgenteResumo }) {
  const faltaEnv = resumo.envs_faltando.length > 0;
  const semPrompt = resumo.prompt_versao === null;
  const promptInativo = !semPrompt && !resumo.prompt_ativo;

  if (!faltaEnv && !semPrompt && !promptInativo) {
    return (
      <p role="status" className="flex flex-wrap items-center gap-x-item gap-y-1 rounded-cartao border border-linha bg-papel-elevado px-4 py-3 text-sm text-tinta">
        <SeloEstado dominio="integracao" estado="ligada" />
        <span>Central de WhatsApp configurada e prompt ativo (v{resumo.prompt_versao}).</span>
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-item">
      {faltaEnv && (
        <div role="alert" className="rounded-cartao border border-ambar-borda bg-ambar-fraco px-4 py-3">
          <p className="flex flex-wrap items-center gap-x-item gap-y-1 text-sm font-bold text-[color:var(--estado-ambar)]">
            <SeloEstado dominio="integracao" estado="desligada" />
            {resumo.ativo ? "Ligado, mas não responde nada." : "Não vai responder nada quando for ligado."}
          </p>
          <p className="mt-1 text-sm text-tinta-suave">
            Falta{resumo.envs_faltando.length === 1 ? "" : "m"} no servidor:{" "}
            <span className="font-mono text-legenda text-tinta">{resumo.envs_faltando.join(", ")}</span>. Sem isso o agente cala — e não há erro em lugar nenhum.
          </p>
          <Link href="#integracoes" className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-[color:var(--latao)] underline underline-offset-2">
            Ver em Integrações
          </Link>
        </div>
      )}

      {semPrompt && <SeloStub texto="O prompt do agente ainda não existe neste banco. Ele responde apenas com os textos fixos do roteiro de onboarding." />}

      {/* Azul, não âmbar: o prompt NASCE inativo por desenho (D17). "Só respostas
          fixas" é informação sobre um estado escolhido, e pintá-lo de aviso
          ensinaria a equipe a ignorar o âmbar de verdade logo acima. */}
      {promptInativo && (
        <div role={resumo.ativo ? "alert" : "status"} className="rounded-cartao border border-linha-forte bg-azul-fraco px-4 py-3">
          <p className="text-sm font-bold text-[color:var(--estado-azul)]">Só respostas fixas.</p>
          <p className="mt-1 text-sm text-tinta-suave">
            A versão v{resumo.prompt_versao} do prompt existe e está inativa. O agente manda os links e diz o que falta, mas não redige resposta para pergunta fora do
            roteiro — ele encaminha para a equipe.
          </p>
          <Link href="#prompts" className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-[color:var(--latao)] underline underline-offset-2">
            Ver as versões de prompt
          </Link>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* A conta do dia                                                             */
/* -------------------------------------------------------------------------- */

function ContaDoDia({ resumo }: { resumo: AgenteResumo }) {
  return (
    <div className="grid gap-cartao sm:grid-cols-3">
      <Kpi rotulo="Respostas hoje" valor={resumo.respostas_hoje === 0 ? null : resumo.respostas_hoje} motivoVazio={resumo.ativo ? "ninguém escreveu ainda hoje" : "o agente está desligado"} />
      <Kpi
        rotulo="Respostas com IA hoje"
        valor={resumo.execucoes_ia_hoje === 0 ? null : resumo.execucoes_ia_hoje}
        motivoVazio="nenhuma resposta precisou do modelo"
        acao={<span className="text-tinta-suave">teto de {resumo.teto_ia_dia} por dia</span>}
      />
      <Kpi
        rotulo="Custo de IA hoje"
        valor={resumo.custo_usd_hoje === 0 ? null : formatarDolar(resumo.custo_usd_hoje)}
        motivoVazio="nenhuma resposta custou IA hoje"
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Os parâmetros (leitura)                                                    */
/* -------------------------------------------------------------------------- */

function Parametros({ resumo }: { resumo: AgenteResumo }) {
  const linhas: { rotulo: string; valor: string; explique: string }[] = [
    {
      rotulo: "Silêncio depois de um humano",
      valor: `${resumo.silencio_humano_minutos} minutos`,
      explique: "Quando alguém da equipe responde na conversa (ou clica em “Assumir conversa” na ficha), o agente fica calado por este tempo.",
    },
    { rotulo: "Esquivas até chamar gente", valor: String(resumo.esquivas_ate_humano), explique: "Depois desta quantidade de assuntos fora do tema, o agente encaminha para a equipe e abre tarefa." },
    { rotulo: "Intervalo entre links iguais", valor: `${resumo.intervalo_link_horas} horas`, explique: "Emitir um link novo revoga o anterior. Dentro desta janela o agente aponta a mensagem que já mandou, em vez de derrubar o link vivo." },
    { rotulo: "Respostas por hora, por cliente", valor: String(resumo.teto_respostas_hora), explique: "Teto por processo. Estourou, o agente para e abre tarefa — é uma das quatro travas contra laço de respostas." },
    { rotulo: "Respostas com IA por cliente, por dia", valor: String(resumo.teto_ia_jornada_dia), explique: "Orçamento de IA por processo, contado no dia." },
    { rotulo: "Respostas com IA por dia", valor: String(resumo.teto_ia_dia), explique: "Orçamento de IA da casa inteira, contado no dia." },
  ];

  return (
    <Cartao
      rotulo="Regras"
      titulo="Como ele se comporta"
      descricao="Valores de leitura: mudar qualquer um deles é migration, como toda chave de configuração do sistema."
    >
      <dl className="grid gap-x-cartao gap-y-item sm:grid-cols-2">
        {linhas.map((linha) => (
          <div key={linha.rotulo} className="flex flex-wrap items-baseline justify-between gap-x-item border-b border-linha pb-2">
            <dt className="text-sm text-tinta-suave" title={linha.explique}>
              {linha.rotulo}
            </dt>
            <dd className="text-sm font-bold tabular-nums text-tinta">{linha.valor}</dd>
          </div>
        ))}
      </dl>
    </Cartao>
  );
}

/* -------------------------------------------------------------------------- */
/* As últimas 20                                                              */
/* -------------------------------------------------------------------------- */

function UltimasRespostas({ respostas }: { respostas: readonly AgenteResposta[] }) {
  return (
    <Cartao preenchimento="sem" rotulo="Auditoria" titulo="As últimas 20 respostas" descricao="O que ele disse, para quem, com que certeza e a que custo.">
      <div className="px-cartao py-item">
        <Tabela
          legenda="Últimas respostas do agente de WhatsApp"
          colunas={COLUNAS}
          linhas={respostas}
          chaveDaLinha={(l) => l.id}
          hrefDaLinha={(l) => `/jornadas/${l.jornada_id}#conversa`}
          tituloDoCartao={(l) => rotuloIntencao(l.intencao)}
          vazio={
            <EstadoVazio
              compacto
              titulo="O agente ainda não respondeu ninguém"
              descricao="Assim que ele responder a primeira mensagem, ela aparece aqui com intenção, certeza e custo."
            />
          }
        />
      </div>
    </Cartao>
  );
}
