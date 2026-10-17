import { KirletHttpError, now_iso, today_iso, type DomainRow } from "@opus-perpetuus/imperium-core-kit";
import { fecha_iso, numero, odometro_tras_lecturas } from "../../control.ts";
import { VEHICULO, definir_recurso } from "../../recurso.ts";

async function sincronizar_odometro(
  ctx: {
    data: {
      findMany: (table: string, opts: { where: { vehicle_id: string; tipo: string }; limit: number }) => Promise<DomainRow[]>;
      findOne: (table: string, where: { id: string }) => Promise<DomainRow | null>;
      update: (table: string, where: { id: string }, patch: DomainRow) => Promise<DomainRow | null>;
    };
  },
  vehicle_id: string,
  tipo: string,
  evento: Parameters<typeof odometro_tras_lecturas>[0]["evento"],
) {
  if (tipo !== "km" && tipo !== "horas") return;
  const lecturas = await ctx.data.findMany("lectura_uso", {
    where: { vehicle_id, tipo },
    limit: 500,
  });
  const vehicle = await ctx.data.findOne("vehicle", { id: vehicle_id });
  if (!vehicle) return;
  const field = tipo === "horas" ? "lectura_horas" : "lectura_km";
  const valor = odometro_tras_lecturas({
    hoy: today_iso(),
    actual: numero(vehicle[field]),
    lecturas,
    evento,
  });
  if (valor == null || valor === numero(vehicle[field])) return;
  await ctx.data.update("vehicle", { id: vehicle_id }, {
    [field]: valor,
    updated_at: now_iso(),
  });
}

export const lectura_uso_module = definir_recurso({
  resource: "lectura-uso",
  table: "lectura_uso",
  singular: "Lectura de uso",
  plural: "Lecturas de uso",
  order: 90,
  subtitle: "Kilómetros u horas del vehículo; la última lectura alimenta los recordatorios",
  columns: [
    { name: "vehicle_id", type: "text", notNull: true },
    { name: "tipo", type: "text", notNull: true },
    { name: "valor", type: "real", notNull: true },
    { name: "fecha", type: "text" },
  ],
  fields: {
    vehicle_id: { type: "string", required: true, search: true },
    tipo: { type: "string", required: true },
    valor: { type: "number", required: true },
    fecha: { type: "string" },
  },
  list: [
    { key: "fecha", label: "Fecha" },
    { key: "vehiculo", label: "Vehículo" },
    { key: "tipo", label: "Tipo" },
    { key: "valor", label: "Lectura" },
  ],
  form: [
    { name: "name", component: "input-text", label: "Nota corta", required: true },
    VEHICULO,
    {
      name: "tipo",
      component: "input-radio-buttons",
      label: "Tipo",
      required: true,
      options: [
        { value: "km", label: "Kilómetros" },
        { value: "horas", label: "Horas de motor" },
      ],
    },
    { name: "valor", component: "input-number", label: "Lectura", required: true, min: 0 },
    { name: "fecha", component: "input-date", label: "Fecha" },
    { name: "description", component: "input-textarea", label: "Observaciones" },
  ],
  hooks: {
    before_create(_ctx, row) {
      if (row.tipo !== "km" && row.tipo !== "horas") {
        throw new KirletHttpError(400, "validation_error", "la lectura es km u horas");
      }
      if (numero(row.valor) == null) {
        throw new KirletHttpError(400, "validation_error", "la lectura necesita un valor");
      }
      if (!row.fecha) row.fecha = new Date().toISOString().slice(0, 10);
      return row;
    },
    before_update(_ctx, _id, patch) {
      if ("tipo" in patch && patch.tipo !== "km" && patch.tipo !== "horas") {
        throw new KirletHttpError(400, "validation_error", "la lectura es km u horas");
      }
      if ("valor" in patch && numero(patch.valor) == null) {
        throw new KirletHttpError(400, "validation_error", "la lectura necesita un valor");
      }
      if ("fecha" in patch && patch.fecha != null && !fecha_iso(patch.fecha)) {
        throw new KirletHttpError(400, "validation_error", "la lectura necesita una fecha");
      }
      return patch;
    },
    async after_create(ctx, row) {
      await sincronizar_odometro(ctx, String(row.vehicle_id), String(row.tipo), { accion: "alta" });
    },
    async after_update(ctx, row, before) {
      const evento = { accion: "edicion" as const, valor_anterior: numero(before.valor) };
      await sincronizar_odometro(ctx, String(row.vehicle_id), String(row.tipo ?? before.tipo), evento);
      if (before.vehicle_id && before.vehicle_id !== row.vehicle_id) {
        await sincronizar_odometro(ctx, String(before.vehicle_id), String(before.tipo ?? row.tipo), {
          accion: "baja",
          valor_anterior: numero(before.valor),
        });
      }
      if (before.tipo && before.tipo !== row.tipo) {
        await sincronizar_odometro(ctx, String(before.vehicle_id ?? row.vehicle_id), String(before.tipo), {
          accion: "baja",
          valor_anterior: numero(before.valor),
        });
      }
    },
    async after_delete(ctx, row) {
      await sincronizar_odometro(ctx, String(row.vehicle_id), String(row.tipo), {
        accion: "baja",
        valor_anterior: numero(row.valor),
      });
    },
  },
});
