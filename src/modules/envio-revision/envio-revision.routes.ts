import {
  KirletHttpError,
  new_id,
  now_iso,
  type DomainRow,
  type FeatureShellFieldDescriptor,
  type KirletCtx,
} from "@opus-perpetuus/imperium-core-kit";
import {
  anexar_visita,
  es_error,
  etiqueta_vehiculo,
  normalizar_imagenes,
  normalizar_items,
  normalizar_visitas,
  ordenar_partidas_alarma,
  partida_en_alarma,
  ruta_publica_envio,
  texto_visitas,
  visita_desde_headers,
  type PartidaRevision,
} from "../../control.ts";
import { API, definir_recurso, define_routes } from "../../recurso.ts";
import {
  cancelar_envios,
  compartir_envio,
  exigir_sin_duplicados,
  ids_de,
  ids_del_cuerpo,
  mensaje_cancelar,
  type ModoEnvio,
} from "../../envios.ts";
import { general_option_list_options_source } from "../../general-option-seeds.ts";

async function bitacoras_de(ctx: KirletCtx, ids: string[]): Promise<DomainRow[]> {
  if (!ids.length) throw new KirletHttpError(400, "validation_error", "elige al menos una bitácora");
  const filas = await ctx.data.findMany("bitacora", {
    where: { id: { in: ids } },
    limit: ids.length,
  });
  const por_id = new Map(filas.filter((f) => f.is_active !== false).map((f) => [String(f.id), f]));
  const ordenadas: DomainRow[] = [];
  for (const id of ids) {
    const fila = por_id.get(id);
    if (!fila) throw new KirletHttpError(400, "validation_error", `la bitácora ${id} no existe`);
    ordenadas.push(fila);
  }
  return ordenadas;
}

function partidas_para_firma(items: unknown): PartidaRevision[] {
  const normalizadas = normalizar_items(items);
  if (es_error(normalizadas)) return [];
  return ordenar_partidas_alarma(normalizadas);
}

async function registrar_visita_publica(ctx: KirletCtx, envio: DomainRow): Promise<DomainRow> {
  const visita = visita_desde_headers(ctx.req.headers, now_iso());
  const visitas = anexar_visita(envio.visitas, visita);
  const actualizado = await ctx.data.update(
    "envio_revision",
    { id: String(envio.id) },
    { visitas, updated_at: visita.visitado_en },
  );
  return actualizado ?? { ...envio, visitas };
}

async function vista_bitacora(ctx: KirletCtx, bitacora: DomainRow) {
  const items = partidas_para_firma(bitacora.items);
  const imagenes = normalizar_imagenes(bitacora.imagenes);
  const unidad = await ctx.data.findOne("vehicle", { id: String(bitacora.vehicle_id ?? "") });
  return {
    id: bitacora.id,
    name: bitacora.name,
    fecha: bitacora.fecha,
    description: bitacora.description,
    plantilla_nombre: bitacora.plantilla_nombre,
    vehicle_id: bitacora.vehicle_id,
    vehiculo: unidad ? etiqueta_vehiculo(unidad) : String(bitacora.vehiculo ?? ""),
    items,
    alarmas: items.filter(partida_en_alarma).map((p) => p.concepto),
    imagenes: es_error(imagenes) ? [] : imagenes,
    firma_realiza: bitacora.firma_realiza ?? "",
    firma_revisa: bitacora.firma_revisa ?? "",
    revisada: !!bitacora.revisada,
  };
}

async function vista_envio(
  ctx: KirletCtx,
  envio: DomainRow,
  opts: { incluir_visitas?: boolean } = {},
) {
  const ids = ids_de(envio.bitacora_ids);
  const bitacoras = [];
  for (const bitacora of await bitacoras_de(ctx, ids)) {
    bitacoras.push(await vista_bitacora(ctx, bitacora));
  }
  const visitas = normalizar_visitas(envio.visitas);
  const base = {
    ...envio,
    bitacoras,
    ruta_compartir: compartir_envio(envio).ruta,
    compartir: compartir_envio(envio),
  };
  if (!opts.incluir_visitas) {
    const publico = { ...base } as Record<string, unknown>;
    delete publico.visitas;
    delete publico.visitas_texto;
    return publico;
  }
  return {
    ...base,
    visitas,
    visitas_texto: texto_visitas(visitas),
  };
}

