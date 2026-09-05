/**
 * Motor do Croqui — superfície pública (M1, Fase 5).
 *
 * Tudo o que sai daqui é **puro**: nenhum import de Supabase, de `server-only`
 * ou de `next/*`. O simulador ao vivo (M4) importa este módulo no CLIENTE e
 * recalcula as 19 tabelas sem uma chamada de rede.
 *
 * O acesso ao banco fica em `./servico` — importado só pelas rotas, nunca por
 * componente de cliente.
 */

export { calcularCroqui } from "./calcular";
export { aplicarFaixas, aliquotaDaFaixa, ErroFaixasInvalidas } from "./faixas";
export {
  CATALOGO_PARAMETROS,
  CHAVES_DIVERGENTES,
  CHAVES_PARAMETRO_CROQUI,
  CHAVES_SEMEADAS,
  chavesNecessarias,
  jurisdicaoDe,
  jurisdicoesNecessarias,
  type ChaveParametroCroqui,
  type DefinicaoParametro,
} from "./catalogo";
export {
  BASE_CARTORIO_IMOVEIS,
  BASE_ITCMD,
  CASCATA_CELULAS,
  MODELO_REFERENCIA_PADRAO,
  ORDEM_MODELOS,
} from "./dominio";
export {
  arredondar,
  celulaAusente,
  celulaCalculada,
  celulaDigitada,
  derivar,
  estaAusente,
  somar,
  subtrair,
} from "./celula";
export { chaveMapa, ContextoCroqui } from "./contexto";
export {
  explicarCelula,
  formatarCelula,
  formatarValor,
  podeAfirmar,
  TEXTO_AUSENTE,
  type TipoValor,
} from "./formatar";
