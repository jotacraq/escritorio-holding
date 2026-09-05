# SIC-HF — Arquitetura Fase 4 ("megafeature de melhoria geral")

Escrito em **04/09/2026** pelo arquiteto, para execução em paralelo por 6–10
agentes (`backend-engineer` / `frontend-engineer`), auditoria do
`security-pentester` e trava final do `fable-orchestrator`.

Continua `docs/ARQUITETURA.md` (fase 1), `docs/ARQUITETURA-FASE-2.md` (fase 2)
e `docs/ARQUITETURA-FASE-3.md` (fase 3). **Tudo que está lá continua valendo.**
Este plano é aditivo. Migrations novas começam em **0050** (a `0049` está
aplicada em produção).

**A frente visual/design-system NÃO está aqui.** `src/app/globals.css`,
`src/components/ui/**`, `src/components/shell/**`, `src/app/login/**` e
`src/components/comandos/**` pertencem a outro time. Nenhum agente deste plano
toca nesses caminhos; todo componente novo consome `ui/Botao`, `ui/Selo`,
`ui/Estado`, `ui/Gaveta`, `ui/ChecklistPendencias`, `ui/Abas` **como estão hoje**.

---

## 0. Sumário executivo — as sete frases que mandam neste plano

1. **A esteira já tem motor; o que falta é o cliente conseguir responder.** A
   régua enfileira D-7 e "dia da sessão" sozinha (`0013:97-136`), mas o D-7
   pede "responda confirmando" por e-mail e **nada registra a resposta**. Não
   existe estado de presença confirmada. É o furo funcional número 1.
2. **`{{link_sala}}` é renderizado no enfileiramento, não no envio**
   (`0013:75-78`). Como o link é colado à mão dias depois (B10), o e-mail do
   dia da sessão sai com o link **vazio**. Mesmo bug de classe do G18
   (`{{link_material}}`), já resolvido para o material — replicar a solução.
3. **A ligação por IA não é telefonia nova: é o padrão Vapi+n8n que a casa já
   roda** (RSVP do seminário: `LANCADOR → DISPARO → Vapi → WEBHOOK → REAPER`).
   O SIC-HF só precisa de uma fila, um contrato de webhook assinado e a
   **mesma RPC** que o link público usa para gravar o horário. A IA escolhe
   entre os horários que `gerarSugestoesAgendamento()` já calcula — nunca
   inventa.
4. **O agendamento entra no banco por um único caminho.** Hoje são três
   (`escolher_horario_publico` RPC, `POST /api/jornadas/[id]/agendamentos`
   insert direto, `PATCH /api/agendamentos/[id]` remarcação em dois passos não
   atômicos). A Fase 4 extrai o núcleo para `app.confirmar_horario_da_sugestao`
   e faz o link público, a ligação IA e a equipe convergirem nele.
5. **PDF de verdade com uma dependência pura-JS (`pdfkit`), nada de Chrome.**
   O material é 4 tipos de bloco (`titulo|paragrafo|lista|citacao`) — um
   renderizador de 150 linhas. Gera **só na aprovação** (B14): rascunho nunca
   vira arquivo.
6. **Preço, alíquota e honorário saem do TypeScript e viram dado versionado**
   (`parametros_metodo`). O sistema **não calcula imposto** (B26): a rubrica
   `calculado` só existe quando a advogada digitou base + alíquota e o
   parâmetro vigente foi carimbado na linha.
7. **"Próximo passo e de quem é" passa a ter uma função só.** Hoje são quatro
   fontes (`derivar.ts`, `pendencias.ts`, `vw_pendencias_preparo`,
   `vw_jornada_kanban`) com vocabulários diferentes. A Fase 4 dá a `derivarPasta`
   uma irmã pura, `derivarProximoPasso(sinais)`, alimentada por **sinais** que
   toda superfície já carrega — sem fetch novo.

---

## 1. F1 · Esteira automatizada de ponta a ponta

### 1.1 Mapa passo a passo — existe / parcial / falta (com evidência)

| # | Passo do fluxo do brief | Estado | Evidência |
|---|---|---|---|
| 1 | Compra na Hotmart → pagamento registrado, etapa avança | **existe** (sem credencial) | `webhooks/hotmart/route.ts:77-251` fail-closed, `processar_pagamento_hotmart` (`0011:379-467`). Todo evento cai em `produto_nao_mapeado` até os 3 IDs entrarem — **a tela de Admin → Produtos já edita `hotmart_produto_id`** (`api/admin/produtos/route.ts:37`, `[id]/route.ts:16`). |
| 1b | Reentrega de webhook que falhou reprocessa | **falta** | `route.ts:132-155`: `upsert(ignoreDuplicates)` → linha já existente responde `reentrega:true` 200 **sem olhar `processado_em`**. A nota da `0027:117-124` pede exatamente isso. `POST /api/admin/webhooks/[id]/reprocessar` só zera colunas, não reprocessa (`reprocessar/route.ts:268-274`). |
| 2 | Boas-vindas e-mail + WhatsApp "a equipe vai ligar" | **existe** | `app.regua_boas_vindas` (`0011:342-359`) enfileira os dois canais; template v1 já diz "em breve nossa equipe entra em contato" (`0013:198-210`). Sai de verdade quando `RESEND_API_KEY`/`EMAIL_FROM` existirem. |
| 3 | Ligação por IA para agendar (IA oferece melhor horário, depois alternativas) | **falta** | Nenhum arquivo em `src/server/` fala com voz. Existe o insumo: `gerarSugestoesAgendamento()` (`agenda/sugestoes.ts:44-113`) ordena slots por IA a partir da ligação estratégica — ou cronologicamente sem ela (C10). Ver **F2**. |
| 3b | Agendamento cai no sistema | **parcial** | Pelo link `/p/a` cai via `escolher_horario_publico` (`0028:622-732`, cria `confirmado`, `origem='cliente'`). Pela equipe cai por insert direto (`jornadas/[id]/agendamentos/route.ts:71-83`). `agendamentos.origem` **já aceita `'ia'`** (`0008:577`). Não há caminho de IA. |
| 4 | Ligação humana POP 03 registrada | **existe** | `LigacaoAba.tsx` + `RoteiroDeBanco` lendo `roteiros_versoes.pop_03` (0030); `ligacoes_estrategicas` (`0006:30-58`). Painel mostra "pagou e ninguém ligou" (`vw_pagos_sem_contato`, `0034:85-108`). |
| 5 | D-7: mensagem pedindo **confirmação** do cliente | **parcial** | Enfileira `confirmacao_d7` em `inicio_em - 7d` (`0013:122-127`), WhatsApp se tem telefone, senão e-mail. **O cliente não tem como confirmar**: o template diz "responda confirmando" (`0013:214-221`), nenhuma rota recebe a resposta, `agendamentos.status='confirmado'` hoje significa "slot escolhido" (é o que o link público grava), não "presença confirmada". Agenda/Painel/Pasta não distinguem. |
| 6 | Dia da sessão: e-mail com link da sala, "aberta 10 min antes" | **parcial com bug** | Enfileira `dia_da_sessao` em `inicio_em - 10min` (`0013:129-131`) — o "10 min antes" existe. **Bug**: `{{link_sala}}` é substituído no enfileiramento (`0013:75-78`) por `sessoes_viabilidade.link_sala`, que é `null` quando o agendamento nasce (colado à mão depois, B10, `0008:560`). O e-mail sai com linha em branco. Não existe integração de sala. |
| 7 | Fallback WhatsApp manual | **existe** | Fila manual em `/comunicacao` (`comunicacao/page.tsx:42-92`): copiar, abrir `wa.me`, marcar enviada (`0019`). |
| 8 | Sessão de Viabilidade conduzida | **existe** | Modo Conduzir (`components/sessao/**`), briefing lateral, SIMs, transcrição persistida (`0045`). |
| 9 | Pós-sessão: material em PDF personalizado pela dor | **parcial** | Material gerado por IA/modelo (`ia/material.ts`), aprovação humana (`aprovar_material_gerado`, `0031:268-297`), link `/p/m` só após aprovação (`reivindicar_mensagens_pendentes`, `0031:502-523`). **É HTML + `window.print()`** (`MaterialPublico.tsx`), não PDF. Ver **F3**. |
| 10 | Dra. Elaine envia pessoalmente link do croqui + data + pede IR | **falta** | Existe `ofertas` (`0011:256-269`) e `PainelOferta.tsx` para registrar a oferta na sessão; existe link `/p/d` para documentos (`0028`); **não existe** a tarefa humana "enviar pessoalmente" com mensagem pronta e marcação de enviado. `tarefas` (`0027:317-337`) existe, sem uso nesse fluxo. |
| 11 | IR / contrato social recebidos | **existe** | `/p/d` público + `documentos` (0012) + `DocumentosAba`. |
| 12 | Croqui apresentado em modo apresentação | **existe** | `ModoApresentacao.tsx`, `DeckImpressao.tsx`, gráficos. Slide economia `null` hardcoded — ver **F4**. |
| 13 | Holding contratada | **existe** | pagamento `holding` → `holding_contratada` (`0011:434-438`). |
| — | Cron da régua rodando em produção | **falta (infra)** | `POST /api/cron/regua` existe (`cron/regua/route.ts`), fail-closed. **Achado do orquestrador (04/09): a conta Hostinger `u542688653` não tem cron chamando a rota, e o `CRON_SECRET` local não bate com o de produção (401).** Nenhuma mensagem sai hoje, com ou sem Resend. |

### 1.2 Desenho — (a) confirmação de presença pelo cliente

**Conceito.** "Presença confirmada" é um **fato sobre o agendamento**, não um
novo status. Trocar o enum `status_agendamento` tocaria o índice único
`uniq_agendamento_confirmado` (`0008:585`), a exclusão GiST (`0008:587-589`),
o trigger da régua (`0013:108`), três views do painel e o kanban. Coluna nova
tem raio de explosão zero.

```sql
-- 0051 (rascunho comentado; o backend transforma em arquivo)
alter table agendamentos
  add column presenca_confirmada_em  timestamptz,
  add column presenca_confirmada_via text
    check (presenca_confirmada_via in ('link','whatsapp','email','equipe','ligacao_ia'));
-- Invariante: os dois andam juntos.
alter table agendamentos add constraint ck_presenca_confirmada
  check ((presenca_confirmada_em is null) = (presenca_confirmada_via is null));
```

**Link.** Reuso de `links_publicos` com tipo novo `confirmacao` — não uma
tabela nova. Motivo: herda pepper+hash, rate limit por token e por rota,
expiração por `configuracoes.link.validade_dias`, auditoria em
`links_publicos_acessos`, revogação ao fechar jornada (`0028:194-206`) e a
página pública já vestida. Rota `/p/c/[token]`.

> **Armadilha de Postgres que decide a numeração:** `alter type ... add value`
> não pode ser **usado** na mesma transação em que foi criado. Como cada
> migration é aplicada como uma transação, o valor `'confirmacao'` entra
> sozinho na **`0050`** e só é referenciado a partir da **`0051`**. Quem juntar
> os dois arquivos derruba a migration com `unsafe use of new value`.

```sql
-- 0050_tipo_link_confirmacao.sql  (SÓ isto no arquivo)
alter type tipo_link_publico add value if not exists 'confirmacao';

-- 0051 — RPC pública, mesmo padrão das 4 existentes (jsonb com `erro`, nunca exceção)
create or replace function public.confirmar_presenca_publico(
  p_hash text, p_ip_hash text default null, p_user_agent text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_link links_publicos; v_ag agendamentos%rowtype;
begin
  if not app.limite_rota_ok('confirmar_presenca_publico') then return jsonb_build_object('erro','limite_excedido'); end if;
  if not app.limite_token_ok(p_hash) then return jsonb_build_object('erro','limite_excedido'); end if;
  v_link := app.resolve_link_leitura(p_hash);              -- tolerante a 'usado': reabrir o link mostra "já confirmado"
  if v_link is null or v_link.tipo <> 'confirmacao' then return jsonb_build_object('erro','link_invalido'); end if;
  -- O agendamento alvo é o que estava ativo quando o link foi emitido: gravado em links_publicos.agendamento_id (coluna nova, abaixo).
  select * into v_ag from agendamentos where id = v_link.agendamento_id and status in ('agendado','confirmado');
  if not found then return jsonb_build_object('erro','agendamento_indisponivel'); end if;
  if v_ag.presenca_confirmada_em is null then
    update agendamentos set presenca_confirmada_em = now(), presenca_confirmada_via = 'link' where id = v_ag.id;
    update links_publicos set usos = usos + 1, estado = 'usado' where id = v_link.id;
    perform app.registrar_evento_timeline(v_link.jornada_id, 'agendamento', 'Presença confirmada pelo cliente', null,
      jsonb_build_object('agendamento_id', v_ag.id, 'via', 'link'));
  end if;
  perform app.registrar_acesso_publico(v_link.id, 'confirmar', 'ok', p_ip_hash, p_user_agent);
  return jsonb_build_object('ok', true, 'inicio_em', v_ag.inicio_em, 'fim_em', v_ag.fim_em,
                            'confirmada_em', coalesce(v_ag.presenca_confirmada_em, now()));
end $$;
revoke execute on function public.confirmar_presenca_publico(text, text, text) from public;
grant  execute on function public.confirmar_presenca_publico(text, text, text) to anon;
```

`links_publicos` ganha `agendamento_id uuid references agendamentos(id)`
(nullable; só o tipo `confirmacao` preenche; `check (tipo <> 'confirmacao' or
agendamento_id is not null)`). `app.payload_link_confirmacao` devolve
`{inicio_em, fim_em, ja_confirmada_em}`; `abrir_link_publico` (0031:443-492)
ganha o `when 'confirmacao'`. O trigger `app.regua_agendamento` já cancela
mensagens pendentes ao remarcar; a **0051 acrescenta**: ao remarcar/cancelar,
revogar o link `confirmacao` ativo do agendamento antigo (o novo agendamento
enfileira D-7 novo, que emite link novo no envio).

