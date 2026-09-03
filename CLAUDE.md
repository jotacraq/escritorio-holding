# CLAUDE.md — SIC-HF

**Sistema de Inteligência Comercial para Holding Familiar.** Escritório da Dra. Elaine Montenegro (Time Holding Brasil / Grupo Participa).

## Leia isto antes de tocar em qualquer coisa

0. **`CONTINUAR-AQUI.md`** — estado, pendências, backlog e as armadilhas desta base. Se você está chegando agora, comece por ele.
1. `brain/00 - Home.md` — cérebro do projeto, versionado aqui dentro. Use a tabela de descoberta rápida.
2. `brain/03 - Dominio/Glossario.md` — **os nomes do negócio são os nomes do código.** Não invente sinônimo.
3. `brain/03 - Dominio/Esteira do cliente.md` — a máquina de estados que o sistema inteiro serve.
4. `docs/ARQUITETURA.md` (fase 1) e `docs/ARQUITETURA-FASE-2.md` (fase 2) — o desenho técnico vigente.

> Na máquina do João o cérebro também existe como vault Obsidian em
> `C:\Users\João\sic-hf-brain\` — é a mesma coisa. `brain/` aqui é a cópia
> versionada, para o projeto viajar entre máquinas. **As 70 transcrições de
> clientes NÃO sobem para o repositório** — ver `brain/06 - Materiais/Transcricoes/LEIA-ME.md`.

Ler 1-2 notas do brain responde a maior parte das perguntas de fato e custa uma fração de um Grep no repo. **Brain → nota de domínio → código.** Só leia código para implementar, depurar runtime ou confirmar que o brain está atualizado.

## O que o sistema é

Acompanha a pessoa do **seminário** até a **holding**, e entrega ao advogado, antes de cada Sessão de Viabilidade, um **Briefing Estratégico** gerado por IA: quem é aquela família, como decide, o que quer proteger, que objeção virá, que linguagem usar e como conduzir a sessão.

A Sessão de Viabilidade **não é reunião de vendas** — é diagnóstico. O Croqui **não é produto** — é prescrição técnica. Isso não é retórica: muda o que a tela mostra e o que a IA responde.

## Stack

Next.js (App Router, TS) · Supabase (`fcfsnqqaphtamhrpuyoh`, sa-east-1) · Tailwind · Claude API · deploy **Hostinger Node.js App**.

Restrições que vêm do deploy na Hostinger: sem Edge runtime, sem cron da Vercel, `output: 'standalone'`, e cuidado com `npm install` no Windows podando o lockfile.

## Regras não negociáveis

- **PII pesada.** Patrimônio, imposto de renda, contrato social, composição familiar. É sigilo profissional, não cadastro. RLS em toda tabela, Storage privado por cliente, nada disso vai para a IA sem regra explícita e registrada.
- **Webhook de pagamento falha FECHADO.** Sem secret configurado, o endpoint recusa — nunca aceita. Idempotência por id de evento. Dinheiro perdido no webhook é venda invisível.
- **Nada de dado inventado na tela.** Campo novo nasce vazio e a tela mostra vazio, não zero. Funcionalidade não pronta aparece como stub rotulado, jamais como dado plausível.
- **IA nunca produz análise genérica.** Toda conclusão presa a evidência, separando fato · hipótese · inferência · recomendação, sempre com grau de confiança. Sem evidência, dizer que não há.
- **Métrica de funil é por coorte**, nunca por janela de evento.
- **Prompt é versionado.** Todo briefing guarda a versão do prompt que o gerou.

## Registro obrigatório

Ao fechar qualquer trabalho substantivo, gravar entrada em `brain/Diário/AAAA-MM-DD.md` (e no vault do João, quando estiver na máquina dele) (append, nunca sobrescreve):

```markdown
## HH:MM — <título curto>

**Pedido:** <o que o João pediu>
**Feito:** <arquivo:linha, comando, migration>
**Medido:** <número/saída real; só o que rodou de verdade>
**Decidido:** <decisão + porquê>
**Pendente com o João:** <o que depende dele>
**Notas tocadas:** [[nota]]
```

O que for permanente **também** sobe para a nota de domínio no vault.

## Pipeline de feature

Vale o pipeline user-level do `C:\Users\João\CLAUDE.md`: arquiteto → backend ‖ frontend → security-pentester → fable-orchestrator (trava final, 5 critérios).
Aqui o pentester é **obrigatório** em tudo que toca patrimônio, documento do cliente, webhook ou autenticação — que é quase tudo.
