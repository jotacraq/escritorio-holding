/**
 * Tipos da fila de mensagens (WhatsApp/e-mail). As funções que falam com
 * `/api/mensagens` moram em `components/comunicacao/api-comunicacao.ts` — aqui
 * ficam só os tipos que aquele módulo (e a régua) reexportam.
 */

export type CanalMensagem = "email" | "whatsapp";
export type StatusMensagem = "pendente" | "enviando" | "enviada" | "falhou" | "cancelada";
export type StatusExecucaoIA = "pendente" | "executando" | "concluida" | "falhou";
