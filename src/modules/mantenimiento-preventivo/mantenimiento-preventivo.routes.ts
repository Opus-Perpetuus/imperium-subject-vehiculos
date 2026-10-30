import { KirletHttpError, now_iso, type DomainRow, type KirletCtx } from "@opus-perpetuus/imperium-core-kit";
import { es_error_regla, estado_mantenimiento, firma_unica } from "../../autorizacion.ts";
import { acciones_compartir_firma, rutas_compartir_firma } from "../../envios.ts";
import { costo_valido, API, ESTADO_ABIERTO, VEHICULO, definir_recurso, define_routes } from "../../recurso.ts";

function usuario(ctx: KirletCtx): string {
  const u = (ctx as { user?: { name?: string; email?: string; id?: string } }).user;
  return String(u?.name ?? u?.email ?? u?.id ?? "Usuario interno").trim() || "Usuario interno";
}

/** Estatus y firma opcional de revisión (una sola vez). Muta `patch`. */
export function aplicar_firma_mantenimiento(ctx: KirletCtx, patch: DomainRow, existing?: DomainRow): DomainRow {
  if (!existing || "estado" in patch) {
    const estado = estado_mantenimiento(patch.estado);
    if (!estado) throw new KirletHttpError(400, "validation_error", "estatus de mantenimiento no válido");
    patch.estado = estado;
  }
  if ("firma_revisa" in patch) {
    const firma = firma_unica(existing?.firma_revisa, patch.firma_revisa);
    if (es_error_regla(firma)) {
      throw new KirletHttpError(firma.status, firma.status === 409 ? "conflict" : "validation_error", `mantenimiento: ${firma.error}`);
    }
    if (firma == null) {
      delete patch.firma_revisa;
    } else {
      patch.firma_revisa = firma;
      patch.firmado_at = now_iso();
      patch.firmante = String(patch.firmante ?? "").trim() || usuario(ctx);
      return patch;
    }
  }
  delete patch.firmado_at;
  delete patch.firmante;
  return patch;
}

export const mantenimiento_preventivo_module = definir_recurso({
  resource: "mantenimiento-preventivo",
  table: "mantenimiento_preventivo",
  singular: "Mantenimiento preventivo",
  plural: "Mantenimientos preventivos",
  order: 60,
  subtitle: "Trabajo programado para evitar la falla: pendiente, en proceso o terminado",
  columns: [
    { name: "vehicle_id", type: "text", notNull: true },
    { name: "servicio_programado_id", type: "text" },
    { name: "bitacora_id", type: "text" },
    { name: "fecha", type: "text" },
    { name: "trabajo_realizado", type: "text" },
    { name: "costo", type: "real" },
    { name: "estado", type: "text", notNull: true, default: "pendiente" },
    { name: "firma_revisa", type: "text" },
    { name: "firmado_at", type: "text" },
    { name: "firmante", type: "text" },
  ],
  fields: {
    vehicle_id: { type: "string", required: true, search: true },
    servicio_programado_id: { type: "string" },
    bitacora_id: { type: "string", search: true },
    fecha: { type: "string" },
    trabajo_realizado: { type: "string", search: true },
    costo: { type: "number" },
    estado: { type: "string", search: true },
    firma_revisa: { type: "string" },
    firmado_at: { type: "string" },
    firmante: { type: "string", search: true },
  },
  list: [
    { key: "fecha", label: "Fecha" },
    { key: "name", label: "Trabajo" },
    { key: "vehiculo", label: "Vehículo" },
    { key: "estado", label: "Estado" },
    { key: "firmante", label: "Revisó" },
  ],
  form: [
    { name: "name", component: "input-text", label: "Título", required: true },
    VEHICULO,
    {
      name: "servicio_programado_id",
      component: "input-datalist",
      label: "Servicio programado",
      optionsSource: `${API}/servicio-programado?as=options&limite=1000`,
    },
    {
      name: "bitacora_id",
      component: "input-datalist",
      label: "Bitácora de origen",
      optionsSource: `${API}/bitacora?as=options&limite=1000`,
    },
    { name: "fecha", component: "input-date", label: "Fecha programada" },
    { name: "description", component: "input-textarea", label: "Qué se previene" },
    { name: "trabajo_realizado", component: "input-textarea", label: "Trabajo realizado" },
    { name: "costo", component: "input-money", label: "Costo" },
    { ...ESTADO_ABIERTO, help: "Pendiente, En proceso o Terminado." },
    {
      name: "firma_revisa",
      component: "input-signature",
      label: "Firma de revisión (opcional)",
      help: "Opcional y una sola vez. También puedes compartirlo para firma interna o pública.",
    },
    { name: "firmante", component: "input-text", label: "Revisó", read_only: true },
    { name: "firmado_at", component: "input-text", label: "Firmado el", read_only: true },
  ],
  acciones: acciones_compartir_firma("mantenimiento-preventivo", "revisar"),
  acciones_lista: acciones_compartir_firma("mantenimiento-preventivo", "revisar", true),
  redact: (row) => {
    const copy = { ...row };
    if (copy.firma_revisa) copy.firma_revisa = "[firma]";
    return copy;
  },
  extra_routes: define_routes(rutas_compartir_firma("mantenimiento-preventivo", "mantenimiento")),
  hooks: {
    before_create(ctx, row) {
      costo_valido(row);
      if (!row.fecha) row.fecha = new Date().toISOString().slice(0, 10);
      aplicar_firma_mantenimiento(ctx, row);
      if (row.firmante == null) row.firmante = "";
      return row;
    },
    before_update(ctx, _id, patch, existing) {
      costo_valido(patch);
      return aplicar_firma_mantenimiento(ctx, patch, existing);
    },
  },
});
