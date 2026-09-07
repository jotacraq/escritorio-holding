# Fase 9 — plano do arquiteto · 07/09/2026
## Agente de WhatsApp de onboarding

Entrada: `tmp/squad/fase9-brief.md`. Base lida: `CLAUDE.md`, `CONTINUAR-AQUI.md` (bloco Fase 8),
`brain/03 - Dominio/{Glossario,Esteira do cliente}.md`, `brain/04 - Tecnico/Custo da IA.md`,
`docs/ARQUITETURA-FASE-8.md` (§0, §G), `docs/ARQUITETURA-FASE-4.md` (§2.5, §2.6, C23/C28),
`docs/integracoes/n8n-mapa-de-integracao.md` (b). Código: `server/chatwoot/{cliente,canal,recebidas}.ts`,
`api/webhooks/chatwoot/route.ts`, `server/publico/**`, `server/radar/{index,pedir,modelo}.ts`,
`server/regua/{processar,links}.ts`, `server/ia/{executar,consentimento}.ts`,
`server/integracoes/telefone.ts`, `lib/pasta/{trilho,proximo-passo,sinais}.ts`, migrations
`0003/0009/0011/0027/0028/0031/0051/0053/0054/0065/0074/0085/0087`, `scripts/{simular-hotmart,seed-demo}.ts`.

**O banco FOI consultado** (PostgREST com `SUPABASE_SERVICE_ROLE_KEY` local, 07/09). Todo número
abaixo marcado *(medido)* saiu de lá. Nenhum número foi inventado; o que não foi medido está
marcado `A MEDIR`.

---

## 0. As três frases que resumem o desenho

**A.** O agente **não decide nada**. Quem decide o que falta é o banco — `derivarProximoPasso()`
(`lib/pasta/proximo-passo.ts`) já responde "de quem é a vez" com `dono: 'cliente'`, testado e em
produção desde a Fase 5. O agente é uma **casca de linguagem natural sobre a máquina de passos que
já existe**. Uma segunda máquina de estados reprova em otimização antes de existir.

**B.** O porteiro é o produto. Medido: das 6 pessoas do banco, **a única `origem_dado='real'` tem o
telefone gravado sem `+` (11 dígitos) e ZERO consentimentos**, e as **4 famílias de demonstração têm
`+5500…` e os 4 consentimentos concedidos**. Ligar o agente hoje, do jeito que `recebidas.ts` casa
telefone, dá o pior resultado possível: **não responde a ninguém real e responderia às 4 famílias
fictícias**. Porteiro não é formalidade de LGPD nesta fase — é a diferença entre funcionar e
constranger.

**C.** "Mandar o link certo" não é reaproveitamento: **não existe emissor de sistema para
`documentos` nem para `formulario`**. Só `material` (0031), `confirmacao` (0051/0074) e `agendamento`
(0053) têm RPC `*_sistema`; `emitir_link_publico` (0028:810) exige `auth.uid()` com papel, e o agente
roda sem sessão. E como o banco guarda **só o hash do token**, "reenviar o link que já mandei" é
fisicamente impossível: toda emissão nova **revoga** a anterior. Isso muda o desenho da conversa.

---

## A. O que existe hoje (medido) e os CONFLITOS

