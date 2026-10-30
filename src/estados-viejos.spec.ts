import { describe, expect, test } from "bun:test";
import type { KirletDataClient } from "@opus-perpetuus/imperium-core-kit";
import { es_estado_viejo, migrar_estados_viejos, VALORES_VIEJOS } from "./estados-viejos";
import { push_status_seeds, seeds_con_retiro, STATUS_OPTION_SEEDS } from "./status-seeds";

type Fila = Record<string, unknown>;

function datos(tablas: Record<string, Fila[]>, falla_en?: string) {
  const data = {
    findMany: async (table: string) => (tablas[table] ?? []).map((f) => ({ ...f })),
    update: async (table: string, where: { id: string }, patch: Fila) => {
      if (where.id === falla_en) return null;
      const f = (tablas[table] ?? []).find((x) => x.id === where.id);
      if (!f) return null;
      Object.assign(f, patch);
      return f;
    },
  };
  return data as unknown as KirletDataClient;
}

describe("estados viejos Abierto/Cerrado", () => {
  test("reconoce variantes y no confunde los nuevos", () => {
    for (const v of ["abierto", "Abierta", " CERRADO ", "cerrada"]) expect(es_estado_viejo(v)).toBe(true);
    for (const v of ["pendiente", "terminado", "", null, "en_proceso"]) expect(es_estado_viejo(v)).toBe(false);
  });

  test("migra cada fila al estatus nuevo y marca el modelo como limpio; es idempotente", async () => {
    const tablas = {
      mantenimiento_correctivo: [
        { id: "c1", estado: "abierto" },
        { id: "c2", estado: "Cerrado" },
        { id: "c3", estado: "autorizado" },
      ],
      mantenimiento_preventivo: [{ id: "p1", estado: "cerrada" }],
    };
    const data = datos(tablas);
    const r = await migrar_estados_viejos(data);
    expect(r.migradas).toEqual({ mantenimiento_correctivo: 2, mantenimiento_preventivo: 1 });
    expect(r.limpios).toEqual(["subject-vehiculos/mantenimiento-correctivo", "subject-vehiculos/mantenimiento-preventivo"]);
    expect(tablas.mantenimiento_correctivo.map((f) => f.estado)).toEqual(["pendiente", "terminado", "autorizado"]);
    expect(tablas.mantenimiento_preventivo[0]!.estado).toBe("terminado");
    expect((await migrar_estados_viejos(data)).migradas).toEqual({ mantenimiento_correctivo: 0, mantenimiento_preventivo: 0 });
  });

  test("si una fila no se pudo migrar, ese modelo no retira las opciones viejas", async () => {
    const data = datos({ mantenimiento_correctivo: [{ id: "c1", estado: "abierto" }], mantenimiento_preventivo: [] }, "c1");
    const r = await migrar_estados_viejos(data);
    expect(r.limpios).toEqual(["subject-vehiculos/mantenimiento-preventivo"]);
  });

  test("solo los modelos limpios llevan retire_values; fallas y documentos conservan Abierto/Cerrado", async () => {
    const entries = seeds_con_retiro(["subject-vehiculos/mantenimiento-correctivo"], VALORES_VIEJOS);
    const con = entries.filter((e) => e.retire_values);
    expect(con.map((e) => e.model_id)).toEqual(["subject-vehiculos/mantenimiento-correctivo"]);
    expect(con[0]!.retire_values).toEqual(["abierto", "cerrado"]);
    // Las opciones vigentes del modelo no incluyen lo que se retira.
    expect(con[0]!.options.some((o) => (VALORES_VIEJOS as readonly string[]).includes(o.value))).toBe(false);
    const falla = STATUS_OPTION_SEEDS.find((e) => e.model_id === "subject-vehiculos/falla")!;
    expect(falla.options.map((o) => o.value)).toEqual(["abierto", "cerrado"]);

    let body: { entries: Array<{ model_id: string; retire_values?: string[] }> } | null = null;
    const fetchImpl = (async (_u: string, i: RequestInit) => {
      body = JSON.parse(String(i.body));
      return Response.json({ data: [] });
    }) as unknown as typeof fetch;
    const env = { CORE_DATA_URL: "http://core:3000", SUBJECT_TECHNICAL_ID: "subject-vehiculos", CORE_SUBJECT_GATEWAY_SECRET: "s" };
    await push_status_seeds({ env, fetchImpl, entries });
    expect(body!.entries.find((e) => e.model_id === "subject-vehiculos/mantenimiento-correctivo")!.retire_values).toEqual(["abierto", "cerrado"]);
  });
});
