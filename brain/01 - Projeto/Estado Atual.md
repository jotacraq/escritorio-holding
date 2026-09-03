# Estado Atual — SIC-HF

**Atualizado em:** 2026-09-03

## O que é

Sistema para o escritório da **Dra. Elaine Montenegro** (Time Holding Brasil / Grupo Participa) acompanhar o cliente da chegada no seminário até a contratação da Holding, e para dar ao advogado, **antes de cada Sessão de Viabilidade**, um briefing de quem é aquela família, como ela decide e como a sessão deve ser conduzida.

O nome e o método vêm de um documento institucional escrito pela própria advogada (SIC-HF v1.0) — [[02 - Metodo/POPs]] e [[02 - Metodo/Protocolo 01 - Briefing Estrategico]].

## Em que pé está

- **2026-09-03** — Dia 1. Projeto nascendo. Nada em produção.
- Materiais de origem recebidos e extraídos para `06 - Materiais/`.
- Projeto Supabase criado (`fcfsnqqaphtamhrpuyoh`, sa-east-1) — [[04 - Tecnico/Stack e deploy]].
- Repositório de código: `C:\Users\João\projetos\sic-hf`.
- Alvo do João: **MVP funcional para apresentar em 2026-09-04**.

## Escopo do MVP (definido pelo João)

1. Pipeline/kanban do lead por etapa, com origem por edição de seminário.
2. Ficha 360 do cliente — formulário, ligação, patrimônio, documentos, linha do tempo.
3. Briefing Estratégico gerado por IA (Protocolo 01).
4. Croqui em HTML, modo apresentação, dentro do sistema (substitui o slide).
5. Webhook Hotmart + réguas de comunicação (boas-vindas, D-7, dia da sessão, pós-sessão).

## Fora do MVP, mas prometido no documento

- Pesquisa em fontes públicas (JusBrasil e afins) para enriquecer a ficha — **tem implicação de LGPD, decidir antes de implementar**.
- Material/isca em PDF personalizado pela dor do cliente, enviado pós-sessão.
- Módulo 4 — base de conhecimento que aprende com as sessões (74 transcrições reais já disponíveis).
- Ligação de agendamento feita por IA.
- POPs 04 a 08: existem só como título no documento, sem procedimento escrito.

## Riscos que já se conhecem

- **PII sensível de verdade:** patrimônio, imposto de renda, contrato social, composição familiar. Isso não é cadastro de aluno — é sigilo profissional de advogado. Storage privado, RLS em tudo, e nada disso vai para a IA sem regra explícita.
- **Dinheiro passando pelo webhook.** Webhook de pagamento que falha aberto ou perde evento = venda invisível. Idempotência e fail-closed são obrigatórios.
- Prazo de um dia: o que não der, fica como **stub rotulado na tela** — nunca dado falso.
