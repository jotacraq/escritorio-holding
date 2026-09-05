"use client";

import { useCallback, useState } from "react";
import { useRecurso } from "@/hooks/useRecurso";
import { useToast } from "@/hooks/useToast";
import { Botao } from "@/components/ui/Botao";
import { Campo, Opcao, Selecao } from "@/components/ui/Campo";
import { Cartao } from "@/components/ui/Cartao";
import { EsqueletoCartao } from "@/components/ui/Esqueleto";
import { EstadoErro } from "@/components/ui/Estado";
import { Selo, SeloStub } from "@/components/ui/Selo";
import { formatarDataHora, formatarRelativo } from "@/lib/formatar";
import { ApiError } from "@/lib/api";
import type { ChaveIntegracao, IntegracaoEstado, ResultadoTesteIntegracao } from "@/types/integracoes";
import { atualizarConfiguracao, listarIntegracoes, testarIntegracao } from "../adminApi";
import { mensagemDeErro } from "../http";
import { IntroAba, TRACO } from "../comum";

/** Ordem de leitura: a esteira de cima para baixo (compra → ligação → sala → mensagens → IA). */
const ORDEM: ChaveIntegracao[] = ["hotmart", "ligacao_ia", "sala", "chatwoot", "resend", "cron", "ia"];

const DESCRICAO: Record<ChaveIntegracao, string> = {
  hotmart: "Recebe a compra e abre a jornada. Sem o segredo, o webhook recusa tudo — e isso é o comportamento certo.",
  ligacao_ia: "Liga para o cliente e marca a Sessão de Viabilidade. Sem a integração, vira tarefa para a equipe ligar.",
  sala: "Cria o link da reunião sozinho. Sem a integração, o link é colado à mão na Ficha → Sessão.",
  chatwoot: "Manda e recebe WhatsApp pela API. Sem isto, a fila é manual: copiar, abrir no WhatsApp, marcar enviada.",
  resend: "Envia os e-mails da régua (boas-vindas, confirmação, dia da sessão, material).",
  cron: "O relógio que faz a régua rodar: chama /api/cron/regua a cada 5 minutos. É configuração do hPanel, não deste sistema.",
  ia: "Gera briefing, análise da sessão, croqui e material. Sem a chave, tudo sai em modo demonstração rotulado.",
};

/** Sem o estado do servidor, a tela ainda diz o que cada integração é e o que exige (§12) — nunca inventa se está ligada. */
const ROTULO_ESTATICO: Record<ChaveIntegracao, string> = {
  hotmart: "Pagamentos (Hotmart)",
  ligacao_ia: "Ligação por IA (Vapi via n8n)",
  sala: "Sala de reunião (n8n)",
  chatwoot: "WhatsApp (Chatwoot)",
  resend: "E-mail (Resend)",
  cron: "Régua (cron da Hostinger)",
  ia: "IA (OpenRouter)",
};
const VARIAVEIS_ESTATICAS: Record<ChaveIntegracao, string[]> = {
  hotmart: ["HOTMART_WEBHOOK_SECRET", "IDs em Admin → Produtos"],
  ligacao_ia: ["N8N_WEBHOOK_LIGACAO_URL", "LIGACAO_IA_WEBHOOK_SECRET", "VAPI_ASSISTENTE_ID"],
  sala: ["N8N_WEBHOOK_SALA_URL", "INTEGRACOES_WEBHOOK_SECRET"],
  chatwoot: ["CHATWOOT_URL", "CHATWOOT_ACCOUNT_ID", "CHATWOOT_API_TOKEN", "CHATWOOT_INBOX_ID", "CHATWOOT_WEBHOOK_SECRET"],
  resend: ["RESEND_API_KEY", "EMAIL_FROM"],
  cron: ["cron no hPanel", "CRON_SECRET"],
  ia: ["OPENROUTER_API_KEY"],
};

/** Texto do toggle no lugar da chave crua. */
const TOGGLE: Record<string, { rotulo: string; ajuda?: string; opcoes?: { valor: string; rotulo: string }[] }> = {
  "ligacao_ia.provedor": {
    rotulo: "Quem faz a ligação",
    opcoes: [
      { valor: "manual", rotulo: "Equipe liga (tarefa)" },
      { valor: "n8n", rotulo: "IA via n8n" },
    ],
  },
  "ligacao_ia.automatica": {
    rotulo: "Ligar por IA sozinho após cada compra",
    ajuda: "Decisão LGPD pendente (B33): a voz do cliente passa pela Vapi. Até a Dra. Elaine decidir, fica desligado e a ligação é pedida à mão na Ficha.",
  },
  "sala.provedor": {
    rotulo: "Como a sala é criada",
    opcoes: [
      { valor: "manual", rotulo: "Colar o link à mão" },
      { valor: "n8n", rotulo: "n8n cria sozinho" },
    ],
  },
  "regua.canal_whatsapp": {
    rotulo: "Como o WhatsApp sai",
    opcoes: [
      { valor: "manual", rotulo: "Fila manual (copiar e enviar)" },
      { valor: "chatwoot", rotulo: "Chatwoot (API)" },
    ],
  },
};

