'use strict';
/*
 * Uçtan uca arayüz testi (Plan §14 arayüz maddeleri) — Playwright + Chromium.
 * Sayfa doGet() çıktısından üretilir; google.script.run çağrıları Node'da
 * çalışan gerçek Code.gs'e (sahte E-Tablo üzerinde) köprülenir.
 *
 * Çalıştırma:  NODE_PATH="$(npm root -g)" node --test tests/ui.e2e.js
 * Ekran görüntüleri: SHOT_DIR ortam değişkeni verilirse oraya yazılır.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadCode } = require('./harness');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  test('ui.e2e', { skip: 'playwright bulunamadı (NODE_PATH="$(npm root -g)" ile çalıştırın)' }, () => {});
  return;
}

const APP = 'https://app.test/';
const SHOT_DIR = process.env.SHOT_DIR || '';
const DESKTOP = { width: 1024, height: 900 };
const MOBILE = { width: 360, height: 740 };

const MOCK_RUN = `<script>
(function () {
  function runner(ok, fail) {
    return new Proxy({}, { get: function (_, fn) {
      if (fn === 'withSuccessHandler') return function (f) { return runner(f, fail); };
      if (fn === 'withFailureHandler') return function (f) { return runner(ok, f); };
      if (fn === 'withUserObject') return function () { return runner(ok, fail); };
      return function () {
        var args = Array.prototype.slice.call(arguments);
        window.__gsrun(String(fn), JSON.stringify(args)).then(function (raw) {
          var r = JSON.parse(raw);
          setTimeout(function () { if (r.fail) { if (fail) fail(new Error(r.fail)); } else if (ok) { ok(r.value); } }, 20);
        });
      };
    } });
  }
  window.google = { script: { run: runner(null, null) } };
})();
</script>`;

/** Sunucu: aynı sahte e-tablo; "yeniden dağıtım" ile oturum değiştirilebilir. */
function makeServer(session) {
  const server = { g: loadCode({ session }), calls: [], failNext: {}, failAfterServer: {} };
  server.g.ctx.initializeDatabase();
  server.redeploy = (s) => { server.g = loadCode({ session: s, env: server.g.env }); };
  server.rows = (name) => server.g.env.ss.getSheetByName(name).rowObjects();
  return server;
}

let browser;
test.before(async () => { browser = await chromium.launch(); });
test.after(async () => { if (browser) await browser.close(); });

async function openPage(server, viewport = DESKTOP) {
  const page = await browser.newPage({ viewport });
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  await page.exposeFunction('__gsrun', async (fn, argsJson) => {
    server.calls.push(fn);
    if (server.failNext[fn]) {
      const msg = server.failNext[fn];
      delete server.failNext[fn];
      return JSON.stringify({ fail: msg });
    }
    const res = server.g.ctx[fn](...JSON.parse(argsJson));
    if (server.failAfterServer[fn]) {
      const msg = server.failAfterServer[fn];
      delete server.failAfterServer[fn];
      return JSON.stringify({ fail: msg });
    }
    return JSON.stringify({ value: res === undefined ? null : JSON.parse(JSON.stringify(res)) });
  });
  const html = server.g.ctx.doGet().getContent().replace('<head>', '<head>' + MOCK_RUN);
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url === APP) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    if (url.startsWith(APP)) return route.fulfill({ status: 404, body: 'yok' });
    return route.abort();
  });
  await page.goto(APP);
  return page;
}

