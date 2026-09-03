"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";

/**
 * Boundary global de "rota não encontrada" (Fase 2, F-0).
 *
 * A Fase 2 acrescenta itens de nav (Painel, Conhecimento, Importações) para
 * rotas que outros agentes ainda estão construindo em ondas seguintes. Sem
 * este arquivo, clicar neles hoje mostra o 404 cru do Next — proibido pelo
 * escopo desta onda. Em vez disso: aviso honesto de "em construção", nunca
 * dado fingido.
 *
 * Rotas conhecidas como "em construção" recebem um rótulo específico; uma
 * rota qualquer que não bate com nada (erro de digitação) recebe a
 * mensagem genérica — nunca inventamos uma explicação que não sabemos ser
 * verdadeira.
 *
 * `/p/...` é a área pública (cliente, sem sessão): aqui NUNCA mostramos o
 * `AppShell` (nav interna, marca do sistema) — se isso vazasse para um link
 * de cliente ainda não publicado, expor a operação por trás seria pior que
 * o 404 que estamos evitando.
 */
const ROTAS_EM_CONSTRUCAO: Record<string, string> = {
  "/painel": "O Painel do dia",
  "/conhecimento": "A Base de Conhecimento",
  "/importacoes": "A área de Importações",
};

export default function NaoEncontrado() {
  const rota = usePathname() ?? "";
  const ehAreaPublica = rota.startsWith("/p/");
  const rotulo = ROTAS_EM_CONSTRUCAO[rota];

  const conteudo = (
    <div className="flex max-w-prose flex-col items-start gap-3 rounded-sm border border-linha bg-papel-elevado p-6">
      <h1 className="font-serif text-xl font-semibold text-tinta">
        {rotulo ? `${rotulo} está em construção` : "Página não encontrada"}
      </h1>
      <p className="text-sm leading-relaxed text-tinta-suave">
        {rotulo
          ? "Esta seção faz parte da Fase 2 e está sendo construída agora. Ainda não há tela nem dado real aqui — volte em breve."
          : "Não encontramos essa página. Ela pode ter mudado de endereço ou ainda estar sendo construída."}
      </p>
      {!ehAreaPublica && (
        <Link
          href="/esteira"
          className="rounded-sm border border-linha-forte bg-latao-fraco px-3.5 py-2 text-sm font-medium text-tinta hover:border-latao"
        >
          Ir para a Esteira
        </Link>
      )}
    </div>
  );

  if (ehAreaPublica) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-papel-fundo px-4 py-10">
        {conteudo}
      </main>
    );
  }

  return <AppShell>{conteudo}</AppShell>;
}
