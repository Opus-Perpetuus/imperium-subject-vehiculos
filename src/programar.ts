/**
 * Programar desde una bitácora, al crearla o al editarla: una revisión
 * (servicio programado), una reparación (pendiente de autorizar con firma) o
 * un mantenimiento (pendiente). Los campos `programar_*` no se guardan en la
 * bitácora: solo disparan el alta del registro ligado por `bitacora_id`.
 */
import {
  KirletHttpError,
  new_id,
  now_iso,
  type DomainRow,
  type FeatureShellFieldDescriptor,
  type KirletCtx,
} from "@opus-perpetuus/imperium-core-kit";
import { es_error, etiqueta_vehiculo, fecha_iso, normalizar_items, partida_en_alarma } from "./control.ts";

export type Programacion = {
  revision: string | null;
  reparacion: string | null;
  mantenimiento: string | null;
  nota: string;
};

export const CAMPOS_PROGRAMAR = [
  "programar_revision",
  "programar_reparacion",
  "programar_mantenimiento",
  "programar_nota",
] as const;

export const FIELDS_PROGRAMAR: Record<string, { type: "string" }> = Object.fromEntries(
  CAMPOS_PROGRAMAR.map((k) => [k, { type: "string" as const }]),
);

export const FORM_PROGRAMAR: FeatureShellFieldDescriptor[] = [
  {
    name: "programar_revision",
    component: "input-date",
    label: "Programar revisión para",
    help: "Crea un servicio programado ligado a esta bitácora. Déjalo vacío si no hace falta.",
  },
  {
    name: "programar_reparacion",
    component: "input-date",
    label: "Programar reparación para",
    help: "Crea una reparación pendiente; se autoriza con una sola firma (interna o compartida).",
  },
  {
    name: "programar_mantenimiento",
    component: "input-date",
    label: "Programar mantenimiento para",
    help: "Crea un mantenimiento pendiente, con firma de revisión opcional.",
  },
  {
    name: "programar_nota",
    component: "input-textarea",
    label: "Nota de lo programado",
    help: "Si la dejas vacía se anotan las partidas en alarma.",
  },
  {
    name: "programados_texto",
    component: "input-textarea",
    label: "Programado desde esta bitácora",
    column_span: "full",
    read_only: true,
  },
];

function fecha_pedida(row: DomainRow, key: string): string | null {
  const crudo = String(row[key] ?? "").trim();
  if (!crudo) return null;
  const fecha = fecha_iso(crudo);
  if (!fecha) throw new KirletHttpError(400, "validation_error", `${key.replace("_", " ")}: la fecha no es válida`);
  return fecha;
}

/** Lee y quita los campos `programar_*`. `null` si no pide nada. */
export function tomar_programacion(row: DomainRow): Programacion | null {
  const p: Programacion = {
    revision: fecha_pedida(row, "programar_revision"),
    reparacion: fecha_pedida(row, "programar_reparacion"),
    mantenimiento: fecha_pedida(row, "programar_mantenimiento"),
    nota: String(row.programar_nota ?? "").trim(),
  };
  for (const k of CAMPOS_PROGRAMAR) delete row[k];
  delete row.programados_texto;
  if (!p.revision && !p.reparacion && !p.mantenimiento) return null;
  return p;
}

function alarmas_de(bitacora: DomainRow): string[] {
  const items = normalizar_items(bitacora.items);
  if (es_error(items)) return [];
  return items.filter(partida_en_alarma).map((p) => p.concepto);
}

export async function programar_desde_bitacora(
  ctx: KirletCtx,
  bitacora: DomainRow,
  p: Programacion,
): Promise<DomainRow[]> {
  const vehicle_id = String(bitacora.vehicle_id ?? "").trim();
  if (!vehicle_id) throw new KirletHttpError(400, "validation_error", "la bitácora necesita vehículo para programar");
  const unidad = await ctx.data.findOne("vehicle", { id: vehicle_id });
  const vehiculo = unidad ? etiqueta_vehiculo(unidad) : String(bitacora.vehiculo ?? "");
  const titulo = String(bitacora.name ?? "bitácora").trim() || "bitácora";
  const alarmas = alarmas_de(bitacora);
  const nota = p.nota || (alarmas.length ? `Partidas en alarma: ${alarmas.join(", ")}` : `Desde la bitácora «${titulo}»`);
  const ts = now_iso();
  const base = {
    vehicle_id,
    vehiculo,
    bitacora_id: String(bitacora.id),
    description: nota,
    is_active: true,
    created_at: ts,
    updated_at: ts,
  };
  const creados: DomainRow[] = [];
  if (p.revision) {
    creados.push(
      await ctx.data.insert("servicio_programado", {
        ...base,
        id: new_id("servicio_pro"),
        name: `Revisión: ${titulo}`,
        proxima_fecha: p.revision,
        estado: "programado",
      }),
    );
  }
  if (p.reparacion) {
    creados.push(
      await ctx.data.insert("mantenimiento_correctivo", {
        ...base,
        id: new_id("mantenimient"),
        name: `Reparación: ${titulo}`,
        fecha: p.reparacion,
        estado: "pendiente",
        firma_autoriza: "",
        autorizado_por: "",
      }),
    );
  }
  if (p.mantenimiento) {
    creados.push(
      await ctx.data.insert("mantenimiento_preventivo", {
        ...base,
        id: new_id("mantenimient"),
        name: `Mantenimiento: ${titulo}`,
        fecha: p.mantenimiento,
        estado: "pendiente",
        firma_revisa: "",
        firmante: "",
      }),
    );
  }
  return creados;
}

const ETIQUETA_ESTADO: Record<string, string> = {
  programado: "Programado",
  cumplido: "Cumplido",
  pendiente: "Pendiente",
  autorizado: "Autorizado",
  en_proceso: "En proceso",
  terminado: "Terminado",
  cancelado: "Cancelado",
};

/** Resumen legible de lo programado desde la bitácora (para el detalle). */
export async function programados_de(ctx: KirletCtx, bitacora_id: string): Promise<string> {
  const where = { where: { bitacora_id }, limit: 200 };
  const [servicios, reparaciones, mantenimientos] = await Promise.all([
    ctx.data.findMany("servicio_programado", where),
    ctx.data.findMany("mantenimiento_correctivo", where),
    ctx.data.findMany("mantenimiento_preventivo", where),
  ]);
  const linea = (tipo: string, f: DomainRow, fecha: unknown) => {
    const estado = String(f.estado ?? "");
    return `${tipo} · ${String(fecha ?? "").slice(0, 10) || "sin fecha"} · ${String(f.name ?? "")} · ${ETIQUETA_ESTADO[estado] ?? estado}`;
  };
  const vivas = (filas: DomainRow[]) => filas.filter((f) => f.is_active !== false);
  const lineas = [
    ...vivas(servicios).map((f) => linea("Revisión", f, f.proxima_fecha)),
    ...vivas(reparaciones).map((f) => linea("Reparación", f, f.fecha)),
    ...vivas(mantenimientos).map((f) => linea("Mantenimiento", f, f.fecha)),
  ];
  return lineas.length ? lineas.join("\n") : "Nada programado todavía.";
}
