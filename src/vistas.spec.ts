import { describe, expect, test } from "bun:test";
import {
  create_kirlet_test_context,
  today_iso,
  type KirletDefinition,
} from "@opus-perpetuus/imperium-core-kit";
import { sumar_dias } from "./control.ts";
import { SUBJECT } from "./subject.ts";

type Server = ReturnType<typeof create_kirlet_test_context>;

type Campo = {
  name?: string;
  component?: string;
  optionsSource?: string;
};

type Columna = { key?: string };

type MenuItem = {
  label?: string;
  pageId?: string;
  children?: MenuItem[];
};

type Pagina = {
  title?: string;
  page?: {
    props?: {
      form?: { fields?: Campo[] };
      table?: { columns?: Columna[] };
      data?: { list?: string; create?: { action?: string } };
    };
  };
};

const NOMBRE = "Unidad patio";
const PLACAS = "PAT-19";
const SERIE = /^(concepto|resultado|nota)_\d+$/;

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

function ruta_api(url: string): string {
  const marca = "subject-vehiculos/";
  const corte = url.indexOf(marca);
  const resto = corte >= 0 ? url.slice(corte + marca.length) : url.replace(/^\/+/, "");
  return `/${resto.replace(/^\//, "")}`;
}

function etiquetas_del_menu(menu: MenuItem[]): Map<string, string> {
  const etiquetas = new Map<string, string>();
  const recorrer = (items: MenuItem[]) => {
    for (const item of items ?? []) {
      if (item.pageId && item.label) etiquetas.set(item.pageId, item.label);
      if (item.children?.length) recorrer(item.children);
    }
  };
  recorrer(menu);
  return etiquetas;
}

function es_relacion(campo: Campo): boolean {
  return Boolean(campo.name?.endsWith("_id") || campo.name === "chofer" || campo.component === "input-datalist");
}

