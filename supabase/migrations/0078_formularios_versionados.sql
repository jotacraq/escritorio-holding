-- 0078_formularios_versionados.sql
-- Fase 7 r3 — o Formulário Estratégico (POP 02) ganha porta de publicação, do
-- mesmo jeito que prompts_versoes (0009/0033) e roteiros_versoes (0030) já têm.
-- Plano: docs/ARQUITETURA-FASE-7.md §A3. Roteiro: scripts/verificacao-0078.sql.
--
-- O QUE ESTA MIGRATION NÃO FAZ, DE PROPÓSITO:
--   · NÃO reescreve `definicao` de nenhuma versão existente. O formato antigo
--     (`opcoes: ["a","b"]`) continua válido e é lido pelo app por
--     `normalizarOpcoes` (servidor: src/server/formularios/definicao.ts).
--     Reescrever seria o UPDATE que o padrão da casa proíbe (ver comentário de
--     POST /api/roteiros).
--   · NÃO toca em `formularios_respostas`. Nenhuma linha muda de valor.
--   · NÃO ativa nem desativa nenhuma versão.
--
-- MEDIDO ANTES (06/09/2026, banco de produção, pelo orquestrador):
--   formularios = 1 (chave 'estrategico', versao 2, ativa) · formularios_respostas = 3
--   roteiros_versoes = 6 · md5(string_agg(definicao::text order by chave,versao))
--   = 266c5fb099d9c4490b39459937e11a53. O roteiro de verificação prova que os
--   três números e o hash continuam iguais depois de aplicar.
--
-- REVERSÃO (descrita, não automática):
--   drop function if exists public.publicar_formulario_versao(text,jsonb,text,text,boolean,uuid);
--   drop function if exists public.ativar_formulario_versao(uuid);
--   alter table formularios drop constraint if exists ck_formularios_definicao;
--   drop function if exists app.definicao_formulario_valida(jsonb, text);
--   alter table formularios drop column if exists titulo, drop column if exists notas,
--     drop column if exists criado_por, drop column if exists ativado_por, drop column if exists ativado_em;
--   alter table roteiros_versoes drop column if exists ativado_por, drop column if exists ativado_em;
--   create policy form_wr on formularios for all to authenticated
--     using ((select app.eh_admin())) with check ((select app.eh_admin()));
--   grant insert, update, delete on formularios to authenticated;

-- ---------------------------------------------------------------------------
-- (a) Autoria. `formularios` nasceu sem `criado_por` (0006) — `roteiros_versoes`
--     e `prompts_versoes` têm. "Quem publicou" e "quem carimbou como oficial"
--     são perguntas diferentes: a segunda é o BLOQUEIO B15 e não tinha resposta
--     em lugar nenhum do banco.
--     NÃO se cria tabela genérica de auditoria administrativa: a linha da
--     própria versão é o registro, como já é para prompt e roteiro (otimização).
-- ---------------------------------------------------------------------------
alter table formularios add column if not exists titulo      text;
alter table formularios add column if not exists notas       text;
alter table formularios add column if not exists criado_por  uuid references perfis_equipe(id);
alter table formularios add column if not exists ativado_por uuid references perfis_equipe(id);
alter table formularios add column if not exists ativado_em  timestamptz;

alter table roteiros_versoes add column if not exists ativado_por uuid references perfis_equipe(id);
alter table roteiros_versoes add column if not exists ativado_em  timestamptz;

comment on column formularios.ativado_por is
  'Quem promoveu esta versão a oficial (RPC ativar_formulario_versao). NULL nas versões '
  'ativadas antes da 0078 — vazio é vazio, não se inventa autor retroativo.';
comment on column roteiros_versoes.ativado_por is
  'Idem. É a resposta rastreável do BLOQUEIO B15 ("qual das 4 versões do roteiro é a oficial").';

