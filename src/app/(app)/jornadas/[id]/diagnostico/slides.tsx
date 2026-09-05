import type { DiagnosticoSv as Diagnostico } from "@/types/cenario";
import { rotularCategoria } from "@/components/ficha360/DiagnosticoSv";
import type { SlideApresentacao } from "@/types/publico-ui";

/** Só blocos `visivel_ao_cliente` viram slide — os demais nem entram na árvore. */
export function slidesDoDiagnostico(d: Diagnostico): SlideApresentacao[] {
  return d.blocos
    .filter((b) => b.visivel_ao_cliente && b.chave !== "o_que_falta")
    .map((b) => ({
      id: b.chave,
      titulo: b.titulo,
      corpo: (
        <div className="flex flex-col gap-5">
          {b.conteudo && <p className="whitespace-pre-wrap">{b.conteudo}</p>}
          {b.pontos.length > 0 && (
            <ul className="flex flex-col gap-2">
              {b.pontos.map((p, i) => (
                <li key={i} className="flex gap-3">
                  <span aria-hidden="true" className="text-[#ff7400]">
                    ·
                  </span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ),
      notas: [`Categoria: ${rotularCategoria(b.categoria).rotulo}.`, b.fontes.length > 0 ? `Fontes: ${b.fontes.join("; ")}.` : "Sem fonte registrada."].join("\n"),
    }));
}
