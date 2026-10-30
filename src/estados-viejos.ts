/**
 * Migración segura de los estados viejos «Abierto/Cerrado» de reparaciones y
 * mantenimientos (antes de v0.14.0 se sembraban con esas opciones). Cada
 * registro con un valor viejo pasa al estatus nuevo equivalente
 * (abierto → pendiente, cerrado → terminado). Solo cuando ninguna fila de un
 * modelo conserva un valor viejo se pide al núcleo retirar esas opciones de
 * su catálogo (las que el usuario creó a mano no se tocan). Idempotente.
 */
import type { KirletDataClient } from "@opus-perpetuus/imperium-core-kit";
import { now_iso } from "@opus-perpetuus/imperium-core-kit";
import { estado_mantenimiento, estado_reparacion } from "./autorizacion.ts";

/** Valores que el catálogo ya no ofrece en reparaciones y mantenimientos. */
export const VALORES_VIEJOS = ["abierto", "cerrado"] as const;

const VIEJOS = new Set(["abierto", "abierta", "cerrado", "cerrada"]);

export const MODELOS_CON_ESTADOS_VIEJOS = [
  { table: "mantenimiento_correctivo", model_id: "subject-vehiculos/mantenimiento-correctivo", normalizar: estado_reparacion },
  { table: "mantenimiento_preventivo", model_id: "subject-vehiculos/mantenimiento-preventivo", normalizar: estado_mantenimiento },
] as const;

export const es_estado_viejo = (v: unknown): boolean =>
  VIEJOS.has(
    String(v ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, ""),
  );

export type MigracionEstados = {
  /** Filas que pasaron al estatus nuevo, por tabla. */
  migradas: Record<string, number>;
  /** Modelos sin ningún valor viejo: se pueden retirar sus opciones viejas. */
  limpios: string[];
};

const MAX_FILAS = 50_000;

export async function migrar_estados_viejos(data: KirletDataClient): Promise<MigracionEstados> {
  const out: MigracionEstados = { migradas: {}, limpios: [] };
  for (const m of MODELOS_CON_ESTADOS_VIEJOS) {
    const filas = await data.findMany(m.table, { limit: MAX_FILAS });
    let migradas = 0;
    let quedan = filas.length >= MAX_FILAS; // sin ver todas, no se retira nada
    for (const f of filas) {
      if (!es_estado_viejo(f.estado)) continue;
      const nuevo = m.normalizar(f.estado);
      const hecho = nuevo ? await data.update(m.table, { id: String(f.id) }, { estado: nuevo, updated_at: now_iso() }) : null;
      if (hecho) migradas++;
      else quedan = true;
    }
    out.migradas[m.table] = migradas;
    if (!quedan) out.limpios.push(m.model_id);
  }
  return out;
}
