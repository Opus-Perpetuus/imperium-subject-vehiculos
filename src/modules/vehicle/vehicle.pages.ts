import {
  build_feature_shell_page,
  type KirletPageDecl,
} from "@opus-perpetuus/imperium-core-kit";

const API = "api://m/subject-vehiculos";

export const vehicle_pages: KirletPageDecl[] = [
  {
    id: "vehiculos.vehicle",
    path: "padron-vehiculos",
    permission: "subject.vehiculos.vehicle.read",
    build: () =>
      build_feature_shell_page({
        id: "vehiculos.vehicle",
        owner: "subject-vehiculos",
        title: "Registro de vehículos",
        props: {
          basePath: "padron-vehiculos",
          idKey: "id",
          nameKey: "etiqueta",
          view: {
            title: "Registro de vehículos",
            subtitle: "Registra y consulta cada unidad: placas, número económico, marca y modelo",
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
              { key: "placas", label: "Placas", sortable: true, priority: 1 },
              { key: "name", label: "Nombre", sortable: true, priority: 1 },
              { key: "numero_economico", label: "Número económico", sortable: true, priority: 2 },
              { key: "marca", label: "Marca", sortable: true, priority: 2 },
              { key: "modelo", label: "Modelo", sortable: true, priority: 3 },
              { key: "chofer_nombre", label: "Chofer", sortable: true, priority: 3 },
              { key: "estado_operativo", label: "Estado", sortable: true, priority: 3 },
            ],
            fillHeight: true,
            serverQuery: true,
          },
          form: {
            fields: [
              { name: "foto", component: "input-image", label: "Foto" },
              { name: "name", component: "input-text", label: "Nombre", required: true },
              { name: "placas", component: "input-text", label: "Placas" },
              { name: "numero_economico", component: "input-text", label: "Número económico" },
              { name: "marca", component: "input-text", label: "Marca" },
              { name: "modelo", component: "input-text", label: "Modelo" },
              { name: "anio", component: "input-number", label: "Año" },
              { name: "color", component: "input-text", label: "Color" },
              {
                name: "tipo_unidad",
                component: "input-radio-buttons",
                label: "Tipo de unidad",
                options: [
                  { value: "pickup", label: "Pickup" },
                  { value: "van", label: "Van" },
                  { value: "camion", label: "Camión" },
                  { value: "motocicleta", label: "Motocicleta" },
                  { value: "otro", label: "Otro" },
                ],
              },
              { name: "serie", component: "input-text", label: "Número de serie" },
              { name: "capacidad_carga_kg", component: "input-number", label: "Capacidad de carga (kg)" },
              {
                name: "estado_operativo",
                component: "input-radio-buttons",
                label: "Estado",
                options: [
                  { value: "en_servicio", label: "En servicio" },
                  { value: "taller", label: "En taller" },
                  { value: "fuera", label: "Fuera de servicio" },
                ],
              },
              {
                name: "chofer",
                component: "input-datalist",
                label: "Chofer",
                optionsSource: "api://m/subject-rh/employee?as=options&limite=1000",
                help: "Elige a la persona si está en el personal. Si no aparece, escribe su nombre abajo.",
              },
              { name: "chofer_nombre", component: "input-text", label: "Nombre del chofer" },
              {
                name: "lectura_km",
                component: "input-number",
                label: "Kilómetros",
                help: "La lectura actual entra a los recordatorios por uso.",
              },
              { name: "lectura_horas", component: "input-number", label: "Horas de motor" },
              { name: "description", component: "input-textarea", label: "Notas" },
            ],
          },
        },
      }),
  },
];
