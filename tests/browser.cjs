// Run with Playwright installed: node tests/browser.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const root = path.resolve(__dirname, '..');
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
    try { res.setHeader('Content-Type', types[path.extname(file)] || 'text/plain'); res.end(fs.readFileSync(file)); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, timezoneId: 'Asia/Tokyo' });
    await page.clock.setFixedTime(new Date('2026-10-14T12:00:00+09:00'));
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const base = `http://127.0.0.1:${server.address().port}`;
    const seed = async state => {
      await page.goto(base + '/control.html');
      await page.evaluate(state => localStorage.setItem('vschedule.v1', JSON.stringify(state)), state);
      await page.reload();
    };
    const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('vschedule.v1')));
    const previous = [{ t: '07:00', x: '朝活雑談' }, { t: '21:30', x: 'ゲーム配信' }];
    await seed({ start: '2026-10-14', days: 1, items: {
      '2026-09-29': previous, '2026-09-28': [], '2026-09-30': previous,
      '2026-10-07': previous, '2026-10-14': previous, '2026-12-01': previous
    } });
    let retained = (await read()).items;
    assert.equal(Object.hasOwn(retained, '2026-09-29'), false, 'history older than fourteen days is removed on load');
    assert.equal(Object.hasOwn(retained, '2026-09-28'), false, 'expired empty-day markers are also removed');
    assert.deepEqual(retained['2026-09-30'], previous, 'fourteen-day cutoff is inclusive');
    assert.deepEqual(retained['2026-12-01'], previous, 'future plans are retained');
    await page.clock.setFixedTime(new Date('2026-10-15T12:00:00+09:00'));
    await page.locator('.etext').first().fill('翌日の更新');
    assert.equal(Object.hasOwn((await read()).items, '2026-09-30'), false, 'saving prunes newly expired history');
    await page.clock.setFixedTime(new Date('2026-10-14T12:00:00+09:00'));
    await seed({ start: '2026-09-01', days: 2, items: {
      '2026-08-24': previous, '2026-08-25': previous, '2026-09-01': previous,
      '2026-09-02': [], '2026-09-30': previous
    } });
    retained = (await read()).items;
    assert.deepEqual(retained['2026-08-25'], previous, 'copy source for an old visible range is retained');
    assert.deepEqual(retained['2026-09-01'], previous, 'old visible plans are retained');
    assert.deepEqual(retained['2026-09-02'], [], 'visible empty date is retained');
    assert.equal(Object.hasOwn(retained, '2026-08-24'), false, 'unrelated expired history is removed');
    await seed({ start: '2026-10-14', days: 1, items: { '2026-10-08': previous } });
    await page.click('#next');
    assert.deepEqual((await read()).items['2026-10-15'], previous);
    await page.locator('[data-date="2026-10-15"] .etext').first().fill('コピー後の編集');
    assert.deepEqual((await read()).items['2026-10-08'], previous, 'copy must not share mutable entries');
    await page.locator('[data-date="2026-10-15"] .del').first().click();
    await page.locator('[data-date="2026-10-15"] .del').first().click();
    await page.click('#prev');
    await page.click('#next');
    assert.deepEqual((await read()).items['2026-10-15'], [], 'cleared date must not be copied again');
    await page.reload();
    await page.click('#prev');
    await page.click('#next');
    assert.deepEqual((await read()).items['2026-10-15'], [], 'empty date must survive reload');
    await seed({ start: '2026-12-31', days: 1, items: { '2026-12-25': previous, '2027-01-01': [{ t: '12:00', x: '入力済み' }] } });
    await page.click('#next');
    assert.equal((await read()).items['2027-01-01'][0].x, '入力済み');
    await seed({ start: '2026-12-31', days: 1, items: { '2026-12-25': previous } });
    await page.click('#next');
    assert.deepEqual((await read()).items['2027-01-01'], previous, 'copy across year boundary');
    await seed({ start: '2026-10-14', days: 7, items: { '2026-10-14': previous } });
    await page.click('#next');
    assert.deepEqual((await read()).items['2026-10-21'], previous, 'new tail of seven-day range');
    await seed({ start: '2026-10-14', days: 1, items: {} });
    await page.click('#next');
    assert.deepEqual((await read()).items['2026-10-15'], [], 'no previous week stays empty');

    await seed({ start: '2026-10-14', days: 1, items: { '2026-10-08': previous, '2026-10-09': [{ t: '12:00', x: '昼配信' }] } });
    await page.click('#dayUp');
    assert.deepEqual((await read()).items['2026-10-15'], previous, 'day-count increment copies previous week');
    await page.locator('#dayCount').fill('3');
    await page.locator('#dayCount').press('Tab');
    assert.equal((await read()).items['2026-10-16'][0].x, '昼配信', 'typed day-count expansion also copies');
    await page.locator('[data-date="2026-10-15"] .etext').first().fill('独立したコピー');
    assert.deepEqual((await read()).items['2026-10-08'], previous);
    await page.locator('[data-date="2026-10-15"] .del').first().click();
    await page.locator('[data-date="2026-10-15"] .del').first().click();
    await page.locator('#dayCount').fill('1');
    await page.locator('#dayCount').press('Tab');
    await page.reload();
    await page.locator('#dayCount').fill('3');
    await page.locator('#dayCount').press('Tab');
    assert.deepEqual((await read()).items['2026-10-15'], [], 'shrinking and expanding preserves a cleared date');
    assert.equal((await read()).items['2026-10-16'][0].x, '昼配信', 'existing tail is preserved');
    await seed({ start: '2026-12-31', days: 1, items: { '2026-12-25': previous, '2027-01-02': [] } });
    await page.locator('#dayCount').fill('4');
    await page.locator('#dayCount').press('Tab');
    assert.deepEqual((await read()).items['2027-01-01'], previous, 'day-count expansion across year boundary');
    assert.deepEqual((await read()).items['2027-01-02'], [], 'existing empty tail stays empty');
    assert.deepEqual((await read()).items['2027-01-03'], [], 'missing previous week stays empty');

    await seed({ start: '2026-10-14', days: 1, items: { '2026-10-14': previous } });
    const timeInput = page.locator('.pill').first();
    const titleLeft = await page.locator('.etext').first().evaluate(el => el.getBoundingClientRect().left);
    assert.equal(await page.locator('.time-control').first().evaluate(el => el.offsetWidth), 67);
    await timeInput.fill('713');
    await timeInput.press('Enter');
    assert.equal((await read()).items['2026-10-14'][0].t, '07:13', 'free minute typing is retained');
    const wheel = async (hour, deltaY) => timeInput.evaluate((el, args) => {
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: args.deltaY,
        clientX: args.hour ? rect.left + 5 : rect.right - 5, bubbles: true, cancelable: true }));
    }, { hour, deltaY });
    await wheel(true, -100);
    await wheel(false, -100);
    assert.equal((await read()).items['2026-10-14'][0].t, '08:18', 'hour and minute wheel use independent increments');
    await timeInput.fill('23:59');
    await timeInput.press('Enter');
    await wheel(true, -100);
    await wheel(false, -100);
    assert.equal(await timeInput.inputValue(), '23:59', 'wheel is bounded');
    await page.locator('.time-arrow').first().click();
    assert.equal(await page.locator('.time-picker select').first().locator('option').count(), 24);
    assert.equal(await page.locator('.time-picker select').last().locator('option').count(), 60);
    await page.locator('.time-picker select').first().selectOption('21');
    await page.locator('.time-picker select').last().selectOption('30');
    await page.locator('.time-picker-footer button').click();
    assert.equal((await read()).items['2026-10-14'][0].t, '21:30');
    await page.locator('.time-arrow').first().click();
    await page.locator('.time-picker select').last().selectOption('13');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.time-picker').count(), 0);
    assert.equal((await read()).items['2026-10-14'][0].t, '21:30', 'Escape discards unconfirmed selection');
    await timeInput.focus();
    await page.keyboard.press('Alt+ArrowDown');
    assert.equal(await page.locator('.time-picker').count(), 1);
    await page.locator('.etext').first().click();
    assert.equal(await page.locator('.time-picker').count(), 0, 'outside click dismisses picker');
    assert.equal(await page.locator('.etext').first().evaluate(el => el.getBoundingClientRect().left), titleLeft);
    assert.equal((await read()).items['2026-10-14'][0].x, previous[0].x, 'other entry data is unchanged');
    await page.setViewportSize({ width: 280, height: 250 });
    await page.locator('.time-arrow').first().click();
    const pickerBounds = await page.locator('.time-picker').evaluate(el => {
      const rect = el.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
    });
    assert.ok(pickerBounds, 'picker fits the narrow OBS dock');
    await page.keyboard.press('Escape');
    await page.reload();
    assert.equal(await timeInput.inputValue(), '21:30', 'chosen time persists');

    await page.setViewportSize({ width: 280, height: 900 });
    await page.click('#tab-conf');
    assert.equal(await page.locator('.tabs').evaluate(el => el.getBoundingClientRect().width < 130), true);
    await page.check('#autoWidth');
    assert.equal((await read()).autoWidth, true);
    assert.equal(await page.locator('#bgW').isDisabled(), true);
    await page.locator('#titleAlign').selectOption('center');
    await page.reload();
    await page.click('#tab-conf');
    assert.equal(await page.locator('#autoWidth').isChecked(), true);
    assert.equal(await page.locator('#titleAlign').inputValue(), 'center');
    await page.locator('#tab-conf').focus();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.locator('#tab-sched').getAttribute('aria-selected'), 'true');

    const long = '【長時間配信】みんなで冒険！新しい世界を探索するゲーム配信';
    const state = { start: '2026-10-20', days: 2, autoWidth: true, titleAlign: 'left', bgOn: true,
      bgFill: '#e00000', viewColor: '#ffffff', clockColor: '#e00000', bgBorder: false,
      items: { '2026-10-20': [{ t: '07:00', x: long }], '2026-10-21': [{ t: '21:00', x: '朝活雑談' }],
        '2026-11-01': [{ t: '00:00', x: long.repeat(10) }] } };
    await page.setViewportSize({ width: 1800, height: 900 });
    const snapshots = [];
    for (const theme of ['yoko', 'tate']) {
      for (const titleAlign of ['left', 'center']) {
        await seed({ ...state, theme, titleAlign });
        await page.goto(base + '/view.html');
        await page.evaluate(() => document.fonts.ready);
        await page.waitForFunction(() => [...document.querySelectorAll('schedule .text')].every(el => el.scrollWidth <= el.clientWidth));
        const result = await page.evaluate(() => {
          const titles = [...document.querySelectorAll('schedule .text')];
          const month = document.querySelector('.month').getBoundingClientRect();
          const day = document.querySelector('.day').getBoundingClientRect();
          return { widths: titles.map(el => el.clientWidth), scrolls: titles.map(el => el.scrollWidth), fits: titles.every(el => el.scrollWidth <= el.clientWidth),
            gap: day.left - month.right, card: document.querySelector('schedule').offsetWidth,
            bg: document.querySelector('.bgbox').offsetWidth, inner: document.querySelector('inner').offsetWidth };
        });
        assert.equal(result.fits, true, `${theme}: longest title must fit`);
        assert.equal(await page.locator('.text').first().evaluate(el => getComputedStyle(el).textAlign), titleAlign);
        assert.equal(result.widths[0], result.widths[1], 'all titles must use the same width');
        assert.ok(result.gap >= 0, 'month must not overlap day');
        assert.equal(result.bg, result.inner, 'auto background must fit shared content width');
        assert.ok(result.card < 1600, 'hidden dates must not affect auto width');
        if (theme === 'yoko') {
          const spacing = await page.evaluate(() => {
            const row = document.querySelector('.line');
            function textRect(selector) {
              const range = document.createRange();
              range.selectNodeContents(row.querySelector(selector));
              return range.getBoundingClientRect();
            }
            const month = textRect('.month'), day = textRect('.day'), dow = textRect('.dow');
            const time = textRect('.time'), title = textRect('.text');
            const clock = getComputedStyle(row.querySelector('.time'));
            const box = document.querySelector('.bgbox').getBoundingClientRect();
            return { monthDay: day.left - month.right, dayDow: dow.left - day.right,
              right: box.right - title.right, centerDifference: Math.abs((time.top + time.bottom - title.top - title.bottom) / 2),
              clockPadding: clock.padding, clockWeight: clock.fontWeight, clockMargins: [clock.marginTop, clock.marginBottom] };
          });
          assert.ok(Math.abs(spacing.monthDay - 3) < .1, 'selected month/day gap');
          assert.ok(Math.abs(spacing.dayDow - 10) < .1, 'selected day/weekday gap');
          assert.ok(spacing.right >= 30 && spacing.right < 32, 'selected trailing inset');
          assert.ok(spacing.centerDifference < .1, 'title and clock text vertical alignment');
          assert.equal(spacing.clockPadding, '2px 10px 0px');
          assert.equal(spacing.clockWeight, '700');
          assert.deepEqual(spacing.clockMargins, ['20px', '20px']);
        }
        if (theme === 'yoko') snapshots.push({ titleAlign, html: await page.content() });
        console.log(`PASS ${theme}/${titleAlign}`, result);
      }
    }
    await seed({ ...state, autoWidth: false });
    await page.goto(base + '/view.html');
    assert.equal(await page.locator('schedule').evaluate(el => el.offsetWidth), 880, 'manual mode retains fixed card');
    await seed({ ...state, start: '2026-11-01', days: 2, items: { '2026-11-01': [{ t: '07:00', x: '朝活雑談' }] } });
    await page.goto(base + '/view.html');
    await page.evaluate(() => document.fonts.ready);
    const singleDayGap = await page.locator('.line').first().evaluate(row => {
      const day = document.createRange(), dow = document.createRange();
      day.selectNodeContents(row.querySelector('.day'));
      dow.selectNodeContents(row.querySelector('.dow'));
      return dow.getBoundingClientRect().left - day.getBoundingClientRect().right;
    });
    assert.ok(Math.abs(singleDayGap - 10) < .1, 'one-digit day is equally close to weekday');
    await seed({ ...state, autoWidth: true, items: {} });
    await page.goto(base + '/view.html');
    assert.ok(await page.locator('schedule').evaluate(el => el.offsetWidth > 80));
    assert.deepEqual(errors, []);

    if (process.env.SAMPLE_DIR) {
      fs.mkdirSync(process.env.SAMPLE_DIR, { recursive: true });
      const sample = `<!doctype html><html lang="ja"><meta charset="utf-8"><title>タイトル揃えの比較</title>
        <style>body{background:#111318;color:#eef1f5;font:16px system-ui;margin:24px}h1{font-size:22px}h2{font-size:16px;margin:20px 0 8px}iframe{display:block;border:0;width:1550px;height:180px}p{color:#b9c2ce}</style>
        <h1>横幅：自動 — タイトル揃えの比較</h1><p>全予定で最長タイトルに合わせた同じ横幅。長い予定と短い予定を並べて比較。</p>
        ${snapshots.map(({ titleAlign, html }) => {
          const doc = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
            .replace(/<link\b[^>]*href="([^"]+)"[^>]*>/g, (_, href) => {
              const file = href.split('?')[0] === 'assets/skin/import.css' ? 'assets/skin/simple/style.css' : href.split('?')[0];
              return '<style>' + fs.readFileSync(path.join(root, file), 'utf8') + '</style>';
            })
            .replace('<head>', '<head><style>schedule .line.vsl{animation:none!important}schedule{height:240px!important}schedule inner{height:160px!important}schedule .bgbox{height:160px!important;top:40px!important}</style>');
          return `<h2>${titleAlign === 'left' ? '左揃え' : '中央揃え'}</h2><iframe style="height:240px" srcdoc="${doc.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"></iframe>`;
        }).join('')}`;
      fs.writeFileSync(path.join(process.env.SAMPLE_DIR, 'alignment-comparison.html'), sample);
      await page.setContent(sample);
      await page.evaluate(() => Promise.all([...document.querySelectorAll('iframe')].map(f => f.contentDocument.fonts.ready)));
      await page.screenshot({ path: path.join(process.env.SAMPLE_DIR, 'alignment-comparison.png'), fullPage: true });
    }
    console.log('All browser checks passed.');
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
