import { define_crud, define_module, define_routes } from "@opus-perpetuus/imperium-core-kit";
import { etiqueta_vehiculo } from "../../control.ts";
import { lectura_con_nombre } from "../../recurso.ts";
import { vehicle_pages } from "./vehicle.pages.ts";
import { vehicle_tables } from "./vehicle.tables.ts";

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
      before_create(_ctx, row) {
        row.etiqueta = etiqueta_vehiculo(row);
        return row;
      },
      before_update(_ctx, _id, patch, existing) {
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
      "GET /vehicle/:id/historial": async (ctx) => {
        const vehicle = await ctx.data.findOne("vehicle", { id: ctx.params.id });
        if (!vehicle || vehicle.is_active === false) return ctx.not_found();
        const where = { vehicle_id: ctx.params.id };
        const [bitacoras, fallas, correctivos, preventivos, servicios, lecturas, documentos] =
          await Promise.all([
            ctx.data.findMany("bitacora", { where }),
            ctx.data.findMany("falla", { where }),
            ctx.data.findMany("mantenimiento_correctivo", { where }),
            ctx.data.findMany("mantenimiento_preventivo", { where }),
            ctx.data.findMany("servicio_programado", { where }),
            ctx.data.findMany("lectura_uso", { where }),
            ctx.data.findMany("documento_vehiculo", { where }),
          ]);
        return {
          data: { vehicle, bitacoras, fallas, correctivos, preventivos, servicios, lecturas, documentos },
        };
      },
    }),
    ...lectura_con_nombre(vehicle_crud, "vehicle", "unidad"),
  ],
  tables: vehicle_tables,
  pages: vehicle_pages,
  menu: [
    {
      id: "vehiculos.vehicle",
      label: "Padrón de vehículos",
      order: 10,
      pageId: "vehiculos.vehicle",
      path: "padron-vehiculos",
      permission: "subject.vehiculos.vehicle.read",
      icon: "fa-bus",
    }
    ],
});