**Emissão do link no momento do envio (G18, igual ao material).** Template
`confirmacao_d7` v2 (e-mail e WhatsApp) com `{{link_confirmacao}}`.
`app.enfileirar_mensagem` **não** conhece esse placeholder — quem resolve é
`processar.ts`, com `emitir_link_confirmacao_sistema(p_agendamento_id, p_hash,
p_prefixo)` (service_role, irmã de `emitir_link_material_sistema`, `0031:307-338`).

**WhatsApp manual também precisa do link.** Hoje a fila manual copia
`corpo_renderizado` cru. Rota nova `POST /api/mensagens/[id]/preparar`
(interno, `exigirInterno`): resolve `{{link_confirmacao}}`/`{{link_sala}}`
com service_role, congela `corpo_renderizado`, devolve o texto. O botão
"Copiar texto" da tela passa a chamar isto **antes** de copiar. Placeholder
literal nunca chega ao cliente por nenhum canal.

**Visibilidade.** `vw_sessoes_do_dia` (0034) e `vw_jornada_kanban` (0023)
ganham `presenca_confirmada_em`; `GET /api/agendamentos` devolve os dois
campos novos; `Ficha360.agendamentos` já traz `select("*")`. Agenda, Painel,
Pasta e Esteira mostram o selo **"Confirmou"** (verde) / **"Aguardando
confirmação"** (neutro) / **"Sem resposta há N dias"** (âmbar quando faltam
< 3 dias). Equipe pode confirmar à mão (`presenca_confirmada_via='equipe'`,
`PATCH /api/agendamentos/[id]` aceita `{presenca_confirmada: true}`) — é o
fallback do WhatsApp.

### 1.3 Desenho — (b) sala aberta 10 min antes

O "10 min antes" já é a hora do e-mail (`0013:130`). O que falta é o link
existir na hora do envio.

1. **`{{link_sala}}` resolvido no envio, não no enfileiramento.**
   `app.enfileirar_mensagem` passa a substituir `{{link_sala}}` **só quando
   `p_link_sala is not null`**; caso contrário deixa o placeholder.
   `processar.ts` resolve lendo `sessoes_viabilidade.link_sala` na hora.
2. **Nunca manda e-mail de "sala disponível" sem sala.**
   `reivindicar_mensagens_pendentes` (assinatura muda → **`drop function`
   explícito** antes do `create`, armadilha 6) ganha a regra: mensagem cujo
   corpo contém `{{link_sala}}` só é reivindicada se a sessão tem `link_sala`.
   Enquanto isso, `vw_pendencias_sistema` ganha o tipo **`sessao_sem_sala`**
   ("Sessão em N h sem link da sala — cole o link ou ligue a integração"),
   com janela de 24 h.
3. **Integração opcional via n8n (Google Meet ou Zoom, quem a casa tiver).**
   Quando um agendamento fica `agendado|confirmado` e a sessão não tem
   `link_sala`, e `N8N_WEBHOOK_SALA_URL` está configurada, o servidor chama
   o n8n (`src/server/sala/n8n.ts`, POST assinado com HMAC de
   `INTEGRACOES_WEBHOOK_SECRET`) com `{sessao_id, inicio_em, fim_em,
   titulo, callback_url}`. O n8n cria a reunião e chama
   `POST /api/webhooks/n8n/sala` (assinado, fail-closed, idempotente por
   `id_evento` em `webhooks_eventos` com `origem='n8n_sala'`) que grava
   `link_sala` + `link_sala_origem='n8n'` via RPC `registrar_link_sala`
   (service_role). Sem env var: nada acontece, o campo manual continua, a
   pendência acima aparece. **Ninguém espera resposta síncrona do n8n.**

```sql
-- 0051
alter table sessoes_viabilidade
  add column link_sala_origem text not null default 'manual' check (link_sala_origem in ('manual','n8n')),
  add column link_sala_atualizado_em timestamptz;
```

### 1.4 Desenho — (c) "Dra. Elaine envia pessoalmente" como tarefa assistida

Não é automação: é uma **tarefa humana com tudo pronto**. Reusa `tarefas`
(0027), que tem `origem='sistema'` e nunca foi usada.

- **Gatilho**: trigger `app.tarefa_pos_sessao` — quando `sessoes_viabilidade.
  realizada_em` transita de null → valor **e** `resultado='fechou'` (ou quando
  uma `ofertas` é registrada com `aceita=true`): insere `tarefas` com
  `tipo='enviar_link_croqui'`, `jornada_id`, `responsavel_id = advogada_id`,
  `vence_em = realizada_em + 1 dia`, `origem='sistema'`. Idempotente por
  índice único parcial `(jornada_id, tipo) where concluida_em is null`.
- **Tela (Ficha 360 → aba Sessão, e Painel do Dia bloco "Minhas tarefas")**:
  cartão com **mensagem pré-escrita** montada no cliente a partir de um
  template `mensagens_templates` chave `croqui_convite` (canal `whatsapp`,
  seed v1 na 0051, texto curto no tom do seminário — nada de dado inventado:
  campos `{{nome}}`, `{{valor_croqui}}` de `ofertas.valor_ofertado`,
  `{{data_apresentacao}}` do agendamento de apresentação se houver, senão a
  frase "vamos combinar a data"), botão **"Copiar mensagem"**, botão
  **"Gerar link para documentos (IR e contrato social)"** que chama o
  `POST /api/jornadas/[id]/links {tipo:'documentos'}` que já existe, e o
  botão **"Marquei como enviado"** → `PATCH /api/tarefas/[id]` conclui a tarefa
  e grava evento na timeline (`tipo='nota'`, ator humano).
