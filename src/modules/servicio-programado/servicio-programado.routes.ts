import {
  KirletHttpError,
  now_iso,
  today_iso,
  type DomainRow,
} from "@opus-perpetuus/imperium-core-kit";
import {
  armar_recordatorios,
  cumplir_servicio,
  etiqueta_vehiculo,
  fecha_iso,
  numero,
  pide_cumplir,
  servicio_vista,
  validar_servicio,
} from "../../control.ts";
import { paginar, pide_pagina } from "../../listado.ts";
import { API, VEHICULO, definir_recurso, define_routes, pagina_lista } from "../../recurso.ts";

async function lectura_para_cumplir(
  ctx: { data: { findOne: (table: string, where: { id: string }) => Promise<DomainRow | null> } },
  row: DomainRow,
  body: Record<string, unknown>,
): Promise<number | null> {
  const explicita = numero(body.lectura ?? body.ultima_lectura);
  if (explicita != null) return explicita;
  const tipo = row.tipo_lectura === "horas" ? "horas" : row.tipo_lectura === "km" ? "km" : null;
  if (!tipo) return null;
  const vehicle = await ctx.data.findOne("vehicle", { id: String(row.vehicle_id ?? "") });
  if (!vehicle) return null;
  return numero(tipo === "horas" ? vehicle.lectura_horas : vehicle.lectura_km);
}

async function cumplir_fila(
  ctx: { data: { findOne: (table: string, where: { id: string }) => Promise<DomainRow | null> } },
  row: DomainRow,
  body: Record<string, unknown>,
): Promise<DomainRow> {
  const fecha = fecha_iso(body.fecha) ?? fecha_iso(body.ultima_fecha) ?? today_iso();
  const next = cumplir_servicio(servicio_vista(row), {
    fecha,
    lectura: await lectura_para_cumplir(ctx, row, body),
  });
  return {
    ...next,
    ...(body.trabajo_realizado != null ? { trabajo_realizado: String(body.trabajo_realizado) } : {}),
  };
}

