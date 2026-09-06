-- ===========================================================================
-- 0082 — `responder_formulario_publico` passa a avaliar `condicional`.
--
-- ACHADO (Fable r3, critério "solidificação"): a 0081 fez a definição valer do
-- lado do servidor — `obrigatoria` cobrada e opção conferida contra a versão
-- ativa. Só que ela cobra TODA pergunta obrigatória, inclusive a que a
-- `condicional` escondeu do cliente. O editor do Admin
-- (`FormulariosRoteirosAba.tsx:146`) deixa marcar "obrigatória" numa pergunta
-- condicional; no dia em que a Dra. Elaine marcar, quem não dispara a
-- condicional recebe `resposta_obrigatoria` de uma pergunta que a tela dele
-- nunca mostrou, e o formulário fica impossível de enviar. Hoje são 0
-- obrigatórias no banco: é latente, mas é exatamente a capacidade que a Fase 7
-- entrega.
--
-- COMO ESTÁ ESCRITA (importa para revisar): o corpo abaixo é o corpo VIGENTE —
-- o da 0081, extraído do arquivo dela por script, com DUAS substituições
-- exatas (variáveis no `declare` e um bloco antes da cobrança). Se o alvo não
-- existisse, o gerador quebrava em vez de emitir SQL errado em silêncio.
-- `create or replace` troca o corpo INTEIRO: o que não for recopiado some.
--
-- ESPELHO DO CLIENTE: a regra de visibilidade é a de
-- `perguntaPublicaVisivel` (src/components/publico/CampoPerguntaPublico.tsx),
-- a MESMA função que monta a tela do cliente e a prévia do Admin — não há
-- terceira cópia. Os testes de `definicao.test.ts` travam o espelho do lado
-- do TypeScript; `scripts/verificacao-0082.sql` trava o do lado do banco.
--
-- NÃO MUDA: contrato de erro (`{erro, pergunta}`), rate limit, consentimentos,
-- upsert, espelho de p9 em `jornadas`, auditoria. Nenhum GRANT novo, nenhuma
-- coluna nova, nenhuma tabela tocada.
-- ===========================================================================

