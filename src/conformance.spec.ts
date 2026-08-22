import { describe, expect, test } from "bun:test";
import {
  assert_kirlet_conformance,
  create_kirlet_test_context,
} from "@opus-perpetuus/imperium-core-kit";
import { join } from "node:path";
import { SUBJECT } from "./subject.ts";

describe("subject-vehiculos conformance", () => {
  test("layout + manifest", () => {
    assert_kirlet_conformance({
      definition: SUBJECT,
      src_dir: join(import.meta.dir),
    });
  });

  test("health and CRUD", async () => {
    const server = create_kirlet_test_context(SUBJECT);
    const h = await server.fetch(new Request("http://t/health"));
    expect(h.status).toBe(200);
    const c = await server.fetch(
      new Request("http://t/vehicle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "A" }),
      }),
    );
    expect(c.status).toBe(201);
    const menu = SUBJECT.manifest().menu ?? [];
    expect(menu.length).toBeGreaterThan(0);
    server.stop();
  });
});
