import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [1332, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 950 } });
    let starts = 0, stopped = false, owner = true;
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    let prompts = 0;
    page.on('dialog', async dialog => { prompts++; await dialog.accept(); });
    await page.addInitScript(() => sessionStorage.setItem('max-booted', '1'));
    await page.route('**/health', r => r.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: { available: true, provider: 'test', model: 'test', modelLoaded: false } }));
    await page.route('**/docker', r => r.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: { reachable: true, engine: true, starting: false, canStart: owner,
      workers: [{ name: 'immich_pc_microservices', state: stopped ? 'exited' : 'running', health: stopped ? null : 'healthy' },
        { name: 'immich_machine_learning', state: 'running', health: 'healthy' }] } }));
    await page.route('**/docker/start', r => {
      if (r.request().method() === 'OPTIONS') return r.fulfill({ headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST' } });
      assert.deepEqual(r.request().postDataJSON(), { confirm: true });
      starts++;
      return r.fulfill({ status: 202, headers: { 'Access-Control-Allow-Origin': '*' }, json: { accepted: true } });
    });
    await page.goto('http://127.0.0.1:5173/');
    await page.getByRole('button', { name: 'ACCESS', exact: true }).click();
    await page.locator('.access-gateway').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: /Open M.A.X. console/ }).click();
    const button = page.getByRole('button', { name: '[ DOCKER ]', exact: true });
    await button.click();
    await page.getByText('Live PC worker status.', { exact: false }).waitFor();
    assert.equal(starts, 0);
    stopped = true;
    await button.click();
    await page.getByText('Start request accepted.', { exact: false }).waitFor();
    assert.equal(starts, 1);
    assert.equal(prompts, 1);
    await page.getByPlaceholder('Ask M.A.X.').fill('start PC workers');
    await page.getByPlaceholder('Ask M.A.X.').press('Enter');
    await page.waitForFunction(() => [...document.querySelectorAll('*')].filter(e => e.childElementCount === 0 && e.textContent.startsWith('Start request accepted.')).length >= 2);
    assert.equal(starts, 2);
    assert.equal(prompts, 1);
    owner = false;
    await button.click();
    await page.getByText('Connect Tailscale with the owner account', { exact: false }).waitFor();
    assert.equal(starts, 2);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: join(tmpdir(), `nilavus-docker-${width}.png`) });
    console.log(`Docker UI passed at ${width}px: status, automatic start, typed start, owner gate`);
    await page.close();
  }
} finally { await browser.close(); }