-- ---------------------------------------------------------------------------
-- (b) Validação da definição, no BANCO. Aceita os DOIS formatos de `opcoes`
--     (string crua = legado; objeto {valor,rotulo} = novo) para não invalidar
--     nenhuma versão já gravada. `p_chave` decide se a trava de "perguntas de
--     sistema" se aplica (só 'estrategico').
-- ---------------------------------------------------------------------------
create or replace function app.definicao_formulario_valida(p_definicao jsonb, p_chave text default null)
returns boolean
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare
  v_item      jsonb;
  v_opcao     jsonb;
  v_ids       text[] := '{}';
  v_id        text;
  v_tipo      text;
  v_valores   text[];
  v_valor     text;
  v_dep       text;
  v_pos       int := 0;
  v_alvo      text;
  v_tipo_dep  text;
  -- Perguntas lidas por STRING LITERAL pelo servidor (docs/ARQUITETURA-FASE-7.md §A2.2):
  --   p9  → src/app/api/jornadas/[id]/formulario/route.ts (faixa de patrimônio) e
  --         `responder_formulario_publico` (0028);
  --   p16 → src/server/material/sinais.ts (fonte_dor = 'formulario');
  --   p1, p2 → src/server/ia/contexto-briefing.ts (CHAVES_FORMULARIO_EXCLUIDAS).
  -- A lista mora AQUI, não em `configuracoes`: mudá-la exige mudar código junto,
  -- então tem de exigir migration.
  v_sistema   text[] := array['p1','p2','p9','p16'];
