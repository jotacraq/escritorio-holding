-- 0055_material_pdf_e_catalogo.sql
-- Fase 4, F3 (ARQUITETURA-FASE-4.md §3) — material pós-sessão em PDF e catálogo
-- de modelos por dor/arquétipo. Dono: agente C (backend-material-pdf).
--
-- O que este arquivo faz, na ordem:
--   (a) `materiais_gerados` ganha as colunas do PDF (caminho no Storage privado,
--       bytes, sha256, quando gerou, último erro) + `motivo_modelo` (por que o
--       modelo X foi escolhido — pontuação, nunca "análise").
--       INVARIANTE DE BANCO: PDF só existe em material aprovado
--       (`ck_pdf_exige_aprovacao`). Rascunho nunca vira arquivo — B14 em forma
--       de constraint, não de rota.
--   (b) `materiais_modelos` vira catálogo: `descricao`, `dores` (o regex de
--       `ia/material.ts` vira dado), `arquetipos` (nasce vazio — B36),
--       `prioridade` (desempate) e `origem_dado` ('real' = texto revisado pelo
--       escritório; 'exemplo' = rascunho semeado por engenharia, sem parecer).
--   (c) Backfill de `dores` nos 4 modelos temáticos da 0031 — copia SÓ o que o
--       regex já fazia. Não reclassifica material gerado.
--   (d) Seed de 3 modelos NOVOS como RASCUNHO (`origem_dado='exemplo'`,
--       `ativo=false`). Inativos não entram na escolha automática: só passam a
--       valer quando a Dra. Elaine revisar e ativar em Admin → Modelos de
--       material. Nenhum texto daqui passou por parecer jurídico.
--   (e) `registrar_material_gerado` — DROP da assinatura da 0031 e recriação
--       com `p_motivo_modelo` (armadilha 6: `create or replace` com parâmetro
--       novo cria SOBRECARGA, não substitui).
--   (f) `registrar_pdf_material` / `registrar_pdf_material_erro` — únicas
--       portas de escrita das colunas do PDF (service_role).
--   (g) `resolver_pdf_material_publico` — resolução do link `/p/m` para o
--       download do PDF (service_role; mesma cadeia de rate limit/auditoria de
--       `abrir_link_publico`, 0028).
--   (h) `ativar_material_modelo` — promove versão do catálogo (admin), mesma
--       técnica de `ativar_template_mensagem` (0033).
--   (i) Chaves novas em `configuracoes`: `material.anexar_pdf` (B35),
--       `material.rodape_juridico` (B14).
--
-- Reversão (ARQUITETURA-FASE-4.md §12): `drop column`s de materiais_gerados/
-- materiais_modelos; `drop function`s novas; recriar
-- `registrar_material_gerado(uuid,uuid,uuid,text,text,jsonb)` pelo texto da
-- 0031; `delete from configuracoes where chave like 'material.%'`; objetos no
-- Storage ficam (apagar à mão). Nenhum DELETE, nenhum UPDATE em valor de cliente.

-- ===========================================================================
-- (a) materiais_gerados — colunas do PDF + motivo do modelo
-- ===========================================================================
alter table materiais_gerados
  add column if not exists pdf_caminho   text,
  add column if not exists pdf_bytes     bigint,
  add column if not exists pdf_sha256    text,
  add column if not exists pdf_gerado_em timestamptz,
  add column if not exists pdf_erro      text,
  add column if not exists motivo_modelo jsonb;

alter table materiais_gerados drop constraint if exists ck_pdf_bytes_positivo;
alter table materiais_gerados add constraint ck_pdf_bytes_positivo
  check (pdf_bytes is null or pdf_bytes > 0);

-- Invariante: PDF só existe em material aprovado.
alter table materiais_gerados drop constraint if exists ck_pdf_exige_aprovacao;
alter table materiais_gerados add constraint ck_pdf_exige_aprovacao
  check (pdf_caminho is null or aprovado_em is not null);