| Camada | Estado hoje | Consequência para a Fase 9 |
|---|---|---|
| `POST /api/webhooks/chatwoot` | fail-closed sem secret (503), token em tempo constante, 1 MB, 120/min, só `message_created`+`incoming`+`private=false` | a porta está boa — **não é aqui o buraco** |
| `registrarMensagemRecebida` (`recebidas.ts:67`) | **só grava.** Nenhum caminho de resposta | C2 |
| `resolverPessoaPorTelefone` (`recebidas.ts:32`) | `.in("telefone", variantesTelefone(e164))` — variantes só com `+55` | C1 |
| `pessoas.telefone` | `text`, sem CHECK; `uniq_pessoas_telefone` parcial (0003:24). *(medido: 6 linhas — 5 em `+55…`, 1 em `11…`, e essa 1 é a única real)* | C1 |
| `consentimentos` *(medido)* | 5 pessoas × `comunicacao_email`, `comunicacao_whatsapp`, `gravacao_sessao`, `tratamento_ia` — **todas as 5 são `origem_dado='exemplo'`** | C1, C6 |
| `configuracoes['consentimento.textos']` *(medido)* | `tratamento_ia` = "…para que a equipe prepare minha **Sessão de Viabilidade**, inclusive com apoio de IA" | C6 → **B56** |
| `app.pode_executar_ia` (0027:198) | cooldown **600 s por jornada** *(medido: `ia.cooldown_segundos=600`)* + teto 20/dia por `criado_por` | C3 |
| `emitir_link_publico` (0028:810) | exige `auth.uid()` + papel; revoga o ativo do mesmo tipo na mesma transação | C4, C5 |
| `enviarWhatsapp` (`cliente.ts:118`) | 3 chamadas: busca/cria contato → busca/cria conversa → POST mensagem | C7 |
| `regua.canal_whatsapp` *(medido)* | `"manual"` — a régua **não** usa o Chatwoot hoje | C7 |
| `mensagens_recebidas` *(medido)* | 0 linhas; `webhooks_eventos` de origem `chatwoot`: 0 | linha de base limpa |
| `vw_pendencias_sistema` (0085:540) | 8 tipos; "sem correspondência" já aparece em Comunicação → Recebidas | reutilizar, não criar tabela |
| `lib/pasta/proximo-passo.ts` | `derivarProximoPasso(sinais)` devolve `dono: 'cliente'` | **é a máquina de passos** |
| `prompts_versoes` *(medido)* | 9 linhas, 4 ativas; `effort` na linha; teto de gramática 3.905 B | reutilizar |

### CONFLITOS

| # | Conflito | Prova | Resolução |
|---|---|---|---|
| **C1** | **O casamento por telefone não casa com quem é real.** `variantesTelefone` só gera `+55…`; a única pessoa real está gravada como `11…` | *(medido)* 1 de 6 fora do E.164, e é a real | D3: normalizar **dos dois lados**, 4 variantes (`+55DDDN`, `55DDDN`, `DDDN`, ±9). **Sem backfill silencioso** — linha fora do padrão vira pendência para a equipe corrigir à mão (regra do brain: contar quem muda de VALOR antes de aplicar) |
| **C2** | `recebidas.ts` só grava; a rota devolve 200 antes de qualquer decisão | `route.ts:88` | D12: decidir e responder entram **depois** da gravação, no mesmo request, com claim atômica e orçamento de tempo |
| **C3** | **A trava de IA errada aperta e a certa não existe.** Cooldown de 600 s **por jornada** cala o agente na 2ª mensagem do cliente; o teto diário compara `criado_por = p_perfil` e o agente não tem perfil → `NULL = NULL` → **nunca dispara** | 0027:198-213 | D19: o agente **não** usa `verificar_cooldown_ia`; tem orçamento próprio por jornada/dia contado em `execucoes_ia` pelo `prompt_versao_id` do agente |
| **C4** | **Não existe `emitir_link_documentos_sistema` nem `..._formulario_sistema`** | grep em `supabase/migrations`: só material/confirmacao/agendamento | D14: nasce `emitir_link_sistema(...)` — **nome novo**, nunca sobrecarga (armadilha catalogada: `create or replace` com parâmetro novo cria uma segunda função e a chamada falha em runtime) |
| **C5** | **Emitir link mata o link anterior.** O token só existe em hash; "reenvia o que já mandei" é impossível. O cliente que pede o link duas vezes derruba o dele mesmo — e derruba o que a equipe mandou por e-mail | 0028:829-836 | D15: teto de **1 emissão por tipo a cada `agente_whatsapp.intervalo_link_horas` (6)**; dentro da janela, resposta fixa apontando a mensagem anterior, sem emitir |
| **C6** | **`tratamento_ia` hoje é consentimento de briefing**, não de chat: o texto vigente fala em preparar a SV | *(medido)* `configuracoes['consentimento.textos']` | **B56** com hipótese conservadora: sem `tratamento_ia`, o agente responde **só com texto fixo** e nenhuma palavra do cliente sai para a IA |
| **C7** | **A régua e o agente dividem o mesmo inbox.** Se `regua.canal_whatsapp` virar `chatwoot`, os dois falam na mesma conversa | `canal.ts:13` | D22: o agente não repete link que a régua enviou há < 6 h (`mensagens_agendadas.conversa_externa_id`), e **só responde, nunca inicia** (D23) |
| **C8** | **O sistema não vê a resposta do humano.** O webhook descarta tudo que não é `incoming`; sem isso "calar quando o humano responde" não tem como funcionar | `recebidas.ts:25-30` | D24: `outgoing` passa a ser **lido** (nunca gravado em `mensagens_recebidas`, que é tabela de entrada) só para carimbar `humano_respondeu_em`. O que é nosso se reconhece pelo `provedor_id` que a própria resposta gravou — não por formato de `sender`, que é do Chatwoot e pode mudar |
| **C9** | **Anexo no WhatsApp fura o `/p/d`.** Documento mandado como foto na conversa não entra no Storage do cliente, não casa com `item_ref`, não conta no `app.limite_arquivos_por_link()` e deixa PII pesada no disco do Chatwoot | `recebidas.ts:74-78` | D11: o agente **nunca ingere anexo**. Responde com o link `/p/d` e, na insistência, cria tarefa para a equipe buscar o arquivo à mão |

