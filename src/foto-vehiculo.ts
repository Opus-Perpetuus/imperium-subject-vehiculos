/**
 * La foto de un vehículo vive aparte (`vehicle_foto`), no en la fila del padrón.
 * Así la lista y todo lo que lee `vehicle` (selectores, reportes, duplicados)
 * no arrastra el base64: 7 unidades con foto pesaban ~10 MB por listado.
 * La lista lleva `foto_url` (cacheable por `?v=hash`); el detalle sigue
 * entregando `foto` completa para el formulario y las revisiones.
 */
import { createHash } from "node:crypto";
import type { DomainRow, KirletCtx, KirletDataClient } from "@opus-perpetuus/imperium-core-kit";
import { now_iso } from "@opus-perpetuus/imperium-core-kit";

export const TABLA_FOTO = "vehicle_foto";
export const RUTA_FOTO = "/api/m/subject-vehiculos/vehicle";

const DATA_URL = /^data:(image\/[a-z0-9.+-]+);base64,/i;

export function es_foto_embebida(value: unknown): value is string {
  return typeof value === "string" && DATA_URL.test(value.trim());
}

export function hash_foto(data: string): string {
  return createHash("sha256").update(data).digest("hex").slice(0, 16);
}

export function foto_url(row: DomainRow): string | null {
  const hash = String(row.foto_hash ?? "").trim();
  if (hash) return `${RUTA_FOTO}/${encodeURIComponent(String(row.id))}/foto?v=${hash}`;
  const foto = String(row.foto ?? "").trim();
  return /^(https?:\/\/|\/)/i.test(foto) ? foto : null;
}

type Datos = Pick<KirletDataClient, "findOne" | "insert" | "update" | "delete">;

async function guardar(data: Datos, id: string, foto: string): Promise<string> {
  const hash = hash_foto(foto);
  const ts = now_iso();
  const existe = await data.findOne(TABLA_FOTO, { id });
  if (!existe) await data.insert(TABLA_FOTO, { id, data: foto, hash, created_at: ts, updated_at: ts });
  else if (existe.hash !== hash) await data.update(TABLA_FOTO, { id }, { data: foto, hash, updated_at: ts });
  return hash;
}

/**
 * Antes de escribir `vehicle`: una foto embebida pasa a `vehicle_foto` y la
 * fila se queda con `foto_hash`. Vaciar la foto o poner una URL borra la guardada.
 */
export async function separar_foto(data: Datos, id: string, patch: DomainRow): Promise<void> {
  if (!("foto" in patch)) return;
  const foto = typeof patch.foto === "string" ? patch.foto.trim() : "";
  if (es_foto_embebida(foto)) {
    patch.foto_hash = await guardar(data, id, foto);
    patch.foto = null;
    return;
  }
  await data.delete(TABLA_FOTO, { id });
  patch.foto_hash = null;
  patch.foto = foto || null;
}

/** La foto completa (data URL o URL) de una unidad, para el detalle y las revisiones. */
export async function foto_completa(data: Pick<KirletDataClient, "findOne">, row: DomainRow | null | undefined): Promise<unknown> {
  if (!row) return undefined;
  if (!String(row.foto_hash ?? "").trim()) return row.foto;
  const guardada = await data.findOne(TABLA_FOTO, { id: String(row.id) });
  return guardada?.data ?? row.foto;
}

/** Fila para listas: sin base64, con `foto_url`. */
export function fila_sin_foto(row: DomainRow): DomainRow {
  const { foto: _foto, ...resto } = row;
  return { ...resto, foto_url: foto_url(row) };
}

/** GET /vehicle/:id/foto — la imagen en binario, cacheable por hash. */
export async function responder_foto(ctx: KirletCtx): Promise<Response> {
  const id = String(ctx.params.id ?? "");
  const vehicle = await ctx.data.findOne("vehicle", { id });
  if (!vehicle || vehicle.is_active === false) return new Response(null, { status: 404 });
  const guardada = await ctx.data.findOne(TABLA_FOTO, { id });
  const foto = String(guardada?.data ?? "");
  const m = DATA_URL.exec(foto);
  if (!guardada || !m) return new Response(null, { status: 404 });
  const etag = `"${guardada.hash}"`;
  const versionada = new URL(ctx.req.url).searchParams.get("v") === guardada.hash;
  const headers = {
    "content-type": m[1]!.toLowerCase(),
    etag,
    // Va con sesión: solo caché del navegador. Con ?v=hash nunca cambia.
    "cache-control": versionada ? "private, max-age=31536000, immutable" : "private, no-cache",
  };
  if (ctx.req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(Buffer.from(foto.slice(m[0].length), "base64"), { status: 200, headers });
}

/**
 * Migración idempotente: las unidades con la foto embebida en la fila la
 * pasan a `vehicle_foto`. Lo ya migrado (sin data URL en `foto`) no se toca.
 */
export async function migrar_fotos(data: KirletDataClient): Promise<{ migradas: number }> {
  const filas = await data.findMany("vehicle", { limit: 50_000 });
  let migradas = 0;
  for (const fila of filas) {
    if (!es_foto_embebida(fila.foto)) continue;
    const id = String(fila.id);
    const foto_hash = await guardar(data, id, String(fila.foto).trim());
    await data.update("vehicle", { id }, { foto: null, foto_hash });
    migradas++;
  }
  return { migradas };
}
