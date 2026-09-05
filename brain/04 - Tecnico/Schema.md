# Schema do banco — SIC-HF

Projeto Supabase `fcfsnqqaphtamhrpuyoh` (sa-east-1). **17 migrations aplicadas em 03/09/2026.**
33 tabelas, 59 policies, **RLS ligada e `force` em todas**, zero função sem `search_path` fixo.
DDL completo em `C:\Users\João\projetos\sic-hf\docs\ARQUITETURA.md` §2.

## Os quatro papéis

| Papel | Vê | Não vê |
|---|---|---|
| `admin` | tudo, mais gestão de equipe e custo de IA | — |
| `advogada` | tudo do cliente: patrimônio, relatório, croqui, documentos | gestão de equipe |
| `relacionamento` | pessoa, jornada, formulário, ligação, agenda, **só a faixa de patrimônio declarada** | valor de patrimônio, IR, contrato social, relatório, croqui |
| `assistente` | agenda e contato | move card na esteira, patrimônio, documentos |

**Acesso é por convite.** Não existe trigger em `auth.users` criando perfil. O admin cria a linha em `perfis_equipe` com o e-mail; no primeiro login, `public.vincular_perfil()` casa `auth.uid()` com a linha pré-autorizada. Quem se cadastra sem convite fica com `app.papel()` NULL e a RLS **nega tudo** — fail-closed.

## Blocos

| Migration | O que entra |
|---|---|
| 0001 | extensões, enums, schema `app`, funções de papel, config de busca `pt_unaccent` |
| 0002 | `perfis_equipe` + o vínculo por convite |
| 0003 | `pessoas`, `edicoes_seminario`, `participacoes_seminario` |
| 0004 | `jornadas`, `jornadas_transicoes`, `etapas_jornada_ordem`, `transicoes_permitidas` |
| 0005 | `consentimentos` (LGPD, texto congelado na linha) |
| 0006 | `formularios`, `formularios_respostas`, `ligacoes_estrategicas` |
| 0007 | `familiares`, `patrimonio_itens` — **PII sensível** |
| 0008 | `sessoes_viabilidade`, `agendamentos`, `relatorios_sessao` |
| 0009 | `prompts_versoes`, `modelos_ia_precos`, `execucoes_ia`, `briefings` + seed dos 3 prompts v1 |
| 0010 | `croquis`, `croqui_apresentacoes`, `croqui_analises` |
| 0011 | `produtos`, `ofertas`, `pagamentos`, `webhooks_eventos` + `processar_pagamento_hotmart` |
| 0012 | `documentos`, `documentos_acessos`, bucket privado `documentos-sensiveis` |
| 0013 | `mensagens_templates`, `mensagens_agendadas` + o motor da régua em trigger |
| 0014 | `eventos_timeline` + trigger em 12 tabelas |
| 0015 | views `vw_jornada_kanban`, `vw_indicadores_esteira` (`security_invoker`) |
| 0016 | seed de dev (6 jornadas de exemplo, `origem_dado='exemplo'`) |
| 0017 | `search_path` fixo em toda função nossa (achado do linter) |

## Invariantes que o BANCO garante sozinho

Isto não depende de o app lembrar de verificar:

- **Uma jornada aberta por pessoa** — índice único parcial `where desfecho='aberta'`.
- **Etapa nunca regride** e **nunca cai abaixo do nível pago** — trigger + `etapas_jornada_ordem`. Estorno não rebaixa.
- **Transição só pelas permitidas** — tabela `transicoes_permitidas`, não `if` no código. Mudar a esteira é `INSERT`, não deploy.
- **A advogada não é agendada em dois lugares** — exclusion constraint GiST em `agendamentos`.
- Um agendamento confirmado por sessão · um briefing atual por jornada · uma análise de croqui atual · um prompt ativo por chave · um croqui pronto por jornada.
- **Mensagem da régua nunca duplica** — `chave_idempotencia` única.
- **Pagamento nunca duplica** — `unique (origem, transacao_externa_id)`.
- Desfecho ≠ aberta exige motivo — check constraint.

## Decisões de segurança que parecem bug e não são

- **`webhooks_eventos` tem RLS ligada e ZERO policy.** É proposital: só `service_role` toca, porque o payload bruto carrega PII do comprador. RLS sem policy nega tudo.
- **`execucoes_ia`, `briefings`, `croqui_analises` e `pagamentos` não têm policy de INSERT/UPDATE para `authenticated`.** São gravados pela rota de servidor com `service_role` — conteúdo, fontes usadas e custo não podem ser forjados pelo cliente.
- **`jornadas_transicoes` e `eventos_timeline` são append-only** — sem policy de update/delete. RLS nega por ausência.
- **Views com `security_invoker`** — sem isso, uma view viraria porta dos fundos para o patrimônio que a policy negou.
- **Nenhuma tabela tem policy de DELETE.** Baixa é `ativo=false` ou `desfecho`.

## Armadilhas encontradas ao aplicar (03/09)

1. `app.papel()` é `language sql` e referencia `perfis_equipe`, criada só na migration seguinte — o Postgres valida o corpo no `create` e falha com 42P01. Resolvido com `set check_function_bodies = off` no topo de 0001.
2. `unaccent()` é `STABLE`, não `IMMUTABLE`, e **não pode entrar em índice**. O índice de busca por nome usa uma text search configuration própria, `pt_unaccent` (cópia de `portuguese` + dicionário `unaccent`), porque `to_tsvector(regconfig, text)` é `IMMUTABLE`.
3. A comparação de etapa nas views usa a **ordem de declaração do enum**, que coincide com a ordem da esteira por construção. **Etapa nova sempre entra no fim do enum** + linha em `etapas_jornada_ordem`; inserir no meio quebra os indicadores em silêncio.

