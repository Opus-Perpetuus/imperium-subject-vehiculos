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
  type KirletCtx,
  type KirletMenuDecl,
  type KirletModuleDef,
  type KirletPageDecl,
  type KirletRouteTable,
} from "@opus-perpetuus/imperium-core-kit";
import { etiqueta_vehiculo } from "./control.ts";

type Cuerpo = { data?: unknown };

function es_opcion(row: unknown): row is { value?: unknown; label?: unknown } {
  return !!row && typeof row === "object" && "value" in row && "label" in row && !("id" in row);
}

async function vehiculos_por_id(ctx: KirletCtx, ids: string[]): Promise<Map<string, DomainRow>> {
  const unicos = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (!unicos.length) return new Map();
  const filas = await ctx.data.findMany("vehicle", {
    where: { id: { in: unicos } },
    limit: unicos.length,
  });
  return new Map(filas.map((fila) => [String(fila.id), fila]));
}

/**
 * La semilla y las unidades ya guardadas no tienen `etiqueta` ni `vehiculo`.
 * El selector y la lista leen esos campos: si vienen vacíos, se arman aquí
 * con el nombre y las placas.
 */
export async function respuesta_con_vehiculo(
  ctx: KirletCtx,
  body: unknown,
  modo: "unidad" | "relacion",
): Promise<unknown> {
  if (!body || typeof body !== "object" || !("data" in body)) return body;
  const data = (body as Cuerpo).data;
  if (Array.isArray(data)) {
    return { ...body, data: await filas_con_vehiculo(ctx, data, modo) };
  }
  if (data && typeof data === "object") {
    const [fila] = await filas_con_vehiculo(ctx, [data], modo);
    return { ...body, data: fila };
  }
  return body;
}

async function filas_con_vehiculo(
  ctx: KirletCtx,
  rows: unknown[],
  modo: "unidad" | "relacion",
): Promise<unknown[]> {
  if (rows.length > 0 && rows.every(es_opcion)) {
    const faltan = rows.filter((row) => !String(row.label ?? "").trim());
    if (!faltan.length) return rows;
    const por_id = await vehiculos_por_id(
      ctx,
      faltan.map((row) => String(row.value ?? "")),
    );
    return rows.map((row) => {
      if (String(row.label ?? "").trim()) return row;
      const vehicle = por_id.get(String(row.value ?? ""));
      return vehicle ? { ...row, label: etiqueta_vehiculo(vehicle) } : row;
    });
  }
  if (modo === "unidad") {
    return rows.map((row) => {
      if (!row || typeof row !== "object") return row;
      const unidad = row as DomainRow;
      if (String(unidad.etiqueta ?? "").trim()) return unidad;
      return { ...unidad, etiqueta: etiqueta_vehiculo(unidad) };
    });
  }
  const pendientes = rows.filter(
    (row) =>
      row &&
      typeof row === "object" &&
      String((row as DomainRow).vehicle_id ?? "").trim() &&
      !String((row as DomainRow).vehiculo ?? "").trim(),
  );
  if (!pendientes.length) return rows;
  const por_id = await vehiculos_por_id(
    ctx,
    pendientes.map((row) => String((row as DomainRow).vehicle_id ?? "")),
  );
  return rows.map((row) => {
    if (!row || typeof row !== "object") return row;
    const fila = row as DomainRow;
    if (String(fila.vehiculo ?? "").trim()) return fila;
    const vehicle = por_id.get(String(fila.vehicle_id ?? ""));
    return vehicle ? { ...fila, vehiculo: etiqueta_vehiculo(vehicle) } : fila;
  });
}

export function lectura_con_nombre(
  routes: KirletRouteTable,
  resource: string,
  modo: "unidad" | "relacion",
): KirletRouteTable {
  const patrones = new Set([`GET /${resource}`, `GET /${resource}/:id`]);
  return routes.map((route) => {
    if (!patrones.has(route.pattern)) return route;
    const handler = route.handler as (ctx: KirletCtx) => Promise<unknown>;
    return {
      ...route,
      handler: async (ctx: KirletCtx) => respuesta_con_vehiculo(ctx, await handler(ctx), modo),
    };
  });
}

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
  help: "Busca por el nombre o las placas. No hace falta el identificador.",
};

export const ESTADO_ABIERTO: FeatureShellFieldDescriptor = {
  name: "estado",
  component: "input-radio-buttons",
  label: "Estado",
  options: [
    { value: "abierto", label: "Abierto" },
    { value: "cerrado", label: "Cerrado" },
  ],
};

async function anotar_vehiculo(ctx: KirletCtx, row: DomainRow, vehicle_id: unknown) {
  const id = String(vehicle_id ?? "").trim();
  if (!id) return;
  const vehicle = await ctx.data.findOne("vehicle", { id });
  if (!vehicle) return;
  row.vehiculo = etiqueta_vehiculo(vehicle);
}

function con_vehiculo(hooks: CrudHooks | undefined): CrudHooks {
  return {
    async before_create(ctx, row) {
      const next = hooks?.before_create ? await hooks.before_create(ctx, row) : row;
      await anotar_vehiculo(ctx, next, next.vehicle_id);
      return next;
    },
    async before_update(ctx, id, patch, existing) {
      const next = hooks?.before_update
        ? await hooks.before_update(ctx, id, patch, existing)
        : patch;
      const vehicle_id = "vehicle_id" in next ? next.vehicle_id : existing.vehicle_id;
      if ("vehicle_id" in next || !existing.vehiculo) {
        await anotar_vehiculo(ctx, next, vehicle_id);
      }
      return next;
    },
    after_create: hooks?.after_create,
    after_update: hooks?.after_update,
    before_delete: hooks?.before_delete,
    after_delete: hooks?.after_delete,
  };
}

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
  const has_vehicle = spec.columns.some((column) => column.name === "vehicle_id");
  const columns = [
    ...AUDIT_COLUMNS,
    ...spec.columns,
    ...(has_vehicle ? [{ name: "vehiculo", type: "text" as const }] : []),
  ];
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
    hooks: has_vehicle ? con_vehiculo(spec.hooks) : spec.hooks,
    fields: {
      ...AUDIT_FIELDS,
      ...spec.fields,
      ...(has_vehicle ? { vehiculo: { type: "string" as const, search: true } } : {}),
    },
  });
  const extra = spec.extra_routes ?? [];
  const reemplaza = new Set(extra.map((route) => route.pattern));
  return define_module({
    resource: spec.resource,
    labels: {
      singular: spec.singular,
      plural: spec.plural,
      read: `Ver ${spec.plural}`,
      write: `Editar ${spec.plural}`,
    },
    // El kit no admite dos rutas con el mismo patrón. La extra (el GET de la
    // bitácora, que abre las ranuras) sustituye a la del CRUD.
    routes: has_vehicle
      ? lectura_con_nombre(
          [...extra, ...crud.filter((route) => !reemplaza.has(route.pattern))],
          spec.resource,
          "relacion",
        )
      : [...extra, ...crud.filter((route) => !reemplaza.has(route.pattern))],
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
