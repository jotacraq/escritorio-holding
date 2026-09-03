/**
 * Erro de domínio da importação, com `.codigo` mapeável para status HTTP pelo
 * chamador (mesmo padrão de `ErroUploadDocumento` em `src/server/ia/documentos.ts`).
 * Nunca vaza detalhe interno — a mensagem é sempre segura para o cliente ler.
 */
export class ErroImportacao extends Error {
  constructor(
    message: string,
    public readonly codigo: string,
  ) {
    super(message);
    this.name = "ErroImportacao";
  }
}
