/**
 * Alta, duplicados y cancelación de envíos a revisión.
 *
 * Un envío junta lo que se firma de una vez: bitácoras (firma de revisión),
 * reparaciones (firma de autorización) y mantenimientos (firma de revisión
 * opcional). Cada registro vive en a lo más un envío vigente: `pendiente`
 * (falta firmar) o `firmado`. Reenviarlo duplicaba la firma pedida y, al
 * firmar el segundo, pisaba la primera. Para volver a mandarlo hay que
 * cancelar el envío pendiente; uno cancelado ya no cuenta.
 */
import {
  KirletHttpError,
  new_id,
  now_iso,
  type DomainRow,
  type KirletCtx,
} from "@opus-perpetuus/imperium-core-kit";
import { ruta_detalle_envio, ruta_publica_envio } from "./control.ts";

export type ModoEnvio = "interno" | "publico";

export type TipoFirma = "bitacora" | "reparacion" | "mantenimiento";

export const TIPOS_FIRMA: readonly TipoFirma[] = ["bitacora", "reparacion", "mantenimiento"];

type InfoTipo = {
  tabla: string;
  /** Columna del envío con los ids. */
  campo: "bitacora_ids" | "reparacion_ids" | "mantenimiento_ids";
  /** Columna del registro donde queda la firma. */
  firma: string;
  uno: string;
  varios: string;
  articulo: "la" | "el";
};

export const INFO_TIPO: Record<TipoFirma, InfoTipo> = {
  bitacora: {
    tabla: "bitacora",
    campo: "bitacora_ids",
    firma: "firma_revisa",
    uno: "bitácora",
    varios: "bitácoras",
    articulo: "la",
  },
  reparacion: {
    tabla: "mantenimiento_correctivo",
    campo: "reparacion_ids",
    firma: "firma_autoriza",
    uno: "reparación",
    varios: "reparaciones",
    articulo: "la",
  },
  mantenimiento: {
    tabla: "mantenimiento_preventivo",
    campo: "mantenimiento_ids",
    firma: "firma_revisa",
    uno: "mantenimiento",
    varios: "mantenimientos",
    articulo: "el",
  },
};

/** Estados en que el envío retiene sus registros. */
export const ESTADOS_VIGENTES: ReadonlySet<string> = new Set(["pendiente", "firmado"]);

export function ids_de(value: unknown): string[] {
  if (Array.isArray(value)) {
    return [...new Set(value.map((id) => String(id ?? "").trim()).filter(Boolean))];
  }
  if (typeof value === "string") {
    return [...new Set(value.split(/[\s,]+/).map((id) => id.trim()).filter(Boolean))];
  }
  return [];
}

export function envio_vigente(envio: DomainRow): boolean {
  if (envio.is_active === false) return false;
  return ESTADOS_VIGENTES.has(String(envio.estado ?? "pendiente") || "pendiente");
}

function cuantos(n: number, tipo: TipoFirma): string {
  const info = INFO_TIPO[tipo];
  return n === 1 ? `1 ${info.uno}` : `${n} ${info.varios}`;
}

