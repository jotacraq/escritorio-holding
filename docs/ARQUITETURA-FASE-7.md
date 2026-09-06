# Fase 7 (rodada 3) — plano do arquiteto · 06/09/2026

Entrada: `tmp/squad/fase7-rodada3.md` (seção ARQ) + regras do `tmp/squad/fase7-brief.md`.
Base lida: `CLAUDE.md`, `brain/03 - Dominio/Glossario.md`, `0005`, `0006`, `0011`, `0012`, `0014`,
`0016`, `0028`, `0030`, `0033`, `0039`, `0048`, `0053`, `0054`, `0071`, `0072`,
`src/app/api/formularios/route.ts`, `src/app/api/roteiros/**`, `src/app/api/admin/prompts/**`,
`src/components/admin/AdminApp.tsx`, `src/components/publico/{FormularioPublico,CampoPerguntaPublico}.tsx`,
`src/lib/vocabulario.ts`, `src/server/ia/contexto-briefing.ts`, `src/server/material/{sinais,pdf}.ts`,
`src/server/auth.ts`, `src/server/integracoes/rate-limit.ts`.

**Não consultei o banco** — não tenho tool de banco nesta invocação. Toda contagem abaixo está marcada
como `A MEDIR` e é tarefa do orquestrador antes de aplicar migration. Nenhum número foi inventado.

Duas features:

- **A — Admin → Formulário e roteiros.** Três rotas vivas sem botão viram tela. Migration `0078`.
- **B — Direitos do titular (LGPD).** Exportar e encerrar o tratamento de uma pessoa. Migrations `0079` + `0080`.

---

## 0. As duas frases que resumem o desenho

**A.** O Formulário Estratégico não é "um formulário que a Dra. Elaine edita". É a **definição versionada
do POP 02** — mesma classe de `prompts_versoes`, `roteiros_versoes`, `mensagens_templates`,
`parametros_metodo`. A aba nova não edita nada: ela **publica uma versão N+1** e **carimba qual é a
oficial**. Isso já é o padrão do repositório em quatro lugares; o formulário é o único que ficou sem porta.

**B.** "Anonimizar uma pessoa" não é apagar cadastro. É **encerrar o tratamento dos dados pessoais de um
titular, preservando o esqueleto contábil e temporal**. Sai o que identifica; fica o fato econômico
(pagamento, valor, data) e o fato processual (houve ligação, houve sessão, quando). Nenhum `DELETE`
em lugar nenhum — é tudo `UPDATE` para marcador, com o motivo, a base legal, quem e quando gravados
numa tabela que ninguém pode alterar depois.

---

# FEATURE A — Admin → Formulário e roteiros

## A1. O que existe hoje, medido no código

| Rota | Estado | Quem chama |
|---|---|---|
| `GET /api/formularios` | viva, `exigirInterno` | ninguém (`grep` em `src/lib/api.ts` e `src/components/**` não acha cliente) |
| `POST /api/formularios` | viva, `exigirPapel("admin")` | ninguém |
| `GET /api/roteiros` | viva, `exigirInterno` | ninguém |
| `GET /api/roteiros/[id]` | viva | ninguém |
| `GET /api/roteiros/ativa?chave=` | viva | tela de condução da SV e de ligação (**é a única usada**) |
| `POST /api/roteiros/[id]/ativar` | viva, `exigirPapel("admin")` | ninguém — **é o mecanismo do BLOQUEIO B15** |

> Correção ao brief: não existe `PUT /api/formularios`. O par é `GET` + `POST` (POST cria versão nova).

Modelo atual (`0006`):

```
formularios(id, chave, versao smallint, definicao jsonb, ativo bool, criado_em)
  unique (chave, versao)
  unique index uniq_formulario_ativo on (chave) where ativo
formularios_respostas(id, jornada_id unique, formulario_id, respostas jsonb, origem, origem_dado, respondido_em)
```

`definicao` é um **array** de perguntas (não um objeto com `blocos`, diferente de `roteiros_versoes`):
`[{id,bloco,tipo,rotulo,opcoes?,obrigatoria?,condicional?}]`. Semeada na `0016` com 17 perguntas,
`p1..p17`, **nenhuma `obrigatoria`**, e `opcoes` como `text[]` de strings soltas — misturando dois
mundos: `p4` usa rótulo humano (`"Até 34"`), `p5` usa slug (`"viuvo"`, `"uniao_estavel"`).

## A2. O conceito errado: `opcoes: string[]` mistura valor e rótulo

`rotuloOpcao()` (`src/lib/vocabulario.ts:226`) existe **porque** o modelo está errado: ele adivinha o
rótulo a partir do valor gravado (dicionário fixo + title-case do snake_case). Funciona por acidente
(`viuvo` → "Viúvo(a)") e falha no dia em que o rótulo precisa mudar sem mudar o dado histórico
("Acima de R$ 2 milhões" → "Acima de R$ 2 mi" reescreveria todas as respostas antigas).

**Modelo certo:** `opcoes: [{valor, rotulo}]`. `valor` é a chave estável que vai para
`formularios_respostas.respostas`; `rotulo` é a frase que o cliente lê e que a Dra. Elaine pode reescrever
à vontade, publicando versão nova, **sem tocar em nenhuma resposta**.

### A2.1. Como migrar as versões existentes sem tocar nas respostas: **não migrando**

Decisão: **zero backfill em `formularios.definicao`.**

Motivo, que é a regra da casa escrita no comentário da própria `POST /api/roteiros`:
*"SEMPRE cria uma VERSÃO NOVA … nunca UPDATE no `definicao` de uma versão existente"*. Reescrever a
`definicao` das versões antigas para o formato novo seria exatamente o UPDATE proibido — e as versões
antigas são o que permite reabrir uma resposta de 2026-06 e saber contra qual pergunta ela foi dada.

Consequência: o código tem de ler **os dois formatos**. Isso não é dívida, é o caminho de leitura do
histórico — e é obrigatório de qualquer jeito pela regra "o código TEM de funcionar sem a migration
aplicada".

```ts
// src/lib/formulario/definicao.ts  (novo, puro, com teste vitest)
export interface OpcaoPergunta { valor: string; rotulo: string }

/** Aceita `["a","b"]` (versões <= 5, legado) e `[{valor,rotulo}]` (versões novas). */
export function normalizarOpcoes(opcoes: unknown): OpcaoPergunta[] {
  if (!Array.isArray(opcoes)) return [];
  return opcoes.flatMap((o) => {
    if (typeof o === "string") return [{ valor: o, rotulo: rotuloOpcao(o) }]; // legado
    if (o && typeof o === "object" && typeof (o as OpcaoPergunta).valor === "string") {
      const oo = o as OpcaoPergunta;
      return [{ valor: oo.valor, rotulo: typeof oo.rotulo === "string" && oo.rotulo.trim() ? oo.rotulo : rotuloOpcao(oo.valor) }];
    }
    return [];
  });
}
```

`rotuloOpcao()` **fica** — deixa de ser a regra e vira o fallback do legado. Ganho colateral medido:
`FormularioPublico.tsx:56` (tela de conclusão) hoje imprime `String(valor)` cru, então o cliente que
respondeu "Casado(a)" relê **"casado"**. Com `normalizarOpcoes` a tela de conclusão passa a mostrar o
rótulo. Bug real, corrigido de graça.

### A2.2. Os ids que o CÓDIGO conhece — a trava que faltava

Quatro pontos do servidor leem id de pergunta **por string literal**:

| id | Onde | O que quebra se sumir |
|---|---|---|
| `p9` | `src/app/api/jornadas/[id]/formulario/route.ts:46` e `responder_formulario_publico` (0028:583) | espelho de `jornadas.faixa_patrimonio_declarada` — some a faixa do Kanban, da Ficha e do briefing |
| `p16` | `src/server/material/sinais.ts:132` | `fonte_dor='formulario'` do material pós-sessão |
| `p1`, `p2` | `src/server/ia/contexto-briefing.ts:129` (`CHAVES_FORMULARIO_EXCLUIDAS`) | nome e cidade vazariam para o prompt do briefing |

Hoje **nada impede** um POST de publicar uma versão sem `p9`. A RPC nova recusa (`22023`,
`pergunta_de_sistema_removida: p9`). A lista é constante **na função SQL**, não em `configuracoes`:
mudá-la exige mudar código junto, então exige migration — que é o certo.

## A3. Migration `0078` — texto integral

Arquivo: `supabase/migrations/0078_formularios_versionados.sql`.
Roteiro: `scripts/verificacao-0078.sql`.
**Aditiva.** Nenhum `UPDATE` em `formularios.definicao`, nenhum em `formularios_respostas`.
Linhas que mudam de VALOR: **0** (`A MEDIR` para confirmar: `select count(*) from formularios_respostas`).

```sql
-- 0078_formularios_versionados.sql
-- Fase 7 r3 — o Formulário Estratégico (POP 02) ganha porta de publicação, do
-- mesmo jeito que prompts_versoes (0009/0033) e roteiros_versoes (0030) já têm.
--
-- O QUE ESTA MIGRATION NÃO FAZ, DE PROPÓSITO:
--   · NÃO reescreve `definicao` de nenhuma versão existente. O formato antigo
--     (`opcoes: ["a","b"]`) continua válido e é lido pelo app por
--     `src/lib/formulario/definicao.ts#normalizarOpcoes`. Reescrever seria o
--     UPDATE que o padrão da casa proíbe (ver comentário de POST /api/roteiros).
--   · NÃO toca em `formularios_respostas`. Nenhuma linha muda de valor.
--   · NÃO ativa nem desativa nenhuma versão.
--
-- REVERSÃO (descrita, não automática):
--   drop function if exists public.publicar_formulario_versao(text,jsonb,boolean,text,text,uuid);
--   drop function if exists public.ativar_formulario_versao(uuid);
--   drop function if exists app.definicao_formulario_valida(jsonb, text);
--   alter table formularios drop constraint if exists ck_formularios_definicao;
--   alter table formularios drop column if exists titulo, drop column if exists notas,
--     drop column if exists criado_por, drop column if exists ativado_por, drop column if exists ativado_em;
--   alter table roteiros_versoes drop column if exists ativado_por, drop column if exists ativado_em;

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
  v_dep_pos   int;
  v_pos       int := 0;
  v_alvo      text;
  v_tipo_dep  text;
  v_sistema   text[] := array['p1','p2','p9','p16'];  -- ver §A2.2 do plano; mudar exige migration
