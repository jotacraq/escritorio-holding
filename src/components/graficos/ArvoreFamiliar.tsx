import { GraficoIndisponivel } from "./GraficoIndisponivel";
import { ItemLegenda, Moldura } from "./Moldura";
import { PALETA_GRAFICO } from "./paleta";
import type { GraficoBaseProps } from "./tipos";

export type PapelFamiliar = "instituidor" | "conjuge" | "filho" | "neto" | "outro";

export interface PessoaArvore {
  id: string;
  nome: string;
  papel: PapelFamiliar;
  idade?: number | null;
  regimeCasamento?: string | null;
  dependenteFinanceiro?: boolean | null;
}

/** Um núcleo familiar — a unidade que o método usa como 1º critério de
 * arquitetura ("quantos núcleos existem?", §3 do Contexto-Mestre). */
export interface NucleoFamiliar {
  id: string;
  rotulo: string;
  pessoas: PessoaArvore[];
}

export interface ArvoreFamiliarProps extends GraficoBaseProps {
  instituidores: PessoaArvore[];
  nucleos: NucleoFamiliar[];
  titulo?: string;
}

const CHIP_L = 184;
const CHIP_A = 46;
const GAP_Y = 12;
const GAP_X = 26;
const MARGEM = 16;

const ROTULO_PAPEL: Record<PapelFamiliar, string> = {
  instituidor: "Instituidor(a)",
  conjuge: "Cônjuge",
  filho: "Filho(a)",
  neto: "Neto(a)",
  outro: "Outro",
};

/**
 * Slide 3 · Família (§3.4). A relação neto→filho não existe como campo
 * estruturado em `familiares` hoje (parentesco é texto livre por pessoa) —
 * por isso os netos aparecem agrupados dentro do núcleo, não aninhados sob um
 * filho específico. Quando o schema ganhar esse vínculo, o layout ganha um
 * nível sem trocar a API deste componente.
 */
