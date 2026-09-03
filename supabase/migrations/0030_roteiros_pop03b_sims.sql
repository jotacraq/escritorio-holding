-- 0030_roteiros_pop03b_sims.sql
-- ONDA 3 (B-3A) — POP 05, POP 03-B e os 4 SIMs (docs/ARQUITETURA-FASE-2.md §4.3).
--
-- Roteiro vira DADO, no mesmo padrão de `prompts_versoes` (0009) e
-- `formularios` (0006): trocar de versão é INSERT + ativar, nunca UPDATE no
-- texto em uso. Toda sessão/ligação conduzida guarda QUAL versão foi usada —
-- histórico não se reescreve quando a versão ativa muda depois.
--
-- A jogada de otimização (§4.3): o roteiro da ligação (POP 03/03-B) passa a
-- ser renderizado pelo MESMO motor de `roteiros_versoes` que o roteiro da SV.
-- O POP 03-B entra SEM UMA LINHA DE FRONT NOVA e sem tocar a rota existente
-- `POST/PUT /api/jornadas/[id]/ligacao` (fora da minha fronteira): o vínculo
-- `ligacoes_estrategicas.roteiro_versao_id` é preenchido por TRIGGER, a partir
-- de `ligacoes_estrategicas.pop` ('03' | '03-B'), no momento do INSERT — a
-- ligação é registrada logo depois de acontecer, então "ativo agora" já É "a
-- versão com que a ligação foi conduzida".
--
-- `sessoes_viabilidade.roteiro_versao_id` NÃO leva o mesmo tipo de trigger de
-- INSERT: a sessão nasce cedo (na hora do PRIMEIRO agendamento, rota
-- `POST /api/jornadas/[id]/agendamentos`, fora da minha fronteira), às vezes
-- dias ou semanas antes de a sessão de fato acontecer. Estampar a versão ativa
-- na criação capturaria "o que estava ativo quando a reunião foi marcada", não
-- "com qual versão a sessão foi CONDUZIDA" — que é o que o plano pede. Por
-- isso a estampa acontece dentro de `public.registrar_sim_sessao` (este
-- arquivo), no primeiro SIM registrado: esse é o instante real de início da
-- condução. Fica `null` até lá (nenhuma sessão nasce com um roteiro chutado).

-- ===========================================================================
-- `roteiros_versoes` — mesmo padrão de `prompts_versoes`/`formularios`.
-- Não carrega PII de cliente (é conteúdo/config do método) — mesma classe de
-- `prompts_versoes`/`formularios`/`produtos`, que a verificação de RLS da 0027
-- já exclui explicitamente da varredura de "for all com DELETE é achado".
-- ===========================================================================
create table roteiros_versoes (
  id          uuid primary key default gen_random_uuid(),
  chave       text not null,        -- 'sessao_viabilidade' | 'pop_03' | 'pop_03b'
  versao      smallint not null,
  titulo      text not null,
  -- {blocos:[{id,titulo,objetivo,acao,falas:[{id,locutor,texto,sim?,rotulo_sim?}],
  --           campos:[{id,rotulo,tipo,opcoes?}],observar:[],proibido:[]}]}
  -- `falas[].sim` só existe nas 4 falas do 1º bloco de `sessao_viabilidade`
  -- ('sigilo_gravacao'|'licitude'|'decisores'|'proximo_passo') — é a chave que
  -- `registrar_sim_sessao` usa para achar o TEXTO CONGELADO do 1º SIM.
  definicao   jsonb not null,
  ativo       boolean not null default false,
  notas       text,
  criado_em   timestamptz not null default now(),
  criado_por  uuid references perfis_equipe(id),
  unique (chave, versao)
);
create unique index uniq_roteiro_ativo on roteiros_versoes (chave) where ativo;

alter table roteiros_versoes enable row level security;
alter table roteiros_versoes force row level security;

create policy rv_sel on roteiros_versoes for select to authenticated using ((select app.eh_interno()));
create policy rv_wr  on roteiros_versoes for all to authenticated
  using ((select app.eh_admin())) with check ((select app.eh_admin()));
-- `for all` inclui DELETE, mas sem PII: mesmo recorte de `prompts_versoes`/
-- `formularios` (0027 já documenta a exclusão dessa classe de tabela). Ninguém
-- deveria apagar versão de roteiro na prática (quebraria `roteiro_versao_id`
-- de sessão/ligação já conduzida, que é `references ... ` sem `on delete`, e o
-- delete falharia por FK) — a proteção real aqui já é a própria FK.

-- Única porta para promover uma versão a ativa (mesmo padrão de
-- `ativar_prompt_versao`/`ativar_template_mensagem`, 0033): desativa a anterior
-- da MESMA chave na mesma transação, nunca fica um instante sem versão ativa.
-- É o mecanismo do BLOQUEIO B15: quando a Dra. Elaine carimbar qual guia é a
-- oficial, ativar aquela versão é isto — um UPDATE, o histórico de sessões já
-- conduzidas com a v4 não muda (`roteiro_versao_id` já gravado permanece).
create or replace function public.ativar_roteiro_versao(p_id uuid)
returns roteiros_versoes
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_chave text;
  v_linha roteiros_versoes;
begin
  if not app.eh_admin() then
    raise exception 'sem_permissao: apenas admin ativa versão de roteiro' using errcode = '42501';
  end if;

  select chave into v_chave from roteiros_versoes where id = p_id;
  if v_chave is null then
    raise exception 'versao_nao_encontrada: %', p_id using errcode = 'P0002';
  end if;

  update roteiros_versoes set ativo = false where chave = v_chave and ativo and id <> p_id;
  update roteiros_versoes set ativo = true where id = p_id returning * into v_linha;

  return v_linha;
end $$;
revoke execute on function public.ativar_roteiro_versao(uuid) from public, anon;
grant  execute on function public.ativar_roteiro_versao(uuid) to authenticated;
comment on function public.ativar_roteiro_versao(uuid) is
  'Única porta para promover uma versão de roteiro a ativa. Desativa a anterior '
  'da mesma chave na MESMA transação — nunca fica um instante sem versão ativa.';

-- ===========================================================================
-- POP 03 / POP 03-B — a ligação passa a apontar para o roteiro versionado.
-- Respostas continuam no jsonb `respostas` que JÁ EXISTE (0006), chaveadas
-- pelos ids de `campos` do roteiro (`p1`..`p5`) — zero coluna nova por variante.
-- ===========================================================================
alter table ligacoes_estrategicas add column roteiro_versao_id uuid references roteiros_versoes(id);

create or replace function app.estampa_roteiro_ligacao() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_chave text := case when new.pop = '03-B' then 'pop_03b' else 'pop_03' end;
begin
  if new.roteiro_versao_id is null then
    select id into new.roteiro_versao_id from roteiros_versoes where chave = v_chave and ativo;
  end if;
  return new;
end $$;
create trigger trg_ligacoes_estampa_roteiro before insert on ligacoes_estrategicas
for each row execute function app.estampa_roteiro_ligacao();
-- Só BEFORE INSERT (nunca UPDATE): a ligação é registrada logo depois de
-- acontecer (`realizada_em default now()` na 0006) — "versão ativa agora" já
-- É "versão com que a ligação foi conduzida". `PUT` (continuar rascunho, rota
-- existente) nunca deveria trocar retroativamente qual roteiro foi seguido.

-- ===========================================================================
-- POP 05 — Sessão de Viabilidade: roteiro + os 4 SIMs.
-- ===========================================================================
alter table sessoes_viabilidade add column roteiro_versao_id uuid references roteiros_versoes(id);

-- Os 4 SIMs. O 1º (sigilo/gravação) NÃO mora aqui: vira linha em
-- `consentimentos` (tipo 'gravacao_sessao', que já existe em 0005), com texto
-- CONGELADO na linha. Os outros três são checagem de condução, não
-- consentimento de dado — {"licitude":{"ok":true,"em":"...","registrado_por":"..."},
-- "decisores":{...},"proximo_passo":{...}}.
alter table sessoes_viabilidade add column sims jsonb not null default '{}'::jsonb;

