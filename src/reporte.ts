// Costos por vehículo: suma lo capturado en mantenimientos y combustible.
import { redondear, rendimiento_promedio } from "./combustible.ts";
import { estado_abierto, etiqueta_vehiculo, fecha_iso, numero, type Aviso } from "./control.ts";

type Fila = Record<string, unknown>;

export type RenglonFlota = {
  id: string;
  name: string;
  vehiculo: string;
  placas: string;
  estado_operativo: string;
  costo_correctivo: number;
  costo_preventivo: number;
  costo_combustible: number;
  costo_total: number;
  litros: number;
  km_recorridos: number;
  costo_por_km: number | null;
  rendimiento_km_l: number | null;
  fallas_abiertas: number;
  avisos_vencidos: number;
};

export type Periodo = { desde: string | null; hasta: string | null };

export function periodo_de(query: URLSearchParams): Periodo | { error: string } {
  const leer = (nombre: string) => {
    const crudo = query.get(nombre);
    if (crudo == null || crudo.trim() === "") return { valor: null };
    const valor = fecha_iso(crudo);
    return valor ? { valor } : { error: `${nombre} no es una fecha válida (AAAA-MM-DD)` };
  };
  const desde = leer("fecha_desde");
  if ("error" in desde) return { error: desde.error! };
  const hasta = leer("fecha_hasta");
  if ("error" in hasta) return { error: hasta.error! };
  if (desde.valor && hasta.valor && desde.valor > hasta.valor) {
    return { error: "fecha_desde no puede ser posterior a fecha_hasta" };
  }
  return { desde: desde.valor, hasta: hasta.valor };
}

function en_periodo(fila: Fila, periodo: Periodo): boolean {
  if (fila.is_active === false) return false;
  if (!periodo.desde && !periodo.hasta) return true;
  const fecha = fecha_iso(fila.fecha) ?? fecha_iso(fila.created_at);
  if (!fecha) return false;
  if (periodo.desde && fecha < periodo.desde) return false;
  if (periodo.hasta && fecha > periodo.hasta) return false;
  return true;
}

function agrupar(filas: readonly Fila[], periodo: Periodo): Map<string, Fila[]> {
  const grupos = new Map<string, Fila[]>();
  for (const fila of filas) {
    if (!en_periodo(fila, periodo)) continue;
    const id = String(fila.vehicle_id ?? "");
    const lista = grupos.get(id);
    if (lista) lista.push(fila);
    else grupos.set(id, [fila]);
  }
  return grupos;
}

const suma = (filas: readonly Fila[] | undefined, campo: string) =>
  redondear((filas ?? []).reduce((total, fila) => total + Math.max(0, numero(fila[campo]) ?? 0), 0));

/**
 * Un renglón por vehículo activo, del más caro al más barato. Las fallas
 * abiertas y los avisos vencidos son de hoy, no del periodo.
 */
export function reporte_flota(input: {
  vehiculos: readonly Fila[];
  correctivos: readonly Fila[];
  preventivos: readonly Fila[];
  cargas: readonly Fila[];
  fallas: readonly Fila[];
  vencidos: readonly Aviso[];
  periodo: Periodo;
}): { renglones: RenglonFlota[]; totales: Omit<RenglonFlota, "id" | "name" | "vehiculo" | "placas" | "estado_operativo"> } {
  const correctivos = agrupar(input.correctivos, input.periodo);
  const preventivos = agrupar(input.preventivos, input.periodo);
  const cargas = agrupar(input.cargas, input.periodo);
  const fallas = new Map<string, number>();
  for (const falla of input.fallas) {
    if (falla.is_active === false || estado_abierto(falla.estado) !== "abierto") continue;
    const id = String(falla.vehicle_id ?? "");
    fallas.set(id, (fallas.get(id) ?? 0) + 1);
  }
  const vencidos = new Map<string, number>();
  for (const aviso of input.vencidos) vencidos.set(aviso.vehicle_id, (vencidos.get(aviso.vehicle_id) ?? 0) + 1);

  const renglones: RenglonFlota[] = input.vehiculos
    .filter((vehiculo) => vehiculo.is_active !== false)
    .map((vehiculo) => {
      const id = String(vehiculo.id);
      const sus_cargas = cargas.get(id) ?? [];
      const costo_correctivo = suma(correctivos.get(id), "costo");
      const costo_preventivo = suma(preventivos.get(id), "costo");
      const costo_combustible = suma(sus_cargas, "costo");
      const costo_total = redondear(costo_correctivo + costo_preventivo + costo_combustible);
      const km_recorridos = suma(sus_cargas, "km_recorridos");
      return {
        id,
        name: String(vehiculo.name ?? ""),
        vehiculo: String(vehiculo.etiqueta || etiqueta_vehiculo(vehiculo)),
        placas: String(vehiculo.placas ?? ""),
        estado_operativo: String(vehiculo.estado_operativo ?? ""),
        costo_correctivo,
        costo_preventivo,
        costo_combustible,
        costo_total,
        litros: suma(sus_cargas, "litros"),
        km_recorridos,
        costo_por_km: km_recorridos > 0 ? redondear(costo_total / km_recorridos) : null,
        rendimiento_km_l: rendimiento_promedio(sus_cargas).rendimiento_km_l,
        fallas_abiertas: fallas.get(id) ?? 0,
        avisos_vencidos: vencidos.get(id) ?? 0,
      };
    })
    .sort((a, b) => b.costo_total - a.costo_total || a.vehiculo.localeCompare(b.vehiculo, "es"));

  const total = (campo: keyof RenglonFlota) =>
    redondear(renglones.reduce((acumulado, renglon) => acumulado + (Number(renglon[campo]) || 0), 0));
  const km = total("km_recorridos");
  const costo_total = total("costo_total");
  const todas_las_cargas = [...cargas.values()];
  const rendimientos = todas_las_cargas.map((lista) => rendimiento_promedio(lista));
  const km_rend = rendimientos.reduce((s, r) => s + r.km, 0);
  const litros_rend = rendimientos.reduce((s, r) => s + r.litros, 0);
  return {
    renglones,
    totales: {
      costo_correctivo: total("costo_correctivo"),
      costo_preventivo: total("costo_preventivo"),
      costo_combustible: total("costo_combustible"),
      costo_total,
      litros: total("litros"),
      km_recorridos: km,
      costo_por_km: km > 0 ? redondear(costo_total / km) : null,
      rendimiento_km_l: km_rend > 0 && litros_rend > 0 ? redondear(km_rend / litros_rend) : null,
      fallas_abiertas: total("fallas_abiertas"),
      avisos_vencidos: total("avisos_vencidos"),
    },
  };
}
