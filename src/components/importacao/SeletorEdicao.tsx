"use client";

import { useEffect, useState } from "react";
import type { EdicaoSeminario } from "@/types/banco";
import { Campo, Entrada, Selecao } from "@/components/ui/Campo";
import { EsqueletoLinha } from "@/components/ui/Esqueleto";
import { EstadoVazio } from "@/components/ui/Estado";

/**
 * Lista as edições do seminário para o operador escolher em qual jogar a
 * importação. A única rota que lista edições hoje é `GET /api/admin/edicoes`
 * (`exigirPapel("admin")` — fronteira de outro agente, B-2B). Papéis
 * `advogada`/`relacionamento` também podem confirmar importação
 * (`POST /api/importacoes` aceita os três), mas não têm rota própria de
 * listagem — GAP DE CONTRATO, reportado ao orquestrador. Enquanto não existe
 * `GET /api/edicoes` de uso geral: quem é admin vê a lista; quem não é,
 * digita o identificador (UUID) da edição, com instrução visível de onde
 * pegá-lo (tela Admin → Edições de seminário).
 */
export function SeletorEdicao({
  valor,
  aoMudar,
  desabilitado = false,
}: {
  valor: string;
  aoMudar: (edicaoId: string) => void;
  desabilitado?: boolean;
}) {
  const [edicoes, setEdicoes] = useState<EdicaoSeminario[] | null>(null);
  const [semAcessoLista, setSemAcessoLista] = useState(false);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    fetch("/api/admin/edicoes", { credentials: "include" })
      .then(async (resposta) => {
        if (!vivo) return;
        if (resposta.status === 403) {
          setSemAcessoLista(true);
          return;
        }
        if (!resposta.ok) throw new Error("falha");
        const corpo = (await resposta.json()) as { itens: EdicaoSeminario[] };
        setEdicoes(corpo.itens);
      })
      .catch(() => {
        if (vivo) setSemAcessoLista(true);
      })
      .finally(() => {
        if (vivo) setCarregando(false);
      });
    return () => {
      vivo = false;
    };
  }, []);

  if (carregando) {
    return (
      <div role="status" aria-live="polite" className="flex flex-col gap-2">
        <span className="sr-only">Carregando as edições do seminário…</span>
        <EsqueletoLinha largura="w-40" altura="h-4" />
        <EsqueletoLinha largura="w-full" altura="h-11" />
      </div>
    );
  }

  if (semAcessoLista || !edicoes) {
    return (
      <Campo
        rotulo="Edição do seminário"
        obrigatorio
        ajuda="Seu papel não lista as edições. Cole aqui o identificador da edição — quem tem acesso a Admin → Edições de seminário pode te passar."
      >
        <Entrada
          type="text"
          value={valor}
          disabled={desabilitado}
          onChange={(e) => aoMudar(e.target.value.trim())}
          placeholder="identificador da edição"
          autoComplete="off"
          spellCheck={false}
          className="font-mono text-sm"
        />
      </Campo>
    );
  }

  if (edicoes.length === 0) {
    return (
      <EstadoVazio
        compacto
        titulo="Nenhuma edição de seminário cadastrada"
        descricao="Cadastre a edição em Admin → Edições de seminário antes de importar — todo lead precisa ser rastreável até a edição de onde veio."
      />
    );
  }

  return (
    <Campo rotulo="Edição do seminário" obrigatorio ajuda="A edição de onde estas pessoas vieram. É a origem da coorte — não dá para trocar depois.">
      <Selecao value={valor} disabled={desabilitado} onChange={(e) => aoMudar(e.target.value)}>
        <option value="">Selecione a edição…</option>
        {edicoes.map((edicao) => (
          <option key={edicao.id} value={edicao.id}>
            {edicao.codigo} — {edicao.nome}
          </option>
        ))}
      </Selecao>
    </Campo>
  );
}
