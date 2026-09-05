# Segurança — SIC-HF

Auditoria adversarial rodada em **03/09/2026**, contra o banco de verdade e o app rodando (não só leitura de código): PostgREST direto com JWT de cada papel, webhook chamado ao vivo, bundle do cliente conferido com grep.

**Placar:** 0 crítico · 2 alto · 2 médio · 3 baixo.

## O que já está provado que segura

- **RLS de ponta a ponta.** `relacionamento` e um usuário autenticado **sem convite** não leem `patrimonio_itens`, `relatorios_sessao`, `croquis`, `croqui_analises`, `documentos`, `execucoes_ia` nem `webhooks_eventos` — testado com dado real plantado de propósito, não com tabela vazia. As views com `security_invoker` filtram igual à tabela base.
- **Webhook Hotmart falha fechado.** Sem secret na env → **503**, nunca 200. Comparação em tempo constante. Idempotência por `unique(origem, transacao_externa_id)`. `nivel_pago` deriva de `produtos.tipo`, não do valor do payload — payload forjado com valor maior **não eleva o nível pago**.
- **Documentos.** Path traversal impossível (o servidor monta o caminho, o cliente nunca escolhe). Mime validado por **assinatura de bytes**, não por `Content-Type`. Upload só por `service_role`. URL assinada de 300 s com registro em `documentos_acessos`.
- **Escalonamento.** `relacionamento` tentando se promover a `admin` via PostgREST: 0 linhas afetadas. Usuário sem convite tentando se inserir em `perfis_equipe`: 42501.
- **`service_role` não vaza para o cliente** — confirmado por grep no bundle real, não só no código-fonte.
- `execucoes_ia` guarda só o `sha256` do contexto, nunca o prompt com PII.

## Achados e o que eles ensinam

### 1. Policy `for update` que só checa papel não é policy de negócio (ALTO)
`mensagens_agendadas` tinha `using (app.eh_interno())`. A regra real — só WhatsApp, só de `pendente` para `enviada`, campos carimbados pelo servidor — vivia **só na rota**. Pelo PostgREST direto, um perfil de relacionamento trocou o destinatário de uma mensagem de **e-mail** para um endereço externo e marcou como "enviada" com data forjada.
Dois estragos: vazamento do link da sala com o nome do cliente, e **cliente que nunca é avisado da própria sessão enquanto o sistema exibe "enviada" como prova**.
**Lição:** se a regra de negócio está só na rota, ela não existe — o PostgREST é uma segunda porta para a mesma tabela. Regra que protege dinheiro ou comunicação vai para o banco: trigger ou RPC `security definer`, com `UPDATE` revogado de `authenticated`.

### 2. A segunda IA não herda a trava da primeira (ALTO)
O Briefing tem trava de consentimento `tratamento_ia`. O **Agente do Croqui**, escrito depois, mandava nome completo, nomes de familiares, valores absolutos de patrimônio e a transcrição inteira para a Anthropic **sem gate nenhum**.
**Lição:** trava de LGPD é por **caminho de saída de dado**, não por feature. Toda rota nova que fala com IA precisa da mesma pergunta: *o que sai daqui, e quem autorizou?* Ver [[05 - Decisoes/2026-09-03 - Decisoes fundacionais do SIC-HF]] e o BLOQUEIO B3.

### 3. Allowlist na chave de topo não é allowlist (MÉDIO)
`contexto-briefing.ts` copiava o JSONB inteiro das respostas do formulário. A pergunta `p1` é literalmente *"Qual seu nome completo?"* — anulando o cuidado, logo acima, de truncar para o primeiro nome. E `p12`/`p13`/`p16` são texto livre onde o cliente pode ter escrito endereço ou CPF.
**Lição:** allowlist tem que descer até o **conteúdo**, não parar no nome do campo.

### 4. Termo de busca é entrada de usuário, inclusive para o PostgREST (MÉDIO)
`/api/jornadas` sanitizava `%` e `_` (meta-caracteres de `LIKE`) e interpolava o termo dentro de `.or(...)`. Mas `,`, `(`, `)` e `.` são meta-caracteres da **gramática de filtro do PostgREST**. Um termo com `)*or(etapa.eq.holding_contratada` reescreveu a árvore lógica e devolveu todas as linhas.
**Lição:** `.or()` montado por interpolação de string é injeção. Escapar o certo, ou RPC parametrizada.

### 5. `CREATE FUNCTION` concede EXECUTE a PUBLIC por padrão (BAIXO)
Só 6 das ~20 funções de `app.*` tinham `revoke`. Não é explorável hoje porque o PostgREST não expõe o schema `app` — mas isso é um **clique no painel** de distância, sem migration e sem revisão de código.
**Lição:** não deixe a configuração de um painel ser a única linha de defesa.

### 6. Rate limit por `X-Forwarded-For` não validado (BAIXO)
Header forjável → o limite por IP nunca acumula. Não é bypass de auth (o hottok segura), mas o rate limit vira decorativo.

### 7. Endpoint de IA sem cooldown (BAIXO)
`forcar_regeracao: true` em laço custa dinheiro real (`claude-opus-5`, US$ 5/25 por MTok). Falta teto por jornada e por usuário.

