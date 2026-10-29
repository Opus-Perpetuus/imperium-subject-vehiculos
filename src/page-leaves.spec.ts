import { describe, expect, test } from "bun:test";
import manifest from "../manifest.json";

type Item = { pageId?: string; children?: Item[] };

function menu_page_ids(items: readonly Item[]): string[] {
  return items.flatMap((item) => [
    ...(item.pageId ? [item.pageId] : []),
    ...menu_page_ids(item.children ?? []),
  ]);
}

describe("hojas del lanzador", () => {
  // Una página del menú sin `leaf` no entra al bootstrap y el shell la pinta como 404.
  test("cada página del menú publica su hoja", () => {
    const pages = new Map(
      (manifest.pages as Array<{ id: string; leaf?: unknown }>).map((page) => [page.id, page]),
    );
    const sin_hoja = menu_page_ids(manifest.menu as Item[]).filter((id) => !pages.get(id)?.leaf);
    expect(sin_hoja).toEqual([]);
  });
});
