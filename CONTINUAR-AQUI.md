# Continuar daqui — SIC-HF

Escrito em **03/09/2026**, para retomar o projeto em outra máquina sem perder contexto.
Se você é uma IA abrindo este repositório pela primeira vez: **leia este arquivo inteiro antes de tocar em qualquer coisa**, depois `CLAUDE.md`, depois `brain/00 - Home.md`.

---

## 1. O que é isto

**SIC-HF — Sistema de Inteligência Comercial para Holding Familiar.** Do escritório da **Dra. Elaine Montenegro** (Time Holding Brasil / Grupo Participa).

Acompanha a pessoa do **seminário** até a **holding contratada**, e entrega ao advogado, antes de cada Sessão de Viabilidade, um **Briefing Estratégico**: quem é aquela família, como decide, o que quer proteger, que objeção virá, que linguagem usar.

Três frases que mudam o produto inteiro, e vêm do documento institucional da própria advogada:
- A Sessão de Viabilidade **não é reunião de vendas** — é diagnóstico.
- O Croqui **não é produto** — é prescrição técnica.
- O cliente compra quando percebe que **foi profundamente compreendido**.

---

## 2. Estado em uma tela

| | |
|---|---|
| **Código** | este repositório (`jotacraq/escritorio-holding`, privado) |
| **Stack** | Next.js 16 · TypeScript · Tailwind v4 · Supabase · Claude API |
| **Banco** | Supabase `fcfsnqqaphtamhrpuyoh`, região `sa-east-1` — **39 migrations aplicadas** |
| **Banco, números** | 51 tabelas · 12 views · 109 policies · **0 tabela sem RLS** · **0 policy `ALL` em tabela com PII** · **0 grant de tabela para `anon`** |
| **Conteúdo real** | 70 transcrições de reuniões · 52 casos · 6 roteiros versionados · 5 prompts ativos · 5 modelos de material |
| **Deploy** | `escritorio.grupoparticipa.app.br` — **travado, ver §6** |
| **Rodadas feitas** | MVP (fase 1) e Fase 2, ambas aprovadas na trava de qualidade |

---

## 3. Como subir na máquina nova

```bash
git clone https://github.com/jotacraq/escritorio-holding.git
cd escritorio-holding
npm install                 # cuidado: npm install no Windows poda deps opcionais de Linux do lockfile
cp .env.example .env.local  # preencher, ver §4
npm run dev                 # http://localhost:3000
```

**Login de teste** (já existe no banco): `juliano.alfredo86@gmail.com` / `SicHf@2026` — papel `admin`.

> ⚠️ **Troque essa senha antes de entrar cliente real no sistema.** Ela está escrita aqui porque
> o repositório é privado e sem ela não dá para retomar em outra máquina — mas é a senha de um
> usuário `admin` de verdade, com acesso a patrimônio e documento. Trocar é no painel do Supabase
> (Authentication → Users), e não quebra nada: o vínculo é por `auth_user_id`, não por senha.
Outras contas: `relacionamento@exemplo.com.br` (papel restrito) e `intruso@exemplo.com.br` (autenticado **sem** convite — usado para provar que a RLS nega tudo).

O banco é compartilhado: **a máquina nova já vê todo o dado**, não precisa recriar nada.

---

## 4. As chaves que faltam — a maior alavanca

Estas são a diferença entre "o sistema funciona" e "o sistema está no ar":

| Variável | Onde pegar | O que destrava |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | painel do Supabase → Settings → API | upload de documento, webhook, cron da régua, convite de equipe, geração de IA |
| `ANTHROPIC_API_KEY` | console.anthropic.com | **as duas IAs** (Briefing e Agente do Croqui) |
| `HOTMART_WEBHOOK_SECRET` + os 3 `hotmart_produto_id` | painel da Hotmart | entrada de pagamento; hoje todo evento cai em `produto_nao_mapeado` |
| `RESEND_API_KEY` + `EMAIL_FROM` | Resend | envio real da régua; hoje a mensagem fica na fila |

Já geradas e em uso: `LINK_PUBLICO_PEPPER` e `CRON_SECRET` (estão no `.env.local` da máquina antiga — **regenere na nova**, são segredos e não estão versionados).

**Nada disso quebra o sistema sem existir.** Todo caminho responde **503 dizendo o que falta** — nunca um dado falso. `GET /api/diagnostico` (header `x-cron-secret`) diz quais variáveis o servidor enxerga, sem revelar valor.

---

## 5. Decisões do João que ainda faltam

Sem elas o sistema funciona, mas parte do método fica desligada. Estão detalhadas em `docs/ARQUITETURA-FASE-2.md` §7.

