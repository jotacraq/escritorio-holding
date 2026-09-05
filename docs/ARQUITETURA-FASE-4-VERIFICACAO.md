# Fase 4 — roteiro de verificação executável (Onda 3 · agente K)

Complemento operacional de `ARQUITETURA-FASE-4.md` §9 (linha K) e §12. Tudo aqui
roda contra o banco remoto `fcfsnqqaphtamhrpuyoh` (migrations 0050–0059 aplicadas
em 05/09; a **0060** deste agente precisa ser aplicada antes do passo (g)) ou
contra a produção na Hostinger. Nada roda no `next dev` local sem
`SUPABASE_SERVICE_ROLE_KEY`/`OPENROUTER_API_KEY` — e isso é esperado, não bug.

## 1. Banco — `scripts/verificacao-fase4.sql` (uma chamada, rollback garantido)

**Como rodar:** cole o arquivo inteiro numa única chamada do MCP do Supabase
(`execute_sql`) ou no SQL Editor, como `postgres`. A última instrução devolve a
tabela `resultado_verificacao (ordem, passo, ok, detalhe)`.

**Por que não deixa linha nova:** cada passo é um sub-bloco PL/pgSQL que termina
em `raise exception 'rollback_proposital'`. O Postgres desfaz toda escrita do
sub-bloco (fixture, RPC, contadores de `publico_rate_limit`, `links_publicos_acessos`,
timeline, fila de mensagens); só as variáveis do bloco sobrevivem e vão para a
tabela **temporária** (`on commit drop`). O passo (l) prova isso no fim
(pessoa/jornada/pagamento de verificação = 0/0/0). Nunca usa `pg_get_viewdef`.

| Passo | O que prova | Esperado |
|---|---|---|
| 0 | 4 views com `security_invoker=true`; 12 RPCs da fase existem | ok |
| a | `confirmar_presenca_publico` 2× → mesma `confirmada_em`; `via='link'`; link `usado`/`usos=1`; sem ids na resposta; agendamento remarcado → link de confirmação `revogado` | ok |
| b | `app.confirmar_horario_da_sugestao`: fora dos ofertados → `horario_indisponivel`; ofertado → `ok`, link `usado`, etapa `sessao_agendada`; wrapper `escolher_horario_publico` remarca (usos 2) e a 3ª dá `limite_remarcacoes` | ok |
| c | `registrar_horario_ligacao_ia`: fora → `horario_indisponivel`; ok → agendamento `origem='ia'` `confirmado`, ligação `concluida/agendou`; chamada após terminal → `ligacao_encerrada` | ok |
| d.1 | `pg_proc` tem **1** `reivindicar_mensagens_pendentes` e a assinatura inclui `canal_mensagem[]` | ok |
| d.2 | `dia_da_sessao` com `{{link_sala}}` fica em **hold** sem sala (0 reivindicadas) e sai com sala (1), placeholder preservado para o envio | ok |
| e | tarefa `enviar_link_croqui` nasce ao fechar a sessão; oferta aceita e novo update **não** duplicam (1/1/1); `origem='sistema'` | ok |
| f | `INSERT` de material rascunho com `pdf_caminho` → `23514 ck_pdf_exige_aprovacao` | ok |
| g | `calculado` sem `parametro_id` → `23514 cenario_calculado_exige_parametro`; 1 rubrica gravada → `total NULL`, `rubricas_ausentes = 6`, `rubricas_faltantes` sem `custas_cartorio`; 7 preenchidas → `15006`; `itbi` ausente → `NULL` + `{itbi}` | ok **com a 0060**; sem ela reporta `ok=false` "0060 NÃO aplicada" e mostra o total parcial (achado H) |
| h | `o_que_falta` com `visivel_ao_cliente=true` → `23514` (CHECK da tabela, vale também pelo PostgREST); blocos válidos gravam | ok |
| i | `respostas_seminario` 2º insert `on conflict do nothing` não sobrescreve (1 linha, resposta original) | ok |
| j | JWT simulado de `relacionamento` (`set_config('request.jwt.claims')` + `set local role authenticated`): `cenarios_patrimoniais`/`cenario_rubricas`/`vw_cenarios_totais` = 0 linhas; insert → `42501` | ok |
| k.1–k.3 | `explain (analyze, buffers)` de `vw_jornada_kanban where desfecho='aberta'`, `vw_sessoes_do_dia`, `vw_cenarios_totais` — nenhum `Seq Scan` em tabela com > 1 000 linhas estimadas; tempo em ms no detalhe | ok |
| l | nenhuma linha de verificação sobrou | ok |

