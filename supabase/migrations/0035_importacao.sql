-- 0035_importacao.sql
-- ONDA 2, agente B-2A — importação de leads por edição de seminário, em DUAS
-- FASES (prévia -> confirmação). Ver docs/ARQUITETURA-FASE-2.md §4.6 e
-- BLOQUEIO B18: não existe layout fixo de CSV — o operador casa coluna do
-- arquivo -> campo do domínio na tela; o mapa fica salvo em `mapa_colunas` e
-- pode ser reaproveitado num upload futuro (o backend nunca hardcoda cabeçalho).
--
-- Trava que vem do histórico do João (sic-hf-brain,
-- feedback_ingestao_que_poda_precisa_de_trava.md): mapa de coluna errado já
-- apagou 59 linhas em silêncio noutro sistema. Aqui:
--   * fase 1 (prévia, via `POST /api/importacoes`) só LÊ o banco em lote e
--     grava a prévia — zero escrita em `pessoas`/`jornadas`/`participacoes_seminario`;
--   * fase 2 (confirmação, `public.confirmar_importacao`) só roda depois que o
--     operador VIU a prévia, e nunca atualiza nem apaga pessoa/jornada
--     existente — pessoa que já existe é só reaproveitada;
--   * `uniq_jornada_aberta_por_pessoa` (0004) é respeitado: pessoa com jornada
--     aberta nunca ganha outra; a prévia mostra isso ANTES de acontecer.
--
-- Semântica das 5 categorias de `importacoes_linhas.resultado` (a única parte
-- do rascunho do plano que era ambígua — "-- NOTA" pedia leitura, não cópia
-- cega; decisão registrada aqui e no relatório de entrega):
--   pessoa_nova              -> identidade (e-mail/telefone) não existe em
--                                lugar nenhum (nem no banco, nem em linha
--                                anterior deste mesmo arquivo). Cria pessoa +
--                                jornada + participação.
--   jornada_nova             -> identidade já existe NO BANCO (de antes desta
--                                importação), sem jornada aberta agora e sem
--                                participação nesta mesma edição. É "pessoa
--                                que volta em outra edição" (Glossario.md:
--                                participação é evento, não atributo). Cria
--                                jornada + participação; reaproveita a pessoa.
--   pessoa_existente          -> identidade já tem participação NESTA MESMA
--                                edição — seja porque já veio de uma
--                                importação anterior, seja porque é duplicata
--                                dentro do PRÓPRIO arquivo (2 linhas com o
--                                mesmo e-mail/telefone). Zero escrita; a linha
--                                só é linkada ao que já existe (rastro).
--   ignorada_jornada_aberta   -> identidade já tem jornada ABERTA (de
--                                qualquer edição) e essa jornada não é desta
--                                edição. Bloqueado pelo invariante do banco —
--                                a prévia avisa, a confirmação não tenta.
--   erro                      -> linha falhou validação (nome ausente, em
--                                geral) antes mesmo de resolver identidade.
--
-- `dados` (jsonb) por linha carrega DUAS partes: `bruto` (cabeçalho original
-- -> valor exatamente como leu do arquivo, para toda linha rastreável até o
-- arquivo e a linha de origem) e `normalizado` (valores já validados/limpos —
-- e-mail minúsculo, telefone em E.164, etc. — única fonte que
-- `confirmar_importacao` usa para gravar). A normalização mora só em
-- TypeScript (`src/server/importacao/normalizacao.ts`); esta função NUNCA
-- reimplementa parsing de telefone/e-mail em SQL, para não ter duas fontes de
-- verdade que podem divergir.

create table importacoes (
  id             uuid primary key default gen_random_uuid(),
  edicao_id      uuid not null references edicoes_seminario(id) on delete restrict,
  arquivo_nome   text not null,
  mapa_colunas   jsonb not null,   -- {"Nome":"nome","E-mail":"email",...} — cabeçalho do arquivo -> campo do domínio
  status         text not null default 'previa' check (status in ('previa','confirmada','cancelada')),
  -- Contadores: gravados como PREVISÃO na fase 1, e SOBRESCRITOS com o
  -- resultado real por `confirmar_importacao` na fase 2 (podem divergir da
  -- previsão só em corrida rara — outra escrita mudou o estado entre a
  -- prévia e a confirmação; ver tratamento por linha na função).
  total_linhas       int not null default 0,
  pessoas_novas      int not null default 0,
  pessoas_existentes int not null default 0,
  jornadas_novas     int not null default 0,
  ignoradas          int not null default 0,
  com_erro           int not null default 0,
  confirmada_em  timestamptz,
  confirmada_por uuid references perfis_equipe(id),
  criado_em      timestamptz not null default now(),
  criado_por     uuid references perfis_equipe(id),
  constraint ck_importacao_confirmacao check (
    (status = 'confirmada') = (confirmada_em is not null and confirmada_por is not null)
  )
);
create index idx_importacoes_edicao on importacoes (edicao_id);
create index idx_importacoes_status_previa on importacoes (criado_em) where status = 'previa';

