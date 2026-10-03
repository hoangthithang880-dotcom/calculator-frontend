/* 使用真实前后端和独立临时数据库，验证浏览器行为并生成实际运行截图。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');

const frontend = path.resolve(__dirname, '..');
const backend = path.resolve(frontend, '../calculator-backend');
const python = process.env.CALC_TEST_PYTHON || path.join(backend, '.venv/bin/python');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'calc-notes-test-'));
const screenshots = path.resolve(frontend, '../docs/screenshots');
const reportPath = path.resolve(frontend, '../docs/browser-test-results.json');
const backendUrl = 'http://127.0.0.1:15001';
const frontendUrl = 'http://127.0.0.1:18080';
const checks = [];
const errors = [];
let server;
let staticServer;
let browser;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitUntilReady(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await pause(100);
  }
  throw new Error(`服务未启动：${url}`);
}
async function assertFree(url) {
  try { await fetch(url); } catch { return; }
  throw new Error(`测试端口已被占用：${url}。请释放测试端口后重试。`);
}
function startBackend() {
  return spawn(python, ['-m', 'flask', '--app', 'src.app:create_app', 'run', '--host', '127.0.0.1', '--port', '15001'], {
    cwd: backend,
    env: {...process.env, DATABASE_PATH: path.join(temp, 'test.db'), CORS_ORIGINS: frontendUrl},
    stdio: 'ignore',
  });
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => { child.once('exit', resolve); child.kill('SIGTERM'); });
}
async function getHistory(query = '') {
  return (await fetch(`${backendUrl}/api/history${query}`)).json();
}
async function resultIs(page, text) {
  await page.waitForFunction((expected) => document.querySelector('#result').textContent === expected, text);
}
async function screenshot(page, name) {
  await page.screenshot({path: path.join(screenshots, `${name}.png`), fullPage: true});
}

(async () => {
  try {
    await assertFree(`${backendUrl}/api/health`);
    await assertFree(frontendUrl);
    fs.mkdirSync(screenshots, {recursive: true});
    server = startBackend();
    staticServer = spawn(python, ['-m', 'http.server', '18080', '--bind', '127.0.0.1', '--directory', frontend], {stdio: 'ignore'});
    await Promise.all([waitUntilReady(`${backendUrl}/api/health`), waitUntilReady(frontendUrl)]);
    browser = await chromium.launch({headless: true});
    const page = await browser.newPage({viewport: {width: 1280, height: 1050}, deviceScaleFactor: 1});
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript((url) => localStorage.setItem('calc-api-url', url), backendUrl);
    await page.goto(frontendUrl);
    await page.waitForFunction(() => document.querySelector('#connection').classList.contains('online'));
    await screenshot(page, '01-interface');
    const expression = page.locator('#expression');
    await expression.fill('12+8');
    await resultIs(page, '20');
    assert.equal((await getHistory()).total, 0);
    checks.push('实时预览请求后端，不保存记录');

    const cases = [
      ['12+8', '20', '02-addition'], ['8-3', '5', '03-subtraction'],
      ['7*8', '56', '04-multiplication'], ['7/2', '3.5', '05-division'],
      ['0.1+0.2', '0.3', '06-decimal'], ['1+2*3', '7', '07-precedence'],
      ['(1+2)*3', '9', '08-parentheses'], ['3*-2', '-6', '09-unary'],
      ['(2^3+sqrt(9))*50%', '5.5', '12-extensions'],
    ];
    for (const [text, expected, name] of cases) {
      await expression.fill(text);
      await resultIs(page, expected);
      const before = (await getHistory()).total;
      await page.locator('#calculate-button').click();
      await page.waitForFunction(() => document.querySelector('#message').classList.contains('success'));
      assert.equal((await getHistory()).total, before + 1);
      await page.waitForFunction(() => !document.querySelector('#calculate-button').disabled);
      await screenshot(page, name);
      checks.push(`${text} = ${expected}，数据库记录增加 1 条`);
    }

    const count = (await getHistory()).total;
    for (const [text, errorText, name] of [['1..2', '运算符', '10-invalid'], ['1/(2-2)', '不能除以零', '11-zero-division']]) {
      await expression.fill(text);
      await page.locator('#calculate-button').click();
      await page.waitForFunction((expected) => document.querySelector('#message').textContent.includes(expected), errorText);
      assert.equal((await getHistory()).total, count);
      await screenshot(page, name);
      checks.push(`${text} 明确报错，不写入数据库`);
    }

    await page.locator('[data-action="clear"]').click();
    for (const key of ['7', '×', '8']) await page.locator(`[data-insert="${key}"]`).click();
    await resultIs(page, '56');
    await expression.press('Enter');
    await page.waitForFunction(() => document.querySelector('#message').classList.contains('success'));
    await page.waitForFunction(() => !document.querySelector('#calculate-button').disabled);
    checks.push('按钮输入和 Enter 快捷键完成计算并保存');
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#history-count').textContent === '10 条记录');
    checks.push('刷新前端后，数据库历史仍存在');
    await page.locator('#next-page').click();
    await page.waitForFunction(() => document.querySelector('#page-label').textContent.includes('2 / 2'));
    assert.equal(await page.locator('.history-item').count(), 4);
    checks.push('历史分页');
    await page.locator('#history-search').fill('0.1');
    await page.waitForFunction(() => document.querySelector('#history-count').textContent === '1 条记录');
    await screenshot(page, '13-search');
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#export-button').click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), 'calculation-history.csv');
    checks.push('历史搜索与 CSV 导出');
    await page.locator('.history-reuse').click();
    assert.equal(await expression.inputValue(), '0.1+0.2');
    await resultIs(page, '0.3');
    checks.push('从历史记录复用完整算式');
    const id = await page.locator('.history-item').first().getAttribute('data-id');
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('.delete-button').first().click();
    await page.waitForFunction(() => document.querySelector('#history-count').textContent === '0 条记录');
    assert.equal((await getHistory()).items.some((item) => item.id === Number(id)), false);
    checks.push('单条删除实际移除数据库记录');
    await screenshot(page, '14-after-delete');
    await page.locator('#history-search').fill('');
    await page.waitForFunction(() => document.querySelector('#history-count').textContent === '9 条记录');

    await expression.fill('9'.repeat(128));
    assert.equal(await expression.inputValue(), '0.1+0.2');
    await expression.fill('12345678901234567890+12345');
    assert.ok(parseFloat(await expression.evaluate((element) => getComputedStyle(element).fontSize)) < 46);
    checks.push('输入过长被拒绝，适当长度会自动缩小字体');

    await page.route('**/api/preview', async (route) => {
      const response = await route.fetch();
      if (route.request().postDataJSON().expression === '1+1') await pause(700);
      await route.fulfill({response});
    });
    await expression.fill('1+1');
    await pause(320);
    await expression.fill('3+3');
    await resultIs(page, '6');
    await pause(750);
    assert.equal(await page.locator('#result').textContent(), '6');
    await page.unroute('**/api/preview');
    checks.push('较旧的预览响应不会覆盖新输入结果');

    await page.locator('#theme-button').click();
    await pause(2800); // 等待主题过渡和上一条提示消失，再截取稳定界面。
    assert.equal(await page.locator('.key.utility').first().evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(53, 71, 55)');
    await screenshot(page, '15-dark-theme');
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    checks.push('深浅主题切换及偏好持久化');
    await page.locator('#theme-button').click();
    await expression.fill('(12+3)×4');
    await resultIs(page, '60');
    await screenshot(page, '16-full-history');

    const mobile = await browser.newPage({viewport: {width: 390, height: 844}, deviceScaleFactor: 1});
    await mobile.addInitScript((url) => localStorage.setItem('calc-api-url', url), backendUrl);
    await mobile.goto(frontendUrl);
    await mobile.locator('#expression').fill('(12+3)×4');
    await resultIs(mobile, '60');
    assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await screenshot(mobile, '17-mobile');
    await mobile.close();
    checks.push('390px 手机布局无横向页面溢出');

    const persistedCount = (await getHistory()).total;
    await stop(server);
    server = startBackend();
    await waitUntilReady(`${backendUrl}/api/health`);
    assert.equal((await getHistory()).total, persistedCount);
    checks.push('重启后端进程后，SQLite 记录仍然存在');
    await stop(server);
    await expression.fill('9+9');
    await page.locator('#calculate-button').click();
    await page.waitForFunction(() => document.querySelector('#connection').classList.contains('offline'));
    assert.equal(await page.locator('#result').textContent(), '—');
    await screenshot(page, '18-backend-offline');
    checks.push('关闭后端后前端无法独立产生新计算结果');
    assert.deepEqual(errors, []);
    checks.push('浏览器无未处理的 JavaScript 错误');
    fs.writeFileSync(reportPath, JSON.stringify({passed: checks.length, checks, errors, completed_at: new Date().toISOString()}, null, 2));
    console.log(JSON.stringify({passed: checks.length, checks, screenshots}, null, 2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    await Promise.all([stop(server), stop(staticServer)]);
    fs.rmSync(temp, {recursive: true, force: true});
  }
})();
