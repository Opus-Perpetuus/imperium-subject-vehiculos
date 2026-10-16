import {
  KirletHttpError,
  now_iso,
  today_iso,
  type DomainRow,
} from "@opus-perpetuus/imperium-core-kit";
import {
  armar_recordatorios,
  cumplir_servicio,
  fecha_iso,
  numero,
  pide_cumplir,
  servicio_vista,
  validar_servicio,
} from "../../control.ts";
import { API, VEHICULO, definir_recurso, define_routes, pagina_lista } from "../../recurso.ts";

function cumplir_fila(row: DomainRow, body: Record<string, unknown>): DomainRow {
  const fecha = fecha_iso(body.fecha) ?? fecha_iso(body.ultima_fecha) ?? today_iso();
  const next = cumplir_servicio(servicio_vista(row), {
    fecha,
    lectura: numero(body.lectura ?? body.ultima_lectura),
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
    { key: "vehicle_id", label: "Vehículo" },
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
      component: "input-menu",
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
      component: "input-menu",
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
        { key: "estado", label: "Aviso" },
        { key: "clase", label: "Clase" },
        { key: "nombre", label: "Nombre" },
        { key: "vehicle_id", label: "Vehículo" },
        { key: "proxima_fecha", label: "Fecha" },
        { key: "motivo", label: "Motivo" },
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
        ctx.data.findMany("servicio_programado", { limit: 500 }),
        ctx.data.findMany("documento_vehiculo", { limit: 500 }),
        ctx.data.findMany("vehicle", { limit: 500 }),
      ]);
      const lecturas: Record<string, { km: number | null; horas: number | null }> = {};
      for (const vehicle of vehiculos) {
        lecturas[String(vehicle.id)] = {
          km: numero(vehicle.lectura_km),
          horas: numero(vehicle.lectura_horas),
        };
      }
      return armar_recordatorios({ hoy, servicios, documentos, lecturas });
    },
    "POST /servicio-programado/:id/cumplir": async (ctx) => {
      const existing = await ctx.data.findOne("servicio_programado", { id: ctx.params.id });
      if (!existing || existing.is_active === false) return ctx.not_found();
      const body = (await ctx.body<Record<string, unknown>>()) ?? {};
      let next: DomainRow;
      try {
        next = cumplir_fila(existing, body);
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
    before_create(_ctx, row) {
      if (row.aviso_dias == null) row.aviso_dias = 7;
      if (row.aviso_lectura == null) row.aviso_lectura = 0;
      if (!row.estado) row.estado = "programado";
      if (row.tipo_lectura == null) row.tipo_lectura = "";
      const error = validar_servicio(servicio_vista(row));
      if (error) throw new KirletHttpError(400, "validation_error", error);
      if (pide_cumplir(row.estado)) {
        return { ...row, ...cumplir_fila(row, { fecha: today_iso() }) };
      }
      return row;
    },
    before_update(_ctx, _id, patch, existing) {
      if (!pide_cumplir(patch.estado) || existing.estado === "cumplido") {
        const error = validar_servicio(servicio_vista({ ...existing, ...patch }));
        if (error) throw new KirletHttpError(400, "validation_error", error);
        return patch;
      }
      try {
        return { ...patch, ...cumplir_fila(existing, patch) };
      } catch (error) {
        const message = error instanceof Error ? error.message : "no se pudo cumplir el servicio";
        throw new KirletHttpError(400, "validation_error", message);
      }
    },
  },
});