begin
  if p_definicao is null or jsonb_typeof(p_definicao) <> 'array' then
    raise exception 'definicao_invalida: precisa ser um array de perguntas' using errcode = '22023';
  end if;
  if jsonb_array_length(p_definicao) = 0 then
    raise exception 'definicao_vazia: o formulário precisa de pelo menos uma pergunta' using errcode = '22023';
  end if;
  if jsonb_array_length(p_definicao) > 60 then
    raise exception 'definicao_longa: máximo de 60 perguntas (POP 02 pede no máximo 3 minutos)' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_definicao) loop
    v_pos := v_pos + 1;
    v_id  := v_item ->> 'id';
    v_tipo := v_item ->> 'tipo';

    if v_id is null or v_id !~ '^[a-z][a-z0-9_]{0,39}$' then
      raise exception 'id_invalido: pergunta %, id "%" (use minúsculas, dígitos e _)', v_pos, coalesce(v_id, '(vazio)')
        using errcode = '22023';
    end if;
    if v_id = any (v_ids) then
      raise exception 'id_duplicado: "%" aparece duas vezes', v_id using errcode = '22023';
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
      if jsonb_typeof(v_item -> 'opcoes') <> 'array' or jsonb_array_length(v_item -> 'opcoes') < 2 then
        raise exception 'opcoes_insuficientes: pergunta % (%s) precisa de pelo menos 2 opções', v_id, v_tipo
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

    -- condicional: aponta para pergunta ANTERIOR, com o operador certo para o tipo dela,
    -- e o valor comparado tem de existir nas opções daquela pergunta.
    if v_item ? 'condicional' then
      if jsonb_typeof(v_item -> 'condicional') <> 'object' then
        raise exception 'condicional_invalida: pergunta %', v_id using errcode = '22023';
      end if;
      v_dep := v_item #>> '{condicional,depende_de}';
      if v_dep is null then
        raise exception 'condicional_sem_alvo: pergunta %', v_id using errcode = '22023';
      end if;
      v_dep_pos := array_position(v_ids, v_dep);
      if v_dep_pos is null then
        raise exception 'condicional_adiante: pergunta % depende de "%", que não vem antes dela', v_id, v_dep
          using errcode = '22023';
      end if;
      if (v_item ? 'condicional') and
         ((v_item -> 'condicional' ? 'igual')::int + (v_item -> 'condicional' ? 'contem')::int) <> 1 then
        raise exception 'condicional_operador: pergunta % precisa de exatamente um entre igual/contem', v_id
          using errcode = '22023';
      end if;
      select e ->> 'tipo' into v_tipo_dep
        from jsonb_array_elements(p_definicao) e where e ->> 'id' = v_dep limit 1;
      if (v_item -> 'condicional' ? 'contem') and v_tipo_dep <> 'multipla' then
        raise exception 'condicional_contem: pergunta % usa "contem" sobre "%", que não é múltipla', v_id, v_dep
          using errcode = '22023';
      end if;
      if (v_item -> 'condicional' ? 'igual') and v_tipo_dep not in ('unica','sim_nao') then
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
-- gravadas NÃO são revalidadas — a 0016 semeou perguntas de tipo `numero` sem
-- opção e `p14` com opção "Outro" sem par condicional; validar retroativamente
-- reprovaria histórico legítimo. Linha nova ou alterada passa pela trava.
alter table formularios
  add constraint ck_formularios_definicao
  check (app.definicao_formulario_valida(definicao, chave)) not valid;

-- ---------------------------------------------------------------------------
-- (c) Publicar versão N+1 — ATÔMICO. Hoje `POST /api/formularios` faz
--     UPDATE(desativa) e depois INSERT em DUAS transações do supabase-js: se o
--     INSERT falhar, a chave fica PERMANENTEMENTE sem versão ativa e
--     `app.payload_link_formulario` (0028:360) passa a devolver `definicao: []`
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
--     e ativar_roteiro_versao (0030).
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

-- ---------------------------------------------------------------------------
-- (e) `ativar_roteiro_versao` (0030) passa a carimbar ativado_por/ativado_em.
--     Corpo idêntico ao original + duas colunas. É a resposta do B15.
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
--     é uma porta paralela sem validação. SELECT continua (eh_interno).
-- ---------------------------------------------------------------------------
drop policy if exists form_wr on formularios;
revoke insert, update, delete on formularios from public, anon, authenticated;
comment on table formularios is
  'Definição versionada do POP 02. Escrita SÓ pelas RPCs publicar_formulario_versao / '
  'ativar_formulario_versao (0078); authenticated só lê (form_sel/eh_interno).';
```

### `scripts/verificacao-0078.sql` — o que o roteiro tem de provar

Idempotente, `raise exception` em falha. Em prosa, os sete testes:

1. As 5 colunas novas em `formularios` e as 2 em `roteiros_versoes` existem.
2. `select count(*) from formularios_respostas` é **igual** ao valor medido antes da migration
   (o roteiro recebe o número como `\set` — o orquestrador mede antes).
3. Nenhuma `definicao` mudou: `select count(*) from formularios where definicao::text <> definicao::text`
   é inútil; o teste real é `md5(string_agg(definicao::text, '|' order by chave, versao))` comparado ao
   hash medido antes.
4. `app.definicao_formulario_valida` **aceita** a definição de cada versão já gravada da chave
   `estrategico` (prova de que a `not valid` não estava escondendo lixo — se alguma reprovar, o roteiro
   **avisa** com o id da versão e o erro, sem falhar: é informação, não regressão).
5. `publicar_formulario_versao` recusa: definição sem `p9`; opção duplicada; `unica` com 1 opção;
   condicional apontando para pergunta posterior; condicional `contem` sobre pergunta `unica`.
   Cada caso dentro de `begin … exception when others then` conferindo o `sqlerrm`.
6. **Teste transacional com rollback** (padrão da casa): `do $$ begin … publicar_formulario_versao(...)
   com p_ativar=true … assert (select count(*) from formularios where chave='estrategico' and ativo) = 1;
   raise exception 'rollback proposital'; end $$;` — prova a atomicidade sem deixar versão nova em produção.
7. `authenticated` não tem mais `insert/update/delete` em `formularios`
   (`has_table_privilege('authenticated','formularios','insert')` = false).

## A4. Contratos de API — Feature A

| Método | Rota | Papel | Corpo | 200/201 | Erros |
|---|---|---|---|---|---|
| `GET` | `/api/formularios` | interno | — | `{itens: FormularioResumo[]}` **sem `definicao`** | 401, 403 |
| `GET` | `/api/formularios/[id]` | interno | — | `{formulario: Formulario}` completo | 401, 403, 404 |
| `POST` | `/api/formularios` | **admin** | `{chave, titulo?, definicao, notas?, ativar}` | 201 `{formulario}` | 400 validação, 401, 403, 409 conflito de versão, 422 pergunta de sistema |
| `POST` | `/api/formularios/[id]/ativar` | **admin** | — | `{formulario}` | 401, 403, 404 |
| `GET` | `/api/roteiros?chave=` | interno | — | já existe, ganha `ativado_por/ativado_em` | — |
| `GET` | `/api/roteiros/[id]` | interno | — | já existe | — |
| `POST` | `/api/roteiros/[id]/ativar` | admin | — | já existe | — |

`FormularioResumo = {id, chave, versao, titulo, ativo, notas, criado_em, criado_por, ativado_por, ativado_em}`.
Lista sem `definicao` pelo mesmo motivo de `GET /api/admin/prompts` e `GET /api/roteiros`: 5+ versões
inteiras num payload de listagem é peso que nunca se usa.

**Mapeamento de erro do Postgres → HTTP** (na rota, como já se faz em `/api/roteiros/[id]/ativar`):

| `sqlerrm` começa com | HTTP | Mensagem na tela |
|---|---|---|
| `sem_permissao` | 403 | (padrão `erroSemPermissao`) |
| `versao_nao_encontrada` | 404 | "Versão de formulário não encontrada." |
| `pergunta_de_sistema_removida` | 422 | "A pergunta `p9` não pode sair: o sistema lê a resposta dela para preencher a faixa de patrimônio." |
| qualquer outro `..._invalid*`, `..._duplicad*`, `opcoes_*`, `condicional_*`, `definicao_*` | 400 | o próprio texto depois de `: ` |
| `23505` (unique) | 409 | "Outra publicação aconteceu ao mesmo tempo. Recarregue e tente de novo." |

O corpo de erro 400 mantém `{erro, detalhe}` do `respostaErro` existente; a tela usa `detalhe` para
apontar a pergunta pelo id (o texto do `raise` sempre nomeia o id).

**Rate limit:** `criarLimitadorJanela(10, 60_000)` por `perfil_id` no `POST /api/formularios`. Não é
proteção contra abuso externo (é admin autenticado) — é proteção contra um clique duplo publicar
duas versões idênticas.

## A5. Tela — aba "Formulário e roteiros"

Uma aba só, grupo **Método**, entre "Templates de mensagem" e "Versões de prompt":

```tsx
{ id: "formularios", grupo: "Método", rotulo: "Formulário e roteiros",
  descricao: "As perguntas que o cliente responde antes da sessão e os roteiros de condução — e qual versão está valendo.",
  conteudo: <FormulariosRoteirosAba /> }
