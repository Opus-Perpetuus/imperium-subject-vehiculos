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

const OPCIONES_BASE = [
  { value: "pasa", label: "Pasa" },
  { value: "falla", label: "Falla" },
  { value: "na", label: "No aplica" },
];

function partida_base(concepto: string, resultado = "na", nota?: string) {
  return {
    concepto,
    opciones: OPCIONES_BASE,
    opcion_defecto: "na",
    resultado,
    ...(nota ? { nota } : {}),
  };
}

type Campo = {
  name?: string;
  component?: string;
  label?: string;
  help?: string;
  partidas?: string;
  optionsSource?: string;
  options?: Array<{ value?: string; label?: string }>;
};

function campos_de(pagina: {
  page?: { props?: { form?: { fields?: Campo[] } } };
}): Campo[] {
  return pagina.page?.props?.form?.fields ?? [];
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
      expect(String(falla.json.data.vehiculo)).toContain("ABC-12-34");
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
        partida_base("Luces"),
        partida_base("Llantas"),
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

  test("el manifiesto publica el padrón como hijo distinto de la carpeta", async () => {
    const server = create_kirlet_test_context(SUBJECT as KirletDefinition);
    try {
      const manifiesto = await api(server, "GET", "/manifest");
      expect(manifiesto.status).toBe(200);
      const raiz = manifiesto.json.menu[0] as {
        id: string;
        label: string;
        path?: string;
        children: Array<{ id: string; label: string; path: string; pageId: string }>;
      };
      expect(raiz.id).toBe("vehiculos.root");
      expect(raiz.label).toBe("Vehículos");
      const padron = raiz.children.find((item) => item.id === "vehiculos.vehicle");
      expect(padron).toMatchObject({
        label: "Registro de vehículos",
        path: "padron-vehiculos",
        pageId: "vehiculos.vehicle",
      });
      expect(padron?.path).not.toBe("vehicle");
      expect(raiz.children.filter((item) => item.path === "padron-vehiculos")).toHaveLength(1);
      const pagina = manifiesto.json.pages.find(
        (item: { id: string }) => item.id === "vehiculos.vehicle",
      );
      expect(pagina.path).toBe("padron-vehiculos");
      expect(raiz.children.find((item) => item.id === "vehiculos.falla")?.label).toBe("Fallas");
      expect(raiz.children.find((item) => item.path === "recordatorios")?.label).toBe("Recordatorios");

      const alta = await api(server, "GET", "/pages/vehiculos.vehicle");
      expect(alta.status).toBe(200);
      const campos = campos_de(alta.json);
      expect(campos.some((campo) => campo.name === "ref")).toBe(false);
      expect(campos.find((campo) => campo.name === "chofer")).toMatchObject({
        component: "input-datalist",
        label: "Chofer",
      });
      expect(campos.find((campo) => campo.name === "chofer_nombre")?.component).toBe("input-text");
      expect(campos.find((campo) => campo.name === "tipo_unidad")?.component).toBe("input-radio-buttons");
      expect(campos.find((campo) => campo.name === "estado_operativo")?.component).toBe("input-status");
      expect(campos.find((campo) => campo.name === "estado_operativo")?.options).toEqual([
        { value: "disponible", label: "Disponible", color: "#198754" },
        { value: "asignado", label: "Asignado", color: "#0d6efd" },
        { value: "mantenimiento", label: "Mantenimiento", color: "#ffc107" },
        { value: "inactivo", label: "Inactivo", color: "#dc3545" },
      ]);
      expect(alta.json.page.props.data.create.action).toBe("api://m/subject-vehiculos/vehicle");
    } finally {
      server.stop();
    }
  });

  test("plantilla y bitácora no piden JSON ni ranuras y arman partidas con opciones", async () => {
    const server = create_kirlet_test_context(SUBJECT as KirletDefinition);
    try {
      const serie = /^(concepto|resultado|nota)_\d+$/;
      for (const id of ["vehiculos.plantilla-revision", "vehiculos.bitacora"]) {
        const pagina = await api(server, "GET", `/pages/${id}`);
        expect(pagina.status).toBe(200);
        const campos = campos_de(pagina.json);
        const nombres = campos.map((campo) => campo.name);
        console.log("descriptor", id, nombres);
        expect(campos.some((campo) => serie.test(String(campo.name ?? "")))).toBe(false);
        expect(campos.some((campo) => campo.component === "input-json" || campo.component === "input-code-editor")).toBe(
          false,
        );
        expect(campos.find((campo) => campo.name === "items")?.partidas).toBe(
          id === "vehiculos.bitacora" ? "bitacora" : "plantilla",
        );
        for (const campo of campos) {
          expect(String(campo.help ?? "")).not.toContain("{");
          expect(String(campo.help ?? "")).not.toContain("concepto\":");
        }
      }

      const textos = await api(server, "POST", "/plantilla-revision", {
        name: "Salida",
        conceptos: "Frenos\nLlantas",
      });
      expect(textos.status).toBe(201);
      expect(textos.json.data.items).toEqual([
        { concepto: "Frenos", opciones: OPCIONES_BASE, opcion_defecto: "na" },
        { concepto: "Llantas", opciones: OPCIONES_BASE, opcion_defecto: "na" },
      ]);
      console.log("plantilla solo textos", textos.json.data.items[0]);

      const opciones = [
        { value: "alta", label: "Alta" },
        { value: "baja", label: "Baja" },
      ];
      const plantilla = await api(server, "POST", "/plantilla-revision", {
        name: "Presión",
        items: [{ concepto: "Presión de aire", opciones, opcion_defecto: "alta" }],
      });
      expect(plantilla.status).toBe(201);
      expect(plantilla.json.data.items).toEqual([
        { concepto: "Presión de aire", opciones, opcion_defecto: "alta" },
      ]);
      console.log("plantilla con opciones", plantilla.json.data.items[0]);

      const unidad = await api(server, "POST", "/vehicle", {
        name: "Unidad patio",
        placas: "PAD-01",
      });
      const copiada = await api(server, "POST", "/bitacora", {
        name: "Desde plantilla",
        vehicle_id: unidad.json.data.id,
        plantilla_id: plantilla.json.data.id,
      });
      expect(copiada.status).toBe(201);
      expect(copiada.json.data.items).toEqual([
        { concepto: "Presión de aire", opciones, opcion_defecto: "alta", resultado: "alta" },
      ]);
      console.log("bitácora solo con plantilla", copiada.json.data.items[0]);

      const propias = await api(server, "POST", "/bitacora", {
        name: "Con partidas propias",
        vehicle_id: unidad.json.data.id,
        plantilla_id: plantilla.json.data.id,
        items: [{ concepto: "Propia", resultado: "pasa" }],
      });
      expect(propias.status).toBe(400);

      const por_ranuras = await api(server, "POST", "/bitacora", {
        name: "Cuerpo viejo",
        vehicle_id: unidad.json.data.id,
        concepto_1: "Frenos",
        resultado_1: "pasa",
        concepto_2: "Luces",
        resultado_2: "falla",
      });
      expect(por_ranuras.status).toBe(201);
      expect(por_ranuras.json.data.items).toEqual([
        partida_base("Frenos", "pasa"),
        partida_base("Luces", "falla"),
      ]);
      const leida = await api(server, "GET", `/bitacora/${por_ranuras.json.data.id}`);
      expect(leida.json.data.concepto_1).toBeUndefined();
      expect(leida.json.data.items[0].concepto).toBe("Frenos");

      const vieja = await api(server, "POST", "/bitacora", {
        name: "Partida vieja",
        vehicle_id: unidad.json.data.id,
        items: [{ concepto: "Frenos", resultado: "falla", nota: "Bajo el cárter" }],
      });
      expect(vieja.status).toBe(201);
      expect(vieja.json.data.items).toEqual([partida_base("Frenos", "falla", "Bajo el cárter")]);
      console.log("partida vieja", vieja.json.data.items[0]);

      const fuera = await api(server, "POST", "/bitacora", {
        name: "Resultado ajeno",
        vehicle_id: unidad.json.data.id,
        items: [{ concepto: "Presión de aire", opciones, opcion_defecto: "alta", resultado: "media" }],
      });
      expect(fuera.status).toBe(400);
      console.log("resultado fuera de opciones", fuera.status, fuera.json?.error ?? fuera.json?.message);

      const cambiada = await api(server, "PATCH", `/bitacora/${copiada.json.data.id}`, {
        plantilla_id: textos.json.data.id,
      });
      expect(cambiada.json.data.items).toEqual([
        partida_base("Frenos"),
        partida_base("Llantas"),
      ]);
      const titulo = await api(server, "PATCH", `/bitacora/${copiada.json.data.id}`, {
        name: "Sigue igual",
      });
      expect(titulo.json.data.items).toEqual(cambiada.json.data.items);
    } finally {
      server.stop();
    }
  });

  test("la bitácora con plantilla solo llena resultado y nota de las partidas de la plantilla", async () => {
    const server = create_kirlet_test_context(SUBJECT as KirletDefinition);
    try {
      const opciones = [
        { value: "alta", label: "Alta" },
        { value: "baja", label: "Baja" },
      ];
      const plantilla = await api(server, "POST", "/plantilla-revision", {
        name: "Salida",
        items: [{ concepto: "Frenos" }, { concepto: "Presión", opciones, opcion_defecto: "alta" }],
      });
      const unidad = await api(server, "POST", "/vehicle", { name: "Unidad", placas: "PLA-01" });
      const base = { name: "Revisión", vehicle_id: unidad.json.data.id, plantilla_id: plantilla.json.data.id };
      const presion = { concepto: "Presión", opciones, opcion_defecto: "alta" };

      const llena = await api(server, "POST", "/bitacora", {
        ...base,
        items: [
          { concepto: "Frenos", resultado: "falla", nota: "Rechinan" },
          { ...presion, resultado: "baja" },
        ],
      });
      expect(llena.status).toBe(201);
      expect(llena.json.data.plantilla_nombre).toBe("Salida");
      expect(llena.json.data.items).toEqual([
        partida_base("Frenos", "falla", "Rechinan"),
        { ...presion, resultado: "baja" },
      ]);

      const solo_resultados = await api(server, "POST", "/bitacora", {
        ...base,
        items: [{ resultado: "pasa" }, { resultado: "baja" }],
      });
      expect(solo_resultados.status).toBe(201);
      expect(solo_resultados.json.data.items).toEqual([partida_base("Frenos", "pasa"), { ...presion, resultado: "baja" }]);

      const rechazos: Array<[string, unknown[]]> = [
        ["partida de más", [{ concepto: "Frenos" }, presion, { concepto: "Extra" }]],
        ["partida de menos", [{ concepto: "Frenos" }]],
        ["concepto cambiado", [{ concepto: "Luces" }, presion]],
        ["opciones cambiadas", [{ concepto: "Frenos" }, { ...presion, opciones: [...opciones, { value: "media", label: "Media" }] }]],
        ["etiqueta cambiada", [{ concepto: "Frenos" }, { ...presion, opciones: [opciones[0], { value: "baja", label: "Muy baja" }] }]],
        ["defecto cambiado", [{ concepto: "Frenos" }, { ...presion, opcion_defecto: "baja" }]],
        ["resultado ajeno", [{ concepto: "Frenos" }, { ...presion, resultado: "media" }]],
      ];
      for (const [caso, items] of rechazos) {
        const alta = await api(server, "POST", "/bitacora", { ...base, items });
        expect([caso, alta.status]).toEqual([caso, 400]);
      }
      const por_ranuras = await api(server, "POST", "/bitacora", {
        ...base,
        concepto_1: "Inventada",
        resultado_1: "pasa",
      });
      expect(por_ranuras.status).toBe(400);

      const id = llena.json.data.id as string;
      const resultado = await api(server, "PATCH", `/bitacora/${id}`, {
        items: [{ resultado: "pasa" }, { resultado: "alta", nota: "Ajustada" }],
      });
      expect(resultado.status).toBe(200);
      expect(resultado.json.data.items).toEqual([
        partida_base("Frenos", "pasa", "Rechinan"),
        { ...presion, resultado: "alta", nota: "Ajustada" },
      ]);
      const agrega = await api(server, "PATCH", `/bitacora/${id}`, {
        items: [...resultado.json.data.items, { concepto: "Extra" }],
      });
      expect(agrega.status).toBe(400);
      const quita = await api(server, "PATCH", `/bitacora/${id}`, { items: [] });
      expect(quita.status).toBe(400);
      const renombra = await api(server, "PATCH", `/bitacora/${id}`, {
        items: [{ concepto: "Otra" }, presion],
      });
      expect(renombra.status).toBe(400);
      const leida = await api(server, "GET", `/bitacora/${id}`);
      expect(leida.json.data.items).toEqual(resultado.json.data.items);

      await api(server, "PATCH", `/plantilla-revision/${plantilla.json.data.id}`, {
        items: [{ concepto: "Frenos" }, presion, { concepto: "Luces" }],
      });
      const tras_cambio = await api(server, "PATCH", `/bitacora/${id}`, {
        items: [{ resultado: "falla" }, { resultado: "baja" }],
      });
      expect(tras_cambio.status).toBe(200);
      expect(tras_cambio.json.data.items.map((item: { concepto: string }) => item.concepto)).toEqual([
        "Frenos",
        "Presión",
      ]);

      const otra = await api(server, "POST", "/plantilla-revision", { name: "Llegada", conceptos: "Llantas" });
      const cambia = await api(server, "PATCH", `/bitacora/${id}`, {
        plantilla_id: otra.json.data.id,
        items: [{ concepto: "Frenos" }, presion],
      });
      expect(cambia.status).toBe(400);
      const cambia_bien = await api(server, "PATCH", `/bitacora/${id}`, {
        plantilla_id: otra.json.data.id,
        items: [{ resultado: "pasa" }],
      });
      expect(cambia_bien.status).toBe(200);
      expect(cambia_bien.json.data.plantilla_nombre).toBe("Llegada");
      expect(cambia_bien.json.data.items).toEqual([partida_base("Llantas", "pasa")]);
    } finally {
      server.stop();
    }
  });

  test("las bitácoras viejas con partidas propias siguen abriendo y se llenan sobre lo guardado", async () => {
    const server = create_kirlet_test_context(SUBJECT as KirletDefinition);
    try {
      const plantilla = await api(server, "POST", "/plantilla-revision", { name: "Salida", conceptos: "Frenos" });
      const unidad = await api(server, "POST", "/vehicle", { name: "Unidad", placas: "VIE-01" });
      const ts = new Date().toISOString();
      await server.data.insert("bitacora", {
        id: "bitacora-vieja",
        name: "De antes",
        vehicle_id: unidad.json.data.id,
        plantilla_id: plantilla.json.data.id,
        plantilla_nombre: "Salida",
        fecha: today_iso(),
        items: [{ concepto: "Propia", resultado: "pasa" }],
        imagenes: [],
        revisada: false,
        is_active: true,
        created_at: ts,
        updated_at: ts,
      });
      const leida = await api(server, "GET", "/bitacora/bitacora-vieja");
      expect(leida.status).toBe(200);
      expect(leida.json.data.items).toEqual([partida_base("Propia", "pasa")]);

      const llenada = await api(server, "PATCH", "/bitacora/bitacora-vieja", {
        items: [{ concepto: "Propia", resultado: "falla", nota: "Revisar" }],
      });
      expect(llenada.status).toBe(200);
      expect(llenada.json.data.items).toEqual([partida_base("Propia", "falla", "Revisar")]);
      const redefinida = await api(server, "PATCH", "/bitacora/bitacora-vieja", {
        items: [{ concepto: "Frenos" }],
      });
      expect(redefinida.status).toBe(400);
      const titulo = await api(server, "PATCH", "/bitacora/bitacora-vieja", { name: "Renombrada" });
      expect(titulo.status).toBe(200);
      expect(titulo.json.data.items).toEqual(llenada.json.data.items);

      const libre = await api(server, "POST", "/bitacora", {
        name: "Sin plantilla",
        vehicle_id: unidad.json.data.id,
        items: [{ concepto: "Libre", resultado: "pasa" }],
      });
      expect(libre.status).toBe(201);
      const libre_editada = await api(server, "PATCH", `/bitacora/${libre.json.data.id}`, {
        items: [{ concepto: "Libre" }, { concepto: "Otra", resultado: "falla" }],
      });
      expect(libre_editada.status).toBe(200);
      expect(libre_editada.json.data.items).toHaveLength(2);
    } finally {
      server.stop();
    }
  });

  test("los formularios usan botones y selectores por nombre, y la lista muestra las placas", async () => {
    const server = create_kirlet_test_context(SUBJECT as KirletDefinition);
    try {
      const unidad = await api(server, "POST", "/vehicle", {
        name: "Camioneta de obra",
        placas: "OBR-22",
        numero_economico: "22",
        marca: "Nissan",
        modelo: "NP300",
        chofer_nombre: "Marta Ruiz",
        tipo_unidad: "pickup",
        estado_operativo: "disponible",
      });
      expect(unidad.status).toBe(201);
      expect(unidad.json.data.ref == null || unidad.json.data.ref === "").toBe(true);
      expect(unidad.json.data.etiqueta).toBe("Camioneta de obra · OBR-22");

      const lista = await api(server, "GET", "/vehicle");
      const fila = (lista.json.data as Array<{ id: string; etiqueta: string; placas: string }>).find(
        (row) => row.id === unidad.json.data.id,
      );
      expect(fila?.placas).toBe("OBR-22");
      expect(fila?.etiqueta).toContain("OBR-22");

      const opciones = await api(server, "GET", "/vehicle?as=options&limite=1000");
      const opcion = (opciones.json.data as Array<{ value: string; label: string }>).find(
        (row) => row.value === unidad.json.data.id,
      );
      expect(opcion?.label).toContain("OBR-22");
      expect(opcion?.label).not.toBe(unidad.json.data.id);

      const paginas = [
        "vehiculos.vehicle",
        "vehiculos.falla",
        "vehiculos.mantenimiento-correctivo",
        "vehiculos.mantenimiento-preventivo",
        "vehiculos.servicio-programado",
        "vehiculos.lectura-uso",
        "vehiculos.documento-vehiculo",
        "vehiculos.plantilla-revision",
        "vehiculos.bitacora",
      ];
      const relaciones = new Set([
        "vehicle_id",
        "plantilla_id",
        "chofer",
        "falla_id",
        "servicio_programado_id",
        "bitacora_id",
        "correctivo_id",
      ]);
      for (const id of paginas) {
        const pagina = await api(server, "GET", `/pages/${id}`);
        expect(pagina.status).toBe(200);
        for (const campo of campos_de(pagina.json)) {
          expect(campo.component === "input-json" || campo.component === "input-code-editor").toBe(false);
          if (campo.name && relaciones.has(campo.name)) {
            expect(campo.component).toBe("input-datalist");
            expect(String(campo.optionsSource ?? "")).toContain("as=options");
          }
        }
      }
      const falla_form = campos_de((await api(server, "GET", "/pages/vehiculos.falla")).json);
      expect(falla_form.find((campo) => campo.name === "prioridad")?.component).toBe("input-radio-buttons");
      expect(falla_form.find((campo) => campo.name === "estado")?.component).toBe("input-radio-buttons");
      const documento_form = campos_de((await api(server, "GET", "/pages/vehiculos.documento-vehiculo")).json);
      expect(documento_form.find((campo) => campo.name === "tipo")?.component).toBe("input-radio-buttons");
      const lectura_form = campos_de((await api(server, "GET", "/pages/vehiculos.lectura-uso")).json);
      expect(lectura_form.find((campo) => campo.name === "tipo")?.component).toBe("input-radio-buttons");
      const servicio_form = campos_de((await api(server, "GET", "/pages/vehiculos.servicio-programado")).json);
      expect(servicio_form.find((campo) => campo.name === "tipo_lectura")?.component).toBe("input-radio-buttons");
      expect(servicio_form.find((campo) => campo.name === "estado")?.component).toBe("input-radio-buttons");
      expect(servicio_form.some((campo) => campo.name === "vehicle_id")).toBe(true);

      const falla = await api(server, "POST", "/falla", {
        name: "Freno suave",
        vehicle_id: unidad.json.data.id,
        concepto: "Frenos",
        prioridad: "alta",
        description: "El pedal baja de más",
      });
      expect(falla.status).toBe(201);
      const fallas = await api(server, "GET", "/falla");
      const documento = (fallas.json.data as Array<{ id: string; vehiculo: string }>).find(
        (row) => row.id === falla.json.data.id,
      );
      expect(String(documento?.vehiculo)).toContain("OBR-22");
      expect(String((await api(server, "GET", "/pages/vehiculos.falla")).json.title)).toBe("Fallas");
    } finally {
      server.stop();
    }
  });

  test("una unidad sin etiqueta se elige y se lista por su nombre o sus placas", async () => {
    const server = create_kirlet_test_context(SUBJECT as KirletDefinition);
    try {
      const ts = "2026-01-01T00:00:00.000Z";
      const vehicle_id = "veh_sin_etiqueta";
      await server.data.insert("vehicle", {
        id: vehicle_id,
        name: "Camión de patio",
        placas: "PAT-09",
        numero_economico: "9",
        is_active: true,
        created_at: ts,
        updated_at: ts,
      });
      const opciones = await api(server, "GET", "/vehicle?as=options&limite=1000");
      const opcion = (opciones.json.data as Array<{ value: string; label: string }>).find(
        (row) => row.value === vehicle_id,
      );
      expect(opcion?.label).toBe("Camión de patio · PAT-09");
      const lista = await api(server, "GET", "/vehicle");
      const unidad = (lista.json.data as Array<{ id: string; etiqueta: string }>).find(
        (row) => row.id === vehicle_id,
      );
      expect(unidad?.etiqueta).toBe("Camión de patio · PAT-09");

      await server.data.insert("bitacora", {
        id: "bit_sin_nombre",
        name: "Revisión vieja",
        vehicle_id,
        fecha: "2026-01-01",
        items: [],
        is_active: true,
        revisada: false,
        created_at: ts,
        updated_at: ts,
      });
      await server.data.insert("falla", {
        id: "falla_sin_nombre",
        name: "Falla vieja",
        vehicle_id,
        estado: "abierto",
        is_active: true,
        created_at: ts,
        updated_at: ts,
      });
      const bitacoras = await api(server, "GET", "/bitacora");
      const bitacora = (bitacoras.json.data as Array<{ id: string; vehiculo: string }>).find(
        (row) => row.id === "bit_sin_nombre",
      );
      expect(bitacora?.vehiculo).toBe("Camión de patio · PAT-09");
      const fallas = await api(server, "GET", "/falla");
      const falla = (fallas.json.data as Array<{ id: string; vehiculo: string }>).find(
        (row) => row.id === "falla_sin_nombre",
      );
      expect(falla?.vehiculo).toBe("Camión de patio · PAT-09");
    } finally {
      server.stop();
    }
  });

  test("una bitácora de 40 partidas guarda la nota de la última", async () => {
    const server = create_kirlet_test_context(SUBJECT as KirletDefinition);
    try {
      const unidad = await api(server, "POST", "/vehicle", {
        name: "Unidad larga",
        placas: "LNG-40",
      });
      const items = Array.from({ length: 40 }, (_, indice) =>
        indice === 39
          ? { concepto: "Punto 40", resultado: "falla", nota: "Nota de la última" }
          : { concepto: `Punto ${indice + 1}`, resultado: "na" },
      );
      const creada = await api(server, "POST", "/bitacora", {
        name: "Revisión larga",
        vehicle_id: unidad.json.data.id,
        items,
      });
      expect(creada.status).toBe(201);
      expect(creada.json.data.items).toHaveLength(40);
      expect(creada.json.data.items[39]).toEqual(partida_base("Punto 40", "falla", "Nota de la última"));
      const leida = await api(server, "GET", `/bitacora/${creada.json.data.id}`);
      expect(leida.json.data.items).toHaveLength(40);
      expect(leida.json.data.items[39].nota).toBe("Nota de la última");
      expect(leida.json.data.items[39].concepto).toBe("Punto 40");
      console.log("cuarenta partidas", leida.json.data.items.length, leida.json.data.items[39]);

      const pagina = await api(server, "GET", "/pages/vehiculos.bitacora");
      const campos = campos_de(pagina.json);
      expect(campos.some((campo) => /^(concepto|resultado|nota)_\d+$/.test(String(campo.name ?? "")))).toBe(
        false,
      );
    } finally {
      server.stop();
    }
  });
});