create table importacoes_linhas (
  id             uuid primary key default gen_random_uuid(),
  importacao_id  uuid not null references importacoes(id) on delete cascade,
  numero         int not null check (numero > 0),  -- posição da linha no arquivo (1-based, sem contar cabeçalho)
  dados          jsonb not null,                    -- { bruto: {...}, normalizado: {...}, avisos?: [...] }
  resultado      text not null check (resultado in
                   ('pessoa_nova','pessoa_existente','jornada_nova','ignorada_jornada_aberta','erro')),
  motivo         text,   -- explicação legível; para duplicata dentro do próprio arquivo, guarda
                          -- o padrão 'duplicata_da_linha:<numero>' que `confirmar_importacao` lê
  pessoa_id      uuid references pessoas(id) on delete restrict,
  jornada_id     uuid references jornadas(id) on delete restrict,
  criado_em      timestamptz not null default now(),
  unique (importacao_id, numero)
);
create index idx_importacoes_linhas_importacao on importacoes_linhas (importacao_id, numero);
create index idx_importacoes_linhas_resultado  on importacoes_linhas (importacao_id, resultado);

alter table importacoes enable row level security;
alter table importacoes force row level security;
alter table importacoes_linhas enable row level security;
alter table importacoes_linhas force row level security;

-- Leitura: qualquer papel interno — mesmo padrão de `pessoas`/`jornadas`
-- (dado operacional; valor de patrimônio não mora aqui, então não precisa de
-- `app.ve_patrimonio()`).
create policy imp_sel on importacoes for select to authenticated
  using ((select app.eh_interno()));
create policy impl_sel on importacoes_linhas for select to authenticated
  using ((select app.eh_interno()));

-- Escrita: os mesmos 3 papéis que já podem abrir jornada (`jor_ins`, 0004) —
-- importar é abrir jornada em lote, então exige a mesma permissão.
create policy imp_ins on importacoes for insert to authenticated
  with check ((select app.papel()) in ('admin','advogada','relacionamento'));
create policy imp_upd on importacoes for update to authenticated
  using  ((select app.papel()) in ('admin','advogada','relacionamento'))
  with check ((select app.papel()) in ('admin','advogada','relacionamento'));
create policy impl_ins on importacoes_linhas for insert to authenticated
  with check ((select app.papel()) in ('admin','advogada','relacionamento'));
create policy impl_upd on importacoes_linhas for update to authenticated
  using  ((select app.papel()) in ('admin','advogada','relacionamento'))
  with check ((select app.papel()) in ('admin','advogada','relacionamento'));
-- Sem policy de DELETE em nenhuma das duas tabelas: importação (mesmo
-- cancelada) é histórico permanente — mesmo padrão de `jornadas_transicoes`.

-- ===========================================================================
-- Limites operacionais de upload viram DADO, não constante em TypeScript
-- (mesmo padrão de `link.*`/`ia.*` em 0027) — ajustável em Admin sem deploy.
-- ===========================================================================
insert into configuracoes (chave, valor, descricao) values
 ('importacao.tamanho_maximo_bytes', '5242880'::jsonb,
  'Tamanho máximo (bytes) do arquivo CSV de importação de leads. Padrão: 5 MiB.'),
 ('importacao.limite_linhas', '5000'::jsonb,
  'Número máximo de linhas de dado (sem contar cabeçalho) aceitas por arquivo de importação.');

-- ===========================================================================
-- Confirmação — transação única, tolerante a falha por linha (SAVEPOINT
-- implícito por BEGIN/EXCEPTION dentro do loop): uma linha com problema (ex.:
-- corrida rara — outra escrita criou a mesma pessoa entre a prévia e a
-- confirmação) vira 'erro' e NÃO derruba as milhares de linhas boas ao redor.
-- `security invoker` de propósito: a função não eleva privilégio nenhum, só
-- empacota várias escritas numa única transação — quem chama continua tendo
-- que passar pela RLS normal de pessoas/jornadas/participacoes_seminario
-- (defesa em profundidade: a checagem de papel abaixo é a 1ª trava, a RLS é a
-- 2ª, exatamente como o resto do projeto).
-- ===========================================================================
create or replace function public.confirmar_importacao(p_importacao_id uuid)
returns importacoes
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_importacao importacoes;
  v_linha      importacoes_linhas;
  v_pessoa_id  uuid;
  v_jornada_id uuid;
  v_ref_numero int;
  v_pessoas_novas      int := 0;
  v_pessoas_existentes int := 0;
  v_jornadas_novas     int := 0;
  v_ignoradas          int := 0;
  v_com_erro           int := 0;
  v_ator uuid;
