/**
 * Camada 3 de 3 da verificação de acessibilidade (Fase 8, D23).
 *
 *   estática   → `eslint-plugin-jsx-a11y` (`npm run lint`, roda no CI)
 *   componente → `vitest-axe` nos `*.test.tsx` (`npm test`, roda no CI)
 *   página     → ESTE arquivo. LOCAL, nunca no CI.
 *
 * **Por que local.** O CI desta base não fala com o Supabase (é o cabeçalho do
 * `ci.yml`: nenhum segredo de verdade entra lá) e toda tela interna exige
 * sessão. Um axe de página no CI ou logaria com credencial de produção num
 * runner público, ou rodaria contra a tela de login e passaria verde sem ter
 * visto nada — trava verde que não prova nada é pior do que trava nenhuma.
 * Aqui ele roda contra o `next dev` da máquina de quem está desenvolvendo, com
 * o seed de demonstração, e o resultado vai para `tmp/squad/a11y/`.
 *
 * **O que ele acha que as outras camadas não acham:** ordem de leitura da
 * página inteira, landmark duplicado, foco preso, contraste com as cores
 * COMPUTADAS pelo navegador (com os tokens do `globals.css` carregados de
 * verdade) e ARIA que só existe depois de a tela buscar dados.
 *
 * Uso:
 *   1. `npm run dev` noutro terminal
 *   2. `node scripts/a11y.mjs --email <e-mail> --senha <senha>`
 *      `node scripts/a11y.mjs --telas /hoje,/clientes --escalas padrao,grande`
 *
 * Saída: `tmp/squad/a11y/<data>/relatorio.json` + uma captura por tela/escala,
 * e um resumo no terminal. Sai com código 1 se houver violação `serious` ou
 * `critical` — é o piso de aceite das telas da Fase 8.
 *
 * Chromium: reaproveitado do cache do `npx` (mesmo caminho que os scripts de
 * medição da Fase 7 usam). Playwright NÃO é dependência do projeto: ele serve
 * a bancada de quem desenvolve, não o app que a Hostinger instala.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

const require = createRequire(import.meta.url);

/* ---------------------------------------------------------------- argumentos */

function arg(nome, padrao) {
  const i = process.argv.indexOf(`--${nome}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

const BASE = arg("base", "http://localhost:3000");
const EMAIL = arg("email", process.env.A11Y_EMAIL ?? "");
const SENHA = arg("senha", process.env.A11Y_SENHA ?? "");
const TELAS = arg("telas", "/hoje,/clientes,/agenda,/mensagens,/admin").split(",").map((t) => t.trim()).filter(Boolean);
const ESCALAS = arg("escalas", "padrao").split(",").map((e) => e.trim()).filter(Boolean);
const TEMAS = arg("temas", "claro").split(",").map((t) => t.trim()).filter(Boolean);
const LARGURA = Number(arg("largura", "1440"));
const ALTURA = Number(arg("altura", "900"));

// Só localhost. Este script faz login com credencial real e tira foto de tela
// com PII de cliente na frente — apontá-lo para produção seria vazar dado de
// família num arquivo de tmp/. (Mesma trava do simulador de webhook.)
const alvo = new URL(BASE);
if (!["localhost", "127.0.0.1", "[::1]"].includes(alvo.hostname)) {
  console.error(`Recusado: ${BASE} não é local. Este script só roda contra o \`next dev\` da sua máquina.`);
  process.exit(2);
}

/* ------------------------------------------------------------------ playwright */

const CAMINHOS_PLAYWRIGHT = [
  "playwright",
  "playwright-core",
  // Cache do `npx` no Windows (o mesmo que os scripts de medição da Fase 7 usam).
  path.join(process.env.LOCALAPPDATA ?? "", "npm-cache/_npx/7f4967a1621aa3dc/node_modules/playwright/index.mjs"),
];

async function carregarChromium() {
  for (const alvoModulo of CAMINHOS_PLAYWRIGHT) {
    try {
      const modulo = alvoModulo.endsWith(".mjs")
        ? await import(`file:///${alvoModulo.replace(/\\/g, "/")}`)
        : await import(alvoModulo);
      if (modulo.chromium) return modulo.chromium;
    } catch {
      // tenta o próximo
    }
  }
  console.error(
    "Playwright não encontrado. Rode uma vez `npx playwright@latest install chromium` (ele fica no cache do npx; " +
      "não vira dependência do projeto) e tente de novo.",
  );
  process.exit(2);
}

/* ------------------------------------------------------------------------ axe */

// `axe-core` já é dependência de desenvolvimento (veio com o `vitest-axe`), então
// a fonte é a mesma nas camadas 2 e 3: uma versão só, um resultado só.
const FONTE_AXE = require.resolve("axe-core/axe.min.js");

