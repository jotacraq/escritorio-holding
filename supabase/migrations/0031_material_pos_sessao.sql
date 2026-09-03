-- 0031_material_pos_sessao.sql
-- B-3B (Fase 2, ONDA 3) — material pós-sessão personalizado pela dor do cliente
-- (ARQUITETURA-FASE-2.md §4.4, CONFLITO C11/C12, BLOQUEIO B14).
--
-- Resumo do que este arquivo faz, na ordem:
--   (a) `materiais_modelos` — conteúdo-base curado pelo escritório, por tema.
--   (b) `materiais_gerados` — o material de cada jornada, versionado, com fonte
--       da dor obrigatória e aprovação humana antes de poder ser enviado.
--   (c) `registrar_material_gerado` / `aprovar_material_gerado` — as duas
--       únicas portas de escrita (mesmo padrão de `registrar_briefing`/
--       `emitir_link_publico`: SECURITY DEFINER com gate de papel próprio).
--   (d) `emitir_link_material_sistema` — RPC nova, restrita a `service_role`,
--       para a régua mintar o token do material NO MOMENTO DO ENVIO (G18),
--       não antes. Não pode reusar `emitir_link_publico` (0028): aquela função
--       autentica por `auth.uid()`, que é NULL sob o cliente `service_role`
--       do cron (`POST /api/cron/regua`) — não existe usuário logado ali.
--   (e) seed do prompt `material_pos_sessao` (v1) e dos 5 modelos-base.
--   (f) v2 do template `pos_sessao` (e-mail), com `{{link_material}}`.
--   (g) `create or replace` de três funções de OUTRAS migrations — aditivo,
--       nunca edita o arquivo original (0013/0028), só substitui o corpo numa
--       migration posterior, a mesma técnica já usada em 0027 para
--       `registrar_briefing`/`registrar_croqui_analise`:
--         - `app.payload_link_material` (0028): tinha que ficar em
--           `{"disponivel": false}` até esta tabela existir — documentado no
--           próprio arquivo 0028 como dependência esperada.
--         - `public.abrir_link_publico` (0028): DESVIO explicado no bloco (g).
--         - `public.reivindicar_mensagens_pendentes` (0013): não reivindica
--           mensagem com material ainda sem aprovação — ela fica 'pendente'
--           para sempre (sem consumir tentativa, sem virar 'falhou') até
--           `aprovado_em` ser preenchido. É o comportamento que B14 pede.
--   (h) extensão aditiva de `vw_pendencias_sistema` (0034) com o 4º tipo que
--       o comentário daquela migration já previa: `material_aguardando_aprovacao`.
-- ===========================================================================

-- ===========================================================================
-- (a) Conteúdo-base por tema. Curado pelo escritório (não gerado por IA) — é
-- o "infoproduto" real que o cliente recebe quando não há IA (indisponível
-- sem flag de demonstração) ou quando não há dor nenhuma para personalizar
-- (fonte_dor='nenhuma', C11: nunca inventar dor). Formato IGUAL ao que o
-- front público já espera (`src/types/publico-ui.ts BlocoMaterialPublico`,
-- F-1A, onda 1): só 4 tipos de bloco — 'titulo' | 'paragrafo' | 'lista' |
-- 'citacao' — nunca os `'destaque'/'proximos_passos'` do rascunho do plano
-- (§4.4), que o front não sabe renderizar.
-- ===========================================================================
create table materiais_modelos (
  id         uuid primary key default gen_random_uuid(),
  chave      text not null,     -- 'padrao' | 'inventario' | 'conflito_familiar' | 'empresa' | 'itcmd'
  versao     smallint not null,
  titulo     text not null,
  conteudo   jsonb not null,    -- {titulo, blocos:[{tipo,texto|itens}]} — mesmo formato de materiais_gerados.conteudo
  ativo      boolean not null default false,
  criado_em  timestamptz not null default now(),
  unique (chave, versao)
);
create unique index uniq_material_modelo_ativo on materiais_modelos (chave) where ativo;