export const servicio_programado_module = definir_recurso({
  resource: "servicio-programado",
  table: "servicio_programado",
  singular: "Servicio programado",
  plural: "Servicios programados",
  order: 70,
  subtitle: "Por fecha y, si el vehículo tiene lectura, también por kilómetros u horas",
  columns: [
    { name: "vehicle_id", type: "text", notNull: true },
    { name: "tipo_lectura", type: "text" },
    { name: "proxima_fecha", type: "text" },
    { name: "intervalo_dias", type: "real" },
    { name: "proxima_lectura", type: "real" },
    { name: "intervalo_lectura", type: "real" },
    { name: "aviso_dias", type: "real" },
    { name: "aviso_lectura", type: "real" },
    { name: "estado", type: "text", notNull: true, default: "programado" },
    { name: "ultima_fecha", type: "text" },
    { name: "ultima_lectura", type: "real" },
    { name: "trabajo_realizado", type: "text" },
  ],
  fields: {
    vehicle_id: { type: "string", required: true, search: true },
    tipo_lectura: { type: "string" },
    proxima_fecha: { type: "string", search: true },
    intervalo_dias: { type: "number" },
    proxima_lectura: { type: "number" },
    intervalo_lectura: { type: "number" },
    aviso_dias: { type: "number" },
    aviso_lectura: { type: "number" },
    estado: { type: "string", search: true },
    ultima_fecha: { type: "string" },
    ultima_lectura: { type: "number" },
    trabajo_realizado: { type: "string", search: true },
  },
  list: [
    { key: "name", label: "Servicio" },
    { key: "vehiculo", label: "Vehículo" },
    { key: "proxima_fecha", label: "Próxima fecha" },
    { key: "proxima_lectura", label: "Próxima lectura" },
    { key: "estado", label: "Estado" },
  ],
  form: [
    { name: "name", component: "input-text", label: "Servicio", required: true },
    VEHICULO,
    { name: "description", component: "input-textarea", label: "Qué incluye" },
    { name: "proxima_fecha", component: "input-date", label: "Próxima fecha" },
    { name: "intervalo_dias", component: "input-number", label: "Repetir cada (días)", min: 0 },
    {
      name: "tipo_lectura",
      component: "input-radio-buttons",
      label: "Lectura de uso",
      options: [
        { value: "", label: "Solo fecha" },
        { value: "km", label: "Kilómetros" },
        { value: "horas", label: "Horas de motor" },
      ],
    },
    { name: "proxima_lectura", component: "input-number", label: "Próxima lectura", min: 0 },
    { name: "intervalo_lectura", component: "input-number", label: "Repetir cada (lectura)", min: 0 },
    { name: "aviso_dias", component: "input-number", label: "Avisar días antes", min: 0 },
    { name: "aviso_lectura", component: "input-number", label: "Avisar unidades antes", min: 0 },
    {
      name: "estado",
      component: "input-radio-buttons",
      label: "Estado",
      help: "Marcarlo cumplido quita el aviso o corre la siguiente fecha o lectura.",
      options: [
        { value: "programado", label: "Programado" },
        { value: "cumplido", label: "Cumplido" },
      ],
    },
    { name: "trabajo_realizado", component: "input-textarea", label: "Trabajo realizado" },
  ],
  acciones: [
    {
      id: "cumplir",
      label: "Registrar realizado",
      confirm: "Se registra el servicio y se corre el siguiente vencimiento, si es recurrente.",
      method: "POST",
      action: `${API}/servicio-programado/:id/cumplir`,
    },
  ],
  pages_extra: [
    pagina_lista({
      id: "vehiculos.recordatorios",
      path: "recordatorios",
      listPath: "servicio-programado/recordatorios",
      title: "Recordatorios",
      subtitle: "Servicios y documentos por vencer o vencidos",
      plural: "recordatorios",
      singular: "recordatorio",
      permissionResource: "servicio-programado",
      columns: [
        { key: "estado_texto", label: "Aviso" },
        { key: "nombre", label: "Nombre" },
        { key: "vehiculo", label: "Vehículo" },
        { key: "motivo_texto", label: "Cuándo" },
        { key: "proxima_fecha", label: "Fecha" },
        { key: "clase_texto", label: "Clase" },
      ],
    }),
  ],
  menu_extra: [
    {
      id: "vehiculos.recordatorios",
      label: "Recordatorios",
      order: 75,
      pageId: "vehiculos.recordatorios",
      path: "recordatorios",
      permission: "subject.vehiculos.servicio-programado.read",
      icon: "document",
    },
  ],
  extra_routes: define_routes({
    "GET /servicio-programado/recordatorios": async (ctx) => {
      const hoy = fecha_iso(ctx.query.get("hoy")) ?? today_iso();
      const [servicios, documentos, vehiculos] = await Promise.all([
        ctx.data.findMany("servicio_programado", { limit: 10000 }),
        ctx.data.findMany("documento_vehiculo", { limit: 10000 }),
        ctx.data.findMany("vehicle", { limit: 10000 }),
      ]);
      const inactivos = new Set(
        vehiculos.filter((vehicle) => vehicle.is_active === false).map((vehicle) => String(vehicle.id)),
      );
      const lecturas: Record<string, { km: number | null; horas: number | null }> = {};
      for (const vehicle of vehiculos) {
        lecturas[String(vehicle.id)] = {
          km: numero(vehicle.lectura_km),
          horas: numero(vehicle.lectura_horas),
        };
      }
      const avisos = armar_recordatorios({ hoy, servicios, documentos, lecturas, inactivos });
      const nombres = new Map(
        vehiculos.map((vehicle) => [String(vehicle.id), etiqueta_vehiculo(vehicle)]),
      );
      const con_nombre = <T extends { vehicle_id: string }>(fila: T) => ({
        ...fila,
        vehiculo: nombres.get(fila.vehicle_id) ?? fila.vehicle_id,
      });
      // `data` es la página que pide la lista; vencidos y por_vencer van completos.
      const filas = avisos.data.map(con_nombre);
      const pagina = pide_pagina(ctx.query)
        ? paginar(filas, ctx.list_query())
        : { data: filas, total_elementos: filas.length };
      return {
        ...pagina,
        vencidos: avisos.vencidos.map(con_nombre),
        por_vencer: avisos.por_vencer.map(con_nombre),
      };
    },
    "POST /servicio-programado/:id/cumplir": async (ctx) => {
      const existing = await ctx.data.findOne("servicio_programado", { id: ctx.params.id });
      if (!existing || existing.is_active === false) return ctx.not_found();
      const body = (await ctx.body<Record<string, unknown>>()) ?? {};
      let next: DomainRow;
      try {
        next = await cumplir_fila(ctx, existing, body);
      } catch (error) {
        const message = error instanceof Error ? error.message : "no se pudo cumplir el servicio";
        throw new KirletHttpError(400, "validation_error", message);
      }
      const updated = await ctx.data.update("servicio_programado", { id: ctx.params.id }, {
        ...next,
        updated_at: now_iso(),
      });
      return { data: updated };
    },
  }),
  hooks: {
    async before_create(ctx, row) {
      if (row.aviso_dias == null) row.aviso_dias = 7;
      if (row.aviso_lectura == null) row.aviso_lectura = 0;
      if (!row.estado) row.estado = "programado";
      if (row.tipo_lectura == null) row.tipo_lectura = "";
      const error = validar_servicio(servicio_vista(row));
      if (error) throw new KirletHttpError(400, "validation_error", error);
      if (pide_cumplir(row.estado)) {
        return { ...row, ...(await cumplir_fila(ctx, row, { fecha: today_iso() })) };
      }
      return row;
    },
    async before_update(ctx, _id, patch, existing) {
      if (!pide_cumplir(patch.estado) || existing.estado === "cumplido") {
        const error = validar_servicio(servicio_vista({ ...existing, ...patch }));
        if (error) throw new KirletHttpError(400, "validation_error", error);
        return patch;
      }
      try {
        return { ...patch, ...(await cumplir_fila(ctx, existing, patch)) };
      } catch (error) {
        const message = error instanceof Error ? error.message : "no se pudo cumplir el servicio";
        throw new KirletHttpError(400, "validation_error", message);
      }
    },
  },
});
