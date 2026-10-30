import { describe, expect, test } from "bun:test";
import { create_kirlet_test_context, type KirletDefinition } from "@opus-perpetuus/imperium-core-kit";
import { estado_mantenimiento, estado_reparacion, firma_unica, siguiente_estado_reparacion } from "./autorizacion.ts";
import { color_partida, COLOR_NO_PASA, COLOR_PASA, normalizar_items, partidas_para_vista, type PartidaRevision } from "./control.ts";
import { SUBJECT } from "./subject.ts";

type Server = ReturnType<typeof create_kirlet_test_context>;
const FIRMA = "data:image/png;base64,aaaaaaaaaaaaaaaaaaaa";
const OTRA = "data:image/png;base64,bbbbbbbbbbbbbbbbbbbb";

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

async function con_servidor(fn: (server: Server, vehicle_id: string) => Promise<void>) {
  const server = create_kirlet_test_context(SUBJECT as KirletDefinition);
  try {
    const v = await api(server, "POST", "/vehicle", { name: "Pipa", placas: "PIP-1" });
    await fn(server, v.json.data.id as string);
  } finally {
    server.stop();
  }
}

describe("colores y alarmas de partidas", () => {
  test("verde para pasa, rojo para no pasa, color propio si la opción lo trae", () => {
    const sin_opciones = (resultado: string) => ({ concepto: "A", resultado }) as unknown as PartidaRevision;
    expect(color_partida(sin_opciones("pasa"))).toBe(COLOR_PASA);
    expect(color_partida(sin_opciones("falla"))).toBe(COLOR_NO_PASA);
    expect(color_partida(sin_opciones("na"))).toBe("");
    const propia: PartidaRevision = {
      concepto: "Nivel",
      resultado: "bajo",
      opcion_defecto: "ok",
      opciones: [
        { value: "ok", label: "Ok" },
        { value: "bajo", label: "Bajo", color: "#FFAA00", alarma: true },
      ],
    };
    expect(color_partida(propia)).toBe("#ffaa00");
    const base = normalizar_items([{ concepto: "A", resultado: "pasa" }]) as PartidaRevision[];
    const vista = partidas_para_vista([...base, propia]);
    expect(vista[0]).toMatchObject({ concepto: "Nivel", en_alarma: true, color: "#ffaa00" });
    expect(vista[1]).toMatchObject({ concepto: "A", en_alarma: false, color: COLOR_PASA });
  });

  test("la plantilla guarda el color de cada opción y rechaza colores inválidos", async () => {
    await con_servidor(async (server) => {
      const mala = await api(server, "POST", "/plantilla-revision", {
        name: "Mala",
        items: [{ concepto: "X", opciones: [{ value: "si", label: "Sí", color: "verde" }] }],
      });
      expect(mala.status).toBe(400);
      const buena = await api(server, "POST", "/plantilla-revision", {
        name: "Buena",
        items: [{ concepto: "X", opciones: [{ value: "si", label: "Sí", color: "#00AA00" }, { value: "no", label: "No" }] }],
      });
      expect(buena.status).toBe(201);
      expect(buena.json.data.items[0].opciones[0].color).toBe("#00aa00");
    });
  });
});

