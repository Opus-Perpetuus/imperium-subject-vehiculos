import { fecha_iso } from "../../control.ts";
import { ESTADO_ABIERTO, VEHICULO, definir_recurso } from "../../recurso.ts";
import { KirletHttpError } from "@opus-perpetuus/imperium-core-kit";

export const documento_vehiculo_module = definir_recurso({
  resource: "documento-vehiculo",
  table: "documento_vehiculo",
  singular: "Documento del vehículo",
  plural: "Documentos del vehículo",
  order: 100,
  subtitle: "Seguro, tarjeta, verificación y otras vigencias que avisan antes de vencer",
  columns: [
    { name: "vehicle_id", type: "text", notNull: true },
    { name: "tipo", type: "text", notNull: true },
    { name: "folio", type: "text" },
    { name: "fecha_vencimiento", type: "text", notNull: true },
    { name: "aviso_dias", type: "real" },
    { name: "estado", type: "text", notNull: true, default: "abierto" },
  ],
  fields: {
    vehicle_id: { type: "string", required: true, search: true },
    tipo: { type: "string", required: true, search: true },
    folio: { type: "string", search: true },
    fecha_vencimiento: { type: "string", required: true, search: true },
    aviso_dias: { type: "number" },
    estado: { type: "string", search: true },
  },
  list: [
    { key: "name", label: "Documento" },
    { key: "vehiculo", label: "Vehículo" },
    { key: "tipo", label: "Tipo" },
    { key: "fecha_vencimiento", label: "Vence" },
    { key: "estado", label: "Estado" },
  ],
  form: [
    { name: "name", component: "input-text", label: "Nombre", required: true },
    VEHICULO,
    {
      name: "tipo",
      component: "input-radio-buttons",
      label: "Tipo",
      required: true,
      options: [
        { value: "seguro", label: "Seguro" },
        { value: "tarjeta", label: "Tarjeta de circulación" },
        { value: "verificacion", label: "Verificación" },
        { value: "licencia", label: "Licencia" },
        { value: "otro", label: "Otro" },
      ],
    },
    { name: "folio", component: "input-text", label: "Folio" },
    { name: "fecha_vencimiento", component: "input-date", label: "Vencimiento", required: true },
    { name: "aviso_dias", component: "input-number", label: "Avisar días antes", min: 0 },
    {
      ...ESTADO_ABIERTO,
      help: "Cerrado sale del listado de recordatorios.",
    },
    { name: "description", component: "input-textarea", label: "Notas" },
  ],
  hooks: {
    before_create(_ctx, row) {
      if (!fecha_iso(row.fecha_vencimiento)) {
        throw new KirletHttpError(400, "validation_error", "la vigencia necesita una fecha");
      }
      if (row.aviso_dias == null) row.aviso_dias = 30;
      if (!row.estado) row.estado = "abierto";
      return row;
    },
    before_update(_ctx, _id, patch) {
      if ("fecha_vencimiento" in patch && patch.fecha_vencimiento != null && !fecha_iso(patch.fecha_vencimiento)) {
        throw new KirletHttpError(400, "validation_error", "la vigencia necesita una fecha");
      }
      return patch;
    },
  },
});
