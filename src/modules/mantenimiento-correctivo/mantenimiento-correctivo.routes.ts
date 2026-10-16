import { KirletHttpError, now_iso, type DomainRow } from "@opus-perpetuus/imperium-core-kit";
import { estado_abierto } from "../../control.ts";
import { API, ESTADO_ABIERTO, VEHICULO, definir_recurso } from "../../recurso.ts";

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
    ...(row.estado === "cerrado" ? { estado: "cerrado" } : {}),
    updated_at: now_iso(),
  });
}

export const mantenimiento_correctivo_module = definir_recurso({
  resource: "mantenimiento-correctivo",
  table: "mantenimiento_correctivo",
  singular: "Mantenimiento correctivo",
  plural: "Mantenimientos correctivos",
  order: 50,
  subtitle: "Trabajo que atiende una falla del mismo vehículo",
  columns: [
    { name: "vehicle_id", type: "text", notNull: true },
    { name: "falla_id", type: "text" },
    { name: "fecha", type: "text" },
    { name: "trabajo_realizado", type: "text" },
    { name: "costo", type: "real" },
    { name: "estado", type: "text", notNull: true, default: "abierto" },
  ],
  fields: {
    vehicle_id: { type: "string", search: true },
    falla_id: { type: "string", search: true },
    fecha: { type: "string" },
    trabajo_realizado: { type: "string", search: true },
    costo: { type: "number" },
    estado: { type: "string", search: true },
  },
  list: [
    { key: "fecha", label: "Fecha" },
    { key: "name", label: "Trabajo" },
    { key: "vehicle_id", label: "Vehículo" },
    { key: "estado", label: "Estado" },
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
    { name: "fecha", component: "input-date", label: "Fecha" },
    { name: "description", component: "input-textarea", label: "Diagnóstico" },
    { name: "trabajo_realizado", component: "input-textarea", label: "Trabajo realizado" },
    { name: "costo", component: "input-money", label: "Costo" },
    {
      ...ESTADO_ABIERTO,
      help: "Al cerrarlo se cierra también la falla ligada.",
    },
  ],
  hooks: {
    async before_create(ctx, row) {
      row.estado = estado_abierto(row.estado);
      if (!row.fecha) row.fecha = new Date().toISOString().slice(0, 10);
      return tomar_vehiculo(ctx, row);
    },
    async after_create(ctx, row) {
      await reflejar_en_falla(ctx, row);
    },
    async before_update(ctx, _id, patch, existing) {
      if ("estado" in patch) patch.estado = estado_abierto(patch.estado);
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
