// Cálculo de flota, sin HTTP: revisión, vencimiento y siguiente servicio.

export type ResultadoRevision = "pasa" | "falla" | "na";

export type ItemRevision = {
  concepto: string;
  resultado: ResultadoRevision;
  nota?: string;
};

export type ErrorNorm = { error: string };

export type ClaseAviso = "vencido" | "por_vencer" | "al_dia" | "cumplido";

export type ServicioVista = {
  estado?: string | null;
  proxima_fecha?: string | null;
  intervalo_dias?: number | null;
  proxima_lectura?: number | null;
  intervalo_lectura?: number | null;
  aviso_dias?: number | null;
  aviso_lectura?: number | null;
  tipo_lectura?: string | null;
};

export type Aviso = {
  id: string;
  clase: "servicio" | "documento";
  vehicle_id: string;
  nombre: string;
  estado: "vencido" | "por_vencer";
  motivo: "fecha" | "lectura";
  proxima_fecha: string | null;
  proxima_lectura: number | null;
  lectura_actual: number | null;
};

const RESULTADOS = new Set<string>(["pasa", "falla", "na"]);

export function es_error(value: unknown): value is ErrorNorm {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as ErrorNorm).error === "string"
  );
}

/** Trazo guardado por el input de firma (data URL). Un nombre escrito no cuenta. */
export function firma_es_trazo(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const match = /^data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/=\s]+)$/i.exec(value.trim());
  if (!match) return false;
  return match[1].replace(/\s/g, "").length >= 16;
}

export function bitacora_revisada(firma_revisa: unknown): boolean {
  return firma_es_trazo(firma_revisa);
}

export function numero(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function fecha_iso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  if (!match) return null;
  const [year, month, day] = match[1].split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return match[1];
}

export function sumar_dias(iso: string, dias: number): string {
  const fecha = fecha_iso(iso);
  if (!fecha) throw new Error("fecha inválida");
  const [year, month, day] = fecha.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + Math.trunc(dias));
  return date.toISOString().slice(0, 10);
}

export function estado_abierto(value: unknown): "abierto" | "cerrado" {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "cerrado" || text === "cerrada") return "cerrado";
  return "abierto";
}

export function pide_cumplir(value: unknown): boolean {
  const text = String(value ?? "").trim().toLowerCase();
  return text === "cumplido" || text === "cerrado" || text === "cerrada";
}

export function normalizar_items(value: unknown): ItemRevision[] | ErrorNorm {
  if (value == null || value === "") return [];
  if (!Array.isArray(value)) return { error: "los ítems de revisión deben ser una lista" };
  const items: ItemRevision[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return { error: "ítem de revisión inválido" };
    const row = raw as Record<string, unknown>;
    const concepto = String(row.concepto ?? "").trim();
    const resultado = String(row.resultado ?? "").trim().toLowerCase();
    if (!concepto) return { error: "cada ítem necesita un concepto" };
    if (!RESULTADOS.has(resultado)) {
      return { error: "el resultado de cada ítem es pasa, falla o na" };
    }
    const item: ItemRevision = { concepto, resultado: resultado as ResultadoRevision };
    const nota = String(row.nota ?? "").trim();
    if (nota) item.nota = nota;
    items.push(item);
  }
  return items;
}

export function normalizar_plantilla(value: unknown): Array<{ concepto: string }> | ErrorNorm {
  if (value == null || value === "") return [];
  if (!Array.isArray(value)) return { error: "la plantilla debe ser una lista de conceptos" };
  const items: Array<{ concepto: string }> = [];
  for (const raw of value) {
    const concepto =
      typeof raw === "string"
        ? raw.trim()
        : raw && typeof raw === "object"
          ? String((raw as Record<string, unknown>).concepto ?? "").trim()
          : "";
    if (!concepto) return { error: "cada concepto de la plantilla necesita texto" };
    items.push({ concepto });
  }
  return items;
}

export function normalizar_imagenes(value: unknown): string[] | ErrorNorm {
  if (value == null || value === "") return [];
  const list = Array.isArray(value) ? value : [value];
  const images: string[] = [];
  for (const item of list) {
    if (typeof item !== "string" || !item.trim().startsWith("data:image/")) {
      return { error: "cada evidencia debe ser una imagen" };
    }
    images.push(item.trim());
  }
  return images;
}