---

## B. O porteiro — quem o agente atende

Ordem fixa e fail-closed. **Cada linha é um cenário do simulador (§G) e um teste de vitest.**

| # | Trava | Falhou → |
|---|---|---|
| 1 | token do webhook, `message_created`, `incoming`, `private=false` | 401 / 200 sem efeito *(já existe)* |
| 2 | dedupe por `unique (provedor, mensagem_externa_id)` | 200 `reentrega` *(já existe)* |
| 3 | **grava sempre** em `mensagens_recebidas` — inclusive de desconhecido | — |
| 4 | `configuracoes['agente_whatsapp.ativo'] = true` | grava, não responde |
| 5 | `conversation.inbox_id == CHATWOOT_INBOX_ID` | não responde (inbox que não é o do onboarding) |
| 6 | telefone normalizado casa com **exatamente 1** pessoa | 0 → pendência `numero_desconhecido`; **>1 → pendência `telefone_ambiguo` e silêncio** |
| 7 | `pessoas.origem_dado='real'` **e** `jornadas.origem_dado='real'` | pendência; nunca responde a demonstração |
| 8 | jornada com `desfecho='aberta'` | **B62**: tarefa "cliente fora de processo aberto escreveu", sem revelar o estado |
| 9 | `app.nivel_pago_vigente(jornada) >= 1` | **B63**: lead que não comprou vira tarefa comercial, não onboarding |
| 10 | consentimento `comunicacao_whatsapp` vigente | pendência "escreveu sem consentimento de WhatsApp" |
| 11 | `humano_respondeu_em > now() - agente_whatsapp.silencio_humano_minutos` | cala |
| 12 | `pausado_ate` no futuro ("Assumir conversa") | cala |
| 13 | teto `agente_whatsapp.teto_respostas_hora` (6) por jornada | cala + tarefa |
| 14 | **claim atômica**: `insert into agente_whatsapp_respostas (mensagem_recebida_id) … on conflict do nothing returning id` | sem linha → outro processo já respondeu; sai |

| # | Decisão | Por quê |
|---|---|---|
| **D1** | Número desconhecido **não recebe resposta nenhuma** — nem "não entendi", nem erro | Qualquer texto confirma que existe um sistema atrás do número. Silêncio é a única resposta que não vaza |
| **D2** | O registro do desconhecido é `mensagens_recebidas` (que já grava) + **linha derivada** em `vw_pendencias_sistema`, **não** uma linha em `webhooks_eventos` | Diverge do brief de propósito: `webhooks_eventos` é o livro-razão de *evento de webhook*; a mensagem já está gravada com o `bruto` inteiro. Duplicar é segundo livro-razão para o mesmo fato — reprova em otimização. A pendência entrega o que o pedido quer: a equipe vê "número desconhecido escreveu", com texto e hora |
| **D3** | `variantesTelefone` passa a gerar **4 formas** (`+55DDDN`, `55DDDN`, `DDDN` e as mesmas sem o 9 do celular) e a busca exige **cardinalidade 1** | C1. O `IN` sobre `uniq_pessoas_telefone` continua usando índice. Duas pessoas com o mesmo número em formatos diferentes hoje **passariam pelo `.limit(1)` e casariam com a errada** |
| **D4** | Telefone fora do E.164 vira **pendência**, nunca `UPDATE` automático | "Backfill que reclassifica gente em silêncio é proibido" (`Esteira do cliente.md`). *(medido: 1 linha afetada hoje — e é a do João)* |
| **D5** | `origem_dado` é checado na **pessoa e na jornada** | O seed de demonstração usa `+5500…`, que `normalizarTelefoneE164` **aceita** (13 dígitos com DDI). Só `telefoneParaLigacao` recusa DDD 00, e não é ele quem casa aqui |
| **D6** | Nenhuma das travas 4–13 responde ao cliente com o motivo | "Você não tem consentimento" é vazamento de estado interno para um número que pode nem ser dele |
| **D7** | O agente **nunca** responde a `message_type` `outgoing` nem a nota privada | Anti-loop, camada 1 de 4 (as outras: dedupe, claim, teto por hora) |
| **D8** | Nenhuma trava depende de env var só estar presente: sem `CHATWOOT_INBOX_ID` a trava 5 falha e o agente cala | Env presente ≠ env válida (armadilha catalogada) |

