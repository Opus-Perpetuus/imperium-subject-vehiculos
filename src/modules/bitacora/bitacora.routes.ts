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
  llenar_partidas,
  normalizar_imagenes,
  normalizar_items,
  numero,
  partidas_sin_reporte,
  quitar_ranuras,
  RANURAS_REVISION,
  type PartidaRevision,
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
  help: "Al elegir una plantilla se cargan sus partidas. En cada una eliges el resultado y anotas lo que haga falta.",
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

function plantilla_distinta(patch: DomainRow, existing: DomainRow): boolean {
  if (!("plantilla_id" in patch)) return false;
  const siguiente = String(patch.plantilla_id ?? "").trim();
  if (!siguiente) return false;
  return siguiente !== String(existing.plantilla_id ?? "");
}

async function partidas_de_plantilla(
  ctx: KirletCtx,
  id: string,
): Promise<{ items: PartidaRevision[]; nombre: string }> {
  const plantilla = await ctx.data.findOne("plantilla_revision", { id });
  if (!plantilla) throw new KirletHttpError(400, "validation_error", "la plantilla no existe");
  const items = bitacora_desde_plantilla(plantilla.items);
  if (es_error(items)) throw new KirletHttpError(400, "validation_error", items.error);
  return { items, nombre: String(plantilla.name ?? "") };
}

function llenar(definidas: readonly PartidaRevision[], enviadas: unknown): PartidaRevision[] {
  const items = llenar_partidas(definidas, enviadas);
  if (es_error(items)) throw new KirletHttpError(400, "validation_error", items.error);
  return items;
}

// Las bitácoras ligadas a una plantilla conservan las partidas con que se
// crearon aunque la plantilla cambie después; las viejas con partidas propias
// también se llenan sobre lo que ya guardaron.
async function partidas_guardadas(ctx: KirletCtx, existing: DomainRow, plantilla_id: string) {
  const guardadas = normalizar_items(existing.items);
  if (!es_error(guardadas) && guardadas.length > 0) return guardadas;
  return (await partidas_de_plantilla(ctx, plantilla_id)).items;
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
      confirm: "Se abre un reporte de falla por cada partida marcada con falla que aún no lo tenga.",
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
      const unidad = await ctx.data.findOne("vehicle", {
        id: String(bitacora.vehicle_id ?? ""),
      });
      const abrir = (concepto: string, descripcion: string, name: string) => {
        const ts = now_iso();
        return ctx.data.insert("falla", {
          id: new_id("falla"),
          name,
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
      };
      const index = numero(body.item_index);
      const a_mano = index != null || ["concepto", "descripcion", "description", "name"].some((k) => body[k] != null);
      if (!a_mano) {
        // El botón de la pantalla no manda nada: una falla por cada partida
        // marcada como falla que todavía no tenga reporte abierto.
        const previas = await ctx.data.findMany("falla", { where: { bitacora_id: String(bitacora.id) }, limit: 10000 });
        const pendientes = partidas_sin_reporte(items, previas);
        if (pendientes.length) {
          const fallas = [];
          for (const concepto of pendientes) {
            fallas.push(await abrir(concepto, `Falla en revisión: ${concepto}`, concepto));
          }
          return ctx.json({ data: fallas[0], fallas, total_elementos: fallas.length }, 201);
        }
        if (items.some((item) => item.resultado === "falla")) {
          return ctx.fail(
            "conflict",
            "Las partidas con falla de esta bitácora ya tienen su reporte abierto",
            409,
          );
        }
      }
      const elegido = index != null ? items[index] : items.find((item) => item.resultado === "falla");
      const concepto = String(body.concepto ?? elegido?.concepto ?? "").trim();
      const descripcion =
        String(body.descripcion ?? body.description ?? "").trim() ||
        (concepto ? `Falla en revisión: ${concepto}` : "Falla anotada en bitácora");
      const created = await abrir(concepto, descripcion, String(body.name ?? (concepto || "Falla de bitácora")));
      return ctx.created(created);
    },
  }),
  hooks: {
    async before_create(ctx, row) {
      const capturadas = filas_desde_ranuras(row);
      quitar_ranuras(row);
      if (!row.fecha) row.fecha = today_iso();
      const plantilla_id = String(row.plantilla_id ?? "").trim();
      if (plantilla_id) {
        const plantilla = await partidas_de_plantilla(ctx, plantilla_id);
        row.items = llenar(plantilla.items, capturadas ?? row.items);
        row.plantilla_nombre = plantilla.nombre;
      } else if (capturadas) {
        const items = normalizar_items(capturadas);
        if (es_error(items)) throw new KirletHttpError(400, "validation_error", items.error);
        row.items = items;
      }
      if (row.items == null) row.items = [];
      if (row.imagenes == null) row.imagenes = [];
      return aplicar(row);
    },
    async before_update(ctx, _id, patch, existing) {
      const capturadas = filas_desde_ranuras(patch, existing.items);
      quitar_ranuras(patch);
      let enviadas: unknown = patch.items;
      const hay_partidas = capturadas != null || "items" in patch;
      if (capturadas) {
        const items = normalizar_items(capturadas);
        if (es_error(items)) throw new KirletHttpError(400, "validation_error", items.error);
        const previos = Array.isArray(existing.items) ? existing.items : [];
        const cola = normalizar_items(previos.slice(RANURAS_REVISION));
        if (es_error(cola)) throw new KirletHttpError(400, "validation_error", cola.error);
        enviadas = [...items, ...cola];
      }
      const plantilla_id = String(
        ("plantilla_id" in patch ? patch.plantilla_id : existing.plantilla_id) ?? "",
      ).trim();
      if (plantilla_distinta(patch, existing)) {
        const plantilla = await partidas_de_plantilla(ctx, plantilla_id);
        patch.items = llenar(plantilla.items, hay_partidas ? enviadas : null);
        patch.plantilla_nombre = plantilla.nombre;
      } else if (hay_partidas && plantilla_id) {
        patch.items = llenar(await partidas_guardadas(ctx, existing, plantilla_id), enviadas);
      } else if (capturadas) {
        patch.items = enviadas;
      }
      return aplicar(patch, existing);
    },
  },
});
