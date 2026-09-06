"use client";

import { useCallback, useState } from "react";
import { useRecurso } from "@/hooks/useRecurso";
import { useToast } from "@/hooks/useToast";
import { Botao } from "@/components/ui/Botao";
import { AreaTexto, Campo, Entrada, Opcao, Selecao } from "@/components/ui/Campo";
import { Cartao } from "@/components/ui/Cartao";
import { EsqueletoCartao } from "@/components/ui/Esqueleto";
import { EstadoErro } from "@/components/ui/Estado";
import { Selo } from "@/components/ui/Selo";
import { formatarDataHora, formatarRelativo } from "@/lib/formatar";
import { atualizarConfiguracao, listarConfiguracoes } from "../adminApi";
import { mensagemDeErro } from "../http";
import { IntroAba, TRACO } from "../comum";
import type { ConfiguracaoAdmin, ValidadeLinksDias } from "@/types/admin";

/**
 * Nome humano, unidade e (para enum) as opções. Chave fora do mapa cai no
 * editor genérico. `ajuda` substitui a `descricao` do banco quando ela é longa
 * demais para uma linha de tela — a do banco explica a MIGRATION, esta explica
 * o EFEITO para quem vai mexer.
 */
const META: Record<string, { rotulo: string; sufixo?: string; ajuda?: string; opcoes?: { valor: string; rotulo: string }[]; grupo: string }> = {
  "link.validade_dias": { rotulo: "Validade dos links públicos", grupo: "Links públicos" },
  "link.limite_por_minuto": { rotulo: "Limite de aberturas por minuto", sufixo: "requisições/minuto", grupo: "Links públicos" },
  "link.limite_por_dia": { rotulo: "Limite de aberturas por dia", sufixo: "requisições/dia", grupo: "Links públicos" },
  "link.limite_global_por_minuto": { rotulo: "Limite de aberturas por minuto somando todos os links", sufixo: "requisições/minuto", grupo: "Links públicos" },
  "link.limite_arquivos": {
    rotulo: "Arquivos por link de documentos",
    sufixo: "arquivos",
    ajuda: "Quantos arquivos o cliente pode enviar em um link de documentos. Vale na hora, para os links já enviados.",
    grupo: "Links públicos",
  },
  "ia.cooldown_segundos": { rotulo: "Intervalo mínimo entre gerações", sufixo: "segundos", grupo: "IA" },
  "ia.teto_execucoes_dia_por_usuario": { rotulo: "Teto de gerações por pessoa por dia", sufixo: "execuções/dia", grupo: "IA" },
  "agenda.duracao_padrao_minutos": { rotulo: "Duração padrão da sessão", sufixo: "minutos", grupo: "Agenda" },
  "agenda.slots_ofertados_ao_cliente": { rotulo: "Horários oferecidos ao cliente", sufixo: "horários", grupo: "Agenda" },
  "croqui.exige_revisao_para_pronto": { rotulo: "Exigir os 13 slides revisados antes de marcar o croqui como pronto", grupo: "Croqui" },
  "sala.provedor": {
    rotulo: "Como a sala é criada",
    grupo: "Integrações",
    opcoes: [
      { valor: "manual", rotulo: "Colar o link à mão" },
      { valor: "n8n", rotulo: "n8n cria sozinho" },
    ],
  },
  "regua.canal_whatsapp": {
    rotulo: "Como o WhatsApp sai",
    grupo: "Integrações",
    opcoes: [
      { valor: "manual", rotulo: "Fila manual" },
      { valor: "chatwoot", rotulo: "Chatwoot (API)" },
    ],
  },
  "regua.ultimo_cron_em": { rotulo: "Última passagem do cron da régua", grupo: "Integrações" },
  "ligacao_ia.provedor": {
    rotulo: "Quem faz a ligação de agendamento",
    grupo: "Ligação por IA",
    opcoes: [
      { valor: "manual", rotulo: "Equipe liga (tarefa)" },
      { valor: "n8n", rotulo: "IA via n8n" },
    ],
  },
  "ligacao_ia.automatica": { rotulo: "Ligar por IA sozinho após cada compra (decisão LGPD B33)", grupo: "Ligação por IA" },
  "ligacao_ia.max_tentativas": { rotulo: "Tentativas por cliente", sufixo: "tentativas", grupo: "Ligação por IA" },
  "ligacao_ia.intervalo_retentativa_minutos": { rotulo: "Intervalo entre tentativas", sufixo: "minutos", grupo: "Ligação por IA" },
  "ligacao_ia.timeout_minutos": { rotulo: "Tempo máximo de uma ligação antes de desistir", sufixo: "minutos", grupo: "Ligação por IA" },
  "ligacao_ia.janela": { rotulo: "Horário em que a IA pode ligar", grupo: "Ligação por IA" },
  "ligacao_ia.retencao_dias": { rotulo: "Apagar transcrição e gravação depois de", sufixo: "dias", grupo: "Ligação por IA" },
  "material.anexar_pdf": { rotulo: "Anexar o PDF do material no e-mail pós-sessão", grupo: "Material" },
  "material.rodape_juridico": { rotulo: "Rodapé jurídico do PDF", grupo: "Material" },
  "cenario.rubricas": { rotulo: "Rubricas do Cenário Patrimonial", grupo: "Método" },
};