## Armadilha de configuração que derrubou tudo (e não apareceu no build)

`grant usage on schema app to authenticated` **faltava**. Sem ele, toda policy que chama `app.eh_interno()` falha com `42501 permission denied for schema app` e **o sistema inteiro responde 500** — com `tsc` limpo, `eslint` limpo e `npm run build` verde.
Só apareceu ao abrir a tela logado, no navegador. Grant de `EXECUTE` na função não basta: o papel precisa poder **entrar** no schema. Corrigido na migration `0018`.

## Segue aberto (com gatilho, não "algum dia")

| O que | Quando fechar |
|---|---|
| `pat_wr` e `rel_wr` ainda são `for all`, o que inclui **DELETE** por PostgREST direto para admin/advogada — mesma classe do ALTO 1. O molde da correção já existe na migration `0021`. | **Antes da primeira linha de patrimônio de cliente real entrar no banco.** |
| Webhook não reprocessa evento que falhou: reentrega da Hotmart cai no caminho "já recebi, 200" sem olhar `processado_em`. Corolário: alguém que insira um `evento_externo_id` antes bloqueia o processamento do evento legítimo. E não existe tela de pendências — falha de pagamento hoje só aparece por SQL. | **Junto com as credenciais da Hotmart (BLOQUEIO B7).** |
| Texto livre do formulário (`p12`/`p13`/`p16`) vai para a IA sem gate — o cliente pode ter escrito endereço, CPF ou nome de terceiro ali. Só a transcrição tem trava de consentimento. | **Com a decisão B3** (consentimento de tratamento por IA), da Dra. Elaine. |
| Rate limit do webhook confia em `X-Forwarded-For` e é por processo. | Quando a Hotmart entrar em volume. |
| Sem cooldown nos endpoints de IA: `forcar_regeracao` em laço custa dinheiro real. | Antes de abrir o sistema para mais gente da equipe. |

---

## Auditoria da Fase 2 (03/09/2026)

Rodada contra o banco real e o app de pé, com PostgREST direto para cada papel.
**Placar: 0 crítico · 2 alto · 3 médio · 2 baixo.** Os 2 altos e 2 médios corrigidos no mesmo dia.

### O que a Fase 2 ensinou

**1. Diagnóstico plausível não é diagnóstico.** O formulário público respondia 500 em toda tentativa — o fluxo mais usado da fase, quebrado. O pentest levantou falta de grant de `app.registrar_evento_timeline` para `anon`: plausível, porque essa classe de bug já mordeu o projeto três vezes, e honestamente marcada como "hipótese, não confirmada por log". Estava errada. O grant foi concedido e o 500 continuou. A causa real só apareceu no log do Postgres: `formularios_respostas.origem` tinha um `CHECK` escrito na 0006, antes de existir superfície pública, que não aceitava `'cliente_link'`. **Leia o erro real antes de corrigir.**

**2. RLS que filtra não substitui privilégio que não existe.** `anon` tinha `GRANT SELECT` em 33 tabelas. Nenhuma linha vazou — a RLS segurou tudo, testada em 36 tabelas. Mas o grant é o cinto de segurança para o dia em que uma policy nascer errada, e isso **já aconteceu neste projeto uma vez**. Zerado, com `alter default privileges` para a próxima tabela não repetir.

**3. `for all` em policy inclui DELETE.** Fechado nas tabelas com PII que sobraram da fase 1.

### Verificado por ataque, não por leitura

- `anon` leva `42501 permission denied` em `pessoas`, `jornadas`, `patrimonio_itens`, `documentos`, `transcricoes`, `links_publicos`, `formularios_respostas`, `configuracoes`.
- Rate limit por token: 10 requisições passam, a 11ª leva 429. Variar `X-Forwarded-For` **não afrouxa** — o limite é por token, em tabela.
- Token com um caractere trocado e token inexistente respondem **idêntico**, byte a byte.
- Usuário autenticado **sem convite** leva 401 em toda API interna.
- Sem `service_role`, upload e IA respondem **503 nomeando a variável que falta** — nunca 200 com promessa falsa.
- Link de material sem material aprovado entrega "link não disponível", nunca conteúdo inventado.
- `relacionamento` não lê uma linha das 70 transcrições reais.

### Segue aberto — com gatilho

| O que | Quando fechar |
|---|---|
| A flag `conhecimento.analise_ia_habilitada` é um boolean que qualquer admin liga, sem registrar quem decidiu nem a base legal. Deveria ser uma tabela de decisão jurídica, e o trigger olhar para lá. | **Antes de a `ANTHROPIC_API_KEY` entrar.** |
| `app.registrar_evento_timeline` com grant para `anon` (0038) — desvio do desenho "só 4 funções públicas". Inerte enquanto o schema `app` não for exposto. | Quando alguém mexer nos grants de novo. |
| Acessibilidade formal das telas novas: conhecimento, públicas e conduzir sessão. | Antes de cliente real usar. |
| Emissão de link de material antes da aprovação: não vaza, mas a tela não avisa. | Junto com a próxima mexida na Ficha 360. |

