# Vehículos

La app `subject-vehiculos` responde como servicio del kit y publica su
manifiesto. Queda probado que el proceso levantado es esta app y no otra.

## Sub-features

La app hace la acción de `manifiesto`. Escribe: no. Esta ficha no lleva línea
`Subject:` con imagen: el catálogo no da un tag para rellenarla. El hueco
está en `despliegue.md`.

- `manifiesto` deja un resultado observable: `GET /manifest` responde 200 y
  nombra `subject-vehiculos`.

### Archivos y contratos

- `src/subject.ts` — `define_subject` de `subject-vehiculos` (`SUBJECT-vehiculos`), sin `dependsOn`.
- `GET http://127.0.0.1:3218/health` y `GET http://127.0.0.1:3218/manifest`.

### Mapa

| id | ruta | rol semilla | pasos | esperado | muta | receta |
| --- | --- | --- | --- | --- | --- | --- |
| `subject-vehiculos.manifiesto` | `GET /manifest` | ninguno | Doctor en 0, pedir `GET /manifest` | 200 y `subject-vehiculos` | no | `arnes manifiesto` |

Base QA: sin asignar. Ninguna receta que muta entra al mapa hasta nombrarla.

## How to get to it (user POV)

- Menú raíz `Vehículos` (`vehiculos.root`) en la UI del núcleo.
- Cliente HTTP directo a `http://127.0.0.1:3218` tras `bun run local`.

## Driving it with arnes

Preconditions:

- Doctor en 0. Si falta `subject-vehiculos`, la receta sale `omitida`.

- **Abrir.** `GET /manifest`; el cuerpo nombra `subject-vehiculos`.
- **Proof.** `evidence/vehiculos/`.

## Gotchas

- Una receta de lectura que escribe sale en fallo aunque la pantalla se vea bien.
- Mutar solo contra una base QA nombrada en esta ficha; hoy no hay ninguna.
- `omitida` no cuenta como probada.
