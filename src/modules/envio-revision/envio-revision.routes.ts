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
  partida_en_alarma,
  partidas_para_vista,
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
  exigir_sin_firma,
  ids_de,
  ids_del_cuerpo,
  INFO_TIPO,
  mensaje_cancelar,
  registros_de,
  resumen_envio,
  type ModoEnvio,
  type TipoFirma,
} from "../../envios.ts";
import { estado_reparacion } from "../../autorizacion.ts";
import { general_option_list_options_source } from "../../general-option-seeds.ts";

function bitacoras_de(ctx: KirletCtx, ids: string[]): Promise<DomainRow[]> {
  return registros_de(ctx, "bitacora", ids);
}

/** Ids por tipo de un envío (o de un cambio, cayendo en lo ya guardado). */
function ids_envio(row: DomainRow, existing?: DomainRow): Record<TipoFirma, string[]> {
  const de = (tipo: TipoFirma) => {
    const campo = INFO_TIPO[tipo].campo;
    return ids_de(campo in row ? row[campo] : existing?.[campo]);
  };
  return { bitacora: de("bitacora"), reparacion: de("reparacion"), mantenimiento: de("mantenimiento") };
}

/** Valida existencia, firma previa y duplicados de todo lo que trae el envío. */
async function validar_contenido(
  ctx: KirletCtx,
  ids: Record<TipoFirma, string[]>,
  opts: { excluir_envio?: string; revisar_duplicados: boolean },
): Promise<void> {
  if (!ids.bitacora.length && !ids.reparacion.length && !ids.mantenimiento.length) {
    throw new KirletHttpError(400, "validation_error", "elige al menos una bitácora, reparación o mantenimiento");
  }
  for (const tipo of ["bitacora", "reparacion", "mantenimiento"] as const) {
    if (!ids[tipo].length) continue;
    const filas = await registros_de(ctx, tipo, ids[tipo]);
    if (!opts.revisar_duplicados) continue;
    if (!opts.excluir_envio) exigir_sin_firma(tipo, filas);
    await exigir_sin_duplicados(ctx, ids[tipo], opts.excluir_envio, tipo);
  }
}

