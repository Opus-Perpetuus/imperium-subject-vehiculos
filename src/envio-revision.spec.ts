import { describe, expect, test } from "bun:test";
import {
  OPCIONES_REVISION,
  ordenar_partidas_alarma,
  partida_en_alarma,
  normalizar_plantilla,
  bitacora_desde_plantilla,
  llenar_partidas,
  es_error,
  inferir_cliente,
  anexar_visita,
  texto_visitas,
  visita_desde_headers,
  type PartidaRevision,
} from "./control.ts";
import { create_kirlet_test_context, type KirletDefinition } from "@opus-perpetuus/imperium-core-kit";
import { SUBJECT } from "./subject.ts";

async function api(
  server: ReturnType<typeof create_kirlet_test_context>,
  method: string,
  path: string,
  body?: unknown,
  extra_headers?: Record<string, string>,
) {
  const headers: Record<string, string> = { ...(extra_headers ?? {}) };
  if (body) headers["content-type"] = "application/json";
  const res = await server.fetch(
    new Request(`http://vehiculos.test${path}`, {
      method,
      headers: Object.keys(headers).length ? headers : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
  const json = (await res.json().catch(() => ({}))) as {
    data?: any;
    message?: string;
    error?: string;
    mensaje?: string;
  };
  return { status: res.status, json };
}

describe("alarmas en partidas", () => {
  test("opción con alarma y forzada suben al firmar", () => {
    const plantilla = normalizar_plantilla([
      {
        concepto: "Frenos",
        opciones: [
          { value: "pasa", label: "Pasa" },
          { value: "falla", label: "Falla", alarma: true },
          { value: "na", label: "No aplica" },
        ],
        opcion_defecto: "na",
      },
      { concepto: "Llantas", opciones: [...OPCIONES_REVISION], opcion_defecto: "na" },
      {
        concepto: "Luces",
        opciones: [...OPCIONES_REVISION],
        opcion_defecto: "na",
      },
    ]);
    expect(es_error(plantilla)).toBe(false);
    if (es_error(plantilla)) return;
    expect(plantilla[0].opciones.find((o) => o.value === "falla")?.alarma).toBe(true);

    const base = bitacora_desde_plantilla(plantilla);
    expect(es_error(base)).toBe(false);
    if (es_error(base)) return;
    const llenas = llenar_partidas(base, [
      { ...base[0], resultado: "falla" },
      { ...base[1], resultado: "pasa" },
      { ...base[2], resultado: "pasa", alarma_forzada: true },
    ]);
    expect(es_error(llenas)).toBe(false);
    if (es_error(llenas)) return;
    expect(partida_en_alarma(llenas[0])).toBe(true);
    expect(partida_en_alarma(llenas[1])).toBe(false);
    expect(partida_en_alarma(llenas[2])).toBe(true);
    const orden = ordenar_partidas_alarma(llenas).map((p) => p.concepto);
    expect(orden).toEqual(["Frenos", "Luces", "Llantas"]);
  });
});

describe("envio a revisión", () => {
  test("interno y público, firma única del grupo", async () => {
    const server = create_kirlet_test_context(SUBJECT as KirletDefinition);
    try {
      const unidad = await api(server, "POST", "/vehicle", {
        name: "Unidad prueba",
        placas: "ALM-01",
      });
      expect(unidad.status).toBe(201);
      const plantilla = await api(server, "POST", "/plantilla-revision", {
        name: "Salida alarma",
        items: [
          {
            concepto: "Frenos",
            opciones: [
              { value: "pasa", label: "Pasa" },
              { value: "falla", label: "Falla", alarma: true },
              { value: "na", label: "No aplica" },
            ],
            opcion_defecto: "na",
          },
          { concepto: "Aceite", opciones: [...OPCIONES_REVISION], opcion_defecto: "na" },
        ],
      });
      expect(plantilla.status).toBe(201);
      const b1 = await api(server, "POST", "/bitacora", {
        name: "Bitácora A",
        vehicle_id: unidad.json.data.id,
        plantilla_id: plantilla.json.data.id,
        items: [
          {
            concepto: "Frenos",
            opciones: plantilla.json.data.items[0].opciones,
            opcion_defecto: "na",
            resultado: "falla",
          },
          {
            concepto: "Aceite",
            opciones: plantilla.json.data.items[1].opciones,
            opcion_defecto: "na",
            resultado: "pasa",
            alarma_forzada: true,
          },
        ],
      });
      expect(b1.status).toBe(201);
      const b2 = await api(server, "POST", "/bitacora", {
        name: "Bitácora B",
        vehicle_id: unidad.json.data.id,
        plantilla_id: plantilla.json.data.id,
      });
      expect(b2.status).toBe(201);

      const interno = await api(server, "POST", "/bitacora/enviar-revision", {
        bitacora_ids: [b1.json.data.id, b2.json.data.id],
        modo: "interno",
        usuario_id: "u-revisor",
        usuario_nombre: "Revisor",
      });
      expect(interno.status).toBe(201);
      expect(interno.json.data.modo).toBe("interno");
      const detalle = await api(server, "GET", `/envio-revision/${interno.json.data.id}`);
      expect(detalle.status).toBe(200);
      expect(detalle.json.data.bitacoras).toHaveLength(2);
      expect(detalle.json.data.bitacoras[0].items.map((i: {concepto:string}) => i.concepto).slice(0, 2)).toEqual([
        "Frenos",
        "Aceite",
      ]);
      expect(detalle.json.data.bitacoras[0].alarmas).toEqual(["Frenos", "Aceite"]);

      // b1 sigue en el envío interno pendiente: no se duplica.
      const repetido = await api(server, "POST", `/bitacora/${b1.json.data.id}/enviar-revision-publica`, {});
      expect(repetido.status).toBe(409);
      expect(String(repetido.json.message ?? repetido.json.error ?? "")).toContain("Bitácora A");
      const cancelado = await api(server, "POST", `/envio-revision/${interno.json.data.id}/cancelar`, {});
      expect(cancelado.status).toBe(200);

      const publico = await api(server, "POST", `/bitacora/${b1.json.data.id}/enviar-revision-publica`, {});
      expect(publico.status).toBe(201);
      expect(publico.json.data.modo).toBe("publico");
      expect(String(publico.json.data.share_hint)).toBe(`/revision-publica/${publico.json.data.id}`);
      expect(publico.json.compartir.ruta).toBe(`/revision-publica/${publico.json.data.id}`);
      expect(String(publico.json.compartir.texto)).toContain("firmar");

      const firma = await api(server, "POST", `/envio-revision/publico/${publico.json.data.id}/firmar`, {
        firma: "data:image/png;base64,aaa",
        firmante: "Visitante",
      });
      expect(firma.status).toBe(200);
      expect(firma.json.data.estado).toBe("firmado");
      const bit = await api(server, "GET", `/bitacora/${b1.json.data.id}`);
      expect(bit.json.data.revisada).toBe(true);
      expect(bit.json.data.firma_revisa).toBe("data:image/png;base64,aaa");
    } finally {
      server.stop();
    }
  });
});

describe("visitas al enlace público", () => {
  test("infiere dispositivo y sistema del user-agent", () => {
    expect(inferir_cliente("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)").dispositivo).toBe("móvil");
    expect(inferir_cliente("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)").sistema).toBe("iOS");
    expect(inferir_cliente("Mozilla/5.0 (Windows NT 10.0; Win64; x64)").sistema).toBe("Windows");
    expect(inferir_cliente("Mozilla/5.0 (Windows NT 10.0; Win64; x64)").dispositivo).toBe("escritorio");
  });

  test("anexa y resume visitas", () => {
    const headers = new Headers({
      "user-agent": "Mozilla/5.0 (Linux; Android 14; Mobile)",
      origin: "https://ejemplo.test",
      referer: "https://ejemplo.test/share",
    });
    const visita = visita_desde_headers(headers, "2026-10-26T15:00:00.000Z");
    expect(visita.dispositivo).toBe("móvil");
    expect(visita.sistema).toBe("Android");
    expect(visita.origen).toBe("https://ejemplo.test");
    const lista = anexar_visita([], visita);
    expect(lista).toHaveLength(1);
    expect(texto_visitas(lista)).toContain("móvil");
    expect(texto_visitas(lista)).toContain("Android");
  });

  test("abrir el enlace público registra visita; el detalle autenticado la muestra", async () => {
    const server = create_kirlet_test_context(SUBJECT as KirletDefinition);
    try {
      const unidad = await api(server, "POST", "/vehicle", {
        name: "Unidad visita",
        placas: "VIS-01",
      });
      expect(unidad.status).toBe(201);
      const plantilla = await api(server, "POST", "/plantilla-revision", {
        name: "Plantilla visita",
        conceptos: "Frenos",
      });
      expect(plantilla.status).toBe(201);
      const bit = await api(server, "POST", "/bitacora", {
        name: "Bit visita",
        vehicle_id: unidad.json.data.id,
        plantilla_id: plantilla.json.data.id,
      });
      expect(bit.status).toBe(201);
      const publico = await api(server, "POST", `/bitacora/${bit.json.data.id}/enviar-revision-publica`, {});
      expect(publico.status).toBe(201);
      const id = publico.json.data.id;

      const abierto = await api(
        server,
        "GET",
        `/envio-revision/publico/${id}`,
        undefined,
        {
          "user-agent": "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)",
          origin: "https://firmas.test",
          referer: "https://firmas.test/a",
        },
      );
      expect(abierto.status).toBe(200);
      expect(abierto.json.data.visitas).toBeUndefined();
      expect(abierto.json.data.estado).toBe("pendiente");

      const detalle = await api(server, "GET", `/envio-revision/${id}`);
      expect(detalle.status).toBe(200);
      expect(detalle.json.data.visitas).toHaveLength(1);
      expect(detalle.json.data.visitas[0].dispositivo).toBe("tableta");
      expect(detalle.json.data.visitas[0].sistema).toBe("iOS");
      expect(detalle.json.data.visitas[0].origen).toBe("https://firmas.test");
      expect(String(detalle.json.data.visitas_texto)).toContain("tableta");

      const firma = await api(server, "POST", `/envio-revision/publico/${id}/firmar`, {
        firma: "data:image/png;base64,bbb",
        firmante: "Ana",
      });
      expect(firma.status).toBe(200);
      expect(firma.json.data.estado).toBe("firmado");
      expect(firma.json.data.visitas).toBeUndefined();
    } finally {
      server.stop();
    }
  });
});

describe("partidas UI flags", () => {
  test("plantilla agrega abajo y bitácora expone forzar alarma", async () => {
    const server = create_kirlet_test_context(SUBJECT as KirletDefinition);
    try {
      const plantilla = await api(server, "GET", "/pages/vehiculos.plantilla-revision");
      expect(plantilla.status).toBe(200);
      const campo_p = (plantilla.json.page?.props?.form?.fields ?? []).find(
        (f: { name?: string }) => f.name === "items",
      );
      expect(campo_p?.partidas).toBe("plantilla");
      expect(campo_p?.partidas_agregar_abajo).toBe(true);
      expect(String(campo_p?.help ?? "").toLowerCase()).toContain("abajo");

      const bitacora = await api(server, "GET", "/pages/vehiculos.bitacora");
      expect(bitacora.status).toBe(200);
      const campo_b = (bitacora.json.page?.props?.form?.fields ?? []).find(
        (f: { name?: string }) => f.name === "items",
      );
      expect(campo_b?.partidas).toBe("bitacora");
      expect(String(campo_b?.help ?? "").toLowerCase()).toContain("forzar alarma");
    } finally {
      server.stop();
    }
  });
});

describe("envio UX form", () => {
  test("Nuevo envío pide bitácoras con selector y share_hint de detalle", async () => {
    const server = create_kirlet_test_context(SUBJECT as KirletDefinition);
    try {
      const page = await api(server, "GET", "/pages/vehiculos.envio-revision");
      expect(page.status).toBe(200);
      const fields = page.json.page?.props?.form?.fields ?? [];
      const bitacoras = fields.find((f: { name?: string }) => f.name === "bitacora_ids");
      expect(bitacoras?.component).toBe("input-checkbox-group");
      expect(String(bitacoras?.optionsSource ?? "")).toContain("bitacora");
      expect(String(bitacoras?.optionsSource ?? "")).toContain("as=options");
      const hint = fields.find((f: { name?: string }) => f.name === "share_hint");
      expect(hint?.read_only).toBe(true);
    } finally {
      server.stop();
    }
  });

  test("enviar revisión interna desde bitácora sin revisor queda pendiente de completar", async () => {
    const server = create_kirlet_test_context(SUBJECT as KirletDefinition);
    try {
      const unidad = await api(server, "POST", "/vehicle", { name: "U", placas: "UX-1" });
      expect(unidad.status).toBe(201);
      const plantilla = await api(server, "POST", "/plantilla-revision", {
        name: "P",
        conceptos: "Frenos",
      });
      expect(plantilla.status).toBe(201);
      const bit = await api(server, "POST", "/bitacora", {
        name: "B",
        vehicle_id: unidad.json.data.id,
        plantilla_id: plantilla.json.data.id,
      });
      expect(bit.status).toBe(201);
      const envio = await api(server, "POST", `/bitacora/${bit.json.data.id}/enviar-revision-interna`, {});
      expect(envio.status).toBe(201);
      expect(envio.json.data.modo).toBe("interno");
      expect(String(envio.json.data.usuario_id ?? "")).toBe("");
      expect(String(envio.json.mensaje ?? "").toLowerCase()).toContain("revisor");
    } finally {
      server.stop();
    }
  });
});

async function preparar(server: ReturnType<typeof create_kirlet_test_context>, n: number) {
  const unidad = await api(server, "POST", "/vehicle", { name: "U", placas: `M-${n}` });
  const plantilla = await api(server, "POST", "/plantilla-revision", { name: "P", conceptos: "Frenos" });
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const bit = await api(server, "POST", "/bitacora", {
      name: `Bit ${i + 1}`,
      vehicle_id: unidad.json.data.id,
      plantilla_id: plantilla.json.data.id,
    });
    expect(bit.status).toBe(201);
    ids.push(bit.json.data.id);
  }
  return ids;
}

describe("envíos masivos, duplicados y cancelación", () => {
  test("la lista declara acciones masivas en ambos listados", async () => {
    const server = create_kirlet_test_context(SUBJECT as KirletDefinition);
    try {
      const bit = await api(server, "GET", "/pages/vehiculos.bitacora");
      const lista = (bit.json.page?.props?.headerActions?.list ?? []).map((a: { id: string }) => a.id);
      expect(lista).toEqual([
        "enviar-revision-publica-masivo",
        "enviar-revision-interna-masivo",
        "cancelar-envios-masivo",
      ]);
      const env = await api(server, "GET", "/pages/vehiculos.envio-revision");
      expect((env.json.page?.props?.headerActions?.list ?? [])[0]?.id).toBe("cancelar-envios");
      const detail = (env.json.page?.props?.headerActions?.detail ?? []).map((a: { id: string }) => a.id);
      expect(detail).toContain("cancelar-envio");
    } finally {
      server.stop();
    }
  });

  test("masivo agrupa, salta las ocupadas y avisa; todas ocupadas es 409", async () => {
    const server = create_kirlet_test_context(SUBJECT as KirletDefinition);
    try {
      const [a, b, c] = await preparar(server, 3);
      const primero = await api(server, "POST", "/bitacora/enviar-revision-publica", { ids: [a, b] });
      expect(primero.status).toBe(201);
      expect(primero.json.data.bitacora_ids).toEqual([a, b]);
      expect(primero.json.compartir.ruta).toBe(`/revision-publica/${primero.json.data.id}`);

      const segundo = await api(server, "POST", "/bitacora/enviar-revision-interna", { ids: [a, c] });
      expect(segundo.status).toBe(201);
      expect(segundo.json.data.bitacora_ids).toEqual([c]);
      expect(segundo.json.omitidas.map((o: { id: string }) => o.id)).toEqual([a]);
      expect(String(segundo.json.mensaje)).toContain("Bit 1");
      expect(segundo.json.compartir.ruta).toMatch(/^\/internal\/envio-revision\/detail\/.+\//);

      const todas = await api(server, "POST", "/bitacora/enviar-revision-publica", { ids: [a, b, c] });
      expect(todas.status).toBe(409);

      // El alta por formulario tampoco duplica.
      const form = await api(server, "POST", "/envio-revision", {
        name: "Manual",
        modo: "publico",
        bitacora_ids: [b],
      });
      expect(form.status).toBe(409);
    } finally {
      server.stop();
    }
  });

  test("cancelar en masa libera las bitácoras; firmado no se cancela ni se reenvía", async () => {
    const server = create_kirlet_test_context(SUBJECT as KirletDefinition);
    try {
      const [a, b, c] = await preparar(server, 3);
      const e1 = await api(server, "POST", "/bitacora/enviar-revision-publica", { ids: [a] });
      const e2 = await api(server, "POST", "/bitacora/enviar-revision-publica", { ids: [b] });
      const e3 = await api(server, "POST", "/bitacora/enviar-revision-publica", { ids: [c] });
      const firmado = await api(server, "POST", `/envio-revision/publico/${e3.json.data.id}/firmar`, {
        firma: "data:image/png;base64,zz",
      });
      expect(firmado.status).toBe(200);

      const cancelar = await api(server, "POST", "/envio-revision/cancelar", {
        ids: [e1.json.data.id, e3.json.data.id],
      });
      expect(cancelar.status).toBe(200);
      expect(cancelar.json.data.cancelados).toEqual([e1.json.data.id]);
      expect(String(cancelar.json.mensaje)).toContain("firmado");

      const por_bitacora = await api(server, "POST", "/bitacora/cancelar-envios", { ids: [b] });
      expect(por_bitacora.status).toBe(200);
      expect(por_bitacora.json.data.cancelados).toEqual([e2.json.data.id]);

      const firmar_cancelado = await api(server, "POST", `/envio-revision/publico/${e1.json.data.id}/firmar`, {
        firma: "data:image/png;base64,zz",
      });
      expect(firmar_cancelado.status).toBe(409);

      const de_nuevo = await api(server, "POST", "/bitacora/enviar-revision-publica", { ids: [a, b, c] });
      expect(de_nuevo.status).toBe(201);
      expect(de_nuevo.json.data.bitacora_ids).toEqual([a, b]);
      expect(String(de_nuevo.json.mensaje)).toContain("ya fue revisada");
    } finally {
      server.stop();
    }
  });
});
