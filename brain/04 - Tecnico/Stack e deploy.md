# Stack e deploy — SIC-HF

## Decisões fundacionais (2026-09-03, com o João)

| Item | Decisão | Por quê |
|---|---|---|
| Framework | **Next.js (App Router, TypeScript)** | Deploy fácil no Node App da Hostinger; João já domina a stack. |
| UI | Tailwind + componentes próprios | Sem lock-in de design system pesado. |
| Banco/Auth/Storage | **Supabase**, projeto NOVO | Isolar PII pesada (patrimônio, IR, contrato social) dos outros sistemas. |
| Região | **sa-east-1** | Dados de brasileiros, latência e LGPD. |
| IA | **Claude API** — `claude-opus-5` no briefing/análise longa, `claude-sonnet-5` no resto | Análise de transcrição longa é o caso de uso central. |
| Pagamento | **Webhook Hotmart** | Três produtos: Sessão de Viabilidade · Croqui Estrutural · Holding. |
| Deploy | **Hostinger Node.js App** (não Vercel) | Escolha do João. Next em `output: 'standalone'`. |

## Projeto Supabase

- Nome: **SIC-HF**
- Ref / project id: `fcfsnqqaphtamhrpuyoh`
- Região: `sa-east-1` · Postgres 17
- URL: `https://fcfsnqqaphtamhrpuyoh.supabase.co`
- Publishable key: `sb_publishable_qxiG66XwJoQw07Khlust7w_RA-I7DXw`
- Custo: **+US$ 10/mês** na org Grupo Participa (projeto adicional em plano pago).
- Anon legacy key existe; usar a publishable nova.
- **A `service_role` não fica registrada aqui.** Pegar no painel do Supabase e colocar só no `.env.local` / variáveis do Node App da Hostinger.

> **Egress é da ORG, não do projeto.** A org já tem 2 projetos (Sistema Grupo Participa, Credenciamento THB); este é o 3º e divide o mesmo teto. Nada de polling em tela aberta — uma aba com polling já custou 329 MB/h em outro sistema.

## Consequências do deploy na Hostinger (valem como restrição de projeto)

- **Sem Edge runtime.** Todo route handler roda em Node.
- **Sem cron da Vercel.** As réguas de comunicação (D-7, dia da sessão, pós-sessão) precisam de cron da Hostinger ou `pg_cron` no Supabase.
- **Deploy não é automático por push** por padrão — conferir se ficou manual. Push na main não deploya sozinho a menos que se configure.
- `npm install` no Windows poda deps opcionais de Linux do lockfile e pode quebrar o build da Hostinger. Cuidado ao mexer no `package-lock.json` daqui.

## Ambientes

- Local: `.env.local` (nunca commitado).
- Produção: variáveis no painel do Node App da Hostinger.
- Segredos que existem: `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `HOTMART_WEBHOOK_SECRET`, credencial de e-mail. **Nenhum deles entra em nota, commit ou log.**
