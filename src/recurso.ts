import {
  build_feature_shell_page,
  define_crud,
  define_module,
  define_routes,
  type CrudFieldSpec,
  type CrudHooks,
  type DomainRow,
  type FeatureShellFieldDescriptor,
  type KirletColumnDecl,
  type KirletMenuDecl,
  type KirletModuleDef,
  type KirletPageDecl,
  type KirletRouteTable,
} from "@opus-perpetuus/imperium-core-kit";

export const API = "api://m/subject-vehiculos";

const AUDIT_COLUMNS: KirletColumnDecl[] = [
  { name: "id", type: "text", primaryKey: true },
  { name: "name", type: "text", notNull: true },
  { name: "description", type: "text" },
  { name: "is_active", type: "boolean", notNull: true, default: true },
  { name: "state", type: "text" },
  { name: "ref", type: "text", unique: true },
  { name: "search_field", type: "text" },
  { name: "created_by", type: "text" },
  { name: "custom_data", type: "json" },
  { name: "payload", type: "json" },
  { name: "created_at", type: "text", notNull: true },
  { name: "updated_at", type: "text", notNull: true },
];

const AUDIT_FIELDS: Record<string, CrudFieldSpec> = {
  name: { type: "string", required: true, search: true },
  description: { type: "string", search: true },
  is_active: { type: "boolean" },
  state: { type: "string" },
  ref: { type: "string", search: true },
  search_field: { type: "string", search: true },
  created_by: { type: "string" },
  custom_data: { type: "json" },
  payload: { type: "json" },
};

export const VEHICULO: FeatureShellFieldDescriptor = {
  name: "vehicle_id",
  component: "input-datalist",
  label: "Vehículo",
  required: true,
  optionsSource: `${API}/vehicle?as=options&limite=1000`,
};

export const ESTADO_ABIERTO: FeatureShellFieldDescriptor = {
  name: "estado",
  component: "input-menu",
  label: "Estado",
  options: [
    { value: "abierto", label: "Abierto" },
    { value: "cerrado", label: "Cerrado" },
  ],
};

type Columna = { key: string; label: string };

type Accion = {
  id: string;
  label: string;
  confirm?: string;
  method: "POST" | "PATCH";
  action: string;
};

export type RecursoSpec = {
  resource: string;
  table: string;
  singular: string;
  plural: string;
  order: number;
  subtitle: string;
  columns: KirletColumnDecl[];
  fields: Record<string, CrudFieldSpec>;
  list: Columna[];
  form: FeatureShellFieldDescriptor[];
  hooks?: CrudHooks;
  redact?: (row: DomainRow) => DomainRow;
  extra_routes?: KirletRouteTable;
  pages_extra?: KirletPageDecl[];
  menu_extra?: KirletMenuDecl[];
  acciones?: Accion[];
};

export function pagina_lista(opts: {
  id: string;
  path: string;
  listPath: string;
  title: string;
  subtitle: string;
  plural: string;
  singular: string;
  permissionResource: string;
  columns: Columna[];
  fields?: FeatureShellFieldDescriptor[];
  acciones?: Accion[];
}): KirletPageDecl {
  const permission = `subject.vehiculos.${opts.permissionResource}.read`;
  const base = `${API}/${opts.permissionResource}`;
  return {
    id: opts.id,
    path: opts.path,
    permission,
    build: () =>
      build_feature_shell_page({
        id: opts.id,
        owner: "subject-vehiculos",
        title: opts.title,
        props: {
          basePath: opts.path,
          idKey: "id",
          nameKey: "name",
          view: {
            title: opts.title,
            subtitle: opts.subtitle,
            pluralLabel: opts.plural,
            singularLabel: opts.singular,
            emptyTitle: "Sin registros",
            emptyDescription: "Nada pendiente en este listado",
          },
          data: {
            list: `${API}/${opts.listPath}`,
            ...(opts.fields
              ? {
                  record: `${base}/:id`,
                  create: { method: "POST" as const, action: base },
                  update: { method: "PATCH" as const, action: `${base}/:id` },
                  delete: { method: "DELETE" as const, action: `${base}/:id` },
                }
              : {}),
          },
          table: {
            columns: opts.columns.map((column, index) => ({
              key: column.key,
              label: column.label,
              sortable: true,
              priority: (index === 0 ? 1 : index === 1 ? 2 : 3) as 1 | 2 | 3,
            })),
            fillHeight: true,
            serverQuery: true,
          },
          ...(opts.fields ? { form: { fields: opts.fields } } : {}),
          ...(opts.acciones
            ? {
                headerActions: {
                  detail: opts.acciones.map((action) => ({
                    id: action.id,
                    label: action.label,
                    confirm: action.confirm,
                    variant: "primary" as const,
                    refresh: "record" as const,
                    invoke: { method: action.method, action: action.action },
                  })),
                },
              }
            : {}),
        },
      }),
  };
}

export function definir_recurso(spec: RecursoSpec): KirletModuleDef {
  const permission = `subject.vehiculos.${spec.resource}.read`;
  const page = pagina_lista({
    id: `vehiculos.${spec.resource}`,
    path: spec.resource,
    listPath: spec.resource,
    title: spec.plural,
    subtitle: spec.subtitle,
    plural: spec.plural,
    singular: spec.singular,
    permissionResource: spec.resource,
    columns: spec.list,
    fields: spec.form,
    acciones: spec.acciones,
  });
  const columns = [...AUDIT_COLUMNS, ...spec.columns];
  const has_vehicle = columns.some((column) => column.name === "vehicle_id");
  const crud = define_crud({
    resource: spec.resource,
    table: spec.table,
    soft_delete: true,
    soft_delete_field: "is_active",
    history: true,
    redact_history: spec.redact,
    default_sort: "created_at:desc",
    id_prefix: spec.table.slice(0, 12),
    options_map: { value: "id", label: "name" },
    hooks: spec.hooks,
    fields: { ...AUDIT_FIELDS, ...spec.fields },
  });
  return define_module({
    resource: spec.resource,
    labels: {
      singular: spec.singular,
      plural: spec.plural,
      read: `Ver ${spec.plural}`,
      write: `Editar ${spec.plural}`,
    },
    routes: [...(spec.extra_routes ?? []), ...crud],
    tables: [
      {
        name: spec.table,
        columns,
        indexes: [
          { name: `idx_${spec.table}_name`, columns: ["name"] },
          ...(has_vehicle
            ? [{ name: `idx_${spec.table}_vehicle`, columns: ["vehicle_id"] }]
            : []),
        ],
      },
    ],
    pages: [page, ...(spec.pages_extra ?? [])],
    menu: [
      {
        id: `vehiculos.${spec.resource}`,
        label: spec.plural,
        order: spec.order,
        pageId: `vehiculos.${spec.resource}`,
        path: spec.resource,
        permission,
        icon: "document",
      },
      ...(spec.menu_extra ?? []),
    ],
  });
}

export { define_routes };
