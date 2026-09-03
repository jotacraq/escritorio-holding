# SIC-HF — Arquitetura Fase 2

**Versão do plano:** 2.0 · 03/09/2026
**Autor:** arquiteto (Opus) · **Executam:** `backend-engineer`, `frontend-engineer` · **Valida:** `fable-orchestrator`
**Base:** `docs/ARQUITETURA.md` (v1.0, executado — 26 migrations, 33 tabelas)
**Fontes lidas:** `sic-hf-brain\06 - Materiais\SIC-HF (documento da Dra. Elaine).md` (integral) · `Relatorio da Sessao de Viabilidade (template).md` · `Script de Sessao de Viabilidade.md` (estrutura, 4 guias) · `Contexto-Mestre do Agente de Croqui.md` (via nota) · `03 - Dominio\Esteira do cliente.md` · `02 - Metodo\POPs.md` · `04 - Tecnico\Seguranca.md` · 70 arquivos de `06 - Materiais\Transcricoes\` (cabeçalho e pareamento) · código do repo.

> Este documento é **plano**, não código. O DDL é **rascunho comentado**: o `backend-engineer` converte cada bloco no arquivo de migration indicado no cabeçalho do bloco. Nada aqui é para copiar sem ler os `-- NOTA:`.
>
> **Nada do que existe é reescrito.** A Fase 2 adiciona superfície e fecha buracos. Onde a Fase 2 encosta em código existente, o ponto está nomeado com arquivo e o motivo.

---

## 0. Sumário executivo — o que mudou de entendimento

Três descobertas da leitura mudam o desenho e não estavam na lista de partida:

1. **O sistema hoje não tem porta de entrada de dado real.** Não há importação de lead, não há convite de equipe funcionando por e-mail, e `SUPABASE_SERVICE_ROLE_KEY` está **vazia** no `.env.local`. Isso significa que upload de documento, webhook Hotmart, cron da régua, camada de IA e convite de usuário estão todos em 503 honesto hoje. O sistema é uma vitrine com dado de seed. A primeira prioridade não é feature nova bonita — é **entrada de dado**.

2. **As 70 transcrições não são 70 sessões.** São **52 Sessões de Viabilidade** (`transcricao-*.md`) e **18 apresentações de Croqui Estrutural** (`transcricao_completa_*.md`, cujo áudio de origem é prefixado `CE`). Os 18 nomes de croqui têm, todos, uma SV correspondente. Ou seja: o próprio material já contém o rótulo que o Módulo 4 pede — **18 das 52 SVs comprovadamente avançaram para a apresentação do croqui**. O que o material **não** contém é a prova do contrário: não existir gravação de croqui não prova que a pessoa não comprou. Rótulo honesto: `avancou_para_croqui` ou `indefinido`. Nunca `nao_converteu`. Ver **CONFLITO C13**.

3. **A superfície pública é a maior mudança de risco do projeto até hoje.** Até agora, 100% do sistema exigia sessão Supabase + convite ativo + RLS. Formulário, agendamento e upload por link colocam três rotas escrevendo no banco **sem usuário**. O `src/middleware.ts` atual redireciona tudo que não é `/api/` e não é `/login` para o login — se ninguém mexer nele, a página pública nasce inacessível. E o pentest de 03/09 já provou nesta base que **regra de negócio que vive só na rota não existe** (o PostgREST é a segunda porta). Por isso a Fase 2 põe a validação de token **dentro do banco**, em RPC `security definer`, e dá ao papel `anon` exatamente **zero** privilégio de tabela.

O conceito que a Fase 2 acrescenta ao domínio: **o cliente passa a ser um ator do sistema, sem virar usuário do sistema.** Ele responde, escolhe horário, envia documento e lê material — tudo por um objeto novo, o **Link Público**: uma credencial de escopo único, prazo curto e finalidade declarada, presa a uma jornada. Não é conta, não é login, não é `pessoas.auth_user_id` (que segue `NULL` para sempre neste plano).

---

## 1. Gap confirmado, corrigido e completado

Prioridade pelo critério **"o que muda a vida do advogado primeiro"**. `P0` = sem isso o sistema não opera com cliente real.

| # | Gap | Prioridade | Confirmação / correção da leitura |
|---|---|---|---|
| G1 | **Importação de leads por edição (CSV)** | **P0** | Confirmado. Hoje a esteira só se popula por criação manual card a card ou pelo webhook. Sem import, não existe funil. |
| G2 | **Admin de verdade** (equipe/convite, produtos+IDs Hotmart, templates, versões de prompt, edições de seminário, custo de IA, **pendências do sistema**) | **P0** | Confirmado e **ampliado**: falta a aba *Pendências*, que é onde aparecem webhook `produto_nao_mapeado`, mensagem `falhou` e env ausente. O relatório de segurança registra que "falha de pagamento hoje só aparece por SQL". |
| G3 | **Painel inicial do dia** | **P0** | Confirmado. `src/app/page.tsx` hoje só redireciona para `/esteira`. As perguntas estão escritas em `Esteira do cliente.md`: sessões de hoje · quem falta preparo · **quem pagou e não foi contatado** ("o furo que mais dói") · o que trava. |
| G4 | **Formulário público (POP 02 respondido pelo cliente)** | **P0** | Confirmado. O POP 02 diz "Responsável: Cliente", "3 minutos", e vive hoje no Typeform. O POP 01 Etapa 4 manda orientar o cliente a responder **antes** da reunião. Hoje só a equipe digita. |
| G5 | **Fechar os achados de segurança abertos** (`pat_wr`/`rel_wr` `for all` incluindo DELETE; webhook que não reprocessa; sem cooldown de IA; rate limit forjável) | **P0** | **Adicionado por mim.** O próprio `Seguranca.md` fixa o gatilho: *"antes da primeira linha de patrimônio de cliente real entrar no banco"* — e a Fase 2 é exatamente o que faz dado real entrar. |
| G6 | **Agendamento pelo cliente**, com IA ordenando os horários | **P1** | Confirmado. `agendamentos.origem` já aceita `'cliente'` e `'ia'` — desenhado e desligado. Falta o que **não** existe: janela de disponibilidade da advogada. Ver **CONFLITO C10** sobre o que "melhor horário" pode significar sem inventar critério. |
| G7 | **Envio de documentos pelo cliente** (IR, contrato social) | **P1** | Confirmado. A esteira manda: *"Dra. Elaine envia o link de pagamento do croqui + data da apresentação + **pede o IR**"*. Hoje só a equipe faz upload, e mesmo assim precisa de `service_role`. |
| G8 | **Relatório da SV completo, campo a campo** | **P1** | Confirmado, com correção: o **schema já cobre quase tudo**. O que falta é (a) UI para o bloco `tributos jsonb` (ITCMD/ITBI/cartórios), que hoje é um jsonb sem tela; (b) composição patrimonial por tipo com os campos do template (empresas: objeto, composição societária, capital social, nº de empregados, PL, faturamento — vão em `patrimonio_itens.detalhes`); (c) **versão de impressão** do relatório. Campos que o template pede e que **não devem virar coluna**: "Valor pago pela sessão / parcelas" (deriva de `pagamentos`), "Data da sessão" (deriva de `agendamentos`), "Natureza dos bens" e "Quantidade de imóveis" (derivam do POP 02 p10/p11). Duplicar isso cria drift. |
| G9 | **Roteiro da SV na tela + os 4 SIMs** (POP 05) | **P1** | **Adicionado por mim.** O script existe em 4 guias (PARTE 00 a 12) e o **1º SIM é o consentimento de gravação** — hoje capturado em lugar nenhum. Colocar o roteiro na tela transforma a abertura da sessão em registro de consentimento com texto congelado, que é o que destrava metade do problema de LGPD daqui pra frente. |
| G10 | **Ofertas registradas na sessão** (R$ 7.200 padrão / R$ 4.500 Incentivo do Resolvedor) | **P1** | **Adicionado por mim.** A tabela `ofertas` existe desde `0011` e **não tem nenhuma tela** (`src/components/` não tem nada de oferta). Sem registrar a oferta, o valor que chega do webhook não reconcilia com nada — é o CONFLITO C8 do plano v1, que segue aberto na prática. |
| G11 | **Material/isca pós-sessão personalizado pela dor** | **P2** | Confirmado. A régua `pos_sessao` já dispara +2h com "material/isca" no texto — e hoje não existe material nenhum. Ver **CONFLITO C11** (o que é "dor" com fonte de dado) e **C12** (PDF de verdade × página imprimível). |
| G12 | **Trilha POP 03-B** (lead que não veio do seminário) | **P2** | Confirmado. `jornadas.trilha='preliminar'` e `ligacoes_estrategicas.pop='03-B'` existem e estão desligados. As 5 perguntas do 03-B são **outras**; a saída esperada da IA tem 6 campos a mais (estágio de maturidade, nível de urgência, preferência de comunicação, características ainda não confirmadas, motivadores secundários, estratégia de apresentação do croqui). |
| G13 | **Base de conhecimento (Módulo 4)** | **P2** | Confirmado, com a correção do §0.2. A parte **determinística** (importar, parear SV↔CE, rotular, buscar, contar) vale sozinha e roda hoje. A parte **por IA** depende de decisão jurídica — ver **BLOQUEIO B13**. |
| G14 | **Indicadores do POP 01** | **P2** | **Adicionado por mim.** O POP 01 nomeia três indicadores explicitamente: *comparecimento · % de formulários respondidos · % de decisores presentes*. Os três têm fonte de dado hoje (`agendamentos.status`, `formularios_respostas`, `ligacoes_estrategicas.decisores_presentes_na_sessao`) e **nenhum está na `vw_indicadores_esteira`**. Isso não é invenção: está escrito no POP. |
| G15 | **Follow-up (POP 07)** | **P3** | Confirmado como **parcialmente não especificado**. O documento traz só o título. Entrego infraestrutura genérica (`tarefas` com prazo e dono, criadas à mão), **sem inventar cadência**. O que já é automático (`pos_sessao` +2h) continua sendo a única régua pós-sessão. |
| G16 | **Pesquisa em fonte pública** | **P3** | Confirmado como bloqueado. Entrego o arcabouço **de registro manual**: a equipe consulta a fonte por fora, registra o que achou, a base legal e o link — com trava de consentimento (`consentimentos.pesquisa_fontes_publicas`, tipo que já existe no enum). **Zero coleta automatizada, zero scraping.** |
| G17 | **Bypass do middleware para as rotas públicas** | **P0 (pré-requisito)** | **Adicionado por mim.** `src/middleware.ts` hoje: `if (!user && !ehPaginaLogin) → redirect /login`. Sem alterar isso, `/p/<token>` devolve a tela de login para o cliente. É uma linha — e é a diferença entre a feature existir e não existir. |
| G18 | **Templates da régua com os links** | **P1** | **Adicionado por mim.** `mensagens_templates` usa mustache (`{{nome}}`, `{{link_sala}}`). Os links públicos precisam de `{{link_formulario}}`, `{{link_agendamento}}`, `{{link_documentos}}`, `{{link_material}}` — e a renderização precisa gerar o token **no momento do envio**, não antes (token que dorme na fila é token com validade queimada). |

**POPs 04–08, veredito por POP:**

| POP | Vira funcionalidade? |
|---|---|
| 04 — Geração do Briefing | **Já é** (`/api/briefings/gerar`). Fase 2 só acrescenta a variante da trilha `preliminar`. |
| 05 — Sessão de Viabilidade | **Vira** (G9): roteiro versionado na tela + 4 SIMs + registro de oferta. O procedimento existe — é o Script. |
| 06 — Apresentação do Croqui | **Já é** (modo apresentação, 13 slides). |
| 07 — Follow-up | **Honestamente não especificado.** Entrego `tarefas` genérico com `<SeloStub>` dizendo que o POP 07 não tem procedimento escrito no método. |
| 08 — Indicadores | **Parcialmente especificado.** Os únicos indicadores nomeados no documento são os três do POP 01 (G14). Entrego esses três + o funil por coorte que já existe. Nenhum indicador inventado. |

---

## 2. Superfície pública — desenho de segurança

Esta seção é normativa. O `security-pentester` audita contra ela item a item.

### 2.1 O conceito: Link Público

**É:** uma credencial de finalidade única, presa a uma jornada, com prazo, contador de uso e trilha de auditoria. O portador pode fazer **uma coisa** e ver **o mínimo necessário para fazer essa coisa**.
**Não é:** conta de cliente, sessão, "portal do cliente", nem identificador de jornada. `pessoas.auth_user_id` continua `NULL` em todo o plano.

### 2.2 As sete regras duras

1. **`anon` não recebe privilégio de tabela nenhum.** Nem `select`. Toda a superfície pública são **4 funções `security definer`** no schema `public`, com `grant execute ... to anon` uma a uma. O padrão já é o da casa (`public.processar_pagamento_hotmart`, `public.marcar_mensagem_manual`, `public.registrar_briefing`). Motivo, do próprio relatório de segurança: *"se a regra de negócio está só na rota, ela não existe — o PostgREST é uma segunda porta para a mesma tabela"*.

2. **O token nunca chega ao banco.** A rota Next gera `token = base64url(randomBytes(32))` (256 bits) e grava/consulta apenas `hash = sha256(token || LINK_PUBLICO_PEPPER)` em hex. A RPC recebe o **hash**, nunca o token. Se o banco vazar, os hashes não viram links. O pepper vive só na env do app.

3. **Erro é sempre o mesmo.** Token inexistente, expirado, revogado, esgotado ou de jornada fechada devolvem **exatamente** `404 {erro:'link_invalido'}` com a mesma latência aproximada. Distinguir os casos transforma a rota em oráculo. Nada de `jornada_id`, `pessoa_id`, `documento_id` ou qualquer UUID interno na resposta pública — o front público trabalha só com o token e com os campos que a RPC devolve.

4. **Escopo mínimo na resposta.** `abrir_link_publico` devolve, no máximo: `{tipo, primeiro_nome, expira_em, estado, payload}`. `payload` é o mínimo do tipo:
   - `formulario` → a `definicao` do formulário ativo + as respostas já dadas (para reedição antes de finalizar) + os textos de consentimento vigentes;
   - `agendamento` → lista de slots (`inicio_em`, `fim_em`, `posicao`, `motivo_sugestao`), sem nome de advogada, sem id de agendamento;
   - `documentos` → lista de tipos pedidos + o que já foi recebido (nome do arquivo e data, nunca caminho nem URL);
   - `material` → o conteúdo do material aprovado.
   **Nunca:** patrimônio, valor, faixa, e-mail, telefone, etapa, briefing, documento de terceiro, nome completo.

5. **Rate limit por token, não por IP.** O achado 6 do pentest registrou que `X-Forwarded-For` é forjável e o limite por IP vira decorativo. O sujeito aqui é o token: **10 requisições/min e 100/dia por token**, e um teto global por rota de **300/min**, contados em tabela (`publico_rate_limit`), não em memória de processo — o Node App da Hostinger não garante processo único. O IP entra só no log, como `sha256(ip || pepper)` — nunca em claro.

6. **Escrita pública é sempre idempotente e monotônica.** Responder formulário duas vezes não cria duas respostas (o `unique(jornada_id)` de `formularios_respostas` continua valendo); escolher horário duas vezes remarca o mesmo agendamento, não cria dois; enviar o mesmo arquivo duas vezes é bloqueado por `sha256`. Nenhuma RPC pública move etapa por conta própria **exceto** `sessao_contratada → sessao_agendada` na escolha de horário, que é a transição que o cliente de fato causa — e mesmo essa passa pelo trigger `app.valida_transicao_jornada` como qualquer outra.

7. **A jornada manda no link.** `desfecho <> 'aberta'` revoga todos os links da jornada (trigger). Link não sobrevive ao fim do relacionamento.

### 2.3 Prazos, usos e revogação (padrões — configuráveis em `configuracoes`, sem deploy)

| Tipo | Validade padrão | Usos | Estado terminal |
|---|---|---|---|
| `formulario` | 14 dias | ilimitado até finalizar | após finalizar, vira somente-leitura: *"Recebemos suas respostas em DD/MM."* |
| `agendamento` | 14 dias | ilimitado até escolher; reabre para remarcar 1× | após escolher, mostra o horário confirmado |
| `documentos` | 30 dias | ilimitado | expira |
| `material` | 90 dias | ilimitado | expira |

Revogação: manual pelo admin/advogada, automática ao fechar a jornada, automática quando um link novo do mesmo tipo é emitido para a mesma jornada (o anterior morre — evita link antigo circulando em WhatsApp).

### 2.4 Upload público — o que muda em relação ao upload interno

Reaproveita **integralmente** o caminho já auditado do upload interno (mime por assinatura de bytes, caminho montado pelo servidor, bucket privado, `documentos_acessos`). Diferenças:

- exige `service_role` (Storage não escreve por RPC) → **sem `SUPABASE_SERVICE_ROLE_KEY`, a rota responde 503 e a página pública mostra estado honesto** (*"Envio indisponível no momento — a equipe entrará em contato"*). Nunca finge sucesso;
- `documentos.origem = 'cliente'` (coluna nova) e `enviado_por` fica `NULL` — quem enviou foi o cliente, não um perfil;
- limite mais apertado que o interno: **5 arquivos por link** e 20 MB por arquivo;
- a extensão do nome original é descartada; o servidor deriva a extensão do mime detectado.

### 2.5 Cabeçalhos e superfície HTTP das páginas públicas

`Cache-Control: no-store` · `X-Robots-Tag: noindex, nofollow` · `Referrer-Policy: no-referrer` · sem cookie nenhum (nem o do Supabase — o layout `(publico)` **não** monta cliente de sessão) · `POST` exige `Origin` igual a `NEXT_PUBLIC_APP_URL` · corpo ≤ 1 MB nas rotas JSON · campo honeypot invisível no formulário (bot que preenche é descartado com 200 falso-positivo silencioso, registrado no log).

Sem CAPTCHA: não há chave de provedor e não vou introduzir dependência externa numa noite. O par *token de 256 bits + rate limit por token* resolve o abuso realista (não há enumeração possível).

---

## 3. Modo demonstração da IA

O João busca as chaves amanhã. Até lá, tudo tem de estar pronto para "só preencher variável" — e **nada** pode parecer análise real.

### 3.1 Regra de ativação (a ordem importa)

```
1. ANTHROPIC_API_KEY presente  → sempre IA real. O modo demonstração é IGNORADO,
                                 mesmo com a flag ligada. Nunca demo silencioso com chave.
