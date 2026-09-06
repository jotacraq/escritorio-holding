import crypto from "node:crypto";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  CABECALHO_ASSINATURA,
  CABECALHO_TIMESTAMP,
  JANELA_SEGUNDOS,
  assinarCorpo,
  cabecalhosAssinados,
  segredosIguais,
  timestampDentroDaJanela,
  verificarAssinatura,
} from "./assinatura";

const SEGREDO = "segredo-de-teste-com-tamanho-suficiente";
const CORPO = JSON.stringify({ id_evento: "vapi:abc:end-of-call-report:concluida", ligacao_id: "x" });
const AGORA = () => String(Math.floor(Date.now() / 1000));

describe("assinarCorpo", () => {
  it("é o HMAC de `timestamp.corpo`, com prefixo sha256=", () => {
    const esperado = "sha256=" + crypto.createHmac("sha256", SEGREDO).update("1757000000." + CORPO).digest("hex");
    expect(assinarCorpo(SEGREDO, "1757000000", CORPO)).toBe(esperado);
  });

  it("muda quando o timestamp muda (o timestamp faz parte do que é assinado)", () => {
    expect(assinarCorpo(SEGREDO, "1757000000", CORPO)).not.toBe(assinarCorpo(SEGREDO, "1757000001", CORPO));
  });

  it("muda quando UM byte do corpo muda", () => {
    expect(assinarCorpo(SEGREDO, "1757000000", CORPO)).not.toBe(assinarCorpo(SEGREDO, "1757000000", CORPO + " "));
  });
});

describe("segredosIguais", () => {
  it("compara conteúdo, não referência", () => {
    expect(segredosIguais("abc", "abc")).toBe(true);
    expect(segredosIguais("abc", "abd")).toBe(false);
  });

  it("tamanhos diferentes são falsos sem estourar o timingSafeEqual", () => {
    expect(segredosIguais("abc", "abcd")).toBe(false);
    expect(segredosIguais("", "abcd")).toBe(false);
  });
});

describe("timestampDentroDaJanela", () => {
  const base = 1_757_000_000_000; // ms

  it("aceita o instante exato e as bordas dos ±5 min", () => {
    expect(timestampDentroDaJanela(String(base / 1000), base)).toBe(true);
    expect(timestampDentroDaJanela(String(base / 1000 - JANELA_SEGUNDOS), base)).toBe(true);
    expect(timestampDentroDaJanela(String(base / 1000 + JANELA_SEGUNDOS), base)).toBe(true);
  });

  it("recusa 1 segundo além da janela dos dois lados (replay de ontem morre aqui)", () => {
    expect(timestampDentroDaJanela(String(base / 1000 - JANELA_SEGUNDOS - 1), base)).toBe(false);
    expect(timestampDentroDaJanela(String(base / 1000 + JANELA_SEGUNDOS + 1), base)).toBe(false);
  });

  it("recusa o que não é dígito de 9 a 11 posições (ms, negativo, texto)", () => {
    expect(timestampDentroDaJanela("", base)).toBe(false);
    expect(timestampDentroDaJanela("ontem", base)).toBe(false);
    expect(timestampDentroDaJanela(String(base), base)).toBe(false); // milissegundos, não segundos
    expect(timestampDentroDaJanela("-1757000000", base)).toBe(false);
  });
});

describe("verificarAssinatura", () => {
  it("valida o par completo", () => {
    const ts = AGORA();
    expect(verificarAssinatura({ segredo: SEGREDO, timestamp: ts, assinatura: assinarCorpo(SEGREDO, ts, CORPO), corpo: CORPO })).toEqual({
      valida: true,
    });
  });

  it("recusa e diz o motivo exato — cabeçalhos ausentes", () => {
    const ts = AGORA();
    expect(verificarAssinatura({ segredo: SEGREDO, timestamp: null, assinatura: "x", corpo: CORPO })).toEqual({
      valida: false,
      motivo: "timestamp_ausente",
    });
    expect(verificarAssinatura({ segredo: SEGREDO, timestamp: ts, assinatura: null, corpo: CORPO })).toEqual({
      valida: false,
      motivo: "assinatura_ausente",
    });
  });

  it("recusa timestamp velho antes de olhar a assinatura", () => {
    const velho = String(Math.floor(Date.now() / 1000) - JANELA_SEGUNDOS - 60);
    expect(verificarAssinatura({ segredo: SEGREDO, timestamp: velho, assinatura: assinarCorpo(SEGREDO, velho, CORPO), corpo: CORPO })).toEqual(
      { valida: false, motivo: "timestamp_fora_da_janela" },
    );
  });

  it("recusa assinatura de outro segredo", () => {
    const ts = AGORA();
    expect(verificarAssinatura({ segredo: SEGREDO, timestamp: ts, assinatura: assinarCorpo("outro", ts, CORPO), corpo: CORPO })).toEqual({
      valida: false,
      motivo: "assinatura_invalida",
    });
  });

  it("recusa corpo adulterado com a assinatura do original (o ataque que a coisa toda existe para barrar)", () => {
    const ts = AGORA();
    const assinatura = assinarCorpo(SEGREDO, ts, CORPO);
    const adulterado = CORPO.replace("concluida", "cancelada");
    expect(verificarAssinatura({ segredo: SEGREDO, timestamp: ts, assinatura, corpo: adulterado })).toEqual({
      valida: false,
      motivo: "assinatura_invalida",
    });
  });
});