const visible = (page, sel) => page.locator(sel).isVisible();
const text = (page, sel) => page.locator(sel).innerText();
async function shot(page, name) {
  if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, name + '.png'), fullPage: true });
}
async function noHorizontalScroll(page) {
  const w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, vw: window.innerWidth }));
  assert.ok(w.doc <= w.vw, `yatay kaydırma var: ${w.doc} > ${w.vw}`);
}
async function beforeUnloadBlocked(page) {
  return page.evaluate(() => {
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
}
async function waitIdle(page) { await page.waitForSelector('#loading', { state: 'hidden' }); }

async function login(page, uid, honor = true) {
  await page.fill('#uid', uid);
  if (honor) await page.check('#honor');
  await page.click('#btnStart');
  await waitIdle(page);
}

/** Bir vakayı yanıtlar: answers = 8 karakterlik 'N'/'A' dizisi, triage = kod. */
async function answerCase(page, answers, triage) {
  const fields = ['user_pat_appearance', 'user_pat_work_of_breathing', 'user_pat_circulation_to_skin',
    'user_temperature_classification', 'user_heart_rate_classification', 'user_respiratory_rate_classification',
    'user_blood_pressure_classification', 'user_spo2_classification'];
  for (let i = 0; i < fields.length; i++) {
    await page.click(`label[for="f_${fields[i]}_${answers[i] === 'A' ? 1 : 0}"]`);
  }
  if (triage) await page.click(`label[for="tri_${triage}"]`);
}
async function submit(page) { await page.click('#btnSubmit'); await waitIdle(page); }

test('masaüstü: giriş → 3 vaka → toplu geri bildirim (T11, T14–T18, T28, T31, T32, T34, T35)', async () => {
  const server = makeServer(1);
  const page = await openPage(server);

  // Giriş ekranı
  assert.equal(await text(page, '#headerMeta'), 'Aktif oturum: 1 / 5');
  assert.equal(await text(page, '#loginStrip'), 'Aktif oturum: 1 / 5');
  assert.equal(await text(page, '#screen-login h1'), 'Çalışma Girişi');
  assert.equal(await page.locator('#screen-login input').count(), 2, 'yalnızca katılımcı kodu + onur beyanı (T14)');
  assert.ok(await visible(page, '#honor'));

  await page.click('#btnStart');
  assert.equal(await text(page, '#loginError'), 'Lütfen katılımcı kodunuzu girin.');
  await page.fill('#uid', 'p-014');
  await page.click('#btnStart');
  assert.equal(await text(page, '#loginError'), 'Başlamadan önce onur beyanını onaylamanız gerekmektedir.');
  assert.deepEqual(server.calls, [], 'istemci doğrulaması sunucuya gitmeden çalışır');
  await page.check('#honor');
  await page.click('#btnStart');
  await waitIdle(page);

  // Vaka 1 (CASE-001)
  assert.ok(await visible(page, '#screen-case'));
  assert.equal(await text(page, '#headerMeta'), 'Katılımcı P-014 · Oturum 1/5 · Vaka 1/3');
  const caseText = await page.locator('#screen-case').innerText();
  ['38,4 °C', '115/dk', '24/dk', '98/60 mmHg', '%99', '4 yaş', 'Kız', '1 gündür sağ kulak ağrısı ve ateş'].forEach((s) => {
    assert.ok(caseText.includes(s), s);
  });
  const seeds = JSON.parse(JSON.stringify(server.g.ctx.seedCases_()));
  const dom = await page.content();
  seeds.forEach((c) => {
    [c.case_title, c.triage_feedback, c.appearance_feedback, c.vital_signs_feedback].forEach((secret) => {
      assert.ok(!dom.includes(secret), 'DOM sızıntısı: ' + secret.slice(0, 40));
    });
  });
  const cols = await page.$eval('.triage-grid', (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  assert.equal(cols, 3);
  assert.deepEqual(await page.locator('.tri-name').allInnerTexts(), ['Kırmızı Alan', 'Sarı Alan', 'Yeşil Alan']);

  assert.equal(await beforeUnloadBlocked(page), false, 'seçim yokken çıkış uyarısı yok');
  assert.ok(await page.locator('#btnSubmit').isDisabled());
  await answerCase(page, 'NNNANNNN', null);
  assert.ok(await page.locator('#btnSubmit').isDisabled(), 'triyaj seçilmeden pasif (T16)');
  assert.ok(await visible(page, '#submitHint'));
  assert.equal(await beforeUnloadBlocked(page), true, 'T35');
  await page.click('label[for="tri_YESIL"]');
  assert.ok(await page.locator('#btnSubmit').isEnabled());
  assert.equal(await visible(page, '#submitHint'), false);
  await shot(page, 'desktop-case1');
  await submit(page);

  assert.equal(await text(page, '#savedCard .saved-title'), '✓ Vaka 1 / 3 kaydedildi.');
  assert.equal(await page.locator('#screen-case .tag').count(), 0, 'doğruluk bilgisi gösterilmez (T17)');
  assert.doesNotMatch(await page.locator('#screen-case').innerText(), /Yanlış|Tam uyum|Referans:|basamak/);
  assert.ok(await page.locator('#f_user_pat_appearance_0').isDisabled());
  assert.equal(await visible(page, '#submitCard'), false);
  assert.equal(await beforeUnloadBlocked(page), false);
  await page.click('#btnNext');

  // Vaka 2 (CASE-002, KIRMIZI) — ağ hatası ve yanıtı kaybolan gönderim
  assert.equal(await text(page, '#headerMeta'), 'Katılımcı P-014 · Oturum 1/5 · Vaka 2/3');
  assert.equal(await page.locator('.progress .dot.done').count(), 1);
  await answerCase(page, 'AAAAAANA', 'YESIL');   // tehlikeli düşük triyaj
  server.failNext.submitCase = 'Ağ bağlantısı koptu';
  await submit(page);
  assert.equal(await text(page, '#caseError'), 'Bağlantı hatası: Ağ bağlantısı koptu — lütfen tekrar deneyin.');
  assert.ok(await page.locator('#btnSubmit').isEnabled(), 'düğme yeniden etkin');
  assert.equal(await page.locator('#screen-case input[type=radio]:checked').count(), 9, 'yanıtlar korunur');
  assert.equal(server.rows('Session1').length, 1);

  server.failAfterServer.submitCase = 'Zaman aşımı';
  await submit(page);
  assert.match(await text(page, '#caseError'), /^Bağlantı hatası: Zaman aşımı/);
  assert.equal(server.rows('Session1').length, 2, 'ilk deneme sunucuya ulaştı');
  await submit(page);   // → E_DUPLICATE → başarı yolu
  assert.equal(await text(page, '#savedCard .saved-title'), '✓ Vaka 2 / 3 kaydedildi.');
  assert.equal(server.rows('Session1').length, 2, 'ikinci satır yazılmadı');

  // Sayfa yenilenir, aynı kodla giriş → doğrudan Vaka 3 (T18)
  await page.close();
  const page2 = await openPage(server);
  await login(page2, 'P-014');
  assert.equal(await text(page2, '#headerMeta'), 'Katılımcı P-014 · Oturum 1/5 · Vaka 3/3');
  assert.ok((await page2.locator('#screen-case').innerText()).includes('Bisikletten düşme sonrası sol önkolda ağrı'));
  await answerCase(page2, 'NNNNANNA', 'KIRMIZI');   // SpO2 yanlış, yüksek triyaj
  await submit(page2);

  // Toplu geri bildirim (T28, T32)
  await page2.waitForSelector('#screen-summary:not([hidden])');
  assert.equal(await text(page2, '#headerMeta'), 'Katılımcı P-014 · Oturum 1/5 · Tamamlandı');
  assert.equal(await text(page2, '#summaryContent h1'), 'Oturum 1 · Toplu Geri Bildirim');
  const boxes = await page2.locator('.summary-box').allInnerTexts();
  assert.deepEqual(boxes.map((b) => b.split('\n')[0]), ['Triyaj kategorisi', 'PDÜ', 'Vital bulgular', 'Toplam süre']);
  assert.match(boxes[0], /1 \/ 3$/);
  assert.match(boxes[1], /9 \/ 9$/);
  assert.match(boxes[2], /14 \/ 15$/);
  assert.match(boxes[3], /\d+ dk \d+ sn$/);
  assert.equal(await text(page2, '.notice.danger'), 'Bu oturumda 1 Kırmızı alan vakası Sarı/Yeşil alana atandı (tehlikeli düşük triyaj).');
  assert.deepEqual(await page2.locator('.case-fb h2').allInnerTexts(), [
    'Vaka 1 · Ateşli kulak ağrısı (akut otitis media şüphesi)',
    'Vaka 2 · Devam eden ateşli konvülziyon (status epileptikus)',
    'Vaka 3 · Düşme sonrası önkol deformitesi (kapalı deplase kırık şüphesi)'
  ]);
  const card2 = await page2.locator('.case-fb').nth(1).innerText();
  assert.match(card2, /Sizin kararınız: Yeşil Alan/);
  assert.match(card2, /Referans: Kırmızı Alan/);
  assert.match(card2, /2 basamak düşük triyaj/);
  assert.match(card2, /Tehlikeli düşük triyaj/);
  const card3 = await page2.locator('.case-fb').nth(2).innerText();
  assert.match(card3, /1 basamak yüksek triyaj/);
  assert.match(card3, /SpO₂\s+%99\s+Anormal\s+Normal\s+Yanlış/);
  assert.match(await page2.locator('.case-fb').nth(0).innerText(), /Tam uyum/);
  assert.match(await page2.locator('#summaryContent').innerText(),
    /Oturum 1 tamamlandı\. Yanıtlarınız kaydedildi\. Bir sonraki oturum araştırmacı tarafından duyurulacaktır\./);
  assert.equal(await beforeUnloadBlocked(page2), false);
  await shot(page2, 'desktop-summary');

  const viewed = server.rows('Session1');
  assert.ok(viewed.every((r) => r.feedback_viewed === 1 && r.feedback_viewed_time));

  // Tamamlamış katılımcı yeniden girer → doğrudan özet (T31)
  const page3 = await openPage(server);
  await login(page3, 'p-014');
  await page3.waitForSelector('#screen-summary:not([hidden])');
  assert.equal(await page3.locator('.case-fb').count(), 3);

  assert.deepEqual([...page2.errors, ...page3.errors], []);
  await page2.close();
  await page3.close();
});

test('mobil 360 px: yatay kaydırma yok, triyaj tek sütun (T33)', async () => {
  const server = makeServer(4);
  const page = await openPage(server, MOBILE);
  await noHorizontalScroll(page);
  await shot(page, 'mobile-login');
  await login(page, 'P-360');
  await noHorizontalScroll(page);
  const cols = await page.$eval('.triage-grid', (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  assert.equal(cols, 1);
  const stripe = await page.$eval('label[for="tri_KIRMIZI"]', (el) => getComputedStyle(el).borderLeftWidth);
  assert.equal(stripe, '6px');
  await answerCase(page, 'NNNAANNN', 'SARI');
  await shot(page, 'mobile-case');
  await submit(page);
  await page.click('#btnNext');
  await answerCase(page, 'ANNNNNNN', 'KIRMIZI');
  await submit(page);
  await page.click('#btnNext');
  await answerCase(page, 'NNNNNNNN', 'YESIL');
  await submit(page);
  await page.waitForSelector('#screen-summary:not([hidden])');
  await noHorizontalScroll(page);
  assert.equal(await page.locator('.notice.danger').count(), 0);
  assert.equal(await page.locator('.fb-table .col-value').first().isVisible(), false, 'Değer sütunu mobilde satır içine taşınır');
  const wrapped = await page.$$eval('.fb-table tbody td + td', (cells) => cells
    .filter((td) => td.offsetParent !== null)
    .filter((td) => {
      // Metin düğümlerinin satır kutularının farklı üst koordinat sayısı = satır sayısı.
      const tops = new Set();
      const walker = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const r = document.createRange();
        r.selectNodeContents(n);
        Array.from(r.getClientRects()).forEach((rect) => tops.add(Math.round(rect.top)));
      }
      return tops.size > 1;
    })
    .map((td) => td.innerText));
  assert.deepEqual(wrapped, [], 'Normal/Anormal/Doğru/Yanlış hücreleri kelime ortasından kırılmamalı');
  await shot(page, 'mobile-summary');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('kapalı oturum, yapılandırma hatası ve son oturum kapanış metni (T06, T08)', async () => {
  const closed = await openPage(makeServer(0));
  assert.ok(await visible(closed, '#screen-closed'));
  assert.equal(await text(closed, '#headerMeta'), 'Aktif oturum yok');
  assert.equal(await text(closed, '#closedMsg'),
    'Şu anda aktif bir oturum bulunmamaktadır. Oturum açıldığında araştırmacı tarafından bilgilendirileceksiniz.');
  await closed.close();

  const broken = await openPage(makeServer('7'));
  assert.ok(await visible(broken, '#screen-config-error'));
  assert.equal(await text(broken, '#configMsg'), 'Yapılandırma hatası: CURRENT_SESSION 0 ile 5 arasında bir tam sayı olmalıdır.');
  await broken.close();

  // Sayfa açıkken araştırmacı oturumu kapatırsa: giriş → kapalı ekranı
  const server = makeServer(5);
  const page = await openPage(server);
  server.redeploy(0);
  await login(page, 'P-1');
  assert.ok(await visible(page, '#screen-closed'));
  await page.close();

  const last = makeServer(5);
  const lp = await openPage(last);
  await login(lp, 'P-5');
  for (let i = 0; i < 3; i++) {
    await answerCase(lp, 'NNNNNNNN', 'YESIL');
    await submit(lp);
    if (i < 2) await lp.click('#btnNext');
  }
  await lp.waitForSelector('#screen-summary:not([hidden])');
  assert.match(await lp.locator('#summaryContent').innerText(), /Bu, çalışmanın son oturumuydu; katılımınız için teşekkür ederiz\./);
  await lp.close();
});

test('vaka sırasında oturum değişir → engelleyici hata + "Sayfayı yenile" (T23)', async () => {
  const server = makeServer(1);
  const page = await openPage(server);
  await login(page, 'P-SC');
  await answerCase(page, 'NNNANNNN', 'YESIL');
  server.redeploy(2);
  await submit(page);
  assert.ok(await visible(page, '#blockingCard'));
  assert.equal(await text(page, '#blockingCard .error-msg'), 'Bu oturum kapanmış veya değişmiştir. Lütfen sayfayı yenileyin.');
  const link = page.locator('#blockingCard a.btn');
  assert.equal(await link.innerText(), 'Sayfayı yenile');
  assert.equal(await link.getAttribute('href'), 'https://script.google.com/macros/s/TEST/exec');
  assert.equal(await link.getAttribute('target'), '_top');
  assert.ok(await page.locator('#f_user_pat_appearance_0').isDisabled());
  assert.equal(await beforeUnloadBlocked(page), false);
  assert.equal(server.rows('Session1').length + server.rows('Session2').length, 0);
  await page.close();
});

test('özet yüklenemezse "Geri bildirimi tekrar yükle" (§9.9)', async () => {
  const server = makeServer(3);
  const page = await openPage(server);
  await login(page, 'P-SF');
  for (let i = 0; i < 3; i++) {
    await answerCase(page, 'NNNNNNNN', 'SARI');
    if (i === 2) server.failNext.getSessionSummary = 'Sunucuya ulaşılamadı';
    await submit(page);
    if (i < 2) await page.click('#btnNext');
  }
  await page.waitForSelector('#summaryError:not([hidden])');
  assert.equal(await text(page, '#summaryErrorMsg'), 'Bağlantı hatası: Sunucuya ulaşılamadı — lütfen tekrar deneyin.');
  await page.click('#btnRetrySummary');
  await waitIdle(page);
  assert.equal(await visible(page, '#summaryError'), false);
  assert.equal(await page.locator('.case-fb').count(), 3);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('XSS ve medya: metin kaçışlı basılır, görsel hatasında bağlantı, YouTube nocookie', async () => {
  const server = makeServer(4);
  const cs = server.g.env.ss.getSheetByName('CaseDetails');
  const H = JSON.parse(JSON.stringify(server.g.get('CASE_HEADERS')));
  const row = 11;   // CASE-010 (oturum 4, sıra 1)
  cs.getRange(row, H.indexOf('chief_complaint') + 1).setValue('<img src=x onerror="window.__xss=1">Karın ağrısı');
  cs.getRange(row, H.indexOf('pat_appearance_media_url') + 1).setValue('https://app.test/yok.png');
  cs.getRange(row, H.indexOf('pat_work_of_breathing_media_url') + 1).setValue('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  cs.getRange(row, H.indexOf('pat_circulation_to_skin_media_url') + 1).setValue('javascript:alert(1)');
  const page = await openPage(server);
  await login(page, 'P-XSS');
  assert.ok((await page.locator('#patientGrid').innerText()).includes('<img src=x onerror="window.__xss=1">Karın ağrısı'));
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  await page.waitForSelector('.media-fallback:not([hidden])');
  assert.equal(await page.locator('.media-wrap img').isVisible(), false);
  assert.equal(await page.locator('.video-frame iframe').getAttribute('src'), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0');
  assert.equal(await page.locator('.media-wrap').count(), 2, 'javascript: bağlantısı istemciye hiç gitmez');
  assert.deepEqual(page.errors, []);
  await page.close();
});
