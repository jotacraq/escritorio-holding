# 2026-09-03 — Decisões fundacionais do SIC-HF

Tomadas no arranque do projeto, com o João.

## 1. Next.js + Supabase + Hostinger Node App

**Alternativas:** Next na Vercel; PHP na Hostinger (padrão de outros sistemas do Grupo Participa).
**Escolha:** Next.js na **Hostinger Node App**, decidida pelo João — a Vercel não interessa e o deploy de Node lá é o caminho conhecido.
**Custo da escolha:** sem Edge runtime, sem cron da Vercel (régua de comunicação precisa de cron da Hostinger ou `pg_cron`), deploy provavelmente não automático por push.

## 2. Projeto Supabase novo, região sa-east-1

**Por quê:** o dado aqui é patrimônio, imposto de renda, contrato social e composição familiar — sigilo profissional de advogado, não cadastro de aluno. Não divide banco com sistema de aluno.
**Custo:** +US$ 10/mês na org Grupo Participa.
**Atenção herdada:** egress do Supabase é **da org**, não do projeto. Este é o 3º projeto no mesmo teto. Nada de polling em tela aberta.
**Ref:** `fcfsnqqaphtamhrpuyoh`.

## 3. Claude API como motor de IA

`claude-opus-5` para o Briefing Estratégico e análise de transcrição; `claude-sonnet-5` para tarefas menores. Camada de serviço isolada, prompt versionado em tabela, saída estruturada em JSON.

## 4. O vocabulário do documento da Dra. Elaine é o vocabulário do código

Lead · MQL · Cliente · Sessão de Viabilidade · Croqui Estrutural · Holding · Briefing Estratégico · Arquétipo Patrimonial. Sem sinônimo inventado, sem tradução para inglês no domínio.
**Por quê:** o documento institucional é a fonte da verdade do método e a advogada vai usar o sistema. Se a tela chamar de outra coisa, ela não reconhece o próprio processo.

## 5. Stub rotulado, nunca dado plausível

Prazo de um dia até a apresentação. O que não ficar pronto aparece na tela **marcado como não implementado**. Nada de número inventado para "ficar bonito na demo" — a advogada pode tomar decisão em cima do que vê.
