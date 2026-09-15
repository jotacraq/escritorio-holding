-- 0105_copiloto_participantes_cas.sql
-- Fase 10 — correção de corrida achada em auditoria pós-entrega (15/09/2026):
-- `registrarEventoParticipante` (entrada-bot.ts) fazia
--   1) select participantes  2) aplica em memória  3) update incondicional
-- SEM nenhuma trava entre a leitura e a escrita. Medido em produção: o
-- webhook da Recall entrega join/leave em RAJADA (10 joins + 5 leaves numa
-- sessão de teste, vários no mesmo segundo) — dois eventos concorrentes na
-- MESMA sessão liam o mesmo array, cada um aplicava seu próprio evento em
-- memória, e o segundo UPDATE sobrescrevia o primeiro por completo. Efeito
-- real: participante perdido -> decisor marcado ausente estando presente, e
-- a contagem que alimenta o contexto de IA fica errada.
--
-- 100% ADITIVA. Nenhuma tabela, coluna ou policy é alterada — só entra uma
-- função nova.
--
-- POR QUE ESTA FORMA, E NÃO AS OUTRAS DUAS JÁ EM USO NA CASA:
--   - Claim por INSERT (0096, copiloto_ciclos) não serve: aqui não existe
--     "primeiro a chegar vence", os DOIS eventos (um join e um leave, ou dois
--     joins de pessoas diferentes) precisam ficar no array final — não é uma
--     claim de janela, é um MERGE.
--   - Claim por `update ... where x is null` (warmup.ts) não serve pelo
--     mesmo motivo: não há um estado "ainda não aconteceu" binário para
--     travar — toda entrada de participante é válida e precisa sobreviver.
--   - O padrão que SERVE é o de `app.resolve_link_escrita` (0077): `select
--     ... for update` dentro de uma função `plpgsql`, serializando quem
--     escreve a MESMA linha. A diferença aqui é que o MERGE (herdar papel de
--     entrada anterior, achar a entrada aberta certa para fechar no leave,
--     filtrar o bot) é lógica de negócio RICA, já pura e testada em
--     TypeScript (`aplicarEventoParticipante`/`resolverPapelNoJoin`,
--     participantes.ts) — reescrevê-la em PL/pgSQL duplicaria uma regra que
--     já muda com frequência (papéis de fala entrou há 1 dia) em DUAS
--     linguagens que podem divergir em silêncio, o mesmo risco que a nota de
--     manutenção da 0093 já registra para `app.tem_consentimento`.
--
--   A solução: COMPARE-AND-SWAP dentro do lock. O TS continua lendo,
--   decidindo o papel e calculando o array final (`aplicarEventoParticipante`,
--   sem mudança nenhuma nessa função pura). A escrita passa a ser esta RPC:
--   ela tranca a linha (`for update`), confere se `participantes` AINDA é
--   igual ao que o TS leu (`p_participantes_esperados`) e só então grava
--   (`p_participantes_novos`). Se outro evento já escreveu no meio do
--   caminho, a comparação falha, NADA é gravado, e a RPC devolve o estado
--   ATUAL — o chamador reaplica o merge por cima dele e tenta de novo (mesmo
--   formato de retentativa que `registrarSegmentoDoBot`, no mesmo arquivo,
--   já usa para colisão de `ordem`). Igualdade de `jsonb` no Postgres é
--   estrutural (chave/valor), não textual — reordenar o array normalizaria
--   diferente e uma comparação por igualdade de array INTEIRO não teria como
--   dar falso-positivo por espaçamento/ordem de chave.
--
-- POR QUE NÃO PRECISA DE COLUNA DE VERSÃO NOVA: o próprio `participantes`
-- lido É o token de versão — não existe um 2º escritor que altere o array
-- para o MESMO valor por coincidência (cada evento é um join/leave real,
-- nunca um no-op), então comparar o array inteiro tem exatamente a mesma
-- força de um contador de versão dedicado, sem migration de schema.
--
-- ROTEIRO DE VERIFICAÇÃO: `explain (analyze)` PENDENTE — esta máquina não
-- tem acesso ao banco de produção (mesma ressalva já registrada em outras
-- migrations do copiloto, ex. 0091:132). A query do `for update` é por
-- `sessao_id`, PK da tabela (`sessoes_copiloto.sessao_id primary key`) — usa
-- Index Scan sobre a própria PK, não há índice novo para provar. Pendência:
-- MEDIDO EM PRODUÇÃO (fcfsnqqaphtamhrpuyoh, 15/09/2026), dentro de
-- `begin; ... rollback;` — plano real, nada persistido:
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
-- `LockRows` sobre `Index Scan using sessoes_copiloto_pkey`: o lock é por PK e
-- pega SÓ a linha daquela sessão. Duas sessões simultâneas nunca disputam o
-- mesmo lock — que é a propriedade de que a correção depende.
--
-- COMPORTAMENTO PROVADO contra o banco real (mesma transação, com rollback):
--   esperado = '[]'  (estado real)      → aplicado=true,  gravou
--   esperado = '[{"nome":"nao e isso"}]' → aplicado=false, devolveu o atual
-- Ou seja: o CAS recusa a escrita quando alguém passou na frente e entrega o
-- estado novo para o chamador reaplicar o evento. É exatamente o que impede a
-- perda silenciosa de participante.
--
-- APLICADA EM PRODUÇÃO em 15/09/2026 (`apply_migration`). `create or replace`
-- é idempotente: reaplicar não tem efeito colateral.
--
-- ROLLBACK:
--   drop function if exists public.registrar_participantes_copiloto(uuid, jsonb, jsonb);
-- ===========================================================================