**Efeito colateral conhecido (d.2):** `reivindicar_mensagens_pendentes` usa
`for update skip locked`. Se o cron de produção rodar no mesmo segundo, ele pula
uma mensagem naquela passagem e a pega 5 min depois. `p_limite = 1`.

**Se um passo falhar:** o `detalhe` traz `SQLSTATE mensagem` do Postgres — leia
o erro real antes de formular hipótese (armadilha 3 do CONTINUAR-AQUI).

## 2. Migration 0060 — `supabase/migrations/0060_cenarios_totais_rubricas_padrao.sql`

- `vw_cenarios_totais`: `total` só fecha quando **todas** as rubricas de
  `configuracoes['cenario.rubricas']` existem com procedência ≠ `ausente`.
  Colunas novas só no fim: `rubricas_faltantes text[]`, `rubricas_padrao int`.
  `rubricas_ausentes` passa a contar o mesmo conjunto (é o "faltam N" das telas).
- `app.payload_link_material`: `+ pdf_disponivel boolean` (material atual
  aprovado com `pdf_caminho`). O `/p/m` pode nascer com o botão certo.
- Roteiro de verificação em comentário no topo do arquivo; o passo (g) do
  script cobre a view; o item 5 do roteiro cobre o payload.
- Reversão: `drop view` + texto da 0057:162-173; função pelo texto da 0031:419-431.

## 3. Rotas — `curl` (dev :3000 e produção)

| Chamada | Local (sem service_role) | Produção |
|---|---|---|
| `POST /api/cron/regua` sem header | `401 {"erro":"nao_autorizado"}` | idem |
| `POST /api/cron/regua` com `x-cron-secret` do ambiente | `503 {"erro":"servico_indisponivel"}` | `200 {regua, ligacoes, reaper, salas, ultimo_cron_em}` e `configuracoes['regua.ultimo_cron_em']` atualizado |
| `GET /api/diagnostico` com `x-cron-secret` | lista as 24 variáveis com `presente (N chars)`/`AUSENTE`, nunca o valor — inclui `N8N_WEBHOOK_LIGACAO_URL`, `LIGACAO_IA_WEBHOOK_SECRET`, `VAPI_ASSISTENTE_ID`, `N8N_WEBHOOK_SALA_URL`, `INTEGRACOES_WEBHOOK_SECRET`, `CHATWOOT_*` (5), `RESEND_API_KEY`, `EMAIL_FROM`, `HOTMART_WEBHOOK_SECRET`, `CRON_SECRET` | idem; sem secret → 404 |
| `PATCH /api/jornadas/[id]/sessao {link_sala}` | sem login 401 · `http://`/texto/sem campo 422 · jornada inexistente 404 · jornada sem sessão 409 `sessao_inexistente` · mesmo link 200 `{sessao, inalterada:true}` · link novo 200 `{sessao}` com `link_sala_origem='manual'` (trigger 0051) + evento na timeline | idem |
| `GET /api/croquis/[id]?modo=apresentacao` | 401 sem login; logado: `graficos.{criterios, recomendacao_arquitetura, alocacao, economia, cenario}` | idem |
| `GET /api/publico/[token]` (tipo `material`) | `payload.pdf_disponivel` só com a 0060 | idem |

Medido em 05/09 no dev :3000 com login real (script `smoke-sessao.mjs` no
scratchpad da sessão, cookie no formato do `@supabase/ssr`): 401 · 422 ×3 ·
404 · 409 · 200 `inalterada:true` `origem: manual`. Nenhuma escrita no banco.

## 4. Cron da Hostinger (infra, não código)

1. hPanel → Cron Jobs → a cada 5 min:
   `curl -s -X POST -H "x-cron-secret: $CRON_SECRET" https://<dominio>/api/cron/regua`
   (o `CRON_SECRET` do cron **é** o da env de produção — hoje o `.env.local` tem outro).
2. Prova de vida: `select valor from configuracoes where chave='regua.ultimo_cron_em'`
   muda a cada passagem; `vw_pendencias_sistema` deixa de listar `cron_parado`;
   Comunicação → "Prova de vida do cron" fica verde.
3. Sem o cron **nada** da esteira sai (e-mail, ligação IA, reaper, sala).

## 5. Bancada de IA (produção, custa dinheiro — rodar uma vez, medir, decidir)

Pré-requisitos: `OPENROUTER_API_KEY` + `SUPABASE_SERVICE_ROLE_KEY` no ambiente
onde o comando roda (SSH da Hostinger ou máquina com `.env.production` local).
Prompts `briefing_v3` e `croqui_v2` foram inseridos **inativos** pela 0059.

