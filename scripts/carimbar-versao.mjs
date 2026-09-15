/**
 * scripts/carimbar-versao.mjs
 *
 * Escreve `public/versao.txt` com o commit REAL que está sendo compilado.
 * Roda no `prebuild`, então vale tanto no CI quanto no build da Hostinger.
 *
 * ## Por que isto existe (achado de 15/09/2026)
 *
 * `public/versao.txt` era um arquivo **carimbado à mão**: alguém rodava
 * `echo <hash> > public/versao.txt` e commitava ("Carimba X como a versão
 * publicada"). A última vez foi em **06/09** (`28021a2`).
 *
 * O `CLAUDE.md` manda "conferir `/versao.txt` depois de cada push" — mas um
 * arquivo digitado à mão **não sabe o que está no ar**. Ele repete o que
 * alguém escreveu, e continua repetindo depois de 47 commits.
 *
 * Como isso foi descoberto: `/versao.txt` dizia `8fce0e6`, mas
 * `/api/diagnostico` — rota criada em `ba094a5`, que é **ancestral** de
 * `8fce0e6` — respondia **404** em produção. Se o build fosse mesmo o
 * `8fce0e6`, a rota existiria. Ou seja: o arquivo dizia uma versão e o
 * servidor rodava outra, mais velha.
 *
 * **Um carimbo manual não é medição: é uma anotação sobre uma intenção.**
 * A partir daqui o valor vem do git, no momento do build — ninguém precisa
 * lembrar, e ninguém consegue errar.
 *
 * ## O que é escrito
 *
 *   <hash curto> <ISO-8601 do build>
 *
 * A data importa tanto quanto o hash: dois deploys do mesmo commit são
 * indistinguíveis só pelo hash, e "o build é de quando?" é a pergunta que se
 * faz quando algo parece velho no ar.
 *
 * ## Quando o git não está disponível
 *
 * O deploy da Hostinger manda um **archive do código-fonte** (ver
 * `brain/04 - Tecnico/Deploy na Hostinger.md`) — sem `.git`. Nesse caso o
 * `git rev-parse` falha, e aí valem, em ordem: `VERSAO_COMMIT` (env que o
 * empacotador pode injetar), o conteúdo que já estiver no arquivo (o carimbo
 * manual antigo, preservado em vez de apagado), e por último `desconhecido`.
 *
 * NUNCA inventa um hash. "desconhecido" é informação honesta; um hash errado
 * é pior que nenhum — foi exatamente o que criou este problema.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const DESTINO = join(RAIZ, "public", "versao.txt");

function commitDoGit() {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: RAIZ, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

function commitDoArquivo() {
  if (!existsSync(DESTINO)) return null;
  // Só a primeira palavra: o formato novo tem "<hash> <data>".
  const primeiro = readFileSync(DESTINO, "utf8").trim().split(/\s+/)[0];
  return primeiro || null;
}

const commit = commitDoGit() ?? process.env.VERSAO_COMMIT?.trim() ?? commitDoArquivo() ?? "desconhecido";
const linha = `${commit} ${new Date().toISOString()}\n`;

writeFileSync(DESTINO, linha, "utf8");
console.log(`[versao] ${linha.trim()}`);