---

## C. A máquina de passos e o catálogo de intenções

| # | Decisão | Por quê |
|---|---|---|
| **D9** | O passo do agente é `derivarProximoPasso(sinais)` **filtrado por `dono === 'cliente'`** — função pura, já testada, em `lib/` | Uma derivação, não duas. É a mesma que a Ficha, a Esteira e o Painel mostram: o que o agente diz no WhatsApp e o que a equipe vê na tela **não podem divergir** |
| **D10** | Os sinais saem de **uma** consulta a `vw_jornada_kanban` + `montarRadar()` (que já tem cache de 60 s, 0069) | Zero N+1; nenhuma consulta nova no caminho quente |
| **D11** | Anexo do cliente: reconhece, agradece e **devolve o link `/p/d`**; nunca baixa, nunca grava arquivo | C9 |
| **D12** | Decidir e responder acontecem **no mesmo request** do webhook, com orçamento de **≤ 12 s** e caminho fixo primeiro | Cinco minutos de espera (cron) não é conversa. A maioria das intenções não chama IA e responde em ~300 ms |
| **D13** | Estourou o orçamento, a IA falhou ou a confiança é baixa → **não envia nada** + tarefa para a equipe | "Não sei" nunca vira texto plausível |

**Catálogo de intenções.** `IA?` = precisa passar o texto do cliente ao modelo.

| Intenção | Detecção | Resposta | IA? |
|---|---|---|---|
| `confirmar_horario` | determinística, só quando o passo é `confirmar_presenca` | fixa + link `/p/c` (**B58**: manda o link, não confirma sozinho) | não |
| `enviar_documento` | anexo no payload, ou determinística | fixa + link `/p/d` + **lista humana do radar** (rótulos, sem `item_ref`) | não |
| `o_que_falta` | determinística | fixa, montada do radar e do passo | não |
| `duvida_uso_sistema` | resto, com `tratamento_ia` | IA, 1–3 frases, devolve ao passo | **sim** |
| `duvida_juridica` | determinística (imposto, ITCMD, inventário, doação, herança, partilha), **antes** da IA | fixa de esquiva + tarefa para a advogada | não |
| `preco_prazo` | determinística | fixa: quem fala de valor é a Dra. Elaine (**B61**) | não |
| `falar_com_humano` | determinística | fixa + tarefa + `pausado_ate` | não |
| `fora_do_tema` | IA classifica | fixa que devolve ao passo; na **2ª** (B57) encaminha + tarefa | **sim** |
| `desconhecida` | confiança < 0,6 | **não envia** + tarefa | — |

| # | Decisão | Por quê |
|---|---|---|
| **D14** | Nasce `public.emitir_link_sistema(p_jornada_id, p_tipo, p_token_hash, p_token_prefixo, p_criado_por default null)`, `service_role` only, cobrindo `formulario` e `documentos`, com a mesma revogação atômica e a mesma validação de autor da 0074 | C4. **Nome novo**: as três `*_sistema` existentes não são tocadas |
| **D15** | Um link por tipo a cada 6 h; dentro da janela, texto fixo apontando a mensagem anterior | C5 |
| **D16** | Resposta fixa é template com placeholders resolvidos do banco (`{{primeiro_nome}}`, `{{lista_documentos}}`, `{{link}}`), no mesmo motor de `regua/placeholders.ts`; **placeholder sobrando bloqueia o envio** | É a trava que já existe na régua (C24 da Fase 4) e que impede mandar "seu link: " vazio |

---

## D. A IA: prompt, esquiva, saída e orçamento

