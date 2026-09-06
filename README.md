# SIC-HF

**Sistema de Inteligência Comercial para Holding Familiar.** Escritório da Dra. Elaine Montenegro — Time Holding Brasil / Grupo Participa.

Acompanha a pessoa do **seminário** até a **holding contratada** e entrega ao advogado, antes de cada Sessão de Viabilidade, um **Briefing Estratégico** gerado por IA: quem é aquela família, como decide, o que quer proteger, que objeção virá e como conduzir a reunião.

> Antes de mexer no código, leia `CLAUDE.md` e o cérebro do projeto em `C:\Users\João\sic-hf-brain` (comece por `00 - Home.md`).

## Stack

Next.js 16 (App Router, TypeScript) · Tailwind v4 · Supabase (Postgres 17, Auth, Storage, RLS) · Claude API · deploy em **Hostinger Node.js App**.

## Rodar local

```bash
npm install
cp .env.example .env.local   # preencher os segredos
npm run dev
```

Sem `SUPABASE_SERVICE_ROLE_KEY` a aplicação sobe e as telas funcionam, mas webhook, cron da régua, upload de documento e as duas IAs respondem erro explícito — **nunca dado falso**.

## Variáveis de ambiente

| Variável | Sem ela |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | nada funciona |
| `SUPABASE_SERVICE_ROLE_KEY` | webhook, cron, IA e upload fora do ar (**só servidor**, nunca com prefixo `NEXT_PUBLIC_`) |
| `ANTHROPIC_API_KEY` | as duas IAs respondem 503 |
| `HOTMART_WEBHOOK_SECRET` | `/api/webhooks/hotmart` responde **503** — fail-closed, nunca aceita evento sem segredo |
| `CRON_SECRET` | `/api/cron/regua` responde 503 |
| `RESEND_API_KEY`, `EMAIL_FROM` | mensagem fica na fila, nunca é marcada como enviada |
| `TZ=America/Sao_Paulo` | horários de agenda e régua saem errados |

## Banco

Migrations em `supabase/migrations/`, numeradas e aplicadas em ordem. **26 aplicadas** no projeto `fcfsnqqaphtamhrpuyoh` (sa-east-1): 33 tabelas, RLS com `force` em todas, 4 papéis, acesso **por convite** (quem se cadastra sem convite não lê uma linha).

Detalhe do schema, invariantes e armadilhas: `C:\Users\João\sic-hf-brain\04 - Tecnico\Schema.md`.
Resultado da auditoria de segurança: `...\04 - Tecnico\Seguranca.md`.

## Deploy — Hostinger Node.js App

O deploy é **automático por push** no remote `infra` (`infra-grupo-participa/escritorio-holding`, branch `main`);
`origin` (jotacraq) é só backup — empurre nos dois. A Hostinger faz `npm ci` + `npm run build` + `next start`.
O build **NÃO é `standalone`** (ver `next.config.ts`: o `server.js` do standalone não carrega `.env.production`,
que é por onde as variáveis do painel chegam — medido em 03/09/2026).

1. Carimbe a versão: `git rev-parse --short HEAD > public/versao.txt` e comite o carimbo.
2. `git push infra HEAD:main` e `git push origin HEAD:main`.
3. Espere 4–10 min e confira `https://escritorio.grupoparticipa.app.br/versao.txt` = o commit — já houve build antigo no ar.
4. Variáveis de ambiente no painel do Node App (as da tabela acima; `.env.example` lista todas).
5. Cron do painel: `*/5 * * * *` → `curl` em `POST /api/cron/regua` com header `x-cron-secret`.

Restrições que vêm daqui e valem como regra de código: **sem Edge runtime** (`export const runtime = 'nodejs'` em toda rota), sem `@vercel/*`, sem `vercel.json`, sem `waitUntil`. Node 22 (`package.json#engines`).

> `npm install` no Windows poda dependências opcionais de Linux do lockfile e pode quebrar o build na Hostinger. Use `npm ci`; se precisar instalar algo, confira `grep -c '"linux' package-lock.json` antes e depois.

## Validação

### 1. O gate automático (GitHub Actions)

`.github/workflows/ci.yml` roda em todo `push` e todo `pull_request` para `main`, no Node 22 da Hostinger: **tipos → lint → testes → build**. Nenhum segredo entra nele; as duas variáveis públicas do Supabase vão com valor falso e nada no build fala com o banco.

Os mesmos quatro comandos, localmente:

```bash
npm run verificar   # typecheck + lint + testes
npm run build
```

### 2. A suíte de testes

```bash
npm test            # vitest run
npm run test:watch
```

Cobre a **lógica pura** do servidor, onde o cálculo mora:

| Arquivo | O que trava |
|---|---|
| `src/server/motor-croqui/calcular.test.ts` | os 19 quadros do croqui, faixas (isento/faixa/teto), a regressão do deck zerado e o 409 que não pode mentir |
| `src/server/motor-croqui/servico.test.ts` | a ponte com o banco: quais linhas viram `EntradaCroqui` e quantas idas ao Supabase |
| `src/lib/pasta/trilho.test.ts` | as 6 bordas do trilho de 9 passos, a espinha das 3 sessões e `sinaisDaFicha` |
| `src/lib/pasta/envios.test.ts` | os 6 motivos e os 6 estados de linha da barra "Enviar" |
| `src/lib/radar/derivar.test.ts` | o radar de documentos |
| `src/server/ligacao-ia/*.test.ts`, `src/server/integracoes/*.test.ts` | janela de discagem, E.164, HMAC, token cifrado, mapeamento Vapi → evento |

Um bloco do motor confere o resultado contra uma **planilha real**; a fixture mora em `tmp/` (fora do versionamento, por conter valor de cliente), então no CI ela aparece como `skipped` — nunca como verde silencioso. Para rodá-la:

```bash
FIXTURE_MOTOR_CROQUI=tmp/squad/fixture-motor-exemplo.json npm test
```

### 3. O que o verde NÃO prova

Mock de Supabase esconde exatamente o bug que esta base já teve (migration não aplicada, `grant` faltando). O que depende de RLS, trigger e RPC continua sendo provado **no banco**, pelos roteiros idempotentes `scripts/verificacao-NNNN.sql`.

E build verde não prova que a tela abre: este projeto já teve o sistema inteiro respondendo 500 com `tsc`, `eslint` e `npm run build` todos limpos. Antes de publicar, valide **autenticado, no navegador**, cada tela do menu.

## O que ainda não está ligado

- Credenciais da Hotmart (IDs de produto e segredo do webhook) — sem elas todo pagamento cai em `produto_nao_mapeado`.
- WhatsApp é **fila manual rotulada na tela**; não há disparo automático.
- Pesquisa em fonte pública (JusBrasil) não existe — depende de decisão jurídica sobre base legal.
- POPs 04 a 08 existem só como título no documento da Dra. Elaine.
- Trilha POP 03-B (lead que não veio do seminário): desenhada no schema, desligada no produto.
