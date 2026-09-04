# Continuar daqui — SIC-HF

Escrito em **03/09/2026**, atualizado no mesmo dia (sessão de tarde/noite — Fase 3),
para retomar o projeto em outra máquina sem perder contexto.
Se você é uma IA abrindo este repositório pela primeira vez: **leia este arquivo inteiro antes de tocar em qualquer coisa**, depois `CLAUDE.md`, depois `brain/00 - Home.md`.

> **Sessão de 04/09 de madrugada (a mais recente):** o briefing esteve **100%
> quebrado em produção** por algumas horas e voltou. Custo caiu de US$ 0,128
> para **US$ 0,055** por briefing. As features da fase 3 estão no ar. Leia o
> §0 logo abaixo antes de qualquer coisa.

## 0. O que você precisa saber antes de tocar em qualquer coisa (04/09)

**1. O schema estrito da IA tem um teto de tamanho, e ele não aparece em lugar
nenhum do build.** A Anthropic compila o JSON Schema do lado dela e recusa com
`400 The compiled grammar is too large`. Medido: **3.905 bytes compila, 4.428
não.** O schema v2 do briefing subiu com `tsc`, `eslint` e `build` verdes e
deixou toda a geração em 500. Antes de acrescentar campo ao schema, rode
`POST /api/admin/sonda-schema` — um 400 do provedor não custa token.

**2. Todo 500 agora vira linha em `erros_servidor`**, com o mesmo `id_erro` que
o cliente recebe e a pilha inteira. É o que permitiu achar a causa acima em vez
de continuar chutando. Consulte por lá antes de formular hipótese.

**3. O custo da IA é controlado pela coluna `effort` de `prompts_versoes`** —
`UPDATE`, sem deploy. Medido no mesmo cliente: `high` US$ 0,1241 · **`medium`
US$ 0,0549 (ativo)** · `low` US$ 0,0397. O `medium` entrega um briefing do
mesmo tamanho que o `high`. Detalhe e ressalvas em `brain/04 - Tecnico/Custo da IA.md`.

**4. O deploy é por arquivo, e dá para fazer por API.** `git archive --format=zip
-o sichf.zip HEAD` e a ferramenta de deploy da Hostinger; leva de 4 a 10 min.
**Carimbe `public/versao.txt` com o commit antes de empacotar** e confira
comparando com `/versao.txt` da produção — foi assim que se descobriu, uma vez,
que o servidor rodava build antigo.

**5. Migrations aplicadas nesta rodada:** 0041b (reconstruída), 0042, 0043,
0045, 0046, 0047. A `0043` criou uma trava: croqui só vira `pronto` com os 13
slides marcados `revisado: true` — a tela que satisfaz isso existe (Editor do
Croqui).

**6. Não confie em `pg_get_viewdef()` para reconstruir migration de view** — ele
devolve só o SELECT, sem as `reloptions`. Foi assim que `security_invoker` sumiu
do arquivo da `0041b` (achado ALTO do pentest, corrigido na `0047`).

---

> **Sessão de 03/09 à noite (esta atualização):** deploy destravado (site estava
> respondendo por um processo Node órfão — resolvido recriando o site do zero no
> hPanel, não por API) e camada de IA migrada de Anthropic direta para
> OpenRouter (rota pinada só na Anthropic). Ver §2, §4b e §7 para o que mudou e
> o que ainda falta. O usuário não pôde auditar o fechamento desta sessão — leia
> §11 (Pendências desta sessão que precisam de revisão humana) antes de confiar
> cegamente no que está aqui.

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
| **Deploy** | `escritorio.grupoparticipa.app.br` — **no ar**, site recriado do zero no hPanel nesta sessão, build via GitHub, login funcionando |
| **Provedor de IA** | **OpenRouter** (rota pinada `provider.order=["anthropic"]`), não mais Anthropic direto — ver §4b |
| **Rodadas feitas** | MVP (fase 1), Fase 2 e início da Fase 3 (migração de IA), aprovadas na trava de qualidade |

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

