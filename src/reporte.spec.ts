import { describe, expect, test } from "bun:test";
import {
  create_kirlet_test_context,
  type KirletDefinition,
} from "@opus-perpetuus/imperium-core-kit";
import { periodo_de, reporte_flota } from "./reporte.ts";
import { SUBJECT } from "./subject.ts";

type Server = ReturnType<typeof create_kirlet_test_context>;

async function api(server: Server, method: string, path: string, body?: unknown) {
  const response = await server.fetch(
    new Request(`http://t${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

describe("reporte de flota", () => {
  test("periodo: fechas válidas y en orden", () => {
    expect(periodo_de(new URLSearchParams(""))).toEqual({ desde: null, hasta: null });
    expect(periodo_de(new URLSearchParams("fecha_desde=2026-01-01&fecha_hasta=2026-01-31"))).toEqual({
      desde: "2026-01-01",
      hasta: "2026-01-31",
    });
    expect(periodo_de(new URLSearchParams("fecha_desde=ayer"))).toHaveProperty("error");
    expect(periodo_de(new URLSearchParams("fecha_desde=2026-02-01&fecha_hasta=2026-01-01"))).toHaveProperty("error");
  });

  test("suma por vehículo activo, respeta el periodo y omite lo borrado", () => {
    const { renglones, totales } = reporte_flota({
      vehiculos: [
        { id: "a", name: "Pipa", placas: "P-1" },
        { id: "b", name: "Grúa" },
        { id: "c", name: "Baja", is_active: false },
      ],
      correctivos: [
        { vehicle_id: "a", fecha: "2026-01-10", costo: 1000 },
        { vehicle_id: "a", fecha: "2025-12-31", costo: 5000 },
        { vehicle_id: "a", fecha: "2026-01-11", costo: 700, is_active: false },
      ],
      preventivos: [{ vehicle_id: "b", fecha: "2026-01-05", costo: 300 }],
      cargas: [
        { vehicle_id: "a", fecha: "2026-01-02", litros: 40, costo: 1000, odometro: 1000, tanque_lleno: true, km_recorridos: 0 },
        { vehicle_id: "a", fecha: "2026-01-20", litros: 50, costo: 1250, odometro: 1500, tanque_lleno: true, km_recorridos: 500 },
      ],
      fallas: [
        { vehicle_id: "a", estado: "abierto" },
        { vehicle_id: "a", estado: "cerrado" },
      ],
      vencidos: [],
      periodo: { desde: "2026-01-01", hasta: "2026-01-31" },
    });
    expect(renglones.map((r) => r.id)).toEqual(["a", "b"]);
    expect(renglones[0]).toMatchObject({
      costo_correctivo: 1000,
      costo_combustible: 2250,
      costo_total: 3250,
      litros: 90,
      km_recorridos: 500,
      costo_por_km: 6.5,
      rendimiento_km_l: 10,
      fallas_abiertas: 1,
      vehiculo: "Pipa · P-1",
    });
    expect(renglones[1]).toMatchObject({ costo_total: 300, costo_por_km: null, rendimiento_km_l: null });
    expect(totales).toMatchObject({ costo_total: 3550, km_recorridos: 500, rendimiento_km_l: 10, fallas_abiertas: 1 });
  });

  test("API: reporte de costos y costos negativos rechazados", async () => {
    const server = create_kirlet_test_context(SUBJECT as KirletDefinition);
    try {
      const v = await api(server, "POST", "/vehicle", { name: "Volteo", placas: "VOL-1" });
      const vehicle_id = v.json.data.id as string;
      const negativo = await api(server, "POST", "/mantenimiento-preventivo", {
        name: "Aceite",
        vehicle_id,
        costo: -10,
      });
      expect(negativo.status).toBe(400);
      await api(server, "POST", "/mantenimiento-preventivo", { name: "Aceite", vehicle_id, costo: 800 });
      await api(server, "POST", "/carga-combustible", { name: "C", vehicle_id, litros: 20, costo: 500, odometro: 50 });

      const reporte = await api(server, "GET", "/vehicle/reporte-costos");
      expect(reporte.status).toBe(200);
      expect(reporte.json.total_elementos).toBe(1);
      expect(reporte.json.data[0]).toMatchObject({ id: vehicle_id, costo_total: 1300, costo_preventivo: 800 });
      expect(reporte.json.totales.costo_total).toBe(1300);

      const futuro = await api(server, "GET", "/vehicle/reporte-costos?fecha_desde=2999-01-01");
      expect(futuro.json.data[0].costo_total).toBe(0);
      const mal = await api(server, "GET", "/vehicle/reporte-costos?fecha_hasta=nunca");
      expect(mal.status).toBe(400);

      // La ruta del reporte no se confunde con un vehículo llamado así.
      const uno = await api(server, "GET", `/vehicle/${vehicle_id}`);
      expect(uno.json.data.placas).toBe("VOL-1");
    } finally {
      server.stop();
    }
  });
});