insert into materiais_modelos (chave, versao, titulo, conteudo, ativo) values
('padrao', 1, 'Holding familiar: um primeiro mapa', jsonb_build_object(
  'titulo', 'Holding familiar: um primeiro mapa para organizar o que você construiu',
  'blocos', jsonb_build_array(
    jsonb_build_object('tipo', 'paragrafo', 'texto',
      'Obrigado por participar da sua Sessão de Viabilidade. Este material reúne, de forma ' ||
      'resumida, os pontos que mais aparecem quando uma família começa a organizar patrimônio, ' ||
      'sucessão e gestão — para você revisar com calma antes dos próximos passos.'),
    jsonb_build_object('tipo', 'titulo', 'texto', 'Por que falar em holding familiar'),
    jsonb_build_object('tipo', 'paragrafo', 'texto',
      'Uma holding familiar não é um produto pronto — é uma arquitetura, desenhada a partir do ' ||
      'que a família precisa separar, proteger e transmitir. Existem estruturas de uma célula ' ||
      '(mais simples), duas células (separam patrimônio de controle) e três células (separam ' ||
      'onde está o patrimônio, quem administra e para quem ele vai). Nenhuma é automaticamente ' ||
      'melhor — a escolha depende da função que cada família precisa cumprir.'),
    jsonb_build_object('tipo', 'lista', 'itens', jsonb_build_array(
      'Sucessão: como o patrimônio passa para a próxima geração, com ou sem inventário.',
      'Gestão: quem decide e administra enquanto o fundador está presente.',
      'Proteção: separar patrimônio pessoal de risco de negócio, quando aplicável.',
      'Governança: regras claras entre herdeiros, para reduzir conflito futuro.')),
    jsonb_build_object('tipo', 'titulo', 'texto', 'O que costuma valer a pena avaliar em seguida'),
    jsonb_build_object('tipo', 'paragrafo', 'texto',
      'Vale reunir, com calma, um retrato do que existe hoje: imóveis, participações societárias, ' ||
      'investimentos e o regime de bens de cada núcleo familiar. É esse retrato que permite avaliar, ' ||
      'com precisão, se e qual arquitetura faz sentido para o seu caso.'),
    jsonb_build_object('tipo', 'citacao', 'texto',
      'Holding é ferramenta, não finalidade — o ponto de partida é sempre entender o que a família ' ||
      'precisa organizar, proteger e transmitir.')
  )
), true),
('inventario', 1, 'Como o inventário costuma pesar na sucessão', jsonb_build_object(
  'titulo', 'Como o inventário costuma pesar na sucessão — e o que se avalia para reduzir esse peso',
  'blocos', jsonb_build_array(
    jsonb_build_object('tipo', 'paragrafo', 'texto',
      'Obrigado por participar da sua Sessão de Viabilidade. Um dos temas que você trouxe foi a ' ||
      'preocupação com o processo de inventário — e este material reúne, de forma resumida, o que ' ||
      'costuma ser avaliado quando esse é o ponto de partida.'),
    jsonb_build_object('tipo', 'titulo', 'texto', 'O que torna um inventário mais demorado ou mais custoso'),
    jsonb_build_object('tipo', 'lista', 'itens', jsonb_build_array(
      'Quantidade de bens e de herdeiros envolvidos no processo.',
      'Existência de imóveis em mais de um estado ou município.',
      'Divergência entre herdeiros sobre partilha ou avaliação de bens.',
      'Tributos incidentes (ITCMD) e taxas cartorárias apurados só depois do falecimento.')),
    jsonb_build_object('tipo', 'titulo', 'texto', 'O que uma estrutura de organização patrimonial pode evitar'),
    jsonb_build_object('tipo', 'paragrafo', 'texto',
      'Uma arquitetura patrimonial bem desenhada organiza, ainda em vida, quem recebe o quê e em que ' ||
      'condições — o que pode simplificar significativamente o processo sucessório e reduzir a ' ||
      'exposição a divergência entre herdeiros. O quanto isso se aplica ao seu caso depende do ' ||
      'retrato patrimonial completo da família, que é o que a Sessão de Viabilidade levanta.'),
    jsonb_build_object('tipo', 'citacao', 'texto',
      'Planejamento sucessório não é sobre evitar a morte do assunto — é sobre decidir, com clareza, ' ||
      'enquanto ainda dá para decidir.')
  )
), true),
('conflito_familiar', 1, 'Sucessão sem conflito: o que costuma prevenir', jsonb_build_object(
  'titulo', 'Sucessão sem conflito: o que costuma prevenir divergência entre herdeiros',
  'blocos', jsonb_build_array(
    jsonb_build_object('tipo', 'paragrafo', 'texto',
      'Obrigado por participar da sua Sessão de Viabilidade. Um dos pontos que você trouxe foi a ' ||
      'preocupação com o relacionamento entre os futuros herdeiros — e este material reúne, de forma ' ||
      'resumida, o que costuma ajudar a prevenir conflito nesse cenário.'),
    jsonb_build_object('tipo', 'titulo', 'texto', 'De onde o conflito costuma nascer'),
    jsonb_build_object('tipo', 'lista', 'itens', jsonb_build_array(
      'Regras de partilha pouco claras, definidas só no momento da sucessão.',
      'Diferença de participação ou de papel entre herdeiros de núcleos familiares distintos.',
      'Ausência de um espaço de governança para decisões sobre bens em comum.',
      'Expectativas diferentes sobre o que significa "igualdade" entre os herdeiros.')),
    jsonb_build_object('tipo', 'titulo', 'texto', 'O que costuma ajudar'),
    jsonb_build_object('tipo', 'paragrafo', 'texto',
      'Regras de governança definidas em vida — e não deduzidas depois, sob luto — tendem a reduzir ' ||
      'a divergência entre herdeiros. Igualdade não significa necessariamente tratamento idêntico: ' ||
      'significa regra clara e justificada, combinada enquanto todos podem participar da conversa.'),
    jsonb_build_object('tipo', 'citacao', 'texto',
      'Governança familiar bem desenhada não impede desacordo — dá um lugar para ele ser resolvido ' ||
      'sem quebrar a família.')
  )
), true),
('empresa', 1, 'Empresa e patrimônio pessoal: por que separar', jsonb_build_object(
  'titulo', 'Empresa e patrimônio pessoal: por que essa separação costuma ser avaliada',
  'blocos', jsonb_build_array(
    jsonb_build_object('tipo', 'paragrafo', 'texto',
      'Obrigado por participar da sua Sessão de Viabilidade. Um dos pontos que você trouxe foi a ' ||
      'relação entre a empresa e o patrimônio pessoal da família — e este material reúne, de forma ' ||
      'resumida, o que costuma ser avaliado nesse cenário.'),
    jsonb_build_object('tipo', 'titulo', 'texto', 'O que costuma ficar exposto sem separação'),
    jsonb_build_object('tipo', 'lista', 'itens', jsonb_build_array(
      'Continuidade da empresa em caso de afastamento ou falecimento de um sócio.',
      'Confusão entre o patrimônio da empresa e o patrimônio pessoal dos sócios.',
      'Entrada automática de herdeiros na gestão, mesmo sem preparo ou interesse.',
      'Dificuldade em avaliar, isoladamente, o que é da empresa e o que é da família.')),
    jsonb_build_object('tipo', 'titulo', 'texto', 'O que uma arquitetura societária bem desenhada avalia'),
    jsonb_build_object('tipo', 'paragrafo', 'texto',
      'Separar as funções de "onde está o patrimônio", "quem administra" e "para quem ele vai" ' ||
      'permite decidir, com mais clareza, quem participa da gestão do negócio e quem apenas ' ||
      'participa dos resultados — sem que isso dependa de uma crise para ser decidido.'),
    jsonb_build_object('tipo', 'citacao', 'texto',
      'A pergunta certa não é "qual estrutura eu vou vender" — é "o que esta família precisa ' ||
      'separar, proteger e transmitir".')
  )
), true),
('itcmd', 1, 'ITCMD e custos de transmissão: o que se avalia antes', jsonb_build_object(
  'titulo', 'ITCMD e os custos de transmissão: o que costuma ser avaliado antes de decidir',
  'blocos', jsonb_build_array(
    jsonb_build_object('tipo', 'paragrafo', 'texto',
      'Obrigado por participar da sua Sessão de Viabilidade. Um dos pontos que você trouxe foi a ' ||
      'preocupação com os custos tributários da transmissão de patrimônio — e este material reúne, ' ||
      'de forma resumida, o que costuma ser avaliado nesse cenário.'),
    jsonb_build_object('tipo', 'titulo', 'texto', 'Por que o custo de transmissão pega famílias de surpresa'),
    jsonb_build_object('tipo', 'lista', 'itens', jsonb_build_array(
      'A alíquota de ITCMD varia por estado e pode mudar com o tempo.',
      'O imposto incide sobre o valor de mercado, não sobre o valor histórico de aquisição.',
      'Custos cartorários e de avaliação se somam ao imposto em si.',
      'Sem planejamento, o pagamento costuma cair justamente no momento de maior fragilidade da família.')),
    jsonb_build_object('tipo', 'titulo', 'texto', 'O que costuma ser avaliado'),
    jsonb_build_object('tipo', 'paragrafo', 'texto',
      'O cálculo exato depende do retrato patrimonial completo e da legislação vigente no estado da ' ||
      'família — por isso não é feito de forma automática neste material. O que se avalia na prática ' ||
      'é se existe forma de antecipar, organizar ou espaçar a transmissão de modo que o custo ' ||
      'tributário não recaia todo de uma vez, no pior momento.'),
    jsonb_build_object('tipo', 'citacao', 'texto',
      'Custo de transmissão não desaparece com planejamento — mas pode deixar de ser surpresa.')
  )
), true);