export function IntegracoesAba() {
  const buscar = useCallback(() => listarIntegracoes(), []);
  const { dados, carregando, erro, recarregar } = useRecurso(buscar, []);

  if (erro) {
    const semServiceRole = erro instanceof ApiError && erro.status === 503;
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <IntroAba>O que está ligado, o que falta configurar (só o nome da variável — nunca o valor) e um botão para testar cada ponta.</IntroAba>
          <Botao variante="secundario" tamanho="compacto" carregando={carregando} onClick={recarregar}>
            Tentar de novo
          </Botao>
        </div>
        {semServiceRole ? (
          <SeloStub texto="Estado das integrações indisponível: o servidor está sem SUPABASE_SERVICE_ROLE_KEY. Abaixo, o que cada integração precisa — o estado real aparece quando a variável existir." />
        ) : (
          <EstadoErro erro={erro} tentarNovamente={recarregar} titulo="Não foi possível carregar as integrações" />
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          {ORDEM.map((chave) => (
            <Cartao key={chave} como="article" titulo={ROTULO_ESTATICO[chave]} descricao={DESCRICAO[chave]} acao={<Selo tom="neutro">Estado desconhecido</Selo>}>
              <p className="text-sm font-bold text-tinta">Precisa no servidor</p>
              <ul className="mt-1 flex flex-wrap gap-2">
                {VARIAVEIS_ESTATICAS[chave].map((nome) => (
                  <li key={nome}>
                    <code className="inline-block rounded-controle bg-papel px-2 py-1 text-xs text-tinta">{nome}</code>
                  </li>
                ))}
              </ul>
            </Cartao>
          ))}
        </div>
      </div>
    );
  }
  if (carregando && !dados) return <EsqueletoCartao quantidade={4} rotulo="Carregando integrações…" />;
  if (!dados) return null;

  const ordenadas = ORDEM.map((chave) => dados.itens.find((i) => i.chave === chave)).filter((i): i is IntegracaoEstado => Boolean(i));
  const configuradas = ordenadas.filter((i) => i.configurado).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <IntroAba>O que está ligado, o que falta configurar (só o nome da variável — nunca o valor) e um botão para testar cada ponta.</IntroAba>
        <Selo tom={configuradas === ordenadas.length ? "verde" : "ambar"}>
          {configuradas} de {ordenadas.length} ligadas
        </Selo>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {ordenadas.map((item) => (
          <CartaoIntegracao key={item.chave} item={item} aoMudar={recarregar} />
        ))}
      </div>
    </div>
  );
}

