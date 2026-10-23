import { describe, expect, test } from "bun:test";
import {
  create_kirlet_test_context,
  type KirletDefinition,
} from "@opus-perpetuus/imperium-core-kit";
import { partidas_sin_reporte } from "./control.ts";
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

describe("reportar falla desde la bitácora", () => {
  test("solo las partidas con falla sin reporte abierto, sin repetir", () => {
    const items = [
      { concepto: "Frenos", resultado: "falla" },
      { concepto: "Luces", resultado: "pasa" },
      { concepto: "Llantas", resultado: "falla" },
      { concepto: "llantas ", resultado: "falla" },
      { concepto: "Claxon", resultado: "falla" },
    ];
    const fallas = [
      { concepto: "Frenos", estado: "abierto" },
      { concepto: "Claxon", estado: "cerrado" },
    ];
    expect(partidas_sin_reporte(items, fallas)).toEqual(["Llantas", "Claxon"]);
  });

  test("el botón abre una falla por partida y no duplica al volver a pulsarlo", async () => {
    const server = create_kirlet_test_context(SUBJECT as KirletDefinition);
    try {
      const v = await api(server, "POST", "/vehicle", { name: "Camión", placas: "CAM-9" });
      const vehicle_id = v.json.data.id as string;
      const b = await api(server, "POST", "/bitacora", {
        name: "Salida",
        vehicle_id,
        items: [
          { concepto: "Frenos", resultado: "falla" },
          { concepto: "Luces", resultado: "pasa" },
          { concepto: "Llantas", resultado: "falla" },
        ],
      });
      const bitacora_id = b.json.data.id as string;

      const primera = await api(server, "POST", `/bitacora/${bitacora_id}/reportar-falla`, {});
      expect(primera.status).toBe(201);
      expect(primera.json.fallas.map((f: { concepto: string }) => f.concepto)).toEqual(["Frenos", "Llantas"]);
      expect(primera.json.data.concepto).toBe("Frenos");

      const segunda = await api(server, "POST", `/bitacora/${bitacora_id}/reportar-falla`, {});
      expect(segunda.status).toBe(409);

      // Cerrada la de frenos, el botón vuelve a abrirla.
      await api(server, "PATCH", `/falla/${primera.json.data.id}`, { estado: "cerrado" });
      const tercera = await api(server, "POST", `/bitacora/${bitacora_id}/reportar-falla`, {});
      expect(tercera.json.fallas.map((f: { concepto: string }) => f.concepto)).toEqual(["Frenos"]);

      // A mano sigue creando la que se pida.
      const a_mano = await api(server, "POST", `/bitacora/${bitacora_id}/reportar-falla`, { descripcion: "Ruido" });
      expect(a_mano.status).toBe(201);
      expect(a_mano.json.data.description).toBe("Ruido");

      // Sin partidas con falla, el botón abre una genérica como antes.
      const limpia = await api(server, "POST", "/bitacora", {
        name: "Todo bien",
        vehicle_id,
        items: [{ concepto: "Luces", resultado: "pasa" }],
      });
      const generica = await api(server, "POST", `/bitacora/${limpia.json.data.id}/reportar-falla`, {});
      expect(generica.status).toBe(201);
      expect(generica.json.data.name).toBe("Falla de bitácora");
    } finally {
      server.stop();
    }
  });
});