2. chave ausente + IA_MODO_DEMONSTRACAO=true  → devolve exemplo fixo, marcado.
3. chave ausente + flag ausente/false          → 503 honesto (comportamento de hoje, preservado).
```

Implementação em `src/server/ia/demonstracao.ts`. `src/server/ia/cliente.ts` **não muda de contrato**: `anthropicConfigurado()` continua sendo a verdade sobre a chave.

### 3.2 O exemplo é fixo, tipado e obviamente falso

- Um exemplo por chave: `briefing`, `croqui_analise`, `material_isca`, `sugestao_horarios`, `analise_transcricao`.
- **Validado contra o mesmo schema Zod da saída real** (`schema-briefing.ts`, etc.). Se o schema mudar e o exemplo não, o build quebra — de propósito. Isso garante que a tela nunca precisa de um caminho paralelo.
- Conteúdo com nome fictício explícito ("Cliente Exemplo"), `grau_confianca` fixo em `0`, `fontes_usadas: ['demonstracao']` e `lacunas: ['Este texto é um exemplo fixo. Nenhuma informação deste cliente foi analisada.']`.

### 3.3 O banco sabe que é demonstração (não só a tela)

```sql
-- 0027: colunas e trava
alter table execucoes_ia    add column modo text not null default 'real'
  check (modo in ('real','demonstracao'));
alter table briefings       add column origem_dado text not null default 'real'
  check (origem_dado in ('real','exemplo'));
alter table croqui_analises add column origem_dado text not null default 'real'
  check (origem_dado in ('real','exemplo'));