| # | Decisão | Por quê |
|---|---|---|
| **D17** | Prompt `agente_whatsapp_onboarding` v1 em `prompts_versoes`, **`ativo=false` ao nascer**, `effort='low'`, modelo `anthropic/claude-sonnet-5` | Regra da casa: prompt novo só é ativado com sonda + bancada. `low` custou US$ 0,0397 no briefing *(medido)* — e aqui a saída é **uma frase**, não um documento: é o caso em que `low` é o certo, não o degrau barato |
| **D18** | Schema estrito **≤ 3,9 KB**, 4 campos, zero enum grande: `{intencao (string), resposta (string ≤ 400), acao ('enviar_link'\|'nenhuma'\|'encaminhar_humano'), confianca (number)}`. A lista de intenções válidas mora **no texto do prompt** | Teto de gramática medido em 04/09: 4.428 B recusado, 3.905 B compilou. Enum em gramática estrita é alternação e se multiplica. Rodar `POST /api/admin/sonda-schema` antes de subir |
| **D19** | Orçamento próprio: `agente_whatsapp.teto_ia_jornada_dia` (10) e `agente_whatsapp.teto_ia_dia` (100), contados em `execucoes_ia` pelo `prompt_versao_id` do agente. **`verificar_cooldown_ia` não entra no caminho** | C3 |
| **D20** | O que vai para a IA: **só o texto da última mensagem do cliente (≤ 500 chars) + o passo atual em rótulos + os documentos que faltam em rótulos**. Nunca patrimônio, nunca valor, nunca nome de familiar, nunca histórico da conversa | LGPD e regra da casa. `hash_entrada` já é gravado por `executarComAuditoria` |
| **D21** | A IA **nunca escolhe link, nunca afirma estado, nunca cita número**. `acao: 'enviar_link'` só é obedecida se o passo derivado do banco **já** previa aquele link | O modelo redige; o banco decide. É a única forma de "nunca inventa dado" ser garantia, e não promessa |

**Regras do prompt-base** (texto, não schema): direto e cordial, PT-BR, "você" (**B60**), 1–3 frases,
sem emoji, sem jargão; nunca conselho jurídico; nunca preço, prazo ou status que não venha no
contexto; fora do tema → uma frase que devolve ao passo atual; 2ª insistência → "vou pedir para a
equipe te chamar"; nunca pedir por texto um dado que o link já coleta.

---

## E. Humano no loop, envio e modelo de dados

| # | Decisão | Por quê |
|---|---|---|
| **D22** | Não repete link que a régua mandou há < 6 h (`mensagens_agendadas` por `jornada_id` + `conversa_externa_id`) | C7 |
| **D23** | **O agente só RESPONDE, nunca inicia.** Iniciar continua sendo régua com template | A janela de 24 h do WhatsApp está sempre aberta quando o cliente acabou de escrever. Fora dela, só template — e template é da régua |
| **D24** | `outgoing` passa a ser lido só para carimbar `humano_respondeu_em`; o nosso próprio envio é reconhecido pelo `provedor_id` gravado | C8 |
| **D25** | "Assumir conversa" = `pausado_ate = now() + silencio_humano_minutos`, por jornada, reversível ("Devolver ao agente") | Pausa nunca é destrutiva |
| **D26** | Cada resposta vira **evento de timeline** `mensagem` com `direcao: 'enviada'`, `origem: 'agente_whatsapp'`, intenção, confiança e custo | A equipe vê o que o robô disse no mesmo lugar em que vê o resto |
| **D27** | Envio novo: `responderNaConversa(conversaId, texto)` — **1 POST** na conversa que o webhook trouxe | `enviarWhatsapp` faz 3 chamadas e pode **criar uma conversa nova**. Responder fora da conversa do cliente é o começo de duas threads |
| **D28** | `criado_por` do link e da execução = **NULL (sistema)**, com `origem='agente_whatsapp'` no evento (**B64**) | Criar um perfil-robô em `perfis_equipe` o faria aparecer em Equipe, em responsável de tarefa e em toda tela de gente |

### Migrations (rascunho comentado — o backend transforma em arquivo)

