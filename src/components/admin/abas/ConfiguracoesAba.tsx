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

/** Nome humano, unidade e (para enum) as opções. Chave fora do mapa cai no editor genérico. */
const META: Record<string, { rotulo: string; sufixo?: string; opcoes?: { valor: string; rotulo: string }[]; grupo: string }> = {
  "link.validade_dias": { rotulo: "Validade dos links públicos", grupo: "Links públicos" },
  "link.limite_por_minuto": { rotulo: "Limite de aberturas por minuto", sufixo: "requisições/minuto", grupo: "Links públicos" },
  "link.limite_por_dia": { rotulo: "Limite de aberturas por dia", sufixo: "requisições/dia", grupo: "Links públicos" },
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
    <div className="flex flex-col gap-6">
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
        <p className="text-xs text-tinta-suave">{config.descricao}</p>
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
        <p className="text-xs text-tinta-fraca">Escrita pelo sistema a cada passagem do cron. Só leitura.</p>
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
  if (isValidadeLinksDias(rascunho)) {
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
        <Botao variante="secundario" tamanho="compacto" disabled={!alterado} carregando={salvando} onClick={() => salvar()}>
          Salvar
        </Botao>
      </div>
      {config.valor === null && <p className="text-xs text-tinta-fraca">Valor atual: {TRACO}</p>}
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