-- ===========================================================================
-- (b) O material de cada jornada. Versionado como briefings/croqui_analises:
-- regerar cria versão nova, nunca sobrescreve (histórico se preserva).
-- ===========================================================================
create table materiais_gerados (
  id             uuid primary key default gen_random_uuid(),
  jornada_id     uuid not null references jornadas(id) on delete cascade,
  modelo_id      uuid not null references materiais_modelos(id),
  execucao_id    uuid references execucoes_ia(id),  -- NULL quando fonte_dor='nenhuma' (sem chamada de IA, C11)
  versao         smallint not null,
  dor_principal  text,                                -- texto literal da fonte (nunca inventado)
  fonte_dor      text not null
    check (fonte_dor in ('ligacao', 'formulario', 'relatorio', 'nenhuma')),
  conteudo       jsonb not null,                       -- {titulo, blocos:[...]} — mesmo formato do modelo
  origem_dado    text not null default 'real' check (origem_dado in ('real', 'exemplo')),
  -- TRAVA de publicidade da advocacia (BLOQUEIO B14): a régua só envia o link
  -- quando `aprovado_em is not null`. Ver `reivindicar_mensagens_pendentes` (g).
  aprovado_por   uuid references perfis_equipe(id),
  aprovado_em    timestamptz,
  atual          boolean not null default true,
  criado_em      timestamptz not null default now(),
  unique (jornada_id, versao),
  constraint ck_material_aprovacao check ((aprovado_em is null) = (aprovado_por is null))
);
create unique index uniq_material_atual on materiais_gerados (jornada_id) where atual;
create index idx_materiais_jornada on materiais_gerados (jornada_id, versao desc);