async function firmar_envio(
  ctx: KirletCtx,
  envio: DomainRow,
  firma: string,
  firmante: string,
): Promise<DomainRow> {
  if (envio.estado === "firmado") {
    throw new KirletHttpError(409, "conflict", "este envío ya está firmado");
  }
  if (envio.estado === "cancelado") {
    throw new KirletHttpError(409, "conflict", "este envío fue cancelado; pide uno nuevo");
  }
  if (!firma.trim()) {
    throw new KirletHttpError(400, "validation_error", "falta la firma");
  }
  const ts = now_iso();
  const actualizado = await ctx.data.update(
    "envio_revision",
    { id: String(envio.id) },
    {
      firma: firma.trim(),
      firmado_at: ts,
      firmante: firmante.trim() || "Público",
      estado: "firmado",
      updated_at: ts,
    },
  );
  if (!actualizado) throw new KirletHttpError(404, "not_found", "no se pudo firmar");
  const ids = ids_de(envio.bitacora_ids);
  for (const id of ids) {
    await ctx.data.update(
      "bitacora",
      { id },
      {
        firma_revisa: firma.trim(),
        revisada: true,
        updated_at: ts,
      },
    );
  }
  return actualizado;
}

const CAMPOS_FORM: FeatureShellFieldDescriptor[] = [
  { name: "name", component: "input-text", label: "Título", required: true },
  {
    name: "modo",
    component: "input-radio-buttons",
    label: "Modo",
    required: true,
    // Opciones: general-option-list-control (seed en general-option-seeds.ts).
    optionsSource: general_option_list_options_source(
      "subject-vehiculos/envio-revision",
      "modo",
    ),
    help: "Interna: eliges quién revisa. Pública: compartes la URL y firman una vez el grupo.",
  },
  {
    name: "usuario_id",
    component: "input-datalist",
    label: "Revisor interno",
    optionsSource: "api://user?as=options&limite=1000",
    help: "Obligatorio en modo interno. Puedes crearlo vacío desde la bitácora y completarlo aquí.",
  },
  {
    name: "bitacora_ids",
    component: "input-checkbox-group",
    label: "Bitácoras a revisar",
    column_span: "full",
    required: true,
    optionsSource: `${API}/bitacora?as=options&limite=1000`,
    help: "Elige una o más bitácoras. Quien firme lo hace una sola vez para todo el grupo.",
  },
  {
    name: "description",
    component: "input-textarea",
    label: "Nota para quien revisa",
    column_span: "full",
  },
  {
    name: "firma",
    component: "input-signature",
    label: "Firma de revisión (grupo)",
    help: "Una sola firma aplica a todas las bitácoras del envío.",
  },
  {
    name: "estado",
    component: "input-status",
    label: "Estado",
    read_only: true,
    // Opciones: status-option-control (seed en status-seeds.ts).
  },
  {
    name: "share_hint",
    component: "input-text",
    label: "Enlace del envío",
    column_span: "full",
    read_only: true,
    help: "Público: cualquiera con el enlace ve las bitácoras y firma el grupo una vez, sin sesión. Interno: lleva al detalle y pide sesión. Mándalo con el botón de WhatsApp.",
  },
  {
    name: "visitas_texto",
    component: "input-textarea",
    label: "Visitas al enlace público",
    column_span: "full",
    read_only: true,
    help: "Registro de quién abrió el enlace público: fecha, dispositivo, sistema y origen/referrer.",
  },
];

