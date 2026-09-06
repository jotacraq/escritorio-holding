/**
 * Camada de acesso à API do SIC-HF — **barril**.
 *
 * O arquivo tinha 787 linhas e misturava dez domínios. O conteúdo mudou de
 * lugar para `src/lib/api/<domínio>.ts` (06/09/2026, Fase 7 rodada 3); este
 * arquivo continua sendo o ÚNICO caminho público (`@/lib/api`), então nenhum
 * import de tela precisou mudar. Ao acrescentar função nova, escreva no módulo
 * do domínio e deixe o `export *` daqui publicar.
 *
 * Regra do projeto: nunca inventar dado que pareça real. Toda função aqui tipa
 * o contrato documentado em docs/ARQUITETURA.md §3 e propaga erro — quem chama
 * decide o estado de tela (carregando / vazio / erro), nunca um mock.
 *
 * Endpoints marcados "ASSUMIDO" não estão na tabela de contratos da arquitetura,
 * mas são exigidos pelas telas F2/F7/F8/F10. Foram inferidos das policies de RLS
 * já desenhadas (ex.: `ma_upd` em mensagens_agendadas só faz sentido se existir
 * rota para acioná-la). Se o backend expuser caminho diferente, ajustar só aqui.
 * Falha desses (404/501) é tratada como "recurso indisponível", nunca mock.
 *
 * `chamarOpcional` e `paraQueryString` NÃO saem daqui de propósito: são o
 * transporte interno da camada, e tela nenhuma deve montar caminho de API na
 * mão. Quem precisa de um endpoint novo escreve a função no módulo do domínio.
 */

export { ApiError, RecursoIndisponivelError, chamar } from "./api/nucleo";

export * from "./api/agenda";
export * from "./api/briefings";
export * from "./api/comunicacao";
export * from "./api/croquis";
export * from "./api/documentos";
export * from "./api/equipe";
export * from "./api/formularios";
export * from "./api/indicadores";
export * from "./api/jornadas";
export * from "./api/ligacoes";
export * from "./api/patrimonio";
export * from "./api/sessoes";
export * from "./api/titulares";
