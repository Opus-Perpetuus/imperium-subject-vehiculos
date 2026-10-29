/**
 * Alta, duplicados y cancelación de envíos a revisión.
 *
 * Una bitácora vive en a lo más un envío vigente: `pendiente` (falta firmar) o
 * `firmado` (ya revisada). Reenviarla duplicaba la firma pedida y, al firmar
 * el segundo, pisaba la primera. Para volver a mandarla hay que cancelar el
 * envío pendiente; uno cancelado ya no cuenta.
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

/** Estados en que el envío retiene sus bitácoras. */
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

/** Liga para mandar: pública sin sesión, interna al detalle con sesión. */
export function compartir_envio(envio: DomainRow): { ruta: string; texto: string; modo: string } {
  const modo = String(envio.modo ?? "");
  const n = ids_de(envio.bitacora_ids).length;
  const titulo = String(envio.name ?? "Revisión de bitácoras").trim();
  const cuantas = n === 1 ? "1 bitácora" : `${n} bitácoras`;
  if (modo === "publico") {
    return {
      modo,
      ruta: ruta_publica_envio(envio.id),
      texto: `Hola, te comparto «${titulo}» (${cuantas}) para revisar y firmar:`,
    };
  }
  return {
    modo,
    ruta: ruta_detalle_envio(envio.id, envio.name),
    texto: `Hola, tienes pendiente «${titulo}» (${cuantas}) para revisar y firmar en Imperium:`,
  };
}

export type Ocupada = { bitacora_id: string; envio_id: string; envio_nombre: string; estado: string };

/** Bitácoras de `ids` que ya están en otro envío vigente. */
export async function bitacoras_ocupadas(
  ctx: KirletCtx,
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
  for (const envio of envios) {
    if (excluir_envio && String(envio.id) === excluir_envio) continue;
    if (!envio_vigente(envio)) continue;
    for (const id of ids_de(envio.bitacora_ids)) {
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

function motivo(o: Ocupada, nombre: string): string {
  return o.estado === "firmado"
    ? `«${nombre}» ya fue revisada en «${o.envio_nombre}»`
    : `«${nombre}» ya está en el envío pendiente «${o.envio_nombre}»`;
}

/** Qué hacer: un envío pendiente se puede cancelar; uno firmado ya no. */
function pista(estados: readonly string[]): string {
  const pendientes = estados.filter((e) => e !== "firmado").length;
  if (!pendientes) return "Ya están revisadas; no hace falta enviarlas otra vez.";
  return pendientes === 1
    ? "Cancela el envío pendiente si quieres mandarla de nuevo."
    : "Cancela los envíos pendientes si quieres mandarlas de nuevo.";
}

async function nombres(ctx: KirletCtx, ids: readonly string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const filas = await ctx.data.findMany("bitacora", { where: { id: { in: [...ids] } }, limit: ids.length });
  return new Map(filas.map((f) => [String(f.id), String(f.name ?? f.id)]));
}

/** 409 si alguna bitácora ya tiene envío vigente. */
export async function exigir_sin_duplicados(
  ctx: KirletCtx,
  ids: readonly string[],
  excluir_envio?: string,
): Promise<void> {
  const ocupadas = await bitacoras_ocupadas(ctx, ids, excluir_envio);
  if (!ocupadas.size) return;
  const por_id = await nombres(ctx, [...ocupadas.keys()]);
  const detalle = [...ocupadas.values()].map((o) => motivo(o, por_id.get(o.bitacora_id) ?? o.bitacora_id));
  throw new KirletHttpError(
    409,
    "conflict",
    `No se reenvía: ${detalle.join("; ")}. ${pista([...ocupadas.values()].map((o) => o.estado))}`,
  );
}

export type Omitida = { id: string; name: string; motivo: string };

export async function crear_envio(
  ctx: KirletCtx,
  opts: {
    ids: string[];
    modo: ModoEnvio;
    name?: string;
    description?: string;
    usuario_id?: string;
    usuario_nombre?: string;
    /** Masivo: salta las ocupadas y avisa; individual: 409. */
    omitir_ocupadas?: boolean;
  },
): Promise<{ envio: DomainRow; omitidas: Omitida[] }> {
  if (!opts.ids.length) throw new KirletHttpError(400, "validation_error", "elige al menos una bitácora");
  const filas = await ctx.data.findMany("bitacora", { where: { id: { in: opts.ids } }, limit: opts.ids.length });
  const vivas = new Map(filas.filter((f) => f.is_active !== false).map((f) => [String(f.id), f]));
  for (const id of opts.ids) {
    if (!vivas.has(id)) throw new KirletHttpError(400, "validation_error", `la bitácora ${id} no existe`);
  }
  let ids = opts.ids;
  const omitidas: Omitida[] = [];
  if (opts.omitir_ocupadas) {
    const ocupadas = await bitacoras_ocupadas(ctx, ids);
    const estados = [...ocupadas.values()].map((o) => o.estado);
    for (const [id, o] of ocupadas) {
      const name = String(vivas.get(id)?.name ?? id);
      omitidas.push({ id, name, motivo: motivo(o, name) });
    }
    ids = ids.filter((id) => !ocupadas.has(id));
    if (!ids.length) {
      throw new KirletHttpError(
        409,
        "conflict",
        `Ninguna bitácora se envió: ${omitidas.map((o) => o.motivo).join("; ")}. ${pista(estados)}`,
      );
    }
  } else {
    await exigir_sin_duplicados(ctx, ids);
  }
  const primera = vivas.get(ids[0]!);
  const titulo =
    String(opts.name ?? "").trim() ||
    (ids.length === 1 ? `Revisión: ${String(primera?.name ?? ids[0])}` : `Revisión de ${ids.length} bitácoras`);
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
    bitacora_ids: ids,
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

/** Envíos pendientes que contienen alguna de las bitácoras. */
export async function envios_pendientes_de(ctx: KirletCtx, bitacora_ids: readonly string[]): Promise<string[]> {
  const ocupadas = await bitacoras_ocupadas(ctx, bitacora_ids);
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