-- Os 4 campos do PDF andam juntos: ou todos preenchidos, ou todos nulos.
alter table materiais_gerados drop constraint if exists ck_pdf_campos_coerentes;
alter table materiais_gerados add constraint ck_pdf_campos_coerentes
  check (
    (pdf_caminho is null) = (pdf_bytes is null)
    and (pdf_caminho is null) = (pdf_sha256 is null)
    and (pdf_caminho is null) = (pdf_gerado_em is null)
  );

comment on column materiais_gerados.pdf_caminho is
  'Caminho no bucket privado documentos-sensiveis (materiais/{jornada_id}/{material_id}.pdf). '
  'Nunca URL pública. Só existe com aprovado_em (ck_pdf_exige_aprovacao).';
comment on column materiais_gerados.pdf_erro is
  'Último erro de geração/upload do PDF. Aprovação NÃO é desfeita por falha de PDF (§3.3) — '
  'a tela mostra o motivo e oferece "gerar de novo". Limpo quando o PDF é registrado.';
comment on column materiais_gerados.motivo_modelo is
  'Por que este modelo foi escolhido: {chave, pontos, casou_em:[...], candidatos:[...]}. '
  'É roteamento por palavra-chave (função pura, zero IA), nunca análise.';

-- ===========================================================================
-- (b) materiais_modelos — catálogo por dor/arquétipo
-- ===========================================================================
alter table materiais_modelos
  add column if not exists descricao   text,
  add column if not exists dores       text[]   not null default '{}',
  add column if not exists arquetipos  text[]   not null default '{}',
  add column if not exists prioridade  smallint not null default 100,
  add column if not exists origem_dado text     not null default 'real';

alter table materiais_modelos drop constraint if exists ck_modelo_origem_dado;
alter table materiais_modelos add constraint ck_modelo_origem_dado
  check (origem_dado in ('real', 'exemplo'));

comment on column materiais_modelos.dores is
  'Palavras-chave da dor (minúsculas, com acento). Casa por "contém" na dor principal do cliente. '
  'Era o regex hardcoded de src/server/ia/material.ts — agora é dado editável em Admin.';
comment on column materiais_modelos.arquetipos is
  'Arquétipos patrimoniais (Protocolo 03) que puxam este modelo. Nasce VAZIO (B36): '
  'só entra o que a Dra. Elaine confirmar.';
comment on column materiais_modelos.prioridade is
  'Desempate entre modelos com a mesma pontuação — menor vence.';
