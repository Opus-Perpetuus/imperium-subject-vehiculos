import { define_crud, define_module } from "@opus-perpetuus/imperium-core-kit";
import { vehicle_pages } from "./vehicle.pages.ts";
import { vehicle_tables } from "./vehicle.tables.ts";

export const vehicle_module = define_module({
  resource: "vehicle",
  labels: {
    singular: "Vehículos",
    plural: "Vehículos",
    read: "Ver Vehículos",
    write: "Editar Vehículos",
  },
  routes: define_crud({
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
    },
    options_map: { value: "id", label: "name" },
  }),
  tables: vehicle_tables,
  pages: vehicle_pages,
  menu: [
    {
      id: "vehiculos.vehicle",
      label: "Vehículos",
      order: 10,
      pageId: "vehiculos.vehicle",
      path: "vehicle",
      permission: "subject.vehiculos.vehicle.read",
      icon: "document",
    }
    ],
});
