/**
 * Estatus de flota para el pipeline status-option-control del núcleo.
 * Payload de `POST /api/status-option-control/seed-defaults` con
 * `{ entries: STATUS_OPTION_SEEDS }` (acción `seed_defaults`): solo agrega
 * los faltantes, no reescribe lo que el usuario ya editó.
 * Contrato: kit `descriptors/option-lists.ts` (STATUS_OPTION_SEED_PATH).
 */
export const STATUS_OPTION_SEED_PATH = "/api/status-option-control/seed-defaults";

export type StatusOption = { value: string; label: string; color: string; icon?: string };

export type StatusOptionSeed = {
  model_id: string;
  module_name?: string;
  status_fields?: string[];
  options: Array<StatusOption & { field_name: string }>;
};

function seed(model_id: string, field_name: string, options: StatusOption[]): StatusOptionSeed {
  return {
    model_id,
    module_name: model_id,
    status_fields: [field_name],
    options: options.map((o) => ({ ...o, field_name })),
  };
}

/** Alineado a imperium-core state-fields.ts `vehicle.estado_operativo`. */
export const ESTADO_OPERATIVO_OPTIONS: StatusOption[] = [
  { value: "disponible", label: "Disponible", color: "#198754", icon: "fas fa-check" },
  { value: "asignado", label: "Asignado", color: "#0d6efd", icon: "fas fa-user" },
  { value: "mantenimiento", label: "Mantenimiento", color: "#ffc107", icon: "fas fa-wrench" },
  { value: "inactivo", label: "Inactivo", color: "#dc3545", icon: "fas fa-ban" },
];

export const ESTADO_ABIERTO_CERRADO_OPTIONS: StatusOption[] = [
  { value: "abierto", label: "Abierto", color: "#ffc107", icon: "fas fa-folder-open" },
  { value: "cerrado", label: "Cerrado", color: "#198754", icon: "fas fa-check-circle" },
];

export const SERVICIO_ESTADO_OPTIONS: StatusOption[] = [
  { value: "programado", label: "Programado", color: "#0d6efd", icon: "fas fa-calendar" },
  { value: "cumplido", label: "Cumplido", color: "#198754", icon: "fas fa-check-double" },
];

export const ENVIO_REVISION_ESTADO_OPTIONS: StatusOption[] = [
  { value: "pendiente", label: "Pendiente", color: "#ffc107", icon: "fas fa-hourglass-half" },
  { value: "firmado", label: "Firmado", color: "#198754", icon: "fas fa-signature" },
];

export const STATUS_OPTION_SEEDS: StatusOptionSeed[] = [
  seed("subject-vehiculos/vehicle", "estado_operativo", ESTADO_OPERATIVO_OPTIONS),
  seed("subject-vehiculos/servicio-programado", "estado", SERVICIO_ESTADO_OPTIONS),
  seed("subject-vehiculos/documento-vehiculo", "estado", ESTADO_ABIERTO_CERRADO_OPTIONS),
  seed("subject-vehiculos/falla", "estado", ESTADO_ABIERTO_CERRADO_OPTIONS),
  seed("subject-vehiculos/mantenimiento-correctivo", "estado", ESTADO_ABIERTO_CERRADO_OPTIONS),
  seed("subject-vehiculos/mantenimiento-preventivo", "estado", ESTADO_ABIERTO_CERRADO_OPTIONS),
  seed("subject-vehiculos/envio-revision", "estado", ENVIO_REVISION_ESTADO_OPTIONS),
];

export type PushStatusSeedsOptions = {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  timeout_ms?: number;
};

export type PushStatusSeedsResult =
  | { pushed: true; status: number; data: unknown }
  | { pushed: false; reason: string; status?: number };

/**
 * Manda `STATUS_OPTION_SEEDS` al núcleo (`seed_defaults`, idempotente).
 * Nunca lanza: el seed de la flota no debe caerse si el núcleo aún no
 * expone o no autoriza la ruta.
 */
export async function push_status_seeds(opts: PushStatusSeedsOptions = {}): Promise<PushStatusSeedsResult> {
  const env = opts.env ?? process.env;
  const base = (env.CORE_DATA_URL?.trim() || env.NOX_DATA_URL?.trim() || "")
    .replace(/\/api\/kirlets\/data\/.*$/, "")
    .replace(/\/+$/, "");
  const caller = env.SUBJECT_TECHNICAL_ID?.trim() || env.KIRLET_TECHNICAL_ID?.trim() || "";
  const secret = env.CORE_SUBJECT_GATEWAY_SECRET?.trim() || env.NOX_KIRLET_GATEWAY_SECRET?.trim() || "";
  if (!base || !caller || !secret) return { pushed: false, reason: "core_not_configured" };
  try {
    const res = await (opts.fetchImpl ?? fetch)(`${base}${STATUS_OPTION_SEED_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-core-subject-gateway-secret": secret,
        "x-imperium-subject": caller,
      },
      body: JSON.stringify({ entries: STATUS_OPTION_SEEDS }),
      signal: AbortSignal.timeout(opts.timeout_ms ?? 12_000),
    });
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      /* sin JSON */
    }
    if (!res.ok) return { pushed: false, reason: "core_refused", status: res.status };
    return { pushed: true, status: res.status, data };
  } catch (err) {
    return { pushed: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