```sql
-- 0088_agente_whatsapp.sql  (RASCUNHO — não é o arquivo final)
create table agente_whatsapp_estado (
  jornada_id          uuid primary key references jornadas(id) on delete cascade,
  passo_ultimo        text,
  ultima_intencao     text,
  esquivas_seguidas   smallint not null default 0,
  humano_respondeu_em timestamptz,
  pausado_ate         timestamptz,
  pausado_por         uuid references perfis_equipe(id),
  ultimo_link_em      jsonb not null default '{}'::jsonb,   -- {"documentos":"2026-09-07T..."}
  atualizado_em       timestamptz not null default now()
);
-- append-only: é o livro-razão do robô E a claim anti-resposta-dupla.
create table agente_whatsapp_respostas (
  id                   uuid primary key default gen_random_uuid(),
  mensagem_recebida_id uuid not null unique references mensagens_recebidas(id) on delete cascade,
  jornada_id           uuid not null references jornadas(id) on delete cascade,
  conversa_externa_id  text not null,
  intencao text, confianca numeric(3,2), acao text,
  texto text, execucao_ia_id uuid references execucoes_ia(id),
  custo_usd numeric(10,6), provedor_id text,
  enviada_em timestamptz, erro text,
  criado_em timestamptz not null default now()
);
create index idx_agente_respostas_jornada on agente_whatsapp_respostas (jornada_id, criado_em desc);
-- RLS nas duas: select para app.eh_interno(); em `estado`, UPDATE só das colunas
-- (pausado_ate, pausado_por) por grant de coluna; sem insert/delete para authenticated
-- (quem escreve é service_role). revoke all ... from anon, authenticated; grants nomeados.
insert into configuracoes (chave, valor, descricao) values
 ('agente_whatsapp.ativo',                   'false'::jsonb, '...'),
 ('agente_whatsapp.silencio_humano_minutos', '30'::jsonb,    '...'),
 ('agente_whatsapp.esquivas_ate_humano',     '2'::jsonb,     '...'),
 ('agente_whatsapp.intervalo_link_horas',    '6'::jsonb,     '...'),
 ('agente_whatsapp.teto_respostas_hora',     '6'::jsonb,     '...'),
 ('agente_whatsapp.teto_ia_jornada_dia',     '10'::jsonb,    '...'),
 ('agente_whatsapp.teto_ia_dia',             '100'::jsonb,   '...')
on conflict (chave) do nothing;
-- ROLLBACK: drop das 2 tabelas + delete from configuracoes where chave like 'agente_whatsapp.%'.
--           Nenhuma tabela existente é alterada — a 0088 é 100% aditiva.
```

```sql
-- 0089_link_sistema_e_pendencias.sql  (RASCUNHO)
-- (a) emitir_link_sistema: NOME NOVO, nunca sobrecarga de emitir_link_publico.
create or replace function public.emitir_link_sistema(
  p_jornada_id uuid, p_tipo tipo_link_publico, p_token_hash text,
  p_token_prefixo text, p_criado_por uuid default null) returns links_publicos
language plpgsql security definer set search_path = public, pg_temp as $corpo$ ... $corpo$;
--   . só p_tipo in ('formulario','documentos') — os outros já têm RPC própria;
--   . valida p_criado_por contra perfis_equipe ativo (mesmo corpo da 0074);
--   . exige jornadas.desfecho = 'aberta';
--   . revoga o ativo do mesmo tipo na MESMA transação (idêntico a 0028:829).
revoke all on function public.emitir_link_sistema(uuid, tipo_link_publico, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.emitir_link_sistema(uuid, tipo_link_publico, text, text, uuid)
  to service_role;

-- (b) vw_pendencias_sistema += 'numero_desconhecido' e 'telefone_fora_do_padrao'.
--     ATENÇÃO: partir de `select pg_get_viewdef('vw_pendencias_sistema'::regclass, true)`
--     do BANCO, não da 0085 — o repo pode estar atrás (armadilha catalogada).
--     Refazer depois: revoke all from public, anon; grant select to authenticated;
--     e repetir o revoke de INSERT/UPDATE/DELETE da 0087.

-- (c) índice do orçamento de IA do agente:
create index idx_execucoes_ia_prompt_dia on execucoes_ia (prompt_versao_id, criado_em desc);
-- ROLLBACK: drop function; recriar a view com o corpo salvo antes; drop index.
```

```sql
-- 0090_prompt_agente_whatsapp.sql  (RASCUNHO)
insert into prompts_versoes (chave, versao, titulo, corpo_sistema, modelo_padrao, effort, ativo)
values ('agente_whatsapp_onboarding', 1, '...', '...', 'anthropic/claude-sonnet-5', 'low', false);
-- ativo=false por desenho (D17). ROLLBACK: delete from prompts_versoes where chave = '...'.
```

### BLOQUEIOS (hipótese conservadora já aplicada — cada um se desfaz com 1 linha de SQL/config)