async function auditar(pagina) {
  await pagina.addScriptTag({ path: FONTE_AXE });
  return pagina.evaluate(async () => {
    // `axe` entra no escopo global pelo script injetado acima.
    const resultado = await window.axe.run(document, {
      resultTypes: ["violations"],
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
    });
    return resultado.violations.map((v) => ({
      id: v.id,
      impacto: v.impact,
      ajuda: v.help,
      link: v.helpUrl,
      quantidade: v.nodes.length,
      exemplos: v.nodes.slice(0, 3).map((n) => n.html.slice(0, 220)),
    }));
  });
}

/* ----------------------------------------------------------------------- main */

const chromium = await carregarChromium();
const carimbo = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const pasta = path.join("tmp", "squad", "a11y", carimbo);
await mkdir(pasta, { recursive: true });

const navegador = await chromium.launch();
const contexto = await navegador.newContext({ viewport: { width: LARGURA, height: ALTURA } });
const pagina = await contexto.newPage();

if (EMAIL && SENHA) {
  await pagina.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await pagina.fill('input[type="email"]', EMAIL);
  await pagina.fill('input[type="password"]', SENHA);
  await pagina.click('button[type="submit"]');
  await pagina.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
} else {
  console.warn("Sem --email/--senha: só dá para auditar tela pública. Toda tela interna vai cair no login.");
}

const relatorio = [];
let graves = 0;

for (const tema of TEMAS) {
  for (const escala of ESCALAS) {
    for (const tela of TELAS) {
      await pagina.goto(`${BASE}${tela}`, { waitUntil: "networkidle" });
      // Preferências aplicadas DEPOIS de carregar e recarregando: é assim que
      // a pessoa usa (escolhe uma vez, e vale nas próximas visitas).
      await pagina.evaluate(
        ([e, t]) => {
          localStorage.setItem("sic-hf-escala", e);
          localStorage.setItem("sic-hf-tema", t === "escuro" ? "escuro" : "claro");
        },
        [escala, tema],
      );
      await pagina.reload({ waitUntil: "networkidle" });
      await pagina.waitForTimeout(1500);

      // `<details>` fechado esconde conteúdo do axe. A Fase 6 passou a recolher
      // seção longa; auditar só o que está aberto seria auditar meia tela.
      await pagina.evaluate(() => {
        document.querySelectorAll("details").forEach((d) => d.setAttribute("open", ""));
      });

      const violacoes = await auditar(pagina);
      const rolagemHorizontal = await pagina.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      const altura = await pagina.evaluate(() => document.body.scrollHeight);
      // O `font-size` do `<body>` NÃO responde: os degraus vêm das classes
      // (`text-corpo`, `text-legenda`), e a raiz continua nos 16px do
      // navegador de propósito (a trava do `globals.css`). Para saber o
      // tamanho de verdade, mede-se uma sonda com a classe do corpo.
      const corpo = await pagina.evaluate(() => {
        const sonda = document.createElement("span");
        sonda.className = "text-corpo";
        (document.querySelector("main") ?? document.body).appendChild(sonda);
        const tamanho = getComputedStyle(sonda).fontSize;
        sonda.remove();
        return tamanho;
      });

      const nome = `${tela.replace(/\//g, "_") || "_raiz"}--${tema}--${escala}`;
      await pagina.screenshot({ path: path.join(pasta, `${nome}.png`), fullPage: false });

      const seria = violacoes.filter((v) => v.impacto === "serious" || v.impacto === "critical");
      graves += seria.length;
      relatorio.push({ tela, tema, escala, largura: LARGURA, altura, corpo, rolagemHorizontal, violacoes });

      const marca = seria.length === 0 ? "ok" : `${seria.length} GRAVE(S)`;
      console.log(
        `${tela.padEnd(12)} ${tema.padEnd(6)} ${escala.padEnd(7)} corpo ${corpo.padEnd(6)} altura ${String(altura).padEnd(6)} ` +
          `rolagem-h ${rolagemHorizontal ? "SIM" : "não"}  axe: ${violacoes.length} violação(ões), ${marca}`,
      );
      for (const v of seria) console.log(`    · ${v.id} (${v.impacto}, ${v.quantidade}×) — ${v.ajuda}`);
    }
  }
}

await writeFile(path.join(pasta, "relatorio.json"), JSON.stringify(relatorio, null, 2), "utf8");
await navegador.close();

console.log(`\nRelatório e capturas em ${pasta}`);
if (graves > 0) {
  console.error(`Reprovado: ${graves} violação(ões) serious/critical.`);
  process.exit(1);
}
console.log("Nenhuma violação serious/critical.");