comment on column materiais_modelos.origem_dado is
  '''real'' = texto revisado pelo escritório. ''exemplo'' = rascunho semeado por engenharia, '
  'sem parecer jurídico — a tela rotula e o PDF recebe marca d''água de demonstração.';

-- ===========================================================================
-- (c) Backfill de `dores` — cópia literal do regex de material.ts:117-122.
--     Não toca conteúdo, não reclassifica material gerado.
-- ===========================================================================
update materiais_modelos set dores = case chave
  when 'empresa'           then array['empresa', 'empres', 'sócio', 'socio', 'negócio', 'negocio']
  when 'inventario'        then array['inventário', 'inventario', 'herdeiro', 'herança', 'heranca', 'partilha', 'sucessão', 'sucessao']
  when 'conflito_familiar' then array['conflito', 'desentendimento', 'briga', 'divergência', 'divergencia', 'desavença', 'desavenca', 'desunião', 'desuniao']
  when 'itcmd'             then array['itcmd', 'itbi', 'tributo', 'tributário', 'tributario', 'imposto']
  else dores
end
where chave in ('empresa', 'inventario', 'conflito_familiar', 'itcmd') and dores = '{}';

update materiais_modelos set prioridade = case chave
  when 'inventario' then 10 when 'itcmd' then 20 when 'empresa' then 30
  when 'conflito_familiar' then 40 else prioridade end
where chave in ('empresa', 'inventario', 'conflito_familiar', 'itcmd') and prioridade = 100;

update materiais_modelos set descricao = case chave
  when 'padrao'            then 'Usado quando nenhuma dor foi registrada (ligação, formulário p16 ou relatório).'
  when 'inventario'        then 'Cliente preocupado com inventário, herança ou partilha.'
  when 'conflito_familiar' then 'Cliente preocupado com desentendimento entre herdeiros.'
  when 'empresa'           then 'Cliente com empresa operacional e patrimônio pessoal misturados.'
  when 'itcmd'             then 'Cliente preocupado com o custo tributário da transmissão (ITCMD/ITBI).'
  else descricao end
where descricao is null;

-- ===========================================================================
-- (d) Seed de modelos novos — RASCUNHO. `ativo=false` + `origem_dado='exemplo'`.
--     A escolha automática só considera modelos ativos; estes ficam à espera
--     da revisão da advogada. Texto educativo, sem promessa de resultado.
-- ===========================================================================
insert into materiais_modelos (chave, versao, titulo, descricao, dores, prioridade, ativo, origem_dado, conteudo)
select * from (values
 ('imoveis', 1::smallint,
  '[RASCUNHO — revisar antes de ativar] Imóveis: organizar em vida o que hoje está no CPF',
  'Cliente cuja preocupação gira em torno de imóveis (aluguel, locação, vários imóveis no CPF).',
  array['imóvel', 'imovel', 'imóveis', 'imoveis', 'aluguel', 'locação', 'locacao', 'inquilino', 'terreno', 'fazenda', 'apartamento'],
  50::smallint, false, 'exemplo',
  jsonb_build_object(
    'titulo', 'Imóveis no CPF: o que costuma ser avaliado antes de decidir',
    'blocos', jsonb_build_array(
      jsonb_build_object('tipo', 'citacao', 'texto',
        'Este texto é um rascunho preparado pela equipe técnica para revisão da advogada. Não foi revisado juridicamente.'),
      jsonb_build_object('tipo', 'paragrafo', 'texto',
        'Obrigado por participar da sua Sessão de Viabilidade. Um dos pontos que você trouxe foi a ' ||
        'situação dos imóveis da família — e este material reúne, de forma resumida, o que costuma ser ' ||
        'avaliado quando esse é o ponto de partida.'),
      jsonb_build_object('tipo', 'titulo', 'texto', 'Por que imóveis no CPF costumam pesar na sucessão'),
      jsonb_build_object('tipo', 'lista', 'itens', jsonb_build_array(
        'Cada imóvel entra individualmente no inventário, com avaliação e custas próprias.',
        'Imóveis em cidades ou estados diferentes podem exigir procedimentos separados.',
        'A renda de aluguel fica travada enquanto o inventário não termina.',
        'Vender ou dividir um imóvel entre herdeiros exige acordo de todos.')),
      jsonb_build_object('tipo', 'titulo', 'texto', 'O que costuma ser avaliado'),
      jsonb_build_object('tipo', 'paragrafo', 'texto',
        'Vale reunir um retrato dos imóveis: matrícula, valor aproximado, se geram renda e em nome de ' ||
        'quem estão. É esse retrato que permite avaliar, com calma, se faz sentido organizá-los em uma ' ||
        'estrutura única — e o que muda, na prática, para a família.'),
      jsonb_build_object('tipo', 'citacao', 'texto',
        'Imóvel é patrimônio que não se divide com tesoura — por isso a regra precisa existir antes da partilha.')
    ))),
 ('protecao_patrimonial', 1::smallint,
  '[RASCUNHO — revisar antes de ativar] Proteção patrimonial: separar o que é da família do que é risco',
  'Cliente preocupado com risco, dívida, processo ou exposição do patrimônio pessoal.',
  array['proteção', 'protecao', 'proteger', 'blindagem', 'blindar', 'risco', 'dívida', 'divida', 'processo', 'execução', 'execucao', 'penhora', 'credor'],
  60::smallint, false, 'exemplo',
  jsonb_build_object(
    'titulo', 'Proteção patrimonial: o que ela é — e o que ela não é',
    'blocos', jsonb_build_array(
      jsonb_build_object('tipo', 'citacao', 'texto',
        'Este texto é um rascunho preparado pela equipe técnica para revisão da advogada. Não foi revisado juridicamente.'),
      jsonb_build_object('tipo', 'paragrafo', 'texto',
        'Obrigado por participar da sua Sessão de Viabilidade. Um dos pontos que você trouxe foi a ' ||
        'preocupação em proteger o patrimônio da família — e este material reúne, de forma resumida, ' ||
        'o que costuma ser avaliado nesse cenário.'),
      jsonb_build_object('tipo', 'titulo', 'texto', 'O que "proteção" significa na prática'),
      jsonb_build_object('tipo', 'paragrafo', 'texto',
        'Proteção patrimonial não é esconder bens nem fugir de obrigação — isso a lei não permite e nenhuma ' ||
        'estrutura séria promete. O que se avalia é a separação entre o patrimônio pessoal da família e o ' ||
        'risco de uma atividade, para que um problema em uma área não contamine a outra.'),
      jsonb_build_object('tipo', 'lista', 'itens', jsonb_build_array(
        'Separar patrimônio pessoal do patrimônio ligado à atividade empresarial.',
        'Definir regras claras de administração, para que decisões não dependam de uma pessoa só.',
        'Organizar em vida a destinação dos bens, com menos espaço para disputa.',
        'Avaliar o momento certo: estrutura feita depois do problema tende a não valer.')),
      jsonb_build_object('tipo', 'citacao', 'texto',
        'Organização patrimonial protege quem se organiza antes — depois, o que sobra é defesa.')
    ))),
 ('doacao_em_vida', 1::smallint,
  '[RASCUNHO — revisar antes de ativar] Doação em vida, usufruto e testamento: os caminhos e o que os diferencia',
  'Cliente que já pensa em antecipar a sucessão (doar, reservar usufruto, fazer testamento).',
  array['doação', 'doacao', 'doar', 'usufruto', 'testamento', 'antecipar', 'em vida', 'partilha em vida', 'legítima', 'legitima'],
  70::smallint, false, 'exemplo',
  jsonb_build_object(
    'titulo', 'Antecipar a sucessão: o que costuma ser comparado',
    'blocos', jsonb_build_array(
      jsonb_build_object('tipo', 'citacao', 'texto',
        'Este texto é um rascunho preparado pela equipe técnica para revisão da advogada. Não foi revisado juridicamente.'),
      jsonb_build_object('tipo', 'paragrafo', 'texto',
        'Obrigado por participar da sua Sessão de Viabilidade. Um dos pontos que você trouxe foi a ' ||
        'vontade de resolver a sucessão ainda em vida — e este material reúne, de forma resumida, o que ' ||
        'costuma ser comparado quando esse é o ponto de partida.'),
      jsonb_build_object('tipo', 'titulo', 'texto', 'Três caminhos que aparecem com frequência'),
      jsonb_build_object('tipo', 'lista', 'itens', jsonb_build_array(
        'Doação com reserva de usufruto: transfere a propriedade e mantém o uso e a renda com quem doa.',
        'Testamento: define a destinação, mas só produz efeito depois — e ainda passa por inventário.',
        'Organização em estrutura societária: reúne os bens e define regras de gestão e de transmissão.')),
      jsonb_build_object('tipo', 'titulo', 'texto', 'O que muda entre eles'),
      jsonb_build_object('tipo', 'paragrafo', 'texto',
        'Cada caminho tem custo, momento e grau de controle diferentes. A escolha depende do retrato ' ||
        'completo da família: quem são os herdeiros, o que existe hoje e o que se quer preservar. ' ||
        'Nenhum deles é automaticamente melhor — e alguns podem ser combinados.'),
      jsonb_build_object('tipo', 'citacao', 'texto',
        'Decidir em vida não é abrir mão — é escolher, com clareza, enquanto ainda dá para escolher.')
    )))
) as v(chave, versao, titulo, descricao, dores, prioridade, ativo, origem_dado, conteudo)
where not exists (select 1 from materiais_modelos m where m.chave = v.chave and m.versao = v.versao);

-- ===========================================================================
-- (e) registrar_material_gerado — nova assinatura com `p_motivo_modelo`.
--     DROP explícito da assinatura da 0031 (armadilha 6). Corpo idêntico ao da
--     0031 + gravação do motivo.
-- ===========================================================================
drop function if exists public.registrar_material_gerado(uuid, uuid, uuid, text, text, jsonb);

create or replace function public.registrar_material_gerado(
  p_jornada_id uuid, p_execucao_id uuid, p_modelo_id uuid,
  p_dor_principal text, p_fonte_dor text, p_conteudo jsonb,
  p_motivo_modelo jsonb default null
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
                                 fonte_dor, conteudo, origem_dado, atual, motivo_modelo)
  values (p_jornada_id, p_modelo_id, p_execucao_id, v_versao, p_dor_principal,
          p_fonte_dor, p_conteudo, v_origem_dado, true, p_motivo_modelo)
  returning * into v_linha;
  return v_linha;
end $$;
revoke execute on function public.registrar_material_gerado(uuid, uuid, uuid, text, text, jsonb, jsonb) from public, anon, authenticated;
grant  execute on function public.registrar_material_gerado(uuid, uuid, uuid, text, text, jsonb, jsonb) to service_role;

-- ===========================================================================
-- (f) Portas de escrita das colunas do PDF (service_role). A rota de aprovação
--     gera o PDF DEPOIS de `aprovar_material_gerado` e registra aqui. Falha de
--     PDF nunca desfaz a aprovação — vira `pdf_erro`.
-- ===========================================================================
create or replace function public.registrar_pdf_material(
  p_material_id uuid, p_caminho text, p_bytes bigint, p_sha256 text
) returns materiais_gerados
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_linha materiais_gerados;
begin
  select * into v_linha from materiais_gerados where id = p_material_id;
  if not found then
    raise exception 'material_nao_encontrado: %', p_material_id using errcode = 'P0002';
  end if;
  if v_linha.aprovado_em is null then
    -- A constraint também barraria; a mensagem aqui é a que a rota traduz.
    raise exception 'material_nao_aprovado: pdf so existe para material aprovado' using errcode = 'P0001';
  end if;
  if p_caminho is null or length(trim(p_caminho)) = 0 or p_bytes is null or p_bytes <= 0 or p_sha256 is null then
    raise exception 'pdf_invalido: caminho, bytes e sha256 sao obrigatorios' using errcode = '22023';
  end if;

  update materiais_gerados
     set pdf_caminho = p_caminho, pdf_bytes = p_bytes, pdf_sha256 = p_sha256,
         pdf_gerado_em = now(), pdf_erro = null
   where id = p_material_id
  returning * into v_linha;

  perform app.registrar_evento_timeline(
    v_linha.jornada_id, 'material', 'PDF do material gerado',
    'Versão ' || v_linha.versao::text || ' · ' || round(p_bytes / 1024.0)::text || ' KB',
    jsonb_build_object('material_id', v_linha.id, 'versao', v_linha.versao, 'bytes', p_bytes)
  );

  return v_linha;
end $$;
revoke execute on function public.registrar_pdf_material(uuid, text, bigint, text) from public, anon, authenticated;
grant  execute on function public.registrar_pdf_material(uuid, text, bigint, text) to service_role;

create or replace function public.registrar_pdf_material_erro(p_material_id uuid, p_erro text)
returns materiais_gerados
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_linha materiais_gerados;
begin
  update materiais_gerados
     set pdf_erro = left(coalesce(p_erro, 'erro desconhecido'), 1000)
   where id = p_material_id
  returning * into v_linha;
  if not found then
    raise exception 'material_nao_encontrado: %', p_material_id using errcode = 'P0002';
  end if;
  return v_linha;
end $$;
revoke execute on function public.registrar_pdf_material_erro(uuid, text) from public, anon, authenticated;
grant  execute on function public.registrar_pdf_material_erro(uuid, text) to service_role;

-- ===========================================================================
-- (g) Download público do PDF pelo link `/p/m` (GET /api/publico/[token]/material-pdf).
--     Mesma cadeia de `abrir_link_publico` (0028): rate limit por rota e por
--     token, `resolve_link_leitura`, auditoria em `links_publicos_acessos`.
--     Devolve SÓ o caminho do objeto (para a rota assinar por 300s) — nunca
--     jornada_id, pessoa ou conteúdo. Erro único `link_invalido` para token
--     ruim/expirado/revogado/tipo errado/sem material aprovado (regra 3 da
--     0028: sem oráculo). `pdf_indisponivel` só quando o material aprovado
--     existe mas o arquivo ainda não (a página /p/m já mostra o material, então
--     não revela nada novo).
--     Restrita a service_role: a rota precisa do cliente admin de qualquer
--     forma para assinar a URL, e a função não depende de auth.uid().
--     Ação registrada como 'abrir' — não altera o CHECK de `acao` (0028) para
--     não colidir com outra migration desta fase que toque a mesma constraint.
-- ===========================================================================
create or replace function public.resolver_pdf_material_publico(
  p_hash text, p_ip_hash text default null, p_user_agent text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_link links_publicos; v_material record;
begin
  if not app.limite_rota_ok('material_pdf') then
    return jsonb_build_object('erro', 'limite_excedido');
  end if;
  if not app.limite_token_ok(p_hash) then
    perform app.registrar_acesso_publico(null, 'abrir', 'limite', p_ip_hash, p_user_agent);
    return jsonb_build_object('erro', 'limite_excedido');
  end if;

  v_link := app.resolve_link_leitura(p_hash);
  if v_link is null or v_link.tipo <> 'material' then
    perform app.registrar_acesso_publico(null, 'abrir', 'invalido', p_ip_hash, p_user_agent);
    return jsonb_build_object('erro', 'link_invalido');
  end if;

  select id, pdf_caminho, versao into v_material
    from materiais_gerados
   where jornada_id = v_link.jornada_id and atual and aprovado_em is not null
   limit 1;
  if not found then
    perform app.registrar_acesso_publico(v_link.id, 'abrir', 'invalido', p_ip_hash, p_user_agent);
    return jsonb_build_object('erro', 'link_invalido');
  end if;
  if v_material.pdf_caminho is null then
    perform app.registrar_acesso_publico(v_link.id, 'abrir', 'erro', p_ip_hash, p_user_agent);
    return jsonb_build_object('erro', 'pdf_indisponivel');
  end if;

  perform app.registrar_acesso_publico(v_link.id, 'abrir', 'ok', p_ip_hash, p_user_agent);
  return jsonb_build_object('caminho', v_material.pdf_caminho, 'versao', v_material.versao);
end $$;
revoke execute on function public.resolver_pdf_material_publico(text, text, text) from public, anon, authenticated;
grant  execute on function public.resolver_pdf_material_publico(text, text, text) to service_role;

-- ===========================================================================
-- (h) Ativar versão do catálogo (admin). Mesma técnica de
--     `ativar_template_mensagem` (0033): desativa a corrente e ativa esta na
--     MESMA transação — `uniq_material_modelo_ativo` nunca é violada.
-- ===========================================================================
create or replace function public.ativar_material_modelo(p_id uuid)
returns materiais_modelos
language plpgsql set search_path = public, pg_temp as $$
declare v_chave text; v_origem text; v_linha materiais_modelos;
begin
  if not app.eh_admin() then
    raise exception 'sem_permissao: apenas admin ativa versão de modelo de material' using errcode = '42501';
  end if;

  select chave, origem_dado into v_chave, v_origem from materiais_modelos where id = p_id;
  if v_chave is null then
    raise exception 'versao_nao_encontrada: %', p_id using errcode = 'P0002';
  end if;
  -- Rascunho semeado por engenharia nunca entra em produção sem a advogada
  -- marcar como revisado (origem_dado='real' via PATCH) — regra no banco, não só na rota.
  if v_origem = 'exemplo' then
    raise exception 'modelo_rascunho: marque como revisado (origem_dado=real) antes de ativar' using errcode = 'P0001';
  end if;

  update materiais_modelos set ativo = false where chave = v_chave and ativo and id <> p_id;
  update materiais_modelos set ativo = true where id = p_id returning * into v_linha;
  return v_linha;
end $$;
revoke execute on function public.ativar_material_modelo(uuid) from public, anon;
grant  execute on function public.ativar_material_modelo(uuid) to authenticated;

-- ===========================================================================
-- (i) Configurações (UPDATE sem deploy). B35 / B14.
-- ===========================================================================
insert into configuracoes (chave, valor, descricao) values
 ('material.anexar_pdf', 'true'::jsonb,
  'Régua pos_sessao anexa o PDF do material ao e-mail (além do link /p/m). false = só o link. (B35)'),
 ('material.rodape_juridico',
  '"Material educativo elaborado pela equipe do Time Holding Brasil. Não constitui parecer jurídico nem promessa de resultado. Cada caso exige análise individual."'::jsonb,
  'Rodapé impresso em toda página do PDF do material pós-sessão. Editável pela advogada (B14).')
on conflict (chave) do nothing;

-- ===========================================================================
-- ROTEIRO DE VERIFICAÇÃO (rodar depois de aplicar; nada aqui presume aplicado)
-- ===========================================================================
-- 1) Colunas e constraints:
--    select column_name from information_schema.columns
--     where table_name='materiais_gerados' and column_name like 'pdf_%';           -- 5 linhas
--    select conname from pg_constraint where conrelid='materiais_gerados'::regclass
--     and conname like 'ck_pdf%';                                                   -- 3 linhas
-- 2) Invariante (deve FALHAR com 23514):
--    update materiais_gerados set pdf_caminho='x', pdf_bytes=1, pdf_sha256='y', pdf_gerado_em=now()
--     where aprovado_em is null limit 1;  -- usar um id de rascunho de teste
-- 3) Sobrecarga eliminada (deve devolver UMA linha, com 7 argumentos):
--    select oid::regprocedure from pg_proc where proname='registrar_material_gerado';
-- 4) Catálogo:
--    select chave, versao, ativo, origem_dado, prioridade, dores from materiais_modelos order by chave, versao;
--    -- 5 ativos 'real' (0031) + 3 inativos 'exemplo'; dores preenchidas nos 4 temáticos.
--    select count(*) from materiais_modelos where ativo;                            -- 5
-- 5) Grants:
--    select proname, proacl from pg_proc where proname in
--     ('registrar_pdf_material','registrar_pdf_material_erro','resolver_pdf_material_publico','ativar_material_modelo');
--    -- as 3 primeiras: só service_role; a última: authenticated.
-- 6) Config:
--    select chave, valor from configuracoes where chave like 'material.%';          -- 2 linhas
-- 7) Download público sem PDF (material aprovado, pdf_caminho nulo):
--    select resolver_pdf_material_publico('<hash de link material válido>');       -- {"erro":"pdf_indisponivel"}
--    select resolver_pdf_material_publico('hash-inexistente');                      -- {"erro":"link_invalido"}