const SOMENTE_LEITURA = new Set(["regua.ultimo_cron_em"]);
const ORDEM_GRUPOS = ["Integrações", "Ligação por IA", "Material", "Método", "Croqui", "Agenda", "Links públicos", "IA", "Outras"];

/** `descricao` com "VALOR INICIAL" = chute operacional, não regra do método (B12). */
function ehValorInicial(descricao: string): boolean {
  return descricao.toLowerCase().includes("valor inicial");
}

interface JanelaLigacao {
  dias: number[];
  inicio: string;
  fim: string;
  fuso: string;
}

const DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

function isJanelaLigacao(valor: unknown): valor is JanelaLigacao {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return false;
  const j = valor as Record<string, unknown>;
  return Array.isArray(j.dias) && typeof j.inicio === "string" && typeof j.fim === "string" && typeof j.fuso === "string";
}

/** Mesma validação do servidor (`SCHEMAS_CONFIGURACAO['ligacao_ia.janela']`), para o erro aparecer antes do 422. */
function erroDaJanela(j: JanelaLigacao): string | null {
  if (j.dias.length === 0) return "Escolha pelo menos um dia — sem dia nenhum a IA nunca ligaria.";
  if (!RE_HORA.test(j.inicio) || !RE_HORA.test(j.fim)) return "Use HH:MM em 24 horas (ex.: 09:00).";
  if (j.fim <= j.inicio) return "O fim tem de ser depois do início.";
  if (j.fuso.trim().length === 0) return "Informe o fuso (ex.: America/Sao_Paulo).";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: j.fuso });
  } catch {
    return "Fuso desconhecido. Use um nome IANA, como America/Sao_Paulo.";
  }
  return null;
}

function isValidadeLinksDias(valor: unknown): valor is ValidadeLinksDias {
  return typeof valor === "object" && valor !== null && "formulario" in valor && "agendamento" in valor && "documentos" in valor && "material" in valor;
}

export function ConfiguracoesAba() {
  const buscar = useCallback(() => listarConfiguracoes(), []);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, []);

  if (erro) return <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível carregar as configurações" />;
  if (carregando && !dados) return <EsqueletoCartao quantidade={4} rotulo="Carregando configurações…" />;
  if (!dados) return null;

  const grupos = new Map<string, ConfiguracaoAdmin[]>();
  for (const c of dados.itens) {
    const grupo = META[c.chave]?.grupo ?? "Outras";
    if (!grupos.has(grupo)) grupos.set(grupo, []);
    grupos.get(grupo)!.push(c);
  }
  const ordenados = [...ORDEM_GRUPOS.filter((g) => grupos.has(g)), ...Array.from(grupos.keys()).filter((g) => !ORDEM_GRUPOS.includes(g))];

  return (
    <div className="flex flex-col gap-bloco">
      <IntroAba>Ajustes que valem na hora, sem deploy. Chave nova é migration — esta tela só muda o valor de chave que já existe.</IntroAba>
      {ordenados.map((grupo) => (
        <Cartao key={grupo} preenchimento="sem" rotulo={grupo} titulo={`${grupos.get(grupo)!.length} ${grupos.get(grupo)!.length === 1 ? "ajuste" : "ajustes"}`}>
          <ul className="divide-y divide-linha">
            {grupos.get(grupo)!.map((config) => (
              <li key={config.chave} className="px-5 py-5 sm:px-6">
                <LinhaConfiguracao config={config} aoSalvar={recarregar} />
              </li>
            ))}
          </ul>
        </Cartao>
      ))}
    </div>
  );
}

