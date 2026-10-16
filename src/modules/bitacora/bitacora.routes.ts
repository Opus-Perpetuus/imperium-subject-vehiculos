import {
  KirletHttpError,
  new_id,
  now_iso,
  today_iso,
  type DomainRow,
} from "@opus-perpetuus/imperium-core-kit";
import {
  bitacora_revisada,
  es_error,
  normalizar_imagenes,
  normalizar_items,
  numero,
} from "../../control.ts";
import { API, VEHICULO, definir_recurso, define_routes } from "../../recurso.ts";

function aplicar(patch: DomainRow, base?: DomainRow): DomainRow {
  const next = { ...patch };
  if ("items" in patch) {
    const items = normalizar_items(patch.items);
    if (es_error(items)) throw new KirletHttpError(400, "validation_error", items.error);
    next.items = items;
  }
  if ("imagenes" in patch) {
    const imagenes = normalizar_imagenes(patch.imagenes);
    if (es_error(imagenes)) throw new KirletHttpError(400, "validation_error", imagenes.error);
    next.imagenes = imagenes;
  }
  const firma = "firma_revisa" in next ? next.firma_revisa : base?.firma_revisa;
  // La casilla no manda: sin el trazo de quien revisa no queda revisada.
  next.revisada = bitacora_revisada(firma);
  return next;
}

export const bitacora_module = definir_recurso({
  resource: "bitacora",
  table: "bitacora",
  singular: "Bitácora de revisión",
  plural: "Bitácoras de revisión",
  order: 30,
  subtitle: "Revisión del vehículo, con evidencia y la firma de quien la hace y de quien la revisa",
  columns: [
    { name: "vehicle_id", type: "text", notNull: true },
    { name: "plantilla_id", type: "text" },
    { name: "fecha", type: "text" },
    { name: "items", type: "json" },
    { name: "imagenes", type: "json" },
    { name: "firma_realiza", type: "text" },
    { name: "firma_revisa", type: "text" },
    { name: "revisada", type: "boolean", notNull: true, default: false },
  ],
  fields: {
    vehicle_id: { type: "string", required: true, search: true },
    plantilla_id: { type: "string" },
    fecha: { type: "string", search: true },
    items: { type: "json" },
    imagenes: { type: "json" },
    firma_realiza: { type: "string" },
    firma_revisa: { type: "string" },
    revisada: { type: "boolean" },
  },
  list: [
    { key: "fecha", label: "Fecha" },
    { key: "name", label: "Título" },
    { key: "vehicle_id", label: "Vehículo" },
    { key: "revisada", label: "Revisada" },
  ],
  form: [
    { name: "name", component: "input-text", label: "Título", required: true },
    VEHICULO,
    {
      name: "plantilla_id",
      component: "input-datalist",
      label: "Plantilla",
      optionsSource: `${API}/plantilla-revision?as=options&limite=1000`,
    },
    { name: "fecha", component: "input-date", label: "Fecha" },
    { name: "description", component: "input-textarea", label: "Observaciones" },
    {
      name: "items",
      component: "input-json",
      label: "Ítems de revisión",
      help: "Cada ítem: concepto y resultado pasa, falla o na.",
    },
    {
      name: "imagenes",
      component: "input-image",
      label: "Evidencia",
      multiple: true,
      image_selection_limit: 12,
      help: "Varias fotos en el mismo registro.",
    },
    { name: "firma_realiza", component: "input-signature", label: "Firma de quien realiza" },
    { name: "firma_revisa", component: "input-signature", label: "Firma de quien revisa" },
    {
      name: "revisada",
      component: "input-checkbox",
      label: "Revisada",
      read_only: true,
      help: "Queda revisada solo con la firma de quien revisa.",
    },
  ],
  acciones: [
    {
      id: "reportar-falla",
      label: "Reportar falla",
      confirm: "Se abre un reporte de falla de este mismo vehículo.",
      method: "POST",
      action: `${API}/bitacora/:id/reportar-falla`,
    },
  ],
  redact: (row) => {
    const copy = { ...row };
    if (copy.imagenes) copy.imagenes = "[imagenes]";
    if (copy.firma_realiza) copy.firma_realiza = "[firma]";
    if (copy.firma_revisa) copy.firma_revisa = "[firma]";
    return copy;
  },
  extra_routes: define_routes({
    "POST /bitacora/:id/reportar-falla": async (ctx) => {
      const bitacora = await ctx.data.findOne("bitacora", { id: ctx.params.id });
      if (!bitacora || bitacora.is_active === false) return ctx.not_found();
      const body = (await ctx.body<Record<string, unknown>>()) ?? {};
      const items = Array.isArray(bitacora.items)
        ? (bitacora.items as Array<Record<string, unknown>>)
        : [];
      const index = numero(body.item_index);
      const elegido = index != null ? items[index] : items.find((item) => item.resultado === "falla");
      const concepto = String(body.concepto ?? elegido?.concepto ?? "").trim();
      const descripcion =
        String(body.descripcion ?? body.description ?? "").trim() ||
        (concepto ? `Falla en revisión: ${concepto}` : "Falla anotada en bitácora");
      const ts = now_iso();
      const created = await ctx.data.insert("falla", {
        id: new_id("falla"),
        name: String(body.name ?? (concepto || "Falla de bitácora")),
        description: descripcion,
        vehicle_id: bitacora.vehicle_id,
        bitacora_id: bitacora.id,
        concepto,
        prioridad: String(body.prioridad ?? "media"),
        estado: "abierto",
        fecha: today_iso(),
        is_active: true,
        created_at: ts,
        updated_at: ts,
      });
      return ctx.created(created);
    },
  }),
  hooks: {
    async before_create(ctx, row) {
      if (!row.fecha) row.fecha = today_iso();
      const sin_items = row.items == null || (Array.isArray(row.items) && row.items.length === 0);
      if (row.plantilla_id && sin_items) {
        const plantilla = await ctx.data.findOne("plantilla_revision", {
          id: String(row.plantilla_id),
        });
        if (!plantilla) throw new KirletHttpError(400, "validation_error", "la plantilla no existe");
        const conceptos = Array.isArray(plantilla.items) ? plantilla.items : [];
        row.items = conceptos.map((item) => ({
          concepto: String(
            item && typeof item === "object"
              ? (item as Record<string, unknown>).concepto ?? ""
              : item,
          ),
          resultado: "na",
        }));
      }
      if (row.items == null) row.items = [];
      if (row.imagenes == null) row.imagenes = [];
      return aplicar(row);
    },
    before_update(_ctx, _id, patch, existing) {
      return aplicar(patch, existing);
    },
  },
});
