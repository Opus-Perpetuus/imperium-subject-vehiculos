import { describe, expect, test } from "bun:test";
import {
  create_kirlet_test_context,
  type KirletDefinition,
} from "@opus-perpetuus/imperium-core-kit";
import { armar_recordatorios, sumar_dias } from "./control.ts";
import { paginar, pide_pagina } from "./listado.ts";
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

describe("listado", () => {
  const filas = [
    { id: "1", nombre: "Afinación", n: 3 },
    { id: "2", nombre: "Verificación", n: 1 },
    { id: "3", nombre: "Póliza", n: null },
  ];

  test("busca sin acentos, ordena con vacíos al final y corta la página", () => {
    expect(paginar(filas, { q: "poliza", take: 10, skip: 0 }).data.map((f) => f.id)).toEqual(["3"]);
    expect(paginar(filas, { take: 10, skip: 0, sort: "n:asc" }).data.map((f) => f.id)).toEqual(["2", "1", "3"]);
    expect(paginar(filas, { take: 10, skip: 0, sort: "n:desc" }).data.map((f) => f.id)).toEqual(["1", "2", "3"]);
    const pagina = paginar(filas, { take: 1, skip: 1 });
    expect(pagina).toEqual({ data: [filas[1]!], total_elementos: 3 });
    expect(pide_pagina(new URLSearchParams(""))).toBe(false);
    expect(pide_pagina(new URLSearchParams("limite=10&desde=0"))).toBe(true);
  });

  test("recordatorios: lo más atrasado primero, con textos y sin vehículos de baja", () => {
    const hoy = "2026-10-20";
    const lista = armar_recordatorios({
      hoy,
      servicios: [
        { id: "a", name: "Ayer", vehicle_id: "v", estado: "programado", proxima_fecha: "2026-10-19" },
        { id: "b", name: "Hace un mes", vehicle_id: "v", estado: "programado", proxima_fecha: "2026-09-20" },
        { id: "c", name: "Mañana", vehicle_id: "v", estado: "programado", proxima_fecha: "2026-10-21", aviso_dias: 7 },
        { id: "d", name: "De baja", vehicle_id: "x", estado: "programado", proxima_fecha: "2026-09-01" },
        { id: "e", name: "Aceite", vehicle_id: "v", estado: "programado", tipo_lectura: "km", proxima_lectura: 10000 },
      ],
      documentos: [{ id: "p", name: "Póliza", vehicle_id: "v", fecha_vencimiento: hoy, aviso_dias: 30 }],
      lecturas: { v: { km: 10250, horas: null } },
      inactivos: new Set(["x"]),
    });
    expect(lista.vencidos.map((a) => a.id)).toEqual(["b", "e", "a"]);
    expect(lista.por_vencer.map((a) => a.id)).toEqual(["p", "c"]);
    const por_id = Object.fromEntries(lista.data.map((a) => [a.id, a]));
    expect(por_id.b).toMatchObject({ dias_restantes: -30, estado_texto: "Vencido", motivo_texto: "Venció hace 30 días" });
    expect(por_id.a?.motivo_texto).toBe("Venció hace 1 día");
    expect(por_id.p).toMatchObject({ clase_texto: "Documento", motivo_texto: "Vence hoy" });
    expect(por_id.c?.motivo_texto).toBe("Vence en 1 día");
    expect(por_id.e).toMatchObject({ faltan_lectura: -250, motivo_texto: "Se pasó por 250 km" });
  });

  test("la ruta de recordatorios pagina y busca cuando la lista lo pide", async () => {
    const server = create_kirlet_test_context(SUBJECT as KirletDefinition);
    try {
      const hoy = new Date().toISOString().slice(0, 10);
      const vehicle = await api(server, "POST", "/vehicle", { name: "Grúa", placas: "GRU-1" });
      const vehicle_id = vehicle.json.data.id as string;
      for (const [name, dias] of [["Frenos", -3], ["Llantas", -10], ["Verificación", 2]] as const) {
        await api(server, "POST", "/servicio-programado", {
          name,
          vehicle_id,
          proxima_fecha: sumar_dias(hoy, dias),
          aviso_dias: 7,
        });
      }
      const todo = await api(server, "GET", "/servicio-programado/recordatorios");
      expect(todo.json.data.map((a: { nombre: string }) => a.nombre)).toEqual(["Llantas", "Frenos", "Verificación"]);
      expect(todo.json.total_elementos).toBe(3);

      const pagina = await api(server, "GET", "/servicio-programado/recordatorios?limite=1&desde=1");
      expect(pagina.json.data.map((a: { nombre: string }) => a.nombre)).toEqual(["Frenos"]);
      expect(pagina.json.total_elementos).toBe(3);
      expect(pagina.json.vencidos).toHaveLength(2);

      const busca = await api(server, "GET", "/servicio-programado/recordatorios?termino=verificacion");
      expect(busca.json.data.map((a: { nombre: string }) => a.nombre)).toEqual(["Verificación"]);

      await api(server, "DELETE", `/vehicle/${vehicle_id}`);
      const de_baja = await api(server, "GET", "/servicio-programado/recordatorios");
      expect(de_baja.json.data).toHaveLength(0);
    } finally {
      server.stop();
    }
  });
});