function partidas_para_firma(items: unknown): PartidaRevision[] {
  const normalizadas = normalizar_items(items);
  if (es_error(normalizadas)) return [];
  return partidas_para_vista(normalizadas);
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

async function vista_trabajo(ctx: KirletCtx, tipo: "reparacion" | "mantenimiento", row: DomainRow) {
  const unidad = await ctx.data.findOne("vehicle", { id: String(row.vehicle_id ?? "") });
  const firma = String(row[INFO_TIPO[tipo].firma] ?? "");
  return {
    id: row.id,
    tipo,
    name: row.name,
    fecha: row.fecha,
    description: row.description ?? "",
    trabajo_realizado: row.trabajo_realizado ?? "",
    costo: row.costo ?? null,
    estado: row.estado ?? "pendiente",
    vehiculo: unidad ? etiqueta_vehiculo(unidad) : String(row.vehiculo ?? ""),
    firma,
    firmado: !!firma.trim(),
    firmante: String((tipo === "reparacion" ? row.autorizado_por : row.firmante) ?? ""),
  };
}

/** Lo que sigue vigente de cada tipo (lo borrado después de enviar no tumba el envío). */
async function vivos(ctx: KirletCtx, tipo: TipoFirma, ids: string[]): Promise<DomainRow[]> {
  if (!ids.length) return [];
  const filas = await ctx.data.findMany(INFO_TIPO[tipo].tabla, { where: { id: { in: ids } }, limit: ids.length });
  const por_id = new Map(filas.filter((f) => f.is_active !== false).map((f) => [String(f.id), f]));
  return ids.map((id) => por_id.get(id)).filter((f): f is DomainRow => !!f);
}

async function vista_envio(
  ctx: KirletCtx,
  envio: DomainRow,
  opts: { incluir_visitas?: boolean } = {},
) {
  const ids = ids_envio(envio);
  const bitacoras = [];
  for (const bitacora of ids.bitacora.length ? await bitacoras_de(ctx, ids.bitacora) : []) {
    bitacoras.push(await vista_bitacora(ctx, bitacora));
  }
  const reparaciones = [];
  for (const row of await vivos(ctx, "reparacion", ids.reparacion)) {
    reparaciones.push(await vista_trabajo(ctx, "reparacion", row));
  }
  const mantenimientos = [];
  for (const row of await vivos(ctx, "mantenimiento", ids.mantenimiento)) {
    mantenimientos.push(await vista_trabajo(ctx, "mantenimiento", row));
  }
  const visitas = normalizar_visitas(envio.visitas);
  const base = {
    ...envio,
    bitacoras,
    reparaciones,
    mantenimientos,
    resumen: resumen_envio(envio),
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
  const todos = ids_envio(envio);
  const quien = firmante.trim() || "Público";
  // Firma única: lo que ya trae firma no se pisa.
  for (const row of await vivos(ctx, "reparacion", todos.reparacion)) {
    if (String(row.firma_autoriza ?? "").trim()) continue;
    const estado = estado_reparacion(row.estado) ?? "pendiente";
    await ctx.data.update("mantenimiento_correctivo", { id: String(row.id) }, {
      firma_autoriza: firma.trim(),
      autorizado_at: ts,
      autorizado_por: quien,
      ...(estado === "pendiente" ? { estado: "autorizado" } : {}),
      updated_at: ts,
    });
  }
  for (const row of await vivos(ctx, "mantenimiento", todos.mantenimiento)) {
    if (String(row.firma_revisa ?? "").trim()) continue;
    await ctx.data.update("mantenimiento_preventivo", { id: String(row.id) }, {
      firma_revisa: firma.trim(),
      firmado_at: ts,
      firmante: quien,
      updated_at: ts,
    });
  }
  const ids = todos.bitacora;
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
    optionsSource: `${API}/bitacora?as=options&limite=1000`,
    help: "Elige una o más bitácoras. Quien firme lo hace una sola vez para todo el grupo.",
  },
  {
    name: "reparacion_ids",
    component: "input-checkbox-group",
    label: "Reparaciones a autorizar",
    column_span: "full",
    optionsSource: `${API}/mantenimiento-correctivo?as=options&limite=1000`,
    help: "Al firmar el envío quedan autorizadas (estatus Autorizado). Las que ya tienen firma no se pueden enviar.",
  },
  {
    name: "mantenimiento_ids",
    component: "input-checkbox-group",
    label: "Mantenimientos a revisar",
    column_span: "full",
    optionsSource: `${API}/mantenimiento-preventivo?as=options&limite=1000`,
    help: "Firma de revisión opcional; no cambia su estatus.",
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
    help: "Una sola firma aplica a todo el envío: bitácoras, reparaciones y mantenimientos.",
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
  subtitle: "Manda bitácoras, reparaciones o mantenimientos a firmar una sola vez, por usuario interno o con enlace público",
  columns: [
    { name: "modo", type: "text", notNull: true },
    { name: "usuario_id", type: "text" },
    { name: "usuario_nombre", type: "text" },
    { name: "bitacora_ids", type: "json" },
    { name: "reparacion_ids", type: "json" },
    { name: "mantenimiento_ids", type: "json" },
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
    reparacion_ids: { type: "json" },
    mantenimiento_ids: { type: "json" },
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
      confirm: "Se aplica una sola firma a todo el envío (bitácoras, reparaciones y mantenimientos).",
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
      const ids = ids_envio(row);
      await validar_contenido(ctx, ids, { revisar_duplicados: true });
      row.bitacora_ids = ids.bitacora;
      row.reparacion_ids = ids.reparacion;
      row.mantenimiento_ids = ids.mantenimiento;
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
      const toca_ids = "bitacora_ids" in row || "reparacion_ids" in row || "mantenimiento_ids" in row;
      if (toca_ids) {
        const ids = ids_envio(row, existing);
        const estado = String(row.estado ?? existing.estado ?? "pendiente");
        await validar_contenido(ctx, ids, {
          excluir_envio: String(existing.id),
          revisar_duplicados: estado !== "cancelado",
        });
        for (const tipo of ["bitacora", "reparacion", "mantenimiento"] as const) {
          const campo = INFO_TIPO[tipo].campo;
          if (campo in row) row[campo] = ids[tipo];
        }
      } else if (
        String(existing.estado ?? "") === "cancelado" &&
        "estado" in row &&
        String(row.estado ?? "") !== "cancelado"
      ) {
        // Reactivar un cancelado vuelve a retener lo que trae.
        const ids = ids_envio(existing);
        for (const tipo of ["bitacora", "reparacion", "mantenimiento"] as const) {
          await exigir_sin_duplicados(ctx, ids[tipo], String(existing.id), tipo);
        }
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