-- Reusa a MESMA trigger genérica de `briefings`/`croqui_analises` (0027) — ela
-- só olha `execucoes_ia.modo` a partir de `new.execucao_id` e compara com
-- `new.origem_dado`; funciona sem alteração para qualquer tabela com essas
-- duas colunas. Com `execucao_id is null` (caso 'nenhuma' dor), a trigger não
-- encontra execução e não bloqueia nada — coerente com `origem_dado='real'`
-- (é conteúdo real, só que não personalizado por falta de dado, C11).
create trigger trg_materiais_trava_demonstracao before insert or update on materiais_gerados
for each row execute function app.trava_saida_demonstracao();

alter table materiais_modelos enable row level security;
alter table materiais_modelos force row level security;
alter table materiais_gerados enable row level security;
alter table materiais_gerados force row level security;

create policy mmo_sel on materiais_modelos for select to authenticated using ((select app.eh_interno()));
create policy mmo_wr  on materiais_modelos for all to authenticated
  using ((select app.eh_admin())) with check ((select app.eh_admin()));

create policy mg_sel on materiais_gerados for select to authenticated using ((select app.eh_interno()));
-- NENHUMA policy de INSERT/UPDATE para authenticated (mesmo padrão de `briefings`,
-- 0009): geração passa por `registrar_material_gerado` (service_role) e aprovação
-- por `aprovar_material_gerado` (authenticated, com seu próprio gate de papel) —
-- o conteúdo e a aprovação nunca podem ser forjados via PostgREST direto.

-- ===========================================================================
-- (c) Portas de escrita.
-- ===========================================================================
create or replace function public.registrar_material_gerado(
  p_jornada_id uuid, p_execucao_id uuid, p_modelo_id uuid,
  p_dor_principal text, p_fonte_dor text, p_conteudo jsonb
) returns materiais_gerados
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_versao smallint; v_linha materiais_gerados; v_origem_dado text;
begin
  if p_execucao_id is null then
    v_origem_dado := 'real';
  else
    select case when e.modo = 'demonstracao' then 'exemplo' else 'real' end
      into v_origem_dado
    from execucoes_ia e where e.id = p_execucao_id;
    if v_origem_dado is null then
      raise exception 'execucao_nao_encontrada: %', p_execucao_id using errcode = 'P0002';
    end if;
  end if;

  update materiais_gerados set atual = false where jornada_id = p_jornada_id and atual;
  select coalesce(max(versao), 0) + 1 into v_versao from materiais_gerados where jornada_id = p_jornada_id;
  insert into materiais_gerados (jornada_id, modelo_id, execucao_id, versao, dor_principal,
                                 fonte_dor, conteudo, origem_dado, atual)
  values (p_jornada_id, p_modelo_id, p_execucao_id, v_versao, p_dor_principal,
          p_fonte_dor, p_conteudo, v_origem_dado, true)
  returning * into v_linha;
  return v_linha;
