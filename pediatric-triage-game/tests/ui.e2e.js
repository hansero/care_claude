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
const { loadCode, activateAllCases, addParticipants, TEST_PARTICIPANTS } = require('./harness');

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
function makeServer(session, config) {
  const server = { g: loadCode({ session, config }), calls: [], failNext: {}, failAfterServer: {} };
  server.g.ctx.initializeDatabase();
  activateAllCases(server.g.env);   // yer tutucular pasif yüklenir
  addParticipants(server.g.env, TEST_PARTICIPANTS.concat(['P-SC', 'P-SF', 'P-XSS', 'P-TMR', 'P-VER', 'P-CURVE', 'P-GAP', 'P-NC', 'P-NB']));
  server.redeploy = (s) => { server.g = loadCode({ session: s, config, env: server.g.env }); };
  /** Kullanıcının satırlarında özetin ilk görüntülenme anını "dakika önce"ye çeker. */
  server.setViewedAgo = (name, uid, minutes) => {
    const sh = server.g.env.ss.getSheetByName(name);
    const RH = JSON.parse(JSON.stringify(server.g.get('RESPONSE_HEADERS')));
    const iso = new Date(Date.now() - minutes * 60000).toISOString();
    for (let r = 2; r <= sh.getLastRow(); r++) {
      if (sh.getRange(r, RH.indexOf('user_id') + 1).getValue() === uid) sh.getRange(r, RH.indexOf('feedback_viewed_time') + 1).setValue(iso);
    }
  };
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
    if (server.beforeCall) server.beforeCall(fn);
    // failNext[fn]: tek mesaj (bir kez) ya da mesaj dizisi (ardışık her çağrı için bir tane)
    if (server.failNext[fn]) {
      const f = server.failNext[fn];
      const msg = Array.isArray(f) ? f.shift() : f;
      if (!Array.isArray(f) || f.length === 0) delete server.failNext[fn];
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
  await fastRetries(page);
  return page;
}

/** Sessiz yeniden deneme beklemelerini testte kısaltır (1–4 sn → 5–15 ms; büyüme aynı). */
async function fastRetries(page, base = 5, spread = 10) {
  await page.evaluate(([b, sp]) => { window.RETRY_BASE_MS = b; window.RETRY_SPREAD_MS = sp; }, [base, spread]);
}
const count = (server, fn) => server.calls.filter((c) => c === fn).length;

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

/** Bir vakayı yanıtlar: answers = 8 karakterlik 'N'/'A' dizisi, triage = kod, conf = '1'|'2'|'3' (null: seçme). */
async function answerCase(page, answers, triage, conf = '2') {
  const fields = ['user_pat_appearance', 'user_pat_work_of_breathing', 'user_pat_circulation_to_skin',
    'user_temperature_classification', 'user_heart_rate_classification', 'user_respiratory_rate_classification',
    'user_blood_pressure_classification', 'user_spo2_classification'];
  for (let i = 0; i < fields.length; i++) {
    await page.click(`label[for="f_${fields[i]}_${answers[i] === 'A' ? 1 : 0}"]`);
  }
  if (triage) await page.click(`label[for="tri_${triage}"]`);
  if (conf && await page.locator('#confidenceBlock').isVisible()) await page.click(`label[for="f_user_triage_confidence_${conf}"]`);
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
  // T37: güven sorusu vaka başına bir kez, gönder düğmesinin hemen üstünde; PDÜ/vital bölümlerinde yok; varsayılan yok
  assert.equal(await page.locator('input[name="user_triage_confidence"]').count(), 3);
  assert.equal(await page.locator('#patList input[name="user_triage_confidence"], #vitalList input[name="user_triage_confidence"]').count(), 0);
  assert.equal(await page.locator('input[name="user_triage_confidence"]:checked').count(), 0);
  assert.equal(await text(page, '.confidence-q'), 'Bu vakadaki triyaj kararınızdan ne kadar eminsiniz?');
  assert.deepEqual(await page.locator('.seg-conf label').allInnerTexts(), ['★ Emin değilim', '★★ Orta', '★★★ Kesinlikle eminim']);
  assert.ok(await page.$eval('#confidenceBlock', (el) => el.nextElementSibling.id === 'btnSubmit'));
  assert.equal(await text(page, '#submitHintText'),
    'Göndermek için 8 sınıflandırmanın tümünü tamamlayın, bir triyaj kategorisi ve güven düzeyinizi seçin.');
  await answerCase(page, 'NNNANNNN', null, null);
  assert.ok(await page.locator('#btnSubmit').isDisabled(), 'triyaj seçilmeden pasif (T16)');
  assert.ok(await visible(page, '#submitHint'));
  assert.equal(await beforeUnloadBlocked(page), true, 'T35');
  await page.click('label[for="tri_YESIL"]');
  assert.ok(await page.locator('#btnSubmit').isDisabled(), 'güven seçilmeden pasif (T38)');
  assert.equal(await text(page, '#answerCount'), '(9 / 10)');
  await page.click('label[for="f_user_triage_confidence_3"]');
  assert.ok(await page.locator('#btnSubmit').isEnabled());
  assert.equal(await visible(page, '#submitHint'), false);
  await shot(page, 'desktop-case1');
  await submit(page);

  assert.equal(await text(page, '#savedCard .saved-title'), '✓ Vaka 1 / 3 kaydedildi.');
  assert.equal(await page.locator('#screen-case .tag').count(), 0, 'doğruluk bilgisi gösterilmez (T17)');
  assert.doesNotMatch(await page.locator('#screen-case').innerText(), /Yanlış|Tam uyum|Referans:|basamak/);
  assert.ok(await page.locator('#f_user_pat_appearance_0').isDisabled());
  assert.equal(await visible(page, '#actionCard'), false);
  assert.ok(await page.locator('#f_user_triage_confidence_3').isDisabled(), 'güven de kilitlenir');
  assert.equal(await beforeUnloadBlocked(page), false);
  await page.click('#btnNext');

  // Vaka 2 (CASE-002, KIRMIZI) — ağ hatası ve yanıtı kaybolan gönderim
  assert.equal(await text(page, '#headerMeta'), 'Katılımcı P-014 · Oturum 1/5 · Vaka 2/3');
  assert.equal(await page.locator('.progress .dot.done').count(), 1);
  await answerCase(page, 'AAAAAANA', 'YESIL', '1');   // tehlikeli düşük triyaj
  server.failNext.submitCase = Array(4).fill('Ağ bağlantısı koptu');   // ilk deneme + 3 sessiz yeniden deneme
  const calls0 = count(server, 'submitCase');
  await submit(page);
  assert.equal(count(server, 'submitCase'), calls0 + 4, 'hata ancak 3 sessiz yeniden denemeden sonra gösterilir');
  assert.equal(await text(page, '#caseError'), 'Bağlantı hatası: Ağ bağlantısı koptu — lütfen tekrar deneyin.');
  const frozen = await page.evaluate(() => window.state.timer.frozen);
  assert.ok(frozen && frozen.responseTimeSeconds >= 0, 'süreler ilk tıklamada donduruldu');
  await page.waitForTimeout(1200);   // yeniden deneme beklemesi süreye eklenmemeli
  assert.ok(await page.locator('#btnSubmit').isEnabled(), 'düğme yeniden etkin');
  assert.equal(await page.locator('#screen-case input[type=radio]:checked').count(), 10, 'yanıtlar korunur');
  assert.equal(server.rows('Session1').length, 1);

  // Yanıtı kaybolan gönderim: kayıt sunucuya ulaştı; sessiz yeniden deneme E_DUPLICATE alır → başarı yolu
  server.failAfterServer.submitCase = 'Zaman aşımı';
  await submit(page);
  assert.equal(await visible(page, '#caseError'), false, 'kullanıcı hata görmez');
  assert.equal(await text(page, '#savedCard .saved-title'), '✓ Vaka 2 / 3 kaydedildi.');
  assert.equal(server.rows('Session1').length, 2, 'ikinci satır yazılmadı');
  assert.equal(server.rows('Session1')[1].response_time_seconds, frozen.responseTimeSeconds, 'yeniden denemede aynı süre');
  assert.equal(server.rows('Session1')[1].case_version, 1);

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
  assert.deepEqual(boxes.map((b) => b.split('\n')[0]), ['Triyaj kategorisi', 'PDÜ', 'Vital bulgular', 'Toplam süre', 'Güven dağılımı']);
  assert.match(boxes[4], /★ 1 · ★★ 1 · ★★★ 1$/);
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
  // T41: güven nötr satır olarak; Doğru/Yanlış etiketi yok
  assert.deepEqual(await page2.locator('.confidence-line').allInnerTexts(), [
    'Güven düzeyiniz: ★★★ Kesinlikle eminim', 'Güven düzeyiniz: ★ Emin değilim', 'Güven düzeyiniz: ★★ Orta'
  ]);
  assert.equal(await page2.locator('.confidence-line .tag').count(), 0);
  // Gelişimim (T44): yalnızca O1 → tek nokta seti + not; tablo O2–O5 "—"
  assert.ok(await visible(page2, '#learningCard'));
  assert.equal(await page2.locator('#learningCard svg.curve-svg[role="img"]').getAttribute('aria-label'), 'Oturumlara göre doğruluk grafiği');
  assert.equal(await page2.locator('#learningCard svg.curve-svg circle').count(), 3);
  assert.equal(await page2.locator('#learningCard svg.curve-svg line[stroke]').count(), 0);
  assert.match(await text(page2, '#learningCard'), /Eğri, ikinci oturumu tamamladığınızda oluşacaktır\./);
  const curveRows = await page2.locator('.curve-table tbody tr').allInnerTexts();
  assert.deepEqual(curveRows.map((r) => r.split('\t')[0]),
    ['Triyaj kategorisi', 'PDÜ', 'Vital bulgular', 'Tehlikeli düşük triyaj', 'Ortalama güven', 'Süre']);
  assert.deepEqual(curveRows[0].split('\t'), ['Triyaj kategorisi', '1/3', '—', '—', '—', '—']);
  assert.deepEqual(curveRows[4].split('\t').slice(0, 2), ['Ortalama güven', '★ 2,0']);
  assert.equal(await page2.locator('.curve-table thead .is-current').innerText(), 'O1');
  // Başarımlar: yalnızca bu oturum. PDÜ 9/9 → Tam Üçgen; 1. vaka PDÜ, vital ve triyajda tam → Kusursuz Vaka
  assert.equal(await text(page2, '#badgesCard h2'), 'Bu Oturumun Başarımları · 2/4');
  assert.deepEqual(await page2.$$eval('#badgesCard .badge', (els) => els.map((e) => e.dataset.badge)),
    ['FULL_TRIANGLE', 'VITAL_MASTER', 'BULLSEYE', 'PERFECT_CASE']);
  assert.deepEqual(await page2.$$eval('#badgesCard .badge.earned', (els) => els.map((e) => e.dataset.badge)), ['FULL_TRIANGLE', 'PERFECT_CASE']);
  assert.match(await text(page2, '#badgesCard [data-badge="PERFECT_CASE"]'), /Kusursuz Vaka[\s\S]*En az bir vakada PDÜ, vital bulgular ve triyaj kategorisinin tamamını doğru yapmak[\s\S]*Kazanıldı/);
  assert.doesNotMatch(await text(page2, '#badgesCard'), /Kırmızı Nöbetçi|Renk Gözü/);
  assert.doesNotMatch(await text(page2, '#badgesCard'), /Daha önce|YENİ/);
  const order = await page2.$$eval('#summaryContent > .card', (els) => els.map((e) => e.id || e.className));
  assert.deepEqual(order.slice(-3), ['learningCard', 'badgesCard', 'card'], 'özet → vakalar → Gelişimim → Başarımlar → kapanış');
  assert.match(await page2.locator('#summaryContent').innerText(),
    /Oturum 1 tamamlandı\. Yanıtlarınız kaydedildi\. Bir sonraki oturum araştırmacı tarafından duyurulacaktır\./);
  assert.equal(await beforeUnloadBlocked(page2), false);
  await shot(page2, 'desktop-summary');

  const viewed = server.rows('Session1');
  assert.ok(viewed.every((r) => r.feedback_viewed === 1 && r.feedback_viewed_time));

  // T31/T49: pencere içinde yeniden giriş → doğrudan özet
  const page3 = await openPage(server);
  await login(page3, 'p-014');
  await page3.waitForSelector('#screen-summary:not([hidden])');
  assert.equal(await page3.locator('.case-fb').count(), 3);

  // T50: ilk görüntülemeden 30 dk sonra → kilit ekranı; vaka/özet içeriği yok
  server.setViewedAgo('Session1', 'P-014', 31);
  const page4 = await openPage(server);
  await login(page4, 'P-014');
  assert.ok(await visible(page4, '#screen-locked'));
  assert.equal(await text(page4, '#lockedTitle'), 'Oturum 1 tamamlandı');
  assert.equal(await text(page4, '#lockedMsg'),
    'Bu oturumu (Oturum 1) tamamladınız; yanıtlarınız kaydedildi. Bir sonraki oturum açıldığında aynı katılımcı kodunuzla giriş yapabilirsiniz.');
  assert.match(await text(page4, '#screen-locked'), /Bu pencereyi kapatabilirsiniz\./);
  assert.equal(await page4.locator('#screen-locked button, #screen-locked a').count(), 0);
  assert.equal(await text(page4, '#headerMeta'), 'Katılımcı P-014 · Oturum 1/5 · Tamamlandı');
  assert.equal(await page4.locator('.case-fb, #patList .pat-item').count(), 0);
  // Açık olan özet sayfası süre dolsa da ekranda kalır
  assert.ok(await visible(page3, '#screen-summary'));

  assert.deepEqual([...page2.errors, ...page3.errors, ...page4.errors], []);
  await page2.close();
  await page3.close();
  await page4.close();
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
  assert.equal(await page.$eval('.seg-conf', (el) => getComputedStyle(el).flexDirection), 'column', 'güven seçenekleri mobilde alt alta');
  await noHorizontalScroll(page);
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
  assert.equal(await page.$eval('.badge-grid', (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length), 2);
  assert.equal(await text(page, '#badgesCard h2'), 'Bu Oturumun Başarımları · 4/4');
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
  // Son oturumda değer etiketi noktanın soluna geçer ve hiçbir noktayla çakışmaz
  assert.equal(await lp.locator('#learningCard .curve-value').getAttribute('text-anchor'), 'end');
  assert.equal(await lp.evaluate(() => {
    const t = document.querySelector('#learningCard .curve-value').getBoundingClientRect();
    return Array.from(document.querySelectorAll('#learningCard svg.curve-svg circle')).some((c) => {
      const b = c.getBoundingClientRect();
      return !(b.right <= t.left || b.left >= t.right || b.bottom <= t.top || b.top >= t.bottom);
    });
  }), false);
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
    if (i === 2) server.failNext.getSessionSummary = Array(4).fill('Sunucuya ulaşılamadı');
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

test('Gelişimim çok oturumlu: ardışık oturumlar birleşir, atlanan oturum çizgiyi keser (T42, T43)', async () => {
  const server = makeServer(1);
  async function play(uid, triage) {
    const page = await openPage(server);
    await login(page, uid);
    for (let i = 0; i < 3; i++) {
      await answerCase(page, 'NNNNNNNN', triage[i], String(i + 1));
      await submit(page);
      if (i < 2) await page.click('#btnNext');
    }
    await page.waitForSelector('#screen-summary:not([hidden])');
    return page;
  }
  const triLines = (page) => page.locator('#learningCard svg.curve-svg line[stroke="#16577d"]').count();
  (await play('P-CURVE', ['YESIL', 'KIRMIZI', 'SARI'])).close();
  (await play('P-GAP', ['YESIL', 'YESIL', 'YESIL'])).close();
  server.redeploy(2);
  const p2 = await play('P-CURVE', ['SARI', 'YESIL', 'SARI']);
  assert.equal(await triLines(p2), 1, 'O1–O2 birleşik');
  assert.equal(await p2.locator('#learningCard svg.curve-svg circle').count(), 6);
  assert.doesNotMatch(await text(p2, '#learningCard'), /Eğri, ikinci oturumu/);
  const row = (await p2.locator('.curve-table tbody tr').first().innerText()).split('\t');
  assert.deepEqual(row, ['Triyaj kategorisi', '3/3', '2/3', '—', '—', '—']);
  assert.equal(await p2.locator('#learningCard .curve-value').innerHTML(), '%67');
  assert.equal(await p2.locator('#learningCard svg.curve-svg').getAttribute('viewBox'), '0 0 640 280');
  const labelOverlapsPoint = () => p2.evaluate(() => {
    const t = document.querySelector('#learningCard .curve-value').getBoundingClientRect();
    return Array.from(document.querySelectorAll('#learningCard svg.curve-svg circle')).some((c) => {
      const b = c.getBoundingClientRect();
      return !(b.right <= t.left || b.left >= t.right || b.bottom <= t.top || b.top >= t.bottom);
    });
  });
  assert.equal(await labelOverlapsPoint(), false, 'değer etiketi noktalarla çakışmaz');
  await shot(p2, 'desktop-curve-o2');
  // Ekran daralınca (telefon / döndürme) grafik kompakt geometride yeniden çizilir; etiketler okunur kalır
  await p2.setViewportSize(MOBILE);
  await p2.waitForFunction(() => document.querySelector('#learningCard svg.curve-svg').getAttribute('viewBox') === '0 0 340 220');
  assert.ok(await p2.$eval('#learningCard .curve-tick', (el) => el.getBoundingClientRect().height) >= 9, 'mobil etiket ≥ 9 px');
  assert.equal(await labelOverlapsPoint(), false);
  await noHorizontalScroll(p2);
  await shot(p2, 'mobile-curve-o2');
  await p2.close();
  server.redeploy(3);
  const p3 = await play('P-GAP', ['KIRMIZI', 'SARI', 'YESIL']);
  assert.equal(await triLines(p3), 0, 'O2 atlandı → O1 ve O3 birleştirilmez');
  assert.equal(await p3.locator('#learningCard svg.curve-svg circle').count(), 6);
  assert.deepEqual((await p3.locator('.curve-table tbody tr').first().innerText()).split('\t'),
    ['Triyaj kategorisi', '1/3', '—', '3/3', '—', '—']);
  assert.deepEqual([...p2.errors, ...p3.errors], []);
  await p3.close();
});

test('T48 — bayraklar kapalıyken ilgili arayüz parçaları gizlenir', async () => {
  const noConf = makeServer(1, { ENABLE_CONFIDENCE: false });
  const p1 = await openPage(noConf);
  await login(p1, 'P-NC');
  assert.equal(await p1.locator('#confidenceBlock').isVisible(), false);
  assert.equal(await p1.locator('input[name="user_triage_confidence"]').count(), 0);
  assert.equal(await text(p1, '#submitHintText'), 'Göndermek için 8 sınıflandırmanın tümünü tamamlayın ve bir triyaj kategorisi seçin.');
  await answerCase(p1, 'NNNANNNN', 'YESIL', null);
  assert.ok(await p1.locator('#btnSubmit').isEnabled(), '9 seçimle gönderilebilir');
  for (let i = 0; i < 3; i++) {
    if (i > 0) await answerCase(p1, 'NNNNNNNN', 'SARI', null);
    await submit(p1);
    if (i < 2) await p1.click('#btnNext');
  }
  await p1.waitForSelector('#screen-summary:not([hidden])');
  assert.equal(await p1.locator('.confidence-line').count(), 0);
  assert.ok(!(await p1.locator('.summary-box').allInnerTexts()).some((b) => b.startsWith('Güven')));
  assert.ok(!(await text(p1, '.curve-table')).includes('Ortalama güven'));
  assert.ok(noConf.rows('Session1').every((r) => r.user_triage_confidence === ''));
  await p1.close();

  const noCurveNoBadges = makeServer(1, { ENABLE_LEARNING_CURVE: false, ENABLE_BADGES: false });
  const p2 = await openPage(noCurveNoBadges);
  await login(p2, 'P-NB');
  for (let i = 0; i < 3; i++) {
    await answerCase(p2, 'NNNNNNNN', 'SARI');
    await submit(p2);
    if (i < 2) await p2.click('#btnNext');
  }
  await p2.waitForSelector('#screen-summary:not([hidden])');
  assert.equal(await p2.locator('#learningCard').count(), 0);
  assert.equal(await p2.locator('#badgesCard').count(), 0);
  assert.equal(await p2.locator('.confidence-line').count(), 3);
  assert.deepEqual([...p1.errors, ...p2.errors], []);
  await p2.close();
});

test('G1.1 — listede olmayan kodla giriş reddedilir', async () => {
  const server = makeServer(1);
  const page = await openPage(server);
  await login(page, 'P-9999');
  assert.ok(await visible(page, '#screen-login'));
  assert.equal(await text(page, '#loginError'), 'Katılımcı kodu tanınmadı. Lütfen araştırmacının size ilettiği kodu kontrol edin.');
  assert.equal(server.rows('Session1').length, 0);
  await page.close();
});

test('G1.6 — sayfa yenilense de vaka süresi baştan başlamaz; gizli kalınan süre ayrıca kaydedilir', async () => {
  const server = makeServer(1);
  const page = await openPage(server);
  await login(page, 'P-TMR');
  const t0 = await page.evaluate(() => window.state.timer);
  assert.equal(t0.hiddenMs, 0);
  const setVisibility = (state) => page.evaluate((v) => {
    Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
  await setVisibility('hidden');                    // başka sekmeye geçildi
  await page.waitForTimeout(1200);
  await setVisibility('visible');
  const afterHide = await page.evaluate(() => window.state.timer);
  assert.ok(afterHide.hiddenMs >= 1100, 'gizli süre birikti: ' + afterHide.hiddenMs);
  await answerCase(page, 'NNNANNNN', 'YESIL');
  await page.reload();                              // yanıt vermeden sayfa yenilendi
  await waitIdle(page);
  await login(page, 'P-TMR');
  const t1 = await page.evaluate(() => window.state.timer);
  assert.equal(t1.startMs, t0.startMs, 'başlangıç korunur');
  assert.ok(t1.hiddenMs >= afterHide.hiddenMs, 'yenileme boşluğu gizli süreye eklenir');
  await page.waitForTimeout(300);
  await answerCase(page, 'NNNANNNN', 'YESIL');
  await submit(page);
  const row = server.rows('Session1')[0];
  assert.equal(row.case_start_time, new Date(t0.startMs).toISOString());
  assert.ok(row.hidden_time_seconds >= 1.1, 'hidden_time_seconds ' + row.hidden_time_seconds);
  assert.ok(row.response_time_seconds > row.hidden_time_seconds, 'etkin süre pozitif');
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.indexOf('pt:') === 0).length), 0,
    'kayıttan sonra zamanlayıcı silinir');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('G1.2 + G2.5 — vaka güncellenirse engelleyici mesaj; adres yoksa "Sayfayı yenile" giriş ekranına döner', async () => {
  const server = makeServer(1);
  server.g.env.appUrl = '';
  const page = await openPage(server);
  await login(page, 'P-VER');
  await answerCase(page, 'NNNANNNN', 'YESIL');
  const cs = server.g.env.ss.getSheetByName('CaseDetails');
  const H = JSON.parse(JSON.stringify(server.g.get('CASE_HEADERS')));
  const edited = cs.getRange(2, H.indexOf('case_version') + 1);
  edited.setValue(2);                                          // araştırmacı CASE-001'i el ile güncelledi
  server.g.ctx.onEdit({ range: edited });                      // E-Tablolar'daki basit tetikleyici önbelleği boşaltır
  await submit(page);
  assert.equal(await text(page, '#blockingCard .error-msg'),
    'Bu vaka siz yanıtlarken güncellendi. Lütfen sayfayı yenileyip vakayı yeniden yanıtlayın.');
  assert.equal(server.rows('Session1').length, 0);
  const btn = page.locator('#blockingCard button[data-action="reload"]');
  assert.equal(await btn.innerText(), 'Sayfayı yenile');
  await btn.click();
  assert.ok(await visible(page, '#screen-login'));
  assert.equal(await page.inputValue('#uid'), 'P-VER', 'kod alanı dolu kalır');
  assert.equal(await visible(page, '#blockingCard'), false);
  await page.click('#btnStart');
  await waitIdle(page);
  assert.equal(await text(page, '#headerMeta'), 'Katılımcı P-VER · Oturum 1/5 · Vaka 1/3');
  assert.equal(await page.evaluate(() => window.state.timer.frozen), null, 'yeni sürüm yeni zamanlayıcıyla başlar');
  await answerCase(page, 'NNNANNNN', 'YESIL');
  await submit(page);
  assert.equal(await text(page, '#savedCard .saved-title'), '✓ Vaka 1 / 3 kaydedildi.');
  assert.equal(server.rows('Session1')[0].case_version, 2);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('Çözüm 2 — yoğunlukta sessiz yeniden deneme: giriş, gönderim ve özet hata göstermeden tamamlanır', async () => {
  const server = makeServer(1);
  const page = await openPage(server);
  // Giriş anı yığılması: 30 eşzamanlı yürütme sınırında çağrı hiç çalışmaz (hata işleyicisi) → sessizce yeniden dener
  server.failNext.startSession = ['Too many simultaneous invocations', 'Too many simultaneous invocations'];
  await login(page, 'P-1');
  assert.equal(count(server, 'startSession'), 3);
  assert.equal(await visible(page, '#loginError'), false);
  assert.equal(await text(page, '#headerMeta'), 'Katılımcı P-1 · Oturum 1/5 · Vaka 1/3');

  // Gönderim: kilit iki kez dolu (E_BUSY) → "Yanıtınız kaydediliyor…" ekranda kalır, üçüncü denemede kaydedilir
  await fastRetries(page, 400, 10);
  server.g.env.lockFailures = 2;
  await answerCase(page, 'NNNANNNN', 'YESIL');
  await page.click('#btnSubmit');
  await page.waitForTimeout(150);
  assert.ok(await visible(page, '#loading'), 'bekleme sırasında yükleniyor katmanı görünür');
  assert.equal(await text(page, '#loadingText'), 'Yanıtınız kaydediliyor…');
  assert.equal(await visible(page, '#caseError'), false);
  await waitIdle(page);
  await fastRetries(page);
  assert.equal(await text(page, '#savedCard .saved-title'), '✓ Vaka 1 / 3 kaydedildi.');
  assert.equal(count(server, 'submitCase'), 3);
  assert.equal(server.rows('Session1').length, 1);

  // Deneme hakkı biterse son yanıt her zamanki gibi gösterilir; kullanıcı yeniden gönderebilir
  await page.click('#btnNext');
  await answerCase(page, 'AAAAAANA', 'KIRMIZI');
  server.g.env.lockAvailable = false;
  const before = count(server, 'submitCase');
  await submit(page);
  assert.equal(count(server, 'submitCase'), before + 4);
  assert.equal(await text(page, '#caseError'), 'Sunucu şu anda yoğun. Lütfen birkaç saniye sonra tekrar deneyin.');
  assert.ok(await page.locator('#btnSubmit').isEnabled());
  server.g.env.lockAvailable = true;
  await submit(page);
  assert.equal(await text(page, '#savedCard .saved-title'), '✓ Vaka 2 / 3 kaydedildi.');
  await page.click('#btnNext');

  // Özet: ilk verilişte damga kilidi dolu (E_BUSY) → sessizce yeniden denenir
  let armed = false;
  server.beforeCall = (fn) => {
    if (fn === 'getSessionSummary' && !armed) { armed = true; server.g.env.lockFailures = 1; }
  };
  await answerCase(page, 'NNNNANNA', 'SARI');
  await submit(page);
  await page.waitForSelector('#screen-summary:not([hidden])');
  await waitIdle(page);
  assert.equal(count(server, 'getSessionSummary'), 2);
  assert.equal(await visible(page, '#summaryError'), false);
  assert.equal(await page.locator('.case-fb').count(), 3);
  assert.equal(server.rows('Session1').length, 3);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('Çözüm 2 — eşzamanlı 30 katılımcı: kilit yarışında tüm gönderimler hatasız kaydedilir', async () => {
  const server = makeServer(1);
  const pages = [];
  for (let i = 0; i < 30; i++) {
    const p = await openPage(server);
    await login(p, 'P-' + (i + 1));
    await answerCase(p, 'NNNANNNN', 'YESIL');
    pages.push(p);
  }
  // Her üç denemeden birinde kilit dolu: istemciler sessizce ve rastgele beklemelerle yeniden dener
  let n = 0;
  server.beforeCall = (fn) => { if (fn === 'submitCase' && ++n % 3 === 0) server.g.env.lockFailures = 1; };
  await Promise.all(pages.map((p) => p.click('#btnSubmit')));
  await Promise.all(pages.map((p) => p.waitForSelector('#savedCard:not([hidden])')));
  for (const p of pages) {
    assert.equal(await visible(p, '#caseError'), false);
    assert.deepEqual(p.errors, []);
  }
  const rs = server.rows('Session1');
  assert.equal(rs.length, 30, 'her katılımcı için tek satır');
  assert.equal(new Set(rs.map((r) => r.user_id)).size, 30);
  assert.ok(count(server, 'submitCase') > 30, 'bazı gönderimler yeniden denendi');
  await Promise.all(pages.map((p) => p.close()));
});
