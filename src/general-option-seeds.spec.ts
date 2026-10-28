import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  GENERAL_OPTION_LIST_SEED_PATH,
  GENERAL_OPTION_LIST_SEEDS,
  general_option_list_options_source,
  push_general_option_seeds,
} from "./general-option-seeds";

describe("general option seeds", () => {
  test("optionsSource apunta al control del núcleo", () => {
    expect(general_option_list_options_source("subject-vehiculos/vehicle", "tipo_unidad")).toBe(
      "api://general-option-list-control/options?model_id=subject-vehiculos%2Fvehicle&list_key=tipo_unidad&as=options",
    );
  });

  test("cada lista tiene clave y valores únicos", () => {
    for (const entry of GENERAL_OPTION_LIST_SEEDS) {
      expect(entry.model_id.startsWith("subject-vehiculos/")).toBe(true);
      for (const list of entry.lists) {
        expect(list.list_key.length).toBeGreaterThan(0);
        const values = list.options.map((o) => o.value);
        expect(new Set(values).size).toBe(values.length);
      }
    }
  });

  test("forms B usan optionsSource sin options literales", () => {
    const vehicle = readFileSync(new URL("./modules/vehicle/vehicle.pages.ts", import.meta.url), "utf8");
    expect(vehicle).toContain('name: "tipo_unidad"');
    expect(vehicle).toContain("general_option_list_options_source");
    expect(vehicle).not.toMatch(/name: "tipo_unidad"[\s\S]*?options:\s*\[/);
    const falla = readFileSync(new URL("./modules/falla/falla.routes.ts", import.meta.url), "utf8");
    expect(falla).toContain("general_option_list_options_source");
    expect(falla).not.toMatch(/name: "prioridad"[\s\S]*?options:\s*\[/);
  });

  test("tipo_lectura km/horas sigue literal (técnico C)", () => {
    const servicio = readFileSync(
      new URL("./modules/servicio-programado/servicio-programado.routes.ts", import.meta.url),
      "utf8",
    );
    expect(servicio).toMatch(/name: "tipo_lectura"[\s\S]*?options:\s*\[/);
    const lectura = readFileSync(
      new URL("./modules/lectura-uso/lectura-uso.routes.ts", import.meta.url),
      "utf8",
    );
    expect(lectura).toMatch(/name: "tipo"[\s\S]*?options:\s*\[/);
  });
});

describe("push_general_option_seeds", () => {
  const env = {
    CORE_DATA_URL: "http://core:3000/api/kirlets/data/x",
    SUBJECT_TECHNICAL_ID: "subject-vehiculos",
    CORE_SUBJECT_GATEWAY_SECRET: "s",
  };
  test("sin env no llama", async () => {
    let called = false;
    const r = await push_general_option_seeds({
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
    const r = await push_general_option_seeds({ env, fetchImpl });
    expect(url).toBe(`http://core:3000${GENERAL_OPTION_LIST_SEED_PATH}`);
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body.entries.length).toBe(GENERAL_OPTION_LIST_SEEDS.length);
    expect(r.pushed).toBe(true);
  });
});
