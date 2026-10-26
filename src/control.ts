// Cálculo de flota, sin HTTP: revisión, vencimiento y siguiente servicio.

export type OpcionPartida = {
  value: string;
  label: string;
  /** Si la opción elegida es de alarma, la partida sube al firmar. */
  alarma?: boolean;
};

export const OPCIONES_REVISION: OpcionPartida[] = [
  { value: "pasa", label: "Pasa" },
  { value: "falla", label: "Falla" },
  { value: "na", label: "No aplica" },
];

export const DEFECTO_REVISION = "na";

export type PartidaPlantilla = {
  concepto: string;
  opciones: OpcionPartida[];
  opcion_defecto: string;
};

export type PartidaRevision = PartidaPlantilla & {
  resultado: string;
  nota?: string;
  /** Alarma manual al generar/editar la revisión, independiente de la opción. */
  alarma_forzada?: boolean;
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
  /** Días hasta la fecha; negativos si ya pasó. `null` si no hay fecha. */
  dias_restantes: number | null;
  /** Km u horas que faltan para la meta; negativos si ya se pasó. */
  faltan_lectura: number | null;
  estado_texto: string;
  clase_texto: string;
  motivo_texto: string;
};

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

function clonar_opciones(opciones: readonly OpcionPartida[]): OpcionPartida[] {
  return opciones.map((opcion) => {
    const copia: OpcionPartida = { value: opcion.value, label: opcion.label };
    if (opcion.alarma) copia.alarma = true;
    return copia;
  });
}

function encajar_opcion(valor: string, opciones: readonly OpcionPartida[]): string | null {
  if (opciones.some((opcion) => opcion.value === valor)) return valor;
  const minusculas = valor.toLowerCase();
  if (opciones.some((opcion) => opcion.value === minusculas)) return minusculas;
  return null;
}

function leer_opciones(
  row: Record<string, unknown>,
): { opciones: OpcionPartida[]; opcion_defecto: string } | ErrorNorm {
  let opciones: OpcionPartida[];
  if (!("opciones" in row) || row.opciones == null) {
    opciones = clonar_opciones(OPCIONES_REVISION);
  } else if (!Array.isArray(row.opciones) || row.opciones.length === 0) {
    return { error: "cada partida necesita al menos una opción" };
  } else {
    opciones = [];
    const vistos = new Set<string>();
    for (const cruda of row.opciones) {
      if (!cruda || typeof cruda !== "object") return { error: "opción de partida inválida" };
      const opcion = cruda as Record<string, unknown>;
      const value = String(opcion.value ?? "").trim();
      const label = String(opcion.label ?? "").trim();
      if (!value || !label) return { error: "cada opción necesita valor y etiqueta" };
      if (vistos.has(value)) return { error: "las opciones de una partida no se repiten" };
      vistos.add(value);
      const entrada: OpcionPartida = { value, label };
      if (opcion.alarma === true || opcion.alarma === "true" || opcion.alarma === 1) {
        entrada.alarma = true;
      }
      opciones.push(entrada);
    }
  }
  const pedido = String(row.opcion_defecto ?? "").trim();
  const opcion_defecto = pedido
    ? encajar_opcion(pedido, opciones)
    : opciones.some((opcion) => opcion.value === DEFECTO_REVISION)
      ? DEFECTO_REVISION
      : opciones[0].value;
  if (!opcion_defecto) return { error: "la opción por defecto no está entre las opciones de la partida" };
  return { opciones, opcion_defecto };
}

