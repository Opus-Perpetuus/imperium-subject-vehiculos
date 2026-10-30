import { KirletHttpError, now_iso, type DomainRow, type KirletCtx } from "@opus-perpetuus/imperium-core-kit";
import {
  es_error_regla,
  estado_reparacion,
  firma_unica,
  siguiente_estado_reparacion,
} from "../../autorizacion.ts";
import { costo_valido, API, ESTADO_ABIERTO, VEHICULO, definir_recurso, define_routes } from "../../recurso.ts";
import { acciones_compartir_firma, rutas_compartir_firma } from "../../envios.ts";

async function tomar_vehiculo(ctx: { data: { findOne: (table: string, where: { id: string }) => Promise<DomainRow | null> } }, row: DomainRow) {
  const falla_id = String(row.falla_id ?? "").trim();
  if (!falla_id) {
    if (!String(row.vehicle_id ?? "").trim()) {
      throw new KirletHttpError(400, "validation_error", "indica el vehículo o la falla");
    }
    return row;
  }
  const falla = await ctx.data.findOne("falla", { id: falla_id });
  if (!falla) throw new KirletHttpError(400, "validation_error", "la falla no existe");
  const vehicle_id = String(row.vehicle_id ?? "").trim();
  if (vehicle_id && vehicle_id !== String(falla.vehicle_id ?? "")) {
    throw new KirletHttpError(400, "validation_error", "el correctivo es del mismo vehículo que la falla");
  }
  row.vehicle_id = String(falla.vehicle_id ?? "");
  row.falla_id = falla_id;
  return row;
}

async function reflejar_en_falla(
  ctx: { data: { update: (table: string, where: { id: string }, patch: DomainRow) => Promise<DomainRow | null> } },
  row: DomainRow,
) {
  if (!row.falla_id) return;
  await ctx.data.update("falla", { id: String(row.falla_id) }, {
    correctivo_id: row.id,
    ...(row.estado === "terminado" ? { estado: "cerrado" } : {}),
    updated_at: now_iso(),
  });
}

function usuario(ctx: KirletCtx): string {
  const u = (ctx as { user?: { name?: string; email?: string; id?: string } }).user;
  return String(u?.name ?? u?.email ?? u?.id ?? "Usuario interno").trim() || "Usuario interno";
}

/** Firma única + estatus. Muta `patch`. */
export function aplicar_autorizacion(ctx: KirletCtx, patch: DomainRow, existing?: DomainRow): DomainRow {
  const firma = "firma_autoriza" in patch ? firma_unica(existing?.firma_autoriza, patch.firma_autoriza) : null;
  if (es_error_regla(firma)) {
    throw new KirletHttpError(firma.status, firma.status === 409 ? "conflict" : "validation_error", `reparación: ${firma.error}`);
  }
  if ("firma_autoriza" in patch && firma == null) delete patch.firma_autoriza;
  const firmada = !!String(existing?.firma_autoriza ?? "").trim() || firma != null;
  const estado = siguiente_estado_reparacion({
    anterior: existing ? existing.estado : "pendiente",
    pedido: "estado" in patch ? patch.estado : existing ? undefined : patch.estado,
    firmada,
    firma_nueva: firma != null,
  });
  if (es_error_regla(estado)) {
    throw new KirletHttpError(estado.status, estado.status === 409 ? "conflict" : "validation_error", estado.error);
  }
  if (!existing || "estado" in patch || estado !== estado_reparacion(existing.estado)) patch.estado = estado;
  if (firma != null) {
    patch.firma_autoriza = firma;
    patch.autorizado_at = now_iso();
    patch.autorizado_por = String(patch.autorizado_por ?? "").trim() || usuario(ctx);
  } else {
    delete patch.autorizado_at;
    delete patch.autorizado_por;
  }
  return patch;
}

