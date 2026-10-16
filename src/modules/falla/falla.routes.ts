import { estado_abierto } from "../../control.ts";
import { API, ESTADO_ABIERTO, VEHICULO, definir_recurso } from "../../recurso.ts";

export const falla_module = definir_recurso({
  resource: "falla",
  table: "falla",
  singular: "Reporte de falla",
  plural: "Reportes de falla",
  order: 40,
  subtitle: "Fallas del vehículo, abiertas o cerradas, ligadas o no a una bitácora",
  columns: [
    { name: "vehicle_id", type: "text", notNull: true },
    { name: "bitacora_id", type: "text" },
    { name: "concepto", type: "text" },
    { name: "prioridad", type: "text" },
    { name: "estado", type: "text", notNull: true, default: "abierto" },
    { name: "fecha", type: "text" },
    { name: "correctivo_id", type: "text" },
  ],
  fields: {
    vehicle_id: { type: "string", required: true, search: true },
    bitacora_id: { type: "string", search: true },
    concepto: { type: "string", search: true },
    prioridad: { type: "string", search: true },
    estado: { type: "string", search: true },
    fecha: { type: "string" },
    correctivo_id: { type: "string" },
  },
  list: [
    { key: "fecha", label: "Fecha" },
    { key: "name", label: "Falla" },
    { key: "vehicle_id", label: "Vehículo" },
    { key: "estado", label: "Estado" },
    { key: "prioridad", label: "Prioridad" },
  ],
  form: [
    { name: "name", component: "input-text", label: "Título", required: true },
    VEHICULO,
    {
      name: "bitacora_id",
      component: "input-datalist",
      label: "Bitácora",
      optionsSource: `${API}/bitacora?as=options&limite=1000`,
      help: "Si la falla salió de una revisión, elige esa bitácora del mismo vehículo.",
    },
    { name: "concepto", component: "input-text", label: "Concepto" },
    { name: "description", component: "input-textarea", label: "Descripción" },
    {
      name: "prioridad",
      component: "input-menu",
      label: "Prioridad",
      options: [
        { value: "baja", label: "Baja" },
        { value: "media", label: "Media" },
        { value: "alta", label: "Alta" },
      ],
    },
    ESTADO_ABIERTO,
    { name: "fecha", component: "input-date", label: "Fecha" },
    {
      name: "correctivo_id",
      component: "input-datalist",
      label: "Correctivo que la atiende",
      optionsSource: `${API}/mantenimiento-correctivo?as=options&limite=1000`,
      read_only: true,
    },
  ],
  hooks: {
    before_create(_ctx, row) {
      row.estado = estado_abierto(row.estado);
      if (!row.fecha) row.fecha = new Date().toISOString().slice(0, 10);
      if (!row.prioridad) row.prioridad = "media";
      return row;
    },
    before_update(_ctx, _id, patch) {
      if ("estado" in patch) patch.estado = estado_abierto(patch.estado);
      return patch;
    },
  },
});