## Fase 4 (05/09/2026) — migrations 0050–0061, todas aplicadas

0050 enum `confirmacao` (sozinha, por causa de `alter type add value`) · 0051 presença (`agendamentos.presenca_confirmada_em/_via`), sala (`link_sala_origem`, `sala_solicitada_em`, `registrar_link_sala`), `links_publicos.agendamento_id`, `produtos.url_checkout`, `tarefas.tipo`, RPC pública `confirmar_presenca_publico`, **núcleo `app.confirmar_horario_da_sugestao`** (único caminho de "gravar horário entre os ofertados"; consome o link), `reivindicar_mensagens_pendentes(int, canal_mensagem[])` com holds · 0052 `regua.ultimo_cron_em`, `sala.provedor`, `perfis_equipe.onboarding_visto_em`, views kanban/sessões do dia/pendências ampliadas · 0053 `ligacoes_ia` (7 estados, reaper, gatilho desligado por B33) · 0054 `mensagens_recebidas` · 0055 PDF do material (`ck_pdf_exige_aprovacao`), catálogo de modelos por dor · 0056 `parametros_metodo` versionado (ITCMD/ITBI exigem base legal; nasce sem alíquota) · 0057 `cenarios_patrimoniais` + `cenario_rubricas` com procedência e trigger de multiplicação · 0058 `diagnosticos_sv` (blocos com `visivel_ao_cliente`; `o_que_falta` nunca visível) · 0059 `respostas_seminario`, `patrimonio_itens.origem_valor`, prompts v3/v2 inativos · 0060 `vw_cenarios_totais` com `rubricas_faltantes` (total NULL enquanto faltar rubrica padrão) + `pdf_disponivel` no payload de material · 0061 hardening (ver Seguranca).

Armadilhas novas: fixtures de teste com o mesmo `advogada_id` e mesmo horário colidem em `ex_agenda_sem_sobreposicao`; comparação `papel = texto` exige cast `::papel_equipe`; dado de teste em produção só na jornada `origem_dado='exemplo'`.

## Fase 5 (05/09/2026) — migrations 0062–0070, todas aplicadas e provadas

0062 `parametros_metodo.faixas jsonb` (`unidade='faixas'`, `app.faixas_validas`, XOR com `valor`, `vw_parametros_faixas` — **0062b** corrige `faixas->'faixas'`), seed dos parâmetros do MÉTODO (hora 1.800, deságio 20%, IR ganho de capital por faixa, junta/contabilidade por célula, incentivos, deduções, sinal 10%, membership 6 meses isentos, IBS/CBS, presumido, CDI, risco de bloqueio) + `configuracoes` `croqui.horas_por_ato` (vazia — sem ela T15/T16 nascem ausentes), `croqui.sinal_modelo_referencia`, `parametros.divergencias` · 0063 `croqui_calculos` (versão imutável: entrada + parâmetros + resultado snapshot; `atual` só pela RPC; `vw_croqui_calculo_atual`) · 0064 `vw_automacoes_jornada` (mensagens, ligações IA, presença, pagamento — sem valor/destinatário/transcrição) · 0065 radar: `documentos.tipo` 4→10, `documentos.item_ref`, `documentos_pedidos` (ato humano: pedido/conferido/dispensado), template `documentos_pedido`, RPC `enfileirar_pedido_documentos` (service_role, idempotente por dia) · **0065b/0065c** revoke dos privilégios herdados do default do Supabase · 0066 prompt `agente_croqui_narrativa` v1 INATIVO (2.048 bytes), `croqui.uf_domicilio_vantajoso`, `croqui.mapa_rubricas`, comentários de depreciação em `cenarios_*` (viram gaveta de override) · 0067 `execucao_modelos/marcos/jornada_marcos` (19 marcos do cronograma real, dependências) · 0068 `registrar_documento_publico` com `p_item_ref` validado (chave opaca no navegador) · 0069 RPCs de croqui só `service_role` com `p_criado_por` validado por `app.perfil_ve_patrimonio`, `croqui_id` imutável, trigger `trg_documento_item_ref` em `documentos` · **0070** (correção da trava do Fable) `eventos_timeline.tipo` ganha tipos próprios `croqui_calculo` / `croqui_exportacao` / `croqui_narrativa` — **evento de cálculo, exportação ou narrativa NUNCA nasce como `tipo='croqui'`**, porque `sinaisDaFicha()` deriva o status do croqui do evento `croqui` mais novo (contrato em `src/types/banco.ts` `TipoEventoTimeline`); `search_path` nas 4 funções de trigger da 0065/0067; grants explícitos de `vw_automacoes_jornada`; tabela `croqui_narrativas` (versionada, `atual` único por croqui, schema_versao) + RPC `registrar_croqui_narrativa` (só `service_role`, autor validado por `app.perfil_ve_patrimonio`). Provas: `scripts/verificacao-0069.sql` e `scripts/verificacao-0070.sql` (7/7).
Invariantes novos: célula ausente nunca é zero (motor + `.docx` + slide); base do ITCMD = mercado (1 e 2 células) / DIRPF (3); honorário da holding = hora × horas + 10%; parâmetros em divergência travam a tabela dependente.
