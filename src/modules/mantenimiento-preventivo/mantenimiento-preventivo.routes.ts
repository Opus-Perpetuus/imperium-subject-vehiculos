import { estado_abierto } from "../../control.ts";
import { costo_valido, API, ESTADO_ABIERTO, VEHICULO, definir_recurso } from "../../recurso.ts";

export const mantenimiento_preventivo_module = definir_recurso({
  resource: "mantenimiento-preventivo",
  table: "mantenimiento_preventivo",
  singular: "Mantenimiento preventivo",
  plural: "Mantenimientos preventivos",
  order: 60,
  subtitle: "Trabajo programado para evitar la falla, abierto o cerrado",
  columns: [
    { name: "vehicle_id", type: "text", notNull: true },
    { name: "servicio_programado_id", type: "text" },
    { name: "fecha", type: "text" },
    { name: "trabajo_realizado", type: "text" },
    { name: "costo", type: "real" },
    { name: "estado", type: "text", notNull: true, default: "abierto" },
  ],
  fields: {
    vehicle_id: { type: "string", required: true, search: true },
    servicio_programado_id: { type: "string" },
    fecha: { type: "string" },
    trabajo_realizado: { type: "string", search: true },
    costo: { type: "number" },
    estado: { type: "string", search: true },
  },
  list: [
    { key: "fecha", label: "Fecha" },
    { key: "name", label: "Trabajo" },
    { key: "vehiculo", label: "Vehículo" },
    { key: "estado", label: "Estado" },
  ],
  form: [
    { name: "name", component: "input-text", label: "Título", required: true },
    VEHICULO,
    {
      name: "servicio_programado_id",
      component: "input-datalist",
      label: "Servicio programado",
      optionsSource: `${API}/servicio-programado?as=options&limite=1000`,
    },
    { name: "fecha", component: "input-date", label: "Fecha" },
    { name: "description", component: "input-textarea", label: "Qué se previene" },
    { name: "trabajo_realizado", component: "input-textarea", label: "Trabajo realizado" },
    { name: "costo", component: "input-money", label: "Costo" },
    ESTADO_ABIERTO,
  ],
  hooks: {
    before_create(_ctx, row) {
      costo_valido(row);
      row.estado = estado_abierto(row.estado);
      if (!row.fecha) row.fecha = new Date().toISOString().slice(0, 10);
      return row;
    },
    before_update(_ctx, _id, patch) {
      costo_valido(patch);
      if ("estado" in patch) patch.estado = estado_abierto(patch.estado);
      return patch;
    },
  },
});
