import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";

/**
 * Camada 1 de 3 da verificação de acessibilidade (Fase 8, D23).
 *
 *   estática   → este arquivo (`npm run lint`, roda no CI)
 *   componente → `vitest-axe` nos testes ao lado dos componentes (roda no CI)
 *   página     → `node scripts/a11y.mjs`, LOCAL (o CI não tem banco nem sessão)
 *
 * `eslint-config-next` já empacota o plugin `jsx-a11y` e liga um punhado de
 * regras, mas não declara o conjunto: qual regra vale passa a depender da
 * versão do preset, e ninguém percebe quando uma cai. Aqui as 31 regras
 * recomendadas ficam **escritas**, e o plugin já vem registrado pelo preset —
 * por isso só as `rules` entram (redeclarar `plugins` é erro de configuração).
 */
const regrasA11y = jsxA11y.flatConfigs.recommended.rules;

/**
 * Dívida herdada, medida em 07/09/2026 na Rodada 0 da Fase 8: 10 violações em
 * 8 arquivos que **não são do UX1** (fronteira do §G do plano). Baixar a regra
 * para o repo inteiro esconderia também o código novo; então a exceção é por
 * ARQUIVO e por REGRA, com dono e prazo. Quem corrigir o arquivo apaga a linha
 * daqui — a lista só encolhe.
 *
 *   UX2 (Rodada 1) · ficha360/CenarioPatrimonialGaveta.tsx (2 no-autofocus)
 *                  · ficha360/SessaoAba.tsx · ficha360/SessaoSala.tsx (1 cada)
 *                  · esteira/KanbanEsteira.tsx (no-noninteractive-tabindex)
 *
 * Quitado pelo UX3 em 07/09 (os 4 arquivos saíram da lista): o formulário de
 * opções virou `Campo` (o `htmlFor` deixou de depender do aninhamento); o véu
 * da paleta de comandos virou `<button>`; a região rolável do leitor de caso
 * ganhou `role="region"`; e o `autoFocus` do login virou `eslint-disable`
 * justificado no próprio arquivo — é a exceção que a documentação da regra
 * descreve, e agora ela está escrita onde alguém a vai ler.
 *
 * Aviso (`warn`) e não `off`: continua aparecendo em toda rodada de lint.
 */
const DIVIDA_HERDADA = {
  files: [
    "src/components/esteira/KanbanEsteira.tsx",
    "src/components/ficha360/CenarioPatrimonialGaveta.tsx",
    "src/components/ficha360/SessaoAba.tsx",
    "src/components/ficha360/SessaoSala.tsx",
  ],
  rules: {
    "jsx-a11y/no-autofocus": "warn",
    "jsx-a11y/no-noninteractive-tabindex": "warn",
    "jsx-a11y/no-static-element-interactions": "warn",
    "jsx-a11y/label-has-associated-control": "warn",
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  { files: ["**/*.{jsx,tsx}"], rules: regrasA11y },
  DIVIDA_HERDADA,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Rascunho da squad (fora do versionamento): scripts de medição de uma
    // rodada só, que não seguem as regras do app e não vão para produção.
    "tmp/**",
  ]),
]);

export default eslintConfig;