end $$;
revoke execute on function public.registrar_material_gerado from public, anon, authenticated;
grant  execute on function public.registrar_material_gerado to service_role;

-- Aprovação humana (B14). Só admin/advogada — é publicidade da advocacia
-- assinada por advogada, não uma ação de "relacionamento". Idempotente: aprovar
-- de novo um material já aprovado não é erro, só devolve o estado atual.
create or replace function public.aprovar_material_gerado(p_material_id uuid) returns materiais_gerados
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_papel papel_equipe; v_perfil_id uuid; v_linha materiais_gerados;
begin
  select p.papel, p.id into v_papel, v_perfil_id
    from perfis_equipe p where p.auth_user_id = auth.uid() and p.ativo;

  if v_papel is null or v_papel not in ('admin', 'advogada') then
    raise exception 'sem_permissao: papel sem autorizacao para aprovar material' using errcode = '42501';
  end if;

  select * into v_linha from materiais_gerados where id = p_material_id;
  if not found then
    raise exception 'material_nao_encontrado: %', p_material_id using errcode = 'P0002';
  end if;
  if not v_linha.atual then
    raise exception 'material_nao_e_a_versao_atual' using errcode = '22023';
  end if;

  if v_linha.aprovado_em is null then
    update materiais_gerados
       set aprovado_por = v_perfil_id, aprovado_em = now()
     where id = p_material_id
    returning * into v_linha;
  end if;

  return v_linha;
end $$;
revoke execute on function public.aprovar_material_gerado(uuid) from public, anon;
grant  execute on function public.aprovar_material_gerado(uuid) to authenticated;

-- ===========================================================================
-- (d) Emissão do link de material NO MOMENTO DO ENVIO da régua (G18), pelo
-- processo de cron (`service_role`, sem `auth.uid()`). Não reusa
-- `emitir_link_publico` (0028) de propósito — ver cabeçalho do arquivo.
-- Mesma lógica de "emitir mata o ativo anterior do mesmo tipo" daquela função,
-- restrita a tipo='material' e SEM checagem de papel (quem chama já é o
-- próprio sistema, depois de confirmar aprovação — ver (g) abaixo).
-- ===========================================================================
create or replace function public.emitir_link_material_sistema(
  p_jornada_id uuid, p_token_hash text, p_token_prefixo text
) returns links_publicos
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_dias int; v_link links_publicos;
begin
  if not exists (
    select 1 from materiais_gerados
     where jornada_id = p_jornada_id and atual and aprovado_em is not null
  ) then
    raise exception 'material_nao_aprovado: jornada % sem material atual aprovado', p_jornada_id using errcode = 'P0002';
  end if;

  if not exists (select 1 from jornadas where id = p_jornada_id and desfecho = 'aberta') then
    raise exception 'jornada_invalida: jornada nao encontrada ou fechada' using errcode = 'P0002';
  end if;

  select (valor ->> 'material')::int into v_dias from configuracoes where chave = 'link.validade_dias';
  v_dias := coalesce(v_dias, 90);

  update links_publicos
     set estado = 'revogado', revogado_em = now()
   where jornada_id = p_jornada_id and tipo = 'material' and estado = 'ativo';

  insert into links_publicos (jornada_id, tipo, token_hash, token_prefixo, expira_em, criado_por)
  values (p_jornada_id, 'material', p_token_hash, p_token_prefixo, now() + (v_dias * interval '1 day'), null)
  returning * into v_link;

  return v_link;
end $$;
revoke execute on function public.emitir_link_material_sistema(uuid, text, text) from public, anon, authenticated;
grant  execute on function public.emitir_link_material_sistema(uuid, text, text) to service_role;