Estado após a sessão de 03/09 à noite: `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`,
`LINK_PUBLICO_PEPPER` e `OPENROUTER_API_KEY` **já estão aplicadas** nas
Environment Variables do Node.js App na Hostinger (hPanel → o site → Node.js →
Environment) e replicadas em `.env.local` (não versionado — cópia deixada em
`Downloads\.env.local` na máquina onde isso foi feito, para levar à máquina nova).

Ainda faltam:

| Variável | Onde pegar | O que destrava |
|---|---|---|
| `HOTMART_WEBHOOK_SECRET` + os 3 `hotmart_produto_id` | painel da Hotmart | entrada de pagamento; hoje todo evento cai em `produto_nao_mapeado` |
| `RESEND_API_KEY` + `EMAIL_FROM` | Resend | envio real da régua; hoje a mensagem fica na fila |
| `ANTHROPIC_API_KEY` | console.anthropic.com | **opcional** — só serve como caminho de rollback de incidente (`IA_PROVEDOR=anthropic`); a IA já funciona via OpenRouter sem ela |

**Nada disso quebra o sistema sem existir.** Todo caminho responde **503 dizendo o que falta** — nunca um dado falso. `GET /api/diagnostico` (header `x-cron-secret`) diz quais variáveis o servidor enxerga, sem revelar valor.

## 4b. Migração de IA: Anthropic direta → OpenRouter (feita em 03/09 à noite)

**Por quê:** decisão do usuário para reduzir custo/dependência, usando crédito já
disponível no OpenRouter em vez de criar uma API key paga direto na Anthropic.

**O que mudou:**
- Nova interface `ProvedorIa` (`src/server/ia/provedor/tipos.ts`) — os 4
  chamadores de IA (`briefing.ts`, `croqui-analise.ts`, `material.ts`,
  `agenda/ordenar-horarios.ts`) não falam mais com um SDK específico; falam com
  `executarComAuditoria()` (`src/server/ia/executar.ts`), que resolve o
  provedor ativo via `IA_PROVEDOR` (env, default `openrouter`).
- Adaptador OpenRouter (`provedor/openrouter.ts`): `fetch` cru (sem SDK novo,
  mesmo padrão de `regua/email.ts`), rota **pinada só na Anthropic**
  (`provider.order=["anthropic"], allow_fallbacks:false`) — decisão de LGPD:
  mantém a mesma cadeia de subprocessador de hoje, sem risco de o dado de
  patrimônio ser roteado silenciosamente para Bedrock/Vertex/Azure.
- Adaptador Anthropic antigo preservado (`provedor/anthropic.ts`) — caminho de
  reversão sem deploy: `IA_PROVEDOR=anthropic` na Hostinger + restart, se o
  OpenRouter falhar ou o crédito acabar. `@anthropic-ai/sdk` continua no
  `package.json` de propósito.
- Structured output: `zodOutputFormat` nativo da Anthropic não existe no
  OpenRouter — substituído por `response_format` com JSON Schema estrito
  (`provedor/json-schema-estrito.ts`, remove `minLength/minimum/maximum` que o
  modo `strict:true` rejeita) + `schema.safeParse()` como autoridade final +
  1 re-tentativa automática se a saída não validar.
- Custo: `usage.cost` do OpenRouter é usado direto quando disponível;
  `calcularCustoUsd` (`precos.ts`) virou fallback, não caminho principal.
- Migration `0040_modelos_openrouter.sql` — aplicada no banco remoto
  (`fcfsnqqaphtamhrpuyoh`) nesta sessão via MCP do Supabase.