-- NOTA: a trava que importa. Saída de demonstração NUNCA é gravada como dado real —
-- e isso é garantido pelo banco, não por lembrança do desenvolvedor.
create or replace function app.trava_saida_demonstracao() returns trigger
language plpgsql as $$
begin
  if exists (select 1 from execucoes_ia e
              where e.id = new.execucao_id and e.modo = 'demonstracao')
     and new.origem_dado <> 'exemplo' then
    raise exception 'saida_de_demonstracao_exige_origem_dado_exemplo'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
```

`execucoes_ia` de demonstração grava `modelo='demonstracao'`, `custo_usd=0`, `tokens_* = 0`. A tela de custo em `/admin/ia` separa **execuções reais** de **execuções de demonstração** — nunca soma as duas.

### 3.4 Como a tela deixa claro

Componente novo `<SeloDemonstracao>` (`src/components/ui/Selo.tsx`, dono único: agente F-0):

- tarja âmbar **de largura total** no topo do bloco, não um chip discreto;
- texto fixo, não parametrizável: **"EXEMPLO GERADO SEM IA — conteúdo fixo de demonstração. Nada aqui foi analisado sobre este cliente."**;
- em modo apresentação e em impressão, **marca d'água diagonal** repetida ("EXEMPLO") via CSS em `globals.css` (`@media print` inclusive) — a folha impressa não pode sair limpa;
- o botão de exportar/imprimir carimba rodapé com a mesma frase;
- botão primário da tela vira **"Gerar análise real"** e fica desabilitado com a razão escrita: *"Falta ANTHROPIC_API_KEY no servidor"*.

**Substituição, não acúmulo:** quando a chave chegar, gerar a versão real marca a de demonstração com `atual=false` (o versionamento já existe em `briefings` e `croqui_analises`). Nada é apagado — histórico se preserva, regra do projeto.

---

## 4. Desenho por feature

Migrations novas: **0027 a 0036**. Números pré-atribuídos por agente para não colidir na execução paralela.

### 4.0 `0027_fase2_travas_e_configuracao.sql` — pré-requisito de tudo

Fecha os achados abertos do `Seguranca.md` **antes** de dado real entrar, e cria a mesa de configuração.

```sql
-- 0027_fase2_travas_e_configuracao.sql
-- (a) ACHADO ALTO 1, classe repetida: `for all` inclui DELETE via PostgREST.
--     Molde já existe na 0021. Aplicar às tabelas que ficaram de fora.
drop policy if exists pat_wr on patrimonio_itens;
create policy pat_ins on patrimonio_itens for insert to authenticated
  with check ((select app.ve_patrimonio()));
create policy pat_upd on patrimonio_itens for update to authenticated
  using ((select app.ve_patrimonio())) with check ((select app.ve_patrimonio()));
-- NOTA: sem policy de DELETE. Ausência de policy = negação. Baixa é lógica.
--       Repetir o mesmo par para: relatorios_sessao (rel_wr), croquis (cro_wr),
--       documentos (doc_wr), familiares (fam_wr), formularios_respostas (fr_wr),
--       ligacoes_estrategicas (lig_wr), sessoes_viabilidade (ses_wr), agendamentos (age_wr).
--       Conferir uma a uma: `select polname, polcmd from pg_policy` não pode voltar 'a' (ALL)
--       em nenhuma tabela com PII.

-- (b) Exclusão lógica onde faltava, para a baixa continuar possível sem DELETE.
alter table patrimonio_itens add column ativo boolean not null default true;
alter table familiares       add column ativo boolean not null default true;
alter table documentos       add column ativo boolean not null default true;

-- (c) Webhook que não reprocessa (item aberto do Seguranca.md).
--     Hoje reentrega de evento que falhou cai em "já recebi, 200" sem olhar processado_em.
create index if not exists idx_webhooks_falhos
  on webhooks_eventos (recebido_em) where processado_em is null and erro is not null;
