import {
  KirletHttpError,
  new_id,
  now_iso,
  today_iso,
  type DomainRow,
  type KirletCtx,
} from "@opus-perpetuus/imperium-core-kit";
import { completar_importe, lleno, rendimiento_de_carga } from "../../combustible.ts";
import { general_option_list_options_source } from "../../general-option-seeds.ts";
import { es_error, etiqueta_vehiculo, fecha_iso, numero } from "../../control.ts";
import { VEHICULO, definir_recurso } from "../../recurso.ts";
import { sincronizar_odometro } from "../lectura-uso/lectura-uso.routes.ts";

function invalido(message: string): never {
  throw new KirletHttpError(400, "validation_error", message);
}

async function cargas_del_vehiculo(ctx: KirletCtx, vehicle_id: string): Promise<DomainRow[]> {
  return ctx.data.findMany("carga_combustible", { where: { vehicle_id }, limit: 10000 });
}

async function calcular(ctx: KirletCtx, row: DomainRow): Promise<DomainRow> {
  const importe = completar_importe(row);
  if (es_error(importe)) invalido(importe.error);
  const vehicle_id = String(row.vehicle_id ?? "").trim();
  if (!vehicle_id) invalido("indica el vehículo");
  const rendimiento = rendimiento_de_carga(await cargas_del_vehiculo(ctx, vehicle_id), row);
  if (es_error(rendimiento)) invalido(rendimiento.error);
  return { ...row, ...importe, ...rendimiento };
}

/** La carga trae el odómetro: queda también como lectura de km del vehículo. */
async function registrar_lectura(ctx: KirletCtx, row: DomainRow): Promise<void> {
  const odometro = numero(row.odometro);
  if (odometro == null) return;
  const vehicle_id = String(row.vehicle_id ?? "");
  const vehicle = await ctx.data.findOne("vehicle", { id: vehicle_id });
  if (!vehicle) return;
  const ts = now_iso();
  await ctx.data.insert("lectura_uso", {
    id: new_id("lectura_uso"),
    name: `Carga de combustible ${String(row.fecha ?? "")}`.trim(),
    description: `Tomada de la carga ${String(row.id)}`,
    vehicle_id,
    vehiculo: etiqueta_vehiculo(vehicle),
    tipo: "km",
    valor: odometro,
    fecha: row.fecha ?? today_iso(),
    is_active: true,
    created_at: ts,
    updated_at: ts,
  });
  await sincronizar_odometro(ctx, vehicle_id, "km", { accion: "alta" });
}

