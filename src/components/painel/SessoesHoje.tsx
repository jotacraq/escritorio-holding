import Link from "next/link";
import { Bloco, LinhaFila } from "./Bloco";
import { LinkBotao } from "@/components/ui/LinkBotao";
import { ChipProximoPasso } from "@/components/esteira/ChipProximoPasso";
import { SeloPresenca } from "@/components/agenda/SeloPresenca";
import { Selo } from "@/components/ui/Selo";
import { formatarHora, formatarData } from "@/lib/formatar";
import { titleDe } from "@/lib/vocabulario";
import { derivarProximoPasso } from "@/lib/pasta/proximo-passo";
import { sinaisDaSessaoDoDia } from "@/lib/pasta/sinais";
import type { EstadoBloco, SessaoDoDia } from "@/types/painel-ui";

/** Uma linha da fila com a marca de qual sub-seção ela pertence. */
interface ItemFila {
  sessao: SessaoDoDia;
  /** `true` = veio de `vw_sessoes_em_aberto` (dia já passou, sem desfecho). */
  atrasada: boolean;
}

/**
 * Uma linha da fila — hoje/amanhã ou em aberto, mesma forma nas duas. Quando
 * `atrasada`, a data completa aparece ao lado da hora (a linha pode não ser
 * mais "hoje") e o selo "Em aberto" entra antes do preparo — hierarquia por
 * POSIÇÃO, densa, sem enfeite (nunca só cor).
 */
function LinhaSessao({ sessao, atrasada }: ItemFila) {
  const proximo = derivarProximoPasso(sinaisDaSessaoDoDia(sessao));
  return (
    <LinhaFila className={atrasada ? "bg-vermelho-fraco/30" : ""}>
      <div className="flex items-baseline gap-3 sm:contents">
        <time dateTime={sessao.inicio_em} className="shrink-0 text-sm font-bold tabular-nums text-tinta sm:w-32">
          {atrasada ? `${formatarData(sessao.inicio_em)} ${formatarHora(sessao.inicio_em)}` : `${formatarHora(sessao.inicio_em)}–${formatarHora(sessao.fim_em)}`}
        </time>
        <Link href={`/jornadas/${sessao.jornada_id}`} className="-my-3 flex min-h-11 min-w-0 items-center py-3 text-sm font-bold text-tinta underline-offset-2 hover:text-[color:var(--latao)] hover:underline sm:flex-1">
          <span className="truncate">{sessao.nome}</span>
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {atrasada && (
          <span title="A data marcada já passou e ninguém registrou o desfecho (realizada, remarcada ou não compareceu).">
            <Selo tom="vermelho">Em aberto</Selo>
          </span>
        )}
        <SeloPresenca presencaConfirmadaEm={sessao.presenca_confirmada_em} inicioEm={sessao.inicio_em} via={sessao.presenca_confirmada_via} />
        {/* A sigla do método ("briefing") fica no `title`, fora do fluxo (§9.2). */}
        <span title={titleDe("briefing_etapa")} className="inline-flex">
          <Selo tom={sessao.tem_briefing ? "verde" : "ambar"}>{sessao.tem_briefing ? "Preparo pronto" : "Sem preparo"}</Selo>
        </span>
      </div>

      <ChipProximoPasso proximo={proximo} jornadaId={sessao.jornada_id} tamanho="compacto" />

      {/* 15/09 — "Conduzir" é o verbo do momento (o dono pediu um atalho
          direto para a condução ao vivo; hoje só existia dentro da Agenda e
          de uma aba da Ficha 360). "Abrir sala" e "Colar link" continuam
          existindo — a sala às vezes é aberta à parte, em outra aba, enquanto
          o roteiro fica aberto aqui — mas descem para secundária: regra da
          casa "um verbo por cartão" (LinhaAgendamento.tsx:168-173). */}
      <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
        {sessao.link_sala ? (
          <a
            href={sessao.link_sala}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center justify-center rounded-controle border border-linha-controle bg-papel-elevado px-3.5 text-sm font-medium text-tinta transition-colors duration-[var(--transicao-rapida)] hover:border-[color:var(--latao)] hover:text-[color:var(--latao)]"
          >
            Abrir sala
            <span className="sr-only"> (abre em nova aba)</span>
          </a>
        ) : (
          <LinkBotao href={`/jornadas/${sessao.jornada_id}#sessao`} variante="secundario">
            Colar link da sala
          </LinkBotao>
        )}
        <LinkBotao href={`/sessoes/${sessao.jornada_id}/conduzir`} variante="cta" title="Abre o roteiro, o briefing e as anotações da sessão">
          Conduzir
        </LinkBotao>
      </div>
    </LinhaFila>
  );
}

