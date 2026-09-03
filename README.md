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

O build é `standalone`. **O passo 4 é a armadilha clássica: sem ele o site sobe sem CSS.**

1. `npm run build`
2. Copiar `public/` para dentro de `.next/standalone/public/`
3. Copiar `.next/static/` para dentro de `.next/standalone/.next/static/`
4. Conferir que os dois passos acima aconteceram de verdade — o standalone **não** inclui esses diretórios
5. Start: `node .next/standalone/server.js`, porta vinda de `process.env.PORT`
6. Variáveis de ambiente no painel do Node App (as da tabela acima)
7. Cron do painel: `*/5 * * * *` → `curl` em `POST /api/cron/regua` com header `x-cron-secret`

Restrições que vêm daqui e valem como regra de código: **sem Edge runtime** (`export const runtime = 'nodejs'` em toda rota), sem `@vercel/*`, sem `vercel.json`, sem `waitUntil`.

> `npm install` no Windows poda dependências opcionais de Linux do lockfile e pode quebrar o build na Hostinger. Cuidado ao regenerar `package-lock.json` a partir daqui.

## Validação

Build verde não prova que a tela abre — este projeto já teve o sistema inteiro respondendo 500 com `tsc`, `eslint` e `npm run build` todos limpos. Valide autenticado, no navegador:

```bash
npx tsc --noEmit
npm run build
node valida-telas.mjs    # login real + captura de cada tela
node valida-fluxos.mjs   # busca, régua, fila de mensagens, recorte por papel
```

(os dois scripts vivem no scratchpad da sessão que os criou; recrie-os no repo se forem virar rotina de CI)

## O que ainda não está ligado

- Credenciais da Hotmart (IDs de produto e segredo do webhook) — sem elas todo pagamento cai em `produto_nao_mapeado`.
- WhatsApp é **fila manual rotulada na tela**; não há disparo automático.
- Pesquisa em fonte pública (JusBrasil) não existe — depende de decisão jurídica sobre base legal.
- POPs 04 a 08 existem só como título no documento da Dra. Elaine.
- Trilha POP 03-B (lead que não veio do seminário): desenhada no schema, desligada no produto.
