import { Bloco, LinhaFila } from "./Bloco";
import { LinkBotao } from "@/components/ui/LinkBotao";
import { Selo } from "@/components/ui/Selo";
import { formatarRelativo } from "@/lib/formatar";
import { titleDe } from "@/lib/vocabulario";
import type { PapelEquipe } from "@/lib/api";
import { pendenciaVisivelPara } from "./blocosPorPapel";
import type { EstadoBloco, PendenciaSistema, TipoPendenciaSistemaConhecido } from "@/types/painel-ui";

/**
 * Rótulo humano de cada tipo (§9.2). "Régua parada — cron não passou" e
 * "Pagamento que falhou ao processar (webhook)" eram dívida técnica escrita
 * na tela de quem só queria saber com quem falar: viraram nome de negócio,
 * com a sigla no `title`.
 */
/**
 * Fase 9 (0089) — dois tipos novos, e nenhum deles está em
 * `TIPOS_PENDENCIA_SISTEMA_CONHECIDOS` (`types/painel-ui.ts` é de outro dono
 * nesta rodada). O `Record` é declarado com a união estendida aqui mesmo: a
 * tela precisa do rótulo hoje, e `rotuloTipoPendencia` já tinha o caminho de
 * fallback para tipo que ela não conhece — o que faltava era o rótulo bom.
 */
type TipoNaTela = TipoPendenciaSistemaConhecido | "numero_desconhecido" | "telefone_fora_do_padrao";

const ROTULO_TIPO: Record<TipoNaTela, string> = {
  webhook_falho: "Pagamento não entrou",
  mensagem_falhou: "Envio falhou",
  link_expirando: "Link expirando",
  material_aguardando_aprovacao: "Material a aprovar",
  cron_parado: "Envio automático parado",
  sessao_sem_sala: "Sessão sem sala",
  ligacao_ia_falhou: "Ligação por IA falhou",
  // "Número desconhecido" seria a leitura do sistema; a da equipe é que alguém
  // escreveu e ninguém sabe quem é. O verbo é o que faz a linha acionável.
  numero_desconhecido: "Escreveu e não é do cadastro",
  telefone_fora_do_padrao: "Telefone fora do padrão",
};

/** A sigla do método/infra que fica no `title` da linha — nunca no fluxo. */
const TITLE_TIPO: Partial<Record<TipoNaTela, string | undefined>> = {
  webhook_falho: titleDe("aviso_pagamento"),
  cron_parado: titleDe("envio_automatico"),
  mensagem_falhou: titleDe("regua"),
  ligacao_ia_falhou: titleDe("provedor_ligacao"),
  numero_desconhecido:
    "Chegou uma mensagem de um número que não casa com ninguém do cadastro. O agente não respondeu — silêncio é a única resposta que não confirma que existe um sistema atrás do número. Vincule a uma pessoa ou responda à mão em Mensagens.",
  telefone_fora_do_padrao:
    "O telefone está gravado fora do padrão internacional (+55…). Enquanto estiver assim, mensagem recebida desse número não casa com o cadastro e o agente não responde. A correção é à mão: o sistema não reescreve telefone de ninguém sozinho.",
};

/** Tipo novo que a tela ainda não conhece vira texto legível — nunca derruba o bloco. */
export function rotuloTipoPendencia(tipo: string): string {
  return (ROTULO_TIPO as Record<string, string>)[tipo] ?? tipo.replace(/_/g, " ");
}

/** Para onde "Resolver" leva quando não há jornada: pendências de sistema puro. */
function destinoSemJornada(tipo: string): string | null {
  if (tipo === "cron_parado" || tipo === "mensagem_falhou") return "/mensagens";
  if (tipo === "webhook_falho") return "/admin";
  // Fase 9. As duas pendências novas chegam SEM `jornada_id` de propósito
  // (0089): o número desconhecido não tem processo, e o telefone torto é da
  // pessoa, não de um processo. Cada uma vai para a tela onde a ação existe.
  if (tipo === "numero_desconhecido") return "/mensagens#recebidas";
  return null;
}