export const envio_revision_module = definir_recurso({
  resource: "envio-revision",
  table: "envio_revision",
  singular: "Envío a revisión",
  plural: "Envíos a revisión",
  order: 35,
  subtitle: "Manda una o más bitácoras a firmar, por usuario interno o con enlace público",
  columns: [
    { name: "modo", type: "text", notNull: true },
    { name: "usuario_id", type: "text" },
    { name: "usuario_nombre", type: "text" },
    { name: "bitacora_ids", type: "json" },
    { name: "firma", type: "text" },
    { name: "firmado_at", type: "text" },
    { name: "firmante", type: "text" },
    { name: "estado", type: "text", notNull: true, default: "pendiente" },
    { name: "share_hint", type: "text" },
    { name: "visitas", type: "json" },
  ],
  fields: {
    modo: { type: "string", required: true, search: true },
    usuario_id: { type: "string", search: true },
    usuario_nombre: { type: "string", search: true },
    bitacora_ids: { type: "json" },
    firma: { type: "string" },
    firmado_at: { type: "string" },
    firmante: { type: "string", search: true },
    estado: { type: "string", search: true },
    share_hint: { type: "string" },
    visitas: { type: "json" },
  },
  list: [
    { key: "name", label: "Título" },
    { key: "modo", label: "Modo" },
    { key: "usuario_nombre", label: "Revisor" },
    { key: "estado", label: "Estado" },
    { key: "firmado_at", label: "Firmado" },
  ],
  form: CAMPOS_FORM,
  acciones_lista: [
    {
      id: "cancelar-envios",
      label: "Cancelar envíos",
      confirm: "Se cancelan los envíos pendientes seleccionados. Los firmados no cambian.",
      method: "POST",
      action: `${API}/envio-revision/cancelar`,
    },
  ],
  acciones: [
    {
      id: "cancelar-envio",
      label: "Cancelar envío",
      confirm: "El enlace deja de aceptar firma y sus bitácoras se pueden volver a enviar.",
      method: "POST",
      action: `${API}/envio-revision/:id/cancelar`,
    },
    {
      id: "firmar-envio",
      label: "Firmar revisión",
      confirm: "Se aplica una sola firma a todas las bitácoras de este envío.",
      method: "POST",
      action: `${API}/envio-revision/:id/firmar`,
    },
  ],
  redact: (row) => {
    const copy = { ...row };
    if (copy.firma) copy.firma = "[firma]";
    return copy;
  },
  extra_routes: define_routes({
    "GET /envio-revision/publico/:id": {
      public_access: "anonymous",
      handler: async (ctx: KirletCtx) => {
        const envio = await ctx.data.findOne("envio_revision", { id: ctx.params.id });
        if (!envio || envio.is_active === false) return ctx.not_found();
        if (String(envio.modo) !== "publico") {
          throw new KirletHttpError(404, "not_found", "este envío no es público");
        }
        let actual = envio;
        try {
          actual = await registrar_visita_publica(ctx, envio);
        } catch {
          // Abrir/firmar no debe fallar si el registro de visita falla.
        }
        return { data: await vista_envio(ctx, actual) };
      },
    },
    "POST /envio-revision/publico/:id/firmar": {
      public_access: "anonymous",
      handler: async (ctx: KirletCtx) => {
        const envio = await ctx.data.findOne("envio_revision", { id: ctx.params.id });
        if (!envio || envio.is_active === false) return ctx.not_found();
        if (String(envio.modo) !== "publico") {
          throw new KirletHttpError(404, "not_found", "este envío no es público");
        }
        const body = (await ctx.body<Record<string, unknown>>()) ?? {};
        const firma = String(body.firma ?? "").trim();
        const firmante = String(body.firmante ?? body.nombre ?? "Público").trim();
        const actualizado = await firmar_envio(ctx, envio, firma, firmante);
        return { data: await vista_envio(ctx, actualizado) };
      },
    },
    "POST /envio-revision/cancelar": async (ctx) => {
      const { ids } = await ids_del_cuerpo(ctx);
      const r = await cancelar_envios(ctx, ids);
      return { data: r, mensaje: mensaje_cancelar(r) };
    },
    "POST /envio-revision/:id/cancelar": async (ctx) => {
      const envio = await ctx.data.findOne("envio_revision", { id: ctx.params.id });
      if (!envio || envio.is_active === false) return ctx.not_found();
      const r = await cancelar_envios(ctx, [String(envio.id)]);
      if (!r.cancelados.length) {
        throw new KirletHttpError(409, "conflict", r.omitidos[0]?.motivo ?? "no se pudo cancelar");
      }
      return { data: r, mensaje: "Envío cancelado. Sus bitácoras ya se pueden volver a enviar." };
    },
    "GET /envio-revision/:id": async (ctx) => {
      const envio = await ctx.data.findOne("envio_revision", { id: ctx.params.id });
      if (!envio || envio.is_active === false) return ctx.not_found();
      return { data: await vista_envio(ctx, envio, { incluir_visitas: true }) };
    },
    "POST /envio-revision/:id/firmar": async (ctx) => {
      const envio = await ctx.data.findOne("envio_revision", { id: ctx.params.id });
      if (!envio || envio.is_active === false) return ctx.not_found();
      const body = (await ctx.body<Record<string, unknown>>()) ?? {};
      const firma = String(body.firma ?? "").trim();
      const actor = String(
        body.firmante ?? (ctx as { user?: { name?: string } }).user?.name ?? "",
      );
      const actualizado = await firmar_envio(ctx, envio, firma, actor);
      return { data: await vista_envio(ctx, actualizado, { incluir_visitas: true }) };
    },
  }),
  hooks: {
    async before_create(ctx, row) {
      const ids = ids_de(row.bitacora_ids);
      await bitacoras_de(ctx, ids);
      await exigir_sin_duplicados(ctx, ids);
      row.bitacora_ids = ids;
      const modo = String(row.modo ?? "").trim() as ModoEnvio;
      if (modo !== "interno" && modo !== "publico") {
        throw new KirletHttpError(400, "validation_error", "el modo debe ser interno o publico");
      }
      row.modo = modo;
      if (modo === "interno") {
        row.usuario_id = String(row.usuario_id ?? "").trim();
        if (!row.usuario_id) {
          throw new KirletHttpError(400, "validation_error", "elige el usuario revisor");
        }
        row.usuario_nombre = String(row.usuario_nombre ?? row.usuario_id).trim();
        row.share_hint = "";
      } else {
        row.usuario_id = "";
        row.usuario_nombre = "";
        row.share_hint = ""; // se completa en after_create con el id real
      }
      row.estado = String(row.estado ?? "pendiente") || "pendiente";
      row.firma = String(row.firma ?? "");
      row.firmado_at = String(row.firmado_at ?? "");
      row.firmante = String(row.firmante ?? "");
      row.visitas = normalizar_visitas(row.visitas);
      return row;
    },
    async after_create(ctx, row) {
      if (String(row.modo) === "publico") {
        const hint = ruta_publica_envio(row.id);
        await ctx.data.update(
          "envio_revision",
          { id: String(row.id) },
          {
            share_hint: hint,
            updated_at: now_iso(),
          },
        );
        row.share_hint = hint;
      }
    },
    async before_update(ctx, row, existing) {
      if ("bitacora_ids" in row) {
        const ids = ids_de(row.bitacora_ids);
        await bitacoras_de(ctx, ids);
        const estado = String(row.estado ?? existing.estado ?? "pendiente");
        if (estado !== "cancelado") await exigir_sin_duplicados(ctx, ids, String(existing.id));
        row.bitacora_ids = ids;
      } else if (
        String(existing.estado ?? "") === "cancelado" &&
        "estado" in row &&
        String(row.estado ?? "") !== "cancelado"
      ) {
        // Reactivar un cancelado vuelve a retener sus bitácoras.
        await exigir_sin_duplicados(ctx, ids_de(existing.bitacora_ids), String(existing.id));
      }
      const modo = String(row.modo ?? existing.modo ?? "").trim();
      if (modo === "interno" && "usuario_id" in row) {
        row.usuario_id = String(row.usuario_id ?? "").trim();
        if (row.usuario_id) {
          row.usuario_nombre = String(row.usuario_nombre ?? row.usuario_id).trim();
        }
      }
      if (modo === "publico") {
        row.share_hint = ruta_publica_envio(existing.id);
      }
      return row;
    },
  },
});
