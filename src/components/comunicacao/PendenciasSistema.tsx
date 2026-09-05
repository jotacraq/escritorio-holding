import Link from "next/link";
import { Cartao } from "@/components/ui/Cartao";
import { Selo } from "@/components/ui/Selo";
import { formatarRelativo } from "@/lib/formatar";
import type { PendenciaSistemaComunicacao } from "./api-comunicacao";

/** Tipos de `vw_pendencias_sistema` que dizem respeito a comunicação. `cron_parado` já é o bloco de prova de vida. */
const TIPOS_DESTA_TELA = new Set(["sessao_sem_sala", "mensagem_falhou", "ligacao_ia_falhou"]);

const ROTULO_TIPO: Record<string, string> = {
  sessao_sem_sala: "Sessão sem link da sala",
  mensagem_falhou: "Envio que falhou",
  ligacao_ia_falhou: "Ligação por IA falhou",
  cron_parado: "Régua parada",
};

function rotuloTipo(tipo: string): string {
  return ROTULO_TIPO[tipo] ?? tipo.replace(/_/g, " ");
}

/** Para onde a ação leva. Sessão sem sala → Ficha → Sessão; envio falho → Admin → Pendências (reenfileirar). */
function destino(item: PendenciaSistemaComunicacao): { href: string; rotulo: string } | null {
  if (item.tipo === "sessao_sem_sala" && item.jornada_id) return { href: `/jornadas/${item.jornada_id}#sessao`, rotulo: "Colar o link da sala" };
  if (item.tipo === "mensagem_falhou") return { href: "/admin#pendencias", rotulo: "Reenfileirar no Admin" };
  if (item.jornada_id) return { href: `/jornadas/${item.jornada_id}`, rotulo: "Abrir a Ficha" };
  return null;
}

export function filtrarPendenciasDeComunicacao(itens: PendenciaSistemaComunicacao[]): PendenciaSistemaComunicacao[] {
  return itens.filter((item) => TIPOS_DESTA_TELA.has(item.tipo));
}

/**
 * O que está travando um envio e depende de gente: sessão nas próximas 24 h
 * sem link da sala (o e-mail do dia fica em hold), envio que falhou, ligação
 * por IA que não completou. Cada linha leva à tela que resolve. Só aparece
 * quando há algo — vazio é vazio.
 */
export function PendenciasSistema({ itens }: { itens: PendenciaSistemaComunicacao[] }) {
  if (itens.length === 0) return null;
  return (
    <Cartao
      realce="ambar"
      preenchimento="sem"
      titulo="Depende de alguém para sair"
      descricao="A régua segura estas mensagens até o dado que falta ser preenchido."
      acao={<Selo tom="ambar">{itens.length}</Selo>}
    >
      <ul className="divide-y divide-linha">
        {itens.map((item) => {
          const acao = destino(item);
          return (
            <li key={`${item.tipo}-${item.id}`} className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-4 sm:px-6">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-tinta">
                  {rotuloTipo(item.tipo)}
                  {item.pessoa_nome && <span className="font-normal text-tinta-suave"> · {item.pessoa_nome}</span>}
                </p>
                {item.descricao && <p className="mt-0.5 text-sm text-tinta-suave">{item.descricao}</p>}
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