describe("vistas publicadas", () => {
  test("cada página del manifiesto responde, lista y guarda", async () => {
    const server = create_kirlet_test_context(SUBJECT as KirletDefinition);
    try {
      const hoy = today_iso();
      const manifiesto = await api(server, "GET", "/manifest");
      expect(manifiesto.status).toBe(200);
      const etiquetas = etiquetas_del_menu((manifiesto.json.menu ?? []) as MenuItem[]);
      const publicadas = (manifiesto.json.pages as Array<{ id: string }>).map((pagina) => pagina.id);
      expect(publicadas.length).toBeGreaterThan(0);
      for (const pageId of publicadas) expect(etiquetas.has(pageId)).toBe(true);
      for (const pageId of etiquetas.keys()) expect(publicadas).toContain(pageId);
      expect(publicadas).toContain("vehiculos.recordatorios");

      const paginas = new Map<string, Pagina>();
      for (const pageId of publicadas) {
        console.log("pageId", pageId);
        const pagina = await api(server, "GET", `/pages/${pageId}`);
        expect(pagina.status).toBe(200);
        expect(pagina.json.title).toBe(etiquetas.get(pageId));
        const campos = (pagina.json as Pagina).page?.props?.form?.fields ?? [];
        for (const campo of campos) {
          expect(campo.component === "input-json" || campo.component === "input-code-editor").toBe(false);
          expect(SERIE.test(String(campo.name ?? ""))).toBe(false);
          if (!es_relacion(campo)) continue;
          expect(campo.component).toBe("input-datalist");
          expect(String(campo.optionsSource ?? "")).toContain("as=options");
        }
        const columnas = (pagina.json as Pagina).page?.props?.table?.columns ?? [];
        expect(columnas.length).toBeGreaterThan(0);
        expect(String((pagina.json as Pagina).page?.props?.data?.list ?? "")).toContain("subject-vehiculos/");
        paginas.set(pageId, pagina.json as Pagina);
      }

      const vehicle = await api(server, "POST", "/vehicle", {
        name: NOMBRE,
        placas: PLACAS,
        numero_economico: "19",
        marca: "Nissan",
        modelo: "NP300",
        chofer_nombre: "Marta Ruiz",
        estado_operativo: "en_servicio",
      });
      expect(vehicle.status).toBe(201);
      const vehicle_id = vehicle.json.data.id as string;
      const leido = await api(server, "GET", `/vehicle/${vehicle_id}`);
      expect(leido.status).toBe(200);
      expect(leido.json.data.name).toBe(NOMBRE);
      expect(leido.json.data.placas).toBe(PLACAS);
      expect(leido.json.data.etiqueta).toBe(`${NOMBRE} · ${PLACAS}`);

      const altas: Record<string, Record<string, unknown>> = {
        "plantilla-revision": { name: "Salida de patio", description: "Conceptos de salida" },
        bitacora: { name: "Revisión de salida", vehicle_id },
        falla: { name: "Freno suave", vehicle_id },
        "mantenimiento-correctivo": { name: "Cambio de balatas", vehicle_id, costo: 100 },
        "mantenimiento-preventivo": { name: "Engrase", vehicle_id },
        "servicio-programado": {
          name: "Aceite vencido",
          vehicle_id,
          proxima_fecha: sumar_dias(hoy, -2),
          proxima_lectura: 80000,
          tipo_lectura: "km",
          aviso_dias: 7,
        },
        "lectura-uso": { name: "Lectura de patio", vehicle_id, tipo: "km", valor: 12000 },
        "carga-combustible": {
          name: "Ticket 5512",
          vehicle_id,
          litros: 40,
          precio_litro: 24.5,
          odometro: 12000,
          tanque_lleno: true,
        },
        "documento-vehiculo": {
          name: "Seguro anual",
          vehicle_id,
          tipo: "seguro",
          fecha_vencimiento: sumar_dias(hoy, 5),
          aviso_dias: 15,
        },
      };

      const creados = new Map<string, { id: string; body: Record<string, unknown> }>();
      creados.set("vehicle", { id: vehicle_id, body: { name: NOMBRE, placas: PLACAS } });
      const recursos = new Set<string>();
      for (const pagina of paginas.values()) {
        const action = pagina.page?.props?.data?.create?.action;
        if (!action) continue;
        recursos.add(ruta_api(action).slice(1));
      }
      expect(recursos.has("vehicle")).toBe(true);
      expect(recursos.has("servicio-programado")).toBe(true);
      for (const recurso of recursos) {
        if (recurso === "vehicle") continue;
        const body = altas[recurso];
        expect(body).toBeDefined();
        const alta = await api(server, "POST", `/${recurso}`, body);
        expect(alta.status).toBe(201);
        const id = alta.json.data.id as string;
        const siguiente = await api(server, "GET", `/${recurso}/${id}`);
        expect(siguiente.status).toBe(200);
        expect(siguiente.json.data.name).toBe(body.name);
        if ("vehicle_id" in body) {
          expect(siguiente.json.data.vehicle_id).toBe(vehicle_id);
          expect(siguiente.json.data.vehiculo).toBe(`${NOMBRE} · ${PLACAS}`);
          expect(siguiente.json.data.vehiculo).not.toBe(vehicle_id);
        }
        creados.set(recurso, { id, body });
      }

      const opciones = await api(server, "GET", "/vehicle?as=options&limite=1000");
      const opcion = (opciones.json.data as Array<{ value: string; label: string }>).find(
        (row) => row.value === vehicle_id,
      );
      expect(opcion?.label).toBe(`${NOMBRE} · ${PLACAS}`);

      for (const [pageId, pagina] of paginas) {
        const columnas = (pagina.page?.props?.table?.columns ?? [])
          .map((columna) => String(columna.key ?? ""))
          .filter(Boolean);
        const lista = await api(server, "GET", ruta_api(String(pagina.page?.props?.data?.list)));
        expect(lista.status).toBe(200);
        const filas = lista.json.data as Array<Record<string, unknown>>;
        expect(Array.isArray(filas)).toBe(true);
        const completa = filas.find((fila) => columnas.every((clave) => clave in fila));
        expect(completa).toBeTruthy();
        if (columnas.includes("vehiculo")) {
          expect(completa?.vehiculo).toBe(`${NOMBRE} · ${PLACAS}`);
          expect(completa?.vehiculo).not.toBe(vehicle_id);
        }
        if (pageId === "vehiculos.vehicle") {
          const unidad = filas.find((fila) => fila.id === vehicle_id);
          expect(unidad?.name).toBe(NOMBRE);
          expect(unidad?.placas).toBe(PLACAS);
          expect(unidad?.name).not.toBe(vehicle_id);
        }
        console.log("lista", pageId, filas.length);
      }

      const recordatorios = await api(server, "GET", "/servicio-programado/recordatorios");
      expect(recordatorios.status).toBe(200);
      const vencidos = recordatorios.json.vencidos as Array<{ id: string; vehiculo: string; estado: string }>;
      const por_vencer = recordatorios.json.por_vencer as Array<{ id: string; vehiculo: string; estado: string }>;
      const servicio_id = creados.get("servicio-programado")?.id;
      const documento_id = creados.get("documento-vehiculo")?.id;
      expect(vencidos.map((aviso) => aviso.id)).toContain(servicio_id);
      expect(por_vencer.map((aviso) => aviso.id)).toContain(documento_id);
      expect(vencidos.map((aviso) => aviso.id)).not.toContain(documento_id);
      expect(por_vencer.map((aviso) => aviso.id)).not.toContain(servicio_id);
      for (const aviso of [...vencidos, ...por_vencer]) {
        expect(aviso.vehiculo).toBe(`${NOMBRE} · ${PLACAS}`);
        expect(aviso.estado === "vencido" || aviso.estado === "por_vencer").toBe(true);
      }
    } finally {
      server.stop();
    }
  });
});
