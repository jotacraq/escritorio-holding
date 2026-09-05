import type { PerguntaFormularioPublico } from "@/types/publico-ui";

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

  switch (pergunta.tipo) {
    case "texto":
      return (
        <input
          id={idCampo}
          type="text"
          value={(valor as string) ?? ""}
          onChange={(e) => aoMudar(e.target.value)}
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
          className="w-full rounded-controle border border-linha-controle bg-papel-elevado px-4 py-3 text-base text-tinta"
        />
      );
    case "sim_nao":
      return (
        <div role="radiogroup" aria-labelledby={rotuloId} className="flex gap-3">
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
        <div role="radiogroup" aria-labelledby={rotuloId} className="flex flex-col gap-2.5">
          {(pergunta.opcoes ?? []).map((opcao) => (
            <label
              key={opcao}
              className={`flex items-center gap-3 min-h-11 rounded-controle border-2 px-4 py-3 text-base ${
                valor === opcao ? "border-[color:var(--latao-cta)] bg-latao-fraco" : "border-linha-forte bg-papel"
              }`}
            >
              <input type="radio" name={idCampo} checked={valor === opcao} onChange={() => aoMudar(opcao)} className="h-5 w-5 shrink-0 accent-[color:var(--latao-cta)]" />
              <span className="text-tinta">{opcao}</span>
            </label>
          ))}
        </div>
      );
    case "multipla": {
      const selecionadas = Array.isArray(valor) ? (valor as string[]) : [];
      return (
        <div className="flex flex-col gap-2.5">
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
              <span className="text-tinta">{opcao}</span>
            </label>
          ))}
        </div>
      );
    }
    default:
      return null;
  }
}
