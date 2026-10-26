import { describe, expect, test } from "bun:test";
import {
  OPCIONES_REVISION,
  ordenar_partidas_alarma,
  partida_en_alarma,
  normalizar_plantilla,
  bitacora_desde_plantilla,
  llenar_partidas,
  es_error,
  type PartidaRevision,
} from "./control.ts";
import { create_kirlet_test_context, type KirletDefinition } from "@opus-perpetuus/imperium-core-kit";
import { SUBJECT } from "./subject.ts";

async function api(
  server: ReturnType<typeof create_kirlet_test_context>,
  method: string,
  path: string,
  body?: unknown,
) {
  const res = await server.fetch(
    new Request(`http://vehiculos.test${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
  const json = (await res.json().catch(() => ({}))) as {
    data?: any;
    message?: string;
    error?: string;
    mensaje?: string;
  };
  return { status: res.status, json };
}

describe("alarmas en partidas", () => {
  test("opción con alarma y forzada suben al firmar", () => {
    const plantilla = normalizar_plantilla([
      {
        concepto: "Frenos",
        opciones: [
          { value: "pasa", label: "Pasa" },
          { value: "falla", label: "Falla", alarma: true },
          { value: "na", label: "No aplica" },
        ],
        opcion_defecto: "na",
      },
      { concepto: "Llantas", opciones: [...OPCIONES_REVISION], opcion_defecto: "na" },
      {
        concepto: "Luces",
        opciones: [...OPCIONES_REVISION],
        opcion_defecto: "na",
      },
    ]);
    expect(es_error(plantilla)).toBe(false);
    if (es_error(plantilla)) return;
    expect(plantilla[0].opciones.find((o) => o.value === "falla")?.alarma).toBe(true);

    const base = bitacora_desde_plantilla(plantilla);
    expect(es_error(base)).toBe(false);
    if (es_error(base)) return;
    const llenas = llenar_partidas(base, [
      { ...base[0], resultado: "falla" },
      { ...base[1], resultado: "pasa" },
      { ...base[2], resultado: "pasa", alarma_forzada: true },
    ]);
    expect(es_error(llenas)).toBe(false);
    if (es_error(llenas)) return;
    expect(partida_en_alarma(llenas[0])).toBe(true);
    expect(partida_en_alarma(llenas[1])).toBe(false);
    expect(partida_en_alarma(llenas[2])).toBe(true);
    const orden = ordenar_partidas_alarma(llenas).map((p) => p.concepto);
    expect(orden).toEqual(["Frenos", "Luces", "Llantas"]);
  });
});

describe("envio a revisión", () => {
  test("interno y público, firma única del grupo", async () => {
    const server = create_kirlet_test_context(SUBJECT as KirletDefinition);
    try {
      const unidad = await api(server, "POST", "/vehicle", {
        name: "Unidad prueba",
        placas: "ALM-01",
      });
      expect(unidad.status).toBe(201);
      const plantilla = await api(server, "POST", "/plantilla-revision", {
        name: "Salida alarma",
        items: [
          {
            concepto: "Frenos",
            opciones: [
              { value: "pasa", label: "Pasa" },
              { value: "falla", label: "Falla", alarma: true },
              { value: "na", label: "No aplica" },
            ],
            opcion_defecto: "na",
          },
          { concepto: "Aceite", opciones: [...OPCIONES_REVISION], opcion_defecto: "na" },
        ],
      });
      expect(plantilla.status).toBe(201);
      const b1 = await api(server, "POST", "/bitacora", {
        name: "Bitácora A",
        vehicle_id: unidad.json.data.id,
        plantilla_id: plantilla.json.data.id,
        items: [
          {
            concepto: "Frenos",
            opciones: plantilla.json.data.items[0].opciones,
            opcion_defecto: "na",
            resultado: "falla",
          },
          {
            concepto: "Aceite",
            opciones: plantilla.json.data.items[1].opciones,
            opcion_defecto: "na",
            resultado: "pasa",
            alarma_forzada: true,
          },
        ],
      });
      expect(b1.status).toBe(201);
      const b2 = await api(server, "POST", "/bitacora", {
        name: "Bitácora B",
        vehicle_id: unidad.json.data.id,
        plantilla_id: plantilla.json.data.id,
      });
      expect(b2.status).toBe(201);

      const interno = await api(server, "POST", "/bitacora/enviar-revision", {
        bitacora_ids: [b1.json.data.id, b2.json.data.id],
        modo: "interno",
        usuario_id: "u-revisor",
        usuario_nombre: "Revisor",
      });
      expect(interno.status).toBe(201);
      expect(interno.json.data.modo).toBe("interno");
      const detalle = await api(server, "GET", `/envio-revision/${interno.json.data.id}`);
      expect(detalle.status).toBe(200);
      expect(detalle.json.data.bitacoras).toHaveLength(2);
      expect(detalle.json.data.bitacoras[0].items.map((i: {concepto:string}) => i.concepto).slice(0, 2)).toEqual([
        "Frenos",
        "Aceite",
      ]);
      expect(detalle.json.data.bitacoras[0].alarmas).toEqual(["Frenos", "Aceite"]);

      const publico = await api(server, "POST", `/bitacora/${b1.json.data.id}/enviar-revision-publica`, {});
      expect(publico.status).toBe(201);
      expect(publico.json.data.modo).toBe("publico");
      expect(String(publico.json.data.share_hint)).toContain("/internal/envio-revision/");

      const firma = await api(server, "POST", `/envio-revision/publico/${publico.json.data.id}/firmar`, {
        firma: "data:image/png;base64,aaa",
        firmante: "Visitante",
      });
      expect(firma.status).toBe(200);
      expect(firma.json.data.estado).toBe("firmado");
      const bit = await api(server, "GET", `/bitacora/${b1.json.data.id}`);
      expect(bit.json.data.revisada).toBe(true);
      expect(bit.json.data.firma_revisa).toBe("data:image/png;base64,aaa");
    } finally {
      server.stop();
    }
  });
});
