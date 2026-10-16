import { describe, expect, test } from "bun:test";
import {
  create_kirlet_test_context,
  today_iso,
  type KirletDefinition,
} from "@opus-perpetuus/imperium-core-kit";
import {
  armar_recordatorios,
  bitacora_revisada,
  clasificar_servicio,
  cumplir_servicio,
  firma_es_trazo,
  odometro_tras_lecturas,
  sumar_dias,
} from "./control.ts";
import { SUBJECT } from "./subject.ts";

const TRAZO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const FOTO_A = `${TRAZO}`;
const FOTO_B =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

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
  const json = text ? JSON.parse(text) : null;
  return { status: response.status, json };
}

describe("cálculo de flota", () => {
  test("un nombre escrito no revisa la bitácora", () => {
    expect(firma_es_trazo("Ana López")).toBe(false);
    expect(firma_es_trazo(TRAZO)).toBe(true);
    expect(bitacora_revisada("Ana López")).toBe(false);
    expect(bitacora_revisada(TRAZO)).toBe(true);
  });

  test("cumplir un servicio vencido lo saca de vencidos o corre la fecha", () => {
    const hoy = "2026-10-16";
    expect(
      clasificar_servicio(
        { proxima_fecha: "2026-10-01", estado: "programado", aviso_dias: 7 },
        { hoy },
      ).estado,
    ).toBe("vencido");
    expect(
      clasificar_servicio(
        { proxima_fecha: "2026-10-20", estado: "programado", aviso_dias: 7 },
        { hoy },
      ).estado,
    ).toBe("por_vencer");
    const cerrado = cumplir_servicio(
      { proxima_fecha: "2026-10-01", estado: "programado", aviso_dias: 7 },
      { fecha: hoy },
    );
    expect(cerrado.estado).toBe("cumplido");
    expect(clasificar_servicio(cerrado, { hoy }).estado).toBe("cumplido");
    const rodado = cumplir_servicio(
      { proxima_fecha: "2026-10-01", intervalo_dias: 30, estado: "programado", aviso_dias: 7 },
      { fecha: hoy },
    );
    expect(rodado.proxima_fecha).toBe("2026-11-15");
    expect(clasificar_servicio(rodado, { hoy }).estado).not.toBe("vencido");
    const lista = armar_recordatorios({
      hoy,
      servicios: [
        { id: "s1", name: "Pasado", vehicle_id: "v", is_active: true, estado: "programado", proxima_fecha: "2026-10-01", aviso_dias: 7 },
        { id: "s2", name: "Hecho", vehicle_id: "v", is_active: true, ...cerrado, aviso_dias: 7 },
      ],
      documentos: [],
      lecturas: {},
    });
    expect(lista.vencidos.map((aviso) => aviso.id)).toEqual(["s1"]);
    expect(lista.por_vencer.map((aviso) => aviso.id)).toEqual([]);
    const rodado_km = cumplir_servicio(
      { tipo_lectura: "km", proxima_lectura: 9000, intervalo_lectura: 5000, estado: "programado" },
      { fecha: hoy, lectura: 10000 },
    );
    expect(rodado_km.proxima_lectura).toBe(15000);
    expect(rodado_km.estado).toBe("programado");
  });

  test("una lectura anterior no pisa el odómetro; editar o borrar la que manda sí recomputa", () => {
    const hoy = "2026-10-16";
    expect(
      odometro_tras_lecturas({
        hoy,
        actual: 10000,
        lecturas: [{ fecha: "2020-01-01", valor: 100, is_active: true }],
        evento: { accion: "alta" },
      }),
    ).toBe(10000);
    expect(
      odometro_tras_lecturas({
        hoy,
        actual: 10000,
        lecturas: [
          { fecha: "2020-01-01", valor: 10000, is_active: true },
          { fecha: "2024-01-01", valor: 100, is_active: true },
        ],
        evento: { accion: "alta" },
      }),
    ).toBe(10000);
    expect(
      odometro_tras_lecturas({
        hoy,
        actual: 5000,
        lecturas: [{ fecha: "2024-01-01", valor: 6000, is_active: true }],
        evento: { accion: "edicion", valor_anterior: 5000 },
      }),
    ).toBe(6000);
    expect(
      odometro_tras_lecturas({
        hoy,
        actual: 8000,
        lecturas: [
          { fecha: "2024-01-01", valor: 5000, is_active: true },
          { fecha: "2025-01-01", valor: 8000, is_active: false },
        ],
        evento: { accion: "baja", valor_anterior: 8000 },
      }),
    ).toBe(5000);
    const cumplido = cumplir_servicio(
      {
        tipo_lectura: "km",
        proxima_lectura: 9000,
        intervalo_lectura: 5000,
        intervalo_dias: 0,
        proxima_fecha: "2026-10-01",
        estado: "programado",
      },
      { fecha: hoy, lectura: 10000 },
    );
    expect(cumplido.proxima_lectura).toBe(15000);
    expect(cumplido.proxima_fecha).toBeNull();
    expect(clasificar_servicio(cumplido, { hoy, lectura_km: 10000 }).estado).not.toBe("vencido");
  });
});