1. **Sonda do schema** (0 tokens de saída; só prova que a gramática compila —
   teto medido: 3 905 bytes compila, 4 428 não):
   ```
   POST /api/admin/sonda-schema   (logado como admin; 503 sem OPENROUTER_API_KEY)
   {"chave":"briefing_v3"}   → {chave, bytes, ..., para_colar:"sonda AAAA-MM-DD · briefing_v3 · N bytes · compilou"}
   {"chave":"croqui_v2"}     → idem; "NÃO compilou: ..." = parar aqui
   ```
   Colar a linha `para_colar` no comentário da 0059 (é o registro do gate).
   "NÃO compilou" = **não ativar**; cortar campo do schema antes
   (CONTINUAR-AQUI §0 item 1).
2. **Bancada** — primeiro a medição sem IA (custo zero), depois a matriz mínima:
   ```
   npx tsx scripts/bancada-ia.ts --so-bytes                       # bytes de contexto antes/depois por fixture, ZERO chamada
   npx tsx scripts/bancada-ia.ts --variantes=baseline,v3_fontes   # 3 fixtures × 2 variantes, imprime tabela, NÃO promove
   ```
   Fixtures em `tmp/bancada/fixtures.json` (fora do git). Critério do gate
   (Fase 3 §1.9, cabeçalho do script): `v3_fontes` com custo médio
   ≤ US$ 0,045/briefing e sem ancoragem zerada que a baseline preenchia.
3. **Ativação** (sem deploy, reversível pelo mesmo `UPDATE`; chaves reais da
   tabela: `protocolo_01_briefing` v3 e `agente_croqui_analise` v2 — texto já
   em comentário na 0059):
   ```sql
   update prompts_versoes set ativo = false where chave = 'protocolo_01_briefing' and versao <> 3;
   update prompts_versoes set ativo = true  where chave = 'protocolo_01_briefing' and versao = 3;
   update prompts_versoes set ativo = false where chave = 'agente_croqui_analise' and versao <> 2;
   update prompts_versoes set ativo = true  where chave = 'agente_croqui_analise' and versao = 2;
   -- conferir: select chave, versao, ativo, effort from prompts_versoes order by chave, versao;
   ```
   Ou pelo script: `npx tsx scripts/bancada-ia.ts --variantes=baseline,v3_fontes --promover=v3_fontes`
   (só promove se o gate passar). Reverter: `ativo = (versao = <anterior>)`
   na mesma chave. Nunca apagar versão.
4. Depois de ativar: 1 briefing real → `erros_servidor` sem linha nova com
   `sonda`/`grammar`; `custo IA` no Admin dentro do medido na bancada.

## 6. Dado de teste do agente H — `scripts/limpeza-teste-h.sql`

Jornada "Marcos Antônio Ferreira (exemplo)" (`origem_dado='exemplo'`) recebeu
1 cenário (`custas_cartorio` R$ 15.000) + 4 versões de diagnóstico + eventos de
timeline. O script tem conferência antes/depois e a limpeza devolve as linhas
apagadas em JSON (reversão por `jsonb_populate_recordset`). **O orquestrador
decide se roda** — não é obrigatório: é dado de exemplo, marcado como tal.

## 7. O que L precisa trocar (frontend, fora da fronteira K)

- `src/components/ficha360/api-sessao.ts#gravarLinkSala` → `PATCH /api/jornadas/${jornadaId}/sessao` (`chamar` de `./api`), assinatura `(jornadaId, link)`; `SessaoSala.tsx:57` passa `sessao!.jornada_id` em vez de `sessao!.id`. Erros: 422 → texto do `Campo`; 409 `sessao_inexistente` → "confirme um horário antes"; 404 → recarregar a ficha. Apagar o `criarClienteNavegador` do arquivo.
- `src/app/(app)/jornadas/[id]/croqui/[croquiId]/apresentar/page.tsx:29-34` → `dadosGraficos.alocacao = resposta?.graficos.alocacao ?? null` e `dadosGraficos.cenario = resposta?.graficos.cenario ?? null` (tipos já em `lib/api.ts#GraficosParaApresentar`); com isso `ModoApresentacao` não faz as 2 leituras extras de `apiCroqui.ts`.
- `src/components/publico/MaterialPublico.tsx` → se `payload.pdf_disponivel === false` não mostrar "Baixar PDF" (impressão vira o primário); `true` mostra; `undefined` mantém a sonda no clique.
- `src/components/ficha360/{CenarioPatrimonialGaveta,RelatorioAba}.tsx` → usar `totais[].rubricas_faltantes` (0060) em vez de recalcular "7 rubricas de tela" localmente; `undefined` = banco na 0057, manter o cálculo local.
- ESLint: `src/components/ficha360/LigacaoAba.tsx:111` (`setCarregando(true)` dentro de `useEffect`) — único erro do repo; padrão `useRecurso`/busca pura como o agente I fez em `sessao/**`.
