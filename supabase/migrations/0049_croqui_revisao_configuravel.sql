-- 0049_croqui_revisao_configuravel.sql
-- Pedido direto do dono do produto (Marcio Carvalho de Sá), 04/09/2026: a
-- trava de banco da 0043(b) — croqui só vira 'pronto'/'apresentado' com os 13
-- slides marcados `revisado: true` — deixa de ser obrigatória por padrão. Sai
-- de TODOS os 13 slides, sem exceção (confirmado: não é só o slide de
-- Economia/tributário).
--
-- O QUE MUDA: a MESMA função de trigger (mesmo nome, mesma assinatura zero
-- parâmetros, `returns trigger`) passa a ler a chave nova
-- `croqui.exige_revisao_para_pronto` em `configuracoes` como primeira
-- instrução do corpo. Se `false` (o novo default), a função devolve `new`
-- imediatamente — antes de tocar em `jsonb_array_length` ou em qualquer
-- verificação de slide. O trigger em si (`trg_croquis_pronto_exige_revisao`,
-- 0043) NÃO é recriado — só o corpo da função que ele já aponta.
--
-- POR QUÊ: a garantia "advogada revisou os 13 slides antes de assinar" existia
-- como invariante estrutural de banco (CONFLITO C19 da 0043: "se a IA
-- preenche os 13 slides, o que a advogada assina?"). Decisão de produto: essa
-- garantia deixa de ser bloqueante e vira só sinal visual na tela do Editor —
-- quem quiser restaurar o bloqueio original faz um UPDATE, sem deploy.
--
-- SEM `security definer` (é assim na 0043) — a leitura de `configuracoes`
-- dentro da função roda como o usuário que fez o DML em `croquis`, e passa
-- pela policy `cfg_sel` (`app.eh_interno()`, 0027). Perfil interno (admin,
-- advogada, relacionamento) sempre enxerga a chave; se por qualquer motivo a
-- leitura falhar ou devolver zero linhas (chave ausente, RLS negando por
-- perfil fora do esperado), o `coalesce` resolve para `false` — trava
-- DESLIGADA por padrão de falha, nunca `true`, que reintroduziria o bloqueio
-- por acidente.
--
-- Reversão (religa a trava original, sem deploy):
--   UPDATE configuracoes SET valor = 'true'::jsonb WHERE chave = 'croqui.exige_revisao_para_pronto';

-- ===========================================================================
-- Chave nova em `configuracoes`, mesmo padrão de seed da 0027. `on conflict
-- do nothing`: migration aditiva, reaplicável sem sobrescrever um valor que
-- alguém já tenha ajustado pela tela de Admin depois do primeiro deploy.
-- ===========================================================================
insert into configuracoes (chave, valor, descricao) values
 ('croqui.exige_revisao_para_pronto', 'false'::jsonb,
  'Controla se croqui exige os 13 slides revisados (conteudo->slides[].revisado '
  '= true) para status pronto/apresentado (trigger trg_croquis_pronto_exige_revisao, '
  'app.trava_croqui_pronto_exige_revisao(), 0043). DEFAULT FALSE: decisão do '
  'dono do produto (Marcio Carvalho de Sá), 04/09/2026 — remove a '
  'obrigatoriedade de revisar os 13 slides antes do croqui virar pronto, para '
  'TODOS os slides, sem exceção. A garantia institucional original ("advogada '
  'revisou antes de assinar") deixa de ser bloqueante de banco e vira só sinal '
  'visual na tela do Editor. Definir como TRUE restaura a trava original da '
  '0043 imediatamente, sem deploy.')
on conflict (chave) do nothing;

-- ===========================================================================
-- app.trava_croqui_pronto_exige_revisao() — MESMO nome, MESMA assinatura zero
-- parâmetros, `returns trigger`, sem `security definer`, `search_path =
-- public, pg_temp` (idêntico à 0043). O trigger `trg_croquis_pronto_exige_revisao`
-- (before insert or update on croquis, 0043) não é tocado: aponta pelo nome e
-- `create or replace function` já troca o corpo.
--
-- Primeira instrução do corpo: lê a chave e sai cedo se desligada — antes de
-- qualquer `jsonb_array_length`/contagem de slide, para o caminho comum
-- (trava desligada) não pagar o custo daquela varredura.
-- ===========================================================================
create or replace function app.trava_croqui_pronto_exige_revisao() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  v_exige_revisao boolean;
  v_total_slides int;
  v_nao_revisados int;
begin
  if new.status not in ('pronto', 'apresentado') then
    return new;
  end if;

  select coalesce((valor #>> '{}')::boolean, false)
    into v_exige_revisao
    from configuracoes
   where chave = 'croqui.exige_revisao_para_pronto';

  -- Chave ausente, RLS sem enxergar a linha, ou valor não booleano: o
  -- `coalesce` acima já cobre `v_exige_revisao is null` dentro do SELECT, mas
  -- o SELECT em si pode devolver zero linhas (variável fica null). Repetir o
  -- coalesce aqui garante o mesmo destino de falha: trava DESLIGADA, nunca
  -- ligada por acidente.
  if not coalesce(v_exige_revisao, false) then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.status is not distinct from new.status
     and old.conteudo is not distinct from new.conteudo then
    return new; -- nada que afete a invariante mudou; linha intocada não é revalidada
  end if;

  v_total_slides := jsonb_array_length(coalesce(new.conteudo -> 'slides', '[]'::jsonb));
  select count(*) into v_nao_revisados
    from jsonb_array_elements(coalesce(new.conteudo -> 'slides', '[]'::jsonb)) as slide
   where coalesce((slide ->> 'revisado')::boolean, false) = false;

  if v_total_slides <> 13 or v_nao_revisados > 0 then
    raise exception 'croqui_pronto_exige_13_slides_revisados: % de % slide(s) sem revisao humana',
      v_nao_revisados, v_total_slides
      using errcode = '23514';
  end if;

  return new;
end $$;

-- ===========================================================================
-- VERIFICAÇÃO — rodar depois de aplicar, contra o banco remoto
-- (fcfsnqqaphtamhrpuyoh). Os 4 passos, nesta ordem:
--
--   -- 1. com a chave em 'false' (default desta migration): UPDATE para
--   -- 'pronto' num croqui com 0/13 slides revisados deve PASSAR.
--   UPDATE croquis SET status = 'pronto' WHERE id = '<croqui_0_de_13>';
--
--   -- 2. religar a trava original e repetir a MESMA escrita: deve FALHAR
--   -- com 23514 (croqui_pronto_exige_13_slides_revisados).
--   UPDATE configuracoes SET valor = 'true'::jsonb
--    WHERE chave = 'croqui.exige_revisao_para_pronto';
--   UPDATE croquis SET status = 'pronto' WHERE id = '<croqui_0_de_13>';
--
--   -- 3. voltar para 'false': deve PASSAR de novo.
--   UPDATE configuracoes SET valor = 'false'::jsonb
--    WHERE chave = 'croqui.exige_revisao_para_pronto';
--   UPDATE croquis SET status = 'pronto' WHERE id = '<croqui_0_de_13>';
--
--   -- 4. croqui com 13/13 slides revisados passa nos dois estados da chave
--   -- (trava ligada ou desligada, croqui completo sempre passa):
--   UPDATE configuracoes SET valor = 'true'::jsonb
--    WHERE chave = 'croqui.exige_revisao_para_pronto';
--   UPDATE croquis SET status = 'pronto' WHERE id = '<croqui_13_de_13>';
--   UPDATE configuracoes SET valor = 'false'::jsonb
--    WHERE chave = 'croqui.exige_revisao_para_pronto';
--   UPDATE croquis SET status = 'pronto' WHERE id = '<croqui_13_de_13>';
-- ===========================================================================
