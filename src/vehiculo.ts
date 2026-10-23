// Reglas del registro de vehículos, sin HTTP.
import { numero } from "./control.ts";

type Fila = Record<string, unknown>;

/** Placas y serie se comparan sin importar mayúsculas ni espacios de más. */
export function normalizar_clave(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

const UNICOS: Array<{ campo: string; nombre: string }> = [
  { campo: "placas", nombre: "esas placas" },
  { campo: "numero_economico", nombre: "ese número económico" },
  { campo: "serie", nombre: "ese número de serie" },
];

/** Normaliza lo que se captura y rechaza números imposibles. */
export function limpiar_vehiculo(patch: Fila, anio_actual: number): string | null {
  for (const campo of ["placas", "serie"]) {
    if (campo in patch && patch[campo] != null) patch[campo] = normalizar_clave(patch[campo]);
  }
  if ("numero_economico" in patch && patch.numero_economico != null) {
    patch.numero_economico = String(patch.numero_economico).trim();
  }
  if ("anio" in patch && patch.anio != null && patch.anio !== "") {
    const anio = numero(patch.anio);
    if (anio == null || !Number.isInteger(anio) || anio < 1900 || anio > anio_actual + 2) {
      return `El año debe estar entre 1900 y ${anio_actual + 2}`;
    }
  }
  const no_negativos: Array<[string, string]> = [
    ["capacidad_carga_kg", "La capacidad de carga"],
    ["capacidad_tanque_l", "La capacidad del tanque"],
    ["lectura_km", "Los kilómetros"],
    ["lectura_horas", "Las horas de motor"],
  ];
  for (const [campo, nombre] of no_negativos) {
    if (!(campo in patch) || patch[campo] == null || patch[campo] === "") continue;
    const valor = numero(patch[campo]);
    if (valor == null || valor < 0) return `${nombre}: debe ser un número igual o mayor que cero`;
  }
  return null;
}

/** Placas, número económico o serie que el cambio trae distintos a los guardados. */
export function cambios_de_clave(patch: Fila, existing?: Fila): Fila {
  const cambios: Fila = {};
  for (const { campo } of UNICOS) {
    if (!(campo in patch)) continue;
    if (existing && normalizar_clave(existing[campo]) === normalizar_clave(patch[campo])) continue;
    cambios[campo] = patch[campo];
  }
  return cambios;
}

/**
 * Placas, número económico y serie no se repiten entre vehículos activos.
 * Solo revisa lo que trae el cambio: los datos viejos repetidos no bloquean
 * editar otra cosa.
 */
export function duplicado(
  patch: Fila,
  activos: readonly Fila[],
  propio_id?: string,
): { campo: string; mensaje: string } | null {
  for (const { campo, nombre } of UNICOS) {
    if (!(campo in patch)) continue;
    const clave = normalizar_clave(patch[campo]);
    if (!clave) continue;
    const otro = activos.find(
      (fila) =>
        fila.is_active !== false &&
        String(fila.id ?? "") !== String(propio_id ?? "") &&
        normalizar_clave(fila[campo]) === clave,
    );
    if (otro) {
      const nombre_otro = String(otro.etiqueta || otro.name || otro.id);
      return { campo, mensaje: `Ya hay un vehículo activo con ${nombre}: ${nombre_otro}` };
    }
  }
  return null;
}

type Evento = {
  clase: string;
  id: string;
  fecha: string;
  titulo: string;
  estado: string;
  costo: number | null;
};

const CLASES: Array<{ llave: string; clase: string; estado?: (fila: Fila) => string }> = [
  { llave: "bitacoras", clase: "Bitácora", estado: (f) => (f.revisada ? "revisada" : "sin revisar") },
  { llave: "fallas", clase: "Falla" },
  { llave: "correctivos", clase: "Correctivo" },
  { llave: "preventivos", clase: "Preventivo" },
  { llave: "servicios", clase: "Servicio programado" },
  { llave: "lecturas", clase: "Lectura" },
  { llave: "documentos", clase: "Documento" },
  { llave: "cargas", clase: "Combustible" },
];

/** Una sola línea de tiempo, de lo más nuevo a lo más viejo, sin registros borrados. */
export function linea_de_tiempo(grupos: Record<string, Fila[]>): Evento[] {
  const eventos: Evento[] = [];
  for (const { llave, clase, estado } of CLASES) {
    for (const fila of grupos[llave] ?? []) {
      if (fila.is_active === false) continue;
      eventos.push({
        clase,
        id: String(fila.id ?? ""),
        fecha: String(fila.fecha ?? fila.fecha_vencimiento ?? fila.proxima_fecha ?? fila.created_at ?? "").slice(0, 10),
        titulo: String(fila.name ?? ""),
        estado: estado ? estado(fila) : String(fila.estado ?? ""),
        costo: numero(fila.costo),
      });
    }
  }
  return eventos.sort((a, b) => b.fecha.localeCompare(a.fecha));
}
