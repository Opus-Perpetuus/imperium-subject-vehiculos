import { describe, expect, test } from "bun:test";
import { define_crud, field_values_denied } from "./define-crud.js";
import { define_kirlet } from "./define-kirlet.js";
import { define_module } from "./define-module.js";
import { create_kirlet_test_context } from "./serve.js";

const gateways_table = {
  name: "gateways",
  columns: [
    { name: "id", type: "text" as const, primaryKey: true },
    { name: "name", type: "text" as const, notNull: true },
    { name: "config_json", type: "jsonb" as const },
    { name: "api_token", type: "text" as const },
    { name: "webhook_key", type: "text" as const },
    { name: "tags", type: "jsonb" as const },
    { name: "active", type: "boolean" as const },
    { name: "created_at", type: "timestamptz" as const },
    { name: "updated_at", type: "timestamptz" as const },
  ],
};

function gateways() {
  const routes = define_crud({
    resource: "gateways",
    table: "gateways",
    soft_delete: true,
    fields: {
      name: { type: "string", required: true },
      config_json: { type: "json" },
      api_token: { type: "string" },
      webhook_key: { type: "string", secret: true },
      tags: { type: "json", field_values: true },
      active: { type: "boolean" },
    },
  });
  return define_kirlet({
    id: "KIRLET-gw",
    name: "Gateways",
    version: "0.1.0",
    image: "kirel/kirlet-gw:0.1.0",
    compat: { nox: ">=0.5.0", kit: "^0.5.0" },
    schema_version: 2,
    modules: [
      define_module({
        resource: "gateways",
        labels: { singular: "Gateway", plural: "Gateways" },
        routes,
        tables: [gateways_table],
        pages: [],
      }),
    ],
  });
}

describe("field-values no lista credenciales ni blobs json", () => {
  test("la regla por defecto y la opción explícita", () => {
    expect(field_values_denied("config_json", { type: "json" })).toBe(true);
    expect(field_values_denied("custom_data", { type: "string" })).toBe(true);
    expect(field_values_denied("payload", undefined)).toBe(true);
    expect(field_values_denied("spec_json", { type: "string" })).toBe(true);
    expect(field_values_denied("password", { type: "string" })).toBe(true);
    expect(field_values_denied("client_secret", { type: "string" })).toBe(true);
    expect(field_values_denied("access_token", { type: "string" })).toBe(true);
    expect(field_values_denied("api_key", { type: "string" })).toBe(true);
    expect(field_values_denied("pin_hash", { type: "string" })).toBe(true);
    expect(field_values_denied("webhook_key", { type: "string", secret: true })).toBe(true);
    expect(field_values_denied("tags", { type: "json", field_values: true })).toBe(false);
    expect(field_values_denied("estado", { type: "string" })).toBe(false);
    expect(field_values_denied("tokenizer_model", { type: "string" })).toBe(false);
  });

  test("camelCase y PII caen en la regla; field_values: true los abre", () => {
    for (const field of ["clientSecret", "accessToken", "apiKey", "APIKey", "pinHash", "passwordHash", "secretKey", "smtp_pass"]) {
      expect(field_values_denied(field, { type: "string" })).toBe(true);
    }
    for (const field of ["rfc", "proveedor_rfc", "emisorRfc", "curp", "nss", "clabe", "firma", "firma_digital", "img_signature_owner"]) {
      expect(field_values_denied(field, { type: "string" })).toBe(true);
    }
    expect(field_values_denied("rfc", { type: "string", field_values: true })).toBe(false);
    for (const field of ["firma", "firmas", "firma_digital", "firmaDigital", "signature", "withdrawalSignature", "delivery_signature", "img_signature_owner"]) {
      expect(field_values_denied(field, { type: "string" })).toBe(true);
    }
    expect(field_values_denied("foto", { type: "string", list: false })).toBe(true);
    expect(field_values_denied("foto", { type: "string", list: false, field_values: true })).toBe(false);
    expect(field_values_denied("foto", { type: "string" })).toBe(false);
    // `_id`/`_ref` con nombre sensible: solo pasa si el spec declara la FK.
    expect(field_values_denied("domicilio_id", { type: "string" })).toBe(true);
    expect(field_values_denied("domicilio_id", { type: "string", ref: "herr-domicilios" })).toBe(false);
    for (const field of ["firmado_at", "rfcs_count_x", "nssa", "passenger_no", "clientName", "pinned"]) {
      expect(field_values_denied(field, { type: "string" })).toBe(false);
    }
  });

  test("HTTP: 400 validation_error sin filtrar el valor; el resto sigue igual", async () => {
    const server = create_kirlet_test_context(gateways(), { auth_disabled: true });
    const created = await server.fetch(
      new Request("http://t/gateways", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Stripe",
          config_json: { secret_key: "sk_live_x" },
          api_token: "tok_x",
          webhook_key: "whk_x",
          tags: ["pagos"],
        }),
      }),
    );
    expect(created.status).toBeLessThan(300);

    for (const field of ["config_json", "api_token", "webhook_key"]) {
      const res = await server.fetch(new Request(`http://t/gateways/field-values/${field}`));
      expect(res.status).toBe(400);
      const text = await res.text();
      expect(text).toContain("validation_error");
      expect(text).not.toContain("sk_live_x");
      expect(text).not.toContain("tok_x");
      expect(text).not.toContain("whk_x");
    }

    const name = await server.fetch(new Request("http://t/gateways/field-values/name"));
    expect(name.status).toBe(200);
    const tags = await server.fetch(new Request("http://t/gateways/field-values/tags"));
    expect(tags.status).toBe(200);
    server.stop();
  });
});