create or replace function public.responder_formulario_publico(
  p_hash text, p_respostas jsonb, p_consentimentos jsonb,
  p_ip_hash text default null, p_user_agent text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_link links_publicos;
  v_formulario formularios%rowtype;
  v_faixa text;
  v_chave text;
  v_item jsonb;
  v_textos jsonb;
  v_respondido_em timestamptz;
  v_pergunta jsonb;      -- 0081: validação contra a definição DO link
  v_id text;
  v_tipo text;
  v_valor jsonb;
  v_escolha text;
  v_cond jsonb;         -- 0082: condicional da pergunta
  v_valor_dep jsonb;    -- 0082: resposta da pergunta de quem ela depende
  v_visivel boolean;    -- 0082: o cliente chegou a VER esta pergunta?
begin
  if not app.limite_rota_ok('responder_formulario_publico') then
    return jsonb_build_object('erro', 'limite_excedido');
  end if;
  if not app.limite_token_ok(p_hash) then
    perform app.registrar_acesso_publico(null, 'responder', 'limite', p_ip_hash, p_user_agent);
    return jsonb_build_object('erro', 'limite_excedido');
  end if;

  v_link := app.resolve_link_escrita(p_hash);
  if v_link is null or v_link.tipo <> 'formulario' then
    perform app.registrar_acesso_publico(coalesce(v_link.id, null), 'responder', 'invalido', p_ip_hash, p_user_agent);
    return jsonb_build_object('erro', 'link_invalido');
  end if;

  if p_respostas is null or jsonb_typeof(p_respostas) <> 'object' or p_respostas = '{}'::jsonb then
    perform app.registrar_acesso_publico(v_link.id, 'responder', 'erro', p_ip_hash, p_user_agent);
    return jsonb_build_object('erro', 'respostas_invalidas');
  end if;

  select * into v_formulario from formularios where chave = 'estrategico' and ativo limit 1;
  if not found then
    perform app.registrar_acesso_publico(v_link.id, 'responder', 'erro', p_ip_hash, p_user_agent);
    return jsonb_build_object('erro', 'formulario_indisponivel');
  end if;

  -- =========================================================================
  -- 0081 — A DEFINIÇÃO PASSA A VALER DO LADO DE CÁ.
  -- Até aqui, "obrigatória" era só UX: a tela do cliente cobrava, e quem
  -- postasse direto no endpoint público gravava o formulário vazio. Do mesmo
  -- jeito, `unica`/`multipla` aceitavam qualquer texto — e esse texto vira
  -- `jornadas.faixa_patrimonio_declarada` (p9) e escolhe o material
  -- pós-sessão (p16). A regra que a Dra. Elaine escreve na definição tem de
  -- ser a regra que o banco aplica.
  -- A definição conferida é a DO LINK: a mesma que `app.payload_link_formulario`
  -- entregou ao cliente (chave 'estrategico', versão ativa). Cobrar contra
  -- outra versão seria cobrar uma pergunta que ele não leu.
  -- =========================================================================
  for v_pergunta in select * from jsonb_array_elements(coalesce(v_formulario.definicao, '[]'::jsonb))
  loop
    if jsonb_typeof(v_pergunta) <> 'object' then
      continue;   -- definição legada torta não derruba a resposta do cliente
    end if;
    v_id   := v_pergunta ->> 'id';
    v_tipo := v_pergunta ->> 'tipo';
    if v_id is null then
      continue;
    end if;
    v_valor := p_respostas -> v_id;

    -- (0) VISIBILIDADE — 0082. Espelho EXATO de `perguntaPublicaVisivel`
    --     (src/components/publico/CampoPerguntaPublico.tsx:14), a mesma função
    --     que monta a tela do cliente e a prévia do Admin.
    --
    --     Sem isto, a 0081 cobrava `obrigatoria` de pergunta que o cliente
    --     nunca viu: p11 ("Quantos imóveis?") depende de p10 conter "Imóveis",
    --     e o editor deixa marcar as duas coisas na mesma linha. Quem respondeu
    --     "Empresas" recebia `resposta_obrigatoria` de uma pergunta que a tela
    --     dele não mostrou — formulário impossível de enviar, sem saída.
    --
    --     Regras copiadas do TypeScript, na MESMA ordem:
    --       não há `condicional` (ou não é objeto) -> visível;
    --       tem a chave `igual`  -> visível se a resposta de que depende for
    --                               ESTRITAMENTE igual ao valor;
    --       tem a chave `contem` -> visível se a resposta for ARRAY que contém
    --                               o valor;
    --       tem `condicional` sem nenhum dos dois -> visível.
    --     `jsonb_exists` (e não `is not null`) porque em JS a diferença entre
    --     "chave ausente" e "chave com null" é o que escolhe o ramo, e
    --     `-> 'igual'` devolve `'null'::jsonb` nos dois casos.
    --     Array/objeto dos dois lados nunca casa: `===` e `includes` comparam
    --     por REFERÊNCIA no cliente, e duas referências distintas jamais são
    --     iguais — comparar por valor aqui deixaria passar o que a tela esconde.
    v_visivel := true;
    v_cond := v_pergunta -> 'condicional';
    if v_cond is not null and jsonb_typeof(v_cond) = 'object' then
      v_valor_dep := p_respostas -> (v_cond ->> 'depende_de');
      if jsonb_exists(v_cond, 'igual') then
        v_visivel := v_valor_dep is not null
                 and jsonb_typeof(v_valor_dep) not in ('array', 'object')
                 and jsonb_typeof(v_cond -> 'igual') not in ('array', 'object')
                 and v_valor_dep = (v_cond -> 'igual');
      elsif jsonb_exists(v_cond, 'contem') then
        v_visivel := jsonb_typeof(v_valor_dep) = 'array'
                 and jsonb_typeof(v_cond -> 'contem') not in ('array', 'object')
                 and exists (
                       select 1
                         from jsonb_array_elements(v_valor_dep) x
                        where jsonb_typeof(x) not in ('array', 'object')
                          and x = (v_cond -> 'contem'));
      end if;
    end if;

    -- Pergunta que o cliente não viu não cobra nada: nem `obrigatoria` (1) nem
    -- opção (2). O que sobrou dela em `p_respostas` (respondeu, depois mudou a
    -- pergunta-mãe) é gravado como veio — a resposta é prova do que ele mandou,
    -- e apagar dado do titular aqui seria decisão de produto, não de validação.
    if not v_visivel then
      continue;
    end if;

    -- (1) obrigatória sem resposta. Vazio é vazio: ausente, null, texto em
    --     branco e lista vazia contam todos como não respondida.
    -- `= 'true'::jsonb` em vez de cast: definição legada com
    --     `"obrigatoria": "sim"` levantaria 22P02 e derrubaria a resposta do
    --     cliente. Só o booleano verdadeiro cobra.
    if (v_pergunta -> 'obrigatoria') = 'true'::jsonb
       and (v_valor is null
            or jsonb_typeof(v_valor) = 'null'
            or (jsonb_typeof(v_valor) = 'string' and length(trim(v_valor #>> '{}')) = 0)
            or (jsonb_typeof(v_valor) = 'array'  and jsonb_array_length(v_valor) = 0))
    then
      perform app.registrar_acesso_publico(v_link.id, 'responder', 'erro', p_ip_hash, p_user_agent);
      return jsonb_build_object('erro', 'resposta_obrigatoria', 'pergunta', v_id);
    end if;

    -- (2) escolha fora das opções da versão que o cliente leu. Aceita os DOIS
    --     formatos de opção (string crua do legado e {valor,rotulo} da 0078).
    --     Uma consulta só, que devolve a PRIMEIRA escolha inválida — nada de
    --     laço sobre escalar, que o plpgsql lê como laço de inteiros.
    if v_tipo in ('unica','multipla') and v_valor is not null and jsonb_typeof(v_valor) <> 'null' then
      select escolhas.e into v_escolha
        from (
          select case when jsonb_typeof(v_valor) = 'array' then x #>> '{}' else v_valor #>> '{}' end as e
            from jsonb_array_elements(
                   case when jsonb_typeof(v_valor) = 'array' then v_valor else '[null]'::jsonb end) x
        ) as escolhas
       where escolhas.e is not null
         and length(trim(escolhas.e)) > 0
         and not exists (
           select 1
             from jsonb_array_elements(coalesce(v_pergunta -> 'opcoes', '[]'::jsonb)) o
            where coalesce(o ->> 'valor', o #>> '{}') = escolhas.e
         )
       limit 1;

      if v_escolha is not null then
        perform app.registrar_acesso_publico(v_link.id, 'responder', 'erro', p_ip_hash, p_user_agent);
        return jsonb_build_object('erro', 'opcao_invalida', 'pergunta', v_id);
      end if;
    end if;
  end loop;

  -- Upsert por jornada_id (unique já existe desde 0006). CONFLITO C9 do plano: a
  -- sobrescrita não apaga prova — `trg_timeline_formulario` (0014) já grava
  -- "Formulário estratégico atualizado" na timeline a cada UPDATE, e a resposta
  -- anterior fica só substituída na linha corrente, nunca na timeline.
  v_respondido_em := now();
  insert into formularios_respostas (jornada_id, formulario_id, respostas, origem, respondido_em)
  values (v_link.jornada_id, v_formulario.id, p_respostas, 'cliente_link', v_respondido_em)
  on conflict (jornada_id) do update
    set formulario_id = excluded.formulario_id,
        respostas = excluded.respostas,
        origem = 'cliente_link',
        respondido_em = v_respondido_em;

  -- Espelha P9 na jornada — mesma regra de src/app/api/jornadas/[id]/formulario/route.ts:82.
  v_faixa := p_respostas ->> 'p9';
  if v_faixa is not null and length(trim(v_faixa)) > 0 then
    update jornadas set faixa_patrimonio_declarada = v_faixa where id = v_link.jornada_id;
  end if;

  -- Consentimentos coletáveis nesta via. `p_consentimentos` é um ARRAY
  -- `[{"chave":"tratamento_ia","versao":"..."}, ...]` — só uma entrada por item
  -- ACEITO (contrato de src/types/publico-ui.ts: "todas aceitas"; recusar é
  -- simplesmente não mandar a chave). `gravacao_sessao` (POP 05, 1º SIM) e
  -- `pesquisa_fontes_publicas` são de captura interna — não aparecem aqui. O
  -- texto/versão gravados vêm SEMPRE de `configuracoes` no servidor, nunca do
  -- que o cliente mandou no corpo — o `versao` do item de entrada é ignorado de
  -- propósito (o cliente não é fonte confiável do texto que ele mesmo aceitou).
  select valor into v_textos from configuracoes where chave = 'consentimento.textos';
  for v_item in select * from jsonb_array_elements(coalesce(p_consentimentos, '[]'::jsonb))
  loop
    v_chave := v_item ->> 'chave';
    if v_chave in ('tratamento_ia', 'comunicacao_email', 'comunicacao_whatsapp') then
      insert into consentimentos (pessoa_id, tipo, concedido, texto_apresentado, versao_texto, canal)
      values (
        (select pessoa_id from jornadas where id = v_link.jornada_id),
        v_chave::tipo_consentimento,
        true,
        coalesce(v_textos -> v_chave ->> 'texto', 'Texto de consentimento não configurado.'),
        coalesce(v_textos -> v_chave ->> 'versao', 'sem-versao'),
        'formulario_publico'
      );
    end if;
  end loop;

  update links_publicos
     set usos = usos + 1, estado = 'usado', finalizado_em = v_respondido_em
   where id = v_link.id;

  perform app.registrar_acesso_publico(v_link.id, 'responder', 'ok', p_ip_hash, p_user_agent);

  return jsonb_build_object('ok', true, 'respondido_em', v_respondido_em);
end $$;

comment on function public.responder_formulario_publico(text, jsonb, jsonb, text, text) is
  'Resposta do cliente ao POP 02 pelo link público. Valida contra a definição ATIVA: '
  '`obrigatoria` e opção válida, mas SÓ em pergunta visível — a `condicional` é avaliada '
  'aqui com a mesma regra de `perguntaPublicaVisivel` no navegador (0082). Erros: '
  'link_invalido, limite_excedido, respostas_invalidas, formulario_indisponivel, '
  'resposta_obrigatoria e opcao_invalida (estes dois com a chave `pergunta`).';
