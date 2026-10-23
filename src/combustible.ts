// Combustible sin HTTP: costo de la carga, rendimiento de tanque lleno a tanque lleno.
import { fecha_iso, numero } from "./control.ts";

type Fila = Record<string, unknown>;

export const TIPOS_COMBUSTIBLE = [
  { value: "magna", label: "Gasolina regular" },
  { value: "premium", label: "Gasolina premium" },
  { value: "diesel", label: "Diésel" },
  { value: "gas", label: "Gas LP" },
  { value: "electrico", label: "Carga eléctrica" },
] as const;

export function redondear(valor: number, decimales = 2): number {
  const factor = 10 ** decimales;
  return Math.round(valor * factor) / factor;
}

export function lleno(value: unknown): boolean {
  if (value === true || value === 1) return true;
  const text = String(value ?? "").trim().toLowerCase();
  return text === "true" || text === "1" || text === "si" || text === "sí";
}

/**
 * Litros, precio y costo: con dos se calcula el tercero. Ninguno puede ser
 * negativo y sin litros no hay carga.
 */
export function completar_importe(row: {
  litros?: unknown;
  precio_litro?: unknown;
  costo?: unknown;
}): { litros: number; precio_litro: number | null; costo: number | null } | { error: string } {
  const litros = numero(row.litros);
  const precio = numero(row.precio_litro);
  const costo = numero(row.costo);
  if (litros == null || litros <= 0) return { error: "la carga necesita litros mayores a cero" };
  if (precio != null && precio < 0) return { error: "el precio por litro no puede ser negativo" };
  if (costo != null && costo < 0) return { error: "el costo no puede ser negativo" };
  if (costo == null && precio != null) {
    return { litros, precio_litro: precio, costo: redondear(litros * precio) };
  }
  if (precio == null && costo != null) {
    return { litros, precio_litro: redondear(costo / litros, 3), costo };
  }
  return { litros, precio_litro: precio, costo };
}

type Carga = { id: string; fecha: string; odometro: number; litros: number; lleno: boolean };

function cargas_validas(filas: readonly Fila[], excluir?: string): Carga[] {
  const cargas: Carga[] = [];
  for (const fila of filas) {
    if (fila.is_active === false) continue;
    const id = String(fila.id ?? "");
    if (excluir && id === excluir) continue;
    const odometro = numero(fila.odometro);
    const litros = numero(fila.litros);
    if (odometro == null || litros == null) continue;
    cargas.push({
      id,
      fecha: fecha_iso(fila.fecha) ?? "",
      odometro,
      litros,
      lleno: lleno(fila.tanque_lleno),
    });
  }
  return cargas.sort((a, b) => a.odometro - b.odometro || a.fecha.localeCompare(b.fecha));
}

/**
 * Kilómetros y km/l de una carga contra las anteriores del mismo vehículo.
 * Solo una carga de tanque lleno da rendimiento: los km desde el tanque lleno
 * anterior entre los litros cargados en ese tramo (incluida esta carga).
 * Un odómetro menor que el de una carga de fecha anterior es un error de captura.
 */
export function rendimiento_de_carga(
  anteriores: readonly Fila[],
  carga: { id?: unknown; fecha?: unknown; odometro?: unknown; litros?: unknown; tanque_lleno?: unknown },
): { km_recorridos: number | null; rendimiento_km_l: number | null } | { error: string } {
  const odometro = numero(carga.odometro);
  const litros = numero(carga.litros);
  if (odometro == null) return { km_recorridos: null, rendimiento_km_l: null };
  if (odometro < 0) return { error: "el odómetro no puede ser negativo" };
  const fecha = fecha_iso(carga.fecha) ?? "";
  const otras = cargas_validas(anteriores, carga.id == null ? undefined : String(carga.id));
  const previa_en_fecha = otras.filter((otra) => otra.fecha && fecha && otra.fecha < fecha);
  const mayor = previa_en_fecha.reduce<Carga | null>(
    (max, otra) => (!max || otra.odometro > max.odometro ? otra : max),
    null,
  );
  if (mayor && odometro < mayor.odometro) {
    return {
      error: `el odómetro (${odometro}) es menor que el de la carga del ${mayor.fecha} (${mayor.odometro})`,
    };
  }
  const debajo = otras.filter((otra) => otra.odometro < odometro);
  const previa = debajo[debajo.length - 1];
  const km_recorridos = previa ? redondear(odometro - previa.odometro, 1) : null;
  if (!lleno(carga.tanque_lleno) || litros == null || litros <= 0) {
    return { km_recorridos, rendimiento_km_l: null };
  }
  const ultimo_lleno = [...debajo].reverse().find((otra) => otra.lleno);
  if (!ultimo_lleno) return { km_recorridos, rendimiento_km_l: null };
  const tramo = debajo.filter((otra) => otra.odometro > ultimo_lleno.odometro);
  const litros_tramo = tramo.reduce((suma, otra) => suma + otra.litros, litros);
  const km = odometro - ultimo_lleno.odometro;
  return {
    km_recorridos,
    rendimiento_km_l: km > 0 && litros_tramo > 0 ? redondear(km / litros_tramo) : null,
  };
}

/** km/l promedio de todas las cargas: del primer tanque lleno al último. */
export function rendimiento_promedio(filas: readonly Fila[]): {
  km: number;
  litros: number;
  rendimiento_km_l: number | null;
} {
  const cargas = cargas_validas(filas);
  const llenos = cargas.filter((carga) => carga.lleno);
  if (llenos.length < 2) return { km: 0, litros: 0, rendimiento_km_l: null };
  const primero = llenos[0];
  const ultimo = llenos[llenos.length - 1];
  const litros = cargas
    .filter((carga) => carga.odometro > primero.odometro && carga.odometro <= ultimo.odometro)
    .reduce((suma, carga) => suma + carga.litros, 0);
  const km = ultimo.odometro - primero.odometro;
  return {
    km: redondear(km, 1),
    litros: redondear(litros),
    rendimiento_km_l: km > 0 && litros > 0 ? redondear(km / litros) : null,
  };
}
