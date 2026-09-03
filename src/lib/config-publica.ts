/**
 * Configuração PÚBLICA do Supabase.
 *
 * Estes dois valores não são segredo: a URL do projeto e a chave publicável já
 * viajam para o navegador de todo visitante, por construção. Quem protege o dado
 * é a RLS, não o sigilo da chave.
 *
 * Por que constante e não só `process.env`: o proxy/middleware do Next roda antes
 * de qualquer rota e não lê arquivo `.env` em execução. Em produção na Hostinger,
 * `process.env.NEXT_PUBLIC_SUPABASE_URL` chegava vazio mesmo com o build lendo o
 * `.env.production` — e o middleware, corretamente fail-closed, devolvia 503 em
 * TODA requisição, inclusive em arquivo estático. Diagnóstico de 03/09/2026, com
 * o build de produção reproduzido localmente.
 *
 * O `process.env` continua na frente para permitir apontar outro projeto Supabase
 * (ambiente de teste, branch do banco) sem editar código. O literal é só o piso.
 *
 * SEGREDO DE VERDADE — `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`,
 * `HOTMART_WEBHOOK_SECRET`, `CRON_SECRET`, `RESEND_API_KEY` — NUNCA entra aqui.
 * Esses vivem só em `process.env`, são lidos em runtime no servidor, e a ausência
 * de cada um tem tratamento explícito (503 com motivo, nunca dado falso).
 */

export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://fcfsnqqaphtamhrpuyoh.supabase.co";

export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "sb_publishable_qxiG66XwJoQw07Khlust7w_RA-I7DXw";

/** URL pública da aplicação, usada em link de e-mail e em redirect de auth. */
export const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://escritorio.grupoparticipa.app.br";