begin
  if p_definicao is null or jsonb_typeof(p_definicao) <> 'array' then
    raise exception 'definicao_invalida: precisa ser um array de perguntas' using errcode = '22023';
  end if;
  if jsonb_array_length(p_definicao) = 0 then
    raise exception 'definicao_vazia: o formulário precisa de pelo menos uma pergunta' using errcode = '22023';
  end if;
  if jsonb_array_length(p_definicao) > 60 then
    raise exception 'definicao_longa: máximo de 60 perguntas (o POP 02 promete 3 minutos ao cliente)'
      using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_definicao) loop
    v_pos := v_pos + 1;
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'pergunta_invalida: item % não é um objeto', v_pos using errcode = '22023';
    end if;
    v_id   := v_item ->> 'id';
    v_tipo := v_item ->> 'tipo';

    if v_id is null or v_id !~ '^[a-z][a-z0-9_]{0,39}$' then
      raise exception 'id_invalido: pergunta %, id "%" (use minúsculas, dígitos e _)', v_pos, coalesce(v_id, '(vazio)')
        using errcode = '22023';
    end if;
    if v_id = any (v_ids) then
      raise exception 'id_duplicado: "%" aparece duas vezes', v_id using errcode = '22023';
    end if;
    -- O id vira CHAVE de um objeto JS em `formularios_respostas.respostas`
    -- (`respostas["p16"]` em src/server/material/sinais.ts). Nome herdado do
    -- protótipo devolveria a função do Object quando a chave não existisse —
    -- é o mesmo endurecimento que `rotuloOpcao` levou no pentest da r2.
    if v_id in ('constructor','prototype','tostring','valueof','hasownproperty','isprototypeof') then
      raise exception 'id_reservado: "%" é nome herdado de objeto e não pode ser id de pergunta', v_id
        using errcode = '22023';
    end if;
    v_ids := v_ids || v_id;

    if coalesce(length(trim(v_item ->> 'bloco')), 0) not between 1 and 80 then
      raise exception 'bloco_invalido: pergunta % precisa de um bloco de 1 a 80 caracteres', v_id using errcode = '22023';
    end if;
    if coalesce(length(trim(v_item ->> 'rotulo')), 0) not between 1 and 300 then
      raise exception 'rotulo_invalido: pergunta % precisa de um enunciado de 1 a 300 caracteres', v_id using errcode = '22023';
    end if;
    if v_tipo is null or v_tipo not in ('texto','texto_longo','numero','unica','multipla','sim_nao') then
      raise exception 'tipo_invalido: pergunta % tem tipo "%"', v_id, coalesce(v_tipo,'(vazio)') using errcode = '22023';
    end if;
    if (v_item ? 'obrigatoria') and jsonb_typeof(v_item -> 'obrigatoria') <> 'boolean' then
      raise exception 'obrigatoria_invalida: pergunta % — obrigatoria precisa ser true/false', v_id using errcode = '22023';
    end if;

    -- opções: só para unica/multipla, mínimo 2, valores únicos, os dois formatos
    if v_tipo in ('unica','multipla') then
      if jsonb_typeof(v_item -> 'opcoes') is distinct from 'array'
         or jsonb_array_length(v_item -> 'opcoes') < 2 then
        raise exception 'opcoes_insuficientes: pergunta % (%) precisa de pelo menos 2 opções', v_id, v_tipo
          using errcode = '22023';
      end if;
      v_valores := '{}';
      for v_opcao in select * from jsonb_array_elements(v_item -> 'opcoes') loop
        if jsonb_typeof(v_opcao) = 'string' then
          v_valor := v_opcao #>> '{}';                        -- legado
        elsif jsonb_typeof(v_opcao) = 'object' then
          v_valor := v_opcao ->> 'valor';
          if coalesce(length(trim(v_opcao ->> 'rotulo')), 0) not between 1 and 200 then
            raise exception 'rotulo_opcao_invalido: pergunta %, opção "%"', v_id, coalesce(v_valor,'(vazio)')
              using errcode = '22023';
          end if;
        else
          raise exception 'opcao_invalida: pergunta % — opção precisa ser texto ou {valor,rotulo}', v_id
            using errcode = '22023';
        end if;
        if coalesce(length(trim(v_valor)), 0) not between 1 and 120 then
          raise exception 'valor_opcao_invalido: pergunta % tem opção sem valor', v_id using errcode = '22023';
        end if;
        if v_valor = any (v_valores) then
          raise exception 'valor_opcao_duplicado: pergunta %, valor "%"', v_id, v_valor using errcode = '22023';
        end if;
        v_valores := v_valores || v_valor;
      end loop;
    elsif v_item ? 'opcoes' then
      raise exception 'opcoes_indevidas: pergunta % é do tipo % e não aceita opções', v_id, v_tipo using errcode = '22023';
    end if;

    -- condicional: aponta para pergunta ANTERIOR (mata a referência circular por
    -- construção), com o operador certo para o tipo dela, e o valor comparado
    -- tem de existir nas opções daquela pergunta.
    if v_item ? 'condicional' then
      if jsonb_typeof(v_item -> 'condicional') <> 'object' then
        raise exception 'condicional_invalida: pergunta %', v_id using errcode = '22023';
      end if;
      v_dep := v_item #>> '{condicional,depende_de}';
      if v_dep is null then
        raise exception 'condicional_sem_alvo: pergunta %', v_id using errcode = '22023';
      end if;
      if array_position(v_ids, v_dep) is null then
        raise exception 'condicional_adiante: pergunta % depende de "%", que não vem antes dela', v_id, v_dep
          using errcode = '22023';
      end if;
      if ((v_item -> 'condicional' ? 'igual')::int + (v_item -> 'condicional' ? 'contem')::int) <> 1 then
        raise exception 'condicional_operador: pergunta % precisa de exatamente um entre igual/contem', v_id
          using errcode = '22023';
      end if;
      select e ->> 'tipo' into v_tipo_dep
        from jsonb_array_elements(p_definicao) e where e ->> 'id' = v_dep limit 1;
      if (v_item -> 'condicional' ? 'contem') and v_tipo_dep is distinct from 'multipla' then
        raise exception 'condicional_contem: pergunta % usa "contem" sobre "%", que não é múltipla', v_id, v_dep
          using errcode = '22023';
      end if;
      if (v_item -> 'condicional' ? 'igual') and coalesce(v_tipo_dep, '') not in ('unica','sim_nao') then
        raise exception 'condicional_igual: pergunta % usa "igual" sobre "%", que não é única/sim_nao', v_id, v_dep
          using errcode = '22023';
      end if;
      v_alvo := coalesce(v_item #>> '{condicional,contem}', v_item #>> '{condicional,igual}');
      if v_tipo_dep in ('unica','multipla') and not exists (
        select 1
          from jsonb_array_elements(p_definicao) e,
               jsonb_array_elements(e -> 'opcoes') o
         where e ->> 'id' = v_dep
           and coalesce(o ->> 'valor', o #>> '{}') = v_alvo
      ) then
        raise exception 'condicional_valor: pergunta % compara "%" com valor "%", que não existe nas opções dela',
          v_id, v_dep, v_alvo using errcode = '22023';
      end if;
    end if;
  end loop;

  -- Perguntas que o CÓDIGO lê por id. Só para a chave 'estrategico'.
  if p_chave = 'estrategico' then
    foreach v_id in array v_sistema loop
      if not (v_id = any (v_ids)) then
        raise exception 'pergunta_de_sistema_removida: % (lida pelo código — ver docs/ARQUITETURA-FASE-7.md §A2.2)', v_id
          using errcode = '22023';
      end if;
    end loop;
  end if;

  return true;
end $$;

revoke execute on function app.definicao_formulario_valida(jsonb, text) from public, anon;
grant  execute on function app.definicao_formulario_valida(jsonb, text) to authenticated, service_role;

-- Invariante no banco (critério de solidificação). `not valid`: as versões já
-- gravadas NÃO são revalidadas — a 0016 semeou `p14` com a opção "Outro" sem
-- par condicional e perguntas `numero` sem opção; revalidar retroativamente
-- reprovaria histórico legítimo. Linha nova ou alterada passa pela trava.
alter table formularios drop constraint if exists ck_formularios_definicao;
alter table formularios
  add constraint ck_formularios_definicao
  check (app.definicao_formulario_valida(definicao, chave)) not valid;

-- ---------------------------------------------------------------------------
-- (c) Publicar versão N+1 — ATÔMICO. Hoje `POST /api/formularios` faz
--     UPDATE(desativa) e depois INSERT em DUAS transações do supabase-js: se o
--     INSERT falhar, a chave fica PERMANENTEMENTE sem versão ativa e
--     `app.payload_link_formulario` (0028) passa a devolver `definicao: []`
--     enquanto `responder_formulario_publico` devolve `formulario_indisponivel`.
--     O formulário do cliente morre em silêncio. Aqui é uma transação só.
--     Padrão de autor da 0071: com sessão vale a sessão; sem sessão
--     (service_role) `p_criado_por` é obrigatório e validado.
-- ---------------------------------------------------------------------------
create or replace function public.publicar_formulario_versao(
  p_chave      text,
  p_definicao  jsonb,
  p_titulo     text default null,
  p_notas      text default null,
  p_ativar     boolean default false,
  p_criado_por uuid default null
) returns formularios
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_autor  uuid;
  v_versao smallint;
  v_linha  formularios;
begin
  if auth.uid() is not null then
    if not app.eh_admin() then
      raise exception 'sem_permissao: apenas admin publica versão de formulário' using errcode = '42501';
    end if;
    select id into v_autor from perfis_equipe where auth_user_id = auth.uid() and ativo;
  else
    if p_criado_por is null then
      raise exception 'autor_obrigatorio: sem sessão, p_criado_por é obrigatório' using errcode = '22004';
    end if;
    select id into v_autor from perfis_equipe where id = p_criado_por and ativo and papel = 'admin';
    if v_autor is null then
      raise exception 'sem_permissao: p_criado_por não é admin ativo' using errcode = '42501';
    end if;
  end if;

  if p_chave is null or p_chave !~ '^[a-z][a-z0-9_]{0,49}$' then
    raise exception 'chave_invalida: %', coalesce(p_chave, '(vazia)') using errcode = '22023';
  end if;

  perform app.definicao_formulario_valida(p_definicao, p_chave);  -- levanta 22023 legível

  -- Trava a chave inteira: duas publicações simultâneas serializam aqui, em vez
  -- de colidirem na unique (chave, versao).
  perform 1 from formularios where chave = p_chave for update;

  select coalesce(max(versao), 0) + 1 into v_versao from formularios where chave = p_chave;

  if p_ativar then
    update formularios set ativo = false where chave = p_chave and ativo;
  end if;

  insert into formularios (chave, versao, definicao, titulo, notas, ativo, criado_por, ativado_por, ativado_em)
  values (p_chave, v_versao, p_definicao, nullif(trim(p_titulo), ''), nullif(trim(p_notas), ''),
          coalesce(p_ativar, false), v_autor,
          case when p_ativar then v_autor end,
          case when p_ativar then now()   end)
  returning * into v_linha;

  return v_linha;
end $$;

revoke execute on function public.publicar_formulario_versao(text, jsonb, text, text, boolean, uuid) from public, anon;
grant  execute on function public.publicar_formulario_versao(text, jsonb, text, text, boolean, uuid) to authenticated, service_role;
comment on function public.publicar_formulario_versao(text, jsonb, text, text, boolean, uuid) is
  'Única porta de publicação do POP 02. Sempre versão N+1; nunca UPDATE em definicao existente. '
  'Desativa a anterior na MESMA transação — a chave nunca fica sem versão ativa.';

-- ---------------------------------------------------------------------------
-- (d) Ativar versão já publicada — espelho exato de ativar_prompt_versao (0033)
--     e ativar_roteiro_versao (0030), mais o carimbo de autoria.
-- ---------------------------------------------------------------------------
create or replace function public.ativar_formulario_versao(p_id uuid)
returns formularios
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_chave text;
  v_autor uuid;
  v_linha formularios;
begin
  if not app.eh_admin() then
    raise exception 'sem_permissao: apenas admin ativa versão de formulário' using errcode = '42501';
  end if;
  select id into v_autor from perfis_equipe where auth_user_id = auth.uid() and ativo;

  select chave into v_chave from formularios where id = p_id for update;
  if v_chave is null then
    raise exception 'versao_nao_encontrada: %', p_id using errcode = 'P0002';
  end if;

  update formularios set ativo = false where chave = v_chave and ativo and id <> p_id;
  update formularios set ativo = true, ativado_por = v_autor, ativado_em = now()
   where id = p_id returning * into v_linha;

  return v_linha;
end $$;

revoke execute on function public.ativar_formulario_versao(uuid) from public, anon;
grant  execute on function public.ativar_formulario_versao(uuid) to authenticated;
comment on function public.ativar_formulario_versao(uuid) is
  'Promove uma versão já publicada a oficial, carimbando quem e quando. Não edita definicao.';

-- ---------------------------------------------------------------------------
-- (e) `ativar_roteiro_versao` (0030) passa a carimbar ativado_por/ativado_em.
--     Corpo idêntico ao original + duas colunas. É a resposta do B15.
--     Continua INVOKER (como a 0030): quem chama é admin autenticado, e a RLS
--     de `roteiros_versoes` é a segunda trava.
-- ---------------------------------------------------------------------------
create or replace function public.ativar_roteiro_versao(p_id uuid)
returns roteiros_versoes
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_chave text;
  v_autor uuid;
  v_linha roteiros_versoes;
begin
  if not app.eh_admin() then
    raise exception 'sem_permissao: apenas admin ativa versão de roteiro' using errcode = '42501';
  end if;
  select id into v_autor from perfis_equipe where auth_user_id = auth.uid() and ativo;

  select chave into v_chave from roteiros_versoes where id = p_id;
  if v_chave is null then
    raise exception 'versao_nao_encontrada: %', p_id using errcode = 'P0002';
  end if;

  update roteiros_versoes set ativo = false where chave = v_chave and ativo and id <> p_id;
  update roteiros_versoes set ativo = true, ativado_por = v_autor, ativado_em = now()
   where id = p_id returning * into v_linha;

  return v_linha;
end $$;
revoke execute on function public.ativar_roteiro_versao(uuid) from public, anon;
grant  execute on function public.ativar_roteiro_versao(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- (f) `formularios` deixa de aceitar escrita direta por `authenticated`.
--     Mesma postura da 0072 para links_publicos: se existe RPC, a policy larga
--     é uma porta paralela sem validação. SELECT continua (form_sel/eh_interno).
-- ---------------------------------------------------------------------------
drop policy if exists form_wr on formularios;
revoke insert, update, delete on formularios from public, anon, authenticated;
comment on table formularios is
  'Definição versionada do POP 02. Escrita SÓ pelas RPCs publicar_formulario_versao / '
  'ativar_formulario_versao (0078); authenticated só lê (form_sel/eh_interno).';
