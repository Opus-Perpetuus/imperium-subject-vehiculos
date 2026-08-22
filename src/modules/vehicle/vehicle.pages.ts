import {
  build_feature_shell_page,
  type KirletPageDecl,
} from "@opus-perpetuus/imperium-core-kit";

const API = "api://m/subject-vehiculos";

export const vehicle_pages: KirletPageDecl[] = [
  {
    id: "vehiculos.vehicle",
    path: "vehicle",
    permission: "subject.vehiculos.vehicle.read",
    build: () =>
      build_feature_shell_page({
        id: "vehiculos.vehicle",
        owner: "subject-vehiculos",
        title: "Vehículos",
        props: {
          basePath: "vehicle",
          idKey: "id",
          nameKey: "name",
          view: {
            title: "Vehículos",
            subtitle: "Submenú de vehiculos",
            pluralLabel: "vehículos",
            singularLabel: "vehículos",
            emptyTitle: "Sin registros",
            emptyDescription: "Migra desde Mongo o crea el primero",
          },
          data: {
            list: `${API}/vehicle`,
            record: `${API}/vehicle/:id`,
            create: { method: "POST", action: `${API}/vehicle` },
            update: { method: "PATCH", action: `${API}/vehicle/:id` },
            delete: { method: "DELETE", action: `${API}/vehicle/:id` },
          },
          table: {
            columns: [
              { key: "name", label: "Nombre", sortable: true, priority: 1 },
              { key: "is_active", label: "Activo", sortable: true, priority: 2 },
              { key: "ref", label: "Ref", sortable: true, priority: 3 },
              { key: "foto", label: "foto", sortable: true, priority: 3 },
              { key: "placas", label: "placas", sortable: true, priority: 3 },
              { key: "numero_economico", label: "numero economico", sortable: true, priority: 3 },
              { key: "marca", label: "marca", sortable: true, priority: 3 },
              { key: "modelo", label: "modelo", sortable: true, priority: 3 },
              { key: "color", label: "color", sortable: true, priority: 3 },
            ],
            fillHeight: true,
            serverQuery: true,
          },
          form: {
            fields: [
              { name: "name", component: "input-text", label: "Nombre", required: true },
              { name: "description", component: "input-text", label: "Descripción" },
              { name: "ref", component: "input-text", label: "Referencia (_ref)" },
              { name: "foto", component: "input-text", label: "foto" },
              { name: "placas", component: "input-text", label: "placas" },
              { name: "numero_economico", component: "input-text", label: "numero economico" },
              { name: "marca", component: "input-text", label: "marca" },
              { name: "modelo", component: "input-text", label: "modelo" },
              { name: "color", component: "input-text", label: "color" },
              { name: "anio", component: "input-number", label: "anio" },
              { name: "capacidad_carga_kg", component: "input-number", label: "capacidad carga kg" },
              { name: "tipo_unidad", component: "input-text", label: "tipo unidad" },
              { name: "estado_operativo", component: "input-text", label: "estado operativo" },
              { name: "chofer", component: "input-text", label: "chofer" },
              { name: "chofer_nombre", component: "input-text", label: "chofer nombre" },
            ],
          },
        },
      }),
  },
];