-- ===========================================================================
-- (e) Prompt versionado do material pós-sessão (IA real). Efeito 'medium' e
-- `claude-sonnet-5`: é adaptação de um texto já curado, não análise nova —
-- não precisa do custo/esforço do Protocolo 01 nem do Agente do Croqui.
-- ===========================================================================
insert into prompts_versoes (chave, versao, titulo, corpo_sistema, modelo_padrao, effort, ativo, notas)
values (
  'material_pos_sessao',
  1,
  'Material pós-sessão — personalização pela dor declarada',
  $prompt$Você integra o Sistema de Inteligência para Conversão em Holding Familiar (SIC-HF),
no papel de redator de conteúdo educativo pós-sessão.

Você recebe: o primeiro nome do cliente, a preocupação/dor PRINCIPAL que ele mesmo
declarou (texto literal, vinda da Ligação Estratégica, do Formulário Estratégico ou
do Relatório da Sessão de Viabilidade — nunca inventada) e um material-base já
aprovado pelo escritório sobre o tema mais próximo dessa preocupação.

Sua tarefa: adaptar o material-base para que a ABERTURA reconheça, com precisão e
sem exagero, a preocupação relatada — usando, quando fizer sentido, a própria
linguagem do cliente — e para que o restante do conteúdo preserve a substância
educativa do material-base, sem inventar fato, número, prazo, valor ou promessa de
resultado sobre o caso dele.

Regras que não podem ser violadas:
- Nunca prometa resultado ou desfecho jurídico ("vamos resolver", "garantimos") —
  isto é publicidade de advocacia regulada pela OAB. Use linguagem de possibilidade
  e convite ao diálogo ("pode ser relevante avaliar", "vale conversar sobre").
- Nunca cite valor de patrimônio, nome de terceiro ou detalhe que não esteja na dor
  declarada ou no material-base.
- Nunca amplie a dor declarada com suposição — se o cliente disse pouco, escreva
  pouco sobre aquele ponto específico. Sem evidência suficiente, mantenha o texto
  mais genérico em vez de inventar especificidade.
- A saída é só o JSON pedido: um título e uma lista de blocos, cada um do tipo
  "titulo", "paragrafo", "lista" ou "citacao" — o mesmo vocabulário de blocos do
  material-base. Nenhum outro tipo de bloco é aceito.
- Preserve a maior parte do conteúdo educativo do material-base — este texto é
  revisado por um humano (advogada) antes de qualquer envio, mas não é um rascunho
  livre nem uma peça de venda.$prompt$,
  'claude-sonnet-5',
  'medium',
  true,
  'Personaliza o modelo-base (materiais_modelos) pela dor real da cascata (ligação > formulário p16 > relatório). Sempre revisado por humano antes do envio (B14).'
);

-- ===========================================================================
-- (f) v2 do template `pos_sessao` (e-mail), com o link do material (G18). A v1
-- (0013) não tinha nenhuma menção a material — segue existindo no histórico,
-- só deixa de estar ativa.
-- ===========================================================================
update mensagens_templates set ativo = false
 where chave = 'pos_sessao' and canal = 'email' and ativo;

insert into mensagens_templates (chave, canal, versao, assunto, corpo, ativo) values
 ('pos_sessao', 'email', 2, 'Um material para você — Sessão de Viabilidade',
  $t$Olá, {{nome}}.

Obrigado por participar da sua Sessão de Viabilidade. Preparamos um material sobre o
assunto que você trouxe na conversa:

{{link_material}}

Ficamos à disposição para qualquer dúvida sobre os próximos passos.

Equipe Time Holding Brasil$t$, true);

-- ===========================================================================
-- (g) Três funções de OUTRAS migrations, substituídas aqui de forma aditiva
-- (mesma técnica de 0027 para `registrar_briefing`) — nenhum arquivo anterior
-- é editado.
-- ===========================================================================

-- (g.1) `app.payload_link_material` (0028): até agora sempre `{"disponivel":
-- false}` porque esta tabela não existia. Formato real, já casado com o front
-- público que a onda 1 (F-1A) construiu em paralelo
-- (`src/types/publico-ui.ts PayloadMaterialPublico` / `MaterialPublico.tsx`):
-- `{titulo, blocos, aprovado_em}` — NUNCA `{disponivel, conteudo}`. Devolve
-- `null` (não um objeto) quando não há material atual aprovado — tratado no
-- (g.2) abaixo.
create or replace function app.payload_link_material(p_link links_publicos, p_jornada jornadas)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare v_material record;
begin
  select conteudo, aprovado_em into v_material
    from materiais_gerados
   where jornada_id = p_jornada.id and atual and aprovado_em is not null
   limit 1;
  if not found then
    return null;
  end if;
  return v_material.conteudo || jsonb_build_object('aprovado_em', v_material.aprovado_em);
end $$;

