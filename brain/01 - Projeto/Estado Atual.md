# Estado Atual — SIC-HF

**Atualizado em:** 2026-09-06, 13:10 (Fase 7 fechada e publicada em `9bf5ed6`). Histórico do dia 1 ficou em [[Fase 2 — o que entrou]] e no `Diário/`.

## O que é

Sistema para o escritório da **Dra. Elaine Montenegro** (Time Holding Brasil / Grupo Participa) acompanhar o cliente da chegada no seminário até a holding contratada, e dar ao advogado, **antes de cada Sessão de Viabilidade**, o Briefing Estratégico (quem é a família, como decide, o que proteger, que objeção virá). Depois da sessão, o Croqui é **cálculo determinístico do método** (19 tabelas, faixas, procedência por célula) — a IA só narra.

Nome e método vêm do documento institucional da própria advogada — [[02 - Metodo/POPs]], [[02 - Metodo/Protocolo 01 - Briefing Estrategico]]. Esteira: [[03 - Dominio/Esteira do cliente]].

## Em que pé está (06/09/2026)

| | |
|---|---|
| **Produção** | `escritorio.grupoparticipa.app.br`, Hostinger Node.js App, deploy automático por push no remote `infra` (`origin` = backup; empurrar nos dois). Versão publicada em `/versao.txt`. |
| **Banco** | Supabase `fcfsnqqaphtamhrpuyoh` (sa-east-1), migrations até **0077** aplicadas e provadas (`scripts/verificacao-*.sql`). RLS em toda tabela; links públicos só por RPC (0072). |
| **Dados** | Só a pessoa do próprio João (`origem_dado='exemplo'`), controlada por `scripts/seed-exemplo-completo.ts`. As 70 transcrições de clientes vivem só no banco (sigilo). **Nenhum cliente real passou pelo sistema ainda.** |
| **Fases fechadas** | MVP · 2 · 3 (IA via OpenRouter) · 4 (esteira automatizada, design system) · 5 (Motor do Croqui) · 6 (3 sessões, menu de 5, Ficha em uma tela). Todas com trava do Fable aprovada. |
| **Fase 7 (fechada 06/09)** | "Pronto para apresentar": ligação por IA madura (n8n republicado, pentest ALTO fechado), 0073–0077, vitest 470 testes + CI no GitHub, seed de demo (4 famílias) + `docs/APRESENTACAO.md`, mobile/a11y/consistência. Próximo passo é configuração do João (topo do `CONTINUAR-AQUI.md`). |
| **Acessos** | `elaine@advmais.com` (admin, criado 06/09 — trocar senha no 1º acesso) · `juliano.alfredo86@gmail.com` (admin de teste). |

## O que roda de verdade × o que roda em modo manual rotulado

- **Roda:** login/RLS, esteira e kanban, Ficha 360 (3 sessões), Briefing por IA (`effort=low`, US$ ~0,04), Cenário Patrimonial, Diagnóstico da SV, Motor do Croqui + simulador + `.docx`, radar de documentos, links públicos `/p/*`, régua de mensagens (fila), cron de 4 etapas, painel por papel, Admin (Integrações · Parâmetros · Modelos · Prompts · Custo).
- **Modo manual / travado em configuração (não é código):** e-mail (falta `RESEND_API_KEY`), pagamento Hotmart (falta secret + ids), ligação por IA (workflows n8n e assistente Vapi prontos; falta Variable no n8n + 4 envs na Hostinger), croqui **não fecha** até a Dra. Elaine cadastrar alíquotas reais de ITCMD/ITBI por UF em faixas, sala automática (Meet/Zoom sem decisão), Chatwoot (código pronto, 5 envs).
- **Inativo por decisão:** prompts v3 (briefing) e v2/narrativa (croqui) até bancada; trava dos 13 slides desligada (Marcio, 04/09).

## Decisões pendentes (só o João / Dra. Elaine)

Ver topo de `CONTINUAR-AQUI.md`. Resumo: alíquotas e parâmetros do escritório (divergências), B19 retenção/expurgo de dado sensível, B3/B13 IA sobre transcrição, B1 critério de MQL, B5 quem vê patrimônio, janela/tentativas/prompt da ligação por IA (Ana), provedor de WhatsApp, sala Meet/Zoom, POPs 04–08.

## Riscos que já se conhecem

- **PII de sigilo profissional** (patrimônio, IR, contrato social, transcrição de voz): RLS em tudo, Storage privado, IA só com regra registrada. Retenção ainda sem prazo (B19).
- **Dinheiro pelo webhook:** fail-closed + idempotência por id de evento (0011, 0061). Sem `HOTMART_WEBHOOK_SECRET` o endpoint recusa.
- **Ligação automática ligada em produção** (`ligacao_ia.automatica=true`, decisão do João de 05/09) antes de qualquer ligação real ter sido validada — inofensivo enquanto as envs não existem (cai no manual rotulado), mas o 1º teste real tem de ser com o telefone do João.
- **Deploy por push:** conferir `/versao.txt` depois de cada push; já houve build antigo no ar.
