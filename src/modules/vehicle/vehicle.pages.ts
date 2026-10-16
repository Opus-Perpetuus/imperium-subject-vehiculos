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
            subtitle: "Padrón: placas, número económico, marca, modelo y chofer",
            pluralLabel: "vehículos",
            singularLabel: "vehículo",
            emptyTitle: "Sin vehículos",
            emptyDescription: "Registra la primera unidad",
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
              { key: "placas", label: "Placas", sortable: true, priority: 1 },
              { key: "numero_economico", label: "Número económico", sortable: true, priority: 2 },
              { key: "marca", label: "Marca", sortable: true, priority: 3 },
              { key: "modelo", label: "Modelo", sortable: true, priority: 3 },
              { key: "chofer_nombre", label: "Chofer", sortable: true, priority: 3 },
              { key: "lectura_km", label: "Kilómetros", sortable: true, priority: 3 },
            ],
            fillHeight: true,
            serverQuery: true,
          },
          form: {
            fields: [
              { name: "name", component: "input-text", label: "Nombre", required: true },
              { name: "description", component: "input-textarea", label: "Descripción" },
              { name: "ref", component: "input-text", label: "Referencia" },
              { name: "foto", component: "input-image", label: "Foto" },
              { name: "placas", component: "input-text", label: "Placas" },
              { name: "numero_economico", component: "input-text", label: "Número económico" },
              { name: "serie", component: "input-text", label: "Número de serie" },
              { name: "marca", component: "input-text", label: "Marca" },
              { name: "modelo", component: "input-text", label: "Modelo" },
              { name: "color", component: "input-text", label: "Color" },
              { name: "anio", component: "input-number", label: "Año" },
              { name: "capacidad_carga_kg", component: "input-number", label: "Capacidad de carga (kg)" },
              {
                name: "tipo_unidad",
                component: "input-menu",
                label: "Tipo de unidad",
                options: [
                  { value: "pickup", label: "Pickup" },
                  { value: "van", label: "Van" },
                  { value: "camion", label: "Camión" },
                  { value: "motocicleta", label: "Motocicleta" },
                  { value: "otro", label: "Otro" },
                ],
              },
              { name: "estado_operativo", component: "input-text", label: "Estado operativo" },
              { name: "chofer", component: "input-datalist", label: "Chofer", optionsSource: "api://m/subject-rh/employee?as=options&limite=1000" },
              { name: "chofer_nombre", component: "input-text", label: "Nombre del chofer" },
              {
                name: "lectura_km",
                component: "input-number",
                label: "Kilómetros",
                help: "La lectura actual entra a los recordatorios por uso.",
              },
              { name: "lectura_horas", component: "input-number", label: "Horas de motor" },
            ],
          },
        },
      }),
  },
];