function CartaoIntegracao({ item, aoMudar }: { item: IntegracaoEstado; aoMudar: () => void }) {
  const { notificar } = useToast();
  const [testando, setTestando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoTesteIntegracao | null>(null);

  async function testar() {
    setTestando(true);
    try {
      const r = await testarIntegracao(item.chave);
      setResultado(r);
      notificar({ tom: r.ok ? "sucesso" : "aviso", titulo: r.ok ? `${item.rotulo}: respondeu` : `${item.rotulo}: não respondeu`, descricao: r.detalhe });
    } catch (erro) {
      notificar({ tom: "erro", titulo: "Não foi possível testar", descricao: mensagemDeErro(erro, "Tente de novo em instantes.") });
    } finally {
      setTestando(false);
    }
  }

  return (
    <Cartao
      como="article"
      realce={item.configurado ? "verde" : "ambar"}
      titulo={item.rotulo}
      descricao={DESCRICAO[item.chave]}
      acao={item.configurado ? <Selo tom="verde">Ligada</Selo> : <Selo tom="ambar">Falta configurar</Selo>}
    >
      <div className="flex flex-col gap-4">
        {item.faltam.length > 0 && (
          <div>
            <p className="text-sm font-bold text-tinta">Falta no servidor</p>
            <ul className="mt-1 flex flex-wrap gap-2">
              {item.faltam.map((nome) => (
                <li key={nome}>
                  <code className="inline-block rounded-controle bg-papel px-2 py-1 text-xs text-tinta">{nome}</code>
                </li>
              ))}
            </ul>
          </div>
        )}
        {item.pendencia && <SeloStub texto={item.pendencia} />}

        {item.toggles.map((toggle) => (
          <ToggleConfiguracao key={toggle.chave} chave={toggle.chave} valor={toggle.valor} descricaoBanco={toggle.descricao} aoSalvar={aoMudar} />
        ))}

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-tinta-fraca">Último sinal</dt>
          <dd className="text-tinta">
            {item.ultimo_evento_em ? (
              <>
                {formatarRelativo(item.ultimo_evento_em)} <span className="text-tinta-fraca">({formatarDataHora(item.ultimo_evento_em)})</span>
              </>
            ) : (
              <span className="text-tinta-fraca">{TRACO} nenhum evento registrado</span>
            )}
          </dd>
          {typeof item.extras.produtos_sem_id === "number" && item.extras.produtos_sem_id > 0 && (
            <>
              <dt className="text-tinta-fraca">Produtos sem ID</dt>
              <dd className="text-tinta">
                {item.extras.produtos_sem_id} —{" "}
                <a href="#produtos" className="font-medium text-[color:var(--latao)] underline-offset-2 hover:underline">
                  preencher em Produtos
                </a>
              </dd>
            </>
          )}
          {typeof item.extras.modo === "string" && (
            <>
              <dt className="text-tinta-fraca">Modo</dt>
              <dd className="text-tinta">{item.extras.modo === "real" ? "real" : "demonstração (rotulado)"}</dd>
            </>
          )}
        </dl>

        <div className="flex flex-wrap items-center gap-3">
          {item.testavel ? (
            <Botao variante="secundario" tamanho="compacto" carregando={testando} onClick={testar}>
              Testar
            </Botao>
          ) : (
            <p className="text-xs text-tinta-fraca">Não dá para testar daqui — a outra ponta é quem chama.</p>
          )}
          {resultado && (
            <p role="status" className={`text-sm ${resultado.ok ? "text-[color:var(--verde)]" : "text-[color:var(--ambar)]"}`}>
              {resultado.detalhe} <span className="text-tinta-fraca">· {formatarDataHora(resultado.testado_em)}</span>
            </p>
          )}
        </div>
      </div>
    </Cartao>
  );
}

/**
 * Um toggle que é dado (`configuracoes`): salva na hora pela rota de
 * configurações (schema por chave em `server/admin/configuracoes.ts`).
 * Boolean vira `Opcao` caixa; enum vira `Selecao`.
 */
function ToggleConfiguracao({ chave, valor, descricaoBanco, aoSalvar }: { chave: string; valor: unknown; descricaoBanco: string; aoSalvar: () => void }) {
  const { notificar } = useToast();
  const [salvando, setSalvando] = useState(false);
  const meta = TOGGLE[chave] ?? { rotulo: chave };

  async function salvar(novo: unknown) {
    setSalvando(true);
    try {
      await atualizarConfiguracao(chave, novo);
      notificar({ tom: "sucesso", titulo: "Configuração salva", descricao: `${meta.rotulo}: ${String(novo)}` });
      aoSalvar();
    } catch (erro) {
      notificar({ tom: "erro", titulo: "Não foi possível salvar", descricao: mensagemDeErro(erro, "Tente de novo em instantes.") });
    } finally {
      setSalvando(false);
    }
  }

  if (typeof valor === "boolean") {
    return (
      <div className="flex flex-col gap-1.5">
        <Opcao tipo="checkbox" rotulo={meta.rotulo} descricao={meta.ajuda ?? descricaoBanco} checked={valor} disabled={salvando} onChange={(e) => salvar(e.target.checked)} />
        {chave === "ligacao_ia.automatica" && valor && (
          <p role="alert" className="text-xs font-medium text-[color:var(--ambar)]">
            Ligado: toda compra dispara uma ligação por IA sem ninguém olhar. Confirme que a decisão LGPD (B33) foi registrada.
          </p>
        )}
      </div>
    );
  }

  const opcoes = meta.opcoes ?? [{ valor: String(valor), rotulo: String(valor) }];
  return (
    <Campo rotulo={meta.rotulo} ajuda={meta.ajuda ?? descricaoBanco}>
      <Selecao value={String(valor)} disabled={salvando} onChange={(e) => salvar(e.target.value)}>
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.rotulo}
          </option>
        ))}
      </Selecao>
    </Campo>
  );
}