export const mantenimiento_correctivo_module = definir_recurso({
  resource: "mantenimiento-correctivo",
  table: "mantenimiento_correctivo",
  singular: "Reparación (mantenimiento correctivo)",
  plural: "Reparaciones (mantenimientos correctivos)",
  order: 50,
  subtitle: "Trabajo que atiende una falla; se autoriza con una sola firma antes de trabajarlo",
  columns: [
    { name: "vehicle_id", type: "text", notNull: true },
    { name: "falla_id", type: "text" },
    { name: "bitacora_id", type: "text" },
    { name: "fecha", type: "text" },
    { name: "trabajo_realizado", type: "text" },
    { name: "costo", type: "real" },
    { name: "estado", type: "text", notNull: true, default: "pendiente" },
    { name: "firma_autoriza", type: "text" },
    { name: "autorizado_at", type: "text" },
    { name: "autorizado_por", type: "text" },
  ],
  fields: {
    vehicle_id: { type: "string", search: true },
    falla_id: { type: "string", search: true },
    bitacora_id: { type: "string", search: true },
    fecha: { type: "string" },
    trabajo_realizado: { type: "string", search: true },
    costo: { type: "number" },
    estado: { type: "string", search: true },
    firma_autoriza: { type: "string" },
    autorizado_at: { type: "string" },
    autorizado_por: { type: "string", search: true },
  },
  list: [
    { key: "fecha", label: "Fecha" },
    { key: "name", label: "Trabajo" },
    { key: "vehiculo", label: "Vehículo" },
    { key: "estado", label: "Estado" },
    { key: "autorizado_por", label: "Autorizó" },
    { key: "costo", label: "Costo" },
  ],
  form: [
    { name: "name", component: "input-text", label: "Título", required: true },
    { ...VEHICULO, required: false, help: "Si eliges la falla, el vehículo se toma de ella." },
    {
      name: "falla_id",
      component: "input-datalist",
      label: "Falla que atiende",
      optionsSource: `${API}/falla?as=options&limite=1000`,
    },
    {
      name: "bitacora_id",
      component: "input-datalist",
      label: "Bitácora de origen",
      optionsSource: `${API}/bitacora?as=options&limite=1000`,
    },
    { name: "fecha", component: "input-date", label: "Fecha programada" },
    { name: "description", component: "input-textarea", label: "Diagnóstico" },
    { name: "trabajo_realizado", component: "input-textarea", label: "Trabajo realizado" },
    { name: "costo", component: "input-money", label: "Costo" },
    {
      ...ESTADO_ABIERTO,
      help: "Pendiente → Autorizado (al firmar) → En proceso → Terminado. Cancelado en cualquier momento. Al terminarla se cierra la falla ligada.",
    },
    {
      name: "firma_autoriza",
      component: "input-signature",
      label: "Firma de autorización",
      help: "Se firma una sola vez. También puedes compartirla para firma interna o pública.",
    },
    { name: "autorizado_por", component: "input-text", label: "Autorizó", read_only: true },
    { name: "autorizado_at", component: "input-text", label: "Autorizado el", read_only: true },
  ],
  acciones: acciones_compartir_firma("mantenimiento-correctivo", "autorizar"),
  acciones_lista: acciones_compartir_firma("mantenimiento-correctivo", "autorizar", true),
  redact: (row) => {
    const copy = { ...row };
    if (copy.firma_autoriza) copy.firma_autoriza = "[firma]";
    return copy;
  },
  extra_routes: define_routes(rutas_compartir_firma("mantenimiento-correctivo", "reparacion")),
  hooks: {
    async before_create(ctx, row) {
      costo_valido(row);
      if (!row.fecha) row.fecha = new Date().toISOString().slice(0, 10);
      aplicar_autorizacion(ctx, row);
      if (row.autorizado_por == null) row.autorizado_por = "";
      return tomar_vehiculo(ctx, row);
    },
    async after_create(ctx, row) {
      await reflejar_en_falla(ctx, row);
    },
    async before_update(ctx, _id, patch, existing) {
      costo_valido(patch);
      aplicar_autorizacion(ctx, patch, existing);
      const merged = { ...existing, ...patch };
      await tomar_vehiculo(ctx, merged);
      patch.vehicle_id = merged.vehicle_id;
      if (merged.falla_id) patch.falla_id = merged.falla_id;
      return patch;
    },
    async after_update(ctx, row) {
      await reflejar_en_falla(ctx, row);
    },
  },
});