**Modelo escolhido — MUDOU DE PLANO NO MEIO DA SESSÃO, leia isto:**
O plano original (arquiteto) previa Opus para Briefing/Análise do Croqui
(diagnóstico) e Sonnet para material/ordenação (personalização). Na prática,
`anthropic/claude-opus-5` com `reasoning.max_tokens=4096` + `response_format`
estrito + o `BriefingSchema` completo (13 seções) devolveu corpo vazio/inválido
(`openrouter_resposta_vazia`) em chamada real, embora chamadas isoladas com
schema simples no mesmo modelo funcionassem normalmente. **Não houve tempo de
isolar a causa raiz** (schema grande demais para o strict do Opus? falha
transitória do provider?) antes do fim da sessão. Decisão tomada: **Sonnet nas
4 tarefas** — testado de ponta a ponta com sucesso (`gerarBriefing` real contra
jornada existente, custo medido **US$0,0738**, latência ~70s, `stop_reason:
end_turn`, `status: concluida`). Se algum dia quiser Opus no diagnóstico,
reproduza o bug primeiro com um script descartável antes de trocar
`prompts_versoes.modelo_padrao` de volta — não assuma que foi resolvido só por
trocar o modelo.

**Pentest (03/09, mesma sessão):** aprovado, zero achado crítico/alto. Um médio
corrigido na hora (timeout ausente no adaptador Anthropic de rollback — agora
tem os mesmos 120s do OpenRouter). Uma observação baixa não corrigida: mensagem
de erro do OpenRouter gravada em `execucoes_ia.erro` pode, em teoria, ecoar
fragmento de prompt se o provedor alguma vez devolver isso num erro 400 — não
reproduzido, fica registrado como hipótese para o próximo pentest.

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

## 6. Deploy — RESOLVIDO em 03/09 à noite (histórico abaixo, para quem chegar depois)

> ### ⚠️ O deploy NÃO é automático por push
>
> Conferido em 04/09 pela API da Hostinger: os deploys existentes são
> `source_type: archive` (envio manual de pacote) e `git`, mas **nenhum
> disparou sozinho a partir de um push**. Commitar e empurrar para o GitHub
> **não coloca nada no ar**.
>
> Para publicar, o ciclo é:
>
> ```bash
> npm run build                       # tem que passar antes de empacotar
> # empacotar só o versionado, sem .gitignore (o deploy o respeita e comeria o .env.production)
> git archive HEAD | tar -x -C pkg && rm -f pkg/.gitignore
> git rev-parse --short HEAD > pkg/public/versao.txt   # marcador da versão publicada
> # zipar com NOME ÚNICO (nome repetido parece ser reaproveitado) e enviar pelo MCP da Hostinger
> ```
>
> Depois, confirme o que está no ar comparando `/versao.txt` com o commit —
> foi assim que descobri, em 03/09, que o servidor rodava um build antigo
> enquanto os deploys "davam sucesso". **Não confie no build ter subido;
> verifique.**
>
> O build em produção leva de 3 a 6 minutos entre o envio e o site responder
> a versão nova.

**Domínio:** `escritorio.grupoparticipa.app.br` (DNS na Cloudflare, hospedagem Hostinger). **No ar.**

**O que estava acontecendo:** qualquer rota respondia `{"erro":"config_ausente"}` —
uma string que não existia mais no código. Builds novos compilavam limpos
(confirmado via API da Hostinger: `state: completed`), mas o processo que
respondia ao hostname continuava sendo outro, mais antigo — processo Node
órfão, exatamente a hipótese que já estava escrita aqui. Restart do app
(`hosting_restartNode_jsApplicationV1`) e build novo via zip **não resolveram**
— o processo órfão sobreviveu aos dois.

**O que resolveu:** o site foi **apagado e recriado do zero** no hPanel
(ação manual, feita pelo usuário — não por API; a API não expõe como matar um
processo específico, só listar/criar/deletar o site inteiro, e deletar+recriar
por API também não tinha sido tentado com sucesso antes). Isso matou o processo
órfão junto com o site velho. O site novo foi conectado direto ao repositório
GitHub (`source_type: git`, não mais zip manual) — Node 22, autodetectado pelo
hPanel ao conectar via git (os builds antigos bem-sucedidos usavam Node 20; não
houve tempo de confirmar se o Node 22 é 100% estável para este projeto, ver §11).