export function normalizar_items(value: unknown): PartidaRevision[] | ErrorNorm {
  if (value == null || value === "") return [];
  if (!Array.isArray(value)) return { error: "los ítems de revisión deben ser una lista" };
  const items: PartidaRevision[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return { error: "ítem de revisión inválido" };
    const row = raw as Record<string, unknown>;
    const concepto = String(row.concepto ?? "").trim();
    if (!concepto) return { error: "cada ítem necesita un concepto" };
    const leidas = leer_opciones(row);
    if (es_error(leidas)) return leidas;
    const pedido = String(row.resultado ?? "").trim();
    const resultado = encajar_opcion(pedido || leidas.opcion_defecto, leidas.opciones);
    if (!resultado) return { error: "el resultado no está entre las opciones de la partida" };
    const item: PartidaRevision = {
      concepto,
      opciones: leidas.opciones,
      opcion_defecto: leidas.opcion_defecto,
      resultado,
    };
    const nota = String(row.nota ?? "").trim();
    if (nota) item.nota = nota;
    if (row.alarma_forzada === true || row.alarma_forzada === "true" || row.alarma_forzada === 1) {
      item.alarma_forzada = true;
    }
    items.push(item);
  }
  return items;
}

/** Tope de un cuerpo viejo que todavía manda ranuras `concepto_N`. `items` no se corta. */
export const RANURAS_REVISION = 30;

export function clave_concepto(indice: number): string {
  return `concepto_${indice}`;
}

export function clave_resultado(indice: number): string {
  return `resultado_${indice}`;
}