describe("field-values: misma vista que la lista", () => {
  test("la lista anuncia fv_denied y field-values no enseña filas dadas de baja", async () => {
    const server = create_kirlet_test_context(gateways(), { auth_disabled: true });
    const post = (name: string) =>
      server.fetch(
        new Request("http://t/gateways", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name }),
        }),
      );
    await post("Viva");
    const archived = (await (await post("Archivada")).json()) as { data?: { id?: string }; id?: string };
    const id = String(archived.data?.id ?? archived.id ?? "");
    expect(id).not.toBe("");
    const del = await server.fetch(new Request(`http://t/gateways/${id}`, { method: "DELETE" }));
    expect(del.status).toBeLessThan(300);

    const list = (await (await server.fetch(new Request("http://t/gateways"))).json()) as {
      data: Array<{ name: string }>;
      fv_denied: string[];
    };
    expect(list.data.map((row) => row.name)).toEqual(["Viva"]);
    expect([...list.fv_denied].sort()).toEqual(["api_token", "config_json", "webhook_key"]);

    const values = (await (await server.fetch(new Request("http://t/gateways/field-values/name"))).json()) as {
      data: Array<{ value: string }>;
    };
    expect(values.data.map((option) => option.value)).toEqual(["Viva"]);
    const all = (await (
      await server.fetch(new Request("http://t/gateways/field-values/name?include_inactive=1"))
    ).json()) as { data: Array<{ value: string }> };
    expect(all.data.map((option) => option.value).sort()).toEqual(["Archivada", "Viva"]);
    server.stop();
  });
});

describe("define_crud: campos fuera de la lista", () => {
  test("list: false no viaja en GET /recurso pero sí en el detalle", async () => {
    const { define_crud: crud } = await import("./define-crud.ts");
    const routes = crud({
      resource: "cosa",
      table: "cosa",
      fields: { name: { type: "string" }, foto: { type: "string", list: false } },
    });
    const row = { id: "c1", name: "Una", foto: "data:image/png;base64,AAAA" };
    const ctx = (params: Record<string, string> = {}) =>
      ({
        params,
        query: new URLSearchParams(),
        list_query: () => ({ take: 25, skip: 0 }),
        data: {
          findMany: async () => [row],
          count: async () => 1,
          findOne: async () => row,
        },
      }) as never;
    const list = routes.find((r) => r.pattern === "GET /cosa")!;
    const detail = routes.find((r) => r.pattern === "GET /cosa/:id")!;
    const body = (await (list.handler as (c: never) => Promise<{ data: Record<string, unknown>[] }>)(ctx())) as {
      data: Record<string, unknown>[];
    };
    expect(body.data[0]).toEqual({ id: "c1", name: "Una" });
    const one = (await (detail.handler as (c: never) => Promise<{ data: Record<string, unknown> }>)(ctx({ id: "c1" }))) as {
      data: Record<string, unknown>;
    };
    expect(one.data.foto).toBe("data:image/png;base64,AAAA");
  });
});