| # | Pergunta que só o João / Dra. Elaine responde | Hipótese aplicada |
|---|---|---|
| **B56** | Sem `tratamento_ia`, o agente responde? O texto vigente do consentimento fala em preparar a SV, não em chat (C6) | **Responde só com texto fixo.** Nenhuma palavra do cliente vai para a IA. Ligar depois = ampliar o texto do consentimento e trocar um `if` |
| **B57** | Quantas esquivas antes de chamar o humano? | **2** (`agente_whatsapp.esquivas_ate_humano`) |
| **B58** | O agente confirma o horário sozinho quando o cliente escreve "confirmo"? | **Não.** Manda o link `/p/c` (um toque). "Sim" pode ser resposta a outra coisa; confirmação precisa ser ato auditável |
| **B59** | Responde fora do horário comercial? | **Sim, 24/7** (ficar mudo é pior). Mas a frase de encaminhamento respeita `ligacao_ia.janela` *(medido: seg–sex 9h–19h SP)*: fora dela diz "amanhã cedo", nunca "a equipe já te chama" |
| **B60** | "Você" ou "senhor(a)"? | **"Você"**, cordial. O DS e o Glossário já falam "você"; "senhor(a)" em WhatsApp lê como call center |
| **B61** | O agente pode citar o preço do croqui (R$ 7.200 / R$ 4.500)? | **Não.** A oferta é pessoal da Dra. Elaine (é o método). Devolve a pergunta e cria tarefa |
| **B62** | Cliente com processo **arquivado/ganho** escreve. Responde? | **Não.** Tarefa para a equipe, sem revelar o estado do processo |
| **B63** | Lead que ainda **não comprou** a SV escreve. Responde? | **Não.** O onboarding começa no pago (`nivel_pago_vigente ≥ 1`); vira tarefa comercial |
| **B64** | Quem assina o link e a execução do agente? | **NULL = sistema**, com `origem='agente_whatsapp'` no evento. Nada de perfil-robô em `perfis_equipe` |

---

## F. A trava do Fable — os números que não podem piorar

| Número | Antes (medido / A MEDIR) | Depois |
|---|---|---|
| `npm test` | **749** | ≥ 749 + porteiro (14 travas) + máquina de passos + parser da IA |
| `npm run verificar` (tipos·lint·testes·build) | verde | verde |
| Execuções de IA com `agente_whatsapp.ativo=false` | — | **0** (contado em `execucoes_ia`) |
| Respostas a `origem_dado='exemplo'` | — | **0** (cenário do simulador) |
| Consultas por mensagem recebida | 2 hoje (`pessoas`, `jornadas`) | ≤ 4 no caminho fixo, ≤ 5 com IA |
| Chamadas ao Chatwoot por resposta | 3 (`enviarWhatsapp`) | **1** (D27) |
| Latência do webhook, pior caminho | A MEDIR | ≤ 12 s (orçamento) |
| Custo por resposta com IA | A MEDIR na bancada | não se promete número sem medir |
| JS da rota `/admin` | baseline Fase 8 | ≤ baseline (aba nova por `dynamic()`) |

---

## G. Divisão de tarefas — fronteiras de arquivo disjuntas

**BACK — porteiro, máquina de passos, migrations, IA, simulador**
*Permitido:* `supabase/migrations/00{88,89,90}_*.sql` · `scripts/verificacao-0088-0090.sql` ·
`scripts/simular-chatwoot.ts` · `src/server/agente/**` (novo) · `src/server/chatwoot/**` ·
`src/server/integracoes/telefone.ts` · `src/app/api/webhooks/chatwoot/route.ts` ·
`src/app/api/admin/agente-whatsapp/**` (novo) · `src/app/api/jornadas/[id]/agente/**` (novo) ·
`src/types/agente.ts` (novo).
*Não tocar:* `src/components/**`, `src/types/admin.ts`, `src/server/regua/**`, `src/lib/pasta/**`
(reutiliza, não altera), as três RPCs `*_sistema` existentes.
*Aceite:* as 14 travas do porteiro provadas pelo simulador com a saída colada · roteiro SQL com
rollback rodado e colado · vitest novo com IA mockada · `emitir_link_sistema` provado emitindo e
revogando · **prova de que `agente_whatsapp.ativo=false` gera 0 execução de IA**.