describe("subject de vehículos", () => {
  test("bitácora, falla, mantenimientos, servicios y recordatorios", async () => {
    const server = create_kirlet_test_context(SUBJECT as KirletDefinition);
    try {
      const hoy = today_iso();
      const vehicle = await api(server, "POST", "/vehicle", {
        name: "Camión 12",
        placas: "ABC-12-34",
        numero_economico: "12",
        marca: "Ford",
        modelo: "F-350",
        chofer_nombre: "Luis García",
        lectura_km: 10000,
      });
      expect(vehicle.status).toBe(201);
      const vehicle_id = vehicle.json.data.id as string;

      const sin_revision = await api(server, "POST", "/bitacora", {
        name: "Revisión preoperativa",
        vehicle_id,
        fecha: hoy,
        items: [
          { concepto: "Frenos", resultado: "pasa" },
          { concepto: "Fuga de aceite", resultado: "falla", nota: "Bajo el cárter" },
        ],
        imagenes: [FOTO_A, FOTO_B],
        firma_realiza: TRAZO,
        firma_revisa: "Ana López",
      });
      expect(sin_revision.status).toBe(201);
      expect(sin_revision.json.data.revisada).toBe(false);
      expect(sin_revision.json.data.imagenes).toEqual([FOTO_A, FOTO_B]);
      const bitacora_id = sin_revision.json.data.id as string;

      const revisada = await api(server, "PATCH", `/bitacora/${bitacora_id}`, {
        firma_revisa: TRAZO,
        revisada: false,
      });
      expect(revisada.status).toBe(200);
      expect(revisada.json.data.revisada).toBe(true);
      expect(revisada.json.data.firma_revisa).toBe(TRAZO);
      expect(revisada.json.data.imagenes).toHaveLength(2);

      const otra_vez_nombre = await api(server, "PATCH", `/bitacora/${bitacora_id}`, {
        firma_revisa: "Ana López",
        revisada: true,
      });
      expect(otra_vez_nombre.json.data.revisada).toBe(false);

      await api(server, "PATCH", `/bitacora/${bitacora_id}`, { firma_revisa: TRAZO });

      const falla = await api(server, "POST", `/bitacora/${bitacora_id}/reportar-falla`, {
        descripcion: "Fuga de aceite en cárter",
      });
      expect(falla.status).toBe(201);
      expect(falla.json.data.vehicle_id).toBe(vehicle_id);
      expect(falla.json.data.bitacora_id).toBe(bitacora_id);
      expect(falla.json.data.estado).toBe("abierto");
      expect(falla.json.data.vehicle_id).not.toBe("");
      const falla_id = falla.json.data.id as string;

      const correctivo = await api(server, "POST", "/mantenimiento-correctivo", {
        name: "Cambio de reten",
        falla_id,
        trabajo_realizado: "Se sustituyó el reten",
      });
      expect(correctivo.status).toBe(201);
      expect(correctivo.json.data.vehicle_id).toBe(vehicle_id);
      expect(correctivo.json.data.falla_id).toBe(falla_id);
      expect(correctivo.json.data.estado).toBe("abierto");
      const ligada = await api(server, "GET", `/falla/${falla_id}`);
      expect(ligada.json.data.correctivo_id).toBe(correctivo.json.data.id);

      const preventivo = await api(server, "POST", "/mantenimiento-preventivo", {
        name: "Engrase",
        vehicle_id,
        estado: "abierto",
      });
      expect(preventivo.status).toBe(201);
      expect(preventivo.json.data.estado).toBe("abierto");
      const preventivo_cerrado = await api(server, "PATCH", `/mantenimiento-preventivo/${preventivo.json.data.id}`, {
        estado: "cerrado",
      });
      expect(preventivo_cerrado.json.data.estado).toBe("cerrado");

      const vencido = await api(server, "POST", "/servicio-programado", {
        name: "Afinación vencida",
        vehicle_id,
        proxima_fecha: sumar_dias(hoy, -3),
        aviso_dias: 7,
      });
      expect(vencido.status).toBe(201);
      const por_vencer = await api(server, "POST", "/servicio-programado", {
        name: "Afinación próxima",
        vehicle_id,
        proxima_fecha: sumar_dias(hoy, 3),
        aviso_dias: 7,
      });
      expect(por_vencer.status).toBe(201);
      const lejos = await api(server, "POST", "/servicio-programado", {
        name: "Afinación lejana",
        vehicle_id,
        proxima_fecha: sumar_dias(hoy, 40),
        aviso_dias: 7,
      });

      const avisos = await api(server, "GET", "/servicio-programado/recordatorios");
      expect(avisos.status).toBe(200);
      const ids_vencidos = avisos.json.vencidos.map((aviso: { id: string }) => aviso.id);
      const ids_proximos = avisos.json.por_vencer.map((aviso: { id: string }) => aviso.id);
      expect(ids_vencidos).toContain(vencido.json.data.id);
      expect(ids_proximos).toContain(por_vencer.json.data.id);
      expect(ids_vencidos).not.toContain(por_vencer.json.data.id);
      expect(ids_vencidos).not.toContain(lejos.json.data.id);
      expect(ids_proximos).not.toContain(lejos.json.data.id);

      const cumplido = await api(server, "POST", `/servicio-programado/${vencido.json.data.id}/cumplir`, {
        fecha: hoy,
        trabajo_realizado: "Afinación hecha",
      });
      expect(cumplido.status).toBe(200);
      expect(cumplido.json.data.estado).toBe("cumplido");
      const despues = await api(server, "GET", "/servicio-programado/recordatorios");
      const vencidos_despues = despues.json.vencidos.map((aviso: { id: string }) => aviso.id);
      expect(vencidos_despues).not.toContain(vencido.json.data.id);
      expect(despues.json.por_vencer.map((aviso: { id: string }) => aviso.id)).toContain(por_vencer.json.data.id);

      const por_km = await api(server, "POST", "/servicio-programado", {
        name: "Cambio de aceite por km",
        vehicle_id,
        tipo_lectura: "km",
        proxima_lectura: 9000,
        proxima_fecha: sumar_dias(hoy, 40),
        aviso_dias: 7,
      });
      const con_km = await api(server, "GET", "/servicio-programado/recordatorios");
      expect(con_km.json.vencidos.map((aviso: { id: string; motivo: string }) => aviso.id)).toContain(
        por_km.json.data.id,
      );

      const recurrente = await api(server, "POST", "/servicio-programado", {
        name: "Servicio mensual",
        vehicle_id,
        proxima_fecha: sumar_dias(hoy, -1),
        intervalo_dias: 30,
        aviso_dias: 7,
      });
      const rodado = await api(server, "PATCH", `/servicio-programado/${recurrente.json.data.id}`, {
        estado: "cumplido",
      });
      expect(rodado.json.data.estado).toBe("programado");
      expect(rodado.json.data.proxima_fecha).toBe(sumar_dias(hoy, 30));
      const sin_vencido = await api(server, "GET", "/servicio-programado/recordatorios");
      expect(sin_vencido.json.vencidos.map((aviso: { id: string }) => aviso.id)).not.toContain(
        recurrente.json.data.id,
      );

      const plantilla = await api(server, "POST", "/plantilla-revision", {
        name: "Salida a ruta",
        items: [{ concepto: "Luces" }, { concepto: "Llantas" }],
      });
      const desde_plantilla = await api(server, "POST", "/bitacora", {
        name: "Salida",
        vehicle_id,
        plantilla_id: plantilla.json.data.id,
      });
      expect(desde_plantilla.json.data.items).toEqual([
        { concepto: "Luces", resultado: "na" },
        { concepto: "Llantas", resultado: "na" },
      ]);

      const lectura = await api(server, "POST", "/lectura-uso", {
        name: "Lectura de patio",
        vehicle_id,
        tipo: "km",
        valor: 15400,
        fecha: hoy,
      });
      expect(lectura.status).toBe(201);
      const unidad = await api(server, "GET", `/vehicle/${vehicle_id}`);
      expect(unidad.json.data.lectura_km).toBe(15400);

      const documento = await api(server, "POST", "/documento-vehiculo", {
        name: "Seguro de flotilla",
        vehicle_id,
        tipo: "seguro",
        fecha_vencimiento: sumar_dias(hoy, -1),
        aviso_dias: 15,
      });
      const con_doc = await api(server, "GET", "/servicio-programado/recordatorios");
      expect(
        con_doc.json.vencidos.some(
          (aviso: { id: string; clase: string }) =>
            aviso.id === documento.json.data.id && aviso.clase === "documento",
        ),
      ).toBe(true);
      await api(server, "PATCH", `/documento-vehiculo/${documento.json.data.id}`, { estado: "cerrado" });
      const doc_cerrado = await api(server, "GET", "/servicio-programado/recordatorios");
      expect(doc_cerrado.json.vencidos.map((aviso: { id: string }) => aviso.id)).not.toContain(
        documento.json.data.id,
      );

      const historial = await api(server, "GET", `/vehicle/${vehicle_id}/historial`);
      expect(historial.status).toBe(200);
      expect(historial.json.data.bitacoras.map((row: { id: string }) => row.id)).toContain(bitacora_id);
      expect(historial.json.data.fallas.map((row: { id: string }) => row.id)).toContain(falla_id);
      expect(historial.json.data.correctivos.map((row: { id: string }) => row.id)).toContain(
        correctivo.json.data.id,
      );
      expect(historial.json.data.preventivos.map((row: { id: string }) => row.id)).toContain(
        preventivo.json.data.id,
      );
      expect(historial.json.data.servicios.length).toBeGreaterThan(0);

      const pagina = await api(server, "GET", "/pages/vehiculos.bitacora");
      expect(pagina.status).toBe(200);
      const fields = pagina.json.page.props.form.fields as Array<Record<string, unknown>>;
      const imagenes = fields.find((field) => field.name === "imagenes");
      expect(imagenes?.component).toBe("input-image");
      expect(imagenes?.multiple).toBe(true);
      expect(fields.filter((field) => field.component === "input-signature").map((field) => field.name)).toEqual([
        "firma_realiza",
        "firma_revisa",
      ]);
      expect(String(pagina.json.title)).toContain("Bitácoras");

      for (const id of [
        "vehiculos.falla",
        "vehiculos.mantenimiento-correctivo",
        "vehiculos.mantenimiento-preventivo",
        "vehiculos.servicio-programado",
      ]) {
        const leaf = await api(server, "GET", `/pages/${id}`);
        expect(leaf.status).toBe(200);
        const titulo = String(leaf.json.title);
        expect(titulo.length).toBeGreaterThan(0);
        const form = leaf.json.page.props.form.fields as Array<{ name: string; label: string }>;
        expect(form.some((field) => field.name === "vehicle_id" && field.label === "Vehículo")).toBe(true);
      }

      const manifiesto = await api(server, "GET", "/manifest");
      for (const resource of ["bitacora", "falla", "mantenimiento-correctivo", "mantenimiento-preventivo", "servicio-programado"]) {
        expect(manifiesto.json.resources[resource]).toBe(resource);
      }
    } finally {
      server.stop();
    }
  });

  test("cumplir por uso sin lectura corre la meta, y una fecha anterior no pisa el odómetro", async () => {
    const server = create_kirlet_test_context(SUBJECT as KirletDefinition);
    try {
      const hoy = today_iso();
      const vehicle = await api(server, "POST", "/vehicle", {
        name: "Unidad 7",
        placas: "ZZ-07",
        lectura_km: 10000,
      });
      const vehicle_id = vehicle.json.data.id as string;
      const servicio = await api(server, "POST", "/servicio-programado", {
        name: "Aceite",
        vehicle_id,
        tipo_lectura: "km",
        proxima_lectura: 9000,
        intervalo_lectura: 5000,
        proxima_fecha: sumar_dias(hoy, 40),
        aviso_dias: 7,
      });
      const vencido = await api(server, "GET", "/servicio-programado/recordatorios");
      expect(vencido.json.vencidos.map((aviso: { id: string }) => aviso.id)).toContain(servicio.json.data.id);

      const cumplido = await api(server, "POST", `/servicio-programado/${servicio.json.data.id}/cumplir`, {});
      expect(cumplido.status).toBe(200);
      expect(cumplido.json.data.estado).toBe("programado");
      expect(cumplido.json.data.proxima_lectura).toBe(15000);
      const ya_no = await api(server, "GET", "/servicio-programado/recordatorios");
      expect(ya_no.json.vencidos.map((aviso: { id: string }) => aviso.id)).not.toContain(servicio.json.data.id);

      const otro = await api(server, "POST", "/servicio-programado", {
        name: "Filtro",
        vehicle_id,
        tipo_lectura: "km",
        proxima_lectura: 9000,
        intervalo_lectura: 5000,
        proxima_fecha: sumar_dias(hoy, 40),
        aviso_dias: 7,
      });
      const parchado = await api(server, "PATCH", `/servicio-programado/${otro.json.data.id}`, {
        estado: "cumplido",
      });
      expect(parchado.json.data.proxima_lectura).toBe(15000);

      const vieja = await api(server, "POST", "/lectura-uso", {
        name: "Archivo",
        vehicle_id,
        tipo: "km",
        valor: 100,
        fecha: "2020-01-01",
      });
      expect(vieja.status).toBe(201);
      const unidad = await api(server, "GET", `/vehicle/${vehicle_id}`);
      expect(unidad.json.data.lectura_km).toBe(10000);
      const sigue = await api(server, "POST", "/servicio-programado", {
        name: "Sigue por km",
        vehicle_id,
        tipo_lectura: "km",
        proxima_lectura: 9000,
        proxima_fecha: sumar_dias(hoy, 40),
        aviso_dias: 7,
      });
      const avisos = await api(server, "GET", "/servicio-programado/recordatorios");
      expect(avisos.json.vencidos.map((aviso: { id: string }) => aviso.id)).toContain(sigue.json.data.id);

      await api(server, "PATCH", `/lectura-uso/${vieja.json.data.id}`, { valor: 50 });
      const tras_editar = await api(server, "GET", `/vehicle/${vehicle_id}`);
      expect(tras_editar.json.data.lectura_km).toBe(10000);

      const reciente = await api(server, "POST", "/lectura-uso", {
        name: "Hoy",
        vehicle_id,
        tipo: "km",
        valor: 12000,
        fecha: hoy,
      });
      const subida = await api(server, "GET", `/vehicle/${vehicle_id}`);
      expect(subida.json.data.lectura_km).toBe(12000);
      await api(server, "PATCH", `/lectura-uso/${reciente.json.data.id}`, { valor: 13000 });
      const corregida = await api(server, "GET", `/vehicle/${vehicle_id}`);
      expect(corregida.json.data.lectura_km).toBe(13000);

      const pasado = await api(server, "POST", "/servicio-programado", {
        name: "Aceite con fecha vencida",
        vehicle_id,
        tipo_lectura: "km",
        proxima_lectura: 9000,
        intervalo_lectura: 5000,
        intervalo_dias: 0,
        proxima_fecha: sumar_dias(hoy, -15),
        aviso_dias: 7,
      });
      await api(server, "PATCH", `/vehicle/${vehicle_id}`, { lectura_km: 10000 });
      const cumplido_fecha = await api(server, "POST", `/servicio-programado/${pasado.json.data.id}/cumplir`, {});
      expect(cumplido_fecha.json.data.proxima_lectura).toBe(15000);
      expect(cumplido_fecha.json.data.proxima_fecha).toBeNull();
      const sin_fecha = await api(server, "GET", "/servicio-programado/recordatorios");
      expect(sin_fecha.json.vencidos.map((aviso: { id: string }) => aviso.id)).not.toContain(pasado.json.data.id);
    } finally {
      server.stop();
    }
  });

  test("la lectura anterior a hoy se edita, avanza y al borrar la nueva queda la anterior", async () => {
    const server = create_kirlet_test_context(SUBJECT as KirletDefinition);
    try {
      const vehicle = await api(server, "POST", "/vehicle", { name: "Sin km", placas: "SN-01" });
      const vehicle_id = vehicle.json.data.id as string;
      const primera = await api(server, "POST", "/lectura-uso", {
        name: "2024",
        vehicle_id,
        tipo: "km",
        valor: 5000,
        fecha: "2024-01-01",
      });
      expect((await api(server, "GET", `/vehicle/${vehicle_id}`)).json.data.lectura_km).toBe(5000);
      await api(server, "PATCH", `/lectura-uso/${primera.json.data.id}`, { valor: 6000 });
      expect((await api(server, "GET", `/vehicle/${vehicle_id}`)).json.data.lectura_km).toBe(6000);
      const segunda = await api(server, "POST", "/lectura-uso", {
        name: "2025",
        vehicle_id,
        tipo: "km",
        valor: 9000,
        fecha: "2025-01-01",
      });
      expect((await api(server, "GET", `/vehicle/${vehicle_id}`)).json.data.lectura_km).toBe(9000);
      await api(server, "DELETE", `/lectura-uso/${segunda.json.data.id}`);
      expect((await api(server, "GET", `/vehicle/${vehicle_id}`)).json.data.lectura_km).toBe(6000);

      const cargado = await api(server, "POST", "/vehicle", {
        name: "Con km",
        placas: "CN-02",
        lectura_km: 10000,
      });
      const cargado_id = cargado.json.data.id as string;
      await api(server, "POST", "/lectura-uso", {
        name: "2020 igual",
        vehicle_id: cargado_id,
        tipo: "km",
        valor: 10000,
        fecha: "2020-01-01",
      });
      await api(server, "POST", "/lectura-uso", {
        name: "2024 baja",
        vehicle_id: cargado_id,
        tipo: "km",
        valor: 100,
        fecha: "2024-01-01",
      });
      expect((await api(server, "GET", `/vehicle/${cargado_id}`)).json.data.lectura_km).toBe(10000);
      const hoy = today_iso();
      const servicio = await api(server, "POST", "/servicio-programado", {
        name: "Sigue vencido",
        vehicle_id: cargado_id,
        tipo_lectura: "km",
        proxima_lectura: 9000,
        proxima_fecha: sumar_dias(hoy, 40),
        aviso_dias: 7,
      });
      const avisos = await api(server, "GET", "/servicio-programado/recordatorios");
      expect(avisos.json.vencidos.map((aviso: { id: string }) => aviso.id)).toContain(servicio.json.data.id);
    } finally {
      server.stop();
    }
  });
});