| # | Decisão | O que está travado | O que fazemos hoje |
|---|---|---|---|
| **B1** | **Critério de MQL.** De onde sai o patrimônio *antes* da compra? A faixa "R$ 500 mil a R$ 1 milhão" entra? | qualificação automática | etapa `qualificado` existe e é manual |
| **B3 / B13** | **LGPD: IA pode ler transcrição de cliente?** São 70 conversas reais e nenhum consentimento registrado para tratamento por IA de terceiro. | análise de IA sobre transcrição | **trava no banco**; a busca e a leitura funcionam |
| **B4** | **Pesquisa em fonte pública** (JusBrasil): base legal e o que pode ser guardado. | coleta | só registro manual, com trava de consentimento |
| **B5** | **Quem vê patrimônio de quem** — a proposta atual precisa de OK antes de cliente real entrar | nada | admin e advogada veem valor; relacionamento vê só a faixa |
| **B14** | Material pós-sessão: quem assina, o que pode prometer (publicidade da OAB) | envio automático | material é rascunho até aprovação humana |
| **B15** | **Qual das 4 guias do script é a oficial?** O material tem 4 versões sem carimbo | nada | a v4 está ativa, e a tela avisa que não foi confirmada |
| **B19** | **Retenção**: por quanto tempo guardar gravação, transcrição, IR e contrato social | expurgo | guardamos tudo; nenhuma política de expurgo escrita |

---

## 6. Deploy — o que está travado e como destravar

**Domínio:** `escritorio.grupoparticipa.app.br` (DNS na Cloudflare, hospedagem Hostinger).

**Sintoma:** qualquer rota responde `{"erro":"config_ausente"}` — uma string que **não existe mais no código**. O servidor executa um build antigo e os deploys novos não assumem o hostname.

**Já tentado, sem efeito:** 6 deploys com pacote de nome único, 3 reinícios, apagar o site inteiro e recriar do zero, cache-buster. O build no servidor compila o código novo (o log lista rotas que só existem na versão nova) — o processo que atende é que é outro.

**Hipótese:** processo Node órfão do primeiro deploy, de quando o host ainda era subdomínio do site pai. A API de hospedagem não expõe como matá-lo.

**Como resolver — precisa de mão humana:**
1. hPanel → `grupoparticipa.app.br` → **Node.js App**: achar uma aplicação órfã apontando para `.../public_html/escritorio` e **parar/remover**.
2. Se não aparecer: chamado no suporte da Hostinger — *"processo Node preso servindo escritorio.grupoparticipa.app.br; o site foi recriado e os deploys novos não assumem o hostname"*.
3. Depois disso, redeployar (o passo a passo está em `brain/04 - Tecnico/Deploy na Hostinger.md`).

O site principal `grupoparticipa.app.br` **está intacto** — foi conferido; são apps distintos.

---

## 7. Backlog — o que vem depois

Ordenado pelo que muda mais a vida do escritório.

### Alta prioridade
1. **Destravar o deploy** (§6) e colocar no ar.
2. **Ligar as IAs** com a `ANTHROPIC_API_KEY` e rodar o primeiro briefing real — hoje só o modo demonstração foi exercitado.
3. **Ligar a Hotmart**: cadastrar os 3 produtos, configurar o webhook e **testar um pagamento de verdade**. Junto disso, fechar o reprocessamento de webhook que falhou (a RPC existe; falta a rota testar `processado_em is null` antes de responder "já recebi").
4. **Régua no ar**: `RESEND_API_KEY`, domínio de e-mail verificado, e cron do painel da Hostinger batendo em `/api/cron/regua` a cada 5 min.
5. **Trava de LGPD com peso jurídico** (achado MÉDIO do pentest): hoje a flag que libera IA sobre transcrição é um boolean editável por qualquer admin, sem registrar quem decidiu. Deveria ser uma tabela `decisoes_juridicas` com base legal, quem decidiu e quando — e o trigger olhar para lá.

### Média
5b. **Débitos que a trava final anotou (03/09):**
   - **POP 03 ainda está codificado no front** enquanto o POP 03-B vem do banco (`LigacaoAba.tsx:105`) — dois caminhos para o mesmo conceito. Foi deliberado para não reescrever o que funcionava, mas é dívida: mover o POP 03 para `roteiros_versoes` elimina um dos caminhos.
   - **A equipe consegue emitir link de material antes da aprovação** — não vaza nada (o cliente recebe "link não disponível"), mas a tela de emissão deveria avisar ou bloquear.
   - **`app.registrar_evento_timeline` ficou com grant para `anon`** (migration 0038), desvio do desenho "só 4 funções públicas". Inerte enquanto o schema `app` não for exposto no PostgREST, mas está fora do padrão — reavaliar quando alguém mexer nos grants.

6. **WhatsApp**: hoje é fila manual rotulada. Decidir provedor (API oficial da Meta? Z-API?) — número não oficial tem risco de banimento.
7. **Croqui**: o editor dos 13 slides existe; falta a análise da segunda IA gerando o conteúdo de verdade e o croqui nascendo a partir dela.
8. **POPs 04 a 08**: existem só como título no documento da Dra. Elaine. Vale sentar com ela e escrever.
9. **Acessibilidade formal** das telas novas (públicas, conhecimento, conduzir sessão).
10. **Retenção e expurgo** (B19) — IR e contrato social guardados por prazo indeterminado é passivo, não patrimônio.

