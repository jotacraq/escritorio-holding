# Skills instaladas (via vercel-labs/skills)

CLI: `npx skills` (https://github.com/vercel-labs/skills). Gerencia `SKILL.md` de
77+ agentes, incluindo Claude Code. Fonte pode ser `owner/repo`, `owner/repo@skill`
ou URL git. Skill = instrução que o agente segue — tratar como código de terceiro.

## Buscar skill (find-skills)

```bash
npx skills find "<tema>" [--owner <org>]
```

Ex.: `npx skills find "react performance" --owner vercel-labs`. Não instala nada,
só lista `owner/repo@skill` + contagem de installs. A skill `find-skills`
(instalada) automatiza esse fluxo: buscar → checar installs/fonte → propor.

## Instalar

```bash
npx skills add <owner/repo> --skill <nome> -a claude-code -y   # projeto
npx skills add <owner/repo> --skill <nome> -a claude-code -g -y # user-level
```

Grava direto em `.claude/skills/<nome>/` (Claude Code é um dos alvos nativos do
CLI — não precisou de ponte/symlink). `.gitignore` do projeto não bloqueia
`.claude/` — nada a ajustar, versiona normal.

## Onde ficam
- User-level: `C:\Users\João\.claude\skills\`
- Projeto SIC-HF: `C:\Users\João\projetos\sic-hf\.claude\skills\`

## Instaladas no SIC-HF

| Skill | Fonte | O que faz |
|---|---|---|
| `find-skills` | vercel-labs/skills | busca/instala skills do ecossistema (também user-level) |
| `vercel-react-best-practices` | vercel-labs/agent-skills | 70 regras de performance React/Next.js (waterfalls, bundle, RSC, re-render) |
| `web-design-guidelines` | vercel-labs/agent-skills | audita UI contra Web Interface Guidelines (busca regras atualizadas via WebFetch) |
| `supabase` | supabase/agent-skills | uso geral Supabase — auth, RLS, Data API, checklist de segurança |
| `supabase-postgres-best-practices` | supabase/agent-skills | performance/schema/RLS em Postgres, migrations |
| `docx` | anthropics/claude-agent-sdk-demos | gera/edita .docx via docx-js ou OOXML bruto |
| `pdf` | anthropics/claude-agent-sdk-demos | manipula PDF (pypdf), preenche formulário, extrai texto/tabela — **flag "High Risk" do scanner do CLI** (scripts Python revisados, sem código malicioso; risco é heurística por rodar scripts, não achado concreto) |
| `webapp-testing` | anthropics/skills | testa app web local com Playwright (Python), screenshot, DOM |

## Não instaladas (sem fonte oficial confiável achada)
- **pptx**: só existe `anthropics/financial-services@pptx-author`, baseado em
  `python-pptx` e voltado a deck financeiro — não serve o stack Node do SIC-HF.
- **Google Drive**: nenhuma skill de owner oficial; o MCP `Google_Drive` já cobre
  a integração diretamente, sem precisar de skill.
- **vitest / prompt engineering / structured output**: sem skill de fonte oficial
  com uso claro; a skill `claude-api` (já disponível via plugin) já cobre
  parâmetros/structured output da API.

## Regra de segurança
Skill é instrução que o agente vai seguir — risco de prompt injection. **Ler o
`SKILL.md` inteiro antes de instalar.** Só instalar de fonte confiável
(vercel-labs, anthropics, supabase, ou org oficial equivalente) e com conteúdo
que não contenha instrução estranha ao que anuncia.

## Uso pela squad
Antes de implementar algo coberto por um tema acima, rodar
`npx skills find "<tema>"` primeiro. Se já houver skill instalada aqui, segui-la
em vez de reinventar a prática (ex.: mexeu em RLS → ler `supabase-postgres-best-practices`
antes de escrever a migration; nova página Next.js → aplicar
`vercel-react-best-practices`).