export function servicio_vista(row: Record<string, unknown>): ServicioVista {
  return {
    estado: row.estado == null ? null : String(row.estado),
    proxima_fecha: row.proxima_fecha == null ? null : String(row.proxima_fecha),
    intervalo_dias: numero(row.intervalo_dias),
    proxima_lectura: numero(row.proxima_lectura),
    intervalo_lectura: numero(row.intervalo_lectura),
    aviso_dias: numero(row.aviso_dias),
    aviso_lectura: numero(row.aviso_lectura),
    tipo_lectura: row.tipo_lectura == null ? "" : String(row.tipo_lectura),
  };
}

export function validar_servicio(vista: ServicioVista): string | null {
  if (pide_cumplir(vista.estado) || vista.estado === "cumplido") return null;
  const tipo = String(vista.tipo_lectura ?? "");
  if (tipo && tipo !== "km" && tipo !== "horas") {
    return "el tipo de lectura es km u horas";
  }
  const fecha = fecha_iso(vista.proxima_fecha ?? null);
  const lectura = numero(vista.proxima_lectura);
  if (lectura != null && tipo !== "km" && tipo !== "horas") {
    return "la próxima lectura necesita indicar si es km u horas";
  }
  if (!fecha && lectura == null) {
    return "indica la próxima fecha o la próxima lectura";
  }
  return null;
}

const RANGO: Record<ClaseAviso, number> = {
  cumplido: 0,
  al_dia: 1,
  por_vencer: 2,
  vencido: 3,
};

export function clasificar_servicio(
  vista: ServicioVista,
  ctx: { hoy: string; lectura_km?: number | null; lectura_horas?: number | null },
): { estado: ClaseAviso; motivo: "fecha" | "lectura" | null } {
  if (vista.estado === "cumplido" || pide_cumplir(vista.estado)) {
    return { estado: "cumplido", motivo: null };
  }
  const hoy = fecha_iso(ctx.hoy) ?? ctx.hoy.slice(0, 10);
  let peor: ClaseAviso = "al_dia";
  let motivo: "fecha" | "lectura" | null = null;
  const fecha = fecha_iso(vista.proxima_fecha ?? null);
  if (fecha) {
    const aviso = Math.max(0, numero(vista.aviso_dias) ?? 7);
    let estado: ClaseAviso = "al_dia";
    if (fecha < hoy) estado = "vencido";
    else if (fecha <= sumar_dias(hoy, aviso)) estado = "por_vencer";
    if (RANGO[estado] > RANGO[peor]) {
      peor = estado;
      motivo = "fecha";
    }
  }
  const meta = numero(vista.proxima_lectura);
  const tipo = vista.tipo_lectura === "horas" ? "horas" : vista.tipo_lectura === "km" ? "km" : null;
  const actual = tipo === "horas" ? numero(ctx.lectura_horas) : tipo === "km" ? numero(ctx.lectura_km) : null;
  if (meta != null && actual != null) {
    const aviso = Math.max(0, numero(vista.aviso_lectura) ?? 0);
    let estado: ClaseAviso = "al_dia";
    if (actual >= meta) estado = "vencido";
    else if (aviso > 0 && actual >= meta - aviso) estado = "por_vencer";
    if (RANGO[estado] > RANGO[peor]) {
      peor = estado;
      motivo = "lectura";
    }
  }
  return { estado: peor, motivo };
}

export function cumplir_servicio(
  vista: ServicioVista,
  hecho: { fecha: string; lectura?: number | null },
): {
  estado: "programado" | "cumplido";
  proxima_fecha: string | null;
  proxima_lectura: number | null;
  ultima_fecha: string;
  ultima_lectura: number | null;
} {
  const fecha = fecha_iso(hecho.fecha);
  if (!fecha) throw new Error("fecha de cumplimiento inválida");
  const intervalo_dias = numero(vista.intervalo_dias) ?? 0;
  const intervalo_lectura = numero(vista.intervalo_lectura) ?? 0;
  const lectura = numero(hecho.lectura);
  const recurrente_fecha = intervalo_dias > 0;
  const recurrente_lectura = intervalo_lectura > 0 && lectura != null;
  if (!recurrente_fecha && !recurrente_lectura) {
    return {
      estado: "cumplido",
      proxima_fecha: null,
      proxima_lectura: null,
      ultima_fecha: fecha,
      ultima_lectura: lectura,
    };
  }
  return {
    estado: "programado",
    proxima_fecha: recurrente_fecha ? sumar_dias(fecha, intervalo_dias) : fecha_iso(vista.proxima_fecha ?? null),
    proxima_lectura: recurrente_lectura ? lectura! + intervalo_lectura : null,
    ultima_fecha: fecha,
    ultima_lectura: lectura,
  };
}

