/**
 * Prova de contraste WCAG 2.1 — AAA em texto (7:1), AA em borda de controle
 * (3:1, WCAG 1.4.11). Fase 8, §6/§12 do DESIGN-SYSTEM.
 *
 * Por que este script existe e `scripts/a11y.mjs` não basta: `a11y.mjs` roda
 * o axe-core com `runOnly wcag2aa` — checa contraste a 4,5:1 (AA), nunca a
 * 7:1 (AAA). Os pares corrigidos na migração (C1 6,12 · C3 5,76 · C6 5,91 ·
 * C7 5,81 · C8 6,60 · C9 6,18 na paleta antiga) passariam nesse axe sem uma
 * reclamação — verde ali não prova Fase 8. Este script mede cada par
 * TOKEN A TOKEN, direto do `globals.css` (nunca duplica valor à mão — lê o
 * arquivo real, então nunca diverge dele), nos dois temas.
 *
 * Uso:
 *   node scripts/contraste.mjs                  → :root (claro) + .dark
 *   node scripts/contraste.mjs --temas=claro     → só um tema
 *
 * Saída: tabela com o número medido de cada par. Sai com código 1 se algum
 * par de TEXTO ficar abaixo de 7:1 (exceto a exceção B1, documentada abaixo)
 * ou alguma BORDA DE CONTROLE abaixo de 3:1.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const CAMINHO_CSS = path.join(process.cwd(), "src", "app", "globals.css");
const css = readFileSync(CAMINHO_CSS, "utf8");

/* ------------------------------------------------------------- parser CSS */

/** Extrai o bloco `{ ... }` de um seletor exato (primeira ocorrência). */
function extrairBloco(fonte, seletorRegex) {
  const m = seletorRegex.exec(fonte);
  if (!m) throw new Error(`Seletor não encontrado: ${seletorRegex}`);
  const inicio = m.index + m[0].length;
  let profundidade = 1;
  let i = inicio;
  for (; i < fonte.length && profundidade > 0; i++) {
    if (fonte[i] === "{") profundidade++;
    else if (fonte[i] === "}") profundidade--;
  }
  return fonte.slice(inicio, i - 1);
}

