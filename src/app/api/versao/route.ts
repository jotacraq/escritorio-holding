export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

/**
 * `GET /api/versao` — qual build está REALMENTE no ar.
 *
 * ## Por que um arquivo estático não bastava (achado de 15/09/2026)
 *
 * `public/versao.txt` era carimbado **à mão** (`echo <hash> > public/versao.txt`,
 * commit "Carimba X como a versão publicada"). A última vez foi 06/09, e o
 * `CLAUDE.md` manda conferi-lo depois de cada push — mas um arquivo digitado
 * à mão não sabe o que está no ar: ele repete o que alguém escreveu.
 *
 * Desde 15/09 o `versao.txt` passou a ser gerado no `prebuild`
 * (`scripts/carimbar-versao.mjs`), o que já o torna honesto. Esta rota resolve
 * o que sobra: **arquivo em `public/` é servido pelo servidor web**, e o
 * histórico deste projeto tem um caso em que *"o processo que atende o
 * hostname não é o build que está sendo enviado"* (6 deploys `completed` sem
 * efeito — `brain/04 - Tecnico/Deploy na Hostinger.md`). Naquele cenário um
 * arquivo estático pode vir de um lugar e o app de outro.
 *
 * Esta rota é **executada pelo processo Node que atende as requisições**. Se
 * ela responde, é o app no ar falando — não o disco.
 *
 * ## Por que é pública
 *
 * Só devolve o que o build já expõe: hash curto do commit e instante do build.
 * Nada de variável de ambiente, caminho de disco ou versão de runtime — isso é
 * `/api/diagnostico`, que exige `CRON_SECRET` e se esconde com 404 sem ele.
 *
 * Ser pública é o ponto: se exigisse segredo, não serviria para a pergunta
 * "subiu?" — que é justamente a que se faz de fora, sem credencial em mãos.
 */

/** Lido de `public/versao.txt` em tempo de execução — o mesmo valor que o `prebuild` escreveu. */
async function lerCarimbo(): Promise<{ commit: string; build: string | null }> {
  try {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const bruto = await readFile(join(process.cwd(), "public", "versao.txt"), "utf8");
    const [commit, build] = bruto.trim().split(/\s+/);
    return { commit: commit || "desconhecido", build: build ?? null };
  } catch {
    // Arquivo ausente ou ilegível: "desconhecido" é honesto. Nunca inventar
    // um hash — um hash errado é pior que nenhum, e foi o que criou o
    // problema que esta rota existe para resolver.
    return { commit: "desconhecido", build: null };
  }
}

export async function GET() {
  const { commit, build } = await lerCarimbo();
  return NextResponse.json(
    { commit, build, agora: new Date().toISOString() },
    { headers: { "cache-control": "no-store" } },
  );
}