**FRONT — Ficha, Comunicação, Admin**
*Permitido:* `src/components/comunicacao/**` · `src/components/ficha360/ConversaWhatsapp.tsx` (novo)
e `TimelineAba.tsx` · `src/components/admin/abas/AgenteWhatsappAba.tsx` (novo) ·
`src/components/admin/{AdminApp.tsx,adminApi.ts}` · `src/types/admin.ts` ·
`src/app/(app)/{mensagens,admin}/**`.
*Não tocar:* `src/server/**`, migrations, `scripts/**`, `src/components/ui/**`, `lib/estados/**`.
*Aceite:* selo "respondido pelo agente" em Recebidas · conversa (recebidas + enviadas) na Ficha com
intenção, confiança e custo · botão "Assumir conversa" / "Devolver ao agente" com desfazer · Admin
com liga/desliga, minutos de silêncio, versão do prompt, custo do dia e **últimas 20 respostas** ·
0 scroll horizontal a 360 px · `vitest-axe` sem violação.

*Contrato entre os dois:* BACK entrega **primeiro** `src/types/agente.ts` e as formas de
`GET /api/admin/agente-whatsapp` e `GET /api/jornadas/[id]/agente`; FRONT importa daí e é dono de
`src/types/admin.ts`. Nenhum arquivo aparece nas duas listas.

**PENTESTER — obrigatório.** Superfície ampliada: rota pública que agora **escreve e responde**;
emissor de link novo com `service_role`; texto de cliente indo para IA (LGPD); porteiro por telefone
(colisão, ambiguidade, `phone_number` forjado no payload); anti-loop e amplificação (um número
malicioso fazendo o sistema gastar IA e revogar links); `pausado_ate` como negação de serviço;
simulador com segredo local; vazamento da existência do sistema para número desconhecido.

---

## H. Ordem de execução

1. **Medir antes** (orquestrador, SQL): pessoas com telefone fora do E.164 · telefones que colidem
   após normalização · pessoas **reais** com `comunicacao_whatsapp` vigente · jornadas abertas com
   `nivel_pago_vigente ≥ 1`. *(Já medido em 07/09: 1 · A MEDIR · **0** · A MEDIR.)* **Zero pessoas
   reais elegíveis hoje** — o agente sobe correto e mudo, e é assim que tem de ser.
2. **BACK 0088–0090 + porteiro + simulador**, antes de qualquer IA: o porteiro é testável sem
   provedor e sem inbox.
3. **BACK IA ‖ FRONT** (uma mensagem, duas chamadas) — as fronteiras acima são disjuntas.
4. **Pentester → trava do Fable.** Reprovou? Roteia para o dono do arquivo, não para os dois.
5. Bancada de IA (custo real) **só depois**, com decisão do João. O prompt continua `ativo=false` até lá.
6. Push no `infra` só depois da aprovação.

---

## I. Os 5 critérios do Fable

| Critério | O que este plano garante |
|---|---|
| **Segurança** | 14 travas fail-closed antes de uma única palavra sair; número desconhecido recebe **silêncio**, não erro; telefone ambíguo recusa em vez de chutar a pessoa (C1); demonstração nunca recebe WhatsApp real (D5); texto do cliente só vai à IA com consentimento e recortado (D20); `emitir_link_sistema` valida autor e é `service_role` only; anti-loop em 4 camadas independentes; pentester obrigatório |
| **Escalabilidade** | 1 consulta de sinais (`vw_jornada_kanban`) + radar com cache de 60 s; busca de telefone por `IN` sobre índice único; índice novo em `execucoes_ia (prompt_versao_id, criado_em desc)`; tetos por hora, por jornada e por dia impedem que 10× mensagens virem 10× custo; chamadas ao Chatwoot por resposta caem de 3 para 1 |
| **Solidificação** | `unique (mensagem_recebida_id)` **é** a trava anti-resposta-dupla, garantida pelo banco e não por `if`; `agente_whatsapp_respostas` append-only; o desligado é o default (`ativo=false`); roteiro SQL com rollback nas 3 migrations; a 0088 é 100% aditiva |
| **UX** | O cliente recebe 1–3 frases, no fio da conversa, com o link do passo em que ele está — e nunca dois links vivos ao mesmo tempo; a equipe vê tudo na Ficha com selo de quem respondeu, custo e confiança, e assume a conversa com um clique reversível; o Admin tem um interruptor, não uma configuração |
| **Otimização** | **A máquina de passos não é escrita: é `derivarProximoPasso`, que já existe e já é testada** — o agente não pode divergir da tela porque lê a mesma função; a maioria das intenções responde com texto fixo (custo zero, alucinação zero); a pendência de número desconhecido é uma linha derivada numa view que já existe, não uma tabela nova; envio de 3 chamadas para 1. **O que a Fase 9 acrescenta de estrutura nova são 2 tabelas e 1 função — e nenhuma tabela existente é alterada.** |
