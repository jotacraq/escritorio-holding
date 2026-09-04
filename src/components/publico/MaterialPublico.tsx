"use client";

import { useCallback } from "react";
import type { AberturaMaterialPublico, BlocoMaterialPublico } from "@/types/publico-ui";
import { abrirLinkMaterial, conferirTipo, ErroLinkPublico } from "@/components/publico/cliente";
import { useRecurso } from "@/hooks/useRecurso";
import { CarregandoPublico, ErroTemporarioPublico } from "@/components/publico/CarregandoPublico";
import { TelaLinkInvalido } from "@/components/publico/TelaLinkInvalido";
import { formatarData } from "@/lib/formatar";

function BlocoConteudo({ bloco, indice }: { bloco: BlocoMaterialPublico; indice: number }) {
  switch (bloco.tipo) {
    case "titulo":
      return (
        <h2 key={indice} className="font-serif text-lg font-bold text-tinta">
          {bloco.texto}
        </h2>
      );
    case "paragrafo":
      return (
        <p key={indice} className="leading-relaxed text-tinta">
          {bloco.texto}
        </p>
      );
    case "lista":
      return (
        <ul key={indice} className="list-disc space-y-1.5 pl-5 leading-relaxed text-tinta">
          {bloco.itens.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
    case "citacao":
      return (
        <blockquote key={indice} className="border-l-4 border-[color:var(--latao)] py-1 pl-4 italic text-tinta-suave">
          {bloco.texto}
        </blockquote>
      );
    default:
      return null;
  }
}

function Conteudo({ abertura }: { abertura: AberturaMaterialPublico }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="nao-imprimir flex items-center justify-between gap-3">
        <p className="text-sm text-tinta-suave">Para {abertura.primeiro_nome} · aprovado em {formatarData(abertura.payload.aprovado_em)}</p>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-md border border-linha-forte bg-papel-elevado px-4 py-2.5 text-sm font-medium text-tinta hover:bg-papel"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 fill-current">
            <path d="M5 2h10v5H5V2Zm-2 6h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2v2H5v-2H3a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Zm4 8v2h6v-2H7Z" />
          </svg>
          Salvar ou imprimir
        </button>
      </div>

      <article className="flex flex-col gap-4 rounded-md border border-linha bg-papel px-5 py-6 sm:px-8 sm:py-8">
        <h1 className="font-serif text-2xl font-bold text-tinta">{abertura.payload.titulo}</h1>
        {abertura.payload.blocos.map((bloco, i) => (
          <BlocoConteudo key={i} bloco={bloco} indice={i} />
        ))}
      </article>
    </div>
  );
}

export function MaterialPublico({ token }: { token: string }) {
  const buscar = useCallback(() => abrirLinkMaterial(token).then((res) => conferirTipo(res, "material")), [token]);
  const { dados: abertura, carregando, erro, recarregar } = useRecurso(buscar, [token]);

  if (carregando) return <CarregandoPublico />;
  if (erro instanceof ErroLinkPublico && erro.codigo === "link_invalido") return <TelaLinkInvalido />;
  if (erro) return <ErroTemporarioPublico aoTentarNovamente={recarregar} />;
  if (!abertura) return null;

  return <Conteudo abertura={abertura} />;
}