export const carga_combustible_module = definir_recurso({
  resource: "carga-combustible",
  table: "carga_combustible",
  singular: "Carga de combustible",
  plural: "Cargas de combustible",
  order: 85,
  subtitle: "Litros, costo y odómetro de cada carga; de tanque lleno a tanque lleno calcula el km/l",
  columns: [
    { name: "vehicle_id", type: "text", notNull: true },
    { name: "fecha", type: "text" },
    { name: "litros", type: "real", notNull: true },
    { name: "precio_litro", type: "real" },
    { name: "costo", type: "real" },
    { name: "odometro", type: "real" },
    { name: "tanque_lleno", type: "boolean", notNull: true, default: true },
    { name: "tipo_combustible", type: "text" },
    { name: "estacion", type: "text" },
    { name: "conductor", type: "text" },
    { name: "km_recorridos", type: "real" },
    { name: "rendimiento_km_l", type: "real" },
    { name: "comprobante", type: "text" },
  ],
  fields: {
    vehicle_id: { type: "string", required: true, search: true },
    fecha: { type: "string", search: true },
    litros: { type: "number", required: true },
    precio_litro: { type: "number" },
    costo: { type: "number" },
    odometro: { type: "number" },
    tanque_lleno: { type: "boolean" },
    tipo_combustible: { type: "string", search: true },
    estacion: { type: "string", search: true },
    conductor: { type: "string", search: true },
    km_recorridos: { type: "number" },
    rendimiento_km_l: { type: "number" },
    comprobante: { type: "string" },
  },
  list: [
    { key: "fecha", label: "Fecha" },
    { key: "vehiculo", label: "Vehículo" },
    { key: "litros", label: "Litros" },
    { key: "costo", label: "Costo" },
    { key: "odometro", label: "Odómetro" },
    { key: "rendimiento_km_l", label: "km/l" },
  ],
  form: [
    { name: "name", component: "input-text", label: "Referencia", required: true, help: "Folio del ticket o una nota corta." },
    VEHICULO,
    { name: "fecha", component: "input-date", label: "Fecha" },
    { name: "litros", component: "input-number", label: "Litros", required: true, min: 0 },
    { name: "precio_litro", component: "input-money", label: "Precio por litro", help: "Con el precio o con el costo basta: el otro se calcula." },
    { name: "costo", component: "input-money", label: "Costo total" },
    { name: "odometro", component: "input-number", label: "Odómetro (km)", min: 0, help: "Actualiza los kilómetros del vehículo y sus recordatorios." },
    {
      name: "tanque_lleno",
      component: "input-checkbox",
      label: "Tanque lleno",
      help: "Llenar el tanque permite calcular el rendimiento desde el lleno anterior.",
    },
    {
      name: "tipo_combustible",
      component: "input-radio-buttons",
      label: "Combustible",
      // Opciones: general-option-list-control (seed en general-option-seeds.ts).
      optionsSource: general_option_list_options_source(
        "subject-vehiculos/carga-combustible",
        "tipo_combustible",
      ),
    },
    { name: "estacion", component: "input-text", label: "Estación" },
    { name: "conductor", component: "input-text", label: "Quién cargó" },
    { name: "comprobante", component: "input-image", label: "Ticket" },
    { name: "km_recorridos", component: "input-number", label: "km desde la carga anterior", read_only: true },
    { name: "rendimiento_km_l", component: "input-number", label: "Rendimiento (km/l)", read_only: true },
    { name: "description", component: "input-textarea", label: "Notas" },
  ],
  redact: (row) => (row.comprobante ? { ...row, comprobante: "[imagen]" } : row),
  hooks: {
    async before_create(ctx, row) {
      if (!row.fecha) row.fecha = today_iso();
      if (!fecha_iso(row.fecha)) invalido("la carga necesita una fecha válida");
      row.tanque_lleno = row.tanque_lleno == null ? true : lleno(row.tanque_lleno);
      if (!row.tipo_combustible) {
        const vehicle = await ctx.data.findOne("vehicle", { id: String(row.vehicle_id ?? "") });
        if (vehicle?.tipo_combustible) row.tipo_combustible = vehicle.tipo_combustible;
      }
      return calcular(ctx, row);
    },
    async after_create(ctx, row) {
      await registrar_lectura(ctx, row);
    },
    async before_update(ctx, id, patch, existing) {
      if ("fecha" in patch && patch.fecha != null && !fecha_iso(patch.fecha)) {
        invalido("la carga necesita una fecha válida");
      }
      if ("tanque_lleno" in patch) patch.tanque_lleno = lleno(patch.tanque_lleno);
      const toca = ["litros", "precio_litro", "costo", "odometro", "tanque_lleno", "fecha", "vehicle_id"];
      if (!toca.some((campo) => campo in patch)) return patch;
      // Si cambian litros y no el importe, el costo se recalcula con el precio.
      const base: DomainRow = { ...existing, ...patch, id };
      if ("litros" in patch && !("costo" in patch) && numero(base.precio_litro) != null) base.costo = null;
      const calculada = await calcular(ctx, base);
      for (const campo of ["litros", "precio_litro", "costo", "km_recorridos", "rendimiento_km_l"]) {
        patch[campo] = calculada[campo];
      }
      return patch;
    },
  },
});