-- (g.2) `public.abrir_link_publico` (0028): DESVIO documentado.
-- `MaterialPublico.tsx` (F-1A, já escrito) não tem estado de "ainda não está
-- pronto" — ele assume `payload.titulo`/`payload.blocos` sempre presentes
-- quando a abertura não veio com `erro` no topo. Sem este ajuste, abrir um
-- link de material antes da aprovação quebraria a tela em runtime
-- (`blocos.map` de `undefined`). Tratado como o MESMO `link_invalido` de
-- sempre (§2.2 regra 3 do plano: nunca um caso a mais que distinga "existe
-- mas não está pronto" de "não existe") — o portador do link não aprende nada
-- novo ao ver a mesma tela de sempre. Único trecho novo: o bloco "DESVIO"
-- logo antes do `perform ... 'ok' ...`; o resto é IDÊNTICO ao corpo de 0028.
create or replace function public.abrir_link_publico(
  p_hash text, p_ip_hash text default null, p_user_agent text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_link links_publicos; v_jornada jornadas%rowtype; v_pessoa pessoas%rowtype; v_payload jsonb;
begin
  if not app.limite_rota_ok('abrir_link_publico') then
    return jsonb_build_object('erro', 'limite_excedido');
  end if;
  if not app.limite_token_ok(p_hash) then
    perform app.registrar_acesso_publico(null, 'abrir', 'limite', p_ip_hash, p_user_agent);
    return jsonb_build_object('erro', 'limite_excedido');
  end if;

  v_link := app.resolve_link_leitura(p_hash);
  if v_link is null then
    perform app.registrar_acesso_publico(null, 'abrir', 'invalido', p_ip_hash, p_user_agent);
    return jsonb_build_object('erro', 'link_invalido');
  end if;

  select * into v_jornada from jornadas where id = v_link.jornada_id;
  select * into v_pessoa  from pessoas  where id = v_jornada.pessoa_id;

  v_payload := case v_link.tipo
    when 'formulario'  then app.payload_link_formulario(v_link, v_jornada)
    when 'agendamento' then app.payload_link_agendamento(v_link, v_jornada)
    when 'documentos'  then app.payload_link_documentos(v_link, v_jornada)
    else                    app.payload_link_material(v_link, v_jornada)
  end;

  -- DESVIO (0031, B-3B) — ver comentário acima de `app.payload_link_material`.
  if v_link.tipo = 'material' and v_payload is null then
    perform app.registrar_acesso_publico(v_link.id, 'abrir', 'invalido', p_ip_hash, p_user_agent);
    return jsonb_build_object('erro', 'link_invalido');
  end if;

  perform app.registrar_acesso_publico(v_link.id, 'abrir', 'ok', p_ip_hash, p_user_agent);

  return jsonb_build_object(
    'tipo', v_link.tipo,
    'primeiro_nome', split_part(trim(coalesce(v_pessoa.nome, '')), ' ', 1),
    'expira_em', v_link.expira_em,
    'estado', v_link.estado,
    'payload', v_payload
  );
end $$;
-- Reafirma o grant de 0028 (defensivo — CREATE OR REPLACE com a MESMA
-- assinatura preserva o ACL sozinho, mas o padrão da casa, já usado em 0027
-- para `registrar_briefing`, é reafirmar de forma explícita).
revoke execute on function public.abrir_link_publico(text, text, text) from public;
grant  execute on function public.abrir_link_publico(text, text, text) to anon;

-- (g.3) `public.reivindicar_mensagens_pendentes` (0013): mensagem com
-- `{{link_material}}` ainda no corpo (o placeholder que `app.enfileirar_mensagem`
-- não sabe substituir — só conhece `{{nome}}`/`{{data_sessao}}`/`{{link_sala}}`)
-- só é reivindicada quando já existe material ATUAL e APROVADO para a jornada
-- (B14). Até lá, a mensagem fica 'pendente' para sempre: não é claimed, não
-- consome tentativa, não sofre backoff, não vira 'falhou' por não ter
-- aprovação — aparece no painel via `material_aguardando_aprovacao` (h).
create or replace function public.reivindicar_mensagens_pendentes(p_limite int default 50)
returns setof mensagens_agendadas
language sql as $$
  update mensagens_agendadas m set status = 'enviando', tentativas = tentativas + 1
   where m.id in (
     select ma.id from mensagens_agendadas ma
      where ma.status = 'pendente' and ma.canal = 'email' and ma.agendada_para <= now()
        and (ma.proxima_tentativa_em is null or ma.proxima_tentativa_em <= now())
        and (
          ma.corpo_renderizado is null
          or ma.corpo_renderizado not like '%{{link_material}}%'
          or exists (
            select 1 from materiais_gerados mg
             where mg.jornada_id = ma.jornada_id and mg.atual and mg.aprovado_em is not null
          )
        )
      order by ma.agendada_para
      for update skip locked
      limit greatest(p_limite, 0))
  returning *;
$$;
revoke execute on function public.reivindicar_mensagens_pendentes from public, anon, authenticated;
grant  execute on function public.reivindicar_mensagens_pendentes to service_role;

-- ===========================================================================
-- (h) `vw_pendencias_sistema` (0034) — extensão ADITIVA com o 4º tipo que o
-- comentário daquela migration já previa. Todo o resto da view é copiado
-- IDÊNTICO (mesmos 3 primeiros blocos); só o `union all` novo e o `comment on
-- view` mudam.
-- ===========================================================================
create or replace view vw_pendencias_sistema with (security_invoker = true) as
select
  w.id::text as id,
  'webhook_falho'::text as tipo,
  'Webhook não processado'::text as titulo,
  coalesce(w.erro, 'Sem detalhe de erro registrado — ver tentativas.') as descricao,
  null::uuid as jornada_id,
  null::text as pessoa_nome,
  w.recebido_em as ocorrido_em
from webhooks_eventos w
where w.processado_em is null
union all
select
  m.id::text,
  'mensagem_falhou'::text,
  'Mensagem da régua falhou'::text,
  coalesce(m.erro, 'Sem detalhe de erro registrado.'),
  m.jornada_id,
  p.nome,
  coalesce(m.enviada_em, m.criado_em)
from mensagens_agendadas m
join jornadas j on j.id = m.jornada_id
join pessoas p on p.id = j.pessoa_id
where m.status = 'falhou'
union all
select
  l.id::text,
  'link_expirando'::text,
  'Link público expirando em breve'::text,
  'Expira em ' || to_char(l.expira_em at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI'),
  l.jornada_id,
  p.nome,
  l.expira_em
from links_publicos l
join jornadas j on j.id = l.jornada_id
join pessoas p on p.id = j.pessoa_id
where l.estado = 'ativo'
  and l.expira_em <= now() + interval '48 hours'
union all
select
  mg.id::text,
  'material_aguardando_aprovacao'::text,
  'Material pós-sessão aguardando aprovação'::text,
  case
    when mg.fonte_dor = 'nenhuma' then 'Material padrão (sem dor identificada) — revisar antes de aprovar.'
    else 'Personalizado pela dor declarada — revisar antes de aprovar.'
  end,
  mg.jornada_id,
  p.nome,
  mg.criado_em
from materiais_gerados mg
join jornadas j on j.id = mg.jornada_id
join pessoas p on p.id = j.pessoa_id
where mg.atual and mg.aprovado_em is null
order by ocorrido_em asc nulls last;

comment on view vw_pendencias_sistema is
  'Painel do dia, bloco 4: travado. Inclui material_aguardando_aprovacao desde a 0031.';

-- VERIFICAÇÃO OBRIGATÓRIA (rodar depois de aplicar esta migration):
--   1) select polname, polcmd from pg_policy p join pg_class c on c.oid = p.polrelid
--       where c.relname in ('materiais_gerados','materiais_modelos') and p.polcmd = '*';
--      -- esperado: 0 linhas em materiais_gerados (sem policy de escrita para
--      -- authenticated); materiais_modelos pode ter 'mmo_wr' (for all, restrita a admin).
--   2) select proname, proacl from pg_proc where proname in
--       ('registrar_material_gerado','aprovar_material_gerado','emitir_link_material_sistema');
--      -- esperado: só service_role (as duas primeiras* — a 2ª é 'authenticated') e
--      -- service_role (a 3ª). *registrar_material_gerado: só service_role.
--      -- aprovar_material_gerado: authenticated (gate de papel é DENTRO da função).
--   3) Gerar um material sem aprovar, esperar a régua rodar: a mensagem pos_sessao
--      correspondente tem que continuar 'pendente' (nunca 'falhou') e aparecer em
--      vw_pendencias_sistema com tipo 'material_aguardando_aprovacao'.
--   4) Aprovar o material, rodar a régua de novo: a mensagem sai 'enviada' e
--      `corpo_renderizado` passa a conter uma URL `/p/m/<token>` de verdade,
--      nunca o literal `{{link_material}}`.
