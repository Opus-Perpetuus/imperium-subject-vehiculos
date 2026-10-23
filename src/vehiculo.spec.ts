import { describe, expect, test } from "bun:test";
import {
  create_kirlet_test_context,
  type KirletDefinition,
} from "@opus-perpetuus/imperium-core-kit";
import { SUBJECT } from "./subject.ts";
import { cambios_de_clave, duplicado, limpiar_vehiculo, linea_de_tiempo } from "./vehiculo.ts";

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

describe("vehículo: reglas", () => {
  test("normaliza placas y serie y rechaza números imposibles", () => {
    const patch: Record<string, unknown> = { placas: "  jal-12  34 ", serie: " 3vw1k ", anio: 2020 };
    expect(limpiar_vehiculo(patch, 2026)).toBeNull();
    expect(patch).toEqual({ placas: "JAL-12 34", serie: "3VW1K", anio: 2020 });
    expect(limpiar_vehiculo({ anio: 1800 }, 2026)).toContain("1900");
    expect(limpiar_vehiculo({ anio: 2029 }, 2026)).toContain("2028");
    expect(limpiar_vehiculo({ anio: "" }, 2026)).toBeNull();
    expect(limpiar_vehiculo({ lectura_km: -5 }, 2026)).toContain("Los kilómetros");
  });

  test("solo choca lo que cambia contra vehículos activos de otro registro", () => {
    const activos = [
      { id: "a", placas: "JAL-1", etiqueta: "Pipa", is_active: true },
      { id: "b", placas: "JAL-2", is_active: false },
    ];
    expect(duplicado({ placas: "jal-1" }, activos)?.campo).toBe("placas");
    expect(duplicado({ placas: "JAL-1" }, activos, "a")).toBeNull();
    expect(duplicado({ placas: "JAL-2" }, activos)).toBeNull();
    expect(cambios_de_clave({ placas: "jal-1", name: "x" }, { placas: "JAL-1" })).toEqual({});
  });

  test("la línea de tiempo va de lo nuevo a lo viejo y omite lo borrado", () => {
    const linea = linea_de_tiempo({
      fallas: [{ id: "f1", fecha: "2026-01-02", name: "Freno", estado: "abierto" }],
      cargas: [
        { id: "c1", fecha: "2026-03-01", name: "Carga", costo: 900 },
        { id: "c2", fecha: "2026-04-01", is_active: false },
      ],
    });
    expect(linea.map((e) => e.id)).toEqual(["c1", "f1"]);
    expect(linea[0]).toMatchObject({ clase: "Combustible", costo: 900 });
  });
});

describe("vehículo: API", () => {
  test("placas repetidas dan 409 y el historial suma las cargas", async () => {
    const server = create_kirlet_test_context(SUBJECT as KirletDefinition);
    try {
      const uno = await api(server, "POST", "/vehicle", { name: "Pipa", placas: "jal-100" });
      expect(uno.status).toBe(201);
      expect(uno.json.data.placas).toBe("JAL-100");
      const id = uno.json.data.id as string;

      const repetido = await api(server, "POST", "/vehicle", { name: "Otra", placas: " JAL-100 " });
      expect(repetido.status).toBe(409);

      // Guardar el formulario completo sin cambiar placas no choca consigo mismo.
      const editado = await api(server, "PATCH", `/vehicle/${id}`, { placas: "JAL-100", color: "rojo" });
      expect(editado.status).toBe(200);

      const mal_anio = await api(server, "PATCH", `/vehicle/${id}`, { anio: 1500 });
      expect(mal_anio.status).toBe(400);

      // Un vehículo dado de baja libera sus placas.
      await api(server, "DELETE", `/vehicle/${id}`);
      const reuso = await api(server, "POST", "/vehicle", { name: "Nueva", placas: "JAL-100", tipo_combustible: "diesel" });
      expect(reuso.status).toBe(201);
      const nuevo = reuso.json.data.id as string;

      await api(server, "POST", "/carga-combustible", { name: "C1", vehicle_id: nuevo, litros: 30, precio_litro: 25, odometro: 100 });
      const historial = await api(server, "GET", `/vehicle/${nuevo}/historial`);
      expect(historial.status).toBe(200);
      expect(historial.json.data.cargas_combustible).toHaveLength(1);
      expect(historial.json.data.cargas_combustible[0].tipo_combustible).toBe("diesel");
      expect(historial.json.data.linea_de_tiempo.map((e: { clase: string }) => e.clase)).toContain("Combustible");
    } finally {
      server.stop();
    }
  });
});
