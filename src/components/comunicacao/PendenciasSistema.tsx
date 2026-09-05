import Link from "next/link";
import { Cartao } from "@/components/ui/Cartao";
import { Selo } from "@/components/ui/Selo";
import { formatarRelativo } from "@/lib/formatar";
import { titleDe } from "@/lib/vocabulario";
import { pendenciaVisivelPara } from "@/components/painel/blocosPorPapel";
import type { PapelEquipe } from "@/lib/api";
import type { PendenciaSistemaComunicacao } from "./api-comunicacao";

/** Tipos de `vw_pendencias_sistema` que dizem respeito a comunicação. `cron_parado` já é a linha de envio automático. */
const TIPOS_DESTA_TELA = new Set(["sessao_sem_sala", "mensagem_falhou", "ligacao_ia_falhou"]);

const ROTULO_TIPO: Record<string, string> = {
  sessao_sem_sala: "Sessão sem sala",
  mensagem_falhou: "Envio falhou",
  ligacao_ia_falhou: "Ligação por IA falhou",
  cron_parado: "Envio automático parado",
};

const TITLE_TIPO: Record<string, string | undefined> = {
  mensagem_falhou: titleDe("regua"),
  ligacao_ia_falhou: titleDe("provedor_ligacao"),
  cron_parado: titleDe("envio_automatico"),
};

function rotuloTipo(tipo: string): string {
  return ROTULO_TIPO[tipo] ?? tipo.replace(/_/g, " ");
}

/** Para onde a ação leva. Sessão sem sala → Ficha → Sessão; envio falho → Admin → Pendências (reenfileirar). */
function destino(item: PendenciaSistemaComunicacao): { href: string; rotulo: string } | null {
  if (item.tipo === "sessao_sem_sala" && item.jornada_id) return { href: `/jornadas/${item.jornada_id}#sessao`, rotulo: "Colar o link" };
  if (item.tipo === "mensagem_falhou") return { href: "/admin#pendencias", rotulo: "Reenfileirar" };
  if (item.jornada_id) return { href: `/jornadas/${item.jornada_id}`, rotulo: "Abrir a Ficha" };
  return null;
}

/**
 * Fase 5 §9.1 — o filtro agora é por **papel** além de por tela. Quem não é
 * admin vê só o que uma pessoa resolve (sessão sem sala, ligação que não
 * completou); conserto de infraestrutura ("envio falhou", reenfileirar) é do
 * admin. O item some do array antes do render: não fica escondido no DOM.
 */
export function filtrarPendenciasDeComunicacao(
  itens: PendenciaSistemaComunicacao[],
  papel: PapelEquipe | null,
): PendenciaSistemaComunicacao[] {
  return itens.filter((item) => TIPOS_DESTA_TELA.has(item.tipo) && pendenciaVisivelPara(papel, item.tipo));
}

/**
 * O que está travando um envio e depende de gente. Cada linha leva à tela que
 * resolve. Só aparece quando há algo — vazio é vazio. Título + estado + uma
 * ação: a explicação de por que a régua segura a mensagem saiu do cartão.
 */
export function PendenciasSistema({ itens, papel }: { itens: PendenciaSistemaComunicacao[]; papel: PapelEquipe | null }) {
  const visiveis = itens.filter((item) => pendenciaVisivelPara(papel, item.tipo));
  if (visiveis.length === 0) return null;
  return (
    <Cartao realce="ambar" preenchimento="sem" titulo="Depende de alguém" acao={<Selo tom="ambar">{visiveis.length}</Selo>}>
      <ul className="divide-y divide-linha">
        {visiveis.map((item) => {
          const acao = destino(item);
          return (
            <li key={`${item.tipo}-${item.id}`} className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-4 sm:px-6">
              <div className="min-w-0 flex-1">
                {/* A descrição longa virou `title` — continua a um hover de distância, fora do fluxo. */}
                <p className="text-sm font-bold text-tinta" title={item.descricao ?? TITLE_TIPO[item.tipo]}>
                  {rotuloTipo(item.tipo)}
                  {item.pessoa_nome && <span className="font-normal text-tinta-suave"> · {item.pessoa_nome}</span>}
                </p>
                {item.ocorrido_em && <p className="mt-0.5 text-xs text-tinta-fraca">{formatarRelativo(item.ocorrido_em)}</p>}
              </div>
              {acao && (
                <Link
                  href={acao.href}
                  className="inline-flex min-h-11 items-center rounded-controle border border-linha-controle bg-papel-elevado px-3.5 text-sm font-medium text-tinta transition-colors duration-[var(--transicao-rapida)] hover:border-[color:var(--latao)] hover:text-[color:var(--latao)]"
                >
                  {acao.rotulo}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </Cartao>
  );
}