- **Link de pagamento do croqui**: é URL da Hotmart, por produto. Vive em
  `produtos.url_checkout text` (coluna nova, 0051, editável em Admin →
  Produtos). Sem ela preenchida: o cartão mostra o `<SeloStub>` "Link de
  checkout do Croqui não cadastrado — Admin → Produtos" e a mensagem sai sem
  o link (o placeholder `{{link_pagamento}}` vira a frase "te mando o link
  em seguida"). Nunca inventa URL.

### 1.5 Desenho — (d) reprocessamento de webhook Hotmart

Refatoração sem migration: extrair o miolo de `webhooks/hotmart/route.ts:157-250`
para `src/server/pagamentos/hotmart.ts#processarEventoHotmart(supabaseAdmin,
webhookEventoId)`. A rota passa a:

```
upsert(ignoreDuplicates) → se voltou linha: processar
                         → se NÃO voltou linha (já existia):
                              select processado_em, assinatura_valida from webhooks_eventos
                              se processado_em is null  → processar de novo (mesmo bruto já gravado)
                              senão                     → 200 {reentrega:true}
```

`processar_pagamento_hotmart` já é idempotente por `on conflict (origem,
transacao_externa_id) do update` (`0011:456`). `POST /api/admin/webhooks/[id]/
reprocessar` passa a: chamar `reprocessar_webhook` (zera) **e em seguida**
`processarEventoHotmart` — reprocessa de verdade, no clique. Os 3
`hotmart_produto_id` **já são config de Admin** (Produtos) — o plano só
acrescenta `url_checkout` (§1.4) e o texto da pendência quando algum produto
ativo está sem ID: *"Produto sem ID da Hotmart: todo pagamento dele vai cair
em 'produto não mapeado' até o ID ser preenchido."*

### 1.6 Desenho — (e) cron da régua e "próximos disparos" visíveis

- **Onde roda**: cron do hPanel da Hostinger, a cada 5 min, `curl -X POST
  -H "x-cron-secret: $CRON_SECRET" https://escritorio.grupoparticipa.app.br/api/cron/regua`.
  **Pendência de infra, não de código** (achado do orquestrador): o cron não
  existe na conta `u542688653` e o `CRON_SECRET` de produção difere do
  `.env.local`. Texto rotulado que a tela Comunicação mostra enquanto isso:
  *"A régua ainda não roda sozinha: falta o cron da Hostinger chamar
  `/api/cron/regua` a cada 5 minutos com o `CRON_SECRET` de produção. Última
  passagem registrada: nunca."*
- **Prova de vida**: `POST /api/cron/regua` grava `configuracoes['regua.ultimo_cron_em']`
  (chave nova na 0052, `UPDATE`, sem linha nova por passagem) e devolve o
  resumo. A tela lê a chave em `GET /api/mensagens` (campo extra
  `regua: {ultimo_cron_em, cron_atrasado: boolean}`) — sem polling, um
  fetch ao montar + botão Atualizar. `vw_pendencias_sistema` ganha o tipo
  **`cron_parado`** quando `now() - ultimo_cron_em > 15 min` (ou nunca).
- **Próximos disparos**: já é `GET /api/mensagens?status=pendente` ordenado
  por `agendada_para` (`mensagens/route.ts:45-51`). A tela ganha a seção
  **"O que vai sair e quando"** agrupada por dia, com o motivo humano
  (chave do template → "Confirmação D-7", "Link da sala", "Material
  pós-sessão", "Boas-vindas") e o selo do canal. `GET /api/mensagens`
  passa a devolver `template_chave` (join em `mensagens_templates`).
- **Uma rota de cron só.** A mesma passagem roda, nesta ordem:
  `processarFilaRegua` → `processarFilaLigacoesIa` (F2) → `reaperLigacoesIa`
  (F2) → `sincronizarSalas` (§1.3, só se configurado). Cada etapa é isolada:
  falha em uma não derruba as outras; o retorno lista as quatro.

### 1.7 Migrations desta frente (dono: agente A)

| Arquivo | O que faz | O que NÃO faz | Reversão |
|---|---|---|---|
| `0050_tipo_link_confirmacao.sql` | `alter type tipo_link_publico add value 'confirmacao'` — **só isso** | não usa o valor | enum value não se remove; inerte se sem uso |
| `0051_confirmacao_presenca_sala_tarefa.sql` | colunas em `agendamentos`, `sessoes_viabilidade`, `links_publicos.agendamento_id`, `produtos.url_checkout`; `confirmar_presenca_publico`; `app.payload_link_confirmacao`; `abrir_link_publico` (case novo); `emitir_link_confirmacao_sistema`; `registrar_link_sala`; `app.enfileirar_mensagem` (placeholder condicional); **`drop function public.reivindicar_mensagens_pendentes(int)`** + create com `(p_limite int, p_canais canal_mensagem[])` e as regras de hold; templates v2 `confirmacao_d7` (2 canais) e `dia_da_sessao`, v1 `croqui_convite`; trigger `app.tarefa_pos_sessao`; trigger de revogar link ao remarcar; `vw_pendencias_sistema` +`sessao_sem_sala`; `vw_sessoes_do_dia`/`vw_jornada_kanban` +`presenca_confirmada_em` | não muda status de nenhum agendamento; não apaga template v1 (fica `ativo=false`) | `drop column`s, `drop function`s, `UPDATE mensagens_templates SET ativo=(versao=1)`, recriar as views pelo texto da 0031/0034 (o backend deixa o texto anterior em comentário) |
| `0052_sinais_kanban_cron_onboarding.sql` | `vw_jornada_kanban` +`sessao_realizada_em, tem_relatorio, croqui_status, material_estado, presenca_confirmada_em` (F6); `configuracoes` +`regua.ultimo_cron_em`, `sala.provedor`; `perfis_equipe.onboarding_visto_em`; `vw_pendencias_sistema` +`cron_parado`; `tarefas` +`tipo`, índice parcial | não reclassifica ninguém | `drop column`, `delete from configuracoes where chave in (...)`, recriar view |

**Roteiro de verificação (comentário no fim de cada arquivo, a rodar de verdade):**
`0051`: (1) emitir link `confirmacao` para um agendamento de exemplo →
`abrir_link_publico` devolve `tipo='confirmacao'`; (2) `confirmar_presenca_publico`
→ `presenca_confirmada_em` preenchido, segunda chamada não muda a data, evento
na timeline; (3) `reivindicar_mensagens_pendentes(50, '{email}')` não devolve
mensagem com `{{link_sala}}` de sessão sem sala; preencher `link_sala` → devolve;
(4) remarcar agendamento → link `confirmacao` antigo `revogado`; (5)
`explain (analyze, buffers)` da view do kanban continua `Index Scan`, sem
`Seq Scan` em `agendamentos`.

### 1.8 Custo de IA

Zero. Nenhuma chamada nova nesta frente.

### 1.9 Config pendente rotulada (texto exato)

| Onde | Texto |
|---|---|
| Comunicação (topo) | "A régua ainda não roda sozinha: falta o cron da Hostinger chamar `/api/cron/regua` a cada 5 minutos com o `CRON_SECRET` de produção. Última passagem registrada: {nunca \| há N min}." |
| Comunicação (canal e-mail) | "E-mail não sai: `RESEND_API_KEY` e `EMAIL_FROM` não estão configurados no servidor. As mensagens ficam na fila e aparecem como 'falhou' com o motivo." |
| Admin → Produtos | "Produto sem ID da Hotmart: todo pagamento dele vai cair em 'produto não mapeado' até o ID ser preenchido." / "Sem `HOTMART_WEBHOOK_SECRET` no servidor o webhook recusa tudo (503) — é o comportamento certo, não um erro." |
| Ficha → Sessão | "Sala não integrada: cole o link da reunião aqui. Para gerar sozinho, configure `N8N_WEBHOOK_SALA_URL` (Admin → Integrações)." |

---

## 2. F2 · Ligação por IA (SDR de voz) e canal WhatsApp (Chatwoot)

### 2.1 O que existe

- Nada de voz no repo. `grep -ri "vapi\|twilio\|voz" src/` vazio.
- O insumo certo já existe: `gerarSugestoesAgendamento()` (`agenda/sugestoes.ts`)
  devolve até `agenda.slots_ofertados_ao_cliente` slots ordenados (por IA
  quando há ligação estratégica, cronológico senão), e o link `/p/a` grava
  esses slots em `agendamentos_sugestoes` (`0029:172-184`, `links/route.ts:184-195`).
- `agendamentos.origem` já aceita `'ia'` (`0008:577`).
- `webhooks_eventos` tem `origem` livre (`0011:299-312`) — serve de livro-razão
  idempotente para qualquer webhook, não só Hotmart.
- Achado do orquestrador: **o n8n da casa já tem Vapi configurado** (credenciais
  "Vapi API - RSVP"), com o padrão `LANCADOR (webhook) → DISPARO (lê fila,
  dispara Vapi) → WEBHOOK (Vapi → grava resultado) → REAPER (cron solta
  'discando' preso)`. Este plano **copia o padrão**, não o inventa.

### 2.2 Conceito

**A ligação IA é um "link de agendamento falado".** A IA recebe exatamente os
horários que o link `/p/a` ofertaria, oferece o primeiro (melhor sugerido pela
equipe), depois as alternativas, e devolve **um dos horários recebidos**. O
horário entra em `agendamentos` pelo **mesmo núcleo** que o link público usa.
Se a IA não conseguir, a **mesma** oferta segue por WhatsApp/e-mail com o link
`/p/a` — sem recalcular nada.

### 2.3 Um núcleo só para "confirmar horário" (0051, agente A — B consome)

```sql
-- 0051 — extraído do corpo de escolher_horario_publico (0028:670-724), sem mudar comportamento.
create or replace function app.confirmar_horario_da_sugestao(
  p_link links_publicos, p_inicio timestamptz, p_origem text  -- 'cliente' | 'ia'
) returns jsonb   -- {ok, agendamento_id, inicio_em, fim_em} ou {erro}
-- valida: slot ∈ agendamentos_sugestoes(link); nivel_pago >= 1; cria sessão se não há;
-- remarca (antigo -> 'remarcado', novo 'confirmado'); exclusion_violation -> {erro:'horario_indisponivel'};
-- avança etapa sessao_contratada -> sessao_agendada. Tudo igual ao de hoje.
-- escolher_horario_publico passa a: rate limit + resolve_link_leitura + usos<2 + chamar o núcleo + registrar_acesso.
-- Assinatura de escolher_horario_publico NÃO muda (grant para anon preservado).
```

Rascunho comentado; o backend transforma em arquivo e **deixa o corpo antigo
em comentário** para o caminho de volta ser copiar e colar.

### 2.4 Camada `src/server/ligacao-ia/**` (agente B)

```
src/server/ligacao-ia/
  tipos.ts        ProvedorLigacaoIa { nome; configurado(): boolean; disparar(ligacao, payload): Promise<{id_externo}> ; cancelar?(id_externo) }
  n8n.ts          adaptador: POST N8N_WEBHOOK_LIGACAO_URL (LANCADOR) com corpo assinado (HMAC SHA-256 do corpo + timestamp, header x-sichf-assinatura)
  manual.ts       adaptador: não liga; cria `tarefas` tipo 'ligar_para_agendar' para a equipe; a ligação fica `concluida` com resultado 'manual'
  fila.ts         enfileirar(jornadaId) → cria links_publicos tipo 'agendamento' + agendamentos_sugestoes (reusa gerarSugestoesAgendamento) + ligacoes_ia(na_fila)
  processar.ts    processarFilaLigacoesIa(admin): reivindica `na_fila` (FOR UPDATE SKIP LOCKED via RPC), chama provedor, marca `discando`
  reaper.ts       reaperLigacoesIa(admin): `discando`/`em_ligacao` há mais de `ligacao_ia.timeout_minutos` → `falhou` (motivo 'timeout_reaper'), tentativa nova se `tentativas < teto`
  resultado.ts    aplicarResultado(admin, evento): máquina de estados + registrar_horario_ligacao_ia quando há horário
```

**Tabela `0053_ligacoes_ia.sql`:**

```sql
create table ligacoes_ia (
  id               uuid primary key default gen_random_uuid(),
  jornada_id       uuid not null references jornadas(id) on delete cascade,
  link_id          uuid references links_publicos(id),          -- o link de agendamento cujos slots a IA ofereceu
  provedor         text not null check (provedor in ('n8n','manual')),
  status           text not null default 'na_fila'
    check (status in ('na_fila','discando','em_ligacao','concluida','sem_resposta','falhou','cancelada')),
  tentativa        smallint not null default 1 check (tentativa >= 1),
  telefone         text not null,                               -- E.164, copiado de pessoas no enfileiramento
  id_externo       text,                                        -- id da call na Vapi (via n8n)
  disparada_em     timestamptz, atendida_em timestamptz, encerrada_em timestamptz,
  duracao_segundos int check (duracao_segundos >= 0),
  resultado        text check (resultado in ('agendou','recusou','pediu_retorno','caixa_postal','numero_invalido','manual')),
  horario_escolhido timestamptz,
  agendamento_id   uuid references agendamentos(id),
  transcricao      text,                                        -- PII; mesma posição de ligacoes_estrategicas.transcricao
  resumo           text,
  gravacao_url     text,
  custo_usd        numeric(10,4),                               -- `cost` do end-of-call-report da Vapi; NULL se o provedor não informou
  erro             text,
  criado_em        timestamptz not null default now(), atualizado_em timestamptz not null default now()
);
create index idx_ligacoes_ia_fila    on ligacoes_ia (criado_em) where status = 'na_fila';
create index idx_ligacoes_ia_presas  on ligacoes_ia (disparada_em) where status in ('discando','em_ligacao');
create index idx_ligacoes_ia_jornada on ligacoes_ia (jornada_id, criado_em desc);
-- Uma ligação ativa por jornada por vez.
create unique index uniq_ligacao_ia_ativa on ligacoes_ia (jornada_id) where status in ('na_fila','discando','em_ligacao');
alter table ligacoes_ia enable row level security; alter table ligacoes_ia force row level security;
create policy lia_sel on ligacoes_ia for select to authenticated using ((select app.eh_interno()));
-- Sem INSERT para authenticated: só a fila (service_role). UPDATE só para cancelar:
create policy lia_cancel on ligacoes_ia for update to authenticated
  using ((select app.eh_interno()) and status in ('na_fila','discando'))
  with check ((select app.eh_interno()) and status = 'cancelada');
grant select, update on ligacoes_ia to authenticated;
```

RPCs (todas `security definer`, `search_path` fixo, grants explícitos):
`public.reivindicar_ligacoes_ia(p_limite)` (service_role), `public.registrar_horario_ligacao_ia(p_ligacao_id, p_inicio)`
(service_role) → resolve `link_id` → chama **`app.confirmar_horario_da_sugestao(link, p_inicio, 'ia')`**
→ grava `agendamento_id`, `horario_escolhido`, status `concluida`, resultado
`agendou` → `regua_agendamento` já enfileira D-7 e dia da sessão sozinha
(`0013`). Timeline: trigger `app.timeline_ligacao_ia` em toda mudança de status.

**Gatilho de entrada na fila.** Trigger `app.enfileira_ligacao_ia` em
`pagamentos` (após `regua_boas_vindas`): pagamento `aprovado` de
`sessao_viabilidade` **e** `configuracoes['ligacao_ia.automatica'] = true`
(default **false** — ver BLOQUEIO B33) **e** pessoa com telefone → insere
`ligacoes_ia(na_fila, provedor = configuracoes['ligacao_ia.provedor'])`.
O trigger **não** cria link nem sugestões (isso exige service_role e código
TS): `fila.ts` faz isso ao reivindicar. Também há o botão manual **"Ligar
por IA agora"** na Ficha → Sessão (`POST /api/jornadas/[id]/ligacoes-ia`).

**Regra de oferta.** Payload ao n8n: `primeiro_nome`, `telefone`,
`assistente_id` (`VAPI_ASSISTENTE_ID`, passado, não hardcoded no fluxo),
`melhor_horario` (posição 1 de `agendamentos_sugestoes`) + `alternativas`
(posições 2–4), cada um com `inicio_em` ISO e `rotulo` humano já formatado em
`America/Sao_Paulo` ("terça, 10 de setembro, às 15h"), `callback_url`,
`ligacao_id`. A IA **só pode devolver `inicio_em` de um dos 4** — o webhook
de entrada rejeita qualquer outro (`{erro:'horario_indisponivel'}`), e é o
núcleo do banco que valida contra `agendamentos_sugestoes`, não a rota.

**Webhook de entrada `POST /api/webhooks/n8n/ligacao`** (agente B):
1. sem `LIGACAO_IA_WEBHOOK_SECRET` → 503 (fail-closed, `registrarErro`);
2. `x-sichf-timestamp` fora de ±5 min → 401; `x-sichf-assinatura` =
   `sha256=HMAC(secret, timestamp + "." + corpo)` comparada em tempo constante → senão 401 **e grava** em `webhooks_eventos(origem='n8n_ligacao', assinatura_valida=false)`;
3. corpo Zod: `{id_evento, ligacao_id, evento: 'discando'|'em_ligacao'|'concluida'|'sem_resposta'|'falhou', horario_escolhido?, resultado?, transcricao?, resumo?, gravacao_url?, custo_usd?, duracao_segundos?, id_externo?}`; limite 1 MB;
4. upsert em `webhooks_eventos (origem, evento_externo_id)` — existente e processado → 200 `reentrega`; existente e não processado → reprocessa (mesma regra de §1.5);
5. `aplicarResultado()`; qualquer erro → 500 (n8n reentrega).
Rate limit em memória por IP, igual ao Hotmart.

**Fallback.** `sem_resposta`/`falhou` após `ligacao_ia.max_tentativas` (default 2,
intervalo `ligacao_ia.intervalo_retentativa_minutos` = 240): a ligação vira
`falhou` definitivo e o sistema **enfileira a mensagem `agendamento_link`**
(template novo, WhatsApp e e-mail, com `{{link_agendamento}}` resolvido no
envio para o **mesmo** link já emitido — `fila.ts` guarda o token em memória
só na criação; se já expirou, emite outro). A equipe vê tudo na Ficha e no
Painel ("Ligação IA não atendeu — link enviado por e-mail; WhatsApp na fila").

**Transcrição e LGPD.** A transcrição da Vapi entra em `ligacoes_ia.transcricao`
(RLS `eh_interno`, igual a `ligacoes_estrategicas.transcricao`). Ela **só
entra no contexto do Briefing** sob o mesmo gate `tratamento_ia` que já protege
a transcrição da ligação humana (`contexto-briefing.ts:591-598`). Nenhuma
exceção de LGPD nova. Ver B33.

### 2.5 Chatwoot como caixa de entrada de WhatsApp (agente B)

Chatwoot **não assina webhooks**. Fail-closed por segredo na URL:
`POST /api/webhooks/chatwoot?token=<CHATWOOT_WEBHOOK_SECRET>` — sem env var →
503; token diferente (tempo constante) → 401 e registro. Só evento
`message_created` com `message_type='incoming'` é aceito; o resto → 200 sem efeito.

```sql
-- 0054_mensagens_recebidas.sql
create table mensagens_recebidas (
  id                 uuid primary key default gen_random_uuid(),
  canal              canal_mensagem not null,                 -- 'whatsapp' (e-mail entra em fase futura)
  provedor           text not null default 'chatwoot',
  conversa_externa_id text not null, mensagem_externa_id text not null,
  telefone           text, pessoa_id uuid references pessoas(id), jornada_id uuid references jornadas(id),
  corpo              text not null, anexos jsonb not null default '[]'::jsonb,
  recebida_em        timestamptz not null, bruto jsonb not null, criado_em timestamptz not null default now(),
  unique (provedor, mensagem_externa_id)
);
create index idx_mensagens_recebidas_jornada on mensagens_recebidas (jornada_id, recebida_em desc);
create index idx_mensagens_recebidas_sem_pessoa on mensagens_recebidas (recebida_em desc) where pessoa_id is null;
-- RLS: select eh_interno; update (só pessoa_id/jornada_id — "vincular à mão") eh_interno; sem insert para authenticated.
alter table mensagens_agendadas add column provedor text, add column conversa_externa_id text;  -- chatwoot: id da conversa em que saiu
insert into configuracoes ... ('regua.canal_whatsapp', '"manual"'::jsonb, 'manual | chatwoot')
```

Casamento pessoa: telefone E.164 do contato Chatwoot → `pessoas.telefone`
(normalizado; `pessoas` já tem índice único parcial). Sem match → fica
`pessoa_id null` e aparece em Comunicação → **"Sem correspondência"** com o
botão "Vincular a uma pessoa" (busca `buscar_pessoas` existente). Timeline
ganha evento `mensagem` recebida. A Ficha 360 mostra recebidas + enviadas
numa linha de conversa dentro da aba Linha do tempo (sem aba nova).

**Envio pelo Chatwoot.** `src/server/chatwoot/cliente.ts` (`fetch` cru, sem
SDK, mesmo padrão de `regua/email.ts`): `configurado()` exige
`CHATWOOT_URL`, `CHATWOOT_ACCOUNT_ID`, `CHATWOOT_API_TOKEN`, `CHATWOOT_INBOX_ID`;
`enviarWhatsapp({telefone, texto})` → busca/cria contato, busca/cria
conversa na inbox, `POST .../messages`. `processar.ts` (agente A expõe a
função `processarFilaRegua(admin, {canais})`) reivindica `'whatsapp'` **só
quando** `configuracoes['regua.canal_whatsapp']='chatwoot'` **e**
`chatwootConfigurado()`. Caso contrário a fila manual continua idêntica.
Falha do Chatwoot → `falhou` com motivo, backoff igual ao e-mail, nunca some.

### 2.6 Admin → Integrações e `GET /api/diagnostico`

Aba nova (agente G) lendo `GET /api/admin/integracoes` (agente B):

```json
{ "itens": [
  { "chave": "resend",      "rotulo": "E-mail (Resend)",             "configurado": false, "faltam": ["RESEND_API_KEY","EMAIL_FROM"], "ultimo_evento_em": null },
  { "chave": "hotmart",     "rotulo": "Pagamentos (Hotmart)",        "configurado": false, "faltam": ["HOTMART_WEBHOOK_SECRET"], "produtos_sem_id": 3, "ultimo_evento_em": null },
  { "chave": "cron",        "rotulo": "Régua (cron da Hostinger)",   "configurado": false, "faltam": ["cron no hPanel"], "ultimo_evento_em": null },
  { "chave": "ligacao_ia",  "rotulo": "Ligação por IA (Vapi via n8n)", "configurado": false, "faltam": ["N8N_WEBHOOK_LIGACAO_URL","LIGACAO_IA_WEBHOOK_SECRET","VAPI_ASSISTENTE_ID"], "automatica": false },
  { "chave": "sala",        "rotulo": "Sala de reunião (n8n)",       "configurado": false, "faltam": ["N8N_WEBHOOK_SALA_URL","INTEGRACOES_WEBHOOK_SECRET"] },
  { "chave": "chatwoot",    "rotulo": "WhatsApp (Chatwoot)",         "configurado": false, "faltam": ["CHATWOOT_URL","CHATWOOT_ACCOUNT_ID","CHATWOOT_API_TOKEN","CHATWOOT_INBOX_ID","CHATWOOT_WEBHOOK_SECRET"] },
  { "chave": "ia",          "rotulo": "IA (OpenRouter)",             "configurado": true,  "faltam": [] }
] }
```

Só nomes de variáveis — nunca valor, nunca tamanho (o diagnóstico com
`CRON_SECRET` continua sendo a rota que mostra tamanho). `GET /api/diagnostico`
ganha as 9 variáveis novas na lista `VARIAVEIS`. Na aba, cada integração
mostra o texto exato de pendência, os toggles que são dado (`ligacao_ia.automatica`,
`ligacao_ia.provedor`, `regua.canal_whatsapp`, `sala.provedor`) e o
**"Testar"** (chama o provedor com um evento de teste e mostra o resultado
cru — `POST /api/admin/integracoes/[chave]/testar`, admin).

### 2.7 O que vai para o n8n (documentação, não código deste repo)

`docs/integracoes/n8n-ligacao-ia.md` (agente B escreve): contrato dos dois
webhooks, o prompt-base do assistente (nome, oferta do melhor horário
primeiro, aceitar só um dos 4, encerrar educadamente, nunca falar de preço
ou de holding — a ligação é agendamento, não venda), o mapeamento
`end-of-call-report` da Vapi → evento `concluida` com `cost` → `custo_usd`,
e o reaper. **O orquestrador cria o workflow no n8n** pela MCP; este repo não
guarda JSON de workflow.

### 2.8 Custo de IA

- **Voz**: por minuto na Vapi — **não estimo número**; grava-se `custo_usd`
  por ligação a partir do `cost` do provedor e a aba Custo de IA ganha o
  recorte "ligações" (view `vw_custo_ligacoes_ia_mensal`, `security_invoker`).
- **Ordenação dos horários**: já existe e já é paga uma vez por link
  (`ordenar_horarios_agenda`, ~US$ 0,01) — a ligação IA **reusa o mesmo link**,
  zero chamada extra.
- **Chatwoot**: zero IA.

### 2.9 Config pendente rotulada

| Chave | Texto na tela (Admin → Integrações) |
|---|---|
| `N8N_WEBHOOK_LIGACAO_URL` | "URL do webhook LANCADOR no n8n (padrão do RSVP). Sem ela a ligação por IA fica em 'manual': vira tarefa para a equipe ligar." |
| `LIGACAO_IA_WEBHOOK_SECRET` | "Segredo compartilhado com o n8n para assinar o retorno da ligação. Sem ele o SIC-HF recusa qualquer retorno (503) — é o comportamento certo." |
| `VAPI_ASSISTENTE_ID` | "ID do assistente de voz na Vapi usado para agendar a Sessão de Viabilidade." |
| `N8N_WEBHOOK_SALA_URL` + `INTEGRACOES_WEBHOOK_SECRET` | "Sem isto, o link da sala é colado à mão na Ficha → Sessão." |
| `CHATWOOT_*` | "Sem isto, WhatsApp continua fila manual: copiar, abrir no WhatsApp, marcar enviada." |

---

## 3. F3 · Material pós-sessão em PDF, personalizado pela dor

### 3.1 O que existe

- Geração: `ia/material.ts:160-283` — cascata da dor (ligação → formulário →
  relatório), classificação por regex para 1 de 5 modelos (`:117-130`),
  1 chamada de IA (`material_pos_sessao`, `maxTokens 4000`) ou modelo puro
  sem IA quando não há dor.
- Aprovação: `aprovar_material_gerado` (`0031:268-297`), `aprovado_em`,
  `MaterialAba.tsx`, aviso na emissão de link sem aprovação (feito 04/09).
- Entrega: régua `pos_sessao` só reivindica com material aprovado
  (`0031:502-523`), link `/p/m` mintado no envio (`processar.ts:80-99`),
  página `MaterialPublico.tsx` = HTML + `window.print()`.
- Storage: bucket privado `documentos-sensiveis` (`0012:540-543`), mime
  `application/pdf` permitido, upload só por service_role.

### 3.2 Decisão: `pdfkit` no servidor

| Opção | Prós | Contras | Veredito |
|---|---|---|---|
| `@react-pdf/renderer` | JSX, layout flex | reconciliador React próprio + yoga (wasm) + fontkit — pesado, compatibilidade com React 19/Next 16 é risco de build na Hostinger; nova classe de bug "roda local, quebra em prod" | não |
| HTML→PDF via n8n | zero dependência aqui | dependência externa para **todo** material, pendência de config a mais, latência de rede, e o n8n precisaria de um serviço de PDF (Gotenberg/API) que a casa não tem | não |
| Chrome headless | fidelidade ao HTML | não garantido na Hostinger; ~300 MB | não |
| **`pdfkit`** | pura-JS, uma dependência, 4 tipos de bloco cabem em ~150 linhas, `fontkit` embutido lê WOFF2 (`public/fonts/TBJNeuetra-*.woff2`), streams para Buffer | tipografia manual (sem CSS) — aceitável: o material é texto corrido | **sim** |

`package.json` recebe **só** `pdfkit` (+ `@types/pdfkit` em dev). Um único
agente (C) edita `package.json` nesta fase (armadilha do lockfile no Windows:
`npm ci` e commit do lockfile, nunca `npm install` solto).

### 3.3 Desenho

**`src/server/material/pdf.ts`** — `gerarPdfMaterial({titulo, blocos,
primeiroNome, aprovadoEm, assinatura}) → Buffer`. Layout: A4, margens 56pt,
Neuetra 400/700 (fallback Helvetica se o registro da fonte falhar — **loga
`registrarErro` e segue**, nunca derruba a aprovação por causa de fonte),
cabeçalho "Time Holding Brasil · Dra. Elaine Montenegro", rodapé com página e
"material informativo, não constitui parecer jurídico" (texto em
`configuracoes['material.rodape_juridico']`, editável — B14). Blocos:
`titulo` → 16pt bold; `paragrafo` → 11pt; `lista` → bullets; `citacao` →
itálico com filete lateral laranja `#ff7400`. Sem imagem, sem tabela.

**Quando gera.** **Na aprovação, e só nela.** `POST /api/jornadas/[id]/material/
[materialId]/aprovar` (existe) passa a: RPC `aprovar_material_gerado` →
`gerarPdfMaterial` → upload service_role em
`documentos-sensiveis/materiais/{jornada_id}/{material_id}.pdf` → RPC
`registrar_pdf_material(p_material_id, p_caminho, p_bytes, p_sha256)`
(service_role). Falha no PDF **não desfaz** a aprovação: grava
`pdf_erro`, a tela mostra "Aprovado; PDF falhou: <motivo> — tentar de
novo", botão de regerar. Rascunho **nunca** vira arquivo — é a regra da OAB
em forma de ausência de caminho de código.

```sql
-- 0055_material_pdf_e_catalogo.sql
alter table materiais_gerados
  add column pdf_caminho text, add column pdf_bytes bigint check (pdf_bytes > 0),
  add column pdf_sha256 text, add column pdf_gerado_em timestamptz, add column pdf_erro text;
-- Invariante: PDF só existe em material aprovado.
alter table materiais_gerados add constraint ck_pdf_exige_aprovacao
  check (pdf_caminho is null or aprovado_em is not null);
-- Catálogo por dor/arquétipo (F3.4)
alter table materiais_modelos
  add column descricao text,
  add column dores text[] not null default '{}',        -- palavras-chave da dor (o regex de hoje vira dado)
  add column arquetipos text[] not null default '{}',   -- 'protetor','construtor','sucessor',... (lista do Protocolo 03, só as que a Dra. Elaine confirmar — nasce vazio)
  add column prioridade smallint not null default 100;
update materiais_modelos set dores = case chave
  when 'empresa' then '{empresa,sócio,negócio}' when 'inventario' then '{inventário,herdeiro,herança,partilha,sucessão}'
  when 'conflito_familiar' then '{conflito,desentendimento,briga,divergência}' when 'itcmd' then '{itcmd,itbi,tributo,imposto}' else '{}' end;
-- (backfill só copia o que o regex de material.ts:117-122 já fazia — não reclassifica material gerado)
create or replace function public.registrar_pdf_material(p_material_id uuid, p_caminho text, p_bytes bigint, p_sha256 text) ... service_role
```

**Entrega.** E-mail `pos_sessao` v2: corpo com `{{link_material}}` (já) **e
anexo PDF** quando `configuracoes['material.anexar_pdf']=true` (default true).
`enviarEmail()` ganha `anexos?: [{nome, conteudoBase64}]` (Resend aceita
`attachments`). O anexo é lido do Storage no envio (service_role, signed
download interno). Página `/p/m` ganha o botão **"Baixar PDF"** →
`GET /api/publico/[token]/material.pdf` (valida via `abrir_link_publico`,
depois `createSignedUrl(300s)` e `302`). `window.print()` continua como
fallback quando não há PDF (material aprovado antes desta fase).

### 3.4 Catálogo por dor/arquétipo e escolha automática

`classificarChaveModelo()` deixa de ser regex hardcoded e vira
`escolherModeloMaterial(modelos, sinais)` — **função pura, zero IA**:

```
sinais = { dorPrincipal (cascata de hoje), arquetipo (briefings.conteudo.arquetipo_patrimonial.predominante, se houver),
           preocupacaoPredominante (relatorio), riscos (croqui_analises atual v2: riscos[].texto, se houver) }
pontuação por modelo = 3×(match de `dores` na dor principal) + 2×(match em arquetipos) + 1×(match em preocupação/riscos)
empate → menor `prioridade`; nenhuma pontuação → 'padrao'.
```

Grava `materiais_gerados.motivo_modelo jsonb` (`{pontos, casou_em:[...]}`) —
a tela mostra "Modelo escolhido: Inventário (casou em: dor principal)". Nunca
apresenta a escolha como análise. Admin → **Modelos de material** (aba nova,
`materiais_modelos` já tem policy `mmo_wr` admin): editar conteúdo/dores/
arquétipos, versão nova = INSERT + ativar (`uniq_material_modelo_ativo`).

**Personalização "conclusão da sessão".** A entrada da IA ganha
`conclusao_sessao` = `relatorios_sessao.resultado_sessao` +
`consideracoes_apresentacao_croqui` (só se preenchidos) e, se existir análise
v2 atual, `resumo_executivo`. Medir bytes antes/depois no `execucoes_ia.tokens_entrada`
de uma execução real; teto: se a entrada passar de 6 000 tokens, cortar
`resumo_executivo`. **Continua sendo uma chamada.**

### 3.5 Custo de IA

Inalterado: 1 chamada `material_pos_sessao` por material (0 quando sem dor).
Entrada cresce ≤ ~800 tokens (≈ US$ 0,0016). Sem cache, sem loop.

### 3.6 Config pendente

| Onde | Texto |
|---|---|
| Ficha → Material | "PDF gerado na aprovação. Sem `RESEND_API_KEY` o e-mail não sai; o link `/p/m` e o botão 'Baixar PDF' continuam funcionando." |
| Ficha → Material (fonte) | "Fonte Neuetra não carregou no servidor — PDF saiu em Helvetica. Ver `erros_servidor`." (só quando acontecer) |

---

## 4. F4 · Croqui rico em dados + Diagnóstico da SV (plano reconstruído)

### 4.1 O que existe e as três premissas falsas (confirmadas no código)

- **Prompt v2 do `agente_croqui_analise` nunca foi publicado.** `0042` só tem
  `protocolo_01_briefing` (`grep -n "chave" 0042` → uma chave). O contrato v2
  existe (`croqui/schema-analise-v2.ts`) e `mapeamentoGraficos.ts:29-39` detecta
  versão pela forma; `croqui-analise.ts:3,65,71` ainda usa `CroquiAnaliseSchema`
  v1 e grava `schema_versao` default 1. Toda análise real é v1: sem alocação,
  sem 13 slides tipados, zero número.
- **Slide "economia" é `null` hardcoded** — `GraficoDoSlide.tsx:135-141`.
- **Preço do croqui é constante TS** — `types/roteiro.ts:126-127`, consumido em
  `ofertas/route.ts:10-11,128,141` e `PainelOferta.tsx:7-8,21`.
- `relatorios_sessao.tributos` é `jsonb` livre (`0008:614`) e
  `ideia_custo_inventario` é texto (`0008:605`); `RelatorioAba.tsx:399-424` edita
  `tributos[secao][campo]` como texto.

### 4.2 `parametros_metodo` — versionado como `prompts_versoes` (0056, agente D)

```sql
create table parametros_metodo (
  id           uuid primary key default gen_random_uuid(),
  chave        text not null,          -- 'itcmd.uf.SP' | 'itbi.municipio.<ibge>' | 'honorarios.croqui.padrao' | 'honorarios.croqui.incentivo' | 'parcelamento.croqui' ...
  versao       smallint not null,
  valor        jsonb not null,         -- {"aliquota": 4, "tipo": "percentual", "moeda": "BRL"} | {"valor": 7200} | {"parcelas_max": 3, "juros": 0}
  base_legal   text,                   -- lei/decreto/URL — obrigatório para chaves itcmd.*/itbi.* (check abaixo)
  vigente_desde date not null default current_date,
  ativo        boolean not null default false,
  notas        text,
  criado_em    timestamptz not null default now(), criado_por uuid references perfis_equipe(id),
  unique (chave, versao),
  constraint ck_tributo_exige_base_legal check (chave not like 'itcmd.%' and chave not like 'itbi.%' or base_legal is not null)
);
create unique index uniq_parametro_ativo on parametros_metodo (chave) where ativo;
-- RLS: select eh_interno; insert/update eh_admin (versão nova = INSERT + ativar; nunca UPDATE de valor de versão ativa — trigger recusa)
-- SEED (B27): honorarios.croqui.padrao = {"valor":7200}, honorarios.croqui.incentivo = {"valor":4500}, ativos, notas 'literal do script PARTE 11'.
-- SEED (B30): NENHUMA linha itcmd.*/itbi.* — tabela nasce vazia; Admin → Parâmetros preenche com base legal. Nunca inventar alíquota.
create or replace function public.parametro_vigente(p_chave text) returns parametros_metodo ... security invoker, grant authenticated
create or replace function public.ativar_parametro_metodo(p_id uuid) ... (mesmo padrão de ativar_prompt_versao, 0033:119-143)
```

`VALOR_PADRAO_CROQUI`/`VALOR_INCENTIVO_RESOLVEDOR_CROQUI` **saem do
TypeScript**: `ofertas/route.ts` lê `parametro_vigente('honorarios.croqui.*')`;
`GET /api/parametros-metodo?chaves=a,b` (interno) alimenta `PainelOferta.tsx`
via `components/sessao/api.ts`. Sem parâmetro ativo → 409 `parametro_ausente`
com nome da chave; a tela mostra `<SeloStub>`. `types/roteiro.ts` perde as
duas constantes (agente D).

### 4.3 Cenário Patrimonial — procedência por rubrica (0057, agente D)

```sql
create type procedencia_valor as enum ('calculado','digitado','ausente');
create table cenarios_patrimoniais (
  id            uuid primary key default gen_random_uuid(),
  jornada_id    uuid not null references jornadas(id) on delete cascade,
  cenario       text not null check (cenario in ('inventario','doacao_em_vida','holding_1_celula','holding_2_celulas','holding_3_celulas')),
  rubrica       text not null,                 -- 'itcmd','itbi','custas_cartorio','honorarios_advocaticios','honorarios_croqui','honorarios_holding','manutencao_anual', ...
  procedencia   procedencia_valor not null default 'ausente',
  valor         numeric(15,2) check (valor >= 0),
  base_calculo  numeric(15,2) check (base_calculo >= 0),
  aliquota      numeric(7,4) check (aliquota >= 0),
  parametro_id  uuid references parametros_metodo(id),   -- carimbo: QUAL versão de alíquota foi usada
  nota          text,
  atualizado_em timestamptz not null default now(), atualizado_por uuid references perfis_equipe(id),
  unique (jornada_id, cenario, rubrica),
  -- B26 no banco: 'calculado' exige base + alíquota + parâmetro; 'digitado' exige valor; 'ausente' exige valor nulo.
  constraint ck_procedencia check (
    (procedencia = 'calculado' and base_calculo is not null and aliquota is not null and parametro_id is not null and valor is not null)
    or (procedencia = 'digitado' and valor is not null)
    or (procedencia = 'ausente' and valor is null)
  )
);
-- trigger BEFORE: quando procedencia='calculado', valor := round(base_calculo * aliquota / 100, 2) — o único cálculo, e só com os 3 insumos humanos.
-- RLS: select/insert/update ve_patrimonio (mesmo recorte de relatorios_sessao). Sem delete: zerar = procedencia 'ausente'.
create view vw_cenarios_totais with (security_invoker = true) as
select jornada_id, cenario,
       case when bool_or(procedencia = 'ausente') then null else sum(valor) end as total,   -- total só quando nada falta
       count(*) filter (where procedencia = 'ausente') as rubricas_ausentes,
       bool_or(procedencia = 'calculado') as tem_calculado
  from cenarios_patrimoniais group by jornada_id, cenario;
```

Rota `GET/PUT /api/jornadas/[id]/cenario` (agente D). Tela: aba **Cenário**
dentro do Relatório (não aba nova na Ficha — gaveta "Cenário Patrimonial" com
uma grade `rubrica × cenário`, cada célula com selo `calculado|digitado|ausente`
e, no `calculado`, a alíquota e a versão do parâmetro em tooltip). Regra de
tela: **total só aparece quando não há rubrica ausente**; caso contrário "faltam
N rubricas". B28: `tributos` texto não é convertido; a gaveta oferece "copiar
para o cenário" campo a campo, com a advogada digitando o número.

### 4.4 Prompt v2 do `agente_croqui_analise` (0059, agente E) e números

A IA **não calcula nem inventa valor**. O que a v2 acrescenta de numérico é
**extração de valor declarado na transcrição**, carimbado como fato declarado:
`patrimonio[]` (já `AfirmacaoSchema`) ganha `valor_declarado: number | null`
(só quando o cliente disse um número; senão `null`). Isso é um `anyOf` na
gramática — **medir com a sonda antes de publicar** (§4.6). Na tela, cada
valor declarado tem o botão "usar como valor de mercado deste bem" → grava em
`patrimonio_itens.valor_mercado` **como digitado por humano** (`origem_valor='transcricao'`,
coluna nova), nunca automaticamente. Só então o slide de patrimônio desenha.

`croqui-analise.ts` passa a usar `CroquiAnaliseV2Schema` quando o prompt ativo
tem `versao >= 2` (lê `prompts_versoes.esquema_saida`/`versao`) e grava
`p_schema_versao := 2`. v1 fica preservada, inativa. Orçamento de escrita no
prompt, nunca `.max()` no Zod (lição da Fase 3 §1.4).

### 4.5 Slide "economia" e demais gráficos

`GraficoDoSlide.tsx` caso `economia`: lê `vw_cenarios_totais` (novo campo
`Ficha360.cenarios` ou `GET /api/jornadas/[id]/cenario`) — `custoInventario =
total('inventario')`, `custoEstrutura = total('holding_<recomendação da análise>')`;
qualquer um `null` → `<GraficoIndisponivel>` nomeando as rubricas ausentes
(fora do modo apresentação). Legenda carimba: "valores digitados pela advogada
em DD/MM; ITCMD calculado com alíquota X% (parâmetro vY)". Células/controle
passam a desenhar `analise.arquitetura.alocacao` quando `schema_versao=2`.

### 4.6 Sonda generalizada

`POST /api/admin/sonda-schema` (`sonda-schema/route.ts`) hoje só testa
`BriefingSchema`. Ganha `{schema: 'briefing'|'croqui_v2'|'material'}` e usa o
mesmo `paraJsonSchemaEstrito`. **Regra de publicação**: nenhum `INSERT` de
prompt com `esquema_saida` entra em migration sem o resultado da sonda colado
no comentário da migration (bytes + "compilou"). Teto conhecido: 3 905 bytes
compila, 4 428 não — para o **briefing**; o croqui v2 tem o próprio teto, a
descobrir com a sonda.

### 4.7 Diagnóstico da SV como peça apresentável (0058, agente D)

**Conceito.** O Diagnóstico é a **peça anterior ao Croqui**: o que a advogada
apresenta ao cliente logo depois da SV, antes de ele contratar o croqui.
Deriva de dados que já existem — não é IA nova.

```sql
create table diagnosticos_sv (
  id            uuid primary key default gen_random_uuid(),
  jornada_id    uuid not null references jornadas(id) on delete cascade,
  versao        smallint not null,
  analise_id    uuid references croqui_analises(id),     -- de onde os blocos de texto vieram (se houver)
  blocos        jsonb not null,                            -- [{chave, titulo, conteudo, pontos[], fontes[], categoria}] — mesmo vocabulário dos slides
  visibilidade  jsonb not null default '{}'::jsonb,        -- {chave: true} — B31: default TUDO OCULTO; só o que a advogada marcar
  atual         boolean not null default true,
  aprovado_por  uuid references perfis_equipe(id), aprovado_em timestamptz,
  criado_em     timestamptz not null default now(), criado_por uuid references perfis_equipe(id),
  unique (jornada_id, versao), constraint ck_diag_aprov check ((aprovado_em is null) = (aprovado_por is null))
);
create unique index uniq_diagnostico_atual on diagnosticos_sv (jornada_id) where atual;
-- RLS: select/insert/update ve_patrimonio. Trigger de timeline tipo 'diagnostico'.
```

Blocos (fixos, 7): `situacao_familiar` (familiares), `mapa_patrimonial`
(patrimônio + empresas CNPJ), `riscos_identificados` (análise v2 `riscos`),
`cenario_patrimonial` (grade do §4.3 — só rubricas não ausentes),
`arquitetura_recomendada` (análise `arquitetura.recomendacao` + critérios),
`proximos_passos` (implementação), `o_que_falta` (rubricas ausentes /
documentos — **sempre oculto ao cliente**). `POST /api/jornadas/[id]/diagnostico`
monta os blocos por **função pura** `montarDiagnostico(ficha, analise, cenarios)`
(`src/server/diagnostico/montar.ts`) — zero IA. Tela: `/jornadas/[id]/diagnostico/[id]/apresentar`
reusa `ModoApresentacao` (agente I adapta o componente para receber `slides`
genéricos + `notasApresentador`), renderizando **só blocos com `visibilidade[chave]=true`**;
a tela de edição tem o toggle por bloco com o texto "Visível ao cliente na
apresentação". Sem link público nesta fase (B31 — fica em backlog). Pasta do
Cliente: `diagnostico_sv` deixa de ser `ainda_nao` fixo (`derivar.ts:103`) e
passa a derivar de `Ficha360.diagnosticoAtual` (agente A adiciona ao payload,
mesmo padrão de `materialAtual`).

### 4.8 Defaults B26–B32 adotados (registro)

| # | Default adotado neste plano |
|---|---|
| B26 | Sem cálculo automático de imposto. `calculado` só com base + alíquota + parâmetro carimbado, digitados por humano. Trigger faz a multiplicação e nada mais. |
| B27 | 7 200 / 4 500 semeados em `parametros_metodo`, editáveis em Admin; constantes TS removidas. |
| B28 | `tributos` texto permanece; cenário nasce `ausente`. Sem backfill. |
| B29 | Membership fora. Nenhuma tabela. |
| B30 | `itcmd.*`/`itbi.*` nascem vazios; Admin → Parâmetros exige `base_legal`. |
| B31 | `visibilidade` default `{}` (tudo oculto); só Modo Apresentação interno; sem link público. |
| B32 | Microprocessos derivados (F6), sem tabela de estado. |

### 4.9 Custo de IA

- Prompt v2 do croqui: **+saída** (13 slides tipados + alocação + `valor_declarado`)
  — a Fase 3 já contabilizou que isso **elimina** a segunda chamada análise→slides.
  Estimativa honesta: de ~US$ 0,05 (v1, Sonnet, low) para US$ 0,07–0,09 por
  análise, **a medir na bancada** (`scripts/bancada-ia.ts` já aceita `versaoPrompt`).
- Diagnóstico, cenário, parâmetros: **zero IA**.

### 4.10 Config pendente

| Onde | Texto |
|---|---|
| Admin → Parâmetros | "Nenhuma alíquota de ITCMD cadastrada. O sistema não calcula imposto sem uma alíquota com base legal registrada aqui pela Dra. Elaine." |
| Ficha → Cenário | "Rubrica sem valor: digite o valor, ou informe base e alíquota para o sistema multiplicar (a alíquota vem de Admin → Parâmetros)." |

---

## 5. F5 · Briefing "modelo do Juliano" — todas as fontes

### 5.1 O que entra hoje (`contexto-briefing.ts:507-666`) e o que não entra

| Fonte | Hoje | Gap |
|---|---|---|
| Identificação, origem, faixa etária | entra (`:602-615`) | — |
| Formulário estratégico (POP 02) | entra, sem p1/p2 (`:488-498`) | — |
| Patrimônio (faixa, tipos, bucket de imóveis) | entra (`:619-625`) | valor nunca (correto) |
| Família (contagens, parentescos) | entra (`:626-633`) | — |
| Ligação estratégica: respostas, expectativa, preocupação, objeções, ritmo, estilo, sinais, frases marcantes, decisório | entra (`:634-649`) | `respostas` duplica campos nomeados (L7 da Fase 3) — bytes à toa |
| Transcrição da ligação humana | entra sob `tratamento_ia` (`:589-598`) | — |
| **Respostas das pesquisas do seminário** | **não entra** — não existe tabela; `importacoes` só mapeia campos cadastrais (`importacao/campos.ts:5-14`) | criar |
| **Participação no seminário (dias assistidos)** | não entra — `participacoes_seminario.dias_assistidos` existe (`0035:240`) | ligar |
| **Pesquisa em fonte pública** | **não pode entrar**: `pesquisas_publicas.entra_no_briefing` tem `check (entra_no_briefing = false)` (`0036:94`) — decisão jurídica B4 | fica fora; nenhum código |
| **CNPJ (`consultas_cnpj`, 0044)** | não entra | ligar: razão social, CNAE, capital em faixa, nº de sócios; `qsa` (nomes) **só** sob `tratamento_ia` (C20) |
| **Transcrição da ligação IA (F2)** | não existe | mesma posição da transcrição humana: sob `tratamento_ia` |
| **Forma como fala / palavras que usa** | `sinais`, `frases_marcantes`, `ritmo`, `estilo_resposta` entram; a **saída** não tem seção de linguagem literal | schema: seção `linguagem_do_cliente` |

### 5.2 Desenho (agente E)

**`0059_respostas_seminario_e_prompts.sql`**

```sql
create table respostas_seminario (
  id            uuid primary key default gen_random_uuid(),
  pessoa_id     uuid not null references pessoas(id) on delete cascade,
  edicao_id     uuid not null references edicoes_seminario(id),
  pergunta      text not null check (length(pergunta) between 1 and 300),
  resposta      text not null check (length(resposta) between 1 and 2000),
  origem        text not null default 'importacao' check (origem in ('importacao','manual')),
  importacao_id uuid references importacoes(id),
  origem_dado   text not null default 'real' check (origem_dado in ('real','exemplo')),
  criado_em     timestamptz not null default now(),
  unique (pessoa_id, edicao_id, pergunta)
);
-- RLS: select eh_interno; insert eh_interno (importação e manual); sem update/delete (histórico).
```

**Importação.** `MapeamentoColunas.tsx`/`campos.ts` ganham o destino
**"Pergunta do seminário: <cabeçalho>"** para qualquer coluna não mapeada a
campo cadastral (agente I no front; agente E em `processarImportacao.ts` +
`confirmar_importacao` grava `respostas_seminario` por linha). Nada muda para
quem já importou.

**Contexto.** `ContextoBriefing` ganha:

```ts
seminario: { edicao_codigo, dias_assistidos: number | null, respostas: Array<{pergunta, resposta}> } | null   // até 12 respostas, 400 chars cada
empresas: Array<{ razao_social, cnae_descricao, capital_social_faixa, socios_quantidade, socios?: string[] /* só com tratamento_ia */ }>
ligacao_ia: { resumo, transcricao /* só com tratamento_ia */ } | null
```

e **remove** `ligacao.respostas` quando os campos nomeados já cobrem (L7):
`respostas` só entra com as chaves que não têm coluna própria. **Medir**:
`JSON.stringify(contexto).length` antes/depois em 3 fixtures da bancada,
registrado no comentário da migration. Meta: entrada não cresce mais de 25 %
com todas as fontes presentes.

**Schema de saída** (`schema-briefing.ts`) — seção nova, **strings e arrays,
zero enum** (lição de 04/09):

```ts
linguagem_do_cliente: z.object({
  palavras_repetidas: z.array(z.string()),      // literais, até 8 (prompt)
  expressoes_literais: z.array(z.string()),     // frases curtas como ele fala, até 5 — cada uma verificada por fidelidade.ts
  registro: z.string(),                          // 1 frase: formal/coloquial, técnico/prático, direto/narrativo
})
```

Três campos ≈ +180 bytes de schema. **Obrigatório rodar a sonda** (`POST
/api/admin/sonda-schema {schema:'briefing'}`) e colar o resultado na 0059
antes de ativar a v3 do prompt. Se estourar: `palavras_repetidas` e
`expressoes_literais` viram uma string só separada por `;` (o consumidor
divide). `fidelidade.ts` estende a verificação de `frase_literal` às
`expressoes_literais` (custo zero). Tela: `BriefingAba` e o painel lateral do
Conduzir mostram "Como ele fala" como chips (agente I).

### 5.3 Custo de IA

**Nenhuma chamada nova.** A mesma execução de `protocolo_01_briefing` recebe
contexto maior (+≤25 % de entrada ≈ +US$ 0,002) e escreve uma seção a mais
(~150 tokens ≈ +US$ 0,0015). Estimativa: de US$ 0,040 para ≤ US$ 0,045 por
briefing, **a confirmar na bancada** com `variante='v3_fontes'`.

---

## 6. F6 · Clareza operacional — uma fonte para "próximo passo e de quem é"

### 6.1 O que existe (quatro fontes, quatro vocabulários)

| Fonte | Onde | Vocabulário |
|---|---|---|
| `derivarPasta(ficha)` | `lib/pasta/derivar.ts:40-160` | 14 itens, 4 estados, `nota` humana |
| `calcularPendencias(ficha)` | `components/ui/pendencias.ts` — **órfão** desde a Fase 2 da Pasta (page.tsx não importa mais) | 5 itens |
| `vw_pendencias_preparo` | `0034:50-83` | `falta_formulario/ligacao/briefing` só com sessão em 7 dias |
| `vw_jornada_kanban` | `0023` | `tem_formulario/ligacao/briefing`, `proxima_sessao_em` |
| Painel bloco "Travado" | `vw_pendencias_sistema` | tipos de sistema |

`CabecalhoFicha` já usa `derivarPasta` para o chip "Próxima ação"
(`lib/pasta/rotas.ts` mapeia item → aba). Nenhuma superfície diz **de quem** é.

### 6.2 Desenho (agente F, `src/lib/pasta/**`)

**Uma função pura, um contrato de sinais.**

```ts
// lib/pasta/sinais.ts
export interface SinaisJornada {
  etapa; nivelPago; temFormulario; temLigacao; temBriefing;
  proximaSessaoEm: string | null; presencaConfirmadaEm: string | null; sessaoRealizadaEm: string | null;
  temRelatorio; croquiStatus: 'rascunho'|'pronto'|'apresentado'|null; materialEstado: 'nenhum'|'rascunho'|'aprovado';
  temDiagnostico; ligacaoIaStatus: string | null; tarefasAbertas: Array<{tipo, responsavelPapel}>;
}
export function sinaisDaFicha(ficha: Ficha360): SinaisJornada        // Ficha 360
export function sinaisDoKanban(linha: JornadaKanban): SinaisJornada   // vw_jornada_kanban (0052 acrescenta as colunas que faltam)
export function sinaisDaSessaoDoDia(linha): SinaisJornada             // painel/agenda (parcial: campos ausentes = null, nunca inventados)

// lib/pasta/proximo-passo.ts
export interface ProximoPasso { chave: ChaveItemPasta | 'confirmar_presenca' | 'enviar_link_croqui' | 'colar_link_sala' | 'aguardar_cliente';
  rotulo: string; deQuem: 'relacionamento'|'advogada'|'cliente'|'sistema'; urgencia: 'hoje'|'esta_semana'|'quando_der'; abaId?: string; }
export function derivarProximoPasso(s: SinaisJornada): ProximoPasso | null
```

Ordem de precedência (a primeira que casar): pagou e sem ligação →
`ligacao` (relacionamento, hoje) · sessão em < 7 d sem presença confirmada →
`confirmar_presenca` (cliente; ação da equipe: "reforçar por WhatsApp") ·
sessão em < 24 h sem `link_sala` → `colar_link_sala` (relacionamento, hoje) ·
sem formulário → `formulario` (cliente) · sem briefing e sessão marcada →
`briefing` (sistema/advogada) · sessão realizada sem relatório → `relatorio_sv`
(advogada) · relatório sem material → `material` (sistema) · material
rascunho → aprovar (advogada) · tarefa `enviar_link_croqui` aberta →
`enviar_link_croqui` (advogada) · croqui pago sem documentos → `documentos`
(cliente) · … Catálogo ganha `deQuem` por item (`catalogo.ts`).

**Consumo sem fetch novo.** Esteira: `CartaoJornada` chama
`derivarProximoPasso(sinaisDoKanban(linha))` — a view já vem no `GET
/api/jornadas` que a tela carrega. Painel: `SessoesHoje`/`PreparoPendente`
mostram o mesmo chip a partir das views (0052 acrescenta
`presenca_confirmada_em` a `vw_sessoes_do_dia`). Agenda: `LinhaAgendamento`
idem. Ficha/Pasta: `sinaisDaFicha`. **Um texto, uma cor, um "de quem" em toda
tela.** `components/ui/pendencias.ts` é órfão e pertence à fronteira do outro
time — **não é tocado**; registrado como CONFLITO C27 para eles apagarem.

### 6.3 Onboarding leve — decisão: coluna, não `localStorage`

`perfis_equipe.onboarding_visto_em timestamptz` (0052). Motivo: a Dra. Elaine
troca de aparelho/navegador; `localStorage` reapresentaria o tour a cada
máquina, e "dispensei" é um fato sobre a pessoa, não sobre o navegador.
`GET /api/equipe` hoje só lista a equipe (`api/equipe/route.ts:15-24`, sem
`/me`). Rota **nova** `GET/PATCH /api/equipe/me` (agente A): `GET` devolve
`{id, nome, papel, onboarding_visto_em}` do próprio perfil; `PATCH
{onboarding_visto: true}` grava `now()` — policy `pe_select`/update do próprio
`auth_user_id` (verificar `0002:24-26`; se não houver update de si mesmo, RPC
`marcar_onboarding_visto()` `security definer` restrita a `auth.uid()`). Front (agente F): `components/onboarding/TourPrimeiraVez.tsx`
consome `ui/Gaveta` com 8 passos (um por item do menu de `Nav.tsx:35-42`),
texto humano de 2 linhas por área, botão "Entendi, não mostrar de novo" e
"Depois". Reabrir: item "Como funciona" na paleta de comandos — **pertence ao
outro time**; aqui só a rota `/painel?tour=1` que abre a gaveta.

### 6.4 Custo de IA

Zero.

---

## 7. CONFLITO

| # | Conflito | Consequência | Encaminhamento |
|---|---|---|---|
| **C23** | **`status='confirmado'` já significa "cliente escolheu o horário" (link público), não "cliente confirmou presença".** | Usar o enum para a confirmação D-7 mudaria o significado de dado existente e tocaria índice único, exclusão GiST, trigger da régua e 3 views. | Coluna `presenca_confirmada_em` (§1.2). Enum intocado. Rótulos na tela: "Horário marcado" / "Presença confirmada". |
| **C24** | **`{{link_sala}}` renderizado no enfileiramento × link colado à mão depois (B10).** | E-mail do dia da sessão sai com link vazio — bug latente, ainda não mordeu porque a régua nunca rodou. | Placeholder resolvido no envio + hold na reivindicação + pendência `sessao_sem_sala` (§1.3). |
| **C25** | **`alter type add value` + uso no mesmo arquivo.** | Migration falha inteira com `unsafe use of new value`. | `0050` só com o enum; uso a partir da `0051`. |
| **C26** | **Três caminhos gravam `agendamentos`** (RPC pública, insert direto da equipe, PATCH em dois passos). A ligação IA seria o quarto. | Regra "só entre horários ofertados", "nunca sem pagamento" e remarcação atômica existem só na RPC pública. | Núcleo `app.confirmar_horario_da_sugestao` (§2.3). Nesta fase, o caminho da equipe **continua** (não é sugestão de link) — registrado para a Fase 5 migrar `POST /api/jornadas/[id]/agendamentos` para uma RPC irmã `agendar_pela_equipe`. |
| **C27** | **`components/ui/pendencias.ts` é órfão e está na fronteira do outro time.** | Este plano cria a fonte única (`proximo-passo.ts`) e não pode apagar a antiga. | Registrado para o time visual apagar; nenhum agente daqui importa o arquivo. |
| **C28** | **Chatwoot não assina webhooks.** | "Fail-closed com HMAC" não é possível literalmente. | Segredo na URL comparado em tempo constante + allowlist de evento + rate limit + registro de tentativa inválida (§2.5). É o mesmo nível do `hottok` da Hotmart. |
| **C29** | **`pesquisas_publicas.entra_no_briefing` tem `check (= false)`** (0036:94). | "O briefing absorve TODAS as fontes" contradiz uma trava jurídica no banco. | Fica fora (B4). O plano não toca o check. |
| **C30** | **`reivindicar_mensagens_pendentes` muda de assinatura** (canais) e já foi recriada na 0031 com a mesma assinatura. | `create or replace` com parâmetro novo cria sobrecarga (armadilha 6). | `drop function public.reivindicar_mensagens_pendentes(int)` explícito na 0051. |
| **C31** | **Ligação por IA à revelia** × consentimento (LGPD) — a Vapi é subprocessador novo de voz. | Ligar automaticamente após o pagamento sem decisão jurídica. | `ligacao_ia.automatica` default **false**; botão manual na Ficha sempre disponível; transcrição só entra na IA sob `tratamento_ia`. Ver B33. |
| **C32** | **PDF no servidor × tipografia do seminário.** | pdfkit não lê CSS; a fonte precisa ser registrada por arquivo. | Neuetra via `fontkit` (WOFF2) com fallback Helvetica logado; identidade = cor de marca + hierarquia, não CSS. |
| **C33** | **Prompt v2 do croqui aumenta a saída paga** × meta de custo da Fase 3. | Análise fica ~50 % mais cara. | Elimina a segunda chamada análise→slides (já argumentado na Fase 3 §3.2). Medido na bancada antes de ativar (B22 vale). |

---

## 8. BLOQUEIO — e o caminho padrão que os agentes seguem hoje sem esperar

| # | Bloqueio | **Caminho padrão adotado** | O que muda se decidirem diferente |
|---|---|---|---|
| **B33** | **Ligação por IA automática após o pagamento** — subprocessador de voz (Vapi) + gravação sem consentimento prévio registrado. | `ligacao_ia.automatica=false`. A equipe dispara pelo botão na Ficha; o texto de boas-vindas v2 avisa "nossa assistente virtual pode ligar para agendar". Transcrição da IA só entra no briefing sob `tratamento_ia`. | `UPDATE configuracoes SET valor='true'` liga a automação. Sem deploy. |
| **B34** | **Quem confirma presença pela equipe vale como confirmação do cliente?** (fallback WhatsApp manual) | Sim, com `via='equipe'` carimbado e nome de quem marcou na timeline. Nunca se apresenta como "o cliente confirmou pelo link". | Remover o botão da tela; a coluna continua. |
| **B35** | **Anexar o PDF no e-mail** (peso, entregabilidade, LGPD do anexo em caixa de terceiro) ou só link `/p/m` (expira, auditável)? | Ambos, com `material.anexar_pdf=true`. O link é auditável; o anexo é o que o cliente leigo espera. | `UPDATE configuracoes` para `false`. |
| **B36** | **Lista de arquétipos para o catálogo de materiais** — Protocolo 03 enumera, mas ninguém confirmou quais a Dra. Elaine usa. | `materiais_modelos.arquetipos` nasce vazio; a escolha usa só `dores` (o que o regex já fazia). | INSERT/UPDATE em Admin → Modelos de material. |
| **B37** | **Rubricas do Cenário Patrimonial** — o conjunto de linhas (ITCMD, ITBI, custas, honorários, manutenção anual…) vem da planilha do Marcio, não do repo. | 7 rubricas semeadas como **chaves de UI** (não como valores), todas `ausente`; a advogada adiciona rubrica livre. | INSERT em `configuracoes['cenario.rubricas']`. |
| **B38** | **Texto do assistente de voz** (script da ligação) — a Dra. Elaine não escreveu POP para a ligação IA. | POP 01 adaptado (§2.7): explicar a SV em uma frase, oferecer melhor horário, alternativas, confirmar, avisar da ligação humana de 5 min. Vive no n8n/Vapi, editável sem deploy. | Editar o assistente na Vapi. |
| **B39** | **Retenção de gravação/transcrição da ligação IA** (B19 estendido). | Guarda `gravacao_url` (externa, na Vapi) e `transcricao` no banco sob RLS; sem expurgo. | Mesma política de B19 quando existir. |

**Nenhum bloqueio reclassifica pessoa, muda faixa, papel, etapa ou apaga
histórico. Toda migration é aditiva; toda reversão é `drop column`, `drop
function`, `drop policy`, recriar view pelo texto anterior ou `UPDATE ativo`.**

---

## 9. Plano de execução em ondas — fronteiras de arquivo DISJUNTAS

**Regras que valem para todas as ondas**

1. **Travados para todos**: `src/app/globals.css`, `src/components/ui/**`,
   `src/components/shell/**`, `src/app/login/**`, `src/components/comandos/**`
   (outro time); `src/lib/api.ts` (desde a Fase 3 — cliente novo vai em módulo
   por feature: `src/components/<area>/api-*.ts`); `brain/`, `CONTINUAR-AQUI.md`.
2. **Cada migration tem dono único**, numerada abaixo. Ninguém cria número fora do seu.
3. **`package.json`/`package-lock.json`**: só o agente **C**, uma vez, `npm ci` depois.
4. **`src/types/**`**: um arquivo por dono, listado; tipo novo compartilhado
   entre agentes vai em arquivo novo do dono do backend correspondente.
5. Validação por agente: `npx tsc --noEmit` + `npx eslint <arquivos>`.
   **Nunca `npm run build`.** Migrations: escrever + roteiro de verificação em
   comentário; não presumir aplicadas.
6. Contratos entre agentes da mesma onda estão **neste documento** (assinaturas
   de RPC, rotas, formas de JSON). Quem precisar mudar contrato avisa o orquestrador.

### ONDA 1 — 6 agentes em paralelo (fundação: banco + servidor + função pura)

| Agente | Papel | Fronteira **exclusiva** (globs) | Entrega testável |
|---|---|---|---|
| **A · backend-esteira** | backend | `supabase/migrations/0050_*.sql`, `0051_*.sql`, `0052_*.sql`; `src/server/regua/**`; `src/server/pagamentos/**` (novo); `src/server/sala/**` (novo); `src/server/jornadas.ts`; `src/app/api/cron/**`; `src/app/api/webhooks/hotmart/**`; `src/app/api/webhooks/n8n/sala/**` (novo); `src/app/api/admin/webhooks/**`; `src/app/api/mensagens/**`; `src/app/api/agendamentos/**`; `src/app/api/publico/[token]/confirmar/route.ts` (novo); `src/app/api/tarefas/**` (novo); `src/app/api/equipe/**`; `src/app/api/jornadas/[id]/agendamentos/**`; `src/types/banco.ts`; `src/types/publico.ts` | 0050–0052 com roteiros; `confirmar_presenca_publico` + link `confirmacao`; `{{link_sala}}`/`{{link_confirmacao}}` no envio; `preparar` para WhatsApp; webhook Hotmart reprocessa `processado_em is null`; cron único com 4 etapas + `regua.ultimo_cron_em`; `GET /api/mensagens` com `template_chave` e bloco `regua`; `Ficha360.diagnosticoAtual`/`cenarios`/`ligacaoIaAtual`/`tarefasAbertas`; `PATCH /api/equipe/me`. Verificação: `curl` no cron local com `x-cron-secret` → `{regua, ligacoes, reaper, salas}`. |
| **B · backend-ligacao-ia-chatwoot** | backend | `supabase/migrations/0053_*.sql`, `0054_*.sql`; `src/server/ligacao-ia/**` (novo); `src/server/chatwoot/**` (novo); `src/server/integracoes/**` (novo); `src/app/api/ligacoes-ia/**` (novo); `src/app/api/jornadas/[id]/ligacoes-ia/**` (novo); `src/app/api/webhooks/n8n/ligacao/**` (novo); `src/app/api/webhooks/chatwoot/**` (novo); `src/app/api/admin/integracoes/**` (novo); `src/app/api/diagnostico/route.ts`; `src/types/integracoes.ts` (novo); `docs/integracoes/n8n-ligacao-ia.md` (novo) | Fila + reaper + adaptadores `n8n`/`manual`; webhook assinado fail-closed idempotente; `registrar_horario_ligacao_ia` chamando o núcleo do A (contrato §2.3); Chatwoot in/out; `GET /api/admin/integracoes`; diagnóstico com 9 vars. Verificação: script `scripts/simular-webhook-ligacao.ts` (assinatura válida → `concluida` + agendamento; inválida → 401 e linha `assinatura_valida=false`; horário fora dos 4 → `horario_indisponivel`). Expõe `processarFilaLigacoesIa`/`reaperLigacoesIa` para o cron do A importar. |
| **C · backend-material-pdf** | backend | `supabase/migrations/0055_*.sql`; `src/server/material/**` (novo); `src/server/ia/material.ts`; `src/app/api/jornadas/[id]/material/**`; `src/app/api/publico/[token]/material-pdf/route.ts` (novo); `src/app/api/admin/materiais-modelos/**` (novo); `src/types/material.ts`; `package.json`, `package-lock.json` | `pdfkit` instalado; `gerarPdfMaterial`; aprovação gera + sobe + registra PDF; `escolherModeloMaterial` puro com `motivo_modelo`; entrada da IA com `conclusao_sessao`; `enviarEmail` com anexos (**contrato com A**: A é dono de `regua/email.ts` — C entrega a assinatura `anexos?` neste doc e A implementa; C consome). Verificação: `scripts/gerar-pdf-exemplo.ts` produz PDF ≥ 1 página com fonte registrada, e `%PDF` nos 4 primeiros bytes. |
| **D · backend-parametros-cenario-diagnostico** | backend | `supabase/migrations/0056_*.sql`, `0057_*.sql`, `0058_*.sql`; `src/server/parametros/**`, `src/server/cenario/**`, `src/server/diagnostico/**` (novos); `src/app/api/parametros-metodo/**`, `src/app/api/admin/parametros/**`, `src/app/api/jornadas/[id]/cenario/**`, `src/app/api/jornadas/[id]/diagnostico/**` (novos); `src/app/api/jornadas/[id]/ofertas/**`; `src/types/roteiro.ts`; `src/types/cenario.ts` (novo) | Tabelas + constraints + trigger de multiplicação + view de totais; seeds B27; constantes TS removidas; `montarDiagnostico` puro; rotas. Verificação: INSERT `calculado` sem `parametro_id` → `23514`; total `null` com uma rubrica `ausente`; `parametro_vigente('honorarios.croqui.padrao')` → 7200. |
| **E · backend-ia-briefing-croqui** | backend | `supabase/migrations/0059_*.sql`; `src/server/ia/**` (exceto `material.ts`); `src/server/croqui/**`; `src/server/importacao/**`; `src/app/api/importacoes/**`; `src/app/api/admin/sonda-schema/route.ts`; `src/app/api/briefings/**`; `src/app/api/croquis/**`; `scripts/bancada-ia.ts` | `respostas_seminario`; contexto com seminário/CNPJ/ligação IA; seção `linguagem_do_cliente`; sonda generalizada; prompt v3 briefing + v2 croqui **inativos** até a sonda e a bancada passarem (o arquivo da migration deixa `ativo=false` e o `UPDATE` de ativação em comentário); `croqui-analise.ts` bi-versão; `valor_declarado`. Verificação: sonda colada na 0059; bancada 3 fixtures com bytes de contexto antes/depois. |
| **F · frontend-proximo-passo-onboarding** | frontend | `src/lib/pasta/**`; `src/components/onboarding/**` (novo); `src/components/esteira/**`; `src/components/painel/**`; `src/components/agenda/**`; `src/app/(app)/esteira/**`, `src/app/(app)/painel/**`, `src/app/(app)/agenda/**`; `src/types/painel-ui.ts`; `src/types/agenda.ts`; `src/hooks/useJornadas.ts` | `sinais.ts` + `proximo-passo.ts` puros com testes de mesa em comentário; chip único "próximo passo · de quem" em Esteira/Painel/Agenda; selo de presença; tour de 8 passos em `ui/Gaveta`. Consome contratos de A (colunas novas das views) — enquanto A não entregar, campos ausentes viram `null` e o chip não inventa. |

**Contratos da Onda 1 que cruzam agentes:** (i) `app.confirmar_horario_da_sugestao(links_publicos, timestamptz, text) returns jsonb` — A define, B chama; (ii) `enviarEmail({..., anexos?: Array<{nome: string; conteudoBase64: string}>})` — A implementa, C chama; (iii) `processarFilaLigacoesIa(admin)`/`reaperLigacoesIa(admin)` — B exporta em `src/server/ligacao-ia/index.ts`, A importa no cron; (iv) `sincronizarSalas(admin)` — A; (v) `Ficha360` novos campos — A define em `src/server/jornadas.ts` e `src/types/banco.ts`; front espelha em `src/components/ficha360/api.ts` (Onda 2), **não** em `lib/api.ts`.

### ONDA 2 — 3 agentes em paralelo (telas que consomem a Onda 1)

| Agente | Papel | Fronteira **exclusiva** | Entrega testável |
|---|---|---|---|
| **G · frontend-comunicacao-admin** | frontend | `src/app/(app)/comunicacao/**`; `src/components/comunicacao/**` (novo); `src/components/admin/**` (`AdminApp.tsx`, `adminApi.ts`, `abas/*` incl. novas `IntegracoesAba`, `ParametrosAba`, `MateriaisModelosAba`, `PendenciasAba`, `ProdutosAba` com `url_checkout`); `src/types/admin.ts`; `src/app/(app)/admin/**` | Comunicação: "O que vai sair e quando", prova de vida do cron, pendências rotuladas, `preparar` antes de copiar, recebidas do Chatwoot com "Vincular"; Admin: Integrações (com "Testar"), Parâmetros (ITCMD com base legal obrigatória), Modelos de material, Produtos com checkout, Pendências com os 3 tipos novos. Sem polling. |
| **H · frontend-ficha-pasta** | frontend | `src/components/ficha360/**`; `src/components/pasta/**`; `src/app/(app)/jornadas/[id]/page.tsx`; `src/app/(app)/jornadas/[id]/diagnostico/**` (novo); `src/hooks/**` (exceto `useJornadas.ts`); `src/components/briefing/**` | Sessão: presença (selo + confirmar à mão), sala (colar/integração), "Ligar por IA" + estado da ligação + fallback, tarefa "Enviar link do croqui" com mensagem pronta/copiar/link `/p/d`/marcar enviado; Material: estado do PDF, baixar, regerar; Relatório: gaveta Cenário Patrimonial (grade rubrica × cenário, procedência); Diagnóstico: edição + toggles de visibilidade + botão apresentar; Briefing: "Como ele fala"; Pasta: `diagnostico_sv` derivado. Clientes de API em `ficha360/api-*.ts`. |
| **I · frontend-publico-croqui-sessao-importacao** | frontend | `src/app/(publico)/**`; `src/components/publico/**`; `src/components/croqui/**`; `src/components/graficos/**`; `src/components/sessao/**`; `src/components/importacao/**`; `src/types/publico-ui.ts`; `src/types/importacao.ts` | `/p/c/[token]` (um toque, tela de "confirmado", estado "já confirmado"); `/p/m` com "Baixar PDF"; `ModoApresentacao` genérico (slides + notas) reusado pelo Diagnóstico; `GraficoDoSlide` economia do cenário com legenda de procedência; células com `alocacao` v2; `PainelOferta` com preço da API + `<SeloStub>` sem parâmetro; importação com "Pergunta do seminário: …". |

### ONDA 3 — 2 agentes (costura, medição, prova de ponta a ponta)

| Agente | Papel | Fronteira **exclusiva** | Entrega testável |
|---|---|---|---|
| **K · backend-costura-medicao** | backend | `scripts/**` (exceto `bancada-ia.ts`); `docs/integracoes/**`; `docs/ARQUITETURA-FASE-4-VERIFICACAO.md` (novo); qualquer arquivo de A–E **só com autorização do orquestrador** para corrigir contrato quebrado | Roteiro executado de ponta a ponta contra o banco (via orquestrador/MCP): pagamento simulado → boas-vindas na fila → ligação IA simulada → agendamento → D-7 com link → confirmação pelo link → sala → sessão realizada → material aprovado → PDF → e-mail com anexo → tarefa do croqui → documentos → cenário → diagnóstico. Bancada: v3 briefing e v2 croqui medidos; ativação só se o gate da Fase 3 §1.9 passar. `explain analyze` das views novas. |
| **L · frontend-costura-a11y** | frontend | arquivos de F–I **só com autorização do orquestrador**; `tmp/squad/capturas/**` | Passada com login real nas 9 superfícies tocadas nos 2 temas + impressão; alvo ≥ 44 px, sem fonte < 12 px nos componentes novos; empty states acionáveis; capturas. |

### ONDA 4 — `security-pentester` (obrigatório), depois `fable-orchestrator`

Superfícies que o desenho ampliou (tarefas obrigatórias):
- **Rota pública nova `/p/c` + RPC `confirmar_presenca_publico`**: enumerar token, link de outro agendamento, link revogado/expirado, reuso após remarcação, rate limit, ausência de `pessoa_id`/UUID na resposta.
- **Webhooks novos** (`n8n/ligacao`, `n8n/sala`, `chatwoot`): sem secret → 503; assinatura errada → 401 **e** linha registrada; replay (timestamp velho, mesmo `id_evento`); payload > 1 MB; horário fora dos ofertados; `ligacao_id` de outra jornada; evento `concluida` duas vezes.
- **Núcleo `app.confirmar_horario_da_sugestao`**: chamado por `anon` direto? (não deve ser executável fora dos wrappers — `revoke` + schema `app` não exposto); `nivel_pago=0`; sobreposição de agenda.
- **Hotmart reprocessamento**: reentrega com `processado_em null` reprocessa uma vez só; `assinatura_valida=false` nunca reprocessa.
- **`ligacoes_ia`/`mensagens_recebidas`**: `relacionamento` lê, não insere; `intruso` recebe 42501; transcrição não vai para IA sem `tratamento_ia`; `custo_usd` não é gravável por authenticated.
- **PDF/Storage**: caminho `materiais/{jornada}/{material}.pdf` inacessível sem signed URL; `GET .../material.pdf` só via token válido; anexo do e-mail é do material aprovado atual (não de versão antiga); rascunho nunca tem `pdf_caminho` (constraint).
- **`parametros_metodo`/`cenarios_patrimoniais`**: `relacionamento` não lê cenário; INSERT `calculado` sem parâmetro recusado pelo PostgREST; ativação de parâmetro só admin.
- **Diagnóstico**: blocos com `visibilidade=false` não aparecem no DOM do modo apresentação (não só `hidden`).
- **Admin → Integrações**: nenhuma resposta contém valor de env var; `testar` não é chamável por `relacionamento`.
- Reteste do BAIXO em aberto (erro do provedor ecoando prompt) com os novos caminhos de erro.

---

## 10. Tarefas por agente (checklist)

### backend-engineer
- [ ] **A** 0050 (enum só) · 0051 (presença, sala, link `confirmacao`, RPCs, `drop function reivindicar…(int)` + nova assinatura, templates v2, tarefa `enviar_link_croqui`, `produtos.url_checkout`, views) · 0052 (kanban sinais, `regua.ultimo_cron_em`, `onboarding_visto_em`, `cron_parado`, `tarefas.tipo`).
- [ ] **A** `processar.ts`: canais, placeholders no envio, anexos; `email.ts` `anexos?`; cron com 4 etapas; `pagamentos/hotmart.ts` + rota reprocessando `processado_em is null`; `sala/n8n.ts` + webhook; `mensagens/[id]/preparar`; `agendamentos/[id]` `presenca_confirmada`; `equipe/me`; `tarefas`; `Ficha360` campos novos.
- [ ] **B** 0053 `ligacoes_ia` + RPCs · 0054 `mensagens_recebidas` · `ligacao-ia/**` (tipos, n8n, manual, fila, processar, reaper, resultado) · webhooks assinados · `chatwoot/**` · `admin/integracoes` + `testar` · `diagnostico` · `docs/integracoes/n8n-ligacao-ia.md` · `scripts/simular-webhook-ligacao.ts`.
- [ ] **C** 0055 · `pdfkit` · `material/pdf.ts` · aprovação gera PDF · `material-pdf` público · `escolherModeloMaterial` · `admin/materiais-modelos` · `scripts/gerar-pdf-exemplo.ts`.
- [ ] **D** 0056 `parametros_metodo` (seed B27, vazio B30) · 0057 `cenarios_patrimoniais` + trigger + view · 0058 `diagnosticos_sv` · rotas · `montarDiagnostico` · constantes fora de `roteiro.ts`.
- [ ] **E** 0059 `respostas_seminario` + prompts (inativos) · contexto do briefing (seminário, CNPJ, ligação IA, L7) · `linguagem_do_cliente` · sonda generalizada · `croqui-analise.ts` bi-versão · importação grava respostas · bancada com `variante`.
- [ ] **K** roteiro de ponta a ponta executado e documentado; bancada; `explain analyze`.

### frontend-engineer
- [ ] **F** `sinais.ts`, `proximo-passo.ts`, `catalogo.ts` (`deQuem`) · chip único em Esteira/Painel/Agenda · selos de presença · tour.
- [ ] **G** Comunicação (vai sair e quando, cron, pendências, preparar, recebidas) · Admin (Integrações, Parâmetros, Modelos de material, Produtos checkout, Pendências).
- [ ] **H** Ficha 360 (Sessão, Material, Relatório/Cenário, Diagnóstico, Briefing "Como ele fala") · Pasta.
- [ ] **I** `/p/c`, `/p/m` PDF, `ModoApresentacao` genérico, gráficos do cenário/alocação, `PainelOferta` por API, importação com perguntas.
- [ ] **L** passada visual/a11y nos dois temas.

### security-pentester (obrigatório)
- [ ] os 10 itens da Onda 4.

---

## 11. Os 5 critérios do Fable

| Critério | O que este plano garante |
|---|---|
| **Segurança** | Toda superfície nova que fala com fora falha **fechada**: `confirmar_presenca_publico` é a 5ª RPC pública com o mesmo pepper/hash/rate limit/auditoria das 4 existentes; os 3 webhooks novos exigem segredo (503 sem ele), assinatura HMAC com janela de tempo (n8n) ou segredo de URL em tempo constante (Chatwoot, que não assina — C28), registram tentativa inválida e são idempotentes por `webhooks_eventos`. O horário devolvido pela IA **só entra pelo núcleo do banco** que já valida "entre os ofertados" e "pagou" — a rota não decide. `ligacoes_ia`, `mensagens_recebidas`, `cenarios_patrimoniais`, `diagnosticos_sv`, `parametros_metodo`, `respostas_seminario`: RLS + `force`, grants explícitos, sem INSERT de `authenticated` onde o dado é produzido pelo sistema. Transcrição da IA e `qsa` só chegam à IA sob `tratamento_ia`. PDF só existe para material aprovado — **constraint**, não rota. 10 tarefas de pentest, 4 delas sobre superfície pública/webhook. |
| **Escalabilidade** | Zero polling: Comunicação e Integrações buscam ao montar + botão. O cron é **uma** chamada a cada 5 min e cada etapa reivindica por `FOR UPDATE SKIP LOCKED` com limite. Índices parciais em toda fila (`na_fila`, `discando`, `pendente`), únicos parciais impedem duplicata ativa. Views novas seguem índices existentes (`idx_agendamentos_proximos`, `uniq_material_atual`); as colunas acrescentadas ao kanban são `exists`/`min` já usados. `parametros_metodo` é uma linha por chave ativa; `cenarios` é 5×~8 linhas por jornada. A 10× as jornadas, o que cresce são linhas indexadas; o custo de IA por jornada não sobe (nenhuma chamada nova em F1/F2/F3/F6). |
| **Solidificação** | Invariantes que o banco passa a garantir sozinho: presença confirmada tem data **e** via (`ck_presenca_confirmada`); link `confirmacao` sempre aponta um agendamento; uma ligação IA ativa por jornada (`uniq_ligacao_ia_ativa`); PDF exige aprovação (`ck_pdf_exige_aprovacao`); `calculado` exige base + alíquota + parâmetro carimbado, `ausente` exige valor nulo (`ck_procedencia`) e a multiplicação é do trigger, não da tela; alíquota de imposto exige base legal (`ck_tributo_exige_base_legal`); uma versão ativa por parâmetro/modelo/diagnóstico (índices únicos parciais); mensagem com `{{link_sala}}` não é reivindicada sem sala; webhook reentregue reprocessa **só** se `processado_em is null`. E o núcleo único de agendamento tira a regra de negócio de duas rotas e a põe numa função de banco. |
| **UX** | O cliente confirma presença com **um toque** no celular, e a equipe vê "Confirmou" na Agenda, no Painel, na Esteira e na Pasta com o mesmo selo. A advogada abre a Ficha e vê **um** chip "próximo passo · de quem" igual ao da Esteira e ao do Painel. A tela de Comunicação diz "o que vai sair e quando" e, enquanto o cron não existe, diz isso com todas as letras em vez de uma fila que nunca anda. O material chega como PDF com a cara do seminário, anexado e por link. O "envie pessoalmente" da Dra. Elaine vira um cartão com a mensagem pronta e três botões. O Diagnóstico da SV existe como peça apresentável, com o que o cliente pode ver decidido bloco a bloco. Primeira vez no sistema: um tour de 8 passos que se dispensa e não volta em outro aparelho. Nada de dado inventado: cada pendência de configuração tem texto próprio, e todo número tem procedência. |
| **Otimização** | O plano **remove**: (a) três caminhos de gravar agendamento convergem em um núcleo; (b) quatro fontes de "próximo passo" viram uma função pura sobre sinais que as telas já carregam — zero fetch novo; (c) o regex hardcoded de escolha de modelo vira dado editável; (d) duas constantes de preço em TS somem; (e) `ligacao.respostas` deixa de duplicar campos já nomeados no contexto da IA (bytes a menos por briefing); (f) a ligação IA **reusa** o link de agendamento e a ordenação por IA já paga — zero chamada nova; (g) o mesmo cron, a mesma tabela de webhooks, a mesma tabela de links, a mesma tabela de tarefas (que existia sem uso), o mesmo bucket. Uma dependência nova (`pdfkit`), justificada contra três alternativas mais pesadas. Nenhuma tabela de estado derivado: cenário, diagnóstico e próximo passo derivam dos fatos. |

---

## 12. Anexo

### Variáveis de ambiente novas (todas opcionais; ausência = comportamento manual rotulado)

```
N8N_WEBHOOK_LIGACAO_URL        LANCADOR da ligação (padrão RSVP)
LIGACAO_IA_WEBHOOK_SECRET      HMAC do retorno n8n → SIC-HF (ligação)
VAPI_ASSISTENTE_ID             assistente de voz
N8N_WEBHOOK_SALA_URL           criação de sala
INTEGRACOES_WEBHOOK_SECRET     HMAC dos webhooks n8n → SIC-HF (sala) e SIC-HF → n8n
CHATWOOT_URL · CHATWOOT_ACCOUNT_ID · CHATWOOT_API_TOKEN · CHATWOOT_INBOX_ID · CHATWOOT_WEBHOOK_SECRET
```

### Chaves novas em `configuracoes` (todas `UPDATE`, sem deploy)

```
regua.ultimo_cron_em            timestamptz (escrita pelo cron)
regua.canal_whatsapp            "manual" | "chatwoot"
sala.provedor                   "manual" | "n8n"
ligacao_ia.automatica           false   (B33)
ligacao_ia.provedor             "manual" | "n8n"
ligacao_ia.max_tentativas       2
ligacao_ia.intervalo_retentativa_minutos 240
ligacao_ia.timeout_minutos      20      (reaper)
material.anexar_pdf             true    (B35)
material.rodape_juridico        texto do rodapé do PDF (B14)
cenario.rubricas                ["itcmd","itbi","custas_cartorio","honorarios_advocaticios","honorarios_croqui","honorarios_holding","manutencao_anual"] (B37)
```

### Ordem de aplicação das migrations

`0050 → 0051 → 0052` (A, sequenciais) · `0053 → 0054` (B, dependem da 0051)
· `0055` (C, independente) · `0056 → 0057 → 0058` (D, sequenciais) · `0059`
(E, independente). Aplicar em ordem numérica satisfaz todas as dependências.

### Pendências de infra (não são código)

1. Cron no hPanel da Hostinger (`u542688653`) chamando `POST /api/cron/regua` a cada 5 min com o `CRON_SECRET` de produção.
2. `CRON_SECRET` do `.env.local` alinhado ao de produção (ou o contrário) — hoje 401.
3. `RESEND_API_KEY` + `EMAIL_FROM` + DNS do domínio de e-mail.
4. `HOTMART_WEBHOOK_SECRET` + os 3 IDs em Admin → Produtos + `url_checkout` do Croqui.
5. Workflow n8n "SIC-HF · LIGAÇÃO · agendar SV" (LANCADOR/DISPARO/WEBHOOK/REAPER) criado pelo orquestrador a partir de `docs/integracoes/n8n-ligacao-ia.md`; assistente na Vapi.
6. Chatwoot: inbox do WhatsApp, token de API, webhook apontando para `/api/webhooks/chatwoot?token=…`.

### Como reverter (por migration)

| Migration | Reversão |
|---|---|
| 0050 | inerte (valor de enum sem uso) |
| 0051 | `drop function`s novas; `drop function reivindicar_mensagens_pendentes(int, canal_mensagem[])` + recriar `(int)` pelo texto da 0031 (em comentário no arquivo); `drop column`s; `UPDATE mensagens_templates SET ativo=(versao=1)`; recriar `abrir_link_publico`/views pelo texto anterior |
| 0052 | `drop column onboarding_visto_em`, `tarefas.tipo`; `delete from configuracoes where chave in (...)`; recriar `vw_jornada_kanban` pela 0023 |
| 0053 / 0054 | `drop table ligacoes_ia` / `mensagens_recebidas`; `drop column`s de `mensagens_agendadas` |
| 0055 | `drop column`s de `materiais_gerados`/`materiais_modelos`; objetos no Storage ficam (apagar à mão) |
| 0056 / 0057 / 0058 | `drop table` (nenhuma outra tabela referencia, exceto `cenarios.parametro_id → parametros` — derrubar 0057 antes da 0056); `drop type procedencia_valor` |
| 0059 | `drop table respostas_seminario`; `UPDATE prompts_versoes SET ativo=(versao=<anterior>)` — versões antigas nunca são apagadas |

**Nenhuma migration deste plano faz `DELETE`. Nenhuma faz `UPDATE` que mude o
valor de uma linha de cliente. Nenhuma pessoa muda de faixa, papel, etapa ou
desfecho por causa deste plano.**