## Fase 4 (05/09/2026) — pentest + hardening 0061

Pentest da Fase 4 (Fable): 0 crítico/alto no relatório, 4 BAIXO, 3 INFO. O SQL de prova rodado no banco pelo orquestrador achou **1 ALTO real**: `app.ve_patrimonio()`/`app.eh_admin()` (0001) devolviam **NULL** para usuário autenticado sem perfil, e `if not NULL` não levanta — `registrar_diagnostico_sv` gravava linha para um intruso. Corrigido na origem (`coalesce(..., false)`) na `0061_hardening_pentest_fase4.sql`, que também fechou: CHECK https em `sessoes_viabilidade.link_sala`; `n8n/ligacao` sem ocupação de `id_evento` por tentativa inválida (`src/server/integracoes/livro-razao.ts`, mesmo padrão do Hotmart/sala); `mensagens_recebidas` com revoke de `jornada_id/vinculada_*` + trigger de coerência e carimbo; `cenario_rubricas` só aceita parâmetro ativo e da UF do cliente; `presenca_confirmada_em` carimbado pelo servidor; `diagnosticos_sv.atual` só muda pela RPC e aprovação leva o próprio perfil. Provado com `scripts/verificacao-0061.sql` (8/8) e `scripts/verificacao-fase4.sql` (17/17), ambos transacionais.

**Lição:** gate de papel tem de devolver `false`, nunca `NULL` — todo `if not gate()` silencia com NULL. Reteste do BAIXO antigo (erro de provedor ecoando prompt): sem regressão nos caminhos novos. Achados INFO fora do repo: `callback_url` do n8n vem do `metadata` da Vapi (aceitável, mas o WEBHOOK poderia fixar a URL); pepper de produção; senha do admin de teste.

## Fase 5 (05/09/2026) — privilégio herdado do `alter default privileges`

Varredura feita ao rodar o roteiro da 0065/0067: **51 tabelas** de `public` tinham DELETE concedido a `authenticated` sem policy de DELETE, e ~20 tinham INSERT sem policy de INSERT — herança do default do Supabase (`grant all on tables to authenticated`). Efeito prático era nulo por causa do RLS `force` (DELETE afeta 0 linhas; INSERT dá 42501), mas `grant update (colunas)` de 0063/0065/0067 era decorativo: o UPDATE em todas as colunas continuava concedido (só a FK barrou `mensagem_id` no teste). Corrigido: **0065b** (revoke all + grants explícitos nas tabelas novas) e **0065c** (revoke dinâmico de DELETE/INSERT onde não há policy, em toda tabela de `public`).

**Regra:** em tabela nova, `revoke all on <t> from public, anon, authenticated` ANTES de qualquer `grant` — senão o grant por coluna não restringe nada. Verificação de auditoria: `has_table_privilege('authenticated', t, 'delete')` × existência de policy.

## Fase 5 (05/09/2026) — pentest + hardening 0069/0070

Pentest da Fase 5 (Fable): **0 crítico/alto**, 1 MÉDIO, 4 BAIXO, 10 INFO. O MÉDIO (CWE-345): `registrar_croqui_calculo` (0063) era `security definer` com EXECUTE para `authenticated` e aceitava `p_resultado`/`p_entrada`/`p_parametros` do chamador — a rota barrava (422 zod strict), o banco não. **0069**: `app.perfil_ve_patrimonio(uuid)` (gate pelo PERFIL, porque sob `service_role` não há `auth.uid()`); `registrar_croqui_calculo`/`fixar_croqui_calculo` recriadas com `p_criado_por` validado, `revoke all` + EXECUTE só de `service_role`, assinatura antiga dropada (sobrecarga ambígua quebra em runtime); `croqui_id` imutável; trigger em `documentos` zera `item_ref` que não pertence à pessoa da jornada. A escrita vai por `criarClienteAdmin()`; a **leitura** continua no cliente da sessão, para a RLS decidir quem vê aquele patrimônio.

**0070** (ressalvas de segurança da trava do Fable): `vw_automacoes_jornada` com revoke/grant explícito (anon → 42501); `set search_path = public, pg_temp` nas 4 funções de trigger da 0065/0067; `croqui_narrativas` com RLS forçada, sem INSERT/UPDATE/DELETE para `authenticated`, RPC `registrar_croqui_narrativa` só `service_role` com gate por perfil (relacionamento → 42501); `POST /api/documentos` deixou de ecoar mensagem crua do Storage/Postgres (mensagem humana + `registrar_erro`).

**Lições:** (1) "o cliente nunca manda o resultado" tem de valer no banco, não só no zod da rota — toda RPC `security definer` que grava snapshot precisa de gate de papel dentro dela; (2) ao verificar ACL de função por texto, PUBLIC é `{=X/` ou `,=X/` — o padrão `%=X/%` casa com `postgres=X/postgres` e dá falso positivo (aconteceu no roteiro da 0070); (3) função de trigger sem `search_path` fixo é achado recorrente — conferir `pg_proc.proconfig` em toda migration nova.