/** «2 bitácoras y 1 reparación». */
export function resumen_envio(envio: DomainRow): string {
  const partes = TIPOS_FIRMA.map((tipo) => ({ tipo, n: ids_de(envio[INFO_TIPO[tipo].campo]).length }))
    .filter((p) => p.n > 0)
    .map((p) => cuantos(p.n, p.tipo));
  if (!partes.length) return cuantos(0, "bitacora");
  if (partes.length === 1) return partes[0]!;
  return `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
}

/** Liga para mandar: pública sin sesión, interna al detalle con sesión. */
export function compartir_envio(envio: DomainRow): { ruta: string; texto: string; modo: string } {
  const modo = String(envio.modo ?? "");
  const titulo = String(envio.name ?? "Revisión").trim();
  const que = resumen_envio(envio);
  const verbo = ids_de(envio.reparacion_ids).length ? "revisar y autorizar con tu firma" : "revisar y firmar";
  if (modo === "publico") {
    return {
      modo,
      ruta: ruta_publica_envio(envio.id),
      texto: `Hola, te comparto «${titulo}» (${que}) para ${verbo}:`,
    };
  }
  return {
    modo,
    ruta: ruta_detalle_envio(envio.id, envio.name),
    texto: `Hola, tienes pendiente «${titulo}» (${que}) para ${verbo} en Imperium:`,
  };
}

export type Ocupada = { bitacora_id: string; envio_id: string; envio_nombre: string; estado: string };

/** Registros de `ids` (del tipo dado) que ya están en otro envío vigente. */
export async function registros_ocupados(
  ctx: KirletCtx,
  tipo: TipoFirma,
  ids: readonly string[],
  excluir_envio?: string,
): Promise<Map<string, Ocupada>> {
  const buscadas = new Set(ids);
  const ocupadas = new Map<string, Ocupada>();
  if (!buscadas.size) return ocupadas;
  const envios = await ctx.data.findMany("envio_revision", {
    where: { is_active: true },
    limit: 10000,
  });
  const campo = INFO_TIPO[tipo].campo;
  for (const envio of envios) {
    if (excluir_envio && String(envio.id) === excluir_envio) continue;
    if (!envio_vigente(envio)) continue;
    for (const id of ids_de(envio[campo])) {
      if (!buscadas.has(id) || ocupadas.has(id)) continue;
      ocupadas.set(id, {
        bitacora_id: id,
        envio_id: String(envio.id),
        envio_nombre: String(envio.name ?? ""),
        estado: String(envio.estado ?? "pendiente"),
      });
    }
  }
  return ocupadas;
}

/** Bitácoras de `ids` que ya están en otro envío vigente. */
export function bitacoras_ocupadas(ctx: KirletCtx, ids: readonly string[], excluir_envio?: string) {
  return registros_ocupados(ctx, "bitacora", ids, excluir_envio);
}

function motivo(o: Ocupada, nombre: string, tipo: TipoFirma = "bitacora"): string {
  const hecho = tipo === "reparacion" ? "autorizada" : tipo === "mantenimiento" ? "firmado" : "revisada";
  return o.estado === "firmado"
    ? `«${nombre}» ya fue ${hecho} en «${o.envio_nombre}»`
    : `«${nombre}» ya está en el envío pendiente «${o.envio_nombre}»`;
}

/** Qué hacer: un envío pendiente se puede cancelar; uno firmado ya no. */
function pista(estados: readonly string[]): string {
  const pendientes = estados.filter((e) => e !== "firmado").length;
  if (!pendientes) return "Ya están firmadas; no hace falta enviarlas otra vez.";
  return pendientes === 1
    ? "Cancela el envío pendiente si quieres mandarla de nuevo."
    : "Cancela los envíos pendientes si quieres mandarlas de nuevo.";
}

async function nombres(ctx: KirletCtx, tipo: TipoFirma, ids: readonly string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const filas = await ctx.data.findMany(INFO_TIPO[tipo].tabla, { where: { id: { in: [...ids] } }, limit: ids.length });
  return new Map(filas.map((f) => [String(f.id), String(f.name ?? f.id)]));
}

/** 409 si algún registro ya tiene envío vigente. */
export async function exigir_sin_duplicados(
  ctx: KirletCtx,
  ids: readonly string[],
  excluir_envio?: string,
  tipo: TipoFirma = "bitacora",
): Promise<void> {
  const ocupadas = await registros_ocupados(ctx, tipo, ids, excluir_envio);
  if (!ocupadas.size) return;
  const por_id = await nombres(ctx, tipo, [...ocupadas.keys()]);
  const detalle = [...ocupadas.values()].map((o) => motivo(o, por_id.get(o.bitacora_id) ?? o.bitacora_id, tipo));
  throw new KirletHttpError(
    409,
    "conflict",
    `No se reenvía: ${detalle.join("; ")}. ${pista([...ocupadas.values()].map((o) => o.estado))}`,
  );
}

/** Registros vivos de un tipo, en el orden pedido; 400 si falta alguno. */
export async function registros_de(ctx: KirletCtx, tipo: TipoFirma, ids: readonly string[]): Promise<DomainRow[]> {
  if (!ids.length) return [];
  const info = INFO_TIPO[tipo];
  const filas = await ctx.data.findMany(info.tabla, { where: { id: { in: [...ids] } }, limit: ids.length });
  const por_id = new Map(filas.filter((f) => f.is_active !== false).map((f) => [String(f.id), f]));
  return ids.map((id) => {
    const fila = por_id.get(id);
    if (!fila) throw new KirletHttpError(400, "validation_error", `${info.articulo} ${info.uno} ${id} no existe`);
    return fila;
  });
}

/** 409 si alguna reparación o mantenimiento ya trae su firma (se firma una sola vez). */
export function exigir_sin_firma(tipo: TipoFirma, filas: readonly DomainRow[]): void {
  if (tipo === "bitacora") return;
  const info = INFO_TIPO[tipo];
  const firmadas = filas.filter((f) => String(f[info.firma] ?? "").trim());
  if (!firmadas.length) return;
  throw new KirletHttpError(
    409,
    "conflict",
    `Ya ${firmadas.length === 1 ? "tiene" : "tienen"} firma: ${firmadas
      .map((f) => `«${String(f.name ?? f.id)}»`)
      .join(", ")}. La firma solo se pone una vez.`,
  );
}

export type Omitida = { id: string; name: string; motivo: string };

export async function crear_envio(
  ctx: KirletCtx,
  opts: {
    ids: string[];
    /** De qué son los `ids`. Por defecto bitácoras. */
    tipo?: TipoFirma;
    modo: ModoEnvio;
    name?: string;
    description?: string;
    usuario_id?: string;
    usuario_nombre?: string;
    /** Masivo: salta las ocupadas y avisa; individual: 409. */
    omitir_ocupadas?: boolean;
  },
): Promise<{ envio: DomainRow; omitidas: Omitida[] }> {
  const tipo = opts.tipo ?? "bitacora";
  const info = INFO_TIPO[tipo];
  if (!opts.ids.length) throw new KirletHttpError(400, "validation_error", `elige al menos ${tipo === "mantenimiento" ? "un" : "una"} ${info.uno}`);
  const filas = await registros_de(ctx, tipo, opts.ids);
  const vivas = new Map(filas.map((f) => [String(f.id), f]));
  let ids = opts.ids;
  const omitidas: Omitida[] = [];
  if (opts.omitir_ocupadas) {
    const ocupadas = await registros_ocupados(ctx, tipo, ids);
    const estados = [...ocupadas.values()].map((o) => o.estado);
    for (const [id, o] of ocupadas) {
      const name = String(vivas.get(id)?.name ?? id);
      omitidas.push({ id, name, motivo: motivo(o, name, tipo) });
    }
    if (tipo !== "bitacora") {
      for (const fila of filas) {
        const id = String(fila.id);
        if (ocupadas.has(id) || !String(fila[info.firma] ?? "").trim()) continue;
        const name = String(fila.name ?? id);
        omitidas.push({ id, name, motivo: `«${name}» ya tiene firma` });
        ocupadas.set(id, { bitacora_id: id, envio_id: "", envio_nombre: "", estado: "firmado" });
        estados.push("firmado");
      }
    }
    ids = ids.filter((id) => !ocupadas.has(id));
    if (!ids.length) {
      throw new KirletHttpError(
        409,
        "conflict",
        `No se envió nada: ${omitidas.map((o) => o.motivo).join("; ")}. ${pista(estados)}`,
      );
    }
  } else {
    exigir_sin_firma(tipo, filas);
    await exigir_sin_duplicados(ctx, ids, undefined, tipo);
  }
  const primera = vivas.get(ids[0]!);
  const accion = tipo === "reparacion" ? "Autorización" : "Revisión";
  const titulo =
    String(opts.name ?? "").trim() ||
    (ids.length === 1
      ? `${accion}: ${String(primera?.name ?? ids[0])}`
      : `${accion} de ${cuantos(ids.length, tipo)}`);
  const usuario_id = opts.modo === "interno" ? String(opts.usuario_id ?? "").trim() : "";
  const ts = now_iso();
  const id = new_id("envio_revi");
  const envio = await ctx.data.insert("envio_revision", {
    id,
    name: titulo,
    description: String(opts.description ?? "").trim(),
    modo: opts.modo,
    usuario_id,
    usuario_nombre: usuario_id ? String(opts.usuario_nombre ?? usuario_id).trim() : "",
    bitacora_ids: tipo === "bitacora" ? ids : [],
    reparacion_ids: tipo === "reparacion" ? ids : [],
    mantenimiento_ids: tipo === "mantenimiento" ? ids : [],
    firma: "",
    firmado_at: "",
    firmante: "",
    estado: "pendiente",
    share_hint: opts.modo === "publico" ? ruta_publica_envio(id) : ruta_detalle_envio(id, titulo),
    is_active: true,
    created_at: ts,
    updated_at: ts,
  });
  return { envio, omitidas };
}

/** Respuesta común al crear: el front lee `compartir` para el botón de WhatsApp. */
export function respuesta_creado(envio: DomainRow, omitidas: Omitida[], mensaje: string) {
  const aviso = omitidas.length
    ? ` No se incluyeron ${omitidas.length}: ${omitidas.map((o) => o.motivo).join("; ")}.`
    : "";
  return {
    data: envio,
    compartir: compartir_envio(envio),
    omitidas,
    mensaje: `${mensaje}${aviso}`,
  };
}

export type ResultadoCancelar = { cancelados: string[]; omitidos: Omitida[] };

/** Cancela los envíos pendientes de `ids`; los firmados o ya cancelados se reportan. */
export async function cancelar_envios(ctx: KirletCtx, ids: readonly string[]): Promise<ResultadoCancelar> {
  if (!ids.length) throw new KirletHttpError(400, "validation_error", "elige al menos un envío");
  const filas = await ctx.data.findMany("envio_revision", { where: { id: { in: [...ids] } }, limit: ids.length });
  const por_id = new Map(filas.map((f) => [String(f.id), f]));
  const cancelados: string[] = [];
  const omitidos: Omitida[] = [];
  const ts = now_iso();
  for (const id of ids) {
    const envio = por_id.get(id);
    const name = String(envio?.name ?? id);
    if (!envio || envio.is_active === false) {
      omitidos.push({ id, name, motivo: `«${name}» no existe` });
      continue;
    }
    const estado = String(envio.estado ?? "pendiente");
    if (estado === "firmado") {
      omitidos.push({ id, name, motivo: `«${name}» ya está firmado` });
      continue;
    }
    if (estado === "cancelado") {
      omitidos.push({ id, name, motivo: `«${name}» ya estaba cancelado` });
      continue;
    }
    await ctx.data.update("envio_revision", { id }, { estado: "cancelado", updated_at: ts });
    cancelados.push(id);
  }
  return { cancelados, omitidos };
}

/** Envíos pendientes que contienen alguno de los registros. */
export async function envios_pendientes_de(
  ctx: KirletCtx,
  ids: readonly string[],
  tipo: TipoFirma = "bitacora",
): Promise<string[]> {
  const ocupadas = await registros_ocupados(ctx, tipo, ids);
  return [...new Set([...ocupadas.values()].filter((o) => o.estado === "pendiente").map((o) => o.envio_id))];
}

export function mensaje_cancelar(r: ResultadoCancelar): string {
  const base =
    r.cancelados.length === 1
      ? "Se canceló 1 envío."
      : r.cancelados.length
        ? `Se cancelaron ${r.cancelados.length} envíos.`
        : "No se canceló ningún envío.";
  return r.omitidos.length ? `${base} Sin cambio: ${r.omitidos.map((o) => o.motivo).join("; ")}.` : base;
}

export async function ids_del_cuerpo(ctx: KirletCtx): Promise<{ ids: string[]; body: Record<string, unknown> }> {
  const body = (await ctx.body<Record<string, unknown>>()) ?? {};
  return { ids: ids_de(body.ids ?? body.bitacora_ids ?? body.bitacora_id), body };
}

type Accion = { id: string; label: string; confirm?: string; method: "POST"; action: string };

const API = "api://m/subject-vehiculos";

/**
 * Botones para mandar reparaciones o mantenimientos a firmar por envío
 * interno o público (individual en el detalle, masivo en la lista).
 */
export function acciones_compartir_firma(
  resource: string,
  verbo: "autorizar" | "revisar",
  masivo = false,
): Accion[] {
  const que = verbo === "autorizar" ? "autorización" : "firma de revisión";
  const base = masivo ? `${API}/${resource}` : `${API}/${resource}/:id`;
  const sel = masivo ? " con los seleccionados" : "";
  return [
    {
      id: `${resource}-firma-interna${masivo ? "-masivo" : ""}`,
      label: `Compartir para ${verbo} (interna)`,
      confirm: `Se crea un envío interno${sel} para ${que}. Se firma una sola vez; luego elige revisor en Envíos a revisión.`,
      method: "POST",
      action: `${base}/compartir-interna`,
    },
    {
      id: `${resource}-firma-publica${masivo ? "-masivo" : ""}`,
      label: `Compartir para ${verbo} (pública)`,
      confirm: `Se crea un envío público${sel} con enlace sin sesión para ${que}. Se firma una sola vez.`,
      method: "POST",
      action: `${base}/compartir-publica`,
    },
  ];
}

/** Rutas de los botones de `acciones_compartir_firma`. */
export function rutas_compartir_firma(resource: string, tipo: TipoFirma) {
  const crear = async (ctx: KirletCtx, ids: string[], body: Record<string, unknown>, modo: ModoEnvio, masivo: boolean) => {
    const usuario_id = String(body.usuario_id ?? "").trim();
    const { envio, omitidas } = await crear_envio(ctx, {
      ids,
      tipo,
      modo,
      name: String(body.name ?? ""),
      description: String(body.description ?? ""),
      usuario_id,
      usuario_nombre: String(body.usuario_nombre ?? ""),
      omitir_ocupadas: masivo,
    });
    const que = resumen_envio(envio);
    const mensaje =
      modo === "publico"
        ? `Envío público listo con ${que}. Mándalo por WhatsApp o copia el enlace.`
        : usuario_id
          ? `Envío interno con ${que} asignado a ${String(envio.usuario_nombre || usuario_id)}.`
          : `Envío interno creado con ${que}. Ábrelo en Envíos a revisión y elige el revisor.`;
    return ctx.json(respuesta_creado(envio, omitidas, mensaje), 201);
  };
  const individual = (modo: ModoEnvio) => async (ctx: KirletCtx) => {
    const body = (await ctx.body<Record<string, unknown>>()) ?? {};
    return crear(ctx, [String(ctx.params.id)], body, modo, false);
  };
  const masivo = (modo: ModoEnvio) => async (ctx: KirletCtx) => {
    const body = (await ctx.body<Record<string, unknown>>()) ?? {};
    return crear(ctx, ids_de(body.ids), body, modo, true);
  };
  return {
    [`POST /${resource}/compartir-interna`]: masivo("interno"),
    [`POST /${resource}/compartir-publica`]: masivo("publico"),
    [`POST /${resource}/:id/compartir-interna`]: individual("interno"),
    [`POST /${resource}/:id/compartir-publica`]: individual("publico"),
  };
}