```

Isso leva o Admin de 13 para 14 abas. **Justificativa contra o critério de otimização:** as 14 abas
substituem 6 rotas que hoje são código morto no `src/app/api` (o Fable reprova "rota sem botão"); e a
prévia do cliente é feita **extraindo** o assistente de `FormularioPublico.tsx`, não duplicando-o —
saldo líquido de linhas negativo no front público.

### A5.1. Sub-seção "Formulário Estratégico"

Layout em duas colunas (`lg:grid-cols-[minmax(0,1fr)_360px]`, como `ParametrosAba`):

**Esquerda — a versão em edição.** Lista de perguntas, cada linha:
`[↑] [↓]  p9 · Patrimônio · única · obrigatória   "Qual sua faixa de patrimônio estimado?"  [editar] [remover]`

- Reordenar por **setas**, não arrastar. Motivo: arrastar em `<ul>` exige `dnd` (dependência nova,
  `npm install` proibido) ou HTML5 DnD escrito à mão sem teclado — e a a11y da Fase 7 r2 é lei aqui.
  Setas são acessíveis por padrão, com `aria-label="Mover 'Qual sua faixa…' para cima"` e anúncio
  `aria-live` ("posição 9 de 17").
- Perguntas de sistema (`p1`,`p2`,`p9`,`p16`) mostram um `Selo` "usada pelo sistema" e o botão
  **remover fica desabilitado** com `title` explicando o quê quebra. O servidor recusa de qualquer
  jeito; a tela evita o beco sem saída.
- Blocos aparecem como cabeçalho de grupo (derivados do campo `bloco`, não de uma entidade nova —
  o bloco é um rótulo, não uma tabela).

**Direita — o editor da pergunta selecionada.** Campos: `id` (só na criação; imutável depois de
publicada é irrelevante, mas trocar id em rascunho é permitido), `rótulo`, `bloco` (datalist com os
blocos já usados), `tipo`, `obrigatória` (interruptor), `opções` (tabela `valor`/`rótulo` com
adicionar/remover; `valor` só editável enquanto a opção é nova — editar valor de opção existente muda
o dado que as respostas antigas comparam), `condicional` (select da pergunta anterior + operador +
select do valor).

**Barra inferior fixa:**
`[Pré-visualizar como cliente]  [Publicar versão N+1]  [ ] publicar já ativando`
com um resumo à esquerda: "17 perguntas · 5 blocos · 3 obrigatórias · nada publicado ainda".

**Estados:**
- Carregando: `EsqueletoLista`.
- Sem nenhuma versão para a chave: `EstadoVazio` "Nenhuma versão publicada. O formulário público não
  abre enquanto não houver uma versão ativa." + botão "Começar da versão de exemplo" (carrega a
  definição da última versão existente de qualquer chave; se não houver **nenhuma**, o botão não
  aparece — não se inventa formulário).
- Erro de validação vindo do servidor: faixa vermelha no topo + a linha da pergunta citada fica
  destacada e recebe foco.
- Após publicar: toast "Versão 6 publicada" + a lista de versões (direita, aba "Versões") atualiza.

**Lista de versões** (segunda aba interna da sub-seção): `v6 · ATIVA · publicada por Ana em 06/09 ·
ativada por Ana em 06/09` — com "Ativar esta" nas inativas (`ConfirmarAcao`: *"A partir de agora todo
cliente que abrir o link do formulário vê a v4. As respostas já dadas não mudam."*) e "Usar como base"
(copia a definição para o editor).

### A5.2. Pré-visualizar como cliente, SEM link real

**Não** se emite link. Emitir `links_publicos` para pré-visualizar criaria um link real numa jornada
real, gravaria na timeline e — pela promessa da barra "Enviar" — **revogaria o link que o cliente já
tem na mão**. Inaceitável.

**Não** se cria rota pública `/p/f/previa`: `/p/*` é anônimo; qualquer um leria a definição do POP 02.

**Solução:** a prévia é um componente do Admin que reusa **os mesmos componentes de apresentação** do
público, sem rede:

1. `frontend-engineer` extrai de `src/components/publico/FormularioPublico.tsx` o miolo `Assistente`
   para `src/components/publico/AssistenteFormulario.tsx`, com props puras:
   `{ blocos, respostas, aoMudar, aoConcluir, somenteLeitura?, modoPrevia? }`. Zero `fetch` dentro.
   `FormularioPublico` vira o wrapper que busca (`abrirLinkFormulario`) e envia
   (`responderFormularioPublico`). **O comportamento público não muda em nada** — é movimento.
2. `src/components/admin/FormularioPrevia.tsx` monta `<AssistenteFormulario modoPrevia>` dentro de um
   `<div className="area-publica">` (a classe que dá alvo de toque de 44 px e tipografia grande), num
   `Dialogo` em largura de celular (390 px) com moldura, para a Dra. Elaine ver o que o cliente vê.
3. `modoPrevia`: rodapé com `SeloStub` **"Pré-visualização — nada é enviado e ninguém recebe nada"**;
   a tela de consentimento aparece (é parte do que o cliente vê) mas os checkboxes são inertes; o
   botão final vira "Fim da pré-visualização" e fecha o diálogo.

Ganho: a prévia é fiel por construção (é o mesmo componente e o mesmo CSS), e o front público perde
duplicação em vez de ganhar.

### A5.3. Sub-seção "Roteiros"

Sem rota nova. Três chaves (`sessao_viabilidade`, `pop_03`, `pop_03b`), cada uma com sua lista de
versões (`GET /api/roteiros?chave=`), a ativa em destaque com **quem ativou e quando** (colunas novas),
e dois botões: **"Ativar esta"** (`ConfirmarAcao` que diz *"Sessões já conduzidas mantêm o roteiro com
que foram conduzidas"*) e **"Comparar com a ativa"**.

**Diff legível, não textual.** `src/lib/roteiro/diff.ts`, função pura + teste vitest:

```ts
export interface DiferencaRoteiro {
  bloco: string;                                  // título do bloco (ou "(bloco removido)")
  situacao: "adicionado" | "removido" | "alterado";
  itens: { tipo: "fala" | "campo" | "observar" | "proibido" | "objetivo" | "acao";
           id: string; situacao: "adicionado" | "removido" | "alterado";
           antes: string | null; depois: string | null }[];
}
export function diffRoteiro(a: RoteiroDefinicao, b: RoteiroDefinicao): DiferencaRoteiro[];
```

Casa bloco por `id`, fala/campo por `id`; o texto alterado aparece lado a lado (duas colunas em `lg`,
empilhado no celular). **Nenhuma biblioteca de diff** — casar por id resolve 100% dos casos porque
`roteiros_versoes.definicao` já é estruturada por id (0030). Sem `npm install`.

O diff também expõe uma coisa que hoje é invisível e importa: se a versão candidata **perdeu a fala
marcada `sim: 'sigilo_gravacao'`**, `registrar_sim_sessao` passa a levantar
`texto_consentimento_nao_encontrado` e a sessão trava no 1º SIM. A tela mostra faixa vermelha
**"Esta versão não tem a fala do 1º SIM (sigilo e gravação). Ativar vai travar o início da sessão."**
e o botão "Ativar esta" fica desabilitado.

## A6. O que muda no `/p/f` (formulário do cliente)

| Item | Hoje | Depois |
|---|---|---|
| `obrigatoria` | já respeitado (`perguntaPublicaRespondida`, `aria-required`, "Continuar" travado, lista `faltando` em `aria-live`) | **nada muda no código** — passa a existir alguém marcando |
| `opcoes` | `string[]` + `rotuloOpcao()` | `normalizarOpcoes()` lê os dois; `value` = `opcao.valor`, texto = `opcao.rotulo` |
| tela de conclusão | imprime o valor cru ("casado") | imprime o rótulo ("Casado(a)") |
| `condicional.igual` | funciona no público, **ausente** do tipo `PerguntaFormulario` (`src/types/banco.ts:223`) | tipo alinhado com `PerguntaFormularioPublico` |
| assistente | miolo dentro de `FormularioPublico.tsx` | extraído para `AssistenteFormulario.tsx`, mesmo comportamento |

`app.payload_link_formulario` (0028) **não muda**: já devolve `definicao` inteira, agnóstica ao formato.

---

# FEATURE B — Direitos do titular (LGPD)

## B1. Inventário: o que o sistema guarda de uma pessoa

Levantado lendo as `create table` de todas as migrations. É a espinha da RPC — se uma tabela faltar
aqui, PII sobrevive à anonimização.

**Chegada por `pessoa_id`:** `pessoas`, `jornadas`, `consentimentos`, `familiares`, `patrimonio_itens`,
`documentos`, `pagamentos`, `mensagens_recebidas`, `pesquisas_publicas`, `respostas_seminario`,
`participacoes_seminario`, `importacoes_linhas`.

**Chegada por `jornada_id`** (das jornadas da pessoa): `formularios_respostas`, `ligacoes_estrategicas`,
`ligacoes_ia`, `sessoes_viabilidade` (→ `relatorios_sessao`, `agendamentos`), `briefings`,
`execucoes_ia`, `croquis` (→ `croqui_analises`, `croqui_narrativas`, `croqui_calculos`,
`croqui_apresentacoes`), `diagnosticos_sv`, `cenarios_patrimoniais` (→ `cenario_rubricas`),
`materiais_gerados`, `mensagens_agendadas`, `eventos_timeline`, `tarefas`, `links_publicos`
(→ `links_publicos_acessos`), `documentos_pedidos`, `transcricoes` (→ `analises_transcricao`),
`jornadas_transicoes`, `agendamentos_sugestoes`.

**Sem vínculo direto — os três buracos:**
- `webhooks_eventos.bruto` — payload cru da Hotmart, com nome/e-mail/telefone. Só se acha pelo
  `transacao_externa_id` que está em `pagamentos`.
- `consultas_cnpj.qsa` — nomes de sócios pessoa natural. **Não há vínculo pessoa↔CNPJ no schema.**
  Fica fora do escopo desta RPC; vira pendência declarada (§B8).
- `erros_servidor` / `publico_rate_limit` — `ip_hash` e contexto. `publico_rate_limit` é efêmero
  (janela); `erros_servidor` tem expurgo próprio (`expurgar_erros_servidor`). Fora do escopo, declarado.

**Fora do banco:** a gravação e a transcrição da ligação por IA vivem **na Vapi** (B39). A RPC apaga o
que está aqui e **não pode** apagar o que está lá. A tela diz isso, o PDF do comprovante diz isso, e
vira item da lista do João.

## B2. Migration `0079` — só o valor de enum

`supabase/migrations/0079_desfecho_anonimizada.sql`. **Arquivo separado de propósito:** um valor novo
de enum não pode ser usado na mesma transação em que é criado. Se `0080` fosse um arquivo só, o
`update jornadas set desfecho='anonimizada'` dentro da RPC falharia na aplicação.

```sql
-- 0079_desfecho_anonimizada.sql
-- Valor novo de desfecho_jornada, em migration PRÓPRIA: Postgres não deixa usar
-- um valor de enum na mesma transação em que ele é criado. A 0080 usa.
--
-- Por que valor novo e não reaproveitar 'descartada': "descartada" é veredito
-- COMERCIAL (lead sem fit) e entra nas métricas de funil como perda. "Encerrada
-- por direito do titular" não é perda comercial — misturar as duas mentiria no
-- indicador. Aditivo: nenhuma linha existente muda de valor.
--
-- REVERSÃO: Postgres não remove valor de enum. Reverter exige recriar o tipo —
-- descrito aqui e NÃO recomendado. Antes de reverter, zerar as linhas que usam:
--   update jornadas set desfecho='descartada' where desfecho='anonimizada';
alter type desfecho_jornada add value if not exists 'anonimizada';
```

Efeito colateral **desejado e gratuito**: `app.revoga_links_ao_fechar_jornada` (0028:194) já dispara em
qualquer `desfecho <> 'aberta'` — pôr a jornada em `anonimizada` **revoga todos os links públicos
ativos dela sozinho**, pela trigger que já existe. A RPC não reimplementa isso.

Blast radius no TS (medido): `src/types/banco.ts:30`, `src/lib/api.ts:36` (duas uniões),
`src/app/api/jornadas/route.ts:31`, `src/app/api/jornadas/[id]/etapa/route.ts:26` (dois `z.enum`),
`src/components/ficha360/CabecalhoFicha.tsx:20`, `src/components/ficha360/TrilhoDaFicha.tsx:47`
(dois `Record` de rótulo). Seis pontos. `anonimizada` **não** entra no `z.enum` de
`PATCH /api/jornadas/[id]/etapa`: ninguém marca isso à mão — só a RPC.

## B3. Migration `0080` — tabela, colunas e as duas RPCs

`supabase/migrations/0080_direitos_do_titular.sql` · `scripts/verificacao-0080.sql`.

```sql
-- 0080_direitos_do_titular.sql
-- LGPD art. 18: acesso/portabilidade (exportar) e eliminação (anonimizar).
-- Aplicar DEPOIS da 0079 (valor de enum) — a RPC usa 'anonimizada'.
--
-- PRINCÍPIOS DESTE ARQUIVO
--   1. Nenhum DELETE. Em lugar nenhum. Linha antiga vira marcador; arquivo do
--      Storage é removido pela ROTA (service_role), em passo separado e idempotente.
--   2. O que sai é o que IDENTIFICA. O que fica é o fato econômico (pagamentos:
--      valor, status, data, transação) e o fato processual (houve ligação, houve
--      sessão, quando) — obrigação contábil/fiscal e prova de accountability.
--   3. `consentimentos` NÃO é tocado. É a prova da base legal do tratamento
--      (art. 37). Apagá-lo destruiria a defesa do próprio escritório, e ele não
--      contém dado do titular além do vínculo — o texto é do escritório.
--   4. Registro imutável: motivo, base legal, canal, quem, quando, e a contagem
--      do que foi alterado por tabela.
--
-- REVERSÃO: não há. Anonimização é irreversível por definição — é isso que a
-- torna eliminação. A migration em si reverte assim (sem desfazer dado):
--   drop function if exists public.confirmar_expurgo_storage(uuid, text[]);
--   drop function if exists public.anonimizar_titular(uuid,text,text,text,timestamptz,uuid);
--   drop function if exists public.registrar_exportacao_titular(uuid,text,text,text,uuid);
--   alter table pessoas drop column if exists anonimizada_em, drop column if exists anonimizacao_id;
--   drop table if exists titulares_solicitacoes;

-- ===========================================================================
-- (a) O registro. Append-only de verdade: sem policy de UPDATE/DELETE e sem
--     privilégio de tabela para authenticated (mesma postura de
--     documentos_acessos, 0012, e de links_publicos depois da 0072).
-- ===========================================================================
create table titulares_solicitacoes (
  id             uuid primary key default gen_random_uuid(),
  pessoa_id      uuid not null references pessoas(id) on delete restrict,
  tipo           text not null check (tipo in ('exportacao','anonimizacao')),
  -- Por que foi feito. Texto do escritório, não do titular.
  motivo         text not null check (length(trim(motivo)) between 10 and 2000),
  -- Sob qual base legal (LGPD art. 7/16/18). Nunca preenchido pelo sistema.
  base_legal     text not null check (length(trim(base_legal)) between 5 and 2000),
  canal_pedido   text not null check (canal_pedido in
                   ('email','whatsapp','telefone','presencial','oficio','iniciativa_do_escritorio')),
  -- Quando o TITULAR pediu (pode ser dias antes da execução). Nunca no futuro.
  solicitado_em  timestamptz not null check (solicitado_em <= now() + interval '1 minute'),
  executado_em   timestamptz not null default now(),
  executado_por  uuid not null references perfis_equipe(id),
  -- {"tabelas":{"familiares":3,...},"storage_pendente":["pessoas/…"],"storage_removido_em":null,
  --  "avisos":["gravacao_vive_na_vapi"]}
  resultado      jsonb not null default '{}'::jsonb,
  criado_em      timestamptz not null default now()
);
create index idx_titulares_solicitacoes_pessoa on titulares_solicitacoes (pessoa_id, executado_em desc);
-- Uma anonimização por pessoa. A segunda tentativa é no-op (a RPC devolve a
-- primeira) — o índice é a rede embaixo, caso alguém escreva por outro caminho.
create unique index uniq_anonimizacao_por_pessoa
  on titulares_solicitacoes (pessoa_id) where tipo = 'anonimizacao';

alter table titulares_solicitacoes enable row level security;
alter table titulares_solicitacoes force row level security;
create policy ts_sel on titulares_solicitacoes for select to authenticated
  using ((select app.eh_admin()));
revoke insert, update, delete on titulares_solicitacoes from public, anon, authenticated;
comment on table titulares_solicitacoes is
  'Trilha imutável dos pedidos de direito do titular (LGPD art. 18). Escrita SÓ pelas RPCs '
  'security definer; authenticated só lê, e só admin.';

alter table pessoas add column if not exists anonimizada_em timestamptz;
alter table pessoas add column if not exists anonimizacao_id uuid references titulares_solicitacoes(id);
comment on column pessoas.anonimizada_em is
  'Carimbo de encerramento do tratamento. NULL = pessoa ativa. A linha NUNCA é apagada — '
  'as jornadas, pagamentos e etapas continuam contando no funil histórico.';

-- ===========================================================================
-- (b) Registrar uma EXPORTAÇÃO. Chamada pela rota ANTES de montar o dossiê:
--     se a gravação do registro falhar, ninguém exporta. Exportar PII sem
--     deixar rastro de quem exportou é o pior caso desta feature.
-- ===========================================================================
create or replace function public.registrar_exportacao_titular(
  p_pessoa_id     uuid,
  p_motivo        text,
  p_base_legal    text,
  p_canal         text,
  p_solicitado_em timestamptz default now(),
  p_executado_por uuid default null
) returns titulares_solicitacoes
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_autor uuid; v_linha titulares_solicitacoes;
begin
  if auth.uid() is not null then
    if not app.eh_admin() then
      raise exception 'sem_permissao: apenas admin exporta dados de titular' using errcode = '42501';
    end if;
    select id into v_autor from perfis_equipe where auth_user_id = auth.uid() and ativo;
  else
    if p_executado_por is null then
      raise exception 'autor_obrigatorio: sem sessão, p_executado_por é obrigatório' using errcode = '22004';
    end if;
    select id into v_autor from perfis_equipe where id = p_executado_por and ativo and papel = 'admin';
    if v_autor is null then
      raise exception 'sem_permissao: p_executado_por não é admin ativo' using errcode = '42501';
    end if;
  end if;

  if not exists (select 1 from pessoas where id = p_pessoa_id) then
    raise exception 'pessoa_nao_encontrada: %', p_pessoa_id using errcode = 'P0002';
  end if;

  insert into titulares_solicitacoes
    (pessoa_id, tipo, motivo, base_legal, canal_pedido, solicitado_em, executado_por)
  values (p_pessoa_id, 'exportacao', p_motivo, p_base_legal, p_canal, p_solicitado_em, v_autor)
  returning * into v_linha;
  return v_linha;
end $$;
revoke execute on function public.registrar_exportacao_titular(uuid,text,text,text,timestamptz,uuid)
  from public, anon;
grant execute on function public.registrar_exportacao_titular(uuid,text,text,text,timestamptz,uuid)
  to authenticated, service_role;

-- ===========================================================================
-- (c) A anonimização. UMA transação, `for update` na pessoa. Idempotente:
--     chamada de novo sobre alguém já anonimizado devolve o registro original
--     e não altera nada.
-- ===========================================================================
create or replace function public.anonimizar_titular(
  p_pessoa_id     uuid,
  p_motivo        text,
  p_base_legal    text,
  p_canal         text,
  p_solicitado_em timestamptz default now(),
  p_executado_por uuid default null
) returns titulares_solicitacoes
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_autor      uuid;
  v_pessoa     pessoas%rowtype;
  v_linha      titulares_solicitacoes;
  v_marcador   text;
  v_jornadas   uuid[];
  v_sessoes    uuid[];
  v_croquis    uuid[];
  v_caminhos   text[];
  v_transacoes text[];
  v_contagem   jsonb := '{}'::jsonb;
  v_avisos     text[] := '{}';
  v_n          int;
begin
  -- ---- autor (padrão 0071) -------------------------------------------------
  if auth.uid() is not null then
    if not app.eh_admin() then
      raise exception 'sem_permissao: apenas admin encerra o tratamento de um titular' using errcode = '42501';
    end if;
    select id into v_autor from perfis_equipe where auth_user_id = auth.uid() and ativo;
  else
    if p_executado_por is null then
      raise exception 'autor_obrigatorio: sem sessão, p_executado_por é obrigatório' using errcode = '22004';
    end if;
    select id into v_autor from perfis_equipe where id = p_executado_por and ativo and papel = 'admin';
    if v_autor is null then
      raise exception 'sem_permissao: p_executado_por não é admin ativo' using errcode = '42501';
    end if;
  end if;

  select * into v_pessoa from pessoas where id = p_pessoa_id for update;
  if not found then
    raise exception 'pessoa_nao_encontrada: %', p_pessoa_id using errcode = 'P0002';
  end if;

  -- ---- idempotência --------------------------------------------------------
  if v_pessoa.anonimizada_em is not null then
    select * into v_linha from titulares_solicitacoes
     where pessoa_id = p_pessoa_id and tipo = 'anonimizacao' limit 1;
    return v_linha;   -- no-op explícito; a rota devolve 200 com ja_anonimizada
  end if;

  -- ---- travas de negócio ---------------------------------------------------
  -- (1) dado de demonstração não é titular. Anonimizar as 4 famílias de exemplo
  --     quebraria `scripts/seed-exemplo-completo.ts` e a apresentação.
  if v_pessoa.origem_dado = 'exemplo' then
    raise exception 'origem_dado_exemplo: esta pessoa é dado de demonstração, não um titular real'
      using errcode = '22023';
  end if;
  -- (2) login do cliente. Hoje sempre NULL (o cliente não loga). Se um dia
  --     existir, apagar conta de auth é decisão que não cabe nesta RPC.
  if v_pessoa.auth_user_id is not null then
    raise exception 'titular_com_login: esta pessoa tem conta de acesso; trate auth.users antes'
      using errcode = '22023';
  end if;
  -- (3) HIPÓTESE CONSERVADORA do BLOQUEIO B41 (§B9): holding contratada e em
  --     execução recusa. Enquanto o contrato roda, o escritório precisa dos
  --     dados para executá-lo.
  if exists (
    select 1 from jornadas
     where pessoa_id = p_pessoa_id and etapa = 'holding_contratada' and desfecho = 'aberta'
  ) then
    raise exception 'holding_em_execucao: há holding contratada em execução para este titular'
      using errcode = '22023';
  end if;

  v_marcador := 'Titular anonimizado ' || left(replace(p_pessoa_id::text, '-', ''), 8);

  select coalesce(array_agg(id), '{}') into v_jornadas from jornadas where pessoa_id = p_pessoa_id;
  select coalesce(array_agg(id), '{}') into v_sessoes  from sessoes_viabilidade where jornada_id = any (v_jornadas);
  select coalesce(array_agg(id), '{}') into v_croquis  from croquis where jornada_id = any (v_jornadas);
  select coalesce(array_agg(caminho), '{}') into v_caminhos from documentos where pessoa_id = p_pessoa_id;
  select coalesce(array_agg(transacao_externa_id), '{}') into v_transacoes
    from pagamentos where pessoa_id = p_pessoa_id or jornada_id = any (v_jornadas);

  -- =========================================================================
  -- SUBSTITUIÇÃO DE PII. Tudo UPDATE. Nenhum DELETE.
  -- =========================================================================

  -- pessoas: sobra id, criado_em, origem_dado. Nem UF fica: UF + faixa etária +
  -- faixa de patrimônio reidentificam num universo pequeno como o do escritório.
  update pessoas set
    nome = v_marcador, email = null, telefone = null, cidade = null, uf = null,
    profissao = null, faixa_etaria = null, estado_civil = null, observacoes = null,
    ativo = false, anonimizada_em = now()
   where id = p_pessoa_id;
  v_contagem := v_contagem || jsonb_build_object('pessoas', 1);

  -- familiares: são TERCEIROS cujos dados o escritório trata. Saem junto.
  update familiares set
    nome = null, ocupacao = null, observacoes = null, regime_casamento = null,
    ano_casamento = null, idade = null, ativo = false
   where pessoa_id = p_pessoa_id;
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('familiares', v_n);

  -- patrimônio: fica o TIPO do bem (estatística), somem descrição e valores.
  update patrimonio_itens set
    descricao = 'removido', detalhes = '{}'::jsonb, destinacao = null,
    valor_historico = null, valor_mercado = null, valor_locacao_mensal = null,
    ano_aquisicao = null, ativo = false
   where pessoa_id = p_pessoa_id;
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('patrimonio_itens', v_n);

  -- respostas do POP 02: fica a prova de que respondeu e quando.
  update formularios_respostas set respostas = '{}'::jsonb where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('formularios_respostas', v_n);

  -- respostas do seminário.
  update respostas_seminario set resposta = 'removida' where pessoa_id = p_pessoa_id;
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('respostas_seminario', v_n);

  -- ligação humana (POP 03/03-B): some o conteúdo E o perfilamento comportamental.
  update ligacoes_estrategicas set
    respostas = '{}'::jsonb, expectativa_principal = null, preocupacao_principal = null,
    assunto_atencao_especial = null, objecoes_percebidas = null, pessoas_mencionadas = null,
    ritmo = null, estilo_resposta = null, sinais = null, frases_marcantes = null,
    processo_decisorio = null, decisores_presentes_na_sessao = null,
    transcricao = null, observacoes = null
   where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('ligacoes_estrategicas', v_n);

  -- ligação por IA: fica o custo e a duração; some voz, texto e telefone.
  -- `id_externo` sai também: é o ponteiro para a gravação na Vapi.
  update ligacoes_ia set
    transcricao = null, resumo = null, gravacao_url = null, telefone = 'removido',
    id_externo = null, erro = null,
    status = case when status in ('na_fila','discando','em_ligacao') then 'cancelada' else status end
   where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('ligacoes_ia', v_n);
  if v_n > 0 then v_avisos := v_avisos || 'gravacao_e_transcricao_originais_vivem_na_vapi'; end if;

  -- briefing: é o retrato psicológico do titular. Some inteiro.
  update briefings set conteudo = '{}'::jsonb where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('briefings', v_n);

  -- execuções de IA: custo/tokens/modelo FICAM (contabilidade de IA);
  -- some tudo que aponta para a entrada e a saída.
  update execucoes_ia set hash_entrada = null, erro = null, request_id = null
   where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('execucoes_ia', v_n);

  -- sessão e relatório da SV.
  update sessoes_viabilidade set link_sala = null, gravacao_url = null, motivo_resultado = null
   where id = any (v_sessoes);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('sessoes_viabilidade', v_n);

  update relatorios_sessao set
    quem_acompanha = null, motivacao_cliente = null, receita_familiar_mensal = null,
    ideia_custo_inventario = null, reserva_ou_seguro = null, preocupacao_predominante = null,
    como_deseja_organizar = null, motiva_evitar_inventario = null, interesse_imediato = null,
    relacao_filhos_terceiros = null, porque_nos_procurou = null, falta_planejamento_preocupa = null,
    resultado_sessao = null, consideracoes_apresentacao_croqui = null, tributos = '{}'::jsonb
   where sessao_id = any (v_sessoes);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('relatorios_sessao', v_n);

  -- diagnóstico, cenários, croqui e derivados.
  update diagnosticos_sv set blocos = '{}'::jsonb where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('diagnosticos_sv', v_n);

  update cenarios_patrimoniais set nota = null where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('cenarios_patrimoniais', v_n);

  update croquis set titulo = 'Croqui de titular anonimizado', conteudo = '{"slides":[]}'::jsonb
   where id = any (v_croquis);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('croquis', v_n);

  update croqui_narrativas set conteudo = '{}'::jsonb where croqui_id = any (v_croquis);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('croqui_narrativas', v_n);

  update materiais_gerados set conteudo = '{}'::jsonb, dor_principal = null
   where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('materiais_gerados', v_n);

  -- transcrições de reunião com este cliente (base de conhecimento) + análises.
  update analises_transcricao set conteudo = '{}'::jsonb
   where transcricao_id in (select id from transcricoes where jornada_id = any (v_jornadas));
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('analises_transcricao', v_n);

  update transcricoes set conteudo = '', rotulo = 'Transcrição de titular anonimizado', consultor = null
   where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('transcricoes', v_n);

  -- comunicação enviada e recebida. Status e datas ficam (prova de contato).
  update mensagens_agendadas set
    destinatario = 'removido', assunto_renderizado = null, corpo_renderizado = null,
    provedor_id = null, erro = null,
    status = case when status in ('pendente','enviando') then 'cancelada' else status end
   where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('mensagens_agendadas', v_n);

  update mensagens_recebidas set
    corpo = '', telefone = null, anexos = '[]'::jsonb, bruto = '{}'::jsonb
   where pessoa_id = p_pessoa_id or jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('mensagens_recebidas', v_n);

  -- dinheiro: fica valor, status, data e a transação (obrigação fiscal).
  update pagamentos set
    comprador_email = null, comprador_nome = null, comprador_telefone = null, bruto = '{}'::jsonb
   where pessoa_id = p_pessoa_id or jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('pagamentos', v_n);

  -- webhook cru da Hotmart: casado pelo id de transação (não há FK).
  -- Varredura por texto; a tabela é pequena e isto roda uma vez por titular.
  update webhooks_eventos set bruto = '{}'::jsonb
   where array_length(v_transacoes, 1) is not null
     and exists (select 1 from unnest(v_transacoes) t where bruto::text like '%' || t || '%');
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('webhooks_eventos', v_n);

  -- pesquisa em fontes públicas.
  update pesquisas_publicas set resumo = 'removido a pedido do titular', url = null
   where pessoa_id = p_pessoa_id or jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('pesquisas_publicas', v_n);

  -- linha bruta da planilha de importação (nome, e-mail, telefone).
  update importacoes_linhas set dados = '{}'::jsonb, motivo = null where pessoa_id = p_pessoa_id;
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('importacoes_linhas', v_n);

  -- timeline e tarefas: o TÍTULO fica (é rótulo de sistema — "Formulário
  -- estratégico atualizado"); descrição e payload saem.
  update eventos_timeline set descricao = null, dados = '{}'::jsonb where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('eventos_timeline', v_n);

  update tarefas set descricao = null where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('tarefas', v_n);

  update documentos_pedidos set nota = null where jornada_id = any (v_jornadas);
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('documentos_pedidos', v_n);

  -- acessos aos links públicos: IP e user-agent são do TITULAR.
  update links_publicos_acessos set ip_hash = null, user_agent = null
   where link_id in (select id from links_publicos where jornada_id = any (v_jornadas));
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('links_publicos_acessos', v_n);

  -- links ativos: revogados aqui E pela trigger de fechamento da jornada (0028).
  update links_publicos set estado = 'revogado', revogado_em = now()
   where jornada_id = any (v_jornadas) and estado = 'ativo';
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('links_publicos_revogados', v_n);

  -- agendamentos futuros: sugestão tem motivo em texto livre.
  update agendamentos_sugestoes set motivo_sugestao = null
   where link_id in (select id from links_publicos where jornada_id = any (v_jornadas));
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('agendamentos_sugestoes', v_n);

  -- documentos: a LINHA fica (prova de que existiu e foi acessada); o nome do
  -- arquivo e o hash saem. `caminho` fica INTACTO aqui de propósito — a rota
  -- precisa dele para remover o objeto do Storage no passo seguinte, e ele é
  -- `not null unique`. Quem zera é `confirmar_expurgo_storage`.
  update documentos set nome_arquivo = 'removido', sha256 = null where pessoa_id = p_pessoa_id;
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('documentos', v_n);

  -- jornadas: faixa declarada sai; desfecho vira 'anonimizada' (a trigger
  -- app.revoga_links_ao_fechar_jornada roda aqui de novo, e é idempotente).
  update jornadas set
    faixa_patrimonio_declarada = null,
    motivo_desfecho = 'Tratamento encerrado a pedido do titular (LGPD art. 18)',
    desfecho = 'anonimizada'
   where pessoa_id = p_pessoa_id;
  get diagnostics v_n = row_count; v_contagem := v_contagem || jsonb_build_object('jornadas', v_n);

  if array_length(v_caminhos, 1) is not null then
    v_avisos := v_avisos || 'arquivos_do_storage_pendentes_de_remocao';
  end if;

  insert into titulares_solicitacoes
    (pessoa_id, tipo, motivo, base_legal, canal_pedido, solicitado_em, executado_por, resultado)
  values (p_pessoa_id, 'anonimizacao', p_motivo, p_base_legal, p_canal, p_solicitado_em, v_autor,
          jsonb_build_object(
            'tabelas', v_contagem,
            'storage_pendente', to_jsonb(coalesce(v_caminhos, '{}')),
            'storage_removido_em', null,
            'avisos', to_jsonb(v_avisos)))
  returning * into v_linha;

  update pessoas set anonimizacao_id = v_linha.id where id = p_pessoa_id;

  return v_linha;
end $$;

revoke execute on function public.anonimizar_titular(uuid,text,text,text,timestamptz,uuid) from public, anon;
grant  execute on function public.anonimizar_titular(uuid,text,text,text,timestamptz,uuid)
  to authenticated, service_role;
comment on function public.anonimizar_titular(uuid,text,text,text,timestamptz,uuid) is
  'LGPD art. 18 — encerra o tratamento dos dados de um titular. Uma transação, for update na pessoa, '
  'nenhum DELETE. Idempotente: segunda chamada devolve o registro da primeira. NÃO remove objeto do '
  'Storage (é passo da rota) nem a gravação que vive na Vapi.';

-- ===========================================================================
-- (d) Fecho do expurgo de Storage. Chamada pela rota DEPOIS de remover os
--     objetos. Idempotente: rodar duas vezes não muda o resultado.
-- ===========================================================================
create or replace function public.confirmar_expurgo_storage(
  p_solicitacao_id uuid,
  p_caminhos       text[]
) returns titulares_solicitacoes
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_linha titulares_solicitacoes; v_pessoa uuid;
begin
  if auth.uid() is not null and not app.eh_admin() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;

  select * into v_linha from titulares_solicitacoes where id = p_solicitacao_id for update;
  if not found then
    raise exception 'solicitacao_nao_encontrada: %', p_solicitacao_id using errcode = 'P0002';
  end if;
  if v_linha.tipo <> 'anonimizacao' then
    raise exception 'tipo_invalido: só anonimização tem expurgo de arquivo' using errcode = '22023';
  end if;
  v_pessoa := v_linha.pessoa_id;

  -- `caminho` é not null unique: vira um valor estável e não identificável.
  update documentos set caminho = 'expurgado/' || id::text
   where pessoa_id = v_pessoa and caminho = any (p_caminhos);

  update titulares_solicitacoes
     set resultado = resultado
                   || jsonb_build_object('storage_removido_em', to_jsonb(now()))
                   || jsonb_build_object('storage_pendente',
                        coalesce((select jsonb_agg(c) from jsonb_array_elements_text(resultado -> 'storage_pendente') c
                                   where c #>> '{}' <> all (p_caminhos)), '[]'::jsonb))
   where id = p_solicitacao_id
  returning * into v_linha;

  return v_linha;
end $$;
revoke execute on function public.confirmar_expurgo_storage(uuid, text[]) from public, anon;
grant  execute on function public.confirmar_expurgo_storage(uuid, text[]) to authenticated, service_role;
```

### `scripts/verificacao-0080.sql` — o que o roteiro prova

Tudo dentro de `do $$ … raise exception 'rollback proposital' … $$` para **não** anonimizar ninguém
de verdade:

1. `titulares_solicitacoes` existe, tem RLS + force, e `authenticated` não tem `insert/update/delete`.
2. As duas colunas novas em `pessoas` existem e são NULL em 100% das linhas
   (`select count(*) from pessoas where anonimizada_em is not null` = 0 — `A MEDIR`, esperado 0).
3. `anonimizar_titular` **recusa** pessoa `origem_dado='exemplo'` (usa uma das 4 famílias de demo);
   confere `sqlerrm like 'origem_dado_exemplo%'`.
4. `anonimizar_titular` **recusa** sem sessão e sem `p_executado_por` (`22004`) e com
   `p_executado_por` de perfil não-admin (`42501`).
5. Cria uma pessoa real descartável dentro do bloco, com jornada + resposta de formulário + pagamento;
   roda a RPC; **assere**: `pessoas.nome` casa `'Titular anonimizado %'`, `email is null`,
   `formularios_respostas.respostas = '{}'`, `pagamentos.valor` **inalterado**,
   `pagamentos.comprador_nome is null`, `jornadas.desfecho = 'anonimizada'`,
   `links_publicos` sem nenhum `ativo`, `consentimentos` **contagem inalterada**.
6. Segunda chamada devolve o **mesmo** `titulares_solicitacoes.id` (idempotência).
7. `raise exception 'rollback proposital'` — nada é gravado.
8. Varredura de completude, **fora** do bloco: para cada tabela do inventário §B1, um `select` que
   confirma que a RPC a menciona (checagem por `pg_get_functiondef(...) like '%<tabela>%'`). Se uma
   tabela do inventário não aparece no corpo da função, o roteiro **falha** — é a rede contra "esqueci
   uma tabela" quando alguém criar a próxima.

## B4. Contratos de API — Feature B

Todas sob `exigirPapel("admin")` e `runtime = "nodejs"`, `dynamic = "force-dynamic"`.

| Método | Rota | Corpo | Resposta | Erros |
|---|---|---|---|---|
| `GET` | `/api/admin/titulares/[pessoaId]/inventario` | — | `{pessoa:{id,nome,anonimizada_em}, tabelas:[{tabela,rotulo,linhas}], documentos:[{id,tipo,nome_arquivo,tamanho_bytes,criado_em}], solicitacoes:[…]}` | 401,403,404,429 |
| `POST` | `/api/admin/titulares/[pessoaId]/exportacoes` | `{motivo, base_legal, canal_pedido, solicitado_em?, formato:"json"\|"pdf"}` | arquivo (`application/json` ou `application/pdf`) + cabeçalhos `X-Solicitacao-Id` e `Content-Disposition: attachment` | 400,401,403,404,429 |
| `POST` | `/api/admin/titulares/[pessoaId]/anonimizacao` | `{motivo, base_legal, canal_pedido, solicitado_em, confirmacao_nome}` | `{solicitacao, ja_anonimizada:boolean, storage:{removidos:n, falhos:[…]}}` | 400,401,403,404,409,422,429 |
| `POST` | `/api/admin/titulares/[pessoaId]/anonimizacao/expurgo` | `{solicitacao_id}` | `{solicitacao, removidos, falhos}` | 401,403,404,409 |

**Rate limit** (`criarLimitadorJanela`, chave = `perfil_id`, com `Retry-After`):
inventário 30/min · exportação **3/min** · anonimização **2/min** · expurgo 5/min.
Exportação é a operação mais perigosa do sistema (PII completa num arquivo) — o limite é o menor.

**`confirmacao_nome`** é validado **no servidor**: precisa ser exatamente igual a `pessoas.nome`
(comparação após `trim`, sensível a acento e maiúscula). Diferente → `422 confirmacao_nao_confere`.
Isso não é UX de tela — é trava de servidor, porque uma tela pode ser burlada.

**Erros do Postgres → HTTP:** `sem_permissao`→403 · `pessoa_nao_encontrada`→404 ·
`origem_dado_exemplo`/`titular_com_login`/`holding_em_execucao`→**422** com o texto explicando ·
`autor_obrigatorio`→500 (é bug de chamada, não do usuário).

### B4.1. A ordem do expurgo de Storage — três tempos, idempotente

O problema: se a rota apagar o objeto **antes** da RPC e a RPC falhar, o arquivo já foi e o banco não
sabe. Se a RPC zerar `documentos.caminho` **antes**, a rota não sabe o que apagar.

```
1) rota (service_role) lê `documentos.caminho` da pessoa  → lista em memória
2) rota chama `anonimizar_titular`                        → banco anonimizado; caminhos ficam
                                                             gravados em resultado.storage_pendente
3) rota chama `storage.from('documentos-sensiveis').remove(caminhos)`
4) rota chama `confirmar_expurgo_storage(solicitacao_id, caminhos_removidos)`
   → `documentos.caminho` vira 'expurgado/<id>' e `storage_removido_em` é carimbado
```

Se **3** ou **4** falharem: a resposta é `200` com `storage.falhos` preenchido, e o registro fica com
`storage_removido_em: null`. A tela mostra faixa **"Arquivos ainda no armazenamento — expurgo
pendente"** com botão "Concluir expurgo", e a `PendenciasAba` do Admin ganha a linha (uma consulta a
mais, mas ela substitui um silêncio — o Fable reprova silêncio, não consulta). Repetir o passo 3+4 é
seguro: `remove` de objeto inexistente não é erro fatal no Supabase Storage, e o `update` do passo 4
casa por `caminho = any(...)`, então já-expurgados não casam.

### B4.2. O dossiê exportado

`src/server/lgpd/dossie.ts` — leitura por `criarClienteAdmin()` (service_role), montagem tipada:

```ts
export interface DossieTitular {
  _metadados: {
    gerado_em: string; gerado_por: { id: string; nome: string };
    solicitacao_id: string; versao_esquema: 1;
    sistema: "SIC-HF"; controlador: string;      // configuracoes['escritorio.razao_social']
    tabelas_incluidas: string[];
    observacoes: string[];                        // sempre explícitas, nunca vazias por omissão
  };
  pessoa: …; jornadas: …[]; consentimentos: …[]; familiares: …[]; patrimonio: …[];
  formulario: { versao: number; perguntas: {id,rotulo,resposta_rotulo,resposta_valor}[] } | null;
  ligacoes: …[]; ligacoes_ia: …[]; sessoes: …[]; relatorios: …[]; briefings: …[];
  croquis: …[]; diagnosticos: …[]; materiais: …[]; pagamentos: …[];
  mensagens_enviadas: …[]; mensagens_recebidas: …[]; documentos: DocumentoNoDossie[];
  timeline: …[]; pesquisas_publicas: …[]; respostas_seminario: …[];
}
```

Regras não negociáveis do dossiê:
- **Nada de dado inventado.** Seção sem linha aparece como `[]` no JSON e como *"nenhum registro"* no
  PDF. Nunca `0`, nunca placeholder.
- O formulário sai com **pergunta e resposta legíveis** (usa a `definicao` da versão
  `formularios_respostas.formulario_id`, não a ativa — a resposta pertence à versão dela) e com o
  rótulo da opção via `normalizarOpcoes` — é aqui que a Feature A paga a Feature B.
- `observacoes` sempre traz, quando aplicável: *"A gravação e a transcrição originais da ligação por IA
  ficam no provedor de voz (Vapi) e não fazem parte deste pacote"* e *"Os arquivos enviados estão
  listados com seus metadados; o conteúdo é baixado individualmente por link assinado, com registro de
  acesso."*

**Documentos: sem ZIP.** Justificativa explícita, porque é uma redução deliberada de escopo:
o projeto não tem dependência de zip e `npm install` está **proibido** nesta fase (poda o lockfile no
Windows). Escrever um empacotador ZIP à mão em cima de PII é código novo, sem teste, no caminho mais
sensível do sistema. Portabilidade (art. 18, V) é atendida pelo **JSON estruturado e legível por
máquina** + a lista de documentos com link para `GET /api/documentos/[id]/url` (rota que já existe e
que **audita cada acesso** em `documentos_acessos`). Pacote único vira BLOQUEIO B43.

**PDF:** `src/server/lgpd/pdf-dossie.ts`, `pdfkit`, reusando a paleta e o carregamento de fonte de
`src/server/material/pdf.ts` (extrair `COR` e o helper de fonte para `src/server/pdf/base.ts` — os dois
passam a importar de lá; menos código, não mais). Capa com o registro (motivo, base legal, quem,
quando), sumário, e uma seção por bloco.

## B5. Telas — aba "Direitos do titular"

Aba nova, grupo **Cadastro**, última posição, **admin apenas** (não entra no ramo `somente_custo_ia`
do `AdminApp`):

```tsx
{ id: "titulares", grupo: "Cadastro", rotulo: "Direitos do titular",
  descricao: "Exportar tudo que o sistema guarda de uma pessoa, ou encerrar o tratamento dos dados dela.",
  conteudo: <DireitosDoTitularAba /> }
```

**Passo 1 — achar a pessoa.** Campo de busca reusando `GET /api/jornadas?busca=` (já existe, já usa
`buscar_pessoas_por_termo`). Resultado: nome, cidade, etapa. **Estado vazio:** *"Busque pelo nome, e-mail
ou telefone da pessoa."* — não lista ninguém por padrão (listar todo mundo numa tela de LGPD é o
oposto do que ela serve).

**Passo 2 — o que o sistema guarda.** Cartão com a tabela do inventário: `Familiares 3 · Documentos 2 ·
Mensagens enviadas 11 · Briefings 1 · …`. Linha com 0 mostra *"nenhum registro"*, não `0`.
Abaixo, a lista de documentos (tipo, nome, tamanho, data) e o histórico de solicitações anteriores.

**Passo 3 — duas ações, dois cartões.**

*Cartão "Exportar os dados".* Campos: **motivo** (obrigatório, ≥10 caracteres), **base legal**
(obrigatório; `datalist` com sugestões — "Art. 18, II — acesso do titular", "Art. 18, V —
portabilidade", "Determinação judicial" — sugestão é atalho, o texto é livre e é da advogada),
**canal do pedido**, **data do pedido**, **formato** (JSON / PDF). Botão "Gerar e baixar".
Texto fixo abaixo: *"O download fica registrado com seu nome. Os arquivos enviados pelo cliente não
vêm no pacote — cada um é baixado pelo link da lista acima, e cada download também fica registrado."*

*Cartão "Encerrar o tratamento (anonimizar)".* Moldura de perigo. Antes do formulário, um resumo em
prosa, não em jargão:

> **O que acontece.** Nome, e-mail, telefone, endereço, respostas, transcrições, briefings, croquis e
> os arquivos enviados são substituídos por marcadores e removidos. **O que fica.** Os pagamentos
> (valor, data, transação), as etapas e as datas da jornada, e os consentimentos — obrigação contábil
> e prova da base legal. **O que não dá para desfazer.** Isto. Não há como voltar.
> **O que continua fora daqui.** A gravação da ligação por IA fica no provedor de voz e precisa ser
> apagada lá.

Campos: motivo, base legal, canal, data do pedido, e **"Digite o nome completo da pessoa para
confirmar"** — comparado no servidor. Botão "Encerrar o tratamento" desabilitado até o nome bater
localmente; o servidor confere de novo.

**Passo 4 — depois.** Os dois cartões de ação somem. Fica um cartão de estado:

> **Tratamento encerrado em 06/09/2026 às 15:40, por Ana Souza.**
> Base legal: Art. 18, VI — eliminação. Pedido recebido por e-mail em 04/09/2026.
> 42 registros alterados em 21 tabelas · 2 arquivos removidos do armazenamento.
> [Baixar comprovante (PDF)]

E, se o expurgo de Storage não completou:

> ⚠ **2 arquivos ainda estão no armazenamento.** O banco já foi anonimizado; a remoção dos arquivos
> falhou. [Concluir expurgo]

**Sumir da busca.** O brief pede que "a pessoa suma da busca". Não é preciso filtro nenhum: o nome
deixou de existir, então nenhuma busca por nome, e-mail ou telefone casa. Ela continua acessível pelo
id e aparece no histórico da equipe como `Titular anonimizado 3f2a1c9d` com selo — o que é honesto e
preserva o histórico operacional. **Filtrar `anonimizada_em is null` na busca seria esconder da
própria equipe um fato que aconteceu.** Ver CONFLITO C4.

---

## C. CONFLITO — o que colide com o que já existe

| # | Conflito | Consequência | Caminho proposto |
|---|---|---|---|
| **C1** | **"A Dra. Elaine edita o formulário"** vs. o Admin ser `admin`-only. `AdminApp` só monta duas abas para `advogada` (Custo de IA e Repertório), e `formularios.form_wr` era `eh_admin`. Se a Dra. Elaine é `advogada` no `perfis_equipe`, **ela não vê a aba que foi feita para ela**. | A feature entrega uma tela que a dona do método não abre. | **BLOQUEIO B40.** Hipótese conservadora aplicada no desenho: continua `admin`. Se o João disser que ela é `advogada`, a mudança é de uma linha na RPC (`app.ve_patrimonio()` no lugar de `app.eh_admin()`) + montar a aba no ramo `somente_custo_ia` — mas **não** faço isso sem ordem: alargar quem publica o POP 02 alarga quem muda o que todo cliente vê. |
| **C2** | `opcoes` muda de forma (`string[]` → `[{valor,rotulo}]`) e **cinco versões já gravadas** usam a forma antiga. | Se o código só ler a forma nova, o `/p/f` do cliente quebra hoje, antes de qualquer publicação. | `normalizarOpcoes()` lê as duas, sempre. `rotuloOpcao()` **fica** como fallback do legado. Zero backfill. |
| **C3** | `POST /api/formularios` atual desativa e insere em **duas transações**. Se o insert falhar, a chave fica sem versão ativa e o formulário público morre em silêncio (`definicao: []`, `formulario_indisponivel`). | Bug real hoje, em rota sem botão — vira bug com botão no dia em que a aba existir. | A rota passa a chamar `publicar_formulario_versao`, atômica. A policy `form_wr` é revogada para não sobrar porta paralela (mesma jogada da 0072). |
| **C4** | "A pessoa some da busca" vs. preservar histórico. | Filtrar anonimizados na busca esconde da equipe um fato que aconteceu. | Não filtra nada: sem nome, e-mail e telefone, nenhuma busca por termo casa. O efeito pedido acontece por consequência. A pessoa continua visível pelo id, rotulada. |
| **C5** | "Anonimizar" vs. `origem_dado='exemplo'`. As 4 famílias de demo são as pessoas mais fáceis de clicar numa tela nova. | Anonimizar uma delas quebra `seed-exemplo-completo.ts` e a apresentação ao cliente. | A RPC **recusa** `origem_dado='exemplo'` (`22023`), e a tela nem mostra o botão para elas. |
| **C6** | `documentos.caminho` é `not null unique` e a rota precisa dele para apagar o objeto. | Zerar na RPC impede o expurgo; não zerar deixa o slug (que pode conter o nome do arquivo do cliente) no banco. | Três tempos, §B4.1: a RPC deixa o caminho, a rota apaga o objeto, `confirmar_expurgo_storage` troca por `expurgado/<id>`. |
| **C7** | `desfecho_jornada` novo valor vs. seis pontos de TS que enumeram os cinco atuais. | `tsc` quebra se o backend só mexer no banco. | `0079` isolada + o backend atualiza as duas uniões, os dois `z.enum` (só o de leitura) e os dois `Record` de rótulo. `anonimizada` **não** entra no `z.enum` de escrita da etapa. |
| **C8** | A gravação da ligação por IA vive **na Vapi** (B39), fora do sistema. | "Anonimizado" no SIC-HF não é "eliminado" no mundo. | A RPC apaga `id_externo` e grava o aviso `gravacao_e_transcricao_originais_vivem_na_vapi`; a tela e o PDF dizem isso; vira item da lista do João. |
| **C9** | `transcricoes` é ao mesmo tempo PII do cliente e **repertório do método** (base de conhecimento que alimenta a IA). | Anonimizar reduz o repertório. | Anonimiza mesmo assim — transcrição de reunião com aquele cliente é PII bruta e a lei ganha do repertório. Consequência declarada na tela ("N transcrições da base de conhecimento serão limpas"). |
| **C10** | Aba 14 no Admin vs. o critério de otimização do Fable. | "Empilhou tela." | As duas abas fecham **6 rotas mortas** e a prévia é feita **extraindo** o assistente do formulário público, não duplicando. Saldo de linhas do front público: negativo. |

---

## D. BLOQUEIO — decisões que não são técnicas

Numeração continua de B39 (última usada, `docs/ARQUITETURA-FASE-4.md`).

| # | Pergunta | Quem decide | Hipótese conservadora que já está no desenho | Custo de mudar depois |
|---|---|---|---|---|
| **B40** | **Quem publica o Formulário Estratégico e ativa o roteiro oficial: só `admin`, ou também `advogada`?** O Admin hoje é `admin`-only e a Dra. Elaine pode não ser `admin`. | João / Dra. Elaine | **`admin`.** A aba não aparece para `advogada`. | Baixo: uma linha na RPC + montar a aba no ramo `somente_custo_ia`. |
| **B41** | **Pode anonimizar um titular com holding contratada em execução?** | Dra. Elaine | **Não.** A RPC recusa `etapa='holding_contratada' and desfecho='aberta'` com `holding_em_execucao`. | Baixo: remover o `if`. Alto no sentido inverso (permitir e depois querer proibir). |
| **B42** | **Retenção mínima legal: quantos anos o esqueleto contábil fica antes de qualquer expurgo?** (5 anos fiscal? 10 do Código Civil?) E `webhooks_eventos` cru: anonimizar por titular (é o que faço) ou expurgar tudo por idade? | Dra. Elaine | **Sem expurgo por idade nesta rodada.** Pagamento e webhook casado com o titular são anonimizados; o resto de `webhooks_eventos` fica. | Médio: job de expurgo por idade é migration + etapa de cron novos. |
| **B43** | **Portabilidade exige pacote único (ZIP com os arquivos)?** | Dra. Elaine | **Não.** JSON estruturado + PDF + documentos por link assinado auditado. Sem dependência nova. | Médio: exige `npm install` de um empacotador, fora das regras desta fase. |
| **B44** | **Familiares e sócios são titulares por si.** Um filho pode pedir eliminação sem que o pai (o cliente) peça. Hoje `familiares` só existe pendurado em `pessoas`. | Dra. Elaine | **Fora de escopo.** A anonimização do titular já leva os familiares dele junto; não existe caminho para anonimizar **só** um familiar. | Alto: exige repensar `familiares` como entidade com identidade própria. |
| **B45** | **`consultas_cnpj.qsa` guarda nomes de sócios pessoa natural e não tem vínculo com `pessoas`.** | Dra. Elaine | **Não tocado.** Declarado como pendência na tela e no PDF do comprovante. | Médio: exige vínculo pessoa↔CNPJ, que hoje não existe no schema. |
| **B46** | **Quem apaga a gravação na Vapi**, e em quanto tempo? (é a continuação prática de B19/B39, que seguem em aberto) | João | A anonimização apaga o ponteiro (`id_externo`) e **avisa** que o original segue lá. | Baixo do lado do código; é operação. |
| **B47** | **O dossiê entrega o trabalho interno do escritório.** O pacote do art. 18 reúne, numa seção separada e rotulada "Anotações internas do escritório", o que a equipe e a IA escreveram *sobre* o titular: impressões da ligação estratégica (`objecoes_percebidas`, `sinais`, `frases_marcantes`), o briefing (`briefings.conteudo`), as análises do croqui e da transcrição e `pessoas.observacoes`. São dados pessoais do titular e entram **por padrão** — omitir sem declarar violaria a regra da casa. `ligacoes_ia.gravacao_url` fica de fora (B46): sai como "gravação guardada pelo provedor de telefonia". | Dra. Elaine | Entram, em seção própria com aviso; retirar de uma entrega específica é decisão dela, registrada no `motivo` da solicitação — o sistema não tem chave para omitir. | Baixo (é texto no PDF/JSON, não estrutura). |

**Nenhum destes bloqueia a implementação.** Todos têm hipótese conservadora aplicada e reversível. O
orquestrador leva a lista ao João; o backend implementa como está descrito.

---

## E. Divisão de tarefas — fronteiras de arquivo **disjuntas**

Nenhum arquivo aparece em duas colunas. Onde back e front precisariam do mesmo arquivo
(`src/lib/api.ts`, `src/types/*`), a regra é: **tipos e cliente HTTP são do backend**; o front consome.
Exceção declarada: `src/lib/formulario/definicao.ts` e `src/lib/roteiro/diff.ts` são **do frontend**
(são render/apresentação e só o front os usa).

> `src/lib/api.ts` está sendo **quebrado em barril** pelo agente PERF nesta mesma rodada. Para evitar
> colisão: o backend adiciona os clientes novos em **`src/lib/api/titulares.ts`** e
> **`src/lib/api/formularios.ts`** (arquivos novos, no diretório novo do PERF) e acrescenta os
> `export *` correspondentes no barril. Se o PERF ainda não tiver criado o diretório quando o backend
> chegar, o backend cria os dois arquivos e o barril mínimo — `export *` a mais não quebra ninguém.

### backend-engineer

**Migrations e verificação**
- [ ] `supabase/migrations/0078_formularios_versionados.sql` — texto do §A3. **Não aplicar.**
- [ ] `scripts/verificacao-0078.sql` — os 7 testes do §A3, idempotente, `raise exception` em falha.
- [ ] `supabase/migrations/0079_desfecho_anonimizada.sql` — só o `alter type`. Arquivo separado (§B2).
- [ ] `supabase/migrations/0080_direitos_do_titular.sql` — texto do §B3. **Não aplicar.**
- [ ] `scripts/verificacao-0080.sql` — os 8 testes do §B3, tudo com rollback proposital.

**Rotas — Feature A**
- [ ] `src/app/api/formularios/route.ts` — `GET` passa a listar sem `definicao` (colunas do §A4);
      `POST` reescrito para `rpc("publicar_formulario_versao")` com o mapa de erro do §A4 + rate limit.
- [ ] `src/app/api/formularios/[id]/route.ts` (novo) — `GET` completo, `exigirInterno`.
- [ ] `src/app/api/formularios/[id]/ativar/route.ts` (novo) — `rpc("ativar_formulario_versao")`,
      espelho de `/api/roteiros/[id]/ativar`.
- [ ] `src/app/api/roteiros/route.ts` — só acrescentar `ativado_por, ativado_em` a `COLUNAS_LISTA`.

**Rotas — Feature B** (todas novas, `exigirPapel("admin")`)
- [ ] `src/app/api/admin/titulares/[pessoaId]/inventario/route.ts`
- [ ] `src/app/api/admin/titulares/[pessoaId]/exportacoes/route.ts` — `registrar_exportacao_titular`
      **antes** de montar o dossiê; devolve JSON ou PDF; `X-Solicitacao-Id`.
- [ ] `src/app/api/admin/titulares/[pessoaId]/anonimizacao/route.ts` — valida `confirmacao_nome` contra
      `pessoas.nome` no servidor; os três tempos do §B4.1.
- [ ] `src/app/api/admin/titulares/[pessoaId]/anonimizacao/expurgo/route.ts` — retomada idempotente.

**Servidor**
- [ ] `src/server/lgpd/dossie.ts` (novo) — montagem do `DossieTitular` por `service_role`; seção vazia é
      `[]`, nunca zero inventado; `observacoes` sempre preenchidas quando aplicável.
- [ ] `src/server/lgpd/pdf-dossie.ts` (novo) — pdfkit.
- [ ] `src/server/pdf/base.ts` (novo) — `COR` + carregamento de fonte extraídos de
      `src/server/material/pdf.ts`; **`material/pdf.ts` passa a importar de lá** (é do backend, sem
      conflito com o front).
- [ ] `src/types/lgpd.ts` (novo) e `src/types/admin.ts` — `FormularioResumo`, `SolicitacaoTitular`,
      `InventarioTitular`, `DossieTitular`.
- [ ] `src/types/banco.ts` — `DesfechoJornada` ganha `"anonimizada"`; `PerguntaFormulario` ganha
      `obrigatoria?`, `condicional.igual?` e `opcoes?: string[] | {valor,rotulo}[]`;
      `Formulario` ganha `titulo/notas/criado_por/ativado_por/ativado_em`.
- [ ] `src/lib/api/formularios.ts` e `src/lib/api/titulares.ts` (novos) — clientes HTTP + `export *` no barril.
- [ ] `src/app/api/jornadas/route.ts` e `src/app/api/jornadas/[id]/etapa/route.ts` — `z.enum` de
      **leitura** ganha `anonimizada`; o de **escrita** da etapa **não**.
- [ ] Teste vitest: `src/server/lgpd/dossie.test.ts` (seções vazias não viram zero; `observacoes`
      presentes quando há ligação por IA).

**Não toca:** `src/components/**`, `src/app/(app)/**`, `src/lib/formulario/**`, `src/lib/roteiro/**`,
`next.config.ts`, `src/app/globals.css`.

### frontend-engineer

- [ ] `src/lib/formulario/definicao.ts` (novo) + `.test.ts` — `normalizarOpcoes`, `perguntasDeSistema`,
      `validarDefinicaoNoCliente` (espelho leve das regras da RPC, para o erro aparecer antes do POST).
- [ ] `src/lib/roteiro/diff.ts` (novo) + `.test.ts` — `diffRoteiro`, casando por id (§A5.3).
- [ ] `src/components/publico/AssistenteFormulario.tsx` (novo) — **extração** do miolo de
      `FormularioPublico.tsx`, props puras, zero fetch. Comportamento idêntico (foco, `aria-live`,
      `faltando`, rascunho local).
- [ ] `src/components/publico/FormularioPublico.tsx` — vira o wrapper de rede em volta do assistente.
      Diff esperado: **redução** de linhas.
- [ ] `src/components/publico/CampoPerguntaPublico.tsx` — usa `normalizarOpcoes`; `value` = `valor`,
      texto = `rotulo`.
- [ ] `src/components/ficha360/FormularioAba.tsx` — idem (mostra rótulo, não valor).
- [ ] `src/components/admin/abas/FormulariosRoteirosAba.tsx` (novo) — §A5.1 e §A5.3.
- [ ] `src/components/admin/FormularioPrevia.tsx` (novo) — §A5.2, `Dialogo` de 390 px, `.area-publica`,
      `SeloStub` de pré-visualização.
- [ ] `src/components/admin/abas/DireitosDoTitularAba.tsx` (novo) — §B5, quatro passos, textos como
      escritos aqui.
- [ ] `src/components/admin/AdminApp.tsx` — duas entradas novas (`formularios` em Método, `titulares`
      em Cadastro), **fora** do ramo `somente_custo_ia`.
- [ ] `src/components/admin/abas/PendenciasAba.tsx` — linha "Expurgo de arquivos pendente" quando
      houver solicitação com `storage_removido_em: null`.
- [ ] `src/components/ficha360/{CabecalhoFicha,TrilhoDaFicha}.tsx` — rótulo "Anonimizada" (tom neutro)
      para o desfecho novo.

**Não toca:** `src/app/api/**`, `src/server/**`, `supabase/migrations/**`, `scripts/**`,
`src/types/**`, `src/lib/api*`.

### security-pentester (obrigatório — a feature toca PII, RLS, admin e Storage)

- [ ] **Escalada por rota nova.** Provar, com sessão de `advogada`, `relacionamento` e `assistente`,
      que as 4 rotas de `/api/admin/titulares/**` devolvem 403 — e que a RPC também recusa quando
      chamada direto por PostgREST com aquele JWT.
- [ ] **Escrita direta em `formularios` depois da 0078.** Tentar `INSERT`/`UPDATE` por PostgREST com
      sessão de admin: tem de falhar (`42501`). Se passar, a 0072 não foi replicada direito.
- [ ] **Burlar a validação.** Publicar definição com `__proto__`/`constructor` como id de pergunta ou
      como valor de opção (`rotuloOpcao` já foi endurecido no pentest r2 — confirmar que a RPC e o
      editor também recusam); id com 200 caracteres; 5.000 perguntas; condicional circular.
- [ ] **`confirmacao_nome`.** Provar que a anonimização não roda com o nome errado, e que a checagem
      é do **servidor** (chamar a rota direto com `curl`, sem passar pela tela).
- [ ] **Idempotência e corrida.** Duas chamadas simultâneas de `anonimizar_titular` na mesma pessoa;
      duas de `publicar_formulario_versao` na mesma chave. Não pode sair versão duplicada nem dois
      registros de anonimização (`uniq_anonimizacao_por_pessoa`).
- [ ] **Completude do apagamento.** Depois de anonimizar uma pessoa de teste, varrer **todas** as
      tabelas do inventário §B1 procurando o nome, o e-mail e o telefone originais em qualquer coluna
      `text`/`jsonb` (inclusive `eventos_timeline.titulo` e `tarefas.titulas`, que o desenho **mantém**
      de propósito — se houver nome de cliente ali, é achado e o desenho muda).
- [ ] **Storage.** Confirmar que o objeto sumiu do bucket `documentos-sensiveis` e que a URL assinada
      emitida **antes** da anonimização deixa de funcionar (ou, se ainda funcionar até expirar, medir a
      janela e reportar — é o risco residual real).
- [ ] **Exportação.** Rate limit efetivo (4ª chamada em 60 s → 429 com `Retry-After`); registro em
      `titulares_solicitacoes` gravado **antes** do arquivo sair; nenhuma exportação sem registro.
- [ ] **Prévia do formulário.** Provar que a pré-visualização **não** emite `links_publicos`, não grava
      em `eventos_timeline` e não revoga link existente (`select count(*) from links_publicos` antes e
      depois).
- [ ] **Vazamento pela lista.** `GET /api/formularios` (interno, não admin) não pode devolver nada além
      de metadados de versão — nenhuma resposta de cliente.

---

## F. Riscos que já enxergo (para o Fable e o pentester)

1. **A varredura `bruto::text like '%transacao%'` em `webhooks_eventos`** é sequencial. Roda uma vez
   por anonimização, dentro de uma transação que já está segurando `pessoas` com `for update`. Se a
   tabela crescer para centenas de milhares de linhas, isso vira lock longo. Mitigação medível: o
   backend mede `select count(*) from webhooks_eventos` antes de aplicar; acima de 100 mil, esse
   `update` sai da RPC e vira passo próprio da rota (fora da transação principal). `A MEDIR`.
2. **`eventos_timeline.titulo` e `tarefas.titulo` são mantidos.** É a aposta de que são rótulos de
   sistema. Se o pentester achar nome de cliente ali, a correção é trivial (substituir por marcador),
   mas o desenho tem de mudar antes de ir para produção.
3. **A URL assinada emitida antes da anonimização** continua válida até expirar. É risco residual
   inerente ao Storage do Supabase; medir a janela e documentar.
4. **A `not valid` da `ck_formularios_definicao`** significa que uma versão antiga inválida continua no
   banco. É deliberado (é histórico), mas o roteiro de verificação **avisa** quais reprovam.

---

## G. Os 5 critérios do Fable

| Critério | O que este plano garante |
|---|---|
| **Segurança** | Escrita em `formularios` deixa de existir para `authenticated` (revoke + drop da `form_wr`) e passa só por RPC `security definer` com gate de papel dentro do banco — mesma jogada da 0072 para `links_publicos`. A anonimização e a exportação são `admin` na rota **e** na RPC, com autor declarado validado (padrão 0071), confirmação por nome conferida no **servidor**, rate limit por perfil (exportação 3/min) e trilha imutável (`titulares_solicitacoes` sem `insert/update/delete` para `authenticated`). Nenhuma rota pública nova; a prévia do formulário não emite link. Pentester obrigatório, com 10 itens nomeados. |
| **Escalabilidade** | 10× as linhas atuais: as consultas do inventário e do dossiê são todas por `pessoa_id`/`jornada_id`, que já têm índice (`idx_documentos_pessoa`, `idx_ligacoes_jornada`, PK/FK). Índices novos: `idx_titulares_solicitacoes_pessoa` e o unique parcial `uniq_anonimizacao_por_pessoa`. O único ponto que **não** escala é a varredura de `webhooks_eventos` — declarada no §F.1 com o gatilho de 100 mil linhas e o plano B. `GET /api/formularios` deixa de trafegar 5 definições inteiras em toda listagem. |
| **Solidificação** | Quatro invariantes que o banco passa a garantir sozinho: (1) `ck_formularios_definicao` — nenhuma definição inválida entra, e `p9`/`p16`/`p1`/`p2` não podem sair; (2) publicação e ativação em **uma** transação, fechando a janela em que a chave fica sem versão ativa (bug real hoje); (3) `uniq_anonimizacao_por_pessoa` — uma anonimização por titular, e a RPC é idempotente por `for update`; (4) `titulares_solicitacoes` sem privilégio de `update`/`delete` — trilha que ninguém reescreve. |
| **UX** | O que o usuário vê mudar: duas capacidades que existiam só como rota passam a ter tela; o cliente que relê o formulário deixa de ver `"casado"` e vê `"Casado(a)"`; o roteiro oficial passa a mostrar **quem** carimbou e **quando** (B15 deixa de ser folclore). A anonimização se explica em prosa antes de pedir confirmação ("o que acontece / o que fica / o que não dá para desfazer / o que continua fora daqui"), exige o nome digitado, e o estado pendente de expurgo aparece como faixa **e** como pendência no Admin — nada falha em silêncio. Reordenar pergunta é por setas, não arrastar: teclado e leitor de tela funcionam. Estado vazio é vazio: seção sem registro diz "nenhum registro", nunca `0`. |
| **Otimização** | A rodada **fecha 6 rotas mortas** (`GET/POST /api/formularios`, `GET /api/roteiros`, `GET /api/roteiros/[id]`, `GET /api/roteiros/ativa` já usada, `POST /api/roteiros/[id]/ativar`) em vez de criar rota sem botão. A prévia do cliente **extrai** o assistente de `FormularioPublico.tsx` em vez de duplicá-lo — o front público sai com menos linhas do que entrou. `src/server/pdf/base.ts` unifica paleta e fonte entre o PDF do material e o do dossiê. Zero dependência nova (sem lib de diff, sem lib de zip — as duas justificadas). Zero backfill, zero linha de cliente alterada de valor pela Feature A. `rotuloOpcao()` deixa de ser regra e vira fallback, sem virar código morto. |

---

## H. Ordem de execução sugerida ao orquestrador

1. **Medir antes** (o único passo que exige banco): `count(*)` de `formularios`, `formularios_respostas`,
   `webhooks_eventos`, `pessoas where origem_dado='real'`, e o `md5` do `string_agg(definicao)`.
   Esses números entram nos roteiros de verificação.
2. `backend-engineer` e `frontend-engineer` em **paralelo** (fronteiras disjuntas, §E).
3. Orquestrador aplica `0078` → roda `verificacao-0078.sql` → aplica `0079` → aplica `0080` → roda
   `verificacao-0080.sql`. **Nesta ordem** — `0080` usa o valor de enum da `0079`.
4. `security-pentester` com a lista do §E.
5. `fable-orchestrator`.
6. Ao João: B40–B46 e, na lista do "só você faz", **apagar a gravação da ligação na Vapi** quando
   houver a primeira anonimização real.