/**
 * Combina os dois blocos (`sessoesDoDia` + `sessoesEmAberto`) num só
 * `EstadoBloco`, ANTES de entregar a `<Bloco>` — porque `<Bloco>` decide
 * sozinho "nada pendente" quando o array que recebe está vazio (Bloco.tsx),
 * e ele só conhece o array que chega. Se a Dra. Elaine não tem sessão hoje
 * mas tem duas em aberto de 3 dias atrás, a versão ingênua (passar `estado`
 * cru) mostraria a linha verde "Nenhuma sessão hoje nem amanhã" e esconderia
 * exatamente o problema que esta tarefa existe para resolver. `indisponivel`
 * é contagiante (se qualquer um dos dois falhou, o bloco falhou) — falha
 * parcial não pode parecer "0 pendências".
 */
function combinar(hoje: EstadoBloco<SessaoDoDia>, emAberto: EstadoBloco<SessaoDoDia> | undefined): EstadoBloco<ItemFila> {
  if (hoje.situacao !== "ok" || (emAberto && emAberto.situacao !== "ok")) return { situacao: "indisponivel" };
  // Em aberto primeiro (mais atrasado primeiro), hoje/amanhã depois (mais cedo primeiro).
  const doEmAberto = emAberto?.situacao === "ok" ? [...emAberto.itens].sort((a, b) => b.inicio_em.localeCompare(a.inicio_em)) : [];
  const doHoje = [...hoje.itens].sort((a, b) => a.inicio_em.localeCompare(b.inicio_em));
  return {
    situacao: "ok",
    itens: [...doEmAberto.map((sessao) => ({ sessao, atrasada: true })), ...doHoje.map((sessao) => ({ sessao, atrasada: false }))],
  };
}

/**
 * Bloco 1 — o que ela olha antes de entrar na primeira reunião: horário,
 * quem, presença confirmada (fato do agendamento, C23 — não o `status`),
 * briefing pronto, link da sala e o próximo passo derivado da MESMA função
 * da Esteira e da Agenda.
 *
 * 15/09 — `emAberto` (0104, `vw_sessoes_em_aberto`): sessão marcada para um
 * dia que já passou e sem desfecho registrado não sai mais da tela em
 * silêncio. Entra na mesma lista, ACIMA das de hoje/amanhã (mais atrasa
 * primeiro), com o selo "Em aberto" e a data por extenso na hora — é a
 * mesma ação (Conduzir), só que a urgência já venceu.
 */
export function SessoesHoje({
  estado,
  emAberto,
  aoTentarDeNovo,
}: {
  estado: EstadoBloco<SessaoDoDia>;
  emAberto?: EstadoBloco<SessaoDoDia>;
  aoTentarDeNovo: () => void;
}) {
  const combinado = combinar(estado, emAberto);

  return (
    <Bloco
      id="sessoes-hoje"
      rotulo="Antes de entrar"
      titulo="Sessões de hoje"
      dica="As próximas 48 horas: horário, presença confirmada, preparo pronto e o link da sala. Sessão de um dia que já passou e sem desfecho registrado aparece no topo, marcada “Em aberto”."
      mensagemNadaPendente="Nenhuma sessão hoje, amanhã ou em aberto."
      estado={combinado}
      aoTentarDeNovo={aoTentarDeNovo}
    >
      {(itens) => (
        <ul className="divide-y divide-linha">
          {itens.map((item) => (
            <LinhaSessao key={`${item.atrasada ? "aberto" : "hoje"}-${item.sessao.jornada_id}-${item.sessao.inicio_em}`} sessao={item.sessao} atrasada={item.atrasada} />
          ))}
        </ul>
      )}
    </Bloco>
  );
}