function LinhaConfiguracao({ config, aoSalvar }: { config: ConfiguracaoAdmin; aoSalvar: () => void }) {
  const { notificar } = useToast();
  const [rascunho, setRascunho] = useState<unknown>(config.valor);
  const [textoJson, setTextoJson] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const meta = META[config.chave] ?? { rotulo: config.chave, grupo: "Outras" };
  const somenteLeitura = SOMENTE_LEITURA.has(config.chave);
  const alterado = JSON.stringify(rascunho) !== JSON.stringify(config.valor);

  async function salvar(valorParaSalvar: unknown = rascunho) {
    setSalvando(true);
    try {
      await atualizarConfiguracao(config.chave, valorParaSalvar);
      notificar({ tom: "sucesso", titulo: "Configuração salva", descricao: meta.rotulo });
      aoSalvar();
    } catch (e) {
      notificar({ tom: "erro", titulo: "Não foi possível salvar", descricao: mensagemDeErro(e, "Confira o valor e tente de novo.") });
    } finally {
      setSalvando(false);
    }
  }

  const cabecalho = (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <p className="text-sm font-bold text-tinta">{meta.rotulo}</p>
        <p className="text-legenda text-tinta-suave">{meta.ajuda ?? config.descricao}</p>
        <p className="mt-0.5 text-legenda text-tinta-fraca">
          <code>{config.chave}</code> · atualizada {formatarRelativo(config.atualizado_em)}
        </p>
      </div>
      {ehValorInicial(config.descricao) && <Selo tom="ambar">valor inicial — não vem do método</Selo>}
    </div>
  );

  if (somenteLeitura) {
    const iso = typeof config.valor === "string" ? config.valor : null;
    return (
      <div className="flex flex-col gap-2">
        {cabecalho}
        <p className="text-sm text-tinta">
          {iso ? (
            <>
              {formatarRelativo(iso)} <span className="text-tinta-fraca">({formatarDataHora(iso)})</span>
            </>
          ) : (
            <span className="text-[color:var(--ambar)]">nunca — o cron da Hostinger ainda não chamou /api/cron/regua</span>
          )}
        </p>
        <p className="text-legenda text-tinta-fraca">Escrita pelo sistema a cada passagem do cron. Só leitura.</p>
      </div>
    );
  }

  // Boolean: salva no clique (é um interruptor).
  if (typeof config.valor === "boolean") {
    return (
      <div className="flex flex-col gap-3">
        {cabecalho}
        <Opcao tipo="checkbox" rotulo={config.valor ? "Ligado" : "Desligado"} descricao="Vale na hora." checked={config.valor} disabled={salvando} onChange={(e) => salvar(e.target.checked)} />
      </div>
    );
  }

  // Enum: salva na troca.
  if (meta.opcoes) {
    return (
      <div className="flex flex-col gap-3">
        {cabecalho}
        <Campo rotulo="Valor">
          <Selecao value={String(config.valor)} disabled={salvando} onChange={(e) => salvar(e.target.value)}>
            {meta.opcoes.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.rotulo}
              </option>
            ))}
          </Selecao>
        </Campo>
      </div>
    );
  }

  let editor: React.ReactNode;
  let bloqueio: string | null = null;

  // Retenção de voz (0073): a chave é `número | null` e a tela precisa deixar
  // "não expurgar" ser uma escolha explícita, não um campo vazio ambíguo.
  // Envia 0 (e não null) porque `configuracoes.valor` é jsonb NOT NULL —
  // o servidor trata 0, null e ausente exatamente igual: não expurga.
  if (config.chave === "ligacao_ia.retencao_dias") {
    const dias = typeof rascunho === "number" && rascunho > 0 ? rascunho : null;
    editor = (
      <div className="flex flex-col gap-3">
        <Opcao
          tipo="checkbox"
          rotulo="Apagar transcrição e gravação depois de um prazo"
          descricao="Desligado, nada é apagado: a transcrição fica guardada enquanto a ligação existir. Ligado, o cron apaga transcrição e gravação das ligações encerradas há mais tempo que o prazo — resumo, duração e custo continuam."
          checked={dias !== null}
          onChange={(e) => setRascunho(e.target.checked ? 90 : 0)}
        />
        {dias !== null && (
          <Campo rotulo="Prazo" extra="dias" ajuda="Contados a partir do fim da ligação.">
            <Entrada type="number" min={1} max={1825} className="sm:max-w-xs" value={dias} onChange={(e) => setRascunho(Number(e.target.value))} />
          </Campo>
        )}
      </div>
    );
    if (dias !== null && (!Number.isInteger(dias) || dias < 1 || dias > 1825)) bloqueio = "Use um número inteiro de 1 a 1825 dias.";
  } else if (config.chave === "ligacao_ia.janela" && isJanelaLigacao(rascunho)) {
    const janela = rascunho;
    bloqueio = erroDaJanela(janela);
    editor = (
      <div className="flex flex-col gap-3">
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-rotulo font-medium uppercase text-tinta-fraca">Dias em que a IA pode ligar</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {DIAS_SEMANA.map((nome, indice) => (
              <Opcao
                key={nome}
                tipo="checkbox"
                rotulo={nome}
                checked={janela.dias.includes(indice)}
                onChange={(e) =>
                  setRascunho({
                    ...janela,
                    dias: (e.target.checked ? [...janela.dias, indice] : janela.dias.filter((d) => d !== indice)).sort((a, b) => a - b),
                  })
                }
              />
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Campo rotulo="Começa às">
            <Entrada type="time" value={janela.inicio} onChange={(e) => setRascunho({ ...janela, inicio: e.target.value })} />
          </Campo>
          <Campo rotulo="Para às" ajuda="Não liga a partir deste horário.">
            <Entrada type="time" value={janela.fim} onChange={(e) => setRascunho({ ...janela, fim: e.target.value })} />
          </Campo>
          <Campo rotulo="Fuso" ajuda="Nome IANA.">
            <Entrada value={janela.fuso} onChange={(e) => setRascunho({ ...janela, fuso: e.target.value })} />
          </Campo>
        </div>
        <p className="text-legenda text-tinta-fraca">
          Vale para a fila automática e para a retentativa. O botão “Ligar por IA agora” da Ficha continua ligando fora deste horário — é
          ordem de gente, e a Ficha avisa que está fora.
        </p>
        {bloqueio && (
          <p role="alert" className="text-sm text-[color:var(--vermelho)]">
            {bloqueio}
          </p>
        )}
      </div>
    );
  } else if (isValidadeLinksDias(rascunho)) {
    const CAMPOS: { chave: keyof ValidadeLinksDias; rotulo: string }[] = [
      { chave: "formulario", rotulo: "Formulário" },
      { chave: "agendamento", rotulo: "Agendamento" },
      { chave: "documentos", rotulo: "Documentos" },
      { chave: "material", rotulo: "Material" },
    ];
    editor = (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {CAMPOS.map((campo) => (
          <Campo key={campo.chave} rotulo={`${campo.rotulo} (dias)`}>
            <Entrada type="number" min={1} value={rascunho[campo.chave]} onChange={(e) => setRascunho({ ...rascunho, [campo.chave]: Number(e.target.value) })} />
          </Campo>
        ))}
      </div>
    );
  } else if (typeof rascunho === "number") {
    editor = (
      <Campo rotulo="Valor" extra={meta.sufixo}>
        <Entrada type="number" min={0} className="sm:max-w-xs" value={rascunho} onChange={(e) => setRascunho(Number(e.target.value))} />
      </Campo>
    );
  } else if (typeof rascunho === "string") {
    editor = (
      <Campo rotulo="Texto">
        <AreaTexto rows={3} value={rascunho} onChange={(e) => setRascunho(e.target.value)} />
      </Campo>
    );
  } else if (Array.isArray(rascunho) && rascunho.every((x) => typeof x === "string")) {
    editor = (
      <Campo rotulo="Lista" ajuda="Um item por linha.">
        <AreaTexto rows={4} value={(rascunho as string[]).join("\n")} onChange={(e) => setRascunho(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))} />
      </Campo>
    );
  } else {
    const texto = textoJson ?? JSON.stringify(rascunho, null, 2);
    editor = (
      <Campo rotulo="Valor (JSON)" erro={textoJson !== null && !ehJsonValido(textoJson) ? "JSON inválido — corrija antes de salvar." : undefined}>
        <AreaTexto
          rows={4}
          className="font-mono text-sm"
          value={texto}
          onChange={(e) => {
            setTextoJson(e.target.value);
            if (ehJsonValido(e.target.value)) setRascunho(JSON.parse(e.target.value));
          }}
        />
      </Campo>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {cabecalho}
      {editor}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {alterado && (
          <Botao variante="fantasma" tamanho="compacto" onClick={() => setRascunho(config.valor)}>
            Desfazer
          </Botao>
        )}
        <Botao variante="secundario" tamanho="compacto" disabled={!alterado || Boolean(bloqueio)} carregando={salvando} onClick={() => salvar()}>
          Salvar
        </Botao>
      </div>
      {config.valor === null && <p className="text-legenda text-tinta-fraca">Valor atual: {TRACO}</p>}
    </div>
  );
}

function ehJsonValido(texto: string): boolean {
  try {
    JSON.parse(texto);
    return true;
  } catch {
    return false;
  }
}
