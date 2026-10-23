import {
  KirletHttpError,
  define_crud,
  define_module,
  define_routes,
  type DomainRow,
  type KirletCtx,
} from "@opus-perpetuus/imperium-core-kit";
import { armar_recordatorios, etiqueta_vehiculo, numero } from "../../control.ts";
import { paginar } from "../../listado.ts";
import { periodo_de, reporte_flota } from "../../reporte.ts";
import { cambios_de_clave, duplicado, limpiar_vehiculo, linea_de_tiempo } from "../../vehiculo.ts";
import { lectura_con_nombre, pagina_lista } from "../../recurso.ts";
import { vehicle_pages } from "./vehicle.pages.ts";
import { vehicle_tables } from "./vehicle.tables.ts";

async function validar(
  ctx: KirletCtx,
  patch: DomainRow,
  existing?: DomainRow,
): Promise<void> {
  const error = limpiar_vehiculo(patch, new Date().getFullYear());
  if (error) throw new KirletHttpError(400, "validation_error", error);
  // El formulario manda todo al guardar: solo cuenta lo que de verdad cambió.
  const cambios = cambios_de_clave(patch, existing);
  if (!Object.keys(cambios).length) return;
  const activos = await ctx.data.findMany("vehicle", { limit: 10000 });
  const choque = duplicado(cambios, activos, existing ? String(existing.id) : undefined);
  if (choque) throw new KirletHttpError(409, "conflict", choque.mensaje);
}

const vehicle_crud = define_crud({
    resource: "vehicle",
    table: "vehicle",
    soft_delete: true,
    soft_delete_field: "is_active",
    history: true,
    default_sort: "name:asc",
    id_prefix: "vehicle",
    fields: {
      name: { type: "string", required: true, search: true },
      description: { type: "string", search: true },
      is_active: { type: "boolean" },
      state: { type: "string" },
      ref: { type: "string", search: true },
      search_field: { type: "string", search: true },
      created_by: { type: "string" },
      custom_data: { type: "json" },
      payload: { type: "json" },
      foto: { type: "string", search: true },
      placas: { type: "string", search: true },
      numero_economico: { type: "string", search: true },
      marca: { type: "string", search: true },
      modelo: { type: "string", search: true },
      color: { type: "string", search: true },
      anio: { type: "number" },
      capacidad_carga_kg: { type: "number" },
      tipo_unidad: { type: "string", search: true },
      tipo_combustible: { type: "string" },
      capacidad_tanque_l: { type: "number" },
      estado_operativo: { type: "string", search: true },
      chofer: { type: "string", search: true },
      chofer_nombre: { type: "string", search: true },
      serie: { type: "string", search: true },
      lectura_km: { type: "number" },
      lectura_horas: { type: "number" },
      etiqueta: { type: "string", search: true },
    },
    options_map: { value: "id", label: "etiqueta" },
    hooks: {
      async before_create(ctx, row) {
        await validar(ctx, row);
        row.etiqueta = etiqueta_vehiculo(row);
        return row;
      },
      async before_update(ctx, id, patch, existing) {
        await validar(ctx, patch, { ...existing, id });
        patch.etiqueta = etiqueta_vehiculo({ ...existing, ...patch });
        return patch;
      },
    },
  });