-- Única porta de escrita dos 4 SIMs (evita que uma rota grave `sims` livre e
-- outra tente inserir `consentimentos` com texto que não veio do roteiro —
-- ver BLOQUEIO B3: "não amplie o texto por conta própria". O texto do 1º SIM
-- é lido do PRÓPRIO roteiro ativo da sessão, nunca aceito como parâmetro do
-- chamador — um `relacionamento`/`assistente` autenticado não pode fabricar
-- o que "foi apresentado" ao cliente.
create or replace function public.registrar_sim_sessao(
  p_sessao_id uuid,
  p_sim text,          -- 'sigilo_gravacao' | 'licitude' | 'decisores' | 'proximo_passo'
  p_confirmado boolean
) returns sessoes_viabilidade
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_jornada_id uuid;
  v_roteiro_versao_id uuid;
  v_pessoa_id uuid;
  v_perfil_id uuid;
  v_texto text;
  v_linha sessoes_viabilidade;
begin
  if not app.eh_interno() then
    raise exception 'sem_permissao: apenas equipe interna registra SIM da sessão' using errcode = '42501';
  end if;
  if p_sim not in ('sigilo_gravacao', 'licitude', 'decisores', 'proximo_passo') then
    raise exception 'sim_invalido: %', p_sim using errcode = '22023';
  end if;

  select jornada_id, roteiro_versao_id into v_jornada_id, v_roteiro_versao_id
    from sessoes_viabilidade where id = p_sessao_id;
  if v_jornada_id is null then
    raise exception 'sessao_nao_encontrada: %', p_sessao_id using errcode = 'P0002';
  end if;

  select id into v_perfil_id from perfis_equipe where auth_user_id = auth.uid();

  -- Estampa o roteiro CONDUZIDO no instante do primeiro SIM (ver NOTA no topo
  -- do arquivo — nunca no INSERT da sessão, que acontece no agendamento).
  if v_roteiro_versao_id is null then
    select id into v_roteiro_versao_id from roteiros_versoes where chave = 'sessao_viabilidade' and ativo;
    if v_roteiro_versao_id is not null then
      update sessoes_viabilidade set roteiro_versao_id = v_roteiro_versao_id
       where id = p_sessao_id and roteiro_versao_id is null;
    end if;
  end if;

  if p_sim = 'sigilo_gravacao' then
    if v_roteiro_versao_id is null then
      raise exception 'roteiro_nao_configurado: nenhuma versao ativa para sessao_viabilidade' using errcode = 'P0002';
    end if;

    -- Texto CONGELADO: vem do próprio roteiro ativo, nunca de parâmetro do chamador.
    select f ->> 'texto' into v_texto
      from roteiros_versoes rv,
           jsonb_array_elements(rv.definicao -> 'blocos') as b,
           jsonb_array_elements(b -> 'falas') as f
     where rv.id = v_roteiro_versao_id
       and f ->> 'sim' = 'sigilo_gravacao'
     limit 1;

    if v_texto is null then
      raise exception 'texto_consentimento_nao_encontrado: versao % sem fala marcada sim=sigilo_gravacao', v_roteiro_versao_id
        using errcode = 'P0002';
    end if;

    select pessoa_id into v_pessoa_id from jornadas where id = v_jornada_id;

    insert into consentimentos (pessoa_id, tipo, concedido, texto_apresentado, versao_texto, canal, registrado_por)
    values (v_pessoa_id, 'gravacao_sessao', p_confirmado, v_texto, 'roteiro:' || v_roteiro_versao_id::text,
            'sessao_zoom', v_perfil_id);
    -- NOTA — BLOQUEIO B3: este texto autoriza gravação "para que minha equipe
    -- possa analisar", não tratamento por operador de IA no exterior. Nenhuma
    -- rota deste sistema pode ler `concedido=true` daqui como se fosse também
    -- `tipo='tratamento_ia'` — são tipos DIFERENTES na mesma tabela, cada um
    -- com sua própria vigência (`app.tem_consentimento`, 0005).
  else
    update sessoes_viabilidade
       set sims = jsonb_set(
             coalesce(sims, '{}'::jsonb),
             array[p_sim],
             jsonb_build_object('ok', p_confirmado, 'em', now(), 'registrado_por', v_perfil_id),
             true)
     where id = p_sessao_id;
  end if;

  select * into v_linha from sessoes_viabilidade where id = p_sessao_id;
  return v_linha;
end $$;
revoke execute on function public.registrar_sim_sessao(uuid, text, boolean) from public, anon;
grant  execute on function public.registrar_sim_sessao(uuid, text, boolean) to authenticated;
comment on function public.registrar_sim_sessao(uuid, text, boolean) is
  'Única porta de escrita dos 4 SIMs da Sessão de Viabilidade. sigilo_gravacao '
  'grava consentimentos (texto congelado, lido do roteiro ativo da sessão); os '
  'outros três atualizam sessoes_viabilidade.sims. Nunca aceita texto do chamador.';

-- ===========================================================================
-- Seed: as 4 guias do Script de Sessão de Viabilidade (sic-hf-brain/06 -
-- Materiais/Script de Sessao de Viabilidade.md) viram as versões 1-4 da chave
-- 'sessao_viabilidade', TRANSCRITAS sem fusão (CONFLITO C5 do plano v1: "a 4ª
-- traz falas que a 1ª não tem" — cada guia entra como está no arquivo-fonte,
-- divergências incluídas). A PARTE 01 (os 4 SIMs) é byte-idêntica nas 4 guias
-- no arquivo-fonte — confirmado por comparação de string antes de gerar este
-- SQL, não copiado de cabeça.
--
-- A versão 4 (a mais extensa, última do arquivo — "Teste 3" no arquivo-fonte)
-- fica ATIVA. BLOQUEIO B15: nenhuma delas foi carimbada pela Dra. Elaine como
-- oficial — a tela (`docs/ARQUITETURA-FASE-2.md` §4.3, dono: F-3B) precisa
-- mostrar o aviso: "Versão 4 do arquivo de script — não carimbada pela Dra.
-- Elaine. Ver BLOQUEIO B15." Ativar outra versão depois é
-- `select public.ativar_roteiro_versao('<id>')`, sem migration nova.
-- ===========================================================================
insert into roteiros_versoes (chave, versao, titulo, definicao, ativo, notas) values
('sessao_viabilidade', 1, 'Script de Fechamento de Croqui — Guia 1',
 $rot1${
  "blocos": [
    {
      "id": "parte_00",
      "titulo": "Check-in e Profissionalismo",
      "objetivo": "Transmitir profissionalismo e preservar a agenda do especialista.",
      "acao": "Um assistente da equipe abre a sala do Zoom antes do advogado para realizar o setup técnico.",
      "falas": [],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_01",
      "titulo": "Assumir o Controle (A Busca pelos 4 SIMs)",
      "objetivo": "Abertura da sessão: obter os 4 SIMs antes de prosseguir para o diagnóstico.",
      "acao": null,
      "falas": [
        {
          "id": "intro",
          "locutor": "advogado",
          "texto": "Antes de iniciarmos, preciso alinhar quatro pontos fundamentais com você:"
        },
        {
          "id": "sigilo_gravacao",
          "locutor": "advogado",
          "texto": "Tudo o que tratarmos aqui é absolutamente sigiloso. Eu vou gravar esta sessão para que minha equipe possa analisar cada detalhe do seu caso depois, sem que eu precise te pedir para repetir nada. Você se sente à vontade para falar abertamente sobre seus desejos e seu patrimônio? (1º SIM)",
          "sim": "sigilo_gravacao",
          "rotulo_sim": "1º SIM — Sigilo e Gravação"
        },
        {
          "id": "licitude",
          "locutor": "advogado",
          "texto": "Integro um time nacional com um código de ética rígido. Nosso sistema é poderoso e só o aplicamos a patrimônios de origem lícita.E apenas para confirmarmos a certeza que já temos iremos reforçar e preciso apenas da sua confirmação:  Seus bens têm origem legal e você NÃO busca este sistema para ocultar crimes, certo? (2º SIM)",
          "sim": "licitude",
          "rotulo_sim": "2º SIM — Ética e Licitude"
        },
        {
          "id": "decisores",
          "locutor": "advogado",
          "texto": "Para que este diagnóstico seja eficaz, é indispensável que todos os que decidem sobre os bens da família estejam presentes. Todos os responsáveis estão aqui agora e podemos prosseguir? (3º SIM)",
          "sim": "decisores",
          "rotulo_sim": "3º SIM — Presença dos Decisores"
        },
        {
          "id": "proximo_passo_contexto",
          "locutor": "advogado",
          "texto": "Se eu identificar que o sistema é viável para você, o nosso próximo passo após esta Sessão de Viabilidade será a contratação para elaboração do Croqui Estrutural. Ele funciona como uma 'planta baixa' personalizada da sua Holding. É nessa nova contratação, nesse estudo profundo que você terá a visão do sistema pronto, os cenários possíveis para seu planejamento patrimonial, o comando dos bens e o orçamento exato de custos e impostos, para que não haja surpresas na execução."
        },
        {
          "id": "proximo_passo",
          "locutor": "advogado",
          "texto": "Ao final desta conversa, eu te direi se devemos ou não prosseguir para esse estudo técnico. O meu objetivo é que, ao sair daqui hoje, você tenha condições de tomar a decisão mais assertiva para proteger sua família. Compreendeu como vamos trabalhar? Podemos prosseguir? (4º SIM).",
          "sim": "proximo_passo",
          "rotulo_sim": "4º SIM — Decisão Assertiva"
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_02",
      "titulo": "A Motivação do Cliente",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado: \"Me conte, o que te motivou a estar hoje aqui comigo? Por que você deseja ter uma Holding Familiar?\"."
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_03",
      "titulo": "Radiografia Familiar e Patrimonial (SEJA EMPÁTICO E BUSQUE MAIS QUE INFORMAÇÕES CADASTRAIS)",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "A Família: Questionar sobre filhos (maiores ou menores), regimes de casamento de todos os envolvidos, ocupações e idades.\nO Patrimônio: Levantar a lista de bens, valores de mercado, valores de aquisição, datas, formas de pagamento e a relação pessoal do cliente com cada bem.\nCapacidade Econômica: Identificar quem paga as contas hoje e quais são as reservas financeiras disponíveis."
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_04",
      "titulo": "A Fase do Desconforto (Infligir Dor)",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado:\n\"Você tem ideia de quanto seus filhos teriam que gastar para serem donos do que você construiu? (Custo do Inventário)\".\n\"Você tem uma reserva financeira ou seguro de vida específico só para pagar o governo e advogados no inventário?\".\n\"Você está ciente de que a reforma tributária vai aumentar drasticamente o ITCMD?\"."
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_05",
      "titulo": "O Desejo de Futuro",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado: \"Como você gostaria de deixar organizado o patrimônio para seus filhos? Você acredita que evitar o inventário e possíveis brigas por dinheiro seria um benefício para a harmonia da sua família?\"."
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_06",
      "titulo": "Por que este Profissional?",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado: \"Existem outros profissionais no mercado, inclusive da sua confiança. O que te impede de fazer sua Holding com eles e por que você prefere fazer conosco?\"."
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_07",
      "titulo": "Compromisso e Agilidade",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado: \"Diante do cenário atual do país e do risco de aumento de impostos, você sente que essa proteção é algo que te motiva a agir rápido para não deixar o futuro da sua família para depois?\"."
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_08",
      "titulo": "Autorização para Ajudar",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado: \"Restou alguma dúvida sobre o que conversamos até aqui? (Não tire dúvidas técnicas agora; remeta ao croqui). Após ouvir tudo isso, eu estou muito feliz: eu consigo ajudar sua família e sei exatamente como fazer.\"."
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_09",
      "titulo": "Posicionamento de Expert",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado: \"Minha especialidade é o Planejamento Patrimonial. Eu ajudo os pais a praticarem um ato de amor para que seus filhos não precisem de advogados em um momento de horror (inventário). Minha expertise é usar a Holding como ferramenta para isso.\"."
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_10",
      "titulo": "A Oferta do Croqui Estrutural",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado: \"O diagnóstico para sua família é positivo. O próximo passo é a contratação do Croqui Estrutural. Ele é como uma planta baixa onde você verá os cenários possíveis, a distribuição dos bens, o comando de tudo e, principalmente, um orçamento detalhado e sem surpresas. O que eu preciso de você agora é a decisão de contratar esse 'desenho'.\".\nAção: FICAR CALADO até que o cliente pergunte o preço."
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_11",
      "titulo": "Preço e Incentivo do Resolvedor",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado: \"O preço padrão para a elaboração deste estudo é de R$ 7.200,00. Porém, como eu gravei nossa sessão e as informações estão frescas, eu economizo tempo de equipe se eu começar agora. Por isso, para quem decide aqui na reunião – o que chamo de Incentivo do Resolvedor – o valor fica por R$ 4.500,00. Além disso, o que você já pagou hoje e o valor do croqui serão integralmente abatidos dos honorários finais da Holding.\"."
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_12",
      "titulo": "Finalização Binária",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Ação: FICAR CALADO e aceitar apenas \"Sim\" ou \"Não\".\nSe SIM: Dar os parabéns por ser um \"Resolvedor\" e passar para a assistente para o link de pagamento (válido para o dia). Solicitar o envio das informações de IR, principalmente do imóvel.\nSe NÃO: Dizer que entende o momento, reforçar que o primeiro passo foi dado, mas jamais dizer que está \"à disposição para quando ele precisar\"."
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    }
  ]
}$rot1$::jsonb, false,
 'Transcrito de "Script de Sessao de Viabilidade.md", seção "Guia 1" (linhas 1-54 do arquivo-fonte em 03/09/2026). Uma das 4 versões do CONFLITO C5 — nenhuma carimbada como oficial (BLOQUEIO B15).'),
('sessao_viabilidade', 2, 'Script de Fechamento de Croqui — Guia "TESTE"',
 $rot2${
  "blocos": [
    {
      "id": "parte_00",
      "titulo": "Check-in e Profissionalismo",
      "objetivo": "Transmitir profissionalismo e preservar a agenda do especialista.",
      "acao": "Um assistente da equipe abre a sala do Zoom antes do advogado para realizar o setup técnico.",
      "falas": [],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_01",
      "titulo": "Assumir o Controle (A Busca pelos 4 SIMs)",
      "objetivo": "Abertura da sessão: obter os 4 SIMs antes de prosseguir para o diagnóstico.",
      "acao": null,
      "falas": [
        {
          "id": "intro",
          "locutor": "advogado",
          "texto": "Antes de iniciarmos, preciso alinhar quatro pontos fundamentais com você:"
        },
        {
          "id": "sigilo_gravacao",
          "locutor": "advogado",
          "texto": "Tudo o que tratarmos aqui é absolutamente sigiloso. Eu vou gravar esta sessão para que minha equipe possa analisar cada detalhe do seu caso depois, sem que eu precise te pedir para repetir nada. Você se sente à vontade para falar abertamente sobre seus desejos e seu patrimônio? (1º SIM)",
          "sim": "sigilo_gravacao",
          "rotulo_sim": "1º SIM — Sigilo e Gravação"
        },
        {
          "id": "licitude",
          "locutor": "advogado",
          "texto": "Integro um time nacional com um código de ética rígido. Nosso sistema é poderoso e só o aplicamos a patrimônios de origem lícita.E apenas para confirmarmos a certeza que já temos iremos reforçar e preciso apenas da sua confirmação:  Seus bens têm origem legal e você NÃO busca este sistema para ocultar crimes, certo? (2º SIM)",
          "sim": "licitude",
          "rotulo_sim": "2º SIM — Ética e Licitude"
        },
        {
          "id": "decisores",
          "locutor": "advogado",
          "texto": "Para que este diagnóstico seja eficaz, é indispensável que todos os que decidem sobre os bens da família estejam presentes. Todos os responsáveis estão aqui agora e podemos prosseguir? (3º SIM)",
          "sim": "decisores",
          "rotulo_sim": "3º SIM — Presença dos Decisores"
        },
        {
          "id": "proximo_passo_contexto",
          "locutor": "advogado",
          "texto": "Se eu identificar que o sistema é viável para você, o nosso próximo passo após esta Sessão de Viabilidade será a contratação para elaboração do Croqui Estrutural. Ele funciona como uma 'planta baixa' personalizada da sua Holding. É nessa nova contratação, nesse estudo profundo que você terá a visão do sistema pronto, os cenários possíveis para seu planejamento patrimonial, o comando dos bens e o orçamento exato de custos e impostos, para que não haja surpresas na execução."
        },
        {
          "id": "proximo_passo",
          "locutor": "advogado",
          "texto": "Ao final desta conversa, eu te direi se devemos ou não prosseguir para esse estudo técnico. O meu objetivo é que, ao sair daqui hoje, você tenha condições de tomar a decisão mais assertiva para proteger sua família. Compreendeu como vamos trabalhar? Podemos prosseguir? (4º SIM).",
          "sim": "proximo_passo",
          "rotulo_sim": "4º SIM — Decisão Assertiva"
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_02",
      "titulo": "A Motivação do Cliente",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado: \"Me conte, o que te motivou a estar hoje aqui comigo? Por que você deseja ter uma Holding Familiar?\".\n\"Virgílio, antes de falar de patrimônio, eu gosto sempre de entender as pessoas. O que aconteceu para que justamente agora você decidisse participar do seminário e chegar até essa Sessão de Viabilidade?\"Pergunte:\n\"O que fez esse assunto deixar de ser algo para depois e virar uma prioridade?\"\n\nDepois:\n\"Qual foi a maior preocupação que passou pela sua cabeça?\"\n\nDepois:\n\"O que o senhor mais quer evitar?\"\n\nDepois:\n\"E qual seria o melhor resultado que essa estrutura poderia trazer para sua família?\"\n\nSó depois eu iria para patrimônio."
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_03",
      "titulo": "Radiografia Familiar e Patrimonial (SEJA EMPÁTICO E BUSQUE MAIS QUE INFORMAÇÕES CADASTRAIS)",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "A Família: Questionar sobre filhos (maiores ou menores), regimes de casamento de todos os envolvidos, ocupações e idades.\nO Patrimônio: Levantar a lista de bens, valores de mercado, valores de aquisição, datas, formas de pagamento e a relação pessoal do cliente com cada bem.\n\"Desses imóveis todos... existe algum que tenha um valor emocional diferente para o senhor?\"\nEssa pergunta parece irrelevante.\nMas ela revela:\ncasa construída pelos pais;\nimóvel onde os filhos cresceram;\npatrimônio que não pode ser vendido.\n\nCapacidade Econômica: Identificar quem paga as contas hoje e quais são as reservas financeiras disponíveis."
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_04",
      "titulo": "A Fase do Desconforto (Infligir Dor)",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado:\n\"Você tem ideia de quanto seus filhos teriam que gastar para serem donos do que você construiu? (Custo do Inventário)\".\"Virgílio, se nada for feito, o que o senhor acredita que pode acontecer com esse patrimônio?\"Depois:\n\"O senhor já imaginou quanto custaria isso?\"\nA primeira pergunta ativa imaginação.\nA segunda entrega o número.\n\n\"Você tem uma reserva financeira ou seguro de vida específico só para pagar o governo e advogados no inventário?\".\n\"Você está ciente de que a reforma tributária vai aumentar drasticamente o ITCMD?\"."
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_05",
      "titulo": "O Desejo de Futuro",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado: \"Como você gostaria de deixar organizado o patrimônio para seus filhos? Você acredita que evitar o inventário e possíveis brigas por dinheiro seria um benefício para a harmonia da sua família?\"."
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_06",
      "titulo": "Por que este Profissional?",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado: \"Existem outros profissionais no mercado, inclusive da sua confiança. O que te impede de fazer sua Holding com eles e por que você prefere fazer conosco?\".\nTroco por:\n\n\"Durante o seminário, houve algum momento em que o senhor pensou: 'é exatamente isso que eu preciso para minha família'?\"\n\nVeja a diferença.\n\nVocê não está perguntando por que escolheu você.\n\nEstá perguntando qual parte da mensagem fez sentido.\n\nA resposta vira argumento de fechamento."
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_07",
      "titulo": "Compromisso e Agilidade",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado: \"Diante do cenário atual do país e do risco de aumento de impostos, você sente que essa proteção é algo que te motiva a agir rápido para não deixar o futuro da sua família para depois?\"."
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_08",
      "titulo": "Autorização para Ajudar",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado: \"Restou alguma dúvida sobre o que conversamos até aqui? (Não tire dúvidas técnicas agora; remeta ao croqui). Após ouvir tudo isso, eu estou muito feliz: eu consigo ajudar sua família e sei exatamente como fazer.\"."
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_09",
      "titulo": "Posicionamento de Expert",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado: \"Minha especialidade é o Planejamento Patrimonial. Eu ajudo os pais a praticarem um ato de amor para que seus filhos não precisem de advogados em um momento de horror (inventário). Minha expertise é usar a Holding como ferramenta para isso.\".\n\"Virgílio, antes de falarmos do próximo passo, quero confirmar se compreendi corretamente o seu caso.\"\nDepois.\n\"O senhor construiu um patrimônio ao longo de muitos anos.\"\n\"Hoje sua maior preocupação é...\"\n(repita exatamente as palavras dele)\n\"O senhor quer evitar...\"\n\"E gostaria de deixar...\"\nDepois.\n\"Foi isso mesmo que o senhor quis me transmitir?\""
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_10",
      "titulo": "A Oferta do Croqui Estrutural",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Diga:\n\"Então eu já consigo lhe dar uma resposta técnica.\"\nPausa.\n\"Na minha avaliação, sua família tem indicação para implantação desse sistema.\"\n\nAdvogado: \"O diagnóstico para sua família é positivo. \"Mas existe um detalhe importante.\"Eu nunca inicio uma estrutura patrimonial sem antes desenhá-la completamente.\"\nDepois.\n\"Seria como um engenheiro começar uma obra sem projeto.\" \"É justamente para isso que existe o Croqui Estrutural.\"\nEle é como uma planta baixa onde você verá os cenários possíveis, a distribuição dos bens, o comando de tudo e, principalmente, um orçamento detalhado e sem surpresas. O que eu preciso de você agora é a decisão de contratar esse 'desenho'.\".\n\"Virgílio, durante toda a nossa conversa eu percebi uma característica muito forte no senhor. O senhor passou anos construindo esse patrimônio, imóvel por imóvel. Nada aconteceu por acaso. A decisão de fazer o Croqui Estrutural segue exatamente essa mesma lógica. O Croqui não é um compromisso com a execução da holding. É a etapa em que nós transformamos tudo o que conversamos hoje em um projeto concreto, com números, cenários e segurança para que o senhor tome uma decisão definitiva conhecendo exatamente os impactos para a sua família.\"\nAção: FICAR CALADO até que o cliente pergunte o preço."
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_11",
      "titulo": "Preço e Incentivo do Resolvedor",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado: \"O preço padrão para a elaboração deste estudo é de R$ 7.200,00. \"Mas o senhor participou do seminário.\"\nSilêncio.\n\"Chegou até a Sessão de Viabilidade.\"\nSilêncio.\n\"E nós já realizamos praticamente toda a etapa de diagnóstico hoje.\"Agora.\n\"Como boa parte desse trabalho já foi feita nesta reunião, conseguimos aproveitar todo esse material imediatamente.\"\nSó agora.\n\"Por isso existe uma condição diferenciada para quem decide dar continuidade enquanto esse diagnóstico ainda está íntegro.\"\n\nPorém, como eu gravei nossa sessão e as informações estão frescas, eu economizo tempo de equipe se eu começar agora. Por isso, para quem decide aqui na reunião – o que chamo de Incentivo do Resolvedor \"No seminário eu falei sobre dois perfis.\"\nPausa.\n\"O procrastinador.\"\nPausa.\n\"E o resolvedor.\"\nDepois.\n\"O resolvedor não é quem compra por impulso.\"\nEssa frase é importantíssima.\nContinue.\n\"É quem toma uma decisão depois de compreender completamente o cenário.\"\nDepois.\n\"E é exatamente por isso que essa condição existe.\"\"Essa condição está vinculada ao trabalho que realizamos hoje.\"\nDepois.\n\"Se o senhor decidir daqui a algumas semanas, nós precisaremos retomar parte do diagnóstico, revalidar informações e reorganizar toda a agenda técnica.\"\"Como o senhor participou do seminário e nós realizamos praticamente todo o diagnóstico nesta reunião, existe uma condição diferenciada.\"\"Nesse caso, o investimento passa para R$ 4.500.\"\"Essa condição está vinculada ao diagnóstico que fizemos hoje. Como todas as informações estão frescas, minha equipe consegue iniciar imediatamente o estudo sem precisar refazer etapas. Por isso ela é válida apenas para quem decide prosseguir ainda hoje.\"\n\n– o valor fica por R$ 4.500,00. Além disso, o que você já pagou hoje e o valor do croqui serão integralmente abatidos dos honorários finais da Holding.\"."
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_12",
      "titulo": "Finalização Binária",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Ação: FICAR CALADO e aceitar apenas \"Sim\" ou \"Não\".\nSe SIM: Dar os parabéns por ser um \"Resolvedor\" e passar para a assistente para o link de pagamento (válido para o dia). Solicitar o envio das informações de IR, principalmente do imóvel.\nSe NÃO: Dizer que entende o momento, reforçar que o primeiro passo foi dado, mas jamais dizer que está \"à disposição para quando ele precisar\"."
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    }
  ]
}$rot2$::jsonb, false,
 'Transcrito da seção "TESTE" do arquivo-fonte (mesma PARTE 00/01 do Guia 1; diverge a partir da PARTE 02). BLOQUEIO B15.'),
('sessao_viabilidade', 3, 'Script de Fechamento de Croqui — Guia "Teste 2"',
 $rot3${
  "blocos": [
    {
      "id": "parte_00",
      "titulo": "Check-in e Profissionalismo",
      "objetivo": "Transmitir profissionalismo e preservar a agenda do especialista.",
      "acao": "Um assistente da equipe abre a sala do Zoom antes do advogado para realizar o setup técnico.",
      "falas": [],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_01",
      "titulo": "Assumir o Controle (A Busca pelos 4 SIMs)",
      "objetivo": "Abertura da sessão: obter os 4 SIMs antes de prosseguir para o diagnóstico.",
      "acao": null,
      "falas": [
        {
          "id": "intro",
          "locutor": "advogado",
          "texto": "Antes de iniciarmos, preciso alinhar quatro pontos fundamentais com você:"
        },
        {
          "id": "sigilo_gravacao",
          "locutor": "advogado",
          "texto": "Tudo o que tratarmos aqui é absolutamente sigiloso. Eu vou gravar esta sessão para que minha equipe possa analisar cada detalhe do seu caso depois, sem que eu precise te pedir para repetir nada. Você se sente à vontade para falar abertamente sobre seus desejos e seu patrimônio? (1º SIM)",
          "sim": "sigilo_gravacao",
          "rotulo_sim": "1º SIM — Sigilo e Gravação"
        },
        {
          "id": "licitude",
          "locutor": "advogado",
          "texto": "Integro um time nacional com um código de ética rígido. Nosso sistema é poderoso e só o aplicamos a patrimônios de origem lícita.E apenas para confirmarmos a certeza que já temos iremos reforçar e preciso apenas da sua confirmação:  Seus bens têm origem legal e você NÃO busca este sistema para ocultar crimes, certo? (2º SIM)",
          "sim": "licitude",
          "rotulo_sim": "2º SIM — Ética e Licitude"
        },
        {
          "id": "decisores",
          "locutor": "advogado",
          "texto": "Para que este diagnóstico seja eficaz, é indispensável que todos os que decidem sobre os bens da família estejam presentes. Todos os responsáveis estão aqui agora e podemos prosseguir? (3º SIM)",
          "sim": "decisores",
          "rotulo_sim": "3º SIM — Presença dos Decisores"
        },
        {
          "id": "proximo_passo_contexto",
          "locutor": "advogado",
          "texto": "Se eu identificar que o sistema é viável para você, o nosso próximo passo após esta Sessão de Viabilidade será a contratação para elaboração do Croqui Estrutural. Ele funciona como uma 'planta baixa' personalizada da sua Holding. É nessa nova contratação, nesse estudo profundo que você terá a visão do sistema pronto, os cenários possíveis para seu planejamento patrimonial, o comando dos bens e o orçamento exato de custos e impostos, para que não haja surpresas na execução."
        },
        {
          "id": "proximo_passo",
          "locutor": "advogado",
          "texto": "Ao final desta conversa, eu te direi se devemos ou não prosseguir para esse estudo técnico. O meu objetivo é que, ao sair daqui hoje, você tenha condições de tomar a decisão mais assertiva para proteger sua família. Compreendeu como vamos trabalhar? Podemos prosseguir? (4º SIM).",
          "sim": "proximo_passo",
          "rotulo_sim": "4º SIM — Decisão Assertiva"
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_02",
      "titulo": "A Motivação do Cliente",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado: \"Me conte, o que te motivou a estar hoje aqui comigo? Por que você deseja ter uma Holding Familiar?\".\n\nantes de falarmos sobre patrimônio, imóveis ou empresas, eu gosto de conhecer um pouco a história da família.\n\nAo longo dos anos eu percebi que duas famílias podem ter patrimônios muito parecidos e, ainda assim, precisarem de estruturas completamente diferentes.\n\nPor isso eu sempre começo entendendo as pessoas.\"\n\n\"Quando nossa equipe conversou com a senhora, uma informação me chamou bastante atenção.\n\nA senhora comentou que já buscou orientação com alguns profissionais, mas que ainda não encontrou um sistema que lhe transmitisse clareza sobre qual caminho seguir.\n\nPosso lhe perguntar uma curiosidade?\"\n\n(Aguardar a resposta.)\n\n\"O que a senhora ouviu até hoje que fez pensar: 'isso ainda não resolveu exatamente o que eu procuro'?\"\n\n(Ouvir. Não interromper.)\n\n\"Se, ao final da nossa conversa de hoje, a senhora saísse daqui com absoluta clareza sobre qual é o melhor caminho para proteger o patrimônio da sua família, a senhora sentiria que esta reunião cumpriu o seu papel?\"\n\n(Ouvir.)\n\n\"Agora eu gostaria de conhecer um pouquinho da família da senhora.\n\nPorque toda estrutura patrimonial acompanha uma estrutura familiar.\"\n\n\"Me conta um pouquinho da sua família.\"\n\n(Deixar a cliente contar a história espontaneamente.)\n\nConforme a resposta, aprofundar naturalmente:\n\n\"Seus filhos já constituíram família?\"\n\n\"A senhora já tem netos?\"\n\n\"Hoje cada um segue sua própria atividade ou alguns participam dos negócios da família?\"\n\n\"Esse sempre foi um assunto tratado com naturalidade entre vocês ou começou a ganhar importância mais recentemente?\"\n\n\"Existe alguma preocupação que hoje seja prioridade quando a senhora pensa no futuro da família?\"\n\n(Ouvir.)\n\n\"Se conseguíssemos resolver apenas uma preocupação nesta estrutura, qual seria a mais importante para a senhora?\"\n\n(Somente depois seguir para a parte patrimonial.)"
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_03",
      "titulo": "Radiografia Familiar e Patrimonial (SEJA EMPÁTICO E BUSQUE MAIS QUE INFORMAÇÕES CADASTRAIS)",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "A Família: Questionar sobre filhos (maiores ou menores), regimes de casamento de todos os envolvidos, ocupações e idades.\nO Patrimônio: Levantar a lista de bens, valores de mercado, valores de aquisição, datas, formas de pagamento e a relação pessoal do cliente com cada bem.\nCapacidade Econômica: Identificar quem paga as contas hoje e quais são as reservas financeiras disponíveis.\n\nAgora que eu conheço um pouco melhor a família da senhora, gostaria de entender como esse patrimônio foi sendo construído ao longo da vida.\"\n\n(Permitir que a cliente conte sua trajetória.)\n\n\"A senhora sempre atuou como empresária?\"\n\n\"Esse patrimônio foi sendo formado principalmente pela atividade empresarial ou os investimentos e imóveis foram surgindo ao longo dessa caminhada?\"\n\n\"Quando a senhora olha para tudo o que construiu, existe algum patrimônio que tenha um significado especial além do valor financeiro?\"\n\n(Explorar a resposta.)\n\n\"Imagino que administrar um patrimônio como esse exija bastante organização.\n\nComo a senhora costuma acompanhar tudo isso hoje?\"\n\n(Observar naturalmente como o patrimônio é administrado, sem perguntar quem decide.)\n\n\"Agora eu gostaria apenas de entender como esse patrimônio está distribuído atualmente.\n\nPelo formulário eu vi que estamos falando de imóveis, investimentos e participações em empresas.\n\nVamos percorrer juntos essa estrutura para que eu consiga compreender exatamente como ela está organizada hoje.\"\n\n(Somente neste momento iniciar o levantamento técnico dos bens.)\n\nDurante o levantamento, explorar naturalmente pontos relevantes:\n\norigem dos imóveis;\nempresas existentes;\ninvestimentos;\nforma de aquisição;\nbens de maior valor;\npatrimônio adquirido antes ou depois do casamento;\nexistência de bens compartilhados;\npatrimônio localizado fora do Estado ou do País.\n\nEvite transformar esta etapa em um checklist.\n\nSempre que possível, conduza a conversa como uma continuação natural da história que a cliente começou a contar.\n\nAntes de avançar para a Parte 04, faça um breve resumo:\n\n\"Terezinha, então, pelo que compreendi até aqui, a senhora construiu esse patrimônio principalmente através de ____________. Hoje a estrutura da família é ____________, e a principal preocupação da senhora é ____________.\n\nEstá correto ou a senhora acrescentaria alguma coisa?\"\n\nSomente após essa validação seguir para a Fase do Desconforto."
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_04",
      "titulo": "A Fase do Desconforto (Infligir Dor)",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado:\n\"Você tem ideia de quanto seus filhos teriam que gastar para serem donos do que você construiu? (Custo do Inventário)\".\n\"Você tem uma reserva financeira ou seguro de vida específico só para pagar o governo e advogados no inventário?\".\n\"Você está ciente de que a reforma tributária vai aumentar drasticamente o ITCMD?\".\nagora que eu compreendi a realidade da sua família e do patrimônio que a senhora construiu ao longo da vida, eu gostaria de fazer algumas reflexões junto com a senhora.\"\n\n\"Se absolutamente nada fosse feito a partir de hoje, como a senhora imagina que esse patrimônio chegaria aos seus filhos?\"\n\n(Ouvir.)\n\n\"A senhora acredita que esse processo aconteceria exatamente da forma como a senhora gostaria?\"\n\n(Ouvir.)\n\n\"Existe alguma situação que a senhora gostaria de evitar para a sua família nesse momento?\"\n\n(Ouvir.)\n\n\"Quando pensa nesse patrimônio, o que lhe preocupa mais: o custo financeiro, a burocracia ou a possibilidade de a família enfrentar dificuldades para colocar em prática aquilo que é a sua vontade?\"\n\n(Explorar a resposta.)\n\n\"A senhora já teve a oportunidade de acompanhar algum inventário de pessoas próximas?\"\n\nSe SIM:\n\n\"Como foi essa experiência?\"\n\nSe NÃO:\n\n\"É exatamente por isso que gosto de fazer essas reflexões antes de falarmos da solução.\"\n\n\"Independentemente do valor envolvido, a senhora considera importante que seus filhos tenham tranquilidade para cumprir a sua vontade?\"\n\n(Ouvir.)\n\nSomente após essa reflexão, apresentar de forma objetiva os principais impactos do inventário, relacionando-os diretamente à realidade da família."
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_05",
      "titulo": "O Desejo de Futuro",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado: \"Como você gostaria de deixar organizado o patrimônio para seus filhos? Você acredita que evitar o inventário e possíveis brigas por dinheiro seria um benefício para a harmonia da sua família?\".\nAgora vamos imaginar o cenário ideal.\"\n\n\"Daqui a muitos anos, quando esse patrimônio precisar ser transmitido, como a senhora gostaria que tudo acontecesse?\"\n\n(Ouvir.)\n\n\"O que faria a senhora sentir que deixou tudo verdadeiramente organizado?\"\n\n(Ouvir.)\n\n\"Quando seus filhos olharem para essa decisão no futuro, o que a senhora gostaria que eles pensassem?\"\n\n(Ouvir.)\n\n\"E se fosse possível proporcionar essa tranquilidade para a família ainda em vida, isso faria sentido para a senhora?\"\n\n(Ouvir.)"
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_06",
      "titulo": "Por que este Profissional?",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado: \"Existem outros profissionais no mercado, inclusive da sua confiança. O que te impede de fazer sua Holding com eles e por que você prefere fazer conosco?\".\nntes da nossa reunião a senhora comentou que já havia buscado outras orientações.\"\n\n\"Depois da nossa conversa de hoje, existe algum ponto que tenha ficado mais claro para a senhora em relação ao planejamento patrimonial da família?\"\n(Ouvir.)\n\n\"Na sua percepção, o que a senhora encontrou nesta conversa que ainda não havia encontrado nas anteriores?\"\n(Ouvir.)\n\n\"Fico feliz em ouvir isso.\nO meu objetivo nunca é convencer uma família a fazer uma Holding.\nÉ ajudá-la a compreender qual estrutura realmente faz sentido para a realidade dela.\""
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_07",
      "titulo": "Compromisso e Agilidade",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado: \"Diante do cenário atual do país e do risco de aumento de impostos, você sente que essa proteção é algo que te motiva a agir rápido para não deixar o futuro da sua família para depois?\".\nexiste uma última reflexão que sempre faço com as famílias.\"\n\n\"Se essa decisão fosse adiada por um ou dois anos, o que poderia mudar na realidade da família?\"\n(Ouvir.)\n\n\"E existe algum benefício em esperar para tomar essa decisão?\"\n(Ouvir.)\n\n\"A senhora sente que hoje já possui informações suficientes para começar a organizar esse patrimônio com segurança?\""
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_08",
      "titulo": "Autorização para Ajudar",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado: \"Restou alguma dúvida sobre o que conversamos até aqui? (Não tire dúvidas técnicas agora; remeta ao croqui). Após ouvir tudo isso, eu estou muito feliz: eu consigo ajudar sua família e sei exatamente como fazer.\".\nAntes de eu apresentar o meu diagnóstico, existe alguma preocupação importante que ainda não conversamos e que a senhora gostaria que eu conhecesse?\"\n(Ouvir.)\n\n\"Perfeito.\"\n\n\"Pelo que conversamos ao longo desta reunião, eu compreendi a história da construção do patrimônio da sua família, os objetivos que a senhora deseja alcançar e aquilo que considera mais importante proteger.\"\n\n\"Com base em tudo isso, eu posso dizer com bastante segurança que consigo ajudar a sua família.\"\n\n\"E justamente por compreender que cada patrimônio possui uma história diferente, eu não gosto de trabalhar com soluções padronizadas.\"\n\n\"A minha responsabilidade agora é recomendar o caminho que considero tecnicamente mais adequado para que a vontade da senhora seja respeitada e para que a estrutura seja construída com segurança.\"\n\n(A partir deste momento seguir para o Posicionamento de Expert e, posteriormente, para a apresentação do Croqui Estrutural.)"
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_09",
      "titulo": "Posicionamento de Expert",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado: \"Minha especialidade é o Planejamento Patrimonial. Eu ajudo os pais a praticarem um ato de amor para que seus filhos não precisem de advogados em um momento de horror (inventário). Minha expertise é usar a Holding como ferramenta para isso.\".\nantes de eu apresentar o meu diagnóstico, eu gostaria apenas de conferir se compreendi corretamente tudo o que conversamos.\"\n(Falar pausadamente.)\n\"Pelo que eu compreendi hoje...\nA senhora construiu um patrimônio muito importante ao longo da vida.\nEsse patrimônio foi fruto de muitos anos de trabalho, organização e boas decisões.\nAo longo desse caminho, a senhora já buscou orientação jurídica, conheceu possibilidades como testamento, doação e outras estruturas, mas ainda não encontrou uma forma prática que lhe desse segurança sobre qual caminho seguir.\nHoje, a sua maior preocupação não é apenas o patrimônio.\nÉ garantir que tudo aquilo que a senhora construiu seja organizado da maneira que considera correta, respeitando a sua vontade e preservando a tranquilidade da sua família.\"\n(Olhar para a cliente.)\n\"Foi isso que a senhora quis me transmitir durante a nossa conversa ou existe alguma coisa importante que eu deixei de compreender?\"\n(Silêncio.)\nApós a confirmação:\n\"Perfeito.\nEntão agora eu consigo lhe dar o meu diagnóstico.\""
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_10",
      "titulo": "A Oferta do Croqui Estrutural",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado: \"O diagnóstico para sua família é positivo. O próximo passo é a contratação do Croqui Estrutural. Ele é como uma planta baixa onde você verá os cenários possíveis, a distribuição dos bens, o comando de tudo e, principalmente, um orçamento detalhado e sem surpresas. O que eu preciso de você agora é a decisão de contratar esse 'desenho'.\".\nAção: FICAR CALADO até que o cliente pergunte o preço.\nnalisando toda a realidade da sua família, o meu diagnóstico é positivo.\nEu entendo que a sua família pode ser beneficiada por um planejamento patrimonial estruturado.\nMas existe um ponto muito importante.\nSeria uma enorme irresponsabilidade da minha parte dizer hoje exatamente qual estrutura deverá ser utilizada.\"\n(Pausa.)\n\"Por quê?\nPorque nós identificamos vários elementos importantes:\nexistem imóveis;\nexistem investimentos;\nexistem participações societárias;\nexistem diferentes possibilidades jurídicas;\ne cada decisão influencia diretamente as demais.\"\n(Pausa.)\n\"É justamente por isso que nenhuma estrutura séria pode ser construída durante uma única reunião.\"\n\n\"O próximo passo passa a ser um estudo técnico aprofundado.\nÉ exatamente esse estudo que chamamos de Croqui Estrutural.\"\n\n\"E gosto de dizer que ele funciona como o projeto de uma construção.\nNinguém começa uma obra importante sem antes elaborar o projeto.\nCom o Planejamento Patrimonial acontece exatamente a mesma coisa.\"\n\n\"No Croqui Estrutural a senhora visualizará, antes de qualquer execução:\n• todos os cenários possíveis;\n• as vantagens e limitações de cada estrutura;\n• quem exercerá cada função dentro da organização familiar;\n• quais bens integrarão cada etapa;\n• quais impactos tributários existirão;\n• quais custos estarão envolvidos;\n• e somente depois disso será tomada qualquer decisão de execução.\"\n\n\"Perceba que, neste momento, eu ainda não estou lhe vendendo uma Holding.\nEstou recomendando que a senhora conheça, com profundidade técnica, qual é a melhor estrutura para a realidade da sua família.\""
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_11",
      "titulo": "Preço e Incentivo do Resolvedor",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado: \"O preço padrão para a elaboração deste estudo é de R$ 7.200,00. Porém, como eu gravei nossa sessão e as informações estão frescas, eu economizo tempo de equipe se eu começar agora. Por isso, para quem decide aqui na reunião – o que chamo de Incentivo do Resolvedor – o valor fica por R$ 4.500,00. Além disso, o que você já pagou hoje e o valor do croqui serão integralmente abatidos dos honorários finais da Holding.\".\ncomo o diagnóstico foi positivo, eu posso encaminhar a sua família para essa próxima etapa.\"\n(Pausa.)\n\"O investimento para elaboração do Croqui Estrutural é de R$ 7.200,00.\"\n(Pausa curta.)\n\"Entretanto, existe uma condição que adotamos exclusivamente para as famílias que participaram do Seminário e decidem dar continuidade imediatamente após a Sessão de Viabilidade.\"\n\n\"O motivo é bastante simples.\nHoje toda a realidade da sua família foi estudada.\nAs informações estão organizadas.\nAs gravações serão utilizadas pela equipe técnica.\nNós conseguimos iniciar imediatamente esse estudo sem precisar repetir todo esse trabalho nas próximas semanas.\"\n\n\"Por essa razão, o investimento para a senhora fica em R$ 4.500,00.\"\n\n\"E existe outro ponto importante.\"\n\n\"Tudo aquilo que a senhora investe hoje na Sessão de Viabilidade e no Croqui Estrutural será integralmente aproveitado quando iniciarmos a execução da Holding Familiar.\nOu seja, essas etapas fazem parte da construção do projeto da sua família.\"\n\n(Olhar para a cliente.)\n\"Eu acredito que a sua família está pronta para dar esse próximo passo.\"\n\n\"Vamos iniciar a elaboração do Croqui Estrutural?\""
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_12",
      "titulo": "Finalização Binária",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Ação: FICAR CALADO e aceitar apenas \"Sim\" ou \"Não\".\nSe SIM: Dar os parabéns por ser um \"Resolvedor\" e passar para a assistente para o link de pagamento (válido para o dia). Solicitar o envio das informações de IR, principalmente do imóvel.\nSe NÃO: Dizer que entende o momento, reforçar que o primeiro passo foi dado, mas jamais dizer que está \"à disposição para quando ele precisar\"."
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    }
  ]
}$rot3$::jsonb, false,
 'Transcrito da seção "Teste 2" do arquivo-fonte. BLOQUEIO B15.'),
('sessao_viabilidade', 4, 'Script de Fechamento de Croqui — Guia "Teste 3"',
 $rot4${
  "blocos": [
    {
      "id": "parte_00",
      "titulo": "Check-in e Profissionalismo",
      "objetivo": "Transmitir profissionalismo e preservar a agenda do especialista.",
      "acao": "Um assistente da equipe abre a sala do Zoom antes do advogado para realizar o setup técnico.",
      "falas": [],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_01",
      "titulo": "Assumir o Controle (A Busca pelos 4 SIMs)",
      "objetivo": "Abertura da sessão: obter os 4 SIMs antes de prosseguir para o diagnóstico.",
      "acao": null,
      "falas": [
        {
          "id": "intro",
          "locutor": "advogado",
          "texto": "Antes de iniciarmos, preciso alinhar quatro pontos fundamentais com você:"
        },
        {
          "id": "sigilo_gravacao",
          "locutor": "advogado",
          "texto": "Tudo o que tratarmos aqui é absolutamente sigiloso. Eu vou gravar esta sessão para que minha equipe possa analisar cada detalhe do seu caso depois, sem que eu precise te pedir para repetir nada. Você se sente à vontade para falar abertamente sobre seus desejos e seu patrimônio? (1º SIM)",
          "sim": "sigilo_gravacao",
          "rotulo_sim": "1º SIM — Sigilo e Gravação"
        },
        {
          "id": "licitude",
          "locutor": "advogado",
          "texto": "Integro um time nacional com um código de ética rígido. Nosso sistema é poderoso e só o aplicamos a patrimônios de origem lícita.E apenas para confirmarmos a certeza que já temos iremos reforçar e preciso apenas da sua confirmação:  Seus bens têm origem legal e você NÃO busca este sistema para ocultar crimes, certo? (2º SIM)",
          "sim": "licitude",
          "rotulo_sim": "2º SIM — Ética e Licitude"
        },
        {
          "id": "decisores",
          "locutor": "advogado",
          "texto": "Para que este diagnóstico seja eficaz, é indispensável que todos os que decidem sobre os bens da família estejam presentes. Todos os responsáveis estão aqui agora e podemos prosseguir? (3º SIM)",
          "sim": "decisores",
          "rotulo_sim": "3º SIM — Presença dos Decisores"
        },
        {
          "id": "proximo_passo_contexto",
          "locutor": "advogado",
          "texto": "Se eu identificar que o sistema é viável para você, o nosso próximo passo após esta Sessão de Viabilidade será a contratação para elaboração do Croqui Estrutural. Ele funciona como uma 'planta baixa' personalizada da sua Holding. É nessa nova contratação, nesse estudo profundo que você terá a visão do sistema pronto, os cenários possíveis para seu planejamento patrimonial, o comando dos bens e o orçamento exato de custos e impostos, para que não haja surpresas na execução."
        },
        {
          "id": "proximo_passo",
          "locutor": "advogado",
          "texto": "Ao final desta conversa, eu te direi se devemos ou não prosseguir para esse estudo técnico. O meu objetivo é que, ao sair daqui hoje, você tenha condições de tomar a decisão mais assertiva para proteger sua família. Compreendeu como vamos trabalhar? Podemos prosseguir? (4º SIM).",
          "sim": "proximo_passo",
          "rotulo_sim": "4º SIM — Decisão Assertiva"
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_02",
      "titulo": "A Motivação do Cliente",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado: \"Me conte, o que te motivou a estar hoje aqui comigo? Por que você deseja ter uma Holding Familiar?\".\"Eliana, antes de falarmos sobre patrimônio, imóveis ou investimentos, eu gosto de conhecer um pouco da história da família.\n\nAo longo dos anos eu percebi que duas famílias podem ter patrimônios muito parecidos e, ainda assim, precisarem de estruturas completamente diferentes.\n\nIsso acontece porque nenhuma estrutura patrimonial é mais importante do que as pessoas que ela pretende proteger.\n\nPor isso eu sempre começo entendendo a família.\"\n\n\"Posso lhe fazer uma curiosidade?\"\n\n(Aguardar a resposta.)\n\n\"O que fez a senhora decidir agendar esta conversa justamente agora?\"\n\n(Ouvir. Não interromper. Permitir que a cliente conte sua história.)\n\nApós a resposta:\n\n\"Foi algum fato específico que despertou essa preocupação ou esse assunto já vinha amadurecendo há algum tempo?\"\n\n(Ouvir.)\n\n\"Vi que a senhora convidou sua irmã para participar desta reunião. Como surgiu essa decisão?\"\n\n(Ouvir e observar a dinâmica familiar.)\n\n\"Agora eu gostaria de conhecer um pouquinho da família da senhora, porque toda estrutura patrimonial acompanha uma estrutura familiar.\"\n\n\"Me conta um pouco da sua família.\"\n\n(Permitir que a cliente conte livremente. Não interromper.)Perfeito.\n\nAgora que eu já conheço um pouco melhor a história da sua família e aquilo que é mais importante para a senhora, eu gostaria de entender como esse patrimônio foi sendo construído ao longo da vida.\n\nPorque é justamente essa história que vai me ajudar a identificar qual estrutura faz mais sentido para a realidade da sua família.\""
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_03",
      "titulo": "Radiografia Familiar e Patrimonial (SEJA EMPÁTICO E BUSQUE MAIS QUE INFORMAÇÕES CADASTRAIS)",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "A Família: Questionar sobre filhos (maiores ou menores), regimes de casamento de todos os envolvidos, ocupações e idades.\nO Patrimônio: Levantar a lista de bens, valores de mercado, valores de aquisição, datas, formas de pagamento e a relação pessoal do cliente com cada bem.\nCapacidade Econômica: Identificar quem paga as contas hoje e quais são as reservas financeiras disponíveis.\n\nAgora que eu conheço um pouco melhor a história da sua família, eu gostaria de entender como esse patrimônio foi sendo construído ao longo da vida.\"\n\n(Permitir que o cliente conte sua trajetória. Não interromper.)\n\nApós a resposta:\n\n\"Esse patrimônio foi sendo construído principalmente através da sua atividade profissional ou houve outros acontecimentos importantes ao longo dessa caminhada?\"\n\n(Ouvir.)\n\n\"Quando a senhora olha para tudo aquilo que construiu, existe algum patrimônio que tenha um significado especial além do valor financeiro?\"\n\n(Ouvir.)\n\n**\"Imagino que um patrimônio construído ao longo de tantos anos exija bastante organização.\n\nComo a senhora costuma acompanhar tudo isso hoje?\"**\n\n(Ouvir.)\n\n\"Agora eu gostaria apenas de compreender como esse patrimônio está organizado atualmente.\"\n\n**\"Pelo formulário eu vi que a senhora possui imóveis e investimentos.\n\nVamos percorrer essa estrutura juntos para que eu consiga compreender exatamente como ela está organizada hoje.\"**\n\nDurante o levantamento patrimonial\n\nConduza a conversa naturalmente.\n\nEvite transformar esta etapa em um checklist.\n\nProcure compreender:\n\nQuantos imóveis existem?\nEstão em nome da pessoa física ou jurídica?\nExistem aplicações financeiras?\nExiste previdência privada?\nExistem participações societárias?\nExiste patrimônio localizado fora do Brasil?\nExistem bens adquiridos antes ou depois do casamento?\nExistem bens compartilhados com outras pessoas?\nExiste algum bem que ainda gere dúvidas quanto à melhor forma de organização?\n\nSempre que possível, pergunte:\n\n\"Como surgiu esse patrimônio?\"\n\nAo invés de apenas:\n\n\"Quanto vale?\"\n\nCapacidade financeira\n\nDepois do patrimônio levantado:\n\n\"Hoje esse patrimônio gera renda suficiente para manter o padrão de vida da senhora ou ainda depende principalmente de outras fontes de receita?\"\n\n(Ouvir.)\n\nSe houver filhos ou familiares envolvidos:\n\n\"Eles já participam de alguma forma da administração ou hoje essa organização permanece concentrada na senhora?\"\n\n(Ouvir sem aprofundar em questões de comando.)\"Deixa eu conferir se eu compreendi corretamente tudo o que conversamos até aqui.\"\n\n\"Pelo que eu entendi...\n\nA senhora construiu esse patrimônio principalmente através de __________________________.\n\nHoje a estrutura da família é formada por __________________________.\n\nEsse patrimônio está organizado da seguinte maneira __________________________.\n\nE a principal preocupação da senhora hoje é __________________________.\"\n\n\"Foi isso que a senhora quis me transmitir ou existe alguma informação importante que eu deixei de compreender?\""
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_04",
      "titulo": "A Fase do Desconforto (Infligir Dor)",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado:\n\"Você tem ideia de quanto seus filhos teriam que gastar para serem donos do que você construiu? (Custo do Inventário)\".\n\"Você tem uma reserva financeira ou seguro de vida específico só para pagar o governo e advogados no inventário?\".\n\"Você está ciente de que a reforma tributária vai aumentar drasticamente o ITCMD?\".\n\n\"Eliana, agora que eu consegui compreender a história da sua família e a forma como esse patrimônio foi sendo construído, eu gostaria de fazer algumas reflexões com a senhora.\"\n\n\"Se absolutamente nada fosse feito a partir de hoje, como a senhora imagina que esse patrimônio chegaria às pessoas que a senhora deseja proteger?\"\n\n(Ouvir. Não interromper.)\n\n\"A senhora acredita que esse processo aconteceria exatamente da forma como gostaria?\"\n\n(Ouvir.)\n\n\"Existe alguma situação que a senhora gostaria que sua família nunca precisasse enfrentar?\"\n\n(Ouvir.)\n\nSe responder.\n\nAprofundar.\n\n\"O que mais preocupa a senhora quando pensa nessa possibilidade?\"\n\n(Ouvir.)\n\n**\"Quando a senhora pensa nesse patrimônio, o que hoje pesa mais no seu coração?\n\nA burocracia?\n\nOs custos?\n\nOu o receio de que a sua vontade não seja cumprida exatamente como imaginou?\"**\n\n(Ouvir.)\n\n\"A senhora já acompanhou algum inventário de alguém da família ou de pessoas próximas?\"\n\nSe SIM.\n\n\"Como foi essa experiência?\"\n\n(Ouvir.)\n\nSe NÃO.\n\n\"É justamente por isso que eu gosto de fazer essa reflexão antes de falar sobre qualquer solução.\"\n\nDepois.\n\n\"Independentemente dos valores envolvidos, a senhora considera importante que sua família consiga cumprir a sua vontade com tranquilidade?\"\n\n(Ouvir.)\"Quando a senhora comentou que a sua maior preocupação era ________________________, é justamente nesse ponto que normalmente o inventário acaba gerando maiores dificuldades.\"\n\nNunca faça uma explicação genérica.\n\nSempre personalize.\n\nEncerramento\n\n\"Tudo o que conversamos até aqui reforça uma percepção que eu comecei a construir desde o início da nossa conversa.\n\nO patrimônio da senhora não representa apenas bens.\n\nEle representa uma história construída ao longo de muitos anos.\n\nE é justamente por isso que a forma como ele será organizado daqui para frente merece o mesmo cuidado que existiu para construí-lo.\""
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_05",
      "titulo": "O Desejo de Futuro",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado: \"Como você gostaria de deixar organizado o patrimônio para seus filhos? Você acredita que evitar o inventário e possíveis brigas por dinheiro seria um benefício para a harmonia da sua família?\".\n\n\"Agora eu gostaria de fazer um exercício de imaginação com a senhora.\"\n\n(Pausa.)\n\n\"Vamos imaginar que muitos anos se passaram.\n\nE que tudo aquilo que a senhora construiu precise chegar às pessoas que ama.\"\n\n\"Se a senhora pudesse escrever exatamente como gostaria que esse momento acontecesse, como ele seria?\"\n\n(Ouvir. Não interromper.)\n\nApós a resposta.\n\n\"O que faria a senhora sentir que deixou tudo realmente organizado?\"\n\n(Ouvir.)\n\n\"Quando seus familiares olharem para essa decisão no futuro, o que a senhora gostaria que eles pensassem sobre essa organização?\"\n\n(Ouvir.)\n\n\"Existe alguma situação que a senhora gostaria que jamais acontecesse entre eles?\"\n\n(Ouvir.)\n\nSe responder.\n\nAprofundar.\n\n\"Por que isso é tão importante para a senhora?\"\n\n(Ouvir.)\n\n\"Se fosse possível organizar tudo isso ainda em vida, preservando a sua vontade e reduzindo ao máximo os riscos de conflitos e burocracias, isso faria sentido para a senhora?\"\n\n(Ouvir.)\n\nPonte para o Diagnóstico\n\n\"Perfeito.\n\nO mais importante é que, durante toda a nossa conversa, eu consegui compreender não apenas o patrimônio da senhora.\n\nEu consegui compreender aquilo que realmente deseja proteger.\n\nE isso faz toda a diferença na hora de recomendar uma estrutura patrimonial.\""
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_06",
      "titulo": "Por que este Profissional?",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado: \"Existem outros profissionais no mercado, inclusive da sua confiança. O que te impede de fazer sua Holding com eles e por que você prefere fazer conosco?\"."
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_07",
      "titulo": "Compromisso e Agilidade",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado: \"Diante do cenário atual do país e do risco de aumento de impostos, você sente que essa proteção é algo que te motiva a agir rápido para não deixar o futuro da sua família para depois?\"."
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_08",
      "titulo": "Autorização para Ajudar",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado: \"Restou alguma dúvida sobre o que conversamos até aqui? (Não tire dúvidas técnicas agora; remeta ao croqui). Após ouvir tudo isso, eu estou muito feliz: eu consigo ajudar sua família e sei exatamente como fazer.\"."
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_09",
      "titulo": "Posicionamento de Expert",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado: \"Minha especialidade é o Planejamento Patrimonial. Eu ajudo os pais a praticarem um ato de amor para que seus filhos não precisem de advogados em um momento de horror (inventário). Minha expertise é usar a Holding como ferramenta para isso.\".\"Eliana, antes de eu apresentar o meu diagnóstico, eu gostaria de lhe fazer uma última pergunta.\"\n\n(Pausa.)\n\n\"Quando a senhora decidiu agendar esta conversa, certamente existiam dúvidas e preocupações que motivaram essa decisão.\"\n\n(Pausa.)\n\n\"Depois de tudo o que conversamos até aqui, existe algum ponto que tenha ficado mais claro para a senhora?\"\n\n(Ouvir.)\n\nApós a resposta:\n\n\"Fico feliz em ouvir isso.\"\n\n\"Existe ainda alguma preocupação importante que a senhora gostaria que eu considerasse antes de apresentar a minha conclusão?\"\n\n(Ouvir.)\n\n**\"O meu compromisso hoje foi compreender muito mais a história da sua família do que simplesmente analisar patrimônio.\n\nPorque nenhuma estrutura jurídica faz sentido se ela não respeitar aquilo que cada família considera mais importante proteger.\"**\"Então deixe-me apenas confirmar se compreendi corretamente tudo o que conversamos.\"\n\n\"Pelo que eu compreendi hoje...\n\nA senhora construiu um patrimônio ao longo de muitos anos de trabalho.\n\nEsse patrimônio representa muito mais do que bens.\n\nRepresenta toda a história da sua família.\n\nAo longo desse caminho surgiram diferentes estruturas, diferentes possibilidades e diferentes orientações.\n\nMas a senhora ainda procurava alguém que analisasse tudo isso de forma integrada e lhe dissesse qual é o caminho que realmente faz sentido para a realidade da sua família.\n\nA principal preocupação da senhora hoje é garantir que tudo aquilo que construiu permaneça organizado, respeitando a sua vontade, protegendo sua família e evitando custos e dificuldades desnecessárias no futuro.\"\n\n\"Foi isso que a senhora quis me transmitir ou existe alguma informação importante que eu deixei de compreender?\"\n\"Eliana, depois de tudo o que conversamos hoje, eu já consigo lhe apresentar o meu diagnóstico.\"\n\n(Pausa.)\n\n\"Pela história da sua família, pela forma como a senhora construiu esse patrimônio e pelos objetivos que me apresentou ao longo da nossa conversa, eu entendo que a sua família tem um perfil muito adequado para realizar um Planejamento Patrimonial.\"\n\n\"Mas existe um ponto muito importante.\"\n\n(Pausa.)\n\n\"Seria uma enorme irresponsabilidade da minha parte dizer hoje que a solução da sua família é simplesmente criar uma Holding.\"\n\n(Pausa.)\n\n\"Porque uma Holding é apenas uma ferramenta jurídica.\n\nEla nunca deve ser o ponto de partida.\n\nEla deve ser a consequência de um planejamento bem feito.\"\n\n\"Antes de qualquer decisão, nós precisamos responder algumas perguntas muito importantes.\"\n\nQual patrimônio realmente deve integrar essa estrutura?\nExiste algum bem que seja melhor permanecer fora dela?\nComo essa estrutura deve ser organizada para respeitar exatamente a vontade da senhora?\nComo reduzir custos futuros sem criar novos problemas?\nComo garantir que tudo funcione também para as próximas gerações?\n\n\"Perceba que nenhuma dessas respostas pode ser dada com segurança durante uma única reunião.\"\n\n\"E é exatamente por isso que existe o Croqui Estrutural.\"\n\n\"A senhora começou esta reunião buscando uma resposta.\"\n\n(Utilizar exatamente as palavras da cliente.)\n\nExemplos:\n\n\"Quero proteger minha família.\"\n\n\"Quero saber qual é o melhor caminho.\"\n\n\"Quero entender se realmente vale a pena.\"\n\n\"E o Croqui foi criado justamente para responder essa pergunta.\"\n\n\"No Croqui Estrutural nós vamos desenvolver um estudo técnico totalmente personalizado para a realidade da sua família.\"\n\n\"Nele a senhora visualizará, antes de qualquer execução:\n\n• se a Holding realmente é a melhor solução;\n\n• como essa estrutura deverá funcionar;\n\n• quais bens deverão compor esse planejamento;\n\n• quais mecanismos de proteção serão utilizados;\n\n• quais impactos tributários existirão em cada alternativa;\n\n• quais custos estarão envolvidos em cada etapa;\n\n• e qual será o caminho mais seguro para implementar toda essa estrutura.\"\n\n\"Somente depois desse estudo técnico é que iniciamos a execução.\n\nPorque a nossa responsabilidade não é simplesmente constituir uma Holding.\n\nÉ construir a estrutura mais adequada para a realidade da sua família.\""
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_10",
      "titulo": "A Oferta do Croqui Estrutural",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado: \"O diagnóstico para sua família é positivo. O próximo passo é a contratação do Croqui Estrutural. Ele é como uma planta baixa onde você verá os cenários possíveis, a distribuição dos bens, o comando de tudo e, principalmente, um orçamento detalhado e sem surpresas. O que eu preciso de você agora é a decisão de contratar esse 'desenho'.\".\nAção: FICAR CALADO até que o cliente pergunte o preço.\nEliana...\n\nPosso lhe explicar rapidamente como funciona essa próxima etapa?\"\n\n(Aguardar o sim.)\n\n\"O Croqui Estrutural é, na prática, o projeto da organização patrimonial da sua família.\"\n\n\"Se hoje eu perguntasse para um arquiteto quanto custa construir uma casa, ele não conseguiria responder.\n\nPrimeiro ele precisaria elaborar o projeto.\n\nSó depois seria possível saber exatamente quanto vai custar construir.\"\n\n\"Na estrutura patrimonial acontece exatamente a mesma coisa.\"\n\n\"Hoje eu já consigo afirmar que sua família possui perfil para um Planejamento Patrimonial.\n\nMas eu ainda não consigo afirmar qual será exatamente a estrutura ideal.\n\nE eu jamais faria isso sem um estudo técnico.\"\n\n\"É exatamente para isso que existe o Croqui.\"\n\n\"No Croqui nós iremos desenvolver toda a engenharia patrimonial da sua família.\"\n\nO que a senhora receberá\n\n✔ Qual é a estrutura jurídica mais adequada.\n\n✔ Como ela funcionará.\n\n✔ Como ficará organizado cada patrimônio.\n\n✔ Quem exercerá cada função.\n\n✔ Como ficará a sucessão.\n\n✔ Quais mecanismos de proteção serão utilizados.\n\n✔ Quais impactos tributários existirão.\n\n✔ Quais custos existirão em cada etapa.\n\n✔ Quais documentos serão necessários.\n\n✔ Qual será o cronograma completo de implementação.\n\n\"Quando essa etapa termina...\n\nA senhora deixa de ter dúvidas.\n\nPassa a ter um projeto completo.\"\n\n\"E a partir desse projeto, a decisão de executar ou não a estrutura passa a ser muito mais segura.\"\n\n(Pausa.)\n\n\"Até aqui fez sentido para a senhora?\"\n\nEssa pergunta é extremamente importante.\n\nPorque ela cria um novo SIM.\n\nSe responder.\n\n\"Sim.\"\n\nSó agora seguimos.\n\n\"Quando o Croqui fica pronto, a senhora deixa de trabalhar com hipóteses.\n\nA senhora passa a ter um projeto completo.\n\nSabendo exatamente:\n\n• qual é a melhor estrutura;\n\n• como ela funcionará;\n\n• quanto custará implementá-la;\n\n• quais impostos existirão;\n\n• quais documentos serão necessários;\n\n• e principalmente... quais decisões devem ser tomadas e quais não devem.\"\n\n(Pausa.)\n\n\"É exatamente por isso que praticamente todas as famílias que chegam até essa etapa dizem que, pela primeira vez, conseguiram enxergar com clareza o patrimônio como um todo.\"\n\n(Pausa.)\n\nSilêncio.\n\nNão fale nada.\"Eliana... com tudo o que conversamos hoje, a senhora se sentiria segura para tomar todas essas decisões agora, ou acredita que ainda precisa enxergar esse cenário de forma organizada antes de decidir?\"\"É exatamente essa a finalidade do Croqui.\"Então ainda falta exatamente aquilo que viemos buscar hoje.\"\nSilêncio.\nEla perguntará.\n\"O quê?\"\nVocê.\n\"Um estudo que mostre qual desses caminhos faz sentido para a sua família.\""
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_11",
      "titulo": "Preço e Incentivo do Resolvedor",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Advogado: \"O preço padrão para a elaboração deste estudo é de R$ 7.200,00. Porém, como eu gravei nossa sessão e as informações estão frescas, eu economizo tempo de equipe se eu começar agora. Por isso, para quem decide aqui na reunião – o que chamo de Incentivo do Resolvedor – o valor fica por R$ 4.500,00. Além disso, o que você já pagou hoje e o valor do croqui serão integralmente abatidos dos honorários finais da Holding.\".\nEliana, então eu vou lhe explicar como funciona essa próxima etapa.\"\n\n\"O Croqui Estrutural é um estudo totalmente personalizado.\n\nEle não é um documento padrão.\n\nToda a equipe técnica trabalha exclusivamente sobre a realidade da sua família.\n\nPor isso, normalmente, o investimento para elaboração desse estudo é de R$ 7.200,00.\"\n\n(Pausa.)\n\n\"Mas existe uma condição que nós chamamos internamente de Condição dos Resolvedores.\"\n\n(Pausa.)\n\n\"Ela existe para as famílias que participaram do Seminário e que decidem dar continuidade ao trabalho no mesmo dia da Sessão de Viabilidade.\"\n\n\"E isso acontece por um motivo muito simples.\"\n\n\"Durante a nossa conversa de hoje eu conheci toda a história da sua família.\n\nCompreendi como esse patrimônio foi construído.\n\nEntendi quais são as suas preocupações.\n\nIdentifiquei os pontos que precisam ser analisados.\n\nE já começo, ainda hoje, a transmitir todas essas informações para a equipe técnica que desenvolverá o Croqui.\"\n\n\"Quando essa continuidade acontece imediatamente, nós não perdemos nenhuma informação importante.\n\nNão precisamos repetir entrevistas.\n\nNão precisamos recomeçar o diagnóstico.\n\nToda essa construção que fizemos hoje já segue diretamente para o desenvolvimento do estudo.\"\n\n\"Isso reduz etapas internas, otimiza o trabalho da equipe e permite que iniciemos imediatamente a elaboração do projeto da sua família.\"\n\n\"Por isso, para as famílias que tomam essa decisão ainda hoje, o investimento nesta etapa passa para R$ 4.500,00.\"\n\n(Pausa.)\n\n\"Essa condição existe exclusivamente porque o trabalho começa hoje.\"\n\n\"Se a continuidade não acontece hoje, infelizmente eu já não consigo garantir esse mesmo fluxo de trabalho, porque a equipe perde todo esse momento de construção que tivemos durante a Sessão de Viabilidade e o processo precisa ser reorganizado desde o início.\"\n\n(Olhar para o cliente.)\n\n\"Eu acredito que a sua família está pronta para dar esse próximo passo.\"\n\n\"Vamos iniciar hoje a elaboração do Croqui Estrutural?\"\n\nSilêncio."
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    },
    {
      "id": "parte_12",
      "titulo": "Finalização Binária",
      "objetivo": null,
      "acao": null,
      "falas": [
        {
          "id": "corpo",
          "locutor": "advogado",
          "texto": "Ação: FICAR CALADO e aceitar apenas \"Sim\" ou \"Não\".\nSe SIM: Dar os parabéns por ser um \"Resolvedor\" e passar para a assistente para o link de pagamento (válido para o dia). Solicitar o envio das informações de IR, principalmente do imóvel.\nSe NÃO: Dizer que entende o momento, reforçar que o primeiro passo foi dado, mas jamais dizer que está \"à disposição para quando ele precisar\"."
        }
      ],
      "campos": [],
      "observar": [],
      "proibido": []
    }
  ]
}$rot4$::jsonb, true,
 'Transcrito da seção "Teste 3" do arquivo-fonte — a mais extensa e a última do arquivo. ATIVA por padrão (critério do plano: "é a mais extensa e a última do arquivo"), NÃO por ter sido carimbada pela Dra. Elaine — ela não carimbou nenhuma. BLOQUEIO B15: a tela precisa mostrar o aviso.');

-- POP 03 / POP 03-B — transcritos de "sic-hf-brain/02 - Metodo/POPs.md".
-- Ambos entram ATIVOS: são as únicas versões que existem, e a trilha
-- 'preliminar' (POP 03-B) estava desenhada e desligada no schema — ativar o
-- roteiro é o que liga, sem migration de front.
insert into roteiros_versoes (chave, versao, titulo, definicao, ativo, notas) values
('pop_03', 1, 'Ligação Estratégica (POP 03)',
 $rotp3${
  "blocos": [
    {
      "id": "ligacao_03",
      "titulo": "Ligação Estratégica (POP 03)",
      "objetivo": "Ligação humana, sem finalidade comercial. O cliente nunca pode perceber que está sendo entrevistado.",
      "acao": null,
      "falas": [],
      "campos": [
        {
          "id": "p1",
          "rotulo": "Qual resposta o cliente espera encontrar na Sessão de Viabilidade? Se a resposta for superficial, aprofundar: \"por que isso é importante agora?\"",
          "tipo": "texto_longo"
        },
        {
          "id": "p2",
          "rotulo": "Que assunto do seminário o cliente comentou com a família?",
          "tipo": "texto_longo"
        },
        {
          "id": "p3",
          "rotulo": "O cliente prefere detalhe técnico primeiro ou aplicação prática primeiro?",
          "tipo": "texto_longo"
        },
        {
          "id": "p4",
          "rotulo": "A família decide na hora ou conversa antes de decidir?",
          "tipo": "texto_longo"
        },
        {
          "id": "p5",
          "rotulo": "Que assunto merece atenção especial da Dra. Elaine?",
          "tipo": "texto_longo"
        }
      ],
      "observar": [
        "ritmo da fala",
        "objetividade x detalhamento",
        "comportamentos observados (interrompe, pede confirmação, procura números, fala de custos/impostos, fala de família x patrimônio, menciona urgência, evita assunto)",
        "1 a 3 frases exatas do cliente",
        "expectativa principal",
        "preocupação percebida",
        "assunto prioritário",
        "pessoas citadas espontaneamente",
        "objeções percebidas"
      ],
      "proibido": [
        "parecer entrevista",
        "induzir resposta",
        "antecipar solução jurídica",
        "explicar ou defender holding",
        "calcular inventário",
        "falar preço do croqui",
        "classificar DISC durante a conversa",
        "demonstrar pressa"
      ]
    },
    {
      "id": "validacao",
      "titulo": "Validação da compreensão",
      "objetivo": "Fecha com validação da compreensão — resumo lido de volta e confirmado pelo cliente.",
      "acao": null,
      "falas": [],
      "campos": [],
      "observar": [],
      "proibido": []
    }
  ]
}$rotp3$::jsonb, true,
 'Transcrito de "POPs.md", seção "POP 03 — Ligação Estratégica". As 5 perguntas viram campos p1-p5; registro pós-ligação continua nas colunas dedicadas de ligacoes_estrategicas (0006), não duplicado aqui.'),
('pop_03b', 1, 'Reunião Preliminar de Diagnóstico (POP 03-B)',
 $rotp3b${
  "blocos": [
    {
      "id": "ligacao_03b",
      "titulo": "Reunião Preliminar de Diagnóstico (POP 03-B) — lead que não veio do seminário",
      "objetivo": "Mesmo formato do POP 03, aplicado a quem não passou pelo seminário. Perguntas diferentes.",
      "acao": null,
      "falas": [],
      "campos": [
        {
          "id": "p1",
          "rotulo": "Qual foi o gatilho da procura?",
          "tipo": "texto_longo"
        },
        {
          "id": "p2",
          "rotulo": "O que o cliente já pesquisou e o que ficou sem resposta?",
          "tipo": "texto_longo"
        },
        {
          "id": "p3",
          "rotulo": "Critério de valor da reunião: o que precisa ter ficado claro para valer a pena?",
          "tipo": "texto_longo"
        },
        {
          "id": "p4",
          "rotulo": "Como o cliente processa informação?",
          "tipo": "texto_longo"
        },
        {
          "id": "p5",
          "rotulo": "Processo decisório — influenciador, comunicador ou decisor conjunto? Essa pessoa participará da reunião?",
          "tipo": "texto_longo"
        }
      ],
      "observar": [
        "Sinais DISC por resposta",
        "D: problema/resultado/urgência/controle",
        "I: pessoas/histórias/entusiasmo",
        "S: família/segurança/prevenção",
        "C: impostos/legislação/custos/pesquisa/risco"
      ],
      "proibido": [
        "parecer entrevista",
        "induzir resposta",
        "antecipar solução jurídica",
        "explicar ou defender holding",
        "calcular inventário",
        "falar preço do croqui",
        "classificar DISC durante a conversa",
        "demonstrar pressa"
      ]
    }
  ]
}$rotp3b$::jsonb, true,
 'Transcrito de "POPs.md", seção "POP 03-B — variante para quem NÃO veio do seminário". "Proibido" reaproveitado do POP 03 ("mesmo formato" — o documento não lista um separado para o 03-B).');
