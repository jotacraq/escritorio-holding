"use client";

import { useEffect, useState } from "react";
import type { EdicaoSeminario } from "@/types/banco";

/**
 * Lista as edições do seminário para o operador escolher em qual jogar a
 * importação. A única rota que lista edições hoje é `GET /api/admin/edicoes`
 * (`exigirPapel("admin")` — fronteira de outro agente, B-2B). Papéis
 * `advogada`/`relacionamento` também podem confirmar importação
 * (`POST /api/importacoes` aceita os três), mas não têm rota própria de
 * listagem — GAP DE CONTRATO, reportado ao orquestrador. Enquanto não existe
 * `GET /api/edicoes` de uso geral: quem é admin vê a lista; quem não é,
 * digita o identificador (UUID) da edição, com instrução visível de onde
 * pegá-lo (tela Admin → Edições).
 */
export function SeletorEdicao({
  valor,
  aoMudar,
}: {
  valor: string;
  aoMudar: (edicaoId: string) => void;
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
      <label className="flex flex-col gap-1 text-sm">
        Edição do seminário
        <span className="text-xs text-tinta-fraca">Carregando edições…</span>
      </label>
    );
  }

  if (semAcessoLista || !edicoes) {
    return (
      <label className="flex flex-col gap-1 text-sm" htmlFor="edicao-id-manual">
        Edição do seminário (identificador)
        <input
          id="edicao-id-manual"
          type="text"
          value={valor}
          onChange={(e) => aoMudar(e.target.value.trim())}
          placeholder="cole o ID da edição (Admin → Edições)"
          className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5 font-mono text-xs"
          aria-describedby="edicao-id-manual-ajuda"
        />
        <span id="edicao-id-manual-ajuda" className="text-xs text-tinta-fraca">
          Seu papel não lista edições diretamente. Peça o ID a quem tem acesso a Admin, ou peça para o
          time de tecnologia liberar uma listagem por papel.
        </span>
      </label>
    );
  }

  if (edicoes.length === 0) {
    return (
      <p className="text-sm text-tinta-suave">
        Nenhuma edição de seminário cadastrada ainda. Crie uma em Admin → Edições antes de importar.
      </p>
    );
  }

  return (
    <label className="flex flex-col gap-1 text-sm" htmlFor="edicao-id">
      Edição do seminário
      <select
        id="edicao-id"
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        className="rounded-sm border border-linha-forte bg-papel-elevado px-2.5 py-1.5"
      >
        <option value="">Selecione…</option>
        {edicoes.map((edicao) => (
          <option key={edicao.id} value={edicao.id}>
            {edicao.codigo} — {edicao.nome}
          </option>
        ))}
      </select>
    </label>
  );
}