export const vehicle_module = define_module({
  resource: "vehicle",
  labels: {
    singular: "Vehículo",
    plural: "Vehículos",
    read: "Ver Vehículos",
    write: "Editar Vehículos",
  },
  routes: [
    ...define_routes({
      "GET /vehicle/reporte-costos": async (ctx) => {
        const periodo = periodo_de(ctx.query);
        if ("error" in periodo) throw new KirletHttpError(400, "validation_error", periodo.error);
        const todo = { limit: 10000 };
        const [vehiculos, correctivos, preventivos, cargas, fallas, servicios, documentos] = await Promise.all([
          ctx.data.findMany("vehicle", todo),
          ctx.data.findMany("mantenimiento_correctivo", todo),
          ctx.data.findMany("mantenimiento_preventivo", todo),
          ctx.data.findMany("carga_combustible", todo),
          ctx.data.findMany("falla", todo),
          ctx.data.findMany("servicio_programado", todo),
          ctx.data.findMany("documento_vehiculo", todo),
        ]);
        const lecturas = Object.fromEntries(
          vehiculos.map((v) => [String(v.id), { km: numero(v.lectura_km), horas: numero(v.lectura_horas) }]),
        );
        const hoy = new Date().toISOString().slice(0, 10);
        const { vencidos } = armar_recordatorios({ hoy, servicios, documentos, lecturas });
        const { renglones, totales } = reporte_flota({
          vehiculos,
          correctivos,
          preventivos,
          cargas,
          fallas,
          vencidos,
          periodo,
        });
        return { ...paginar(renglones, ctx.list_query()), totales, periodo };
      },
      "GET /vehicle/:id/historial": async (ctx) => {
        const vehicle = await ctx.data.findOne("vehicle", { id: ctx.params.id });
        if (!vehicle || vehicle.is_active === false) return ctx.not_found();
        const where = { vehicle_id: ctx.params.id };
        const tablas = [
          "bitacora",
          "falla",
          "mantenimiento_correctivo",
          "mantenimiento_preventivo",
          "servicio_programado",
          "lectura_uso",
          "documento_vehiculo",
          "carga_combustible",
        ];
        // Lo borrado no es historia; lo más nuevo va primero.
        const [bitacoras, fallas, correctivos, preventivos, servicios, lecturas, documentos, cargas] =
          await Promise.all(
            tablas.map(async (tabla) =>
              (await ctx.data.findMany(tabla, { where, limit: 10000 }))
                .filter((fila) => fila.is_active !== false)
                .sort((a, b) =>
                  String(b.fecha ?? b.created_at ?? "").localeCompare(String(a.fecha ?? a.created_at ?? "")),
                ),
            ),
          );
        const grupos = { bitacoras, fallas, correctivos, preventivos, servicios, lecturas, documentos, cargas };
        return {
          data: {
            vehicle,
            ...grupos,
            cargas_combustible: cargas,
            linea_de_tiempo: linea_de_tiempo(grupos),
          },
        };
      },
    }),
    ...lectura_con_nombre(vehicle_crud, "vehicle", "unidad"),
  ],
  tables: vehicle_tables,
  pages: [
    ...vehicle_pages,
    pagina_lista({
      id: "vehiculos.reporte-flota",
      path: "costos-flota",
      listPath: "vehicle/reporte-costos",
      title: "Costos por vehículo",
      subtitle: "Mantenimiento y combustible de cada unidad, con km/l y costo por km",
      plural: "vehículos",
      singular: "vehículo",
      permissionResource: "vehicle",
      columns: [
        { key: "vehiculo", label: "Vehículo" },
        { key: "costo_total", label: "Costo total" },
        { key: "costo_combustible", label: "Combustible" },
        { key: "costo_correctivo", label: "Correctivo" },
        { key: "costo_preventivo", label: "Preventivo" },
        { key: "km_recorridos", label: "Km" },
        { key: "costo_por_km", label: "Costo por km" },
        { key: "rendimiento_km_l", label: "Km/l" },
        { key: "fallas_abiertas", label: "Fallas abiertas" },
        { key: "avisos_vencidos", label: "Vencidos" },
      ],
    }),
  ],
  menu: [
    {
      id: "vehiculos.vehicle",
      label: "Registro de vehículos",
      order: 10,
      pageId: "vehiculos.vehicle",
      path: "padron-vehiculos",
      permission: "subject.vehiculos.vehicle.read",
      icon: "fa-bus",
    },
    {
      id: "vehiculos.reporte-flota",
      label: "Costos por vehículo",
      order: 90,
      pageId: "vehiculos.reporte-flota",
      path: "costos-flota",
      permission: "subject.vehiculos.vehicle.read",
      icon: "currency",
    },
  ],
});