/** `--token: valor;` → Map, ignorando comentários e linhas sem `--`. */
function tokensDoBoco(bloco) {
  const semComentarios = bloco.replace(/\/\*[\s\S]*?\*\//g, "");
  const tokens = new Map();
  const re = /--([\w-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(semComentarios))) {
    tokens.set(m[1], m[2].trim());
  }
  return tokens;
}

// `:root, .area-publica { ... }` — bloco claro principal.
const blocoClaro = extrairBloco(css, /:root,\s*\.area-publica\s*\{/);
// `.dark { ... }` — bloco escuro.
const blocoEscuro = extrairBloco(css, /\n\.dark\s*\{/);

const CLARO = tokensDoBoco(blocoClaro);
const ESCURO = new Map([...CLARO, ...tokensDoBoco(blocoEscuro)]); // .dark herda o que não redefine

function resolverToken(tokens, nome, vistos = new Set()) {
  const valor = tokens.get(nome);
  if (valor === undefined) throw new Error(`Token --${nome} não existe neste tema.`);
  const ref = /^var\(--([\w-]+)\)$/.exec(valor.trim());
  if (ref) {
    if (vistos.has(ref[1])) throw new Error(`Ciclo em --${nome}`);
    vistos.add(ref[1]);
    return resolverToken(tokens, ref[1], vistos);
  }
  return valor.trim();
}

/* -------------------------------------------------------------- luminância */

function hexParaRgb(hex) {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const int = parseInt(n, 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function canalLinear(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminanciaRelativa([r, g, b]) {
  const [rl, gl, bl] = [r, g, b].map(canalLinear);
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

function razaoContraste(hexA, hexB) {
  const la = luminanciaRelativa(hexParaRgb(hexA));
  const lb = luminanciaRelativa(hexParaRgb(hexB));
  const [clara, escura] = la >= lb ? [la, lb] : [lb, la];
  return (clara + 0.05) / (escura + 0.05);
}

/* ------------------------------------------------------------------ pares */

/**
 * Pares a medir. `tipo: "texto"` exige ≥ 7:1 (AAA); `tipo: "controle"` exige
 * ≥ 3:1 (WCAG 1.4.11, borda de input/select/textarea contra o fundo).
 *
 * `excecao`: motivo documentado de um par que fica abaixo do piso de
 * propósito (decisão B1 do Marcio) — o script reporta e NÃO conta como
 * falha, mas grava o número medido igual, para não esconder o dado.
 */
const PARES = [
  // Texto principal sobre as três superfícies.
  { nome: "tinta / papel-fundo", a: "tinta", b: "papel-fundo", tipo: "texto" },
  { nome: "tinta / papel", a: "tinta", b: "papel", tipo: "texto" },
  { nome: "tinta / papel-elevado", a: "tinta", b: "papel-elevado", tipo: "texto" },
  { nome: "tinta-suave / papel-fundo", a: "tinta-suave", b: "papel-fundo", tipo: "texto" },
  { nome: "tinta-suave / papel", a: "tinta-suave", b: "papel", tipo: "texto" },
  { nome: "tinta-suave / papel-elevado", a: "tinta-suave", b: "papel-elevado", tipo: "texto" },
  { nome: "tinta-fraca / papel-fundo", a: "tinta-fraca", b: "papel-fundo", tipo: "texto" },
  { nome: "tinta-fraca / papel", a: "tinta-fraca", b: "papel", tipo: "texto" },
  { nome: "tinta-fraca / papel-elevado", a: "tinta-fraca", b: "papel-elevado", tipo: "texto" },
  /* `tinta-fraca / linha` NÃO entra: `--linha` nunca é superfície de leitura.
     Medidos os 14 usos de `bg-linha` em 14/09/2026 — todos são divisória de
     1px (`w-px`), trilha de barra de progresso (`rounded-full h-2`) ou fundo
     de `:active` momentâneo. Nenhum recebe texto. Media 6,49 (claro) / 6,33
     (escuro) e reprovava um par que não existe na tela — alarme que toca
     sempre é alarme ignorado. Se algum dia `bg-linha` receber texto, o par
     volta para cá. */

  // Marca — latão como texto/borda (nunca como fundo de CTA aqui). O pior
  // caso real medido é contra `--latao-fraco` (chip de marca sobre o próprio
  // fundo claro): 6,34:1 no tema claro, 6,22:1 no escuro — abaixo dos 7:1
  // AAA, ainda bem acima do piso AA (4,5:1). Exceção B1 (Marcio): é
  // chip/selo de marca (rótulo caixa alta, ~11px), nunca corpo de texto.
  {
    nome: "latao / latao-fraco",
    a: "latao",
    b: "latao-fraco",
    tipo: "texto",
    excecao: "chip/selo de marca, não corpo de texto — B1",
  },
  {
    nome: "latao / papel-fundo",
    a: "latao",
    b: "papel-fundo",
    tipo: "texto",
    excecao: "chip/selo de marca, não corpo de texto — B1",
  },
  {
    nome: "latao / papel-elevado",
    a: "latao",
    b: "papel-elevado",
    tipo: "texto",
    excecao: "chip/selo de marca, não corpo de texto — B1",
  },

  // Borda de controle contra as superfícies em que aparece (WCAG 1.4.11).
  { nome: "linha-controle / papel-fundo", a: "linha-controle", b: "papel-fundo", tipo: "controle" },
  { nome: "linha-controle / papel", a: "linha-controle", b: "papel", tipo: "controle" },
  { nome: "linha-controle / papel-elevado", a: "linha-controle", b: "papel-elevado", tipo: "controle" },

  // Estado (selo Fase 8, §12) — cada `--estado-*` sobre seu `-fraco` E sobre
  // as três superfícies onde o selo aparece. `estado-latao` usa o MESMO
  // valor de `--latao` (decisão do Marcio, tabela GPS-THB 14/09: "exceção
  // B1") — herda a mesma exceção documentada, pelo mesmo motivo (chip/selo,
  // nunca corpo de texto corrido).
  ...["verde", "ambar", "vermelho", "azul", "latao", "neutro"].flatMap((tom) => {
    const corTexto = `estado-${tom}`;
    const corFraca = tom === "latao" ? "latao-fraco" : tom === "neutro" ? "papel" : `${tom}-fraco`;
    const excecao = tom === "latao" ? "chip/selo de marca, não corpo de texto — B1 (estado-latao = latao)" : undefined;
    const pares = [{ nome: `${corTexto} / ${corFraca}`, a: corTexto, b: corFraca, tipo: "texto", excecao }];
    for (const sup of ["papel", "papel-elevado", "papel-fundo"]) {
      if (sup === corFraca) continue;
      pares.push({ nome: `${corTexto} / ${sup}`, a: corTexto, b: sup, tipo: "texto", excecao });
    }
    return pares;
  }),
];

/* -------------------------------------------------------------------- main */

const argTemas = process.argv.find((a) => a.startsWith("--temas="));
const temasPedidos = argTemas ? argTemas.split("=")[1].split(",").map((t) => t.trim()) : ["claro", "escuro"];

const TEMAS = { claro: CLARO, escuro: ESCURO };

let falhas = 0;
let excecoesUsadas = 0;
const linhasSaida = [];

for (const nomeTema of temasPedidos) {
  const tokens = TEMAS[nomeTema];
  if (!tokens) {
    console.error(`Tema desconhecido: ${nomeTema} (use claro|escuro)`);
    process.exit(2);
  }
  linhasSaida.push(`\n=== TEMA ${nomeTema.toUpperCase()} ===`);
  for (const par of PARES) {
    let hexA, hexB;
    try {
      hexA = resolverToken(tokens, par.a);
      hexB = resolverToken(tokens, par.b);
    } catch (e) {
      linhasSaida.push(`  ${par.nome.padEnd(34)} ERRO: ${e.message}`);
      falhas++;
      continue;
    }
    const razao = razaoContraste(hexA, hexB);
    const piso = par.tipo === "texto" ? 7 : 3;
    const passou = razao >= piso;
    let marca;
    if (passou) {
      marca = "ok";
    } else if (par.excecao) {
      marca = "EXCEÇÃO DOCUMENTADA";
      excecoesUsadas++;
    } else {
      marca = "FALHA";
      falhas++;
    }
    linhasSaida.push(
      `  ${par.nome.padEnd(34)} ${razao.toFixed(2)}:1  (piso ${piso}:1, ${par.tipo.padEnd(9)})  ${marca}` +
        (par.excecao && !passou ? `\n      → ${par.excecao}` : ""),
    );
  }
}

console.log(linhasSaida.join("\n"));
console.log(
  `\n${falhas === 0 ? "Nenhuma falha." : `${falhas} falha(s).`} ${excecoesUsadas} exceção(ões) documentada(s) aplicada(s).`,
);

if (falhas > 0) {
  console.error(`Reprovado: ${falhas} par(es) abaixo do piso WCAG sem exceção documentada.`);
  process.exit(1);
}