/** O verbo do botão: "Resolver" genérico não diz o que vai acontecer no clique. */
function rotuloDoBotao(tipo: string): string {
  if (tipo === "numero_desconhecido") return "Ver a mensagem";
  if (tipo === "telefone_fora_do_padrao") return "Corrigir o telefone";
  return "Resolver";
}

/**
 * Bloco 4 — o que emperrou e depende de uma ação. Linha sem `jornada_id` não
 * vira link inventado: vai para a tela do sistema que resolve, ou fica texto.
 *
 * Fase 5: filtrado por papel. Quem não é admin não vê conserto de
 * infraestrutura (aviso de pagamento, envio automático parado) — vê só o que
 * uma pessoa resolve. O filtro é no array, antes do render: o item some do
 * DOM, não fica escondido por CSS.
 */
/**
 * O recorte de pendências que uma PESSOA resolve, para o papel dado.
 * Exportado porque o KPI "Travado" do topo tem de contar exatamente o que este
 * bloco mostra — duas contagens da mesma coisa é como a tela passa a mentir.
 */
export function pendenciasVisiveis(itens: PendenciaSistema[], papel: PapelEquipe | null): PendenciaSistema[] {
  return itens.filter((i) => i.tipo !== "cron_parado" && pendenciaVisivelPara(papel, i.tipo));
}

export function Travado({
  estado,
  papel,
  aoTentarDeNovo,
}: {
  estado: EstadoBloco<PendenciaSistema>;
  papel: PapelEquipe | null;
  aoTentarDeNovo: () => void;
}) {
  // `cron_parado` nunca entra aqui: para o admin ele já é a linha "Envio
  // automático" da seção Sistema, e para os demais é ruído de infra. Contar
  // duas vezes a mesma pendência é o que faz o painel parecer cheio.
  const filtrado: EstadoBloco<PendenciaSistema> =
    estado.situacao === "ok" ? { situacao: "ok", itens: pendenciasVisiveis(estado.itens, papel) } : estado;

  return (
    <Bloco
      id="travado"
      rotulo="Travado"
      titulo="Precisa de alguém"
      dica="O que emperrou e só destrava com uma ação da equipe: sessão sem sala, envio que falhou, material esperando aprovação."
      mensagemNadaPendente="Nada travado."
      estado={filtrado}
      aoTentarDeNovo={aoTentarDeNovo}
    >
      {(itens) => (
        <ul className="divide-y divide-linha">
          {itens.map((item) => {
            // `telefone_fora_do_padrao` não tem `jornada_id` (é da PESSOA), mas
            // tem o nome — e `/clientes?busca=` abre a lista já na pessoa certa,
            // com a mesma busca que quem clicou faria à mão. Sem nome, cai na
            // lista inteira: melhor a tela certa do que um link inventado.
            const destino =
              item.tipo === "telefone_fora_do_padrao"
                ? item.pessoa_nome
                  ? `/clientes?busca=${encodeURIComponent(item.pessoa_nome)}`
                  : "/clientes"
                : item.jornada_id
                  ? `/jornadas/${item.jornada_id}`
                  : destinoSemJornada(item.tipo);
            return (
              <LinhaFila key={item.id}>
                <span title={TITLE_TIPO[item.tipo as TipoNaTela]} className="inline-flex">
                  <Selo tom="vermelho">{rotuloTipoPendencia(item.tipo)}</Selo>
                </span>

                {/* A descrição longa saiu do fluxo (lei de texto) e virou `title` da linha:
                    continua acessível a quem procura, sem virar parágrafo no cartão. */}
                <div className="min-w-0 sm:flex-1">
                  <p className="text-sm font-bold text-tinta sm:truncate" title={item.descricao ?? undefined}>
                    {item.pessoa_nome ?? item.titulo}
                  </p>
                </div>

                {item.ocorrido_em && <span className="whitespace-nowrap text-legenda text-tinta-fraca">{formatarRelativo(item.ocorrido_em)}</span>}

                {destino ? (
                  <LinkBotao href={destino} className="sm:ml-auto">
                    {rotuloDoBotao(item.tipo)}
                  </LinkBotao>
                ) : (
                  <span className="text-legenda text-tinta-fraca sm:ml-auto">Sem cliente ligado</span>
                )}
              </LinhaFila>
            );
          })}
        </ul>
      )}
    </Bloco>
  );
}