**Env vars reaplicadas** após a recriação (o site novo nasce sem nenhuma):
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`, `IA_MODO_DEMONSTRACAO`,
`CONHECIMENTO_ANALISE_IA`, `CRON_SECRET`, `LINK_PUBLICO_PEPPER`,
`OPENROUTER_API_KEY` — todas via hPanel → Node.js App → Environment Variables.

**Se o sintoma voltar em outra recriação futura:** repetir o mesmo caminho —
apagar e recriar o site no hPanel é mais confiável do que tentar destravar o
processo órfão por restart/rebuild. Redeployar depois: reconectar ao GitHub
(mais simples que subir zip manual) ou usar o fluxo de upload TUS documentado
em `brain/04 - Tecnico/Deploy na Hostinger.md`.

O site principal `grupoparticipa.app.br` **está intacto** — foi conferido; são apps distintos.

---

## 7. Backlog — o que vem depois

Ordenado pelo que muda mais a vida do escritório.

### Alta prioridade
1. ~~Destravar o deploy~~ **FEITO em 03/09 à noite** — ver §6.
2. ~~Ligar as IAs~~ **FEITO em 03/09 à noite** — migrado para OpenRouter, testado com Briefing real, ver §4b. Falta ainda: rodar o primeiro Briefing contra um cliente real (o teste desta sessão usou uma jornada de seed/teste com pouco dado, `grauConfianca: 10`, `modoReduzido: true` — esperado para dado insuficiente, mas ninguém validou a qualidade do texto contra um caso real ainda).
3. **Ligar a Hotmart**: cadastrar os 3 produtos, configurar o webhook e **testar um pagamento de verdade**. Junto disso, fechar o reprocessamento de webhook que falhou (a RPC existe; falta a rota testar `processado_em is null` antes de responder "já recebi"). **O arquiteto já desenhou isso em detalhe nesta sessão (Frente 2) — não foi implementado por falta dos 3 IDs reais e confirmação do mecanismo de assinatura (hottok vs HMAC). Plano completo não está salvo em arquivo — se perdido, peça ao arquiteto para redesenhar, é rápido.**
4. **Régua no ar**: `RESEND_API_KEY`, domínio de e-mail verificado, e cron do painel da Hostinger batendo em `/api/cron/regua` a cada 5 min. **Também desenhado nesta sessão (Frente 3) — código já está quase pronto (`regua/email.ts`, `regua/processar.ts`), só falta a env var, o DNS do domínio de e-mail e o cron do hPanel.**
5. **Trava de LGPD com peso jurídico** (achado MÉDIO do pentest): hoje a flag que libera IA sobre transcrição é um boolean editável por qualquer admin, sem registrar quem decidiu. Deveria ser uma tabela `decisoes_juridicas` com base legal, quem decidiu e quando — e o trigger olhar para lá. **Ganhou peso extra com a migração para OpenRouter: o consentimento de tratamento por IA (`erros.ts`) nomeia "Anthropic" no texto — confirmar com a Dra. Elaine se isso cobre um subprocessador adicional (OpenRouter), mesmo com a rota pinada só na Anthropic por baixo.**

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

## 11. Pendências desta sessão que precisam de revisão humana

Fechado sem o usuário auditar o resultado final (ele saiu no meio da sessão e
pediu para eu finalizar e subir sozinho). Tudo abaixo foi testado no que deu
para testar sem supervisão, mas nenhum destes pontos teve olho humano em cima:

1. **Node 22 vs Node 20**: o site novo (recriado no hPanel) usa Node 22,
   autodetectado ao conectar via GitHub. Os builds antigos bem-sucedidos (antes
   da recriação) usavam Node 20. O build atual com Node 22 completou e o site
   está respondendo normalmente, mas não houve tempo de rodar uma bateria mais
   longa para garantir que não há diferença de comportamento sutil entre as
   duas versões neste projeto específico.
2. **`anthropic/claude-opus-5` via OpenRouter falhou em teste real** com o
   `BriefingSchema` completo (`openrouter_resposta_vazia`).

   **ATUALIZAÇÃO 04/09 — a evidência aponta para TEMPO, não para o schema.**
   A execução que falhou registrou latência de **120,0s exatos**, que era
   precisamente o `TIMEOUT_MS` do adaptador. E o Sonnet, que "funciona",
   levou **100,8s** num briefing em **modo reduzido** (sem transcrição — só
   formulário e faixa de patrimônio): 84% do teto, com o input mais pobre que
   o sistema vai ver. Um briefing com transcrição da Ligação Estratégica gera
   bem mais saída e passa disso com folga.

   Ou seja: isto não era só um problema do Opus, era um teto apertado que ia
   estourar no Sonnet também assim que entrasse cliente de verdade.

   **O que foi feito:** teto passou para 300s (`IA_TIMEOUT_MS`, configurável
   sem deploy), o mesmo valor no adaptador de rollback da Anthropic, e a
   mensagem de erro passou a distinguir *estourou o tempo* de *corpo vazio de
   verdade* — antes as duas coisas viravam `openrouter_resposta_vazia` e
   mandavam quem investiga para o lado errado.

   **O que continua não provado:** ninguém rodou Opus de novo com o teto novo.
   A hipótese do tempo é forte (latência exata no teto), mas **é hipótese**.
   Antes de trocar `prompts_versoes.modelo_padrao` para Opus, rode um teste
   real e veja o resultado — não assuma que o timeout maior resolveu.
3. **Modelo trocado de Opus para Sonnet nas 4 tarefas de IA** por causa do item
   acima — decisão tomada sem o usuário confirmar explicitamente que abre mão
   da qualidade potencialmente maior do Opus no Briefing/Croqui (ele só chegou
   a aprovar Sonnet em ambas antes de sair, mas o contexto completo — que era
   uma decisão forçada por um bug não resolvido, não só custo — não foi
   discutido com ele).
4. **`grauConfianca: 10` no teste real do Briefing**: baixo, mas a jornada de
   teste usada (`0193cb83-8db9-40a8-bef0-c4aef4ff98d9`, etapa
   `sessao_agendada`) tem pouquíssimo dado real preenchido (é dado de
   seed/desenvolvimento, não de cliente de verdade) — o `grauConfianca` baixo é
   provavelmente correto dado o input pobre, mas ninguém validou visualmente o
   texto do Briefing gerado contra um caso com dado completo.
5. **Migration `0040` foi editada DEPOIS de aplicada** (troquei Opus por Sonnet
   direto no banco via `UPDATE`, e só depois sincronizei o arquivo
   `.sql` para bater com o que já estava no banco). O arquivo de migration e o
   estado do banco **estão consistentes agora**, mas o histórico de migrations
   não reflete que houve uma correção no meio — isso é aceitável para este
   caso (a migration final é idempotente e correta), mas fica registrado.
6. **Achado BAIXO do pentest não corrigido** (mensagem de erro do OpenRouter em
   `execucoes_ia.erro` pode, em teoria, ecoar fragmento de PII) — decisão de
   não corrigir foi minha, por ser hipótese não reproduzida e de severidade
   baixa, não confirmada com o usuário.
7. **Commit e push para o GitHub**: feito sem revisão humana do diff completo
   antes do push (o usuário pediu explicitamente para eu finalizar e subir
   sozinho). Revisar o diff do commit desta sessão antes de continuar
   trabalhando em cima dele, se possível.

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
