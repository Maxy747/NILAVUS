// Usage: node scripts/test-temperature-ui.mjs <path-to-playwright> [base-url]
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  for (const width of [1332, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/temperature-history', route => {
      const now = Date.now();
      const nodes = Object.fromEntries(['nilavus', 'nilavus-storage'].map((name, n) => [name,
        Array.from({ length: 1440 }, (_, i) => ({ sampled_at: new Date(now - (1439 - i) * 60000).toISOString(), temperature_c: 45 + n * 10 + Math.sin(i / 20) * 8 }))
          .filter((_, i) => i < 650 || i > 800)]));
      return route.fulfill({ json: { nodes, generatedAt: new Date(now).toISOString() } });
    });
    await page.goto(process.argv[3] || 'http://127.0.0.1:5173/');
    await page.getByRole('button', { name: 'ACCESS', exact: true }).click();
    await page.locator('.access-gateway').waitFor({ state: 'detached' });
    for (const card of await page.locator('.health-card').all()) {
      await card.scrollIntoViewIfNeeded();
      await card.focus();
      await page.keyboard.down('Space');
      await card.locator('.temperature-trace').first().waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll('.health-card-held .temperature-trace')].some(p => (p.getAttribute('d') || '').length > 100));
      const bounds = await card.boundingBox();
      const graph = await card.locator('.temperature-history').boundingBox();
      const egg = await card.locator('.health-back > span').boundingBox();
      assert(graph.x >= bounds.x && graph.x + graph.width <= bounds.x + bounds.width + 1);
      assert(graph.y + graph.height <= egg.y + 1);
      assert(egg.y + egg.height <= bounds.y + bounds.height + 1);
      await page.screenshot({ path: join(tmpdir(), `nilavus-temperature-card-${width}.png`) });
      await page.keyboard.up('Space');
    }
    await page.keyboard.press('Control+k');
    if (width < 760) await page.locator('.max-panel-toggle').click();
    await page.locator('.max-thermal-block').scrollIntoViewIfNeeded();
    assert(await page.locator('.max-thermal-block .temperature-trace').count() === 2);
    await page.screenshot({ path: join(tmpdir(), `nilavus-temperature-max-${width}.png`) });
    assert.deepEqual(errors, []);
    console.log(`PASS: ${width}px, both cards, Easter eggs, two-line M.A.X. graph, no JS errors`);
    await page.close();
  }
} finally { await browser.close(); }