-- NOTA para o backend: a rota do webhook passa a testar `processado_em is null`
--      no on-conflict, não só a existência da linha. Reentrega de evento não processado
--      REPROCESSA; reentrega de evento processado responde 200 sem tocar em nada.
create or replace function public.reprocessar_webhook(p_evento_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.eh_admin() then raise exception 'sem_permissao'; end if;
  update webhooks_eventos set processado_em = null, erro = null, tentativas = tentativas + 1
   where id = p_evento_id;
end $$;
revoke execute on function public.reprocessar_webhook(uuid) from public, anon;
grant  execute on function public.reprocessar_webhook(uuid) to authenticated;

-- (d) Configuração operacional vira DADO. Acaba com constante espalhada em TS
--     e permite ajustar prazo de link, cooldown e duração de sessão sem deploy.
create table configuracoes (
  chave text primary key,
  valor jsonb not null,
  descricao text not null,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references perfis_equipe(id)
);
insert into configuracoes (chave, valor, descricao) values
 ('link.validade_dias', '{"formulario":14,"agendamento":14,"documentos":30,"material":90}',
  'Validade padrão de cada tipo de link público, em dias.'),
 ('link.limite_por_minuto', '10', 'Requisições por minuto por token público.'),
 ('link.limite_por_dia',    '100','Requisições por dia por token público.'),
 ('ia.cooldown_segundos',   '600','Intervalo mínimo entre execuções de IA na mesma jornada.'),
 ('ia.teto_execucoes_dia_por_usuario', '20', 'Teto diário de execuções de IA por usuário.'),
 ('agenda.duracao_padrao_minutos', '60',
  'VALOR INICIAL, não vem do método. Ajustar em Admin. Ver BLOQUEIO B12.'),
 ('agenda.slots_ofertados_ao_cliente', '6', 'Quantos horários o cliente vê no link.');
alter table configuracoes enable row level security;
create policy cfg_sel on configuracoes for select to authenticated using ((select app.eh_interno()));
create policy cfg_upd on configuracoes for update to authenticated
  using ((select app.eh_admin())) with check ((select app.eh_admin()));

-- (e) Cooldown de IA (item aberto: `forcar_regeracao` em laço custa dinheiro real).
create or replace function app.pode_executar_ia(p_jornada uuid, p_perfil uuid)
returns boolean language sql stable set search_path = public, pg_temp as $$
  select not exists (
    select 1 from execucoes_ia e
     where e.jornada_id = p_jornada and e.modo = 'real'
       and e.criado_em > now() - ((select (valor #>> '{}')::int from configuracoes
                                    where chave='ia.cooldown_segundos') * interval '1 second'))
     and (select count(*) from execucoes_ia e2
           where e2.criado_por = p_perfil and e2.modo = 'real'
             and e2.criado_em > now() - interval '1 day')
         < (select (valor #>> '{}')::int from configuracoes
             where chave='ia.teto_execucoes_dia_por_usuario')
$$;

-- (f) Modo demonstração — colunas e trava (§3.3).
-- (g) POP 07: tarefas de follow-up. Sem cadência automática (o método não define).
create table tarefas (
  id uuid primary key default gen_random_uuid(),
  jornada_id uuid not null references jornadas(id) on delete cascade,
  titulo text not null,
  descricao text,
  responsavel_id uuid references perfis_equipe(id),
  vence_em date,
  concluida_em timestamptz,
  concluida_por uuid references perfis_equipe(id),
  origem text not null default 'manual' check (origem in ('manual','sistema')),
  criado_em timestamptz not null default now(), criado_por uuid references perfis_equipe(id)
);
create index idx_tarefas_abertas on tarefas (vence_em) where concluida_em is null;
```

**Fora do SQL, na mesma tarefa:** `src/middleware.ts` ganha o bypass explícito de `/p/*` e `/api/publico/*` (G17), e o `.env.example` ganha `LINK_PUBLICO_PEPPER`, `IA_MODO_DEMONSTRACAO`, `CRON_SECRET` (que já é usado e não está no exemplo).

### 4.1 `0028_links_publicos.sql` — o núcleo da superfície pública

```sql
-- 0028_links_publicos.sql
create type tipo_link_publico as enum ('formulario','agendamento','documentos','material');
create type estado_link_publico as enum ('ativo','usado','expirado','revogado');

create table links_publicos (
  id uuid primary key default gen_random_uuid(),
  jornada_id uuid not null references jornadas(id) on delete cascade,
  tipo tipo_link_publico not null,
  -- NUNCA o token. sha256(token || LINK_PUBLICO_PEPPER), hex. O pepper vive na env do app.
  token_hash text not null unique,
  -- 6 primeiros caracteres do token, só para a equipe reconhecer o link na tela ("...a1b2c3").
  token_prefixo text not null,
  estado estado_link_publico not null default 'ativo',
  expira_em timestamptz not null,
  usos int not null default 0,
  finalizado_em timestamptz,
  revogado_em timestamptz,
  revogado_por uuid references perfis_equipe(id),
  criado_em timestamptz not null default now(),
  criado_por uuid references perfis_equipe(id),
  origem_dado text not null default 'real' check (origem_dado in ('real','exemplo')),
  constraint ck_link_expira_futuro check (expira_em > criado_em)
);
-- Um link ATIVO por tipo por jornada. Emitir um novo mata o anterior (ver trigger).
create unique index uniq_link_ativo on links_publicos (jornada_id, tipo) where estado = 'ativo';
create index idx_links_jornada on links_publicos (jornada_id, criado_em desc);

-- Auditoria append-only de TODO acesso público. Sem isto não há como investigar abuso.
create table links_publicos_acessos (
  id uuid primary key default gen_random_uuid(),
  link_id uuid references links_publicos(id) on delete cascade,
  acao text not null check (acao in ('abrir','responder','escolher_horario','enviar_documento','negado')),
  resultado text not null check (resultado in ('ok','invalido','expirado','revogado','limite','erro')),
  -- IP nunca em claro: sha256(ip || pepper), calculado pelo app.
  ip_hash text, user_agent text,
  ocorrido_em timestamptz not null default now()
);
create index idx_links_acessos on links_publicos_acessos (link_id, ocorrido_em desc);

-- Rate limit em TABELA, não em memória: o Node App da Hostinger não garante processo único
-- e X-Forwarded-For é forjável (achado 6 do pentest). O sujeito do limite é o TOKEN.
create table publico_rate_limit (
  chave text not null,                 -- 'tok:<hash>' | 'rota:<nome>'
  janela timestamptz not null,         -- date_trunc('minute'|'day')
  escopo text not null check (escopo in ('minuto','dia')),
  contagem int not null default 0,
  primary key (chave, janela, escopo)
);

-- Fechar a jornada mata os links. Link não sobrevive ao fim do relacionamento.
create or replace function app.revoga_links_ao_fechar_jornada() returns trigger
language plpgsql as $$
begin
  if new.desfecho <> 'aberta' and old.desfecho = 'aberta' then
    update links_publicos set estado='revogado', revogado_em=now()
     where jornada_id = new.id and estado = 'ativo';
  end if;
  return new;
end $$;
create trigger trg_revoga_links after update on jornadas
for each row execute function app.revoga_links_ao_fechar_jornada();

alter table links_publicos enable row level security;
alter table links_publicos_acessos enable row level security;
alter table publico_rate_limit enable row level security;
create policy lp_sel on links_publicos for select to authenticated using ((select app.eh_interno()));
create policy lp_ins on links_publicos for insert to authenticated
  with check ((select app.papel()) in ('admin','advogada','relacionamento'));
create policy lp_upd on links_publicos for update to authenticated   -- só para revogar
  using ((select app.papel()) in ('admin','advogada','relacionamento'))
  with check ((select app.papel()) in ('admin','advogada','relacionamento'));
create policy lpa_sel on links_publicos_acessos for select to authenticated using ((select app.eh_admin()));
-- publico_rate_limit: NENHUMA policy. Só as RPCs security definer tocam.

-- ─────────────────────────────────────────────────────────────────────────────
-- AS QUATRO RPCs PÚBLICAS. É a ÚNICA coisa que `anon` pode fazer neste banco.
-- Todas: security definer + search_path fixo + rate limit + auditoria + erro único.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function app.consome_limite_publico(p_chave text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_min int; v_dia int; c_min int; c_dia int;
begin
  select (valor #>> '{}')::int into v_min from configuracoes where chave='link.limite_por_minuto';
  select (valor #>> '{}')::int into v_dia from configuracoes where chave='link.limite_por_dia';
  insert into publico_rate_limit (chave, janela, escopo, contagem)
  values (p_chave, date_trunc('minute', now()), 'minuto', 1)
  on conflict (chave, janela, escopo) do update set contagem = publico_rate_limit.contagem + 1
  returning contagem into c_min;
  insert into publico_rate_limit (chave, janela, escopo, contagem)
  values (p_chave, date_trunc('day', now()), 'dia', 1)
  on conflict (chave, janela, escopo) do update set contagem = publico_rate_limit.contagem + 1
  returning contagem into c_dia;
  return c_min <= v_min and c_dia <= v_dia;
end $$;

-- Resolve o link e já expira o que passou do prazo. Devolve NULL para TODO caso ruim —
-- inexistente, expirado, revogado, usado, jornada fechada. Um erro só, sem oráculo.
create or replace function app.resolve_link(p_hash text) returns links_publicos
language plpgsql security definer set search_path = public, pg_temp as $$
declare v links_publicos;
begin
  select * into v from links_publicos where token_hash = p_hash;
  if not found then return null; end if;
  if v.estado = 'ativo' and v.expira_em <= now() then
    update links_publicos set estado='expirado' where id = v.id; return null;
  end if;
  if v.estado <> 'ativo' then return null; end if;
  if not exists (select 1 from jornadas j where j.id = v.jornada_id and j.desfecho = 'aberta')
    then return null; end if;
  return v;
end $$;

create or replace function public.abrir_link_publico(p_hash text) returns jsonb ...;
create or replace function public.responder_formulario_publico(p_hash text, p_respostas jsonb, p_consentimentos jsonb) returns jsonb ...;
create or replace function public.escolher_horario_publico(p_hash text, p_inicio timestamptz) returns jsonb ...;
create or replace function public.registrar_documento_publico(p_hash text, p_tipo text, p_nome text, p_caminho text, p_mime text, p_bytes bigint, p_sha256 text) returns jsonb ...;

-- NOTA CRÍTICA de grant: só estas quatro. Nada mais.
revoke execute on all functions in schema app from anon;
grant  execute on function public.abrir_link_publico(text),
                            public.responder_formulario_publico(text, jsonb, jsonb),
                            public.escolher_horario_publico(text, timestamptz),
                            public.registrar_documento_publico(text,text,text,text,text,bigint,text)
       to anon;
-- E o schema app continua fechado para anon (grant usage só para authenticated, migration 0018).
```

**Corpo de `responder_formulario_publico` — o que ele faz, em ordem:** resolve o link → consome limite → grava `formularios_respostas` (`origem='cliente_link'`, upsert por `jornada_id`) → espelha `p9` em `jornadas.faixa_patrimonio_declarada` (mesma regra da rota interna, `src/app/api/jornadas/[id]/formulario/route.ts:82`) → grava um `consentimentos` por item de `p_consentimentos` com `canal='formulario_publico'` e o **texto congelado** vindo de `configuracoes` → grava `eventos_timeline` → marca o link `usado`. **Não move etapa.**

**`escolher_horario_publico`:** resolve → limite → confere que `p_inicio` está entre os slots realmente ofertados naquele link (tabela `agendamentos_sugestoes`, §4.2) → cria/atualiza `agendamentos` com `origem='cliente'`, `status='confirmado'` → deixa o `exclude using gist` do `0008` fazer o trabalho de impedir sobreposição (se conflitar: devolve `{erro:'horario_indisponivel'}`, que **é** um erro público legítimo porque não vaza nada) → move a jornada `sessao_contratada → sessao_agendada` pelo caminho normal → enfileira `confirmacao_d7` e `dia_da_sessao`.

**Rotas Next (todas `runtime='nodejs'`, `dynamic='force-dynamic'`, sem cliente de sessão):**

| Rota | Método | Quem | O que faz |
|---|---|---|---|
| `/api/publico/[token]` | GET | público | hash + `abrir_link_publico` |
| `/api/publico/[token]/formulario` | POST | público | `responder_formulario_publico` |
| `/api/publico/[token]/horario` | POST | público | `escolher_horario_publico` |
| `/api/publico/[token]/documento` | POST | público | multipart; valida mime por bytes; `service_role` grava no bucket; `registrar_documento_publico`. **503 sem service_role.** |
| `/api/jornadas/[id]/links` | GET/POST | interno | lista links; emite token (devolve a URL **uma única vez** — depois só o prefixo) |
| `/api/links/[id]/revogar` | POST | interno | revoga |

**Telas públicas** (`src/app/(publico)/p/...`, layout próprio sem `AppShell`, sem nav, sem tema togglável, marca do escritório, uma coluna, mobile-first — o cliente abre isso no celular):
`/p/f/[token]` formulário · `/p/a/[token]` agendamento · `/p/d/[token]` documentos · `/p/m/[token]` material.

### 4.2 `0029_disponibilidade_agenda.sql` — agendamento pelo cliente

```sql
-- 0029_disponibilidade_agenda.sql
-- A advogada declara JANELAS; o sistema deriva SLOTS. Slot não é linha guardada —
-- guardar slot livre é criar milhares de linhas que envelhecem sozinhas.
create table disponibilidades (
  id uuid primary key default gen_random_uuid(),
  advogada_id uuid not null references perfis_equipe(id),
  dia_semana smallint not null check (dia_semana between 0 and 6),  -- 0=domingo
  hora_inicio time not null,
  hora_fim    time not null,
  duracao_minutos smallint not null default 60,   -- ver BLOQUEIO B12
  vale_de  date not null default current_date,
  vale_ate date,
  ativa boolean not null default true,
  criado_em timestamptz not null default now(), criado_por uuid references perfis_equipe(id),
  constraint ck_disp_janela check (hora_fim > hora_inicio)
);

create table agenda_bloqueios (
  id uuid primary key default gen_random_uuid(),
  advogada_id uuid not null references perfis_equipe(id),
  inicio_em timestamptz not null, fim_em timestamptz not null,
  motivo text not null,
  criado_em timestamptz not null default now(),
  constraint ck_bloq_janela check (fim_em > inicio_em)
);

-- Slots livres: gerados na consulta. Exclui agendamento ativo e bloqueio.
create or replace function app.slots_disponiveis(p_advogada uuid, p_de timestamptz, p_ate timestamptz)
returns table (inicio_em timestamptz, fim_em timestamptz) ... ;
-- NOTA: gerar com generate_series sobre os dias do intervalo, cruzando com disponibilidades
--       vigentes (vale_de/vale_ate, ativa) e o dia da semana em America/Sao_Paulo.
--       Antecedência mínima: não ofertar slot que começa em menos de 24h (configurável).

-- Os horários que FORAM ofertados naquele link. Sem isto, escolher_horario_publico
-- aceitaria qualquer timestamp e o cliente marcaria fora da agenda.
create table agendamentos_sugestoes (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references links_publicos(id) on delete cascade,
  inicio_em timestamptz not null, fim_em timestamptz not null,
  posicao smallint not null,                 -- 1 = "melhor horário" segundo a IA
  motivo_sugestao text,                      -- justificativa; NULL quando é ordem cronológica
  execucao_ia_id uuid references execucoes_ia(id),
  criado_em timestamptz not null default now(),
  unique (link_id, inicio_em)
);
```

**A ordenação por IA (CONFLITO C10):** a IA **não escolhe** horário, **ordena** os slots que a advogada já abriu, e sempre com `motivo_sugestao` escrito. Entrada: só o que já está na allowlist do briefing (`ligacao.respostas`, `preocupacao_principal`, `ritmo`, `estilo_resposta`, `decisores_presentes_na_sessao`). **Sem briefing e sem ligação → ordem cronológica pura, `motivo_sugestao = NULL`, e a tela não fala em "sugestão".** Sem chave de IA → mesmo comportamento cronológico, com `<SeloDemonstracao>` se o modo demo estiver ligado. Nunca uma "recomendação" sem evidência — é a REGRA DE OURO do Protocolo 01 aplicada a uma feature pequena.

### 4.3 `0030_roteiros_pop03b_sims.sql` — POP 05, POP 03-B e os 4 SIMs

**A jogada de otimização desta migration: o roteiro de ligação vira dado, igual ao formulário.** Hoje o formulário do POP 02 é renderizado de `formularios.definicao` e o formulário do POP 03 está **codificado no front** (`src/components/ficha360/LigacaoAba.tsx`). Trazer o POP 03 para o mesmo motor entrega o POP 03-B **sem uma linha de front nova** — é só uma versão de roteiro a mais.

```sql
-- 0030_roteiros_pop03b_sims.sql
create table roteiros_versoes (
  id uuid primary key default gen_random_uuid(),
  chave text not null,        -- 'pop_03' | 'pop_03b' | 'sessao_viabilidade'
  versao smallint not null,
  titulo text not null,
  -- {blocos:[{id,titulo,objetivo,falas:[],campos:[{id,rotulo,tipo,opcoes}],observar:[],proibido:[]}]}
  definicao jsonb not null,
  ativo boolean not null default false,
  notas text,
  criado_em timestamptz not null default now(), criado_por uuid references perfis_equipe(id),
  unique (chave, versao)
);
create unique index uniq_roteiro_ativo on roteiros_versoes (chave) where ativo;

alter table ligacoes_estrategicas add column roteiro_versao_id uuid references roteiros_versoes(id);
-- NOTA: as respostas do 03-B vão no jsonb `respostas` que JÁ EXISTE, chaveadas pelos ids
--       do roteiro. Zero coluna nova por variante de roteiro.

alter table sessoes_viabilidade add column roteiro_versao_id uuid references roteiros_versoes(id);
-- Os 4 SIMs. O 1º (sigilo/gravação) NÃO mora aqui: vira linha em `consentimentos`
-- (tipo 'gravacao_sessao', que já existe), com texto congelado. Os outros três são
-- checagem de condução, não consentimento de dado.
alter table sessoes_viabilidade add column sims jsonb not null default '{}'::jsonb;
-- {"licitude":{"ok":true,"em":"..."},"decisores":{...},"proximo_passo":{...}}
```

**Seed:** as 4 guias do Script viram as versões 1–4 da chave `sessao_viabilidade`; **a 4 fica ativa** (é a mais extensa e a última do arquivo) e a tela mostra, escrito: *"Versão 4 do arquivo de script — não carimbada pela Dra. Elaine. Ver BLOQUEIO B15."* POP 03 (5 perguntas) e POP 03-B (5 perguntas + observação comportamental obrigatória) entram como versão 1, transcritos do documento **sem uma palavra alterada**.

**Tela `/sessoes/[id]/conduzir`:** roteiro PARTE 00→12 em coluna, os 4 SIMs como checklist no topo (marcar o 1º grava `consentimentos`), campo de registro rápido ao lado de cada parte, e o bloco da PARTE 11 abre o **registro de oferta** (G10): produto, valor padrão R$ 7.200, condição `incentivo_resolvedor` R$ 4.500, `valida_ate`. Grava em `ofertas`, que existe desde `0011` e nunca teve tela.

### 4.4 `0031_material_pos_sessao.sql` — a isca

```sql
-- 0031_material_pos_sessao.sql
create table materiais_modelos (
  id uuid primary key default gen_random_uuid(),
  chave text not null,          -- 'inventario','conflito_familiar','empresa','itcmd','padrao'
  versao smallint not null,
  titulo text not null,
  -- {blocos:[{tipo:'texto'|'lista'|'destaque'|'proximos_passos', titulo, corpo}]}
  conteudo jsonb not null,
  ativo boolean not null default false,
  criado_em timestamptz not null default now(),
  unique (chave, versao)
);

create table materiais_gerados (
  id uuid primary key default gen_random_uuid(),
  jornada_id uuid not null references jornadas(id) on delete cascade,
  modelo_id uuid references materiais_modelos(id),
  execucao_id uuid references execucoes_ia(id),
  versao smallint not null,
  dor_principal text,                    -- de onde saiu está em fonte_dor
  fonte_dor text check (fonte_dor in ('ligacao','formulario','relatorio','nenhuma')),
  conteudo jsonb not null,
  origem_dado text not null default 'real' check (origem_dado in ('real','exemplo')),
  -- TRAVA: material só vira link público depois de revisão humana. Ver BLOQUEIO B14.
  aprovado_por uuid references perfis_equipe(id),
  aprovado_em timestamptz,
  atual boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (jornada_id, versao)
);
create unique index uniq_material_atual on materiais_gerados (jornada_id) where atual;
```

**Regras:**
- **A "dor" tem fonte obrigatória** (C11): `ligacoes_estrategicas.preocupacao_principal` → senão `formularios_respostas.p16` → senão `relatorios_sessao.preocupacao_predominante`. Se as três estiverem vazias, `fonte_dor='nenhuma'` e o sistema usa o modelo `padrao`, dizendo na tela que **não houve personalização por falta de dado**. Nunca inventar dor.
- **Nada sai sem revisão humana** (B14): a régua `pos_sessao` só emite o link `material` se `aprovado_em is not null`. Sem aprovação, a mensagem fica `pendente` e aparece no painel como pendência. Isso é proteção jurídica (publicidade da advocacia) e proteção contra IA solta.
- **Formato:** página HTML pública imprimível em `/p/m/[token]` (`@media print` com margem, tipografia serif do sistema, sem nav). **Sem Chromium headless na Hostinger** — ver CONFLITO C12.

### 4.5 `0032_base_conhecimento.sql` — Módulo 4

```sql
-- 0032_base_conhecimento.sql
-- ATENÇÃO: entram aqui 3,5 MB de transcrição de CLIENTE REAL — nome, patrimônio,
-- família, valores. É a maior massa de PII do banco. RLS = ve_patrimonio, sem exceção.
create type tipo_transcricao as enum ('sessao_viabilidade','apresentacao_croqui');

create table transcricoes (
  id uuid primary key default gen_random_uuid(),
  tipo tipo_transcricao not null,
  arquivo_origem text not null unique,          -- 'transcricao-alan-augusto.md'
  rotulo text not null,                         -- nome como aparece no arquivo (PII)
  data_reuniao date,
  consultor text,
  jornada_id uuid references jornadas(id),      -- NULL: histórico anterior ao sistema
  conteudo text not null,
  tamanho_bytes bigint not null,
  sha256 text not null unique,
  importado_em timestamptz not null default now(),
  importado_por uuid references perfis_equipe(id),
  origem_dado text not null default 'real' check (origem_dado in ('real','exemplo'))
);
create index idx_transcricoes_busca on transcricoes
  using gin (to_tsvector('portuguese', conteudo));

-- O caso pareia SV com a apresentação de croqui da MESMA pessoa. É o que dá o rótulo.
create table casos_conhecimento (
  id uuid primary key default gen_random_uuid(),
  rotulo text not null unique,
  transcricao_sv_id uuid references transcricoes(id),
  transcricao_croqui_id uuid references transcricoes(id),
  -- NUNCA 'nao_converteu'. Ausência de gravação de croqui não é prova de perda. Ver C13.
  desfecho_observado text not null default 'indefinido'
    check (desfecho_observado in ('avancou_para_croqui','indefinido')),
  revisado_por uuid references perfis_equipe(id),
  criado_em timestamptz not null default now()
);

create table analises_transcricao (
  id uuid primary key default gen_random_uuid(),
  transcricao_id uuid not null references transcricoes(id) on delete cascade,
  execucao_id uuid references execucoes_ia(id),
  versao smallint not null,
  conteudo jsonb not null,
  origem_dado text not null default 'real' check (origem_dado in ('real','exemplo')),
  atual boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (transcricao_id, versao)
);

-- O que a base APRENDEU. Nada daqui entra em prompt sem aprovação humana.
create table padroes_conhecimento (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('frase_aumenta','frase_reduz','objecao','padrao_condicao')),
  texto text not null,
  observacoes text,
  ocorrencias int not null default 0,
  casos_ids uuid[] not null default '{}',
  grau_confianca smallint check (grau_confianca between 0 and 100),
  aprovado_por uuid references perfis_equipe(id),
  aprovado_em timestamptz,
  criado_em timestamptz not null default now()
);
-- NOTA para quem for plugar isto no briefing depois: só `aprovado_em is not null` pode
-- ir para o contexto da IA, e a inclusão precisa entrar como VERSÃO NOVA de prompt.
-- Base de conhecimento que se auto-injeta em prompt é como o método vira ruído.

alter table transcricoes         enable row level security;
alter table casos_conhecimento   enable row level security;
alter table analises_transcricao enable row level security;
alter table padroes_conhecimento enable row level security;
-- select só para quem vê patrimônio; escrita só por rota com service_role.
create policy tr_sel on transcricoes for select to authenticated using ((select app.ve_patrimonio()));
-- (idem para as outras três)
```

**O que roda hoje, sem chave de IA:** `scripts/importar-transcricoes.ts` lê os 70 arquivos, extrai `tipo` (o prefixo `CE` do arquivo de áudio marca apresentação de croqui), `rotulo`, `data_reuniao` e `consultor` do cabeçalho, calcula `sha256`, e monta os `casos_conhecimento` **pareando por rótulo normalizado**. Saída esperada, verificável: **52 SV + 18 croqui = 70 transcrições, 52 casos, 18 com `avancou_para_croqui`**. A tela `/conhecimento` já entrega busca full-text, filtro por desfecho e leitura lado a lado SV↔croqui. Isso sozinho é a coisa mais próxima do "Módulo 4" que existe hoje — e não depende de nenhuma chave.

**O que NÃO roda hoje:** a passagem de IA sobre as transcrições (**BLOQUEIO B13** — LGPD). Estimativa de custo para quando destravar: ~3,5 MB ≈ 890 mil tokens de entrada; um passe com `claude-sonnet-5` (US$ 2/MTok entrada) ≈ **US$ 1,80**; com `claude-opus-5` ≈ US$ 4,50. Barato — o que trava é jurídico, não dinheiro.

### 4.6 `0033_admin.sql` · `0034_painel_dia.sql` · `0035_importacao.sql` · `0036_pesquisas_publicas.sql`

**`0033`** — pouco DDL: o admin opera tabelas que já existem (`perfis_equipe`, `produtos`, `mensagens_templates`, `prompts_versoes`, `edicoes_seminario`, `modelos_ia_precos`, `configuracoes`). O que falta é rota + tela. Único acréscimo: `perfis_equipe.convidado_em`, `convite_enviado_em`.

**`0034`** — as views do painel, todas `security_invoker = true`:

```sql
-- 0034_painel_dia.sql
create view vw_sessoes_do_dia with (security_invoker = true) as
  select a.inicio_em, a.fim_em, a.status, j.id as jornada_id, p.nome,
         s.link_sala, s.advogada_id,
         exists (select 1 from briefings b where b.jornada_id=j.id and b.atual) as tem_briefing
    from agendamentos a
    join sessoes_viabilidade s on s.id = a.sessao_id
    join jornadas j on j.id = s.jornada_id
    join pessoas  p on p.id = j.pessoa_id
   where a.status in ('agendado','confirmado')
     and a.inicio_em >= date_trunc('day', now() at time zone 'America/Sao_Paulo')
     and a.inicio_em <  date_trunc('day', now() at time zone 'America/Sao_Paulo') + interval '2 days';

create view vw_pendencias_preparo with (security_invoker = true) as ...;
  -- sessão em <= 7 dias e falta formulário, ligação ou briefing. Ordenado por proximidade.

create view vw_pagos_sem_contato with (security_invoker = true) as
  select j.id, p.nome, pg.pago_em, (now()::date - pg.pago_em::date) as dias_desde_pagamento
    from jornadas j join pessoas p on p.id=j.pessoa_id
    join pagamentos pg on pg.jornada_id=j.id and pg.status='aprovado'
   where j.nivel_pago >= 1 and j.desfecho='aberta'
     and not exists (select 1 from ligacoes_estrategicas l where l.jornada_id=j.id)
     and not exists (select 1 from mensagens_agendadas m
                      where m.jornada_id=j.id and m.status='enviada');
-- Esta é a pergunta do brain: "Quem comprou e ainda não foi contatado?" — o furo que mais dói.

create view vw_pendencias_sistema with (security_invoker = true) as ...;
  -- webhooks não processados / com erro · mensagens 'falhou' · links expirando em 48h
  -- · materiais gerados aguardando aprovação. Só admin/advogada leem (RLS das bases).

-- POP 01, os três indicadores que o método NOMEIA. Por edição (coorte), nunca por janela.
create view vw_indicadores_pop01 with (security_invoker = true) as
select j.edicao_id,
       count(*) filter (where a.status='realizado')                                  as compareceram,
       count(*) filter (where a.status in ('realizado','nao_compareceu'))            as sessoes_com_desfecho,
       count(*) filter (where fr.id is not null and j.nivel_pago >= 1)               as formularios_respondidos,
       count(*) filter (where j.nivel_pago >= 1)                                     as clientes_pagantes,
       count(*) filter (where l.decisores_presentes_na_sessao is true)               as com_decisores,
       count(*) filter (where l.decisores_presentes_na_sessao is not null)           as com_resposta_decisores
  from jornadas j
  left join formularios_respostas fr on fr.jornada_id=j.id
  left join ligacoes_estrategicas l  on l.jornada_id=j.id
  left join sessoes_viabilidade s    on s.jornada_id=j.id
  left join agendamentos a           on a.sessao_id=s.id
 group by j.edicao_id;
-- NOTA: a view devolve NUMERADOR e DENOMINADOR separados de propósito. O percentual é
-- calculado na tela e NÃO é exibido quando o denominador é zero — campo novo nasce vazio,
-- não zero.
```

**`0035`** — importação em duas fases, nunca em uma:

```sql
-- 0035_importacao.sql
create table importacoes (
  id uuid primary key default gen_random_uuid(),
  edicao_id uuid not null references edicoes_seminario(id),
  arquivo_nome text not null,
  mapa_colunas jsonb not null,     -- {"Nome":"nome","E-mail":"email",...} — o operador casa na tela
  status text not null default 'previa' check (status in ('previa','confirmada','cancelada')),
  total_linhas int not null default 0,
  pessoas_novas int not null default 0, pessoas_existentes int not null default 0,
  jornadas_novas int not null default 0, ignoradas int not null default 0, com_erro int not null default 0,
  confirmada_em timestamptz, confirmada_por uuid references perfis_equipe(id),
  criado_em timestamptz not null default now(), criado_por uuid references perfis_equipe(id)
);
create table importacoes_linhas (
  id uuid primary key default gen_random_uuid(),
  importacao_id uuid not null references importacoes(id) on delete cascade,
  numero int not null, dados jsonb not null,
  resultado text not null check (resultado in
    ('pessoa_nova','pessoa_existente','jornada_nova','ignorada_jornada_aberta','erro')),
  motivo text, pessoa_id uuid references pessoas(id), jornada_id uuid references jornadas(id),
  unique (importacao_id, numero)
);
```

**Regras da importação** (vêm direto das memórias do João sobre backfill):
- fase 1 grava só a prévia; **nada toca `pessoas`/`jornadas` até o operador confirmar**;
- a tela mostra, antes de confirmar: quantas pessoas novas, **quantas já existem** (dedupe por `lower(email)` e telefone E.164), quantas **já têm jornada aberta** (essas são ignoradas, por causa do `uniq_jornada_aberta_por_pessoa`), quantas dão erro e por quê;
- **nenhuma linha existente muda de valor**: pessoa que já existe não é atualizada pelo CSV, só reaproveitada. Import não reclassifica gente;
- `origem_dado='real'` nas linhas importadas — e a tela avisa que é dado real, em contraste com o seed.

**`0036`** — arcabouço de fonte pública, sem coleta:

```sql
-- 0036_pesquisas_publicas.sql
create table pesquisas_publicas (
  id uuid primary key default gen_random_uuid(),
  jornada_id uuid not null references jornadas(id) on delete cascade,
  pessoa_id  uuid not null references pessoas(id),
  fonte text not null,                       -- digitado; sem lista fechada, sem integração
  url text, consultado_em timestamptz not null default now(),
  consultado_por uuid not null references perfis_equipe(id),
  base_legal text not null,                  -- obrigatório: quem registra declara a base
  resumo text not null,
  entra_no_briefing boolean not null default false,
  criado_em timestamptz not null default now()
);
-- Trava: sem consentimento registrado, nem inserir. O tipo já existe no enum desde a 0005.
create or replace function app.exige_consentimento_pesquisa() returns trigger
language plpgsql as $$
begin
  if not app.tem_consentimento(new.pessoa_id, 'pesquisa_fontes_publicas') then
    raise exception 'sem_consentimento_pesquisa_fontes_publicas' using errcode='check_violation';
  end if;
  return new;
end $$;
create trigger trg_pesq_consent before insert on pesquisas_publicas
for each row execute function app.exige_consentimento_pesquisa();
```

Tela: `<SeloStub texto="Coleta automatizada BLOQUEADA — pendente de decisão jurídica (LGPD / ToS). Este módulo registra apenas consulta feita manualmente pela equipe, com base legal declarada." />`. **`entra_no_briefing` fica `false` e a allowlist do contexto da IA não é alterada nesta fase.**

---

## 5. Plano de execução em ondas

Fronteiras de arquivo **disjuntas e explícitas**. Regra geral que vale para todos:

> **Ninguém edita `src/types/banco.ts`, `src/lib/api.ts`, `src/server/erros.ts`, `src/server/auth.ts`.** Tipos novos vão em arquivo novo por domínio (`src/types/publico.ts`, `src/types/admin.ts`, ...). Quem precisar mudar algo desses quatro para no que está fazendo e reporta ao orquestrador.

### ONDA 0 — trava (sequencial, **bloqueia todas as outras**)

| Agente | Arquivos que ele possui | Entrega |
|---|---|---|
| **B-0** `backend-engineer` | `supabase/migrations/0027_fase2_travas_e_configuracao.sql` · `src/middleware.ts` · `src/server/ia/demonstracao.ts` (novo) · `src/server/ia/briefing.ts` · `src/server/ia/croqui-analise.ts` · `.env.example` | 0027 aplicada; bypass de `/p/*` e `/api/publico/*` no matcher; modo demonstração ligado nos dois caminhos de IA; env de exemplo completa. **Verificação obrigatória:** `select polname, polcmd from pg_policy` não retorna `polcmd='a'` em nenhuma tabela com PII; `curl /p/teste` não redireciona para `/login`. |
| **F-0** `frontend-engineer` | `src/components/ui/Selo.tsx` · `src/components/shell/Nav.tsx` · `src/app/globals.css` · `src/app/page.tsx` · `src/app/(publico)/layout.tsx` (novo) | `<SeloDemonstracao>`; nav com Painel · Esteira · Agenda · Comunicação · Indicadores · Conhecimento · Importações · Admin; marca d'água `@media print`; `/` redireciona para `/painel`; shell público vazio. |

### ONDA 1 — 4 agentes em paralelo

| Agente | Arquivos | Entrega |
|---|---|---|
| **B-1A** back | `0028_links_publicos.sql` · `src/server/publico/**` (novo) · `src/app/api/publico/**` (novo) · `src/app/api/jornadas/[id]/links/route.ts` · `src/app/api/links/[id]/revogar/route.ts` · `src/types/publico.ts` | Superfície pública inteira (§2 e §4.1). |
| **B-1B** back | `0029_disponibilidade_agenda.sql` · `0034_painel_dia.sql` · `src/server/agenda/**` (novo) · `src/app/api/disponibilidades/**` · `src/app/api/agenda/slots/route.ts` · `src/app/api/painel/route.ts` · `src/types/agenda.ts` | Janelas, slots, sugestões e as 5 views do painel. |
| **F-1A** front | `src/app/(publico)/p/**` (novo) · `src/components/publico/**` (novo) | 4 páginas públicas, mobile-first, sem nav, sem cookie. |
| **F-1B** front | `src/app/(app)/painel/**` (novo) · `src/components/painel/**` (novo) | Painel do dia, 5 blocos, bloco vazio diz "nada pendente". |

> F-1A trabalha contra o contrato de `/api/publico/[token]` descrito no §4.1 antes de B-1A terminar. Se o contrato mudar, quem ajusta é F-1A na onda seguinte.

### ONDA 2 — 4 agentes em paralelo

| Agente | Arquivos | Entrega |
|---|---|---|
| **B-2A** back | `0035_importacao.sql` · `src/server/importacao/**` (novo) · `src/app/api/importacoes/**` | Prévia e confirmação em duas fases. |
| **B-2B** back | `0033_admin.sql` · `src/app/api/admin/**` (novo) · `src/types/admin.ts` | equipe · produtos · templates · prompts · edições · configurações · custo de IA · **pendências**. |
| **F-2A** front | `src/app/(app)/importacoes/**` · `src/app/(app)/agenda/page.tsx` · `src/components/agenda/**` · `src/components/importacao/**` | Upload de CSV com casamento de colunas e prévia; UI de disponibilidade e bloqueios. |
| **F-2B** front | `src/app/(app)/admin/**` · `src/components/admin/**` | Admin com 7 abas, substituindo o stub. |

### ONDA 3 — 4 agentes em paralelo

| Agente | Arquivos | Entrega |
|---|---|---|
| **B-3A** back | `0030_roteiros_pop03b_sims.sql` · `src/app/api/roteiros/**` · `src/app/api/sessoes/[id]/sims/route.ts` · `src/app/api/jornadas/[id]/ofertas/route.ts` | Roteiros como dado, POP 03-B ligado, 4 SIMs, ofertas. |
| **B-3B** back | `0031_material_pos_sessao.sql` · `src/server/ia/material.ts` (novo) · `src/app/api/jornadas/[id]/material/**` · ajuste de `src/server/regua/processar.ts` (links no template — **único agente que toca este arquivo**) | Material com fonte de dor, aprovação humana, link. |
| **F-3A** front | `src/components/ficha360/**` · `src/app/(app)/jornadas/[id]/page.tsx` | Relatório da SV campo a campo + tributos + impressão; abas Material, Links, Pesquisa; POP 03-B na aba Ligação. |
| **F-3B** front | `src/app/(app)/sessoes/**` (novo) · `src/components/sessao/**` (novo) | Modo conduzir: roteiro, 4 SIMs, registro de oferta. |

### ONDA 4 — 3 agentes em paralelo

| Agente | Arquivos | Entrega |
|---|---|---|
| **B-4A** back | `0032_base_conhecimento.sql` · `scripts/importar-transcricoes.ts` (novo) · `src/server/conhecimento/**` · `src/app/api/conhecimento/**` | Ingestão determinística das 70 transcrições, pareamento, busca. |
| **B-4B** back | `0036_pesquisas_publicas.sql` · `src/app/api/pesquisas-publicas/**` | Arcabouço manual, com trava de consentimento. |
| **F-4A** front | `src/app/(app)/conhecimento/**` (novo) · `src/components/conhecimento/**` (novo) | Busca, leitura lado a lado SV↔croqui, contagem por desfecho, selos. |

### ONDA 5 — `security-pentester` (**obrigatório**) e depois `fable-orchestrator`

| # | Alvo | O que provar |
|---|---|---|
| **P6** | **Superfície pública** | `anon` não lê **nenhuma** tabela pelo PostgREST (tentar `pessoas`, `jornadas`, `links_publicos`, `formularios`). `anon` não executa nenhuma função além das 4 nomeadas. Token de 1 caractere errado → mesmo 404 do inexistente. Link expirado, revogado e de jornada fechada → resposta idêntica. Resposta pública não contém nenhum UUID interno. |
| **P7** | **Rate limit e abuso** | 11ª requisição no minuto com o mesmo token → bloqueio. Trocar `X-Forwarded-For` não afrouxa nada. Enviar 6 documentos no mesmo link → bloqueio. |
| **P8** | **Upload público** | mime falsificado (PDF com bytes de PE) rejeitado. Nome com `../` não altera o caminho. Sem `SUPABASE_SERVICE_ROLE_KEY` → 503, nunca 200 com promessa falsa. |
| **P9** | **Agendamento público** | escolher horário fora dos slots ofertados → recusa. Escolher horário já ocupado por outra jornada → recusa pela exclusion constraint, sem vazar de quem é. Escolher duas vezes não cria dois agendamentos. Não é possível confirmar sessão de jornada com `nivel_pago = 0`. |
| **P10** | **Modo demonstração** | com chave presente, a flag de demo é ignorada. Nenhuma linha com `modo='demonstracao'` grava saída com `origem_dado='real'` (tentar pelo PostgREST). Impressão do briefing de demonstração sai com marca d'água. Custo de demonstração não soma no total de custo. |
| **P11** | **Base de conhecimento** | `relacionamento` e `assistente` não leem `transcricoes` (com linha real plantada). Busca full-text não vaza trecho por mensagem de erro. Nenhum conteúdo de transcrição sai para a Anthropic sem a decisão B3. |
| **P12** | **Regressão da Fase 1** | `pat_wr`/`rel_wr`: DELETE pelo PostgREST como `advogada` → recusa. Reentrega de webhook que falhou → reprocessa. `forcar_regeracao` em laço → cooldown barra. |

---

## 6. CONFLITO

Os conflitos C1–C8 do plano v1 **seguem valendo**. Novos:

| # | Conflito | Consequência | Encaminhamento |
|---|---|---|---|
| **C9** | **Quem é o dono da resposta do formulário.** O POP 02 diz "Responsável: Cliente". O sistema hoje tem `formularios_respostas` com `unique(jornada_id)` e uma rota interna que **sobrescreve**. Se o cliente responde e a equipe depois "corrige", o que o cliente disse desaparece — e o briefing perde a fonte primária. | O Protocolo 01 exige evidência. Evidência sobrescrita não é evidência. | Mantenho o `unique` (não reescrevo o que funciona) e acrescento: `origem='cliente_link'`, e **toda sobrescrita grava a versão anterior em `eventos_timeline`**. A tela mostra "respondido pelo cliente em DD/MM" e marca visualmente quando a equipe editou depois. |
| **C10** | **"IA sugere o melhor horário".** O método não define o que torna um horário melhor. Nenhum POP, nenhum protocolo, nenhuma matriz. | Se a IA "sugerir" sem critério, ela inventa — exatamente o que a REGRA DE OURO proíbe. | A IA **ordena** os slots que a advogada abriu e escreve o motivo. Sem ligação e sem briefing: ordem cronológica, sem a palavra "sugestão" na tela. |
| **C11** | **"Material personalizado pela dor".** "Dor" não é campo do método. As fontes reais são `preocupacao_principal` (POP 03), `p16` (POP 02) e `preocupacao_predominante` (Relatório). | Sem fonte, o material vira texto genérico com cara de personalizado — o oposto do princípio *"o cliente compra quando percebe que foi profundamente compreendido"*. | Cascata de fontes explícita, `fonte_dor` gravado, e material padrão **rotulado como padrão** quando não há fonte. |
| **C12** | **PDF de verdade × página imprimível.** O pedido diz "material em PDF". Gerar PDF no servidor exige Chromium headless (Puppeteer), num Node App compartilhado da Hostinger. | Risco alto de derrubar o build/deploy por causa de uma feature secundária. | **Padrão que sigo hoje:** página HTML assinada, imprimível (`@media print`), enviada por link. Se o João exigir anexo real no e-mail, o caminho é `@react-pdf/renderer` (JS puro, sem browser) — custa refazer o layout, não muda schema. |
| **C13** | **"Sessões convertidas × não convertidas" (Módulo 4).** O material prova que 18 das 52 SVs chegaram à apresentação do croqui. Não prova o contrário para as outras 34 — várias são de agosto/setembro e podem estar em andamento. | Rotular 34 pessoas como "não converteu" produziria uma taxa de conversão falsa que alimentaria prompt, indicador e decisão comercial. | `avancou_para_croqui` (18) ou `indefinido` (34). A tela mostra os dois números e diz que `indefinido` **não é perda**. Quando a Dra. Elaine carimbar os desfechos reais, é `UPDATE` em `casos_conhecimento`, não migration. |
| **C14** | **As 70 transcrições são de clientes reais e não há consentimento de tratamento por IA registrado para nenhuma.** O Módulo 4 é, no documento, o coração da evolução do método. | Mandar isso para a Anthropic hoje é o BLOQUEIO B3 do plano v1, multiplicado por 70. | Ingestão, pareamento, busca e leitura: **sim, hoje** (é dado do escritório, em banco do escritório, com RLS). Passe de IA: **não**, até B3. A flag existe e nasce desligada. |
| **C15** | **Convite de equipe por e-mail exige `service_role`** (`auth.admin.inviteUserByEmail`) — e a chave está vazia. | O admin cria a linha em `perfis_equipe` e o convidado não recebe nada. | Rota implementada; sem a chave responde 503 e a tela mostra: *"Linha de convite criada. Envio de e-mail indisponível — entregue o acesso por fora."* Honesto, não quebrado. |

---

## 7. BLOQUEIO — o que depende do João, e o que eu faço enquanto ele não volta

Regra desta noite: **para cada bloqueio existe um caminho padrão já escolhido**. Nenhum deles reclassifica pessoa nem apaga histórico — por isso podem ser executados e revertidos.

| # | Bloqueio | **Caminho padrão que sigo hoje** | O que muda se ele decidir diferente |
|---|---|---|---|
| **B11** | Validade e reuso dos links públicos. | 14 / 14 / 30 / 90 dias; formulário e agendamento com estado terminal; revogação ao fechar a jornada. | Só `UPDATE` em `configuracoes`. **Zero deploy, zero migration.** |
| **B12** | Duração da Sessão de Viabilidade e antecedência mínima de agendamento. O método **não define**. | 60 min e 24h de antecedência, gravados em `configuracoes` e rotulados na tela de Admin como *"valor inicial, não vem do método"*. | `UPDATE` em `configuracoes` + `disponibilidades.duracao_minutos`. Agendamentos já criados **não** mudam. |
| **B13** | **LGPD:** IA sobre transcrição de cliente (herda o B3 do plano v1, agora ×70). | Módulo 4 entra **sem IA**: ingestão, pareamento, busca, contagem. A flag `CONHECIMENTO_ANALISE_IA` nasce `false`. Nenhum byte de transcrição sai para a Anthropic. | Ligar a flag + criar versão nova do prompt. Nada a desfazer. |
| **B14** | Material pós-sessão: quem assina, o que pode prometer (publicidade da advocacia). | Material gerado é **rascunho interno**. A régua `pos_sessao` **não** envia link sem `aprovado_em`. Mensagem sem aprovação fica pendente e aparece no painel. | Se ele quiser envio automático, é remover a trava — mas eu recomendo por escrito que não. |
| **B15** | Qual das 4 guias do Script é a versão oficial (C5 do plano v1, ainda aberto). | As 4 entram como versões 1–4; **a 4 fica ativa**, com aviso na tela de que não foi carimbada. | `UPDATE` em `roteiros_versoes.ativo`. As sessões já conduzidas guardam `roteiro_versao_id` — o histórico não muda. |
| **B16** | Como a equipe recebe acesso sem `service_role`. | Admin cria a linha em `perfis_equipe`; a entrega do acesso é manual. | Com a chave, a rota de convite passa a funcionar sozinha. |
| **B17** | **`SUPABASE_SERVICE_ROLE_KEY` está vazia.** Não é decisão da Dra. Elaine — é um valor no painel do Supabase. | Todo caminho que precisa dela responde **503 honesto**. Upload público, webhook, cron da régua, IA e convite ficam visivelmente indisponíveis, nunca fingindo sucesso. | **Se o orquestrador tiver acesso ao painel/MCP do Supabase (projeto `fcfsnqqaphtamhrpuyoh`), pegar a `service_role` e preencher `.env.local` destrava 5 features de uma vez.** É a maior alavanca isolada desta noite. |
| **B18** | Layout do CSV de leads do seminário. | **Não hardcodo layout.** O operador casa coluna→campo na tela; o mapa fica em `importacoes.mapa_colunas` e pode ser reusado. | Nada muda: o mapa é dado. |
| **B19** | **Retenção** de transcrição, gravação, IR e contrato social (B9 do plano v1, agora urgente: 3,5 MB de PII entram no banco). | Guardo tudo, com `criado_em` e RLS restrita, e **não escrevo política de expurgo** — expurgo sem prazo definido é destruição de prova. Registro a pendência na tela de Admin. | Definido o prazo, é um job na régua que já existe. |
| **B20** | **A ordem do POP 01 × a esteira do João** (C3 do plano v1) volta a morder aqui: se o cliente agenda pelo link **antes** de responder o formulário, o D-7 pode disparar sem briefing. | Emito o link de agendamento **junto** com o de formulário, na mensagem de boas-vindas, e o painel lista "sessão agendada sem formulário" como pendência de preparo. Não bloqueio o agendamento por falta de formulário — dinheiro entrou, cliente marca. | Se a decisão for "só agenda depois de responder", vira uma checagem em `escolher_horario_publico`: 3 linhas. |

---

## 8. Os 5 critérios do Fable

| Critério | O que este plano garante |
|---|---|
| **Segurança** | A maior superfície nova do projeto entra com o papel `anon` tendo **zero privilégio de tabela** — só 4 funções `security definer` nomeadas uma a uma, com `revoke` explícito no resto. Token de 256 bits que **nunca chega ao banco** (só `sha256(token‖pepper)`), erro único para todo caso ruim (sem oráculo de existência), escopo mínimo na resposta (nenhum UUID interno vaza), rate limit **por token** em tabela — porque o pentest desta base já provou que limite por `X-Forwarded-For` é decorativo. A regra de negócio do link vive **no banco**, não na rota, que é a lição literal do achado ALTO 1 de 03/09. Além disso o plano **fecha os quatro itens que ficaram abertos** naquele relatório (`for all` incluindo DELETE em 9 tabelas, webhook que não reprocessa, cooldown de IA, rate limit), no gatilho que o próprio relatório fixou: antes de dado real entrar. Upload público reusa o caminho já auditado e falha fechado sem `service_role`. Pesquisa em fonte pública entra com trava de consentimento **no banco** e coleta automatizada explicitamente bloqueada. 7 tarefas obrigatórias de pentester. |
| **Escalabilidade** | Nenhuma tabela nova cresce com o tráfego público sem índice: `links_publicos` por `token_hash` único, `links_publicos_acessos` por `(link_id, ocorrido_em desc)`, `publico_rate_limit` chaveado por janela (linha morta some com um `delete` de janela antiga, não com varredura). Slots de agenda são **derivados na consulta**, não materializados — a alternativa geraria milhares de linhas por semana que envelhecem sozinhas. As views do painel filtram por índice parcial já existente (`where desfecho='aberta'`). As transcrições (3,5 MB) entram em coluna `text` com TOAST e índice GIN de `tsvector` — busca em 70 documentos e em 700 custa o mesmo formato de plano. `configuracoes` evita releitura de constante em cada requisição (uma linha, cacheável). Nada de polling em tela aberta: o egress é da **org**, e este é o 3º projeto sob o mesmo teto. A 10× o volume, o que dobra é linha em tabela indexada. |
| **Solidificação** | Invariantes novas que o **banco** passa a garantir sozinho: um link ativo por tipo por jornada (índice único parcial); link não sobrevive ao fechamento da jornada (trigger); link não nasce com prazo no passado (check); saída de IA em modo demonstração **não pode** ser gravada como dado real (trigger `trava_saida_demonstracao`); documento duplicado barrado por `sha256`; horário escolhido pelo cliente só entre os que foram ofertados (FK em `agendamentos_sugestoes` + verificação na RPC) e nunca sobreposto (exclusion constraint que já existia); pesquisa em fonte pública **não insere** sem consentimento vigente (trigger); um roteiro ativo por chave; um material atual por jornada; caso de conhecimento nunca rotulado como perda sem prova (check do enum). E a remoção de uma invariante negativa: `for all` deixa de conceder DELETE em 9 tabelas com PII. |
| **UX** | O advogado abre o sistema e vê **a fila do dia**, não um kanban para varrer: sessões de hoje, quem falta preparo, **quem pagou e ninguém ligou**, e o que trava — bloco vazio diz "nada pendente", nunca zero falso. Alerta é fila, número é informação: os quatro primeiros blocos são acionáveis, o quinto é leitura. O cliente responde o formulário no celular em 3 minutos, sem senha, sem app, sem Typeform — e escolhe o horário na mesma página onde recebeu o convite. A advogada conduz a sessão com o roteiro na tela e os 4 SIMs virando registro de consentimento no ato. O relatório da SV sai imprimível, campo a campo do template dela. Tudo que não está pronto carrega `<SeloStub>`; tudo que é exemplo de IA carrega `<SeloDemonstracao>` de largura total, **com marca d'água até na impressão** — a folha não pode sair da impressora parecendo análise real. |
| **Otimização** | O plano **remove** trabalho em oito lugares, não só empilha: (a) o roteiro da ligação vira **dado** no mesmo motor do formulário — o POP 03-B nasce sem uma linha de front nova, e o formulário do POP 03 sai do código; (b) **um** mecanismo de link público serve a 4 finalidades, no lugar de 4 fluxos de acesso; (c) o formulário público mata o Typeform e a redigitação manual da resposta; (d) a importação de CSV substitui a criação de card a card; (e) `configuracoes` recolhe prazos, cooldown e duração que iam virar constantes espalhadas em TS — mexer neles deixa de ser deploy; (f) o modo demonstração reusa o **mesmo schema Zod e a mesma tela** da análise real, então não existe tela paralela para manter; (g) slots derivados no lugar de tabela de slots materializada; (h) o painel do dia responde em uma consulta o que hoje exige varrer o kanban, abrir fichas e rodar SQL à mão para achar pagamento sem contato. E o relatório da SV **não** ganha colunas que já existem em `pagamentos`, `agendamentos` e `formularios_respostas` — evitar a duplicação é o que impede o drift. |

---

## 9. Anexo

### Variáveis de ambiente novas

```
LINK_PUBLICO_PEPPER=          # 32+ bytes aleatórios. Sem ela, /api/publico/* responde 503.
IA_MODO_DEMONSTRACAO=false    # true só destrava exemplo fixo QUANDO ANTHROPIC_API_KEY falta.
CONHECIMENTO_ANALISE_IA=false # trava do Módulo 4 por IA. Ver BLOQUEIO B13.
CRON_SECRET=                  # já é usado por /api/cron/regua e /api/diagnostico, faltava no exemplo.
```

### Ordem de aplicação das migrations

`0027` (onda 0, sozinha) → `0028` ‖ `0029` ‖ `0034` (onda 1) → `0033` ‖ `0035` (onda 2) → `0030` ‖ `0031` (onda 3) → `0032` ‖ `0036` (onda 4).
`0028` depende de `0027` (`configuracoes`). `0029` depende de `0028` (`agendamentos_sugestoes.link_id`). `0031` depende de `0028` (link `material`).

### Como reverter cada migration

Todas são aditivas. Reversão de qualquer uma: `drop` das tabelas e triggers criados por ela, e **restauração da policy antiga** no caso da `0027` (o `drop policy ... for all` é a única alteração destrutiva do lote — o `backend-engineer` deve deixar o texto da policy antiga em comentário dentro do arquivo, para o caminho de volta ser copiar e colar). Nenhuma migration deste plano faz `UPDATE` que mude valor de linha existente; nenhuma faz `DELETE`. **Nenhuma pessoa muda de faixa, papel, etapa ou desfecho por causa deste plano.**
