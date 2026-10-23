import { describe, expect, test } from "bun:test";
import {
  create_kirlet_test_context,
  type KirletDefinition,
} from "@opus-perpetuus/imperium-core-kit";
import { completar_importe, rendimiento_de_carga, rendimiento_promedio } from "./combustible.ts";
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

describe("combustible: cálculo", () => {
  test("con dos de litros, precio y costo se calcula el tercero", () => {
    expect(completar_importe({ litros: 40, precio_litro: 24.5 })).toEqual({ litros: 40, precio_litro: 24.5, costo: 980 });
    expect(completar_importe({ litros: 40, costo: 1000 })).toEqual({ litros: 40, precio_litro: 25, costo: 1000 });
    expect(completar_importe({ litros: 0, costo: 1000 })).toEqual({ error: "la carga necesita litros mayores a cero" });
    expect(completar_importe({ litros: 10, costo: -1 })).toEqual({ error: "el costo no puede ser negativo" });
  });

  test("el rendimiento va de tanque lleno a tanque lleno e incluye las cargas parciales", () => {
    const previas = [
      { id: "a", fecha: "2026-10-01", odometro: 1000, litros: 40, tanque_lleno: true },
      { id: "b", fecha: "2026-10-05", odometro: 1200, litros: 10, tanque_lleno: false },
    ];
    expect(
      rendimiento_de_carga(previas, { fecha: "2026-10-09", odometro: 1500, litros: 30, tanque_lleno: true }),
    ).toEqual({ km_recorridos: 300, rendimiento_km_l: 12.5 });
    // Parcial: km sí, rendimiento no.
    expect(
      rendimiento_de_carga(previas, { fecha: "2026-10-09", odometro: 1500, litros: 30, tanque_lleno: false }),
    ).toEqual({ km_recorridos: 300, rendimiento_km_l: null });
    // Primera carga del vehículo.
    expect(rendimiento_de_carga([], { fecha: "2026-10-09", odometro: 1500, litros: 30, tanque_lleno: true })).toEqual({
      km_recorridos: null,
      rendimiento_km_l: null,
    });
  });

  test("un odómetro que retrocede frente a una carga anterior se rechaza", () => {
    const previas = [{ id: "a", fecha: "2026-10-01", odometro: 1000, litros: 40, tanque_lleno: true }];
    const r = rendimiento_de_carga(previas, { fecha: "2026-10-02", odometro: 900, litros: 10 });
    expect("error" in r && r.error).toContain("menor que el de la carga del 2026-10-01");
    // Editar la misma carga no choca consigo misma.
    expect(rendimiento_de_carga(previas, { id: "a", fecha: "2026-10-01", odometro: 950, litros: 40 })).toEqual({
      km_recorridos: null,
      rendimiento_km_l: null,
    });
  });

  test("el promedio ignora las cargas borradas", () => {
    const cargas = [
      { id: "a", fecha: "2026-10-01", odometro: 1000, litros: 40, tanque_lleno: true },
      { id: "b", fecha: "2026-10-05", odometro: 1200, litros: 99, tanque_lleno: false, is_active: false },
      { id: "c", fecha: "2026-10-09", odometro: 1400, litros: 40, tanque_lleno: true },
    ];
    expect(rendimiento_promedio(cargas)).toEqual({ km: 400, litros: 40, rendimiento_km_l: 10 });
  });
});

describe("combustible: API", () => {
  test("las cargas calculan costo y km/l y suben el odómetro del vehículo", async () => {
    const server = create_kirlet_test_context(SUBJECT as KirletDefinition);
    try {
      const vehicle = await api(server, "POST", "/vehicle", { name: "Pipa 3", placas: "PIP-3" });
      const vehicle_id = vehicle.json.data.id as string;
      const primera = await api(server, "POST", "/carga-combustible", {
        name: "T1", vehicle_id, fecha: "2026-10-01", litros: 50, precio_litro: 25, odometro: 10000, tanque_lleno: true,
      });
      expect(primera.status).toBe(201);
      expect(primera.json.data.costo).toBe(1250);
      expect(primera.json.data.vehiculo).toBe("Pipa 3 · PIP-3");
      const segunda = await api(server, "POST", "/carga-combustible", {
        name: "T2", vehicle_id, fecha: "2026-10-08", litros: 40, costo: 1000, odometro: 10480,
      });
      expect(segunda.status).toBe(201);
      expect(segunda.json.data.precio_litro).toBe(25);
      expect(segunda.json.data.tanque_lleno).toBe(true);
      expect(segunda.json.data.km_recorridos).toBe(480);
      expect(segunda.json.data.rendimiento_km_l).toBe(12);

      const unidad = await api(server, "GET", `/vehicle/${vehicle_id}`);
      expect(unidad.json.data.lectura_km).toBe(10480);
      const lecturas = await api(server, "GET", "/lectura-uso");
      expect((lecturas.json.data as Array<{ vehicle_id: string }>).filter((l) => l.vehicle_id === vehicle_id).length).toBe(2);

      const atras = await api(server, "POST", "/carga-combustible", {
        name: "T3", vehicle_id, fecha: "2026-10-09", litros: 10, costo: 250, odometro: 9000,
      });
      expect(atras.status).toBe(400);

      const editada = await api(server, "PATCH", `/carga-combustible/${segunda.json.data.id}`, { litros: 48 });
      expect(editada.status).toBe(200);
      expect(editada.json.data.costo).toBe(1200);
      expect(editada.json.data.rendimiento_km_l).toBe(10);

      const sin_litros = await api(server, "POST", "/carga-combustible", { name: "T4", vehicle_id, litros: 0 });
      expect(sin_litros.status).toBe(400);
    } finally {
      server.stop();
    }
  });
});