export function lectura_que_manda(
  rows: Array<{
    fecha?: unknown;
    valor?: unknown;
    updated_at?: unknown;
    is_active?: unknown;
  }>,
): { fecha: string; valor: number } | null {
  let best: { fecha: string; valor: number; updated: string } | null = null;
  for (const row of rows) {
    if (row.is_active === false) continue;
    const fecha = fecha_iso(row.fecha);
    const valor = numero(row.valor);
    if (!fecha || valor == null) continue;
    const updated = String(row.updated_at ?? "");
    if (!best || fecha > best.fecha || (fecha === best.fecha && updated >= best.updated)) {
      best = { fecha, valor, updated };
    }
  }
  return best ? { fecha: best.fecha, valor: best.valor } : null;
}

/** La que manda es la de fecha más nueva. Una anterior no pisa el odómetro que ya está cargado. */
export function odometro_tras_lecturas(input: {
  hoy: string;
  actual: number | null;
  lecturas: Array<{
    fecha?: unknown;
    valor?: unknown;
    updated_at?: unknown;
    is_active?: unknown;
  }>;
}): number | null {
  const manda = lectura_que_manda(input.lecturas);
  if (!manda) return input.actual;
  const hoy = fecha_iso(input.hoy) ?? input.hoy.slice(0, 10);
  if (manda.fecha >= hoy || input.actual == null) return manda.valor;
  const actual_es_mas_vieja = input.lecturas.some((row) => {
    if (row.is_active === false) return false;
    const fecha = fecha_iso(row.fecha);
    return fecha != null && fecha < manda.fecha && numero(row.valor) === input.actual;
  });
  return actual_es_mas_vieja ? manda.valor : input.actual;
}

type Fila = Record<string, unknown>;

function aviso_de(
  row: Fila,
  clase: Aviso["clase"],
  estado: "vencido" | "por_vencer",
  motivo: "fecha" | "lectura",
  lectura_actual: number | null,
  proxima_fecha: unknown,
): Aviso {
  return {
    id: String(row.id ?? ""),
    clase,
    vehicle_id: String(row.vehicle_id ?? ""),
    nombre: String(row.name ?? ""),
    estado,
    motivo,
    proxima_fecha: fecha_iso(proxima_fecha) ,
    proxima_lectura: numero(row.proxima_lectura),
    lectura_actual,
  };
}

export function armar_recordatorios(input: {
  hoy: string;
  servicios: Fila[];
  documentos: Fila[];
  lecturas: Record<string, { km: number | null; horas: number | null }>;
}): { data: Aviso[]; vencidos: Aviso[]; por_vencer: Aviso[] } {
  const vencidos: Aviso[] = [];
  const por_vencer: Aviso[] = [];
  const meter = (id: string) => input.lecturas[id] ?? { km: null, horas: null };

  for (const row of input.servicios) {
    if (row.is_active === false) continue;
    const uso = meter(String(row.vehicle_id ?? ""));
    const clase = clasificar_servicio(servicio_vista(row), {
      hoy: input.hoy,
      lectura_km: uso.km,
      lectura_horas: uso.horas,
    });
    if (clase.estado !== "vencido" && clase.estado !== "por_vencer") continue;
    const aviso = aviso_de(
      row,
      "servicio",
      clase.estado,
      clase.motivo ?? "fecha",
      clase.motivo === "lectura"
        ? row.tipo_lectura === "horas"
          ? uso.horas
          : uso.km
        : null,
      row.proxima_fecha,
    );
    (clase.estado === "vencido" ? vencidos : por_vencer).push(aviso);
  }

  for (const row of input.documentos) {
    if (row.is_active === false) continue;
    const clase = clasificar_servicio(
      {
        estado: estado_abierto(row.estado) === "cerrado" ? "cumplido" : "programado",
        proxima_fecha: row.fecha_vencimiento == null ? null : String(row.fecha_vencimiento),
        aviso_dias: numero(row.aviso_dias) ?? 30,
      },
      { hoy: input.hoy },
    );
    if (clase.estado !== "vencido" && clase.estado !== "por_vencer") continue;
    const aviso = aviso_de(
      row,
      "documento",
      clase.estado,
      "fecha",
      null,
      row.fecha_vencimiento,
    );
    (clase.estado === "vencido" ? vencidos : por_vencer).push(aviso);
  }

  return { data: [...vencidos, ...por_vencer], vencidos, por_vencer };
}
