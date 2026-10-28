import type { KirletManifestLeaf } from "@opus-perpetuus/imperium-core-kit";

/** App Registry leaves: el runtime arma el manifiesto desde page decls, no del JSON estático. */
export const PAGE_LEAVES: Readonly<Record<string, KirletManifestLeaf>> = {
  "vehiculos.vehicle": {"kind": "crud", "appBase": "vehicle", "icon": "fa-bus", "listHeaders": {"es": {"placas": "Placas", "name": "Nombre", "numero_economico": "Número económico", "marca": "Marca", "modelo": "Modelo", "chofer_nombre": "Chofer", "estado_operativo": "Estado"}}},
  "vehiculos.plantilla-revision": {"kind": "crud", "appBase": "plantilla-revision", "icon": "fa-list-check", "listHeaders": {"es": {"name": "Nombre", "description": "Descripción"}}},
  "vehiculos.bitacora": {"kind": "crud", "appBase": "bitacora", "icon": "fa-book-open", "listHeaders": {"es": {"fecha": "Fecha", "name": "Título", "vehiculo": "Vehículo", "revisada": "Revisada"}}},
  "vehiculos.envio-revision": {"kind": "crud", "appBase": "envio-revision", "icon": "fa-file-signature", "listHeaders": {"es": {"name": "Título", "modo": "Modo", "usuario_nombre": "Revisor", "estado": "Estado", "firmado_at": "Firmado"}}},
  "vehiculos.falla": {"kind": "crud", "appBase": "falla", "icon": "fa-triangle-exclamation", "listHeaders": {"es": {"fecha": "Fecha", "name": "Falla", "vehiculo": "Vehículo", "estado": "Estado", "prioridad": "Prioridad"}}},
  "vehiculos.mantenimiento-correctivo": {"kind": "crud", "appBase": "mantenimiento-correctivo", "icon": "fa-wrench", "listHeaders": {"es": {"fecha": "Fecha", "name": "Trabajo", "vehiculo": "Vehículo", "estado": "Estado", "costo": "Costo"}}},
  "vehiculos.mantenimiento-preventivo": {"kind": "crud", "appBase": "mantenimiento-preventivo", "icon": "fa-shield-halved", "listHeaders": {"es": {"fecha": "Fecha", "name": "Trabajo", "vehiculo": "Vehículo", "estado": "Estado"}}},
  "vehiculos.servicio-programado": {"kind": "crud", "appBase": "servicio-programado", "icon": "fa-calendar-plus", "listHeaders": {"es": {"name": "Servicio", "vehiculo": "Vehículo", "proxima_fecha": "Próxima fecha", "proxima_lectura": "Próxima lectura", "estado": "Estado"}}},
  "vehiculos.recordatorios": {"kind": "crud", "appBase": "servicio-programado/recordatorios", "icon": "fa-bell", "listOnly": true, "listHeaders": {"es": {"estado": "Aviso", "clase": "Clase", "nombre": "Nombre", "vehiculo": "Vehículo", "proxima_fecha": "Fecha", "motivo": "Motivo"}}},
  "vehiculos.lectura-uso": {"kind": "crud", "appBase": "lectura-uso", "icon": "fa-gauge-high", "listHeaders": {"es": {"fecha": "Fecha", "vehiculo": "Vehículo", "tipo": "Tipo", "valor": "Lectura"}}},
  "vehiculos.documento-vehiculo": {"kind": "crud", "appBase": "documento-vehiculo", "icon": "fa-file-contract", "listHeaders": {"es": {"name": "Documento", "vehiculo": "Vehículo", "tipo": "Tipo", "fecha_vencimiento": "Vence", "estado": "Estado"}}},
};

export function leaf_for(page_id: string): KirletManifestLeaf | undefined {
  return PAGE_LEAVES[page_id];
}