### Baixa / quando fizer sentido
11. Portal do cliente (hoje ele interage só por link público — o que é uma decisão boa, não uma limitação).
12. Módulo 4 com IA: padrões, frases que aumentam e reduzem conversão. **Depende do B13.**
13. Trilha `preliminar` (POP 03-B) ligada de ponta a ponta — o roteiro já está no banco.
14. Rate limit do webhook por IP confiável, cooldown de IA com enforcement em runtime (a função existe no banco, não é chamada).

---

## 8. As armadilhas desta base — leia antes de perder tempo

Cada uma custou horas. Estão em `brain/04 - Tecnico/`.

1. **Build verde não prova que o sistema está de pé.** Faltava `grant usage on schema app` e **toda** rota respondia 500, com `tsc`, `eslint` e `build` limpos. Valide autenticado no navegador.
2. **Trigger não exige EXECUTE de quem faz o DML — chamada aninhada dentro da função exige.** Esse padrão quebrou três coisas diferentes aqui (a régua inteira, a timeline, e quase o Módulo 4).
3. **Diagnóstico plausível não é diagnóstico.** O pentest apontou falta de grant para o formulário público quebrado; era um `CHECK` de coluna escrito antes de existir superfície pública. O grant foi concedido e o 500 continuou. **Leia o erro real do Postgres.**
4. **Regra de negócio que só existe na rota não existe** — o PostgREST é uma segunda porta para a mesma tabela.
5. **`unaccent()` é STABLE e não entra em índice.** Use a configuração `pt_unaccent`, que já existe.
6. **`create or replace function` com parâmetro novo cria sobrecarga, não substitui** — as duas coexistem e a chamada falha.
7. **`RAISE` com `%` exige argumento.** Sem ele, a migration inteira não aplica.
8. **O repo não é o banco publicado.** Uma migration já esteve aplicada sem estar versionada. Ao chegar, compare.
9. Deploy da Hostinger **respeita o `.gitignore` do pacote** (some com o `.env.production`) e parece reaproveitar pacote de mesmo nome. Use nome único por deploy.
10. **Nada de polling.** O egress do Supabase é da **organização** — este é o 3º projeto sob o mesmo teto, e uma aba aberta com polling já custou 329 MB/h em outro sistema desta casa.

---

## 9. Como trabalhar aqui

- **Leia o cérebro antes do código.** `brain/00 - Home.md` tem a tabela de descoberta rápida. Uma ou duas notas respondem a maior parte das perguntas de fato e custam uma fração de um `grep` no repo.
- **O vocabulário do documento da Dra. Elaine é o vocabulário do código.** Jornada, esteira, briefing, croqui, arquétipo patrimonial. Sem sinônimo inventado.
- **Nada de dado inventado na tela.** Vazio é vazio, nunca zero. Funcionalidade não pronta usa `<SeloStub>`. Exemplo de IA usa `<SeloDemonstracao>`, com marca d'água **até na impressão**.
- **Toda migration nova começa em `0040`.**
- Ao fechar trabalho substantivo, registre em `brain/Diário/AAAA-MM-DD.md` e suba o que for permanente para a nota de domínio.
- Pipeline de feature (arquiteto → back ‖ front → pentester → trava final) está em `C:\Users\João\CLAUDE.md` na máquina do João; o resumo do que vale aqui está no `CLAUDE.md` deste repositório.

---

## 10. Mapa dos documentos

| Arquivo | O que responde |
|---|---|
| `CLAUDE.md` | as regras não negociáveis do projeto |
| `README.md` | como rodar, variáveis, deploy |
| `docs/ARQUITETURA.md` | o plano da fase 1 (MVP): domínio, schema, RLS, IA, régua |
| `docs/ARQUITETURA-FASE-2.md` | o plano da fase 2: superfície pública, painel, admin, Módulo 4 — e os CONFLITOS e BLOQUEIOS |
| `brain/00 - Home.md` | índice do cérebro, com descoberta por pergunta |
| `brain/03 - Dominio/Glossario.md` | **o que cada palavra significa neste negócio** |
| `brain/03 - Dominio/Esteira do cliente.md` | o caminho do seminário à holding |
| `brain/02 - Metodo/` | POPs, Protocolo 01 (Briefing) e Agente do Croqui |
| `brain/04 - Tecnico/Schema.md` | o banco, os invariantes e as armadilhas |
| `brain/04 - Tecnico/Seguranca.md` | o que já foi auditado e o que segue aberto |
| `brain/04 - Tecnico/Deploy na Hostinger.md` | o deploy e por que está travado |
| `brain/06 - Materiais/` | os documentos originais da Dra. Elaine |
| `brain/Diário/` | o que aconteceu em cada dia, com o porquê |
