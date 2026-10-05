// Isolated browser harness: never served by Next.js or persisted as offers.
import assert from "node:assert/strict";
import React from "react";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { renderToStaticMarkup } from "react-dom/server";
import FlashDealsSection from "../src/components/flashDeals/FlashDealsSection";
import type { FlashDeal } from "../src/services/flashDeals/flashDeals";

async function main() {
  const output = path.join(tmpdir(), "ofertano-flash-deals");
  await mkdir(output, { recursive: true });
  const cssRoot = path.resolve(".next/static/chunks");
  const cssFiles = (await readdir(cssRoot)).filter(file => file.endsWith(".css"));
  assert.ok(cssFiles.length > 0, "Run npm run build first");
  const css = (await Promise.all(cssFiles.map(file => readFile(path.join(cssRoot, file), "utf8")))).join("\n");
  const icon = `data:image/svg+xml;base64,${Buffer.from(await readFile("src/app/icon.svg")).toString("base64")}`;
  const deals: FlashDeal[] = Array.from({ length: 6 }, (_, index) => ({
    id: `offline-${index}`, productId: "offline", title: "Produto de teste offline com um título longo para validar o espaço disponível",
    image: icon, currentPrice: index === 0 ? 12999.99 : 149.9,
    originalPrice: index === 0 ? null : 249.9, discountPercent: index === 0 ? null : 40,
    marketplace: "MERCADO_LIVRE", listingUrl: "https://example.invalid/offline",
    affiliateUrl: "https://example.invalid/offline", expiresAt: null,
    validUntil: new Date(Date.now() + 60000).toISOString(), available: true,
  }));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const results = [];
    for (const width of [360, 375, 390, 412, 430, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.setContent(`<!doctype html><html lang="pt-BR"><head><style>${css}</style></head><body style="margin:0;background:#f8fafc">${renderToStaticMarkup(<FlashDealsSection deals={deals} />)}</body></html>`);
      const metrics = await page.evaluate(() => {
        const section = document.querySelector("section")!;
        const rail = document.querySelector("ul")!;
        const price = document.querySelector("a p.whitespace-nowrap")!;
        const img = document.querySelector("img")!;
        return {
          viewport: window.innerWidth, document: document.documentElement.scrollWidth,
          sectionHeight: section.getBoundingClientRect().height,
          railWidth: rail.clientWidth, railScroll: rail.scrollWidth,
          imageWidth: img.getBoundingClientRect().width, imageHeight: img.getBoundingClientRect().height,
          priceFits: price.scrollWidth <= price.clientWidth,
          items: document.querySelectorAll("li").length,
        };
      });
      assert.equal(metrics.document, width, "No document horizontal overflow");
      assert.ok(metrics.sectionHeight < (width < 640 ? 230 : 270), "Compact height");
      assert.equal(metrics.imageWidth, 72);
      assert.equal(metrics.imageHeight, 72);
      assert.ok(metrics.priceFits, "Large price remains readable");
      assert.equal(metrics.items, 6);
      assert.ok(metrics.railScroll > metrics.railWidth, "Offers stay in a horizontal rail");
      await page.locator("ul").focus();
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(350);
      assert.ok(await page.locator("ul").evaluate(element => element.scrollLeft) > 0, "Keyboard scrolling works");
      await page.screenshot({ path: path.join(output, `flash-deals-${width}.png`) });
      results.push(metrics);
    }
    await page.setViewportSize({ width: 390, height: 900 });
    const timed = deals.map(deal => ({ ...deal, expiresAt: new Date(Date.now() + 3600000).toISOString() }));
    await page.setContent(`<!doctype html><style>${css}</style>${renderToStaticMarkup(<FlashDealsSection deals={timed} />)}`);
    assert.equal(await page.getByLabel("Tempo restante da promoção").count(), 6);
    await page.screenshot({ path: path.join(output, "flash-deals-timer-390.png") });
    await page.setContent(renderToStaticMarkup(<FlashDealsSection deals={[]} />));
    assert.equal(await page.locator("section").count(), 0);
    assert.deepEqual(errors, []);
    await writeFile(path.join(output, "results.json"), JSON.stringify(results, null, 2));
    if (process.argv[2]) {
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        const response = await page.goto(process.argv[2], { waitUntil: "domcontentloaded" });
        assert.equal(response?.status(), 200, "Integrated Home responds successfully");
        await page.getByRole("heading", { name: "Ofertas recentes", exact: true }).waitFor();
        await page.screenshot({ path: path.join(output, `home-${width}.png`), fullPage: true });
        const home = await page.evaluate(() => ({
          width: innerWidth, document: document.documentElement.scrollWidth,
          flashDealsVisible: document.querySelector("#flash-deals-heading") !== null,
        }));
        assert.equal(home.document, width, "Integrated Home has no horizontal overflow");
        console.log(JSON.stringify({ home }));
      }
      assert.deepEqual(errors, [], "No runtime page errors");
    }
    console.log(JSON.stringify({ status: "PASS", output, results }, null, 2));
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
