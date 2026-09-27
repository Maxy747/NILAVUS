// Usage: node scripts/test-temperature-ui.mjs <path-to-playwright> [base-url]
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  for (const width of [1332, 390, 320]) {
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
    await page.route('**/disk-history', route => {
      const now = Date.now();
      return route.fulfill({ json: { generatedAt: new Date(now).toISOString(), nodes: Object.fromEntries(['Dosimeter', 'NASig', 'WD 1 TB', 'Bookussy'].map((name, n) => [name,
        Array.from({ length: 120 }, (_, i) => ({ sampled_at: new Date(now - (119 - i) * 60000).toISOString(), used_percent: [65, 8, 62, 92][n] + i / 1000 }))])) } });
    });
    await page.goto(process.argv[3] || 'http://127.0.0.1:5173/');
    await page.getByRole('button', { name: 'ACCESS', exact: true }).click();
    await page.locator('.access-gateway').waitFor({ state: 'detached' });
    for (const card of await page.locator('.health-card').all()) {
      await card.scrollIntoViewIfNeeded();
      await card.focus();
      await page.keyboard.down('Space');
      await page.waitForTimeout(450);
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
    const storage = page.locator('.storage-flip-card');
    await storage.scrollIntoViewIfNeeded();
    await storage.focus();
    await page.keyboard.down('Space');
    await page.waitForTimeout(500);
    assert.equal(await storage.locator('.temperature-trace').count(), 4);
    const storageBounds = await storage.boundingBox();
    const storageGraph = await storage.locator('.temperature-history').boundingBox();
    assert(storageGraph.x >= storageBounds.x && storageGraph.x + storageGraph.width <= storageBounds.x + storageBounds.width + 1);
    assert(storageGraph.y >= storageBounds.y && storageGraph.y + storageGraph.height <= storageBounds.y + storageBounds.height + 1);
    await page.screenshot({ path: join(tmpdir(), `nilavus-storage-flip-${width}.png`) });
    await page.keyboard.up('Space');
    await page.keyboard.press('Control+k');
    if (width < 760) await page.locator('.max-panel-toggle').click();
    await page.locator('.max-thermal-block').scrollIntoViewIfNeeded();
    assert(await page.locator('.max-thermal-block .temperature-trace').count() === 2);
    await page.getByRole('combobox', { name: 'History graph' }).selectOption('disk');
    await page.waitForFunction(() => document.querySelectorAll('.max-thermal-block .temperature-trace').length === 4);
    assert.equal(await page.locator('.max-thermal-block .temperature-legend small').count(), 4);
    await page.screenshot({ path: join(tmpdir(), `nilavus-temperature-max-${width}.png`) });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Open the secret NILAVUS about page' }).click();
    await page.getByRole('heading', { name: 'Meet M.A.X.' }).scrollIntoViewIfNeeded();
    assert(await page.getByRole('heading', { name: 'Meet M.A.X.' }).isVisible());
    await page.screenshot({ path: join(tmpdir(), `nilavus-about-max-${width}.png`) });
    assert.deepEqual(errors, []);
    console.log(`PASS: ${width}px, health/storage flips, raised labels, thermal/disk selector, no JS errors`);
    await page.close();
  }
} finally { await browser.close(); }
