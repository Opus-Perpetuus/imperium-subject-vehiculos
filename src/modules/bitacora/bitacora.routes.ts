import {
  KirletHttpError,
  new_id,
  now_iso,
  today_iso,
  type DomainRow,
  type FeatureShellFieldDescriptor,
  type KirletCtx,
} from "@opus-perpetuus/imperium-core-kit";
import {
  bitacora_desde_plantilla,
  bitacora_revisada,
  clave_concepto,
  clave_resultado,
  es_error,
  etiqueta_vehiculo,
  filas_desde_ranuras,
  normalizar_imagenes,
  normalizar_items,
  numero,
  quitar_ranuras,
  RANURAS_REVISION,
} from "../../control.ts";
import { API, VEHICULO, definir_recurso, define_routes } from "../../recurso.ts";

// El formulario ya no pinta ranuras. Siguen declaradas porque el kit rechaza,
// antes del hook, un cuerpo viejo con `concepto_N` que no esté en el esquema.
const RANURAS: Record<string, { type: "string" }> = {};
for (let indice = 1; indice <= RANURAS_REVISION; indice++) {
  RANURAS[clave_concepto(indice)] = { type: "string" };
  RANURAS[clave_resultado(indice)] = { type: "string" };
  RANURAS[`nota_${indice}`] = { type: "string" };
}

const PARTIDAS = {
  name: "items",
  component: "input-hidden",
  label: "Partidas",
  column_span: "full",
  help: "Al elegir una plantilla se crean sus partidas. En cada una puedes cambiar las opciones y el resultado.",
  partidas: "bitacora",
} as FeatureShellFieldDescriptor;

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

function sin_partidas(row: DomainRow): boolean {
  return !("items" in row) || row.items == null || (Array.isArray(row.items) && row.items.length === 0);
}

function plantilla_distinta(patch: DomainRow, existing: DomainRow): boolean {
  if (!("plantilla_id" in patch)) return false;
  const siguiente = String(patch.plantilla_id ?? "").trim();
  if (!siguiente) return false;
  return siguiente !== String(existing.plantilla_id ?? "");
}

async function aplicar_plantilla(ctx: KirletCtx, row: DomainRow): Promise<void> {
  const id = String(row.plantilla_id ?? "").trim();
  if (!id) return;
  const plantilla = await ctx.data.findOne("plantilla_revision", { id });
  if (!sin_partidas(row)) {
    if (plantilla) row.plantilla_nombre = String(plantilla.name ?? "");
    return;
  }
  if (!plantilla) throw new KirletHttpError(400, "validation_error", "la plantilla no existe");
  const items = bitacora_desde_plantilla(plantilla.items);
  if (es_error(items)) throw new KirletHttpError(400, "validation_error", items.error);
  row.items = items;
  row.plantilla_nombre = String(plantilla.name ?? "");
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
    { name: "plantilla_nombre", type: "text" },
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
    plantilla_nombre: { type: "string", search: true },
    fecha: { type: "string", search: true },
    ...RANURAS,
    items: { type: "json" },
    imagenes: { type: "json" },
    firma_realiza: { type: "string" },
    firma_revisa: { type: "string" },
    revisada: { type: "boolean" },
  },
  list: [
    { key: "fecha", label: "Fecha" },
    { key: "name", label: "Título" },
    { key: "vehiculo", label: "Vehículo" },
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
    PARTIDAS,
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
    "GET /bitacora/:id": async (ctx) => {
      const row = await ctx.data.findOne("bitacora", { id: ctx.params.id });
      if (!row || row.is_active === false) return ctx.not_found();
      const items = normalizar_items(row.items);
      return { data: { ...row, items: es_error(items) ? row.items : items } };
    },
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
      const unidad = await ctx.data.findOne("vehicle", {
        id: String(bitacora.vehicle_id ?? ""),
      });
      const ts = now_iso();
      const created = await ctx.data.insert("falla", {
        id: new_id("falla"),
        name: String(body.name ?? (concepto || "Falla de bitácora")),
        description: descripcion,
        vehicle_id: bitacora.vehicle_id,
        vehiculo: unidad ? etiqueta_vehiculo(unidad) : "",
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
      const capturadas = filas_desde_ranuras(row);
      quitar_ranuras(row);
      if (!row.fecha) row.fecha = today_iso();
      if (capturadas) {
        const items = normalizar_items(capturadas);
        if (es_error(items)) throw new KirletHttpError(400, "validation_error", items.error);
        row.items = items;
      }
      if (row.plantilla_id) await aplicar_plantilla(ctx, row);
      if (row.items == null) row.items = [];
      if (row.imagenes == null) row.imagenes = [];
      return aplicar(row);
    },
    async before_update(ctx, _id, patch, existing) {
      const capturadas = filas_desde_ranuras(patch, existing.items);
      quitar_ranuras(patch);
      if (capturadas) {
        const items = normalizar_items(capturadas);
        if (es_error(items)) throw new KirletHttpError(400, "validation_error", items.error);
        const previos = Array.isArray(existing.items) ? existing.items : [];
        const cola = normalizar_items(previos.slice(RANURAS_REVISION));
        if (es_error(cola)) throw new KirletHttpError(400, "validation_error", cola.error);
        patch.items = [...items, ...cola];
      } else if (plantilla_distinta(patch, existing)) {
        await aplicar_plantilla(ctx, patch);
      }
      return aplicar(patch, existing);
    },
  },
});