describe("estatus y firma única", () => {
  test("valores viejos se traducen y la firma no se repite", () => {
    expect(estado_reparacion("abierto")).toBe("pendiente");
    expect(estado_reparacion("Cerrado")).toBe("terminado");
    expect(estado_reparacion("En proceso")).toBe("en_proceso");
    expect(estado_mantenimiento("autorizado")).toBeNull();
    expect(firma_unica("", FIRMA)).toBe(FIRMA);
    expect(firma_unica(FIRMA, FIRMA)).toBeNull();
    expect(firma_unica(FIRMA, OTRA)).toMatchObject({ status: 409 });
    expect(siguiente_estado_reparacion({ anterior: "pendiente", pedido: "pendiente", firmada: true, firma_nueva: true })).toBe(
      "autorizado",
    );
    expect(
      siguiente_estado_reparacion({ anterior: "pendiente", pedido: "en_proceso", firmada: false, firma_nueva: false }),
    ).toMatchObject({ status: 400 });
  });

  test("reparación: pendiente → autorizada al firmar; sin firma no avanza; se firma una vez", async () => {
    await con_servidor(async (server, vehicle_id) => {
      const r = await api(server, "POST", "/mantenimiento-correctivo", { name: "Frenos", vehicle_id });
      expect(r.status).toBe(201);
      expect(r.json.data.estado).toBe("pendiente");
      const id = r.json.data.id as string;
      const sin_firma = await api(server, "PATCH", `/mantenimiento-correctivo/${id}`, { estado: "en_proceso" });
      expect(sin_firma.status).toBe(400);
      const firmada = await api(server, "PATCH", `/mantenimiento-correctivo/${id}`, { firma_autoriza: FIRMA });
      expect(firmada.status).toBe(200);
      expect(firmada.json.data.estado).toBe("autorizado");
      expect(firmada.json.data.autorizado_at).toBeTruthy();
      const otra = await api(server, "PATCH", `/mantenimiento-correctivo/${id}`, { firma_autoriza: OTRA });
      expect(otra.status).toBe(409);
      const regresar = await api(server, "PATCH", `/mantenimiento-correctivo/${id}`, { estado: "pendiente" });
      expect(regresar.status).toBe(409);
      for (const estado of ["en_proceso", "terminado"]) {
        const paso = await api(server, "PATCH", `/mantenimiento-correctivo/${id}`, { estado });
        expect(paso.status).toBe(200);
        expect(paso.json.data.estado).toBe(estado);
      }
      const cancelada = await api(server, "POST", "/mantenimiento-correctivo", { name: "Otra", vehicle_id, estado: "cancelado" });
      expect(cancelada.json.data.estado).toBe("cancelado");
    });
  });

  test("mantenimiento: estatus propios y firma de revisión opcional de una sola vez", async () => {
    await con_servidor(async (server, vehicle_id) => {
      const m = await api(server, "POST", "/mantenimiento-preventivo", { name: "Aceite", vehicle_id });
      expect(m.json.data.estado).toBe("pendiente");
      const id = m.json.data.id as string;
      const invalido = await api(server, "PATCH", `/mantenimiento-preventivo/${id}`, { estado: "autorizado" });
      expect(invalido.status).toBe(400);
      const terminado = await api(server, "PATCH", `/mantenimiento-preventivo/${id}`, { estado: "terminado" });
      expect(terminado.json.data.estado).toBe("terminado");
      const firma = await api(server, "PATCH", `/mantenimiento-preventivo/${id}`, { firma_revisa: FIRMA });
      expect(firma.status).toBe(200);
      expect(firma.json.data.firmado_at).toBeTruthy();
      const otra = await api(server, "PATCH", `/mantenimiento-preventivo/${id}`, { firma_revisa: OTRA });
      expect(otra.status).toBe(409);
    });
  });
});

describe("compartir para firmar reparaciones y mantenimientos", () => {
  test("envío público autoriza la reparación y firma el mantenimiento con una sola firma", async () => {
    await con_servidor(async (server, vehicle_id) => {
      const r = await api(server, "POST", "/mantenimiento-correctivo", { name: "Clutch", vehicle_id });
      const m = await api(server, "POST", "/mantenimiento-preventivo", { name: "Filtros", vehicle_id });
      const pub = await api(server, "POST", `/mantenimiento-correctivo/${r.json.data.id}/compartir-publica`, {});
      expect(pub.status).toBe(201);
      expect(pub.json.data.reparacion_ids).toEqual([r.json.data.id]);
      expect(pub.json.compartir.ruta).toBe(`/revision-publica/${pub.json.data.id}`);
      // La misma reparación no va en dos envíos vivos.
      const repetido = await api(server, "POST", `/mantenimiento-correctivo/${r.json.data.id}/compartir-interna`, {});
      expect(repetido.status).toBe(409);

      const int = await api(server, "POST", "/mantenimiento-preventivo/compartir-interna", { ids: [m.json.data.id] });
      expect(int.status).toBe(201);
      expect(int.json.data.modo).toBe("interno");

      const vista = await api(server, "GET", `/envio-revision/publico/${pub.json.data.id}`);
      expect(vista.status).toBe(200);
      expect(vista.json.data.reparaciones[0]).toMatchObject({ name: "Clutch", estado: "pendiente", firmado: false });

      const firma = await api(server, "POST", `/envio-revision/publico/${pub.json.data.id}/firmar`, {
        firma: FIRMA,
        firmante: "Director",
      });
      expect(firma.status).toBe(200);
      const leida = await api(server, "GET", `/mantenimiento-correctivo/${r.json.data.id}`);
      expect(leida.json.data.estado).toBe("autorizado");
      expect(leida.json.data.autorizado_por).toBe("Director");
      expect(leida.json.data.firma_autoriza).toBe(FIRMA);
      const de_nuevo = await api(server, "POST", `/envio-revision/publico/${pub.json.data.id}/firmar`, { firma: OTRA });
      expect(de_nuevo.status).toBe(409);
      // Ya firmada no se vuelve a compartir.
      const firmada = await api(server, "POST", "/envio-revision", {
        name: "Otra vez",
        modo: "publico",
        reparacion_ids: [r.json.data.id],
      });
      expect(firmada.status).toBe(409);

      const firma_int = await api(server, "POST", `/envio-revision/${int.json.data.id}/firmar`, { firma: FIRMA });
      expect(firma_int.status).toBe(200);
      const mant = await api(server, "GET", `/mantenimiento-preventivo/${m.json.data.id}`);
      expect(mant.json.data.firma_revisa).toBe(FIRMA);
      expect(mant.json.data.estado).toBe("pendiente");
    });
  });

  test("un envío necesita al menos un registro", async () => {
    await con_servidor(async (server) => {
      const vacio = await api(server, "POST", "/envio-revision", { name: "Nada", modo: "publico" });
      expect(vacio.status).toBe(400);
    });
  });
});