export function ArvoreFamiliar({ instituidores, nucleos, titulo = "Família e núcleos", tema = "claro", modoApresentacao = false, className = "" }: ArvoreFamiliarProps) {
  const cores = PALETA_GRAFICO[tema];

  if (instituidores.length === 0 && nucleos.length === 0) {
    return (
      <GraficoIndisponivel
        titulo={titulo}
        tema={tema}
        modoApresentacao={modoApresentacao}
        className={className}
        itensFaltantes={[{ campo: "Ao menos um familiar cadastrado (instituidor, cônjuge, filho ou neto)", onde: "Aba Família" }]}
      />
    );
  }

  const corPapel: Record<PapelFamiliar, string> = {
    instituidor: cores.latao,
    conjuge: cores.categorica.imovel,
    filho: cores.categorica.investimento,
    neto: cores.categorica.previdencia,
    outro: cores.categorica.outro,
  };

  const larguraInstituidores = instituidores.length > 0 ? instituidores.length * CHIP_L + (instituidores.length - 1) * GAP_X : 0;
  const larguraColunas = nucleos.length > 0 ? nucleos.length * CHIP_L + (nucleos.length - 1) * GAP_X : 0;
  const larguraPlotavel = Math.max(larguraInstituidores, larguraColunas, CHIP_L);
  const largura = larguraPlotavel + MARGEM * 2;

  const yInstituidores = MARGEM;
  const temInstituidores = instituidores.length > 0;
  const ySpine = temInstituidores ? yInstituidores + CHIP_A + 18 : MARGEM;
  const yColunas = nucleos.length > 0 ? ySpine + (temInstituidores ? 18 : 0) : ySpine;

  const linhasPorColuna = nucleos.map((n) => 1 + n.pessoas.length);
  const maiorColuna = linhasPorColuna.length > 0 ? Math.max(...linhasPorColuna) : 0;
  const alturaColunas = maiorColuna > 0 ? maiorColuna * (CHIP_A + GAP_Y) - GAP_Y : 0;
  const altura = yColunas + alturaColunas + MARGEM;

  const xInstituidores = (largura - larguraInstituidores) / 2;
  const xColunas = (largura - larguraColunas) / 2;

  const totalPessoas = instituidores.length + nucleos.reduce((soma, n) => soma + n.pessoas.length, 0);
  const rotuloAria = `Árvore familiar com ${instituidores.length} instituidor(es), ${nucleos.length} núcleo(s) familiar(es) e ${totalPessoas} pessoas ao todo.`;

  const papeisPresentes = new Set<PapelFamiliar>(instituidores.map(() => "instituidor" as const));
  for (const n of nucleos) for (const p of n.pessoas) papeisPresentes.add(p.papel);

  return (
    <Moldura
      titulo={titulo}
      tema={tema}
      fonte="Fonte: aba Família da Ficha 360"
      legenda={Array.from(papeisPresentes).map((papel) => (
        <ItemLegenda key={papel} cor={corPapel[papel]} rotulo={ROTULO_PAPEL[papel]} tema={tema} />
      ))}
      tabela={
        <div className="sr-only">
          <table>
          <caption>{rotuloAria}</caption>
          <thead>
            <tr>
              <th scope="col">Núcleo</th>
              <th scope="col">Nome</th>
              <th scope="col">Papel</th>
              <th scope="col">Idade</th>
              <th scope="col">Regime de casamento</th>
              <th scope="col">Dependente financeiro</th>
            </tr>
          </thead>
          <tbody>
            {instituidores.map((p) => (
              <tr key={p.id}>
                <td>—</td>
                <td>{p.nome}</td>
                <td>{ROTULO_PAPEL[p.papel]}</td>
                <td>{p.idade ?? "não informado"}</td>
                <td>{p.regimeCasamento ?? "não informado"}</td>
                <td>{p.dependenteFinanceiro ? "sim" : "não"}</td>
              </tr>
            ))}
            {nucleos.flatMap((n) =>
              n.pessoas.map((p) => (
                <tr key={p.id}>
                  <td>{n.rotulo}</td>
                  <td>{p.nome}</td>
                  <td>{ROTULO_PAPEL[p.papel]}</td>
                  <td>{p.idade ?? "não informado"}</td>
                  <td>{p.regimeCasamento ?? "não informado"}</td>
                  <td>{p.dependenteFinanceiro ? "sim" : "não"}</td>
                </tr>
              )),
            )}
          </tbody>
          </table>
        </div>
      }
      className={className}
    >
      <svg role="img" aria-label={rotuloAria} viewBox={`0 0 ${largura} ${altura}`} width="100%" style={{ display: "block", height: "auto" }}>
        {instituidores.map((pessoa, indice) => {
          const x = xInstituidores + indice * (CHIP_L + GAP_X);
          return <ChipPessoa key={pessoa.id} x={x} y={yInstituidores} pessoa={pessoa} cor={corPapel[pessoa.papel]} tema={tema} />;
        })}

        {temInstituidores && nucleos.length > 0 && (
          <>
            <line x1={largura / 2} y1={yInstituidores + CHIP_A} x2={largura / 2} y2={ySpine} stroke={cores.linhaForte} strokeWidth={2} />
            <line x1={xColunas + CHIP_L / 2} y1={ySpine} x2={xColunas + larguraColunas - CHIP_L / 2} y2={ySpine} stroke={cores.linhaForte} strokeWidth={2} />
          </>
        )}

        {nucleos.map((nucleo, indiceColuna) => {
          const x = xColunas + indiceColuna * (CHIP_L + GAP_X);
          return (
            <g key={nucleo.id}>
              {temInstituidores && (
                <line x1={x + CHIP_L / 2} y1={ySpine} x2={x + CHIP_L / 2} y2={yColunas} stroke={cores.linhaForte} strokeWidth={2} />
              )}
              <rect x={x} y={yColunas} width={CHIP_L} height={CHIP_A} rx={4} fill="none" stroke={cores.linhaForte} strokeDasharray="3 3" />
              <text x={x + CHIP_L / 2} y={yColunas + CHIP_A / 2 + 5} fontSize="13" fontWeight={700} textAnchor="middle" fill={cores.tintaSuave}>
                {nucleo.rotulo}
              </text>
              {nucleo.pessoas.map((pessoa, indiceLinha) => {
                const y = yColunas + (indiceLinha + 1) * (CHIP_A + GAP_Y);
                return (
                  <g key={pessoa.id}>
                    <line x1={x + CHIP_L / 2} y1={y - GAP_Y} x2={x + CHIP_L / 2} y2={y} stroke={cores.linha} strokeWidth={2} />
                    <ChipPessoa x={x} y={y} pessoa={pessoa} cor={corPapel[pessoa.papel]} tema={tema} />
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </Moldura>
  );
}

function ChipPessoa({ x, y, pessoa, cor, tema }: { x: number; y: number; pessoa: PessoaArvore; cor: string; tema: "claro" | "escuro" }) {
  const cores = PALETA_GRAFICO[tema];
  const subtitulo = [
    pessoa.idade != null ? `${pessoa.idade} anos` : null,
    pessoa.regimeCasamento,
    pessoa.dependenteFinanceiro ? "dependente" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <g>
      <rect x={x} y={y} width={CHIP_L} height={CHIP_A} rx={4} fill={cores.superficie} stroke={cor} strokeWidth={2} />
      <rect x={x} y={y} width={5} height={CHIP_A} fill={cor} />
      <text x={x + 14} y={y + (subtitulo ? 19 : 27)} fontSize="14" fontWeight={600} fill={cores.tinta}>
        {truncar(pessoa.nome, 20)}
      </text>
      {subtitulo && (
        <text x={x + 14} y={y + 34} fontSize="11" fill={cores.tintaFraca}>
          {truncar(subtitulo, 26)}
        </text>
      )}
    </g>
  );
}

function truncar(texto: string, max: number): string {
  return texto.length > max ? `${texto.slice(0, max - 1)}…` : texto;
}
