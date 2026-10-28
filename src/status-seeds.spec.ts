import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  push_status_seeds,
  STATUS_OPTION_SEED_PATH,
  STATUS_OPTION_SEEDS,
} from "./status-seeds";

describe("status seeds", () => {
  test("cada seed tiene valores únicos con campo", () => {
    for (const s of STATUS_OPTION_SEEDS) {
      const values = s.options.map((o) => o.value);
      expect(new Set(values).size).toBe(values.length);
      expect(s.options.every((o) => o.field_name === s.status_fields?.[0])).toBe(true);
      expect(
        s.options.every((o) => /^#[0-9a-f]{6}$/.test(o.color) && /^fas fa-[a-z0-9-]+$/.test(o.icon ?? "")),
      ).toBe(true);
      expect(s.model_id.startsWith("subject-vehiculos/")).toBe(true);
    }
  });

  test("input-status sin options literales en vehicle y recurso", () => {
    const vehicle = readFileSync(new URL("./modules/vehicle/vehicle.pages.ts", import.meta.url), "utf8");
    expect(vehicle).toMatch(/name: "estado_operativo",\n\s+component: "input-status",/);
    expect(vehicle).not.toMatch(/name: "estado_operativo"[\s\S]*?options:\s*\[/);
    const recurso = readFileSync(new URL("./recurso.ts", import.meta.url), "utf8");
    expect(recurso).toMatch(/ESTADO_ABIERTO[\s\S]*?component: "input-status"/);
    expect(recurso).not.toMatch(/ESTADO_ABIERTO[\s\S]*?options:\s*\[/);
  });
});

describe("push_status_seeds", () => {
  const env = {
    CORE_DATA_URL: "http://core:3000/api/kirlets/data/x",
    SUBJECT_TECHNICAL_ID: "subject-vehiculos",
    CORE_SUBJECT_GATEWAY_SECRET: "s",
  };
  test("sin env no llama", async () => {
    let called = false;
    const r = await push_status_seeds({
      env: {},
      fetchImpl: (async () => {
        called = true;
        return new Response();
      }) as unknown as typeof fetch,
    });
    expect(r).toEqual({ pushed: false, reason: "core_not_configured" });
    expect(called).toBe(false);
  });
  test("POST entries a seed-defaults del núcleo", async () => {
    let url = "";
    let init: RequestInit | undefined;
    const fetchImpl = (async (u: string, i: RequestInit) => {
      url = u;
      init = i;
      return Response.json({ data: [{ inserted: 1 }] });
    }) as unknown as typeof fetch;
    const r = await push_status_seeds({ env, fetchImpl });
    expect(url).toBe(`http://core:3000${STATUS_OPTION_SEED_PATH}`);
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body.entries.map((e: { model_id: string }) => e.model_id)).toContain(
      "subject-vehiculos/vehicle",
    );
    expect((init?.headers as Record<string, string>)["x-imperium-subject"]).toBe("subject-vehiculos");
    expect(r.pushed).toBe(true);
  });
  test("rechazo del núcleo no lanza", async () => {
    const fetchImpl = (async () => Response.json({ error: "x" }, { status: 401 })) as unknown as typeof fetch;
    expect(await push_status_seeds({ env, fetchImpl })).toEqual({
      pushed: false,
      reason: "core_refused",
      status: 401,
    });
  });
});
