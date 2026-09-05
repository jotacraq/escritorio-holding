import { Cartao } from "@/components/ui/Cartao";
import { LinkBotao } from "@/components/painel/LinkBotao";
import { chavesDoErro } from "./apiCroquiCalculo";

/**
 * O 409 do servidor não é "deu erro": é a lista do que falta cadastrar para
 * ESTE cliente. Mostrar a lista é a diferença entre a advogada resolver em um
 * minuto e abrir um chamado — por isso o componente é um só, importado pelo
 * croqui e pelo simulador. (Estava escrito duas vezes, e a segunda cópia
 * tinha perdido justamente a lista, dizendo "3 parâmetros faltam" e nada
 * mais.)
 *
 * `Cartao`, não `AvisoInline`: o aviso renderiza um `<p>`, e um `<ul>` dentro
 * de `<p>` é fechado pelo parser — a lista sairia fora da moldura âmbar,
 * exatamente na tela onde ela importa.
 */
export function ErroAoFixar({ erro }: { erro: unknown }) {
  const chaves = chavesDoErro(erro);
  const mensagem = erro instanceof Error ? erro.message : "Não deu para fixar a versão.";

  if (chaves.length === 0) {
    return (
      <Cartao realce="vermelho" preenchimento="compacto">
        <p role="alert" className="text-sm font-medium text-[color:var(--vermelho)]">
          {mensagem}
        </p>
      </Cartao>
    );
  }

  return (
    <Cartao realce="ambar" preenchimento="compacto">
      <div role="alert" className="flex flex-wrap items-center justify-between gap-item">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-[color:var(--ambar)]">
            {chaves.length} {chaves.length === 1 ? "parâmetro falta" : "parâmetros faltam"} para fixar
          </p>
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[color:var(--ambar)]">
            {chaves.map((c) => (
              <li key={`${c.chave}-${c.uf ?? ""}-${c.municipio ?? ""}`} title={c.chave}>
                {c.rotulo}
                {(c.municipio ?? c.uf) && <span className="opacity-80"> · {c.municipio ?? c.uf}</span>}
              </li>
            ))}
          </ul>
        </div>
        <LinkBotao href="/admin#parametros">Cadastrar</LinkBotao>
      </div>
    </Cartao>
  );
}