describe("cabecalhosAssinados", () => {
  it("produz cabeçalhos que a própria verificação aceita (os dois sentidos usam o mesmo código)", () => {
    const h = cabecalhosAssinados(SEGREDO, CORPO);
    expect(h["Content-Type"]).toBe("application/json");
    expect(
      verificarAssinatura({ segredo: SEGREDO, timestamp: h[CABECALHO_TIMESTAMP], assinatura: h[CABECALHO_ASSINATURA], corpo: CORPO }),
    ).toEqual({ valida: true });
  });

  it("nunca devolve o segredo em cabeçalho nenhum", () => {
    expect(JSON.stringify(cabecalhosAssinados(SEGREDO, CORPO))).not.toContain(SEGREDO);
  });
});

/**
 * A PONTA DO OUTRO LADO. `n8n/ligacao/verificar-hmac.js` é o código que roda
 * dentro do n8n; se ele e `assinatura.ts` discordarem em um detalhe (ordem do
 * `timestamp.corpo`, prefixo `sha256=`, tamanho da janela), a ligação por IA
 * simplesmente para de funcionar e o motivo aparece como "401" num log de n8n.
 * Este bloco casa os dois no mesmo teste.
 */
const { verificar, JANELA_SEGUNDOS: JANELA_N8N } = createRequire(import.meta.url)("../../../n8n/ligacao/verificar-hmac.js") as {
  verificar: (p: { corpoCru: string; timestamp: string; assinatura: string; segredo: string; agoraSegundos?: number }) => {
    valido: boolean;
    motivo: string | null;
  };
  JANELA_SEGUNDOS: number;
};

describe("nó do n8n `verificar-hmac.js` ⇄ assinatura.ts", () => {
  it("os dois lados usam a MESMA janela de tempo", () => {
    expect(JANELA_N8N).toBe(JANELA_SEGUNDOS);
  });

  it("o n8n aceita o que `cabecalhosAssinados` produz", () => {
    const h = cabecalhosAssinados(SEGREDO, CORPO);
    expect(
      verificar({ corpoCru: CORPO, timestamp: h[CABECALHO_TIMESTAMP], assinatura: h[CABECALHO_ASSINATURA], segredo: SEGREDO }),
    ).toEqual({ valido: true, motivo: null });
  });

  it("o SIC-HF aceita o que o n8n assinaria (mesmo algoritmo, sentido inverso)", () => {
    const ts = AGORA();
    const assinatura = "sha256=" + crypto.createHmac("sha256", SEGREDO).update(ts + "." + CORPO).digest("hex");
    expect(verificarAssinatura({ segredo: SEGREDO, timestamp: ts, assinatura, corpo: CORPO })).toEqual({ valida: true });
  });

  it("fail-CLOSED sem a Variable do n8n: inválido com motivo nomeado, nunca 'passa porque não dá para conferir'", () => {
    const h = cabecalhosAssinados(SEGREDO, CORPO);
    expect(verificar({ corpoCru: CORPO, timestamp: h[CABECALHO_TIMESTAMP], assinatura: h[CABECALHO_ASSINATURA], segredo: "" })).toEqual({
      valido: false,
      motivo: "variavel_LIGACAO_IA_WEBHOOK_SECRET_ausente",
    });
  });

  it("recusa replay fora da janela e corpo adulterado, com os mesmos motivos", () => {
    const ts = AGORA();
    const assinatura = "sha256=" + crypto.createHmac("sha256", SEGREDO).update(ts + "." + CORPO).digest("hex");
    expect(
      verificar({ corpoCru: CORPO, timestamp: ts, assinatura, segredo: SEGREDO, agoraSegundos: Number(ts) + JANELA_N8N + 1 }).motivo,
    ).toBe("fora_da_janela");
    expect(verificar({ corpoCru: CORPO + " ", timestamp: ts, assinatura, segredo: SEGREDO }).motivo).toBe("assinatura_invalida");
  });

  it("assinatura vazia não estoura o timingSafeEqual (tamanhos diferentes)", () => {
    const ts = AGORA();
    expect(verificar({ corpoCru: CORPO, timestamp: ts, assinatura: "", segredo: SEGREDO }).motivo).toBe("assinatura_invalida");
  });
});