begin
  if (select app.papel()) not in ('admin','advogada','relacionamento') then
    raise exception 'sem_permissao_para_confirmar_importacao' using errcode = '42501';
  end if;

  select id into v_ator from perfis_equipe where auth_user_id = auth.uid() and ativo;

  select * into v_importacao from importacoes where id = p_importacao_id for update;
  if not found then
    raise exception 'importacao_nao_encontrada' using errcode = 'P0002';
  end if;
  if v_importacao.status <> 'previa' then
    raise exception 'importacao_ja_processada: status atual e %', v_importacao.status
      using errcode = 'check_violation';
  end if;

  for v_linha in
    select * from importacoes_linhas where importacao_id = p_importacao_id order by numero
  loop
    if v_linha.resultado = 'erro' then
      v_com_erro := v_com_erro + 1;

    elsif v_linha.resultado = 'ignorada_jornada_aberta' then
      -- Zero escrita, de propósito: o invariante `uniq_jornada_aberta_por_pessoa`
      -- (0004) impede abrir outra jornada. `pessoa_id`/`jornada_id` já vieram
      -- preenchidos da prévia (informativo) e não são tocados aqui.
      v_ignoradas := v_ignoradas + 1;

    elsif v_linha.resultado = 'pessoa_existente' then
      v_pessoas_existentes := v_pessoas_existentes + 1;
      -- Duplicata dentro do PRÓPRIO arquivo: a linha original (numero menor,
      -- já processada nesta mesma passada ascendente) só ganhou pessoa/jornada
      -- reais agora, na confirmação — a prévia não podia saber o id. Resolve
      -- por referência de linha, não por dado repetido em SQL.
      if v_linha.pessoa_id is null and v_linha.motivo like 'duplicata_da_linha:%' then
        v_ref_numero := substring(v_linha.motivo from 'duplicata_da_linha:(\d+)')::int;
        select pessoa_id, jornada_id into v_pessoa_id, v_jornada_id
          from importacoes_linhas
         where importacao_id = p_importacao_id and numero = v_ref_numero;
        update importacoes_linhas set pessoa_id = v_pessoa_id, jornada_id = v_jornada_id
         where id = v_linha.id;
      end if;
      -- Se `pessoa_id` já veio preenchido da prévia (identidade já existia no
      -- banco antes desta importação), não há nada a fazer — já está linkado.

    else -- 'pessoa_nova' ou 'jornada_nova': os dois únicos casos que escrevem.
      begin
        if v_linha.resultado = 'pessoa_nova' then
          insert into pessoas (
            nome, email, telefone, cidade, uf, profissao, faixa_etaria,
            estado_civil, observacoes, criado_por
          ) values (
            v_linha.dados #>> '{normalizado,nome}',
            nullif(v_linha.dados #>> '{normalizado,email}', ''),
            nullif(v_linha.dados #>> '{normalizado,telefone}', ''),
            nullif(v_linha.dados #>> '{normalizado,cidade}', ''),
            nullif(v_linha.dados #>> '{normalizado,uf}', ''),
            nullif(v_linha.dados #>> '{normalizado,profissao}', ''),
            nullif(v_linha.dados #>> '{normalizado,faixa_etaria}', ''),
            nullif(v_linha.dados #>> '{normalizado,estado_civil}', ''),
            nullif(v_linha.dados #>> '{normalizado,observacoes}', ''),
            v_ator
          )
          returning id into v_pessoa_id;
          v_pessoas_novas := v_pessoas_novas + 1;
        else
          -- 'jornada_nova': identidade já resolvida contra o banco na prévia.
          v_pessoa_id := v_linha.pessoa_id;
        end if;

        insert into jornadas (pessoa_id, edicao_id, origem, trilha, criado_por)
        values (v_pessoa_id, v_importacao.edicao_id, 'seminario', 'seminario', v_ator)
        returning id into v_jornada_id;
        v_jornadas_novas := v_jornadas_novas + 1;

        insert into participacoes_seminario (pessoa_id, edicao_id, origem, dias_assistidos)
        values (
          v_pessoa_id, v_importacao.edicao_id, 'seminario',
          nullif(v_linha.dados #>> '{normalizado,dias_assistidos}', '')::smallint
        )
        on conflict (pessoa_id, edicao_id) do nothing;

        update importacoes_linhas set pessoa_id = v_pessoa_id, jornada_id = v_jornada_id
         where id = v_linha.id;

        perform app.registrar_evento_timeline(v_jornada_id, 'importacao',
          'Jornada criada por importação de leads',
          'Arquivo "' || v_importacao.arquivo_nome || '", linha ' || v_linha.numero,
          jsonb_build_object('importacao_id', p_importacao_id, 'linha_numero', v_linha.numero));

      exception when others then
        -- Não aborta a importação inteira por causa de UMA linha (ex.: corrida
        -- rara em que outra escrita já criou a mesma pessoa entre a prévia e
        -- a confirmação). O BEGIN/EXCEPTION aqui é um SAVEPOINT implícito:
        -- desfaz só as escritas desta linha, mantém as anteriores da mesma
        -- transação.
        v_com_erro := v_com_erro + 1;
        update importacoes_linhas
           set resultado = 'erro',
               motivo = coalesce(v_linha.motivo || ' | ', '') || 'falha_na_confirmacao: ' || sqlerrm
         where id = v_linha.id;
      end;
    end if;
  end loop;

  update importacoes
     set status = 'confirmada',
         confirmada_em = now(),
         confirmada_por = v_ator,
         pessoas_novas = v_pessoas_novas,
         pessoas_existentes = v_pessoas_existentes,
         jornadas_novas = v_jornadas_novas,
         ignoradas = v_ignoradas,
         com_erro = v_com_erro
   where id = p_importacao_id
   returning * into v_importacao;

  return v_importacao;
end $$;

revoke execute on function public.confirmar_importacao(uuid) from public, anon;
grant  execute on function public.confirmar_importacao(uuid) to authenticated;

comment on function public.confirmar_importacao(uuid) is
  'Fase 2 da importação de leads (0035): grava de verdade em pessoas/jornadas/'
  'participacoes_seminario a partir da prévia já calculada. Idempotente contra '
  're-chamada acidental — status <> ''previa'' recusa com erro, nunca reprocessa.';

-- ===========================================================================
-- Cancelamento — só sai de 'previa'. Não apaga nada (sem DELETE em lugar
-- nenhum deste projeto); é só marcar que aquela prévia não vira dado real.
-- ===========================================================================
create or replace function public.cancelar_importacao(p_importacao_id uuid)
returns importacoes
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare v_linha importacoes;
begin
  if (select app.papel()) not in ('admin','advogada','relacionamento') then
    raise exception 'sem_permissao_para_cancelar_importacao' using errcode = '42501';
  end if;

  update importacoes set status = 'cancelada'
   where id = p_importacao_id and status = 'previa'
   returning * into v_linha;

  if not found then
    raise exception 'importacao_nao_encontrada_ou_ja_processada' using errcode = 'P0002';
  end if;

  return v_linha;
end $$;

revoke execute on function public.cancelar_importacao(uuid) from public, anon;
grant  execute on function public.cancelar_importacao(uuid) to authenticated;

-- NOTA de grants (mesmo padrão de 0024): `app.registrar_evento_timeline` já é
-- concedida a `authenticated` desde 0024 — a chamada dentro de
-- `confirmar_importacao` (SECURITY INVOKER, rodando como o usuário real) não
-- precisa de grant novo.

-- VERIFICAÇÃO OBRIGATÓRIA (rodar depois de aplicar esta migration):
--   1. select polcmd from pg_policy p join pg_class c on c.oid = p.polrelid
--        where c.relname in ('importacoes','importacoes_linhas') and polcmd = '*';
--      -- esperado: 0 linhas (nenhuma policy `for all`/DELETE nas duas tabelas).
--   2. Confirmar duas vezes a mesma importação -> a segunda chamada de
--      `confirmar_importacao` tem que falhar com 'importacao_ja_processada',
--      nunca duplicar pessoa/jornada.
--   3. Duas linhas do mesmo arquivo com o mesmo e-mail -> só a primeira vira
--      'pessoa_nova'; a segunda vira 'pessoa_existente' com
--      motivo = 'duplicata_da_linha:<numero da primeira>', e depois de
--      confirmar as duas apontam para a MESMA pessoa_id/jornada_id.
