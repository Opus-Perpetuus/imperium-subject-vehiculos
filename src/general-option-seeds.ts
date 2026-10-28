/**
 * Listas no-estatus de flota para general-option-list-control del núcleo.
 * Payload de `POST /api/general-option-list-control/seed-defaults` con
 * `{ entries: GENERAL_OPTION_LIST_SEEDS }` (acción `seed_defaults`): solo
 * agrega faltantes. Contrato: kit `descriptors/option-lists.ts`.
 */
import { TIPOS_COMBUSTIBLE } from "./combustible.ts";

export const GENERAL_OPTION_LIST_SEED_PATH = "/api/general-option-list-control/seed-defaults";

export type OptionSeedItem = {
  value: string;
  label: string;
  description?: string;
  color?: string;
  icon?: string;
};

export type GeneralOptionListSeed = {
  model_id: string;
  module_name?: string;
  lists: Array<{
    list_key: string;
    label?: string;
    field_name?: string;
    options: OptionSeedItem[];
  }>;
};

/** `optionsSource` de un campo que no es estatus. `as=options` → `{ value, label }[]`. */
export function general_option_list_options_source(model_id: string, list_key: string): string {
  const query = new URLSearchParams({
    model_id,
    list_key,
    as: "options",
  });
  return `api://general-option-list-control/options?${query.toString()}`;
}

function list(
  model_id: string,
  list_key: string,
  label: string,
  options: OptionSeedItem[],
): GeneralOptionListSeed {
  return {
    model_id,
    module_name: model_id,
    lists: [{ list_key, label, field_name: list_key, options }],
  };
}

export const TIPO_UNIDAD_OPTIONS: OptionSeedItem[] = [
  { value: "pickup", label: "Pickup" },
  { value: "van", label: "Van" },
  { value: "camion", label: "Camión" },
  { value: "motocicleta", label: "Motocicleta" },
  { value: "otro", label: "Otro" },
];

export const TIPO_COMBUSTIBLE_OPTIONS: OptionSeedItem[] = TIPOS_COMBUSTIBLE.map((t) => ({
  value: t.value,
  label: t.label,
}));

export const DOCUMENTO_TIPO_OPTIONS: OptionSeedItem[] = [
  { value: "seguro", label: "Seguro" },
  { value: "tarjeta", label: "Tarjeta de circulación" },
  { value: "verificacion", label: "Verificación" },
  { value: "licencia", label: "Licencia" },
  { value: "otro", label: "Otro" },
];

export const ENVIO_MODO_OPTIONS: OptionSeedItem[] = [
  { value: "interno", label: "Interna (usuario Imperium)" },
  { value: "publico", label: "Pública (enlace para firmar)" },
];

export const FALLA_PRIORIDAD_OPTIONS: OptionSeedItem[] = [
  { value: "baja", label: "Baja" },
  { value: "media", label: "Media" },
  { value: "alta", label: "Alta" },
];

export const GENERAL_OPTION_LIST_SEEDS: GeneralOptionListSeed[] = [
  list("subject-vehiculos/vehicle", "tipo_unidad", "Tipo de unidad", TIPO_UNIDAD_OPTIONS),
  list("subject-vehiculos/vehicle", "tipo_combustible", "Combustible", TIPO_COMBUSTIBLE_OPTIONS),
  list("subject-vehiculos/carga-combustible", "tipo_combustible", "Combustible", TIPO_COMBUSTIBLE_OPTIONS),
  list("subject-vehiculos/documento-vehiculo", "tipo", "Tipo de documento", DOCUMENTO_TIPO_OPTIONS),
  list("subject-vehiculos/envio-revision", "modo", "Modo de envío", ENVIO_MODO_OPTIONS),
  list("subject-vehiculos/falla", "prioridad", "Prioridad", FALLA_PRIORIDAD_OPTIONS),
];

export type PushGeneralOptionSeedsOptions = {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  timeout_ms?: number;
};

export type PushGeneralOptionSeedsResult =
  | { pushed: true; status: number; data: unknown }
  | { pushed: false; reason: string; status?: number };

/**
 * Manda `GENERAL_OPTION_LIST_SEEDS` al núcleo (`seed_defaults`, idempotente).
 * Nunca lanza: el seed de la flota no debe caerse si el núcleo aún no
 * expone o no autoriza la ruta.
 */
export async function push_general_option_seeds(
  opts: PushGeneralOptionSeedsOptions = {},
): Promise<PushGeneralOptionSeedsResult> {
  const env = opts.env ?? process.env;
  const base = (env.CORE_DATA_URL?.trim() || env.NOX_DATA_URL?.trim() || "")
    .replace(/\/api\/kirlets\/data\/.*$/, "")
    .replace(/\/+$/, "");
  const caller = env.SUBJECT_TECHNICAL_ID?.trim() || env.KIRLET_TECHNICAL_ID?.trim() || "";
  const secret = env.CORE_SUBJECT_GATEWAY_SECRET?.trim() || env.NOX_KIRLET_GATEWAY_SECRET?.trim() || "";
  if (!base || !caller || !secret) return { pushed: false, reason: "core_not_configured" };
  try {
    const res = await (opts.fetchImpl ?? fetch)(`${base}${GENERAL_OPTION_LIST_SEED_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-core-subject-gateway-secret": secret,
        "x-imperium-subject": caller,
      },
      body: JSON.stringify({ entries: GENERAL_OPTION_LIST_SEEDS }),
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
