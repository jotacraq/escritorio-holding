-- 0020_conserta_regua_security_definer.sql
-- BUG P0 achado ao testar o ALTO 1 ao vivo (não estava na lista do pentest,
-- mas está no mesmo arquivo/trigger chain e quebra em produção HOJE):
--
-- app.regua_agendamento() e app.regua_pos_sessao() (0013) chamam
-- app.enfileirar_mensagem(), que tem EXECUTE revogado de authenticated (de
-- propósito — só o motor da régua pode enfileirar). Como as duas são triggers
-- comuns (sem SECURITY DEFINER), elas rodam com o role de quem disparou o
-- UPDATE/INSERT — que é `authenticated` sempre que a rota usa o cliente de
-- sessão (criarClienteServidor(), não o admin). Resultado: TODO agendamento
-- criado/confirmado por um usuário real, e toda sessão marcada como
-- `realizada_em`, falha com 42501 "permission denied for function
-- enfileirar_mensagem" — reproduzido ao vivo com o JWT de `relacionamento`
-- criando um agendamento comum (POST /api/jornadas/[id]/agendamentos).
--
-- O padrão já existe e está documentado no próprio repo para o mesmo problema:
-- 0004_jornadas_transicoes.sql, comentário sobre app.registra_transicao_jornada()
-- ("Sem SECURITY DEFINER aqui, o INSERT do trigger seria bloqueado pela própria
-- RLS... e toda transição de etapa quebraria em produção"). As réguas de 0013
-- ficaram de fora dessa correção. Aplicamos o mesmo remédio aqui: SECURITY
-- DEFINER + search_path fixo, sem mudar nenhuma linha de lógica de negócio.

create or replace function app.regua_agendamento() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_jornada_id uuid; v_pessoa record; v_link text;
begin
  if tg_op = 'UPDATE' and (
       new.inicio_em is distinct from old.inicio_em or new.status in ('cancelado','remarcado')
     ) then
    update mensagens_agendadas set status = 'cancelada'
     where agendamento_id = old.id and status = 'pendente';
  end if;

  if new.status not in ('agendado','confirmado') then
    return new;
  end if;

  select s.jornada_id, s.link_sala into v_jornada_id, v_link
    from sessoes_viabilidade s where s.id = new.sessao_id;
  if v_jornada_id is null then
    return new;
  end if;

  select p.nome, p.email, p.telefone into v_pessoa
    from jornadas j join pessoas p on p.id = j.pessoa_id
   where j.id = v_jornada_id;

  if new.inicio_em - interval '7 days' > now() then
    perform app.enfileirar_mensagem(v_jornada_id, new.id, 'confirmacao_d7',
      case when v_pessoa.telefone is not null then 'whatsapp'::canal_mensagem else 'email'::canal_mensagem end,
      coalesce(v_pessoa.telefone, v_pessoa.email), new.inicio_em - interval '7 days',
      v_pessoa.nome, to_char(new.inicio_em, 'DD/MM/YYYY HH24:MI'), v_link);
  end if;

  perform app.enfileirar_mensagem(v_jornada_id, new.id, 'dia_da_sessao', 'email',
    v_pessoa.email, new.inicio_em - interval '10 minutes',
    v_pessoa.nome, to_char(new.inicio_em, 'DD/MM/YYYY HH24:MI'), v_link);

  return new;
end $$;

create or replace function app.regua_pos_sessao() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_pessoa record;
begin
  if new.realizada_em is null or old.realizada_em is not null then
    return new;
  end if;
  select p.nome, p.email into v_pessoa
    from jornadas j join pessoas p on p.id = j.pessoa_id
   where j.id = new.jornada_id;
  perform app.enfileirar_mensagem(new.jornada_id, null, 'pos_sessao', 'email',
    v_pessoa.email, new.realizada_em + interval '2 hours', v_pessoa.nome, null, null);
  return new;
end $$;
