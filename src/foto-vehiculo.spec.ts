import { describe, expect, test } from "bun:test";
import { MemoryKirletDataClient, create_kirlet_test_context } from "@opus-perpetuus/imperium-core-kit";
import { SUBJECT } from "./subject.ts";
import { TABLA_FOTO, hash_foto, migrar_fotos } from "./foto-vehiculo.ts";

const PNG = `data:image/png;base64,${Buffer.from("foto-pesada-".repeat(2000)).toString("base64")}`;

function servidor() {
  const data = new MemoryKirletDataClient(SUBJECT.schema());
  return { data, server: create_kirlet_test_context(SUBJECT, { data }) };
}

async function pedir(server: ReturnType<typeof create_kirlet_test_context>, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return server.fetch(
    new Request(`http://vehiculos.test${path}`, {
      method,
      headers: body ? { "content-type": "application/json", ...headers } : headers,
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
}

describe("foto del vehículo fuera de la lista", () => {
  test("la lista no lleva base64 sino foto_url; el detalle trae la foto completa", async () => {
    const { server, data } = servidor();
    const creada = (await (await pedir(server, "POST", "/vehicle", { name: "Unidad 1", placas: "AAA-1", foto: PNG })).json()) as any;
    expect(creada.data.foto).toBe(PNG);
    const id = creada.data.id as string;
    const fila = await data.findOne("vehicle", { id });
    expect(fila?.foto).toBeNull();
    expect(fila?.foto_hash).toBe(hash_foto(PNG));

    const res = await pedir(server, "GET", "/vehicle");
    const texto = await res.text();
    expect(texto).not.toContain("base64");
    const lista = JSON.parse(texto) as any;
    const item = lista.data.find((r: any) => r.id === id);
    expect(item.foto).toBeUndefined();
    expect(item.foto_url).toBe(`/api/m/subject-vehiculos/vehicle/${id}/foto?v=${hash_foto(PNG)}`);

    const detalle = (await (await pedir(server, "GET", `/vehicle/${id}`)).json()) as any;
    expect(detalle.data.foto).toBe(PNG);
  });

  test("la foto se sirve en binario, cacheable por hash y con 304", async () => {
    const { server } = servidor();
    const id = ((await (await pedir(server, "POST", "/vehicle", { name: "U", foto: PNG })).json()) as any).data.id;
    const v = hash_foto(PNG);
    const res = await pedir(server, "GET", `/vehicle/${id}/foto?v=${v}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("foto-pesada-".repeat(2000));
    const otra = await pedir(server, "GET", `/vehicle/${id}/foto?v=${v}`, undefined, { "if-none-match": `"${v}"` });
    expect(otra.status).toBe(304);
    expect((await pedir(server, "GET", `/vehicle/no-existe/foto`)).status).toBe(404);
  });

  test("cambiar o quitar la foto actualiza o borra la guardada", async () => {
    const { server, data } = servidor();
    const id = ((await (await pedir(server, "POST", "/vehicle", { name: "U", foto: PNG })).json()) as any).data.id;
    const otra = PNG.replace("base64,", "base64,QQ");
    await pedir(server, "PATCH", `/vehicle/${id}`, { name: "U", foto: otra });
    expect((await data.findOne(TABLA_FOTO, { id }))?.hash).toBe(hash_foto(otra));
    // Guardar el formulario sin tocar nada: la foto sigue igual.
    await pedir(server, "PATCH", `/vehicle/${id}`, { name: "U2", foto: otra });
    expect((await data.findOne("vehicle", { id }))?.foto_hash).toBe(hash_foto(otra));
    await pedir(server, "PATCH", `/vehicle/${id}`, { foto: "" });
    expect(await data.findOne(TABLA_FOTO, { id })).toBeNull();
    const fila = await data.findOne("vehicle", { id });
    expect(fila?.foto_hash ?? null).toBeNull();
    expect(((await (await pedir(server, "GET", "/vehicle")).json()) as any).data.find((r: any) => r.id === id).foto_url).toBeNull();
  });

  test("la migración saca las fotos embebidas una sola vez y conserva URLs", async () => {
    const { data } = servidor();
    const ts = new Date().toISOString();
    await data.insert("vehicle", { id: "v1", name: "Vieja", is_active: true, foto: PNG, created_at: ts, updated_at: ts });
    await data.insert("vehicle", { id: "v2", name: "Con URL", is_active: true, foto: "https://x.test/a.jpg", created_at: ts, updated_at: ts });
    expect(await migrar_fotos(data)).toEqual({ migradas: 1 });
    expect(await migrar_fotos(data)).toEqual({ migradas: 0 });
    expect((await data.findOne("vehicle", { id: "v1" }))?.foto).toBeNull();
    expect((await data.findOne(TABLA_FOTO, { id: "v1" }))?.data).toBe(PNG);
    expect((await data.findOne("vehicle", { id: "v2" }))?.foto).toBe("https://x.test/a.jpg");
  });
});
