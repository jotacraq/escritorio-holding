import {
  ESTADOS,
  classificarPrazo,
  diferencaEmDias,
  type ClassePrazo,
  type TomEstado,
} from "@/lib/estados/catalogo";
import { IconeEstado } from "@/lib/estados/icones";

/**
 * Data-limite com destaque PRÓPRIO (Fase 8, §B3/D18 e item 8 da pesquisa).
 *
 * No ADVBOX e no Astrea o prazo não se mistura com o status do andamento: são
 * duas informações diferentes, e a que faz o advogado perder o sono é a data.
 * Por isso `Prazo` é um componente à parte de `SeloEstado`, com tom próprio
 * (vermelho vencido · âmbar hoje/em breve · neutro no prazo) e contraste
 * ≥ 7:1, e por isso ele mostra **as duas leituras ao mesmo tempo**: a
 * relativa, que é a que decide ("Vencido há 3 dias"), e a absoluta, que é a
 * que se anota ("07/09"). Só a relativa vira "e isso é quando?"; só a
 * absoluta obriga a pessoa a fazer a conta de cabeça.
 *
 * ```tsx
 * <Prazo vence={tarefa.vence_em} />
 * <Prazo vence={sessao.inicio_em} rotulo="Sessão" mostrarAbsoluta={false} />
 * ```
 */

const TONS: Record<TomEstado, string> = {
  verde: "bg-verde-fraco text-[color:var(--estado-verde)] border-transparent",
  ambar: "bg-ambar-fraco text-[color:var(--estado-ambar)] border-transparent",
  vermelho: "bg-vermelho-fraco text-[color:var(--estado-vermelho)] border-transparent",
  azul: "bg-azul-fraco text-[color:var(--estado-azul)] border-transparent",
  latao: "bg-latao-fraco text-[color:var(--estado-latao)] border-transparent",
  neutro: "bg-papel text-[color:var(--estado-neutro)] border-linha-forte",
};

export interface PrazoProps {
  /** `date` (`2026-09-07`) ou timestamp. `null` vira "Sem prazo". */
  vence: string | Date | null | undefined;
  /** Palavra antes da data ("Prazo", "Sessão"). Fica no leitor de tela também. */
  rotulo?: string;
  /** Injeta o "hoje" — o teste não pode depender do relógio da máquina. */
  agora?: Date;
  /** `false` esconde a data absoluta (lista muito densa). Padrão: mostra. */
  mostrarAbsoluta?: boolean;
  /** `false` não renderiza nada quando não há data. Padrão: mostra "Sem prazo". */
  mostrarSemPrazo?: boolean;
  /** A troca é assíncrona e precisa ser anunciada (`role="status"`). */
  anunciar?: boolean;
  className?: string;
}

/** O texto que decide: relativo, com o número de dias. */
export function textoDoPrazo(classe: ClassePrazo, dias: number): string {
  switch (classe) {
    case "vencido": {
      const n = Math.abs(dias);
      return n === 1 ? "Vencido ontem" : `Vencido há ${n} dias`;
    }
    case "hoje":
      return "Vence hoje";
    case "proximo":
      return dias === 1 ? "Vence amanhã" : `Vence em ${dias} dias`;
    case "futuro":
      return `Vence em ${dias} dias`;
    default:
      return "Sem prazo";
  }
}

/**
 * `2026-09-07` é um `date` do Postgres, não um instante: formatá-lo por fuso
 * (o que `formatarData` faz) devolve **06/09** em São Paulo, porque a string
 * sem hora é lida como meia-noite UTC. Prazo de hoje apareceria como o de
 * ontem. Aqui a data pura é formatada como data local, sem fuso.
 */
function partesDaData(vence: string | Date): { data: Date; iso: string } | null {
  if (vence instanceof Date) {
    if (Number.isNaN(vence.getTime())) return null;
    return { data: vence, iso: vence.toISOString().slice(0, 10) };
  }
  const soData = /^(\d{4})-(\d{2})-(\d{2})$/.exec(vence);
  if (soData) {
    return { data: new Date(Number(soData[1]), Number(soData[2]) - 1, Number(soData[3])), iso: vence };
  }
  const d = new Date(vence);
  if (Number.isNaN(d.getTime())) return null;
  return { data: d, iso: d.toISOString() };
}

const DIA_MES = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
const POR_EXTENSO = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", year: "numeric" });

export function Prazo({
  vence,
  rotulo,
  agora,
  mostrarAbsoluta = true,
  mostrarSemPrazo = true,
  anunciar = false,
  className = "",
}: PrazoProps) {
  const partes = vence === null || vence === undefined || vence === "" ? null : partesDaData(vence);
  if (!partes && !mostrarSemPrazo) return null;

  const referencia = agora ?? new Date();
  const classe: ClassePrazo = partes ? classificarPrazo(partes.data, referencia) : "sem_prazo";
  const definicao = ESTADOS.prazo[classe];
  const dias = partes ? diferencaEmDias(partes.data, referencia) : 0;
  const texto = textoDoPrazo(classe, dias);
  const absoluta = partes && mostrarAbsoluta ? DIA_MES.format(partes.data) : null;

  /** O que se vê: "Vence hoje · 07/09" — ou só "Vence hoje", sem `·` sobrando. */
  const visivel = absoluta ? `${texto} · ${absoluta}` : texto;
  /** O que se ouve: uma frase, com a data por extenso (07/09 vira "zero sete barra zero nove"). */
  const leitura = [
    rotulo ? `${rotulo}: ` : "",
    texto.charAt(0).toLowerCase() + texto.slice(1),
    partes && mostrarAbsoluta ? `, em ${POR_EXTENSO.format(partes.data)}` : "",
  ].join("");

  return (
    <span
      role={anunciar ? "status" : undefined}
      title={partes ? `${rotulo ? `${rotulo}: ` : ""}${POR_EXTENSO.format(partes.data)} · ${definicao.explique ?? ""}`.trim() : definicao.explique}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-legenda font-medium leading-tight ${TONS[definicao.tom]} ${className}`}
    >
      <IconeEstado nome={definicao.icone} className="h-3.5 w-3.5" />
      {/* Duas leituras do MESMO fato, cada uma inteira e montada de uma vez.
          Antes o separador era um nó próprio (`<span aria-hidden>·</span>`)
          entre a parte relativa e a absoluta: sem data ele não aparecia, mas
          o texto do elemento saía "Vence hoje·, em 07/09" — um `·` órfão
          grudado na vírgula do trecho de leitor de tela (achado do CRQ).
          Agora o `·` só existe DENTRO da string visível, e só quando há data:
          separador órfão virou impossível, não improvável. */}
      <span aria-hidden="true" className="truncate">
        {visivel}
      </span>
      {partes ? (
        <time dateTime={partes.iso} className="sr-only">
          {leitura}
        </time>
      ) : (
        <span className="sr-only">{leitura}</span>
      )}
    </span>
  );
}