create or replace function public.registrar_participantes_copiloto(
  p_sessao_id uuid,
  p_participantes_esperados jsonb,
  p_participantes_novos jsonb
) returns table (aplicado boolean, participantes jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_atual jsonb;
begin
  -- `for update`: quem grava participantes da MESMA sessão espera a
  -- transação anterior terminar — mesmo padrão de `app.resolve_link_escrita`
  -- (0077). Lock só da linha desta sessão; sessões diferentes nunca disputam
  -- o mesmo lock.
  select sc.participantes into v_atual
    from sessoes_copiloto sc
   where sc.sessao_id = p_sessao_id
     for update;

  if not found then
    raise exception 'sessao_copiloto_nao_encontrada: %', p_sessao_id using errcode = 'P0002';
  end if;

  -- CAS: só grava se ninguém escreveu por cima entre a leitura do chamador
  -- (fora desta transação) e agora. `is not distinct from` trata NULL como
  -- igual a NULL (participantes nasce '[]'::jsonb, nunca NULL, na prática —
  -- mas a comparação correta de jsonb sempre usa IS [NOT] DISTINCT FROM,
  -- nunca `=`/`<>`, que devolvem NULL para NULL e fariam o CAS falhar sempre
  -- num cenário que nunca deveria acontecer).
  if v_atual is not distinct from p_participantes_esperados then
    update sessoes_copiloto set participantes = p_participantes_novos
     where sessao_id = p_sessao_id;
    return query select true, p_participantes_novos;
  else
    return query select false, v_atual;
  end if;
end $$;

revoke execute on function public.registrar_participantes_copiloto(uuid, jsonb, jsonb) from public, anon, authenticated;
grant  execute on function public.registrar_participantes_copiloto(uuid, jsonb, jsonb) to service_role;

comment on function public.registrar_participantes_copiloto(uuid, jsonb, jsonb) is
  'CAS (compare-and-swap) de sessoes_copiloto.participantes sob select...for update. '
  'Fecha a corrida do webhook do bot (join/leave em rajada) sem duplicar em SQL a '
  'lógica de merge/papéis de fala, que continua pura e testada em '
  'src/server/copiloto/participantes.ts. Chamada só por '
  'entrada-bot.ts::registrarEventoParticipante, com retentativa (recalcula o merge '
  'sobre o estado devolvido) quando aplicado=false. Só service_role — mesma regra '
  'de todo caminho de escrita do copiloto (0091).';