describe("programar desde la bitácora", () => {
  test("al crear y al editar programa revisión, reparación y mantenimiento ligados", async () => {
    await con_servidor(async (server, vehicle_id) => {
      const b = await api(server, "POST", "/bitacora", {
        name: "Salida lunes",
        vehicle_id,
        items: [
          { concepto: "Frenos", resultado: "falla" },
          { concepto: "Luces", resultado: "pasa", alarma_forzada: true },
        ],
        programar_revision: "2026-11-15",
        programar_reparacion: "2026-11-03",
      });
      expect(b.status).toBe(201);
      expect(b.json.data.programar_revision).toBeUndefined();
      const id = b.json.data.id as string;

      const detalle = await api(server, "GET", `/bitacora/${id}`);
      expect(detalle.json.data.items[0]).toMatchObject({ concepto: "Luces", en_alarma: true, color: COLOR_PASA });
      expect(detalle.json.data.items[1]).toMatchObject({ concepto: "Frenos", color: COLOR_NO_PASA });
      expect(String(detalle.json.data.programados_texto)).toContain("Revisión · 2026-11-15");
      expect(String(detalle.json.data.programados_texto)).toContain("Reparación · 2026-11-03");

      const reparaciones = await api(server, "GET", "/mantenimiento-correctivo");
      const rep = (reparaciones.json.data as Array<Record<string, unknown>>).find((f) => f.bitacora_id === id);
      expect(rep).toMatchObject({ estado: "pendiente", vehicle_id });
      expect(String(rep?.description)).toContain("Luces");

      const servicios = await api(server, "GET", "/servicio-programado");
      const srv = (servicios.json.data as Array<Record<string, unknown>>).find((f) => f.bitacora_id === id);
      expect(srv).toMatchObject({ proxima_fecha: "2026-11-15", vehicle_id });

      const editada = await api(server, "PATCH", `/bitacora/${id}`, {
        programar_mantenimiento: "2026-12-01",
        programar_nota: "Cambio de aceite",
        programados_texto: "lo que sea",
      });
      expect(editada.status).toBe(200);
      const mant = await api(server, "GET", "/mantenimiento-preventivo");
      const m = (mant.json.data as Array<Record<string, unknown>>).find((f) => f.bitacora_id === id);
      expect(m).toMatchObject({ estado: "pendiente", description: "Cambio de aceite", fecha: "2026-12-01" });

      // Editar sin pedir nada no programa de nuevo.
      await api(server, "PATCH", `/bitacora/${id}`, { description: "ok" });
      const otra = await api(server, "GET", "/mantenimiento-preventivo");
      expect((otra.json.data as Array<Record<string, unknown>>).filter((f) => f.bitacora_id === id)).toHaveLength(1);

      const mala = await api(server, "PATCH", `/bitacora/${id}`, { programar_revision: "mañana" });
      expect(mala.status).toBe(400);
    });
  });
});
