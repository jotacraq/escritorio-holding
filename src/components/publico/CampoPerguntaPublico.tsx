import type { PerguntaFormularioPublico } from "@/types/publico-ui";
import { rotuloOpcao } from "@/lib/vocabulario";

/** Avalia a condicional de uma pergunta (ex.: P11 só aparece se P10 incluir "Imóveis"). Mesma regra da tela interna. */
export function perguntaPublicaVisivel(pergunta: PerguntaFormularioPublico, respostas: Record<string, unknown>): boolean {
  if (!pergunta.condicional) return true;
  const valorDependido = respostas[pergunta.condicional.depende_de];
  if (pergunta.condicional.igual !== undefined) return valorDependido === pergunta.condicional.igual;
  if (pergunta.condicional.contem !== undefined) {
    const lista = Array.isArray(valorDependido) ? valorDependido : [];
    return lista.includes(pergunta.condicional.contem);
  }
  return true;
}

/** Uma pergunta preenchida conta como respondida se tem valor não vazio. */
export function perguntaPublicaRespondida(pergunta: PerguntaFormularioPublico, valor: unknown): boolean {
  if (!pergunta.obrigatoria) return true;
  if (valor === undefined || valor === null) return false;
  if (typeof valor === "string") return valor.trim().length > 0;
  if (Array.isArray(valor)) return valor.length > 0;
  return true;
}

/**
 * Campo de uma pergunta, para uso público (celular, 45–75 anos). Alvo de toque generoso já vem
 * de `.area-publica` (globals.css, `min-height: 44px` em input/button/select/textarea) — aqui só
 * cuido de tipografia grande o bastante e espaçamento entre opções para não errar o toque.
 */
export function CampoPerguntaPublico({
  pergunta,
  valor,
  aoMudar,
}: {
  pergunta: PerguntaFormularioPublico;
  valor: unknown;
  aoMudar: (valor: unknown) => void;
}) {
  const idCampo = `pergunta-publica-${pergunta.id}`;
  const rotuloId = `${idCampo}-rotulo`;
  /*
   * Fase 7 r2 (§UX2.3): o asterisco do rótulo é `aria-hidden` — de propósito,
   * "asterisco" lido em voz alta não quer dizer nada. Só que sem `aria-required`
   * a informação sumia por completo para quem usa leitor de tela: o campo era
   * obrigatório e ninguém dizia. Aqui ele volta pela via correta.
   */
  const obrigatorio = pergunta.obrigatoria || undefined;

  switch (pergunta.tipo) {
    case "texto":
      return (
        <input
          id={idCampo}
          type="text"
          value={(valor as string) ?? ""}
          onChange={(e) => aoMudar(e.target.value)}
          aria-required={obrigatorio}
          autoComplete="off"
          className="w-full rounded-controle border border-linha-controle bg-papel-elevado px-4 py-3 text-base text-tinta"
        />
      );
    case "numero":
      return (
        <input
          id={idCampo}
          type="number"
          inputMode="numeric"
          min={0}
          value={(valor as number) ?? ""}
          onChange={(e) => aoMudar(e.target.value === "" ? null : Number(e.target.value))}
          aria-required={obrigatorio}
          className="w-32 rounded-controle border border-linha-controle bg-papel-elevado px-4 py-3 text-base text-tinta"
        />
      );
    case "texto_longo":
      return (
        <textarea
          id={idCampo}
          rows={4}
          value={(valor as string) ?? ""}
          onChange={(e) => aoMudar(e.target.value)}
          aria-required={obrigatorio}
          className="w-full rounded-controle border border-linha-controle bg-papel-elevado px-4 py-3 text-base text-tinta"
        />
      );
    case "sim_nao":
      return (
        <div role="radiogroup" aria-labelledby={rotuloId} aria-required={obrigatorio} className="flex gap-3">
          {(["sim", "nao"] as const).map((opcao) => (
            <label
              key={opcao}
              className={`flex flex-1 items-center justify-center gap-2 min-h-11 rounded-controle border-2 px-4 py-3 text-base font-medium ${
                valor === opcao ? "border-[color:var(--latao-cta)] bg-latao-fraco text-tinta" : "border-linha-forte bg-papel text-tinta"
              }`}
            >
              <input type="radio" name={idCampo} checked={valor === opcao} onChange={() => aoMudar(opcao)} className="h-5 w-5 accent-[color:var(--latao-cta)]" />
              {opcao === "sim" ? "Sim" : "Não"}
            </label>
          ))}
        </div>
      );
    case "unica":
      return (
        <div role="radiogroup" aria-labelledby={rotuloId} aria-required={obrigatorio} className="flex flex-col gap-2.5">
          {(pergunta.opcoes ?? []).map((opcao) => (
            <label
              key={opcao}
              className={`flex items-center gap-3 min-h-11 rounded-controle border-2 px-4 py-3 text-base ${
                valor === opcao ? "border-[color:var(--latao-cta)] bg-latao-fraco" : "border-linha-forte bg-papel"
              }`}
            >
              <input type="radio" name={idCampo} checked={valor === opcao} onChange={() => aoMudar(opcao)} className="h-5 w-5 shrink-0 accent-[color:var(--latao-cta)]" />
              <span className="text-tinta">{rotuloOpcao(opcao)}</span>
            </label>
          ))}
        </div>
      );
    case "multipla": {
      const selecionadas = Array.isArray(valor) ? (valor as string[]) : [];
      return (
        // Grupo de caixas: `role="radiogroup"` seria mentira (dá para marcar várias).
        // `role="group"` + `aria-labelledby` dá ao conjunto o nome da pergunta.
        <div role="group" aria-labelledby={rotuloId} className="flex flex-col gap-2.5">
          {(pergunta.opcoes ?? []).map((opcao) => (
            <label
              key={opcao}
              className={`flex items-center gap-3 min-h-11 rounded-controle border-2 px-4 py-3 text-base ${
                selecionadas.includes(opcao) ? "border-[color:var(--latao-cta)] bg-latao-fraco" : "border-linha-forte bg-papel"
              }`}
            >
              <input
                type="checkbox"
                checked={selecionadas.includes(opcao)}
                onChange={(e) => aoMudar(e.target.checked ? [...selecionadas, opcao] : selecionadas.filter((o) => o !== opcao))}
                className="h-5 w-5 shrink-0 rounded-controle accent-[color:var(--latao-cta)]"
              />
              <span className="text-tinta">{rotuloOpcao(opcao)}</span>
            </label>
          ))}
        </div>
      );
    }
    default:
      return null;
  }
}
