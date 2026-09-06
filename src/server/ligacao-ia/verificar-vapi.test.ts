import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

/**
 * Autenticação do webhook `Vapi → n8n` (achado A1 do pentest, 06/09/2026).
 *
 * Testa o CÓDIGO DO NÓ direto dos arquivos versionados — não uma
 * reimplementação. O que está publicado no n8n é cópia destes arquivos
 * (`n8n/README.md`); se alguém mexer aqui e esquecer de republicar, ao menos o
 * repo continua sendo a verdade escrita.
 */
const require_ = createRequire(import.meta.url);

const { verificarSegredoVapi, CABECALHO_SEGREDO_VAPI } = require_("../../../n8n/ligacao/verificar-vapi.js") as {
  verificarSegredoVapi: (headers: unknown, segredo: unknown) => { valido: boolean; motivo: string | null; fatal: boolean };
  CABECALHO_SEGREDO_VAPI: string;
};

const { verificarVariaveisLancador, corpoCruDoItem } = require_("../../../n8n/ligacao/verificar-hmac.js") as {
  verificarVariaveisLancador: (v: unknown) => { ok: boolean; motivo: string | null };
  corpoCruDoItem: (item: unknown) => { cru: string; bruto: boolean };
};

const SEGREDO = "s3gr3d0-de-servidor-da-vapi-com-64-hex-na-producao";

describe("verificarSegredoVapi · WEBHOOK Vapi → n8n", () => {
  it("aceita o header que a Vapi manda quando o assistant tem server secret", () => {
    const r = verificarSegredoVapi({ [CABECALHO_SEGREDO_VAPI]: SEGREDO }, SEGREDO);
    expect(r).toEqual({ valido: true, motivo: null, fatal: false });
  });

  it("o header é lido sem depender da caixa (X-Vapi-Secret / x-vapi-secret)", () => {
    expect(verificarSegredoVapi({ "X-Vapi-Secret": SEGREDO }, SEGREDO).valido).toBe(true);
    expect(verificarSegredoVapi({ "X-VAPI-SECRET": SEGREDO }, SEGREDO).valido).toBe(true);
  });

  /**
   * A PoC do pentest: um POST anônimo no path público do webhook. Sem header,
   * o nó devolve `[]` — nada é assinado com o `LIGACAO_IA_WEBHOOK_SECRET`, e o
   * n8n deixa de ser oráculo de assinatura.
   */
  it("RECUSA header ausente — e não é erro nosso (fatal: false → `return []`)", () => {
    const r = verificarSegredoVapi({}, SEGREDO);
    expect(r.valido).toBe(false);
    expect(r.motivo).toBe("segredo_vapi_ausente");
    expect(r.fatal).toBe(false);
  });

  it("RECUSA header errado, vazio, só espaço, prefixo e caixa trocada", () => {
    for (const valor of ["errado", "", "   ", SEGREDO.slice(0, -1), SEGREDO + "x", SEGREDO.toUpperCase()]) {
      expect(verificarSegredoVapi({ [CABECALHO_SEGREDO_VAPI]: valor }, SEGREDO).valido).toBe(false);
    }
  });

  it("segredo com espaço em volta ainda casa (n8n Variables costumam vir com \\n)", () => {
    expect(verificarSegredoVapi({ [CABECALHO_SEGREDO_VAPI]: ` ${SEGREDO}\n` }, `${SEGREDO} `).valido).toBe(true);
  });

  it("variável VAPI_SERVER_SECRET ausente é FATAL: o nó lança, não silencia", () => {
    for (const vazio of ["", "   ", null, undefined, 123]) {
      const r = verificarSegredoVapi({ [CABECALHO_SEGREDO_VAPI]: SEGREDO }, vazio);
      expect(r.valido).toBe(false);
      expect(r.motivo).toBe("variavel_VAPI_SERVER_SECRET_ausente");
      expect(r.fatal).toBe(true);
    }
  });

  it("headers ausentes ou de tipo errado não derrubam a função — só recusam", () => {
    for (const h of [null, undefined, "x", 7]) {
      expect(verificarSegredoVapi(h, SEGREDO)).toEqual({ valido: false, motivo: "segredo_vapi_ausente", fatal: false });
    }
  });

  it("header repetido (array) usa o primeiro valor", () => {
    expect(verificarSegredoVapi({ [CABECALHO_SEGREDO_VAPI]: [SEGREDO, "outro"] }, SEGREDO).valido).toBe(true);
    expect(verificarSegredoVapi({ [CABECALHO_SEGREDO_VAPI]: ["outro", SEGREDO] }, SEGREDO).valido).toBe(false);
  });
});