export function texto_de_conceptos(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") {
        return String((item as Record<string, unknown>).concepto ?? "").trim();
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

/** Nombre que se reconoce en un selector o en una lista: título y placas si hay. */
export function etiqueta_vehiculo(row: {
  name?: unknown;
  placas?: unknown;
  numero_economico?: unknown;
}): string {
  const nombre = String(row.name ?? "").trim();
  const placas = String(row.placas ?? "").trim();
  const economico = String(row.numero_economico ?? "").trim();
  if (nombre && placas) return `${nombre} · ${placas}`;
  if (placas && economico) return `${placas} · ${economico}`;
  return nombre || placas || economico || "Vehículo";
}

/**
 * Renglones que la persona llenó en el formulario. `null` si no mandó
 * ninguno: no se borra lo que ya estaba (la plantilla, por ejemplo).
 */
export function filas_desde_ranuras(
  row: Record<string, unknown>,
  previos?: unknown,
): PartidaRevision[] | null {
  const anteriores = Array.isArray(previos) ? previos : [];
  let vio = false;
  const items: PartidaRevision[] = [];
  for (let indice = 1; indice <= RANURAS_REVISION; indice++) {
    const concepto_key = clave_concepto(indice);
    const resultado_key = clave_resultado(indice);
    const nota_key = `nota_${indice}`;
    if (concepto_key in row || resultado_key in row || nota_key in row) vio = true;
    const concepto = String(row[concepto_key] ?? "").trim();
    if (!concepto) continue;
    const crudo = String(row[resultado_key] ?? "").trim();
    const resultado = encajar_opcion(crudo, OPCIONES_REVISION) ?? DEFECTO_REVISION;
    const item: PartidaRevision = {
      concepto,
      opciones: clonar_opciones(OPCIONES_REVISION),
      opcion_defecto: DEFECTO_REVISION,
      resultado,
    };
    const anterior = anteriores[indice - 1];
    const nota_previa =
      anterior && typeof anterior === "object"
        ? String((anterior as Record<string, unknown>).nota ?? "").trim()
        : "";
    const nota = nota_key in row ? String(row[nota_key] ?? "").trim() : nota_previa;
    if (nota) item.nota = nota;
    items.push(item);
  }
  if (!vio || items.length === 0) return null;
  return items;
}

export function quitar_ranuras(row: Record<string, unknown>): void {
  for (let indice = 1; indice <= RANURAS_REVISION; indice++) {
    delete row[clave_concepto(indice)];
    delete row[clave_resultado(indice)];
    delete row[`nota_${indice}`];
  }
}

export function normalizar_plantilla(value: unknown): PartidaPlantilla[] | ErrorNorm {
  if (value == null || value === "") return [];
  if (typeof value === "string") {
    const lineas = value
      .split(/\r?\n/)
      .map((linea) => linea.trim())
      .filter(Boolean);
    return normalizar_plantilla(lineas);
  }
  if (!Array.isArray(value)) return { error: "la plantilla debe ser una lista de conceptos" };
  const items: PartidaPlantilla[] = [];
  for (const raw of value) {
    if (typeof raw === "string") {
      const concepto = raw.trim();
      if (!concepto) return { error: "cada concepto de la plantilla necesita texto" };
      items.push({
        concepto,
        opciones: clonar_opciones(OPCIONES_REVISION),
        opcion_defecto: DEFECTO_REVISION,
      });
      continue;
    }
    if (!raw || typeof raw !== "object") return { error: "cada concepto de la plantilla necesita texto" };
    const row = raw as Record<string, unknown>;
    const concepto = String(row.concepto ?? "").trim();
    if (!concepto) return { error: "cada concepto de la plantilla necesita texto" };
    const leidas = leer_opciones(row);
    if (es_error(leidas)) return leidas;
    items.push({ concepto, opciones: leidas.opciones, opcion_defecto: leidas.opcion_defecto });
  }
  return items;
}

export function bitacora_desde_plantilla(value: unknown): PartidaRevision[] | ErrorNorm {
  const plantilla = normalizar_plantilla(value);
  if (es_error(plantilla)) return plantilla;
  return plantilla.map((partida) => ({ ...partida, resultado: partida.opcion_defecto }));
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
  const previa = fecha_iso(vista.proxima_fecha ?? null);
  return {
    estado: "programado",
    proxima_fecha: recurrente_fecha ? sumar_dias(fecha, intervalo_dias) : previa && previa > fecha ? previa : null,
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

export type EventoOdometro =
  | { accion: "alta" }
  | { accion: "edicion"; valor_anterior: number | null }
  | { accion: "baja"; valor_anterior: number | null };

/**
 * Alta: la de fecha más nueva manda si no hay odómetro, si es de hoy o
 * posterior, o si sube la lectura. Una fecha anterior no baja un odómetro
 * que esa lectura no era.
 * Edición o baja de la lectura que estaba en el odómetro: se recomputa la
 * de mayor fecha, aunque el valor baje.
 */
export function odometro_tras_lecturas(input: {
  hoy: string;
  actual: number | null;
  lecturas: Array<{
    fecha?: unknown;
    valor?: unknown;
    updated_at?: unknown;
    is_active?: unknown;
  }>;
  evento: EventoOdometro;
}): number | null {
  const manda = lectura_que_manda(input.lecturas);
  if (!manda) return input.actual;
  const hoy = fecha_iso(input.hoy) ?? input.hoy.slice(0, 10);
  if (input.evento.accion === "edicion" || input.evento.accion === "baja") {
    if (input.actual == null || input.actual === input.evento.valor_anterior) return manda.valor;
    return input.actual;
  }
  if (input.actual == null || manda.fecha >= hoy || manda.valor > input.actual) return manda.valor;
  return input.actual;
}

type Fila = Record<string, unknown>;

export function dias_entre(desde: string, hasta: string): number {
  const a = Date.parse(`${desde.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${hasta.slice(0, 10)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`;
}

function texto_motivo(aviso: Pick<Aviso, "motivo" | "dias_restantes" | "faltan_lectura">, unidad: string): string {
  if (aviso.motivo === "lectura" && aviso.faltan_lectura != null) {
    const n = Math.abs(Math.round(aviso.faltan_lectura));
    return aviso.faltan_lectura <= 0 ? `Se pasó por ${n} ${unidad}` : `Faltan ${n} ${unidad}`;
  }
  const dias = aviso.dias_restantes;
  if (dias == null) return "Por fecha";
  if (dias < 0) return `Venció hace ${plural(-dias, "día", "días")}`;
  if (dias === 0) return "Vence hoy";
  return `Vence en ${plural(dias, "día", "días")}`;
}

function aviso_de(
  row: Fila,
  clase: Aviso["clase"],
  estado: "vencido" | "por_vencer",
  motivo: "fecha" | "lectura",
  lectura_actual: number | null,
  proxima_fecha: unknown,
  hoy: string,
): Aviso {
  const fecha = fecha_iso(proxima_fecha);
  const meta = numero(row.proxima_lectura);
  const base = {
    id: String(row.id ?? ""),
    clase,
    vehicle_id: String(row.vehicle_id ?? ""),
    nombre: String(row.name ?? ""),
    estado,
    motivo,
    proxima_fecha: fecha,
    proxima_lectura: meta,
    lectura_actual,
    dias_restantes: fecha ? dias_entre(hoy, fecha) : null,
    faltan_lectura: meta != null && lectura_actual != null ? meta - lectura_actual : null,
  };
  return {
    ...base,
    estado_texto: estado === "vencido" ? "Vencido" : "Por vencer",
    clase_texto: clase === "servicio" ? "Servicio" : "Documento",
    motivo_texto: texto_motivo(base, row.tipo_lectura === "horas" ? "horas" : "km"),
  };
}

/** Lo más atrasado primero: por días (o lectura) y luego por nombre. */
function por_urgencia(a: Aviso, b: Aviso): number {
  const peso = (aviso: Aviso) =>
    aviso.motivo === "lectura" ? Math.sign(aviso.faltan_lectura ?? 0) : (aviso.dias_restantes ?? 0);
  return peso(a) - peso(b) || a.nombre.localeCompare(b.nombre, "es");
}

export function armar_recordatorios(input: {
  hoy: string;
  servicios: Fila[];
  documentos: Fila[];
  lecturas: Record<string, { km: number | null; horas: number | null }>;
  /** Vehículos dados de baja: sus pendientes ya no avisan. */
  inactivos?: ReadonlySet<string>;
}): { data: Aviso[]; vencidos: Aviso[]; por_vencer: Aviso[] } {
  const hoy = fecha_iso(input.hoy) ?? input.hoy.slice(0, 10);
  const de_baja = (row: Fila) => input.inactivos?.has(String(row.vehicle_id ?? "")) ?? false;
  const vencidos: Aviso[] = [];
  const por_vencer: Aviso[] = [];
  const meter = (id: string) => input.lecturas[id] ?? { km: null, horas: null };

  for (const row of input.servicios) {
    if (row.is_active === false || de_baja(row)) continue;
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
      hoy,
    );
    (clase.estado === "vencido" ? vencidos : por_vencer).push(aviso);
  }

  for (const row of input.documentos) {
    if (row.is_active === false || de_baja(row)) continue;
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
      hoy,
    );
    (clase.estado === "vencido" ? vencidos : por_vencer).push(aviso);
  }

  vencidos.sort(por_urgencia);
  por_vencer.sort(por_urgencia);
  return { data: [...vencidos, ...por_vencer], vencidos, por_vencer };
}

export const ERROR_PARTIDAS_DE_PLANTILLA =
  "las partidas de esta bitácora las define su plantilla; solo se llenan resultado y nota";

function mismas_opciones(a: readonly OpcionPartida[], b: readonly OpcionPartida[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (opcion, i) =>
        opcion.value === b[i].value &&
        opcion.label === b[i].label &&
        !!opcion.alarma === !!b[i].alarma,
    )
  );
}

/**
 * Llena las partidas ya definidas con lo que mandó la persona. Solo toma
 * `resultado` y `nota`; si trae otro concepto, otras opciones u otra opción
 * por defecto, o agrega o quita partidas, se rechaza.
 */
export function llenar_partidas(
  definidas: readonly PartidaRevision[],
  enviadas: unknown,
): PartidaRevision[] | ErrorNorm {
  if (enviadas == null || enviadas === "") return definidas.map((partida) => ({ ...partida }));
  if (!Array.isArray(enviadas)) return { error: "los ítems de revisión deben ser una lista" };
  if (enviadas.length !== definidas.length) return { error: ERROR_PARTIDAS_DE_PLANTILLA };
  const items: PartidaRevision[] = [];
  for (let i = 0; i < definidas.length; i++) {
    const base = definidas[i];
    const raw = enviadas[i];
    if (!raw || typeof raw !== "object") return { error: "ítem de revisión inválido" };
    const row = raw as Record<string, unknown>;
    const concepto = String(row.concepto ?? "").trim();
    if (concepto && concepto !== base.concepto) return { error: ERROR_PARTIDAS_DE_PLANTILLA };
    if ("opciones" in row && row.opciones != null) {
      const leidas = leer_opciones({ opciones: row.opciones });
      if (es_error(leidas)) return leidas;
      if (!mismas_opciones(leidas.opciones, base.opciones)) return { error: ERROR_PARTIDAS_DE_PLANTILLA };
    }
    const defecto = String(row.opcion_defecto ?? "").trim();
    if (defecto && defecto !== base.opcion_defecto) return { error: ERROR_PARTIDAS_DE_PLANTILLA };
    const pedido = String(row.resultado ?? "").trim();
    const resultado = pedido ? encajar_opcion(pedido, base.opciones) : base.resultado;
    if (!resultado) return { error: "el resultado no está entre las opciones de la partida" };
    const item: PartidaRevision = {
      concepto: base.concepto,
      opciones: clonar_opciones(base.opciones),
      opcion_defecto: base.opcion_defecto,
      resultado,
    };
    const nota = "nota" in row ? String(row.nota ?? "").trim() : String(base.nota ?? "").trim();
    if (nota) item.nota = nota;
    const forzada =
      "alarma_forzada" in row
        ? row.alarma_forzada === true || row.alarma_forzada === "true" || row.alarma_forzada === 1
        : !!base.alarma_forzada;
    if (forzada) item.alarma_forzada = true;
    items.push(item);
  }
  return items;
}

/** La partida está en alarma si se forzó o si el resultado es una opción marcada. */
export function partida_en_alarma(partida: PartidaRevision): boolean {
  if (partida.alarma_forzada) return true;
  return partida.opciones.some((opcion) => opcion.value === partida.resultado && !!opcion.alarma);
}

/** Alarmas primero; el resto conserva el orden relativo. */
/** Slug cosmético del detalle SIC (`detail/<slug>/<id>`). */
export function slug_ruta(name: unknown): string {
  const normalized = String(name ?? "")
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "no-name";
}

/** Ruta interna del detalle de un envío (para Compartir). */
export function ruta_detalle_envio(id: unknown, name: unknown = ""): string {
  return `/internal/envio-revision/detail/${slug_ruta(name)}/${String(id ?? "").trim()}`;
}

export function ordenar_partidas_alarma(
  partidas: readonly PartidaRevision[],
): PartidaRevision[] {
  const alarmas: PartidaRevision[] = [];
  const resto: PartidaRevision[] = [];
  for (const partida of partidas) {
    (partida_en_alarma(partida) ? alarmas : resto).push({ ...partida, opciones: clonar_opciones(partida.opciones) });
  }
  return [...alarmas, ...resto];
}

/**
 * Conceptos de partidas con resultado «falla» que aún no tienen una falla
 * abierta de la misma bitácora. Sin repetir conceptos.
 */
export function partidas_sin_reporte(
  items: ReadonlyArray<Record<string, unknown>>,
  fallas: ReadonlyArray<Record<string, unknown>>,
): string[] {
  const clave = (value: unknown) => String(value ?? "").trim().toLowerCase();
  const reportadas = new Set(
    fallas
      .filter((falla) => falla.is_active !== false && estado_abierto(falla.estado) === "abierto")
      .map((falla) => clave(falla.concepto)),
  );
  const pendientes: string[] = [];
  for (const item of items) {
    if (item.resultado !== "falla") continue;
    const concepto = String(item.concepto ?? "").trim();
    if (!concepto || reportadas.has(clave(concepto))) continue;
    reportadas.add(clave(concepto));
    pendientes.push(concepto);
  }
  return pendientes;
}

/** Tope de visitas guardadas por envío (las más recientes). */
export const MAX_VISITAS_ENVIO = 100;

export type VisitaEnvio = {
  visitado_en: string;
  agente: string;
  dispositivo: string;
  sistema: string;
  origen: string;
  referrer: string;
};

/** Infiere dispositivo y SO a partir del User-Agent (heurística corta). */
export function inferir_cliente(user_agent: string): {
  dispositivo: string;
  sistema: string;
} {
  const ua = user_agent.trim();
  if (!ua) return { dispositivo: "desconocido", sistema: "desconocido" };
  const lower = ua.toLowerCase();
  let sistema = "desconocido";
  if (/android/i.test(ua)) sistema = "Android";
  else if (/iphone|ipad|ipod/i.test(ua)) sistema = "iOS";
  else if (/windows nt/i.test(ua)) sistema = "Windows";
  else if (/mac os x|macintosh/i.test(ua)) sistema = "macOS";
  else if (/linux/i.test(ua)) sistema = "Linux";
  else if (/cros/i.test(ua)) sistema = "ChromeOS";

  let dispositivo = "escritorio";
  if (/ipad|tablet|kindle|silk/i.test(ua) || (sistema === "Android" && !/mobile/i.test(ua))) {
    dispositivo = "tableta";
  } else if (/mobi|iphone|ipod|android.*mobile|windows phone/i.test(lower)) {
    dispositivo = "móvil";
  } else if (/bot|crawl|spider|preview|slurp/i.test(lower)) {
    dispositivo = "bot";
  }
  return { dispositivo, sistema };
}

export function visita_desde_headers(headers: Headers, ahora = ""): VisitaEnvio {
  const agente = String(headers.get("user-agent") ?? "").trim();
  const origen = String(headers.get("origin") ?? "").trim();
  const referrer = String(headers.get("referer") ?? headers.get("referrer") ?? "").trim();
  const { dispositivo, sistema } = inferir_cliente(agente);
  return {
    visitado_en: ahora || new Date().toISOString(),
    agente: agente.slice(0, 512),
    dispositivo,
    sistema,
    origen: origen.slice(0, 512),
    referrer: referrer.slice(0, 512),
  };
}

export function normalizar_visitas(value: unknown): VisitaEnvio[] {
  if (!Array.isArray(value)) return [];
  const out: VisitaEnvio[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const visitado_en = String(r.visitado_en ?? r.at ?? "").trim();
    if (!visitado_en) continue;
    out.push({
      visitado_en,
      agente: String(r.agente ?? r.user_agent ?? "").trim().slice(0, 512),
      dispositivo: String(r.dispositivo ?? r.device ?? "desconocido").trim() || "desconocido",
      sistema: String(r.sistema ?? r.os ?? "desconocido").trim() || "desconocido",
      origen: String(r.origen ?? r.origin ?? "").trim().slice(0, 512),
      referrer: String(r.referrer ?? r.desde ?? "").trim().slice(0, 512),
    });
  }
  return out;
}

/** Agrega una visita y conserva solo las más recientes. */
export function anexar_visita(
  previas: unknown,
  visita: VisitaEnvio,
  max = MAX_VISITAS_ENVIO,
): VisitaEnvio[] {
  const lista = [...normalizar_visitas(previas), visita];
  return lista.length > max ? lista.slice(lista.length - max) : lista;
}

/** Resumen compacto para el detalle autenticado. */
export function texto_visitas(visitas: readonly VisitaEnvio[]): string {
  if (!visitas.length) return "Todavía no hay visitas al enlace público.";
  return visitas
    .map((v) => {
      const fuente = v.origen || v.referrer || "sin origen";
      return `${v.visitado_en} · ${v.dispositivo} · ${v.sistema} · ${fuente}`;
    })
    .join("\n");
}
