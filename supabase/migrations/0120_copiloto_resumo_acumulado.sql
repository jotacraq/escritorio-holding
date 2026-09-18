-- 0120_copiloto_resumo_acumulado.sql
--
-- MEMÓRIA DO COPILOTO — Fatia A (18/09/2026, pedido do dono depois do defeito
-- medido em produção na sessão real do Carlos Alberto, 2h05:
-- `sessoes_copiloto.resumo_acumulado` existe desde a 0091, está cabeado em
-- `contexto.ts:247,287` e em `types/copiloto.ts:303`, mas NUNCA foi escrito —
-- estava `{}` nas 3 sessões reais. A IA via só ~90s de transcrição
-- (`JANELA_TRANSCRICAO_SEGUNDOS`, contexto.ts) e acordava sem memória a cada
-- ciclo. Resultado: 122 perguntas distintas em 118 min, sendo 49 sobre
-- família (a família tem 2 filhas); no 4º quarto da sessão, com 2h já
-- ouvidas, ainda 8 perguntas sobre filhos. Prova de que memória resolve: o
-- tema BENS (que TEM memória via `inventario_acumulado`, 0111) cai de 11
-- para 4 perguntas no último quarto, enquanto FAMÍLIA (sem memória) sobe de
-- 6 para 15.
--
-- ESCOPO DESTA FATIA (decisão do dono, B72 — não reabrir): só
-- `perguntado[]`/`pendente[]`. SEM `fato_estabelecido`, SEM `fatos[]` — isso
-- é a Fatia B, fora deste escopo. `pendente` é sempre DERIVADO NO SERVIDOR
-- (nunca proposto pela IA, nunca gravado pela RPC como "vindo de fora" — é
-- resultado de `campos[]` do bloco menos `perguntado[]`, calculado em
-- `server/copiloto/resumo.ts::derivarPendente`).
--
-- VOCABULÁRIO DINÂMICO (decisão do dono, revertendo uma proposta anterior de
-- 6 categorias fixas por palavra-chave): `perguntado[].t` é o
-- `RoteiroCampo.id` do ROTEIRO ATIVO no momento da categorização — nunca um
-- enum fixo de categoria de negócio. Quando a Dra. Elaine publicar um
-- roteiro novo, o vocabulário acompanha sozinho, sem deploy nem migration de
-- dado. Consequência aceita e registrada: "empresa" (2º tema mais perguntado
-- na sessão real, 15 ocorrências) não tem `campo.id` próprio no roteiro v5
-- ativo — cai em `lista_bens`/`quem_paga_contas`, ou fica sem categorizar
-- (medido: ~35% das perguntas reais não categorizam, e isso é o
-- comportamento CORRETO — nunca força encaixe). Mexer no roteiro para criar
-- um campo de "empresa" é decisão de MÉTODO da Dra. Elaine, fora do escopo
-- de código.
--
-- SCHEMA DO JSONB (`sessoes_copiloto.resumo_acumulado`, respeita o CHECK de
-- 4096 bytes da 0091, que JÁ EXISTE — nenhuma alteração de coluna aqui):
--   { "v": 1,
--     "perguntado": [ {"t":"filhos_maiores_menores","em":"2026-09-18T14:02:50Z","n":4} ],
--     "pendente": ["regimes_casamento"],   -- campo.id também, DERIVADO no servidor
--     "cortado_em": null }
-- Tetos de PRODUTO (mais apertados que o CHECK, que é backstop, não meta):
-- `perguntado` ≤ 16, `pendente` ≤ 8, alvo operacional ≤ 3500 bytes — ver
-- `server/copiloto/resumo.ts::podarPorBytes` (poda o item MENOS RECENTE de
-- `perguntado` até caber, medido em `resumo.test.ts`, nunca deixa o CHECK do
-- banco recusar o UPDATE inteiro e perder a memória junto).
--
-- B76 — FAIL-CLOSED (decisão do dono, diferente do fail-OPEN de
-- `dossie_cliente`/`inventario_mencionado`): config ilegível ou desligada =
-- memória NÃO É LIDA nem ESCRITA, nunca o contrário. É dado NOVO, derivado só
-- da fala da sessão, sem outro lugar onde já apareça — "não sei se está
-- ligado" tem de cair no lado que não grava nada.
--
-- B75 — NÃO ATRAVESSA SESSÃO. Memória morre com a sessão (mesma coluna de
-- sempre, `sessoes_copiloto.resumo_acumulado`, sem FK para outra sessão nem
-- tabela de histórico entre sessões).
--
-- 🔴 EXPURGO — `server/copiloto/expurgo.ts::redigirResumoDaSessao` é NO-OP
-- deliberado nesta fatia: `perguntado[]` não guarda citação literal (só
-- `RoteiroCampo.id`, timestamp, contagem), então não há "evidência" para
-- redigir. A função já existe e já está cabeada nos 2 pontos de
-- `carimbarSessoesSemPendencia` (mesmos pontos de `redigirInventarioDaSessao`)
-- para o expurgo CONHECER o campo desde já — quando a Fatia B acrescentar
-- `fatos[]` com evidência, o corpo dessa função troca sem precisar descobrir
-- que falta um caminho de redação para um campo que já está em produção há
-- dias (achado do arquiteto na revisão desta entrega, risco real de pentest).
--
-- POR QUE RPC CAS (COMPARE-AND-SWAP), CÓPIA ESTRUTURAL de
-- `registrar_participantes_copiloto` (0105) — MESMO RACIOCÍNIO daquela
-- migration, aplicado aqui: o ciclo automático (`ciclo.ts`, a cada ~20s) e o
-- botão "Me ajuda agora" (`sugestao/route.ts`) podem escrever a MESMA sessão
-- quase ao mesmo tempo — sem trava, o 2º UPDATE sobrescreveria o 1º por
-- completo (mesma corrida que a 0105 fechou para `participantes`). O TS
-- continua lendo, categorizando e calculando o array final
-- (`acumularResumo`, função pura e testada em `resumo.test.ts`) — a escrita
-- passa a ser esta RPC: tranca a linha (`for update`), confere se
-- `resumo_acumulado` AINDA é igual ao que o TS leu
-- (`p_resumo_esperado`) e só então grava (`p_resumo_novo`). Se outro request
-- já escreveu no meio do caminho, a comparação falha, NADA é gravado, e a
-- RPC devolve o estado ATUAL — o chamador (`resumo.ts::gravarComRetentativa`)
-- reaplica o merge por cima dele e tenta UMA vez a mais (mesmo formato de
-- retentativa que `participantes.ts`/`entrada-bot.ts` já usam para a 0105).
-- Falhando de novo, desiste com `registrarErro` — nunca segura o caminho
-- quente do ciclo com uma 3ª tentativa.
--
-- POR QUE NÃO PRECISA DE COLUNA DE VERSÃO NOVA: mesmo raciocínio da 0105 — o
-- próprio `resumo_acumulado` lido É o token de versão. Igualdade de `jsonb`
-- no Postgres é ESTRUTURAL (chave/valor), não textual — reordenar chaves não
-- produz falso-positivo nem falso-negativo na comparação.
--
-- 100% ADITIVA. Nenhuma tabela, coluna ou policy é alterada — só entra uma
-- função nova e uma chave nova em `configuracoes`.
--
-- ROLLBACK:
--   drop function if exists public.registrar_resumo_copiloto(uuid, jsonb, jsonb);
--   delete from configuracoes where chave = 'copiloto_sessao.resumo_acumulado';
--
-- ===========================================================================
-- AS 5 PERGUNTAS DO PROTOCOLO DE SUSTENTABILIDADE
-- ===========================================================================
--
-- 1. Escala — a RPC escreve 1 linha (a própria sessão, por PK). O jsonb tem
--    TETO DURO (CHECK de 4096 bytes da 0091 + tetos de produto de 16/8 itens
--    aplicados em TypeScript antes de chamar a RPC) — não cresce com a
--    duração da sessão além desse teto. Em runtime: 1 chamada por sugestão
--    da IA que tiver `proxima_pergunta` categorizável (não toda chamada de
--    IA — a maioria não categoriza, ver comentário de `acumularResumoNaSessao`).
--
-- 2. Índice — o `for update` é por `sessao_id`, PK de `sessoes_copiloto`
--    (0091) — Index Scan sobre a própria PK, sem índice novo para provar.
--    Ver medição real na seção 8 abaixo.
--
-- 3. Frequência — o kill-switch entra no MESMO `Promise.all` que `ciclo.ts`
--    já usa para `timeout_ms`/`max_tokens`/`acerto_erro_ativo` (0114/0119) —
--    ZERO round-trip novo no caminho quente de leitura. A ESCRITA (a RPC em
--    si) só acontece depois do INSERT de `copiloto_sugestoes` confirmado, e
--    só quando há pergunta nova categorizável ou pendente a recalcular —
--    mesma disciplina de "caminho comum sem custo extra" de
--    `acumularInventarioNaSessao` (0111).
--
-- 4. Repetição — não aplicável: 1 sessão, 1 linha, escrita pelo servidor
--    (ciclo automático OU rota sob demanda, nunca os dois ao mesmo tempo sem
--    a trava CAS desta migration resolver a corrida).
--
-- 5. Reversão — dois caminhos, sem deploy:
--      - `update configuracoes set valor='false'::jsonb where
--        chave='copiloto_sessao.resumo_acumulado'` — desliga leitura E
--        escrita (fail-CLOSED, B76): a IA para de receber o bloco E nenhuma
--        chamada nova grava nele. O que já foi acumulado fica intacto na
--        coluna (não apaga, só para de ler/escrever).
--      - `drop function` do rollback acima remove a RPC por completo — o
--        chamador (`resumo.ts::chamarCas`) trata erro/ausência de retorno
--        como falha silenciosa (`registrarErro`, nunca lança), então
--        remover a função não derruba o ciclo, só para de acumular memória.
--
-- MEDIÇÃO — `explain (analyze)`: PENDENTE, mesma ressalva já registrada em
-- 0105/0111/0114/0115/0117/0119 (este agente não tem credencial de banco de
-- produção nesta máquina e não buscou nenhuma — regra da casa,
-- `agente_nao_busca_credencial_producao`). O padrão de plano é IDÊNTICO ao
-- já medido e colado na 0105 (mesma forma de função: `select ... for update`
-- por PK de `sessoes_copiloto`, mesmo `LockRows` sobre `Index Scan using
-- sessoes_copiloto_pkey`) — copiado aqui como referência do que se espera,
-- NÃO como medição desta migration:
--
--   LockRows  (cost=0.14..2.37 rows=1 width=38)
--             (actual time=0.200..0.203 rows=1 loops=1)
--     Buffers: shared hit=3 dirtied=1
--     ->  Index Scan using sessoes_copiloto_pkey on sessoes_copiloto sc
--           (cost=0.14..2.36 rows=1) (actual time=0.038..0.039 rows=1)
--           Index Cond: (sessao_id = '755d87d7-...'::uuid)
--           Buffers: shared hit=2
--   Planning Time: 0.423 ms · Execution Time: 0.306 ms
--
-- COMANDO EXATO A RODAR quando houver banco (dentro de begin; ...; rollback;
-- — nunca persistir):
--
--   begin;
--   explain (analyze, buffers)
--   select registrar_resumo_copiloto(
--     '<uuid de uma sessao real>'::uuid,
--     (select resumo_acumulado from sessoes_copiloto where sessao_id = '<mesmo uuid>'),
--     '{"v":1,"perguntado":[{"t":"filhos_maiores_menores","em":"2026-09-18T14:00:00Z","n":1}],"pendente":[],"cortado_em":null}'::jsonb
--   );
--   rollback;
--
-- CRITÉRIO DE DECISÃO: `LockRows` sobre `Index Scan using
-- sessoes_copiloto_pkey`, tempo sub-ms — mesmo padrão já aceito em 0105.
--
-- PROVA DO CAS (a rodar contra o banco real, dentro de begin;...;rollback;,
-- MESMO roteiro de `verificacao-0120.sql` §2-3):
--   esperado = estado real atual      → aplicado=true,  gravou p_resumo_novo
--   esperado = jsonb DIFERENTE do real → aplicado=false, devolve o atual
--
-- PROVA DO TETO DE BYTES (medida em TypeScript, `resumo.test.ts` — describe
-- "acumularResumo — poda por bytes"): 16 itens de `perguntado` + 8 de
-- `pendente` serializam a MUITO menos que 4096 bytes (medido: bem abaixo de
-- 3500, o alvo de produto) — `pg_column_size` no Postgres é sempre igual ou
-- levemente MAIOR que `JSON.stringify(...).length` em UTF-8 (overhead de
-- jsonb binário), e a margem de ~600 bytes entre o alvo de produto (3500) e
-- o CHECK (4096) cobre essa diferença com folga.
-- ===========================================================================

create or replace function public.registrar_resumo_copiloto(
  p_sessao_id uuid,
  p_resumo_esperado jsonb,
  p_resumo_novo jsonb
) returns table (aplicado boolean, resumo jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_atual jsonb;
begin
  -- `for update`: quem grava resumo_acumulado da MESMA sessão espera a
  -- transação anterior terminar — mesmo padrão de
  -- `registrar_participantes_copiloto` (0105) e `app.resolve_link_escrita`
  -- (0077). Lock só da linha desta sessão; sessões diferentes nunca disputam
  -- o mesmo lock.
  select sc.resumo_acumulado into v_atual
    from sessoes_copiloto sc
   where sc.sessao_id = p_sessao_id
     for update;

  if not found then
    raise exception 'sessao_copiloto_nao_encontrada: %', p_sessao_id using errcode = 'P0002';
  end if;

  -- CAS: só grava se ninguém escreveu por cima entre a leitura do chamador
  -- (fora desta transação) e agora. `is not distinct from` trata NULL como
  -- igual a NULL (na prática `resumo_acumulado` nunca é NULL — nasce
  -- `'{}'::jsonb`, 0091 — mas a comparação correta de jsonb sempre usa IS
  -- [NOT] DISTINCT FROM, nunca `=`/`<>`, que devolveriam NULL para NULL e
  -- fariam o CAS falhar sempre num cenário que nunca deveria acontecer).
  if v_atual is not distinct from p_resumo_esperado then
    update sessoes_copiloto set resumo_acumulado = p_resumo_novo
     where sessao_id = p_sessao_id;
    return query select true, p_resumo_novo;
  else
    return query select false, v_atual;
  end if;
end $$;

revoke execute on function public.registrar_resumo_copiloto(uuid, jsonb, jsonb) from public, anon, authenticated;
grant  execute on function public.registrar_resumo_copiloto(uuid, jsonb, jsonb) to service_role;

comment on function public.registrar_resumo_copiloto(uuid, jsonb, jsonb) is
  'CAS (compare-and-swap) de sessoes_copiloto.resumo_acumulado sob select...for update. '
  'Cópia estrutural de registrar_participantes_copiloto (0105) — fecha a mesma classe de '
  'corrida (ciclo automático + botão "Me ajuda agora" escrevendo a mesma sessão quase ao '
  'mesmo tempo) sem duplicar em SQL a lógica de categorização/acumulação/poda, que '
  'continua pura e testada em src/server/copiloto/resumo.ts. Chamada só por '
  'resumo.ts::acumularResumoNaSessao, com retentativa (recalcula o merge sobre o estado '
  'devolvido) 1 vez quando aplicado=false. Só service_role — mesma regra de todo caminho '
  'de escrita do copiloto (0091). Fatia A (18/09/2026, memória do copiloto): só '
  'perguntado[]/pendente[], sem fato_estabelecido/fatos[] (Fatia B, fora do escopo).';

insert into configuracoes (chave, valor, descricao) values
 ('copiloto_sessao.resumo_acumulado', 'false'::jsonb,
  'Kill-switch FAIL-CLOSED (B76, decisão do dono) da memória do copiloto — Fatia A, '
  '18/09/2026, migration 0120. Diferente do fail-OPEN de copiloto_sessao.dossie_cliente/ '
  'inventario_mencionado: config ilegível ou ausente faz resumoAcumuladoEstaAtivo() '
  '(server/copiloto/resumo.ts) devolver FALSE — nem lê nem escreve. Nasce FALSE (não '
  'ligado por padrão: o dono confere e ativa depois de medir o impacto na sessão ao '
  'vivo, mesma disciplina de outras features novas do copiloto). Controla os DOIS lados: '
  '(1) contexto.ts bloco E — sem isto, resumo_acumulado sai null do contexto de IA; '
  '(2) resumo.ts::acumularResumoNaSessao — sem isto, nenhuma escrita acontece em '
  'sessoes_copiloto.resumo_acumulado, mesmo com pergunta nova da IA. '
  'Lido por lerConfiguracaoBool (server/ia/configuracao.ts).')
on conflict (chave) do nothing;
