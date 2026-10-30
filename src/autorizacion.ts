/**
 * Estatus y firma única de reparaciones (mantenimiento correctivo) y
 * mantenimientos (preventivo). Sin HTTP: las rutas solo aplican lo que
 * devuelven estas funciones.
 *
 * Reparación: se autoriza con firma (obligatoria antes de trabajarla). Al
 * firmar pasa a «autorizado». Mantenimiento: la firma de revisión es opcional
 * y no cambia el estatus. En ambos la firma se pone una sola vez, ya sea un
 * usuario interno en el formulario o desde un envío interno o público.
 */
import { firma_es_trazo } from "./control.ts";

export const ESTADOS_REPARACION = ["pendiente", "autorizado", "en_proceso", "terminado", "cancelado"] as const;
export type EstadoReparacion = (typeof ESTADOS_REPARACION)[number];

export const ESTADOS_MANTENIMIENTO = ["pendiente", "en_proceso", "terminado"] as const;
export type EstadoMantenimiento = (typeof ESTADOS_MANTENIMIENTO)[number];

export type ErrorRegla = { error: string; status: 400 | 409 };

function clave(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s-]+/g, "_");
}

/** Acepta lo que ya estaba guardado (abierto/cerrado) y variantes escritas a mano. */
export function estado_reparacion(value: unknown): EstadoReparacion | null {
  const k = clave(value);
  if (!k || k === "abierto" || k === "abierta" || k === "pendientes") return "pendiente";
  if (k === "cerrado" || k === "cerrada" || k === "terminada") return "terminado";
  if (k === "autorizada") return "autorizado";
  if (k === "cancelada") return "cancelado";
  if (k === "proceso") return "en_proceso";
  return (ESTADOS_REPARACION as readonly string[]).includes(k) ? (k as EstadoReparacion) : null;
}

export function estado_mantenimiento(value: unknown): EstadoMantenimiento | null {
  const k = clave(value);
  if (!k || k === "abierto" || k === "abierta") return "pendiente";
  if (k === "cerrado" || k === "cerrada" || k === "terminada" || k === "cumplido") return "terminado";
  if (k === "proceso") return "en_proceso";
  return (ESTADOS_MANTENIMIENTO as readonly string[]).includes(k) ? (k as EstadoMantenimiento) : null;
}

export function estado_cerrado(estado: unknown): boolean {
  const k = clave(estado);
  return k === "terminado" || k === "cerrado" || k === "cancelado";
}

export type Firmado = { firma: string; firmado_at: string; firmante: string };

/**
 * Firma única. `actual` es la guardada; `pedida` lo que trae el cambio.
 * - Sin firma nueva o la misma: sin cambio (`null`).
 * - Ya firmada y llega otra: 409.
 * - Firma nueva válida: devuelve el trazo.
 */
export function firma_unica(actual: unknown, pedida: unknown): string | null | ErrorRegla {
  const ya = String(actual ?? "").trim();
  const nueva = String(pedida ?? "").trim();
  if (!nueva || nueva === ya) return null;
  if (ya) return { error: "ya está firmada; la firma solo se pone una vez", status: 409 };
  if (!firma_es_trazo(nueva)) return { error: "la firma debe ser un trazo", status: 400 };
  return nueva;
}

export function es_error_regla(value: unknown): value is ErrorRegla {
  return !!value && typeof value === "object" && typeof (value as ErrorRegla).error === "string";
}

/**
 * Cambio de una reparación. `firmada` dice si ya tiene (o trae) la firma.
 * Al firmar una pendiente pasa sola a «autorizado». Trabajarla (en proceso,
 * terminado) o marcarla autorizada exige la firma; cancelar se puede siempre.
 */
export function siguiente_estado_reparacion(opts: {
  anterior: unknown;
  pedido: unknown;
  firmada: boolean;
  firma_nueva: boolean;
}): EstadoReparacion | ErrorRegla {
  const anterior = estado_reparacion(opts.anterior) ?? "pendiente";
  const pedido_crudo = opts.pedido;
  let siguiente: EstadoReparacion;
  if (pedido_crudo === undefined) {
    siguiente = anterior;
  } else {
    const leido = estado_reparacion(pedido_crudo);
    if (!leido) return { error: "estatus de reparación no válido", status: 400 };
    siguiente = leido;
  }
  if (opts.firma_nueva && siguiente === "pendiente") siguiente = "autorizado";
  // Lo ya guardado (p. ej. cerradas antes de existir la firma) no se revalida.
  if (siguiente === anterior && !opts.firma_nueva) return siguiente;
  if ((siguiente === "autorizado" || siguiente === "en_proceso" || siguiente === "terminado") && !opts.firmada) {
    return { error: "la reparación necesita autorización con firma antes de avanzar", status: 400 };
  }
  if (siguiente === "pendiente" && opts.firmada && anterior !== "pendiente") {
    return { error: "una reparación ya autorizada no vuelve a pendiente", status: 409 };
  }
  return siguiente;
}
