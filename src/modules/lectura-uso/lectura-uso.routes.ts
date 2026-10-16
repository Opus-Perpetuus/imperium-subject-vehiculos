import { KirletHttpError, now_iso } from "@opus-perpetuus/imperium-core-kit";
import { numero } from "../../control.ts";
import { VEHICULO, definir_recurso } from "../../recurso.ts";

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
    { key: "vehicle_id", label: "Vehículo" },
    { key: "tipo", label: "Tipo" },
    { key: "valor", label: "Lectura" },
  ],
  form: [
    { name: "name", component: "input-text", label: "Nota corta", required: true },
    VEHICULO,
    {
      name: "tipo",
      component: "input-menu",
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
    async after_create(ctx, row) {
      const field = row.tipo === "horas" ? "lectura_horas" : "lectura_km";
      await ctx.data.update("vehicle", { id: String(row.vehicle_id) }, {
        [field]: row.valor,
        updated_at: now_iso(),
      });
    },
  },
});