describe("verificarVariaveisLancador · nunca discar sem caminho de volta", () => {
  const ok = { vapiSecret: SEGREDO, callbackUrl: "https://escritorio.grupoparticipa.app.br/api/webhooks/n8n/ligacao" };

  it("com as duas variáveis, libera o disparo", () => {
    expect(verificarVariaveisLancador(ok)).toEqual({ ok: true, motivo: null });
  });

  /**
   * Por que isto é 401 e não "liga assim mesmo": sem estas variáveis a Vapi
   * LIGA para o cliente de verdade, a assistente oferece os horários, o cliente
   * escolhe — e o resultado não volta. O reaper marca `timeout`, conta como
   * tentativa e o sistema REDISCA para a mesma pessoa. O custo do descuido cai
   * no cliente.
   */
  it("sem VAPI_SERVER_SECRET, recusa com o motivo nomeado", () => {
    expect(verificarVariaveisLancador({ ...ok, vapiSecret: "" })).toEqual({ ok: false, motivo: "variavel_VAPI_SERVER_SECRET_ausente" });
    expect(verificarVariaveisLancador({ ...ok, vapiSecret: "  " }).motivo).toBe("variavel_VAPI_SERVER_SECRET_ausente");
    expect(verificarVariaveisLancador({ callbackUrl: ok.callbackUrl }).motivo).toBe("variavel_VAPI_SERVER_SECRET_ausente");
  });

  it("sem SICHF_CALLBACK_URL, recusa com o motivo nomeado", () => {
    expect(verificarVariaveisLancador({ ...ok, callbackUrl: "" })).toEqual({ ok: false, motivo: "variavel_SICHF_CALLBACK_URL_ausente" });
    expect(verificarVariaveisLancador({ vapiSecret: SEGREDO }).motivo).toBe("variavel_SICHF_CALLBACK_URL_ausente");
  });

  it("entrada ausente ou lixo recusa, nunca lança", () => {
    for (const v of [null, undefined, {}, 0, "x"]) {
      expect(verificarVariaveisLancador(v).ok).toBe(false);
    }
  });
});

describe("corpoCruDoItem · I2, Raw Body ausente é dizível", () => {
  it("com Raw Body (binário), devolve os bytes exatos e marca bruto", () => {
    const cru = '{"b":2,"a":1}';
    const item = { binary: { data: { data: Buffer.from(cru, "utf8").toString("base64") } } };
    expect(corpoCruDoItem(item)).toEqual({ cru, bruto: true });
  });

  it("sem Raw Body, reserializa e marca `bruto: false` — o nó vira `corpo_cru_ausente`", () => {
    const r = corpoCruDoItem({ json: { body: { b: 2, a: 1 } } });
    expect(r.bruto).toBe(false);
    // A ordem das chaves do objeto reconstruído não é a do texto assinado: é
    // exatamente por isso que o HMAC falha, e por isso o motivo precisa dizer a
    // verdade em vez de "assinatura_invalida".
    expect(r.cru).toBe('{"b":2,"a":1}');
    expect(corpoCruDoItem({}).cru).toBe("{}");
  });
});
