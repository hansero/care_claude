'use strict';
// index.html'deki saf istemci yardımcıları (@pure-begin … @pure-end) — Plan §18.2.2, §18.3, T42–T47.
// Çalıştırma: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ROOT } = require('./harness');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const begin = html.indexOf('/* @pure-begin');
const end = html.indexOf('/* @pure-end */');
assert.ok(begin > 0 && end > begin, 'saf bölüm işaretleri bulunamadı');
const ctx = vm.createContext({});
vm.runInContext(html.slice(begin, end), ctx, { filename: 'index.html#pure' });
const j = (x) => JSON.parse(JSON.stringify(x));
const badges = (t) => j(ctx.computeBadges(t, 3));
const earned = (t) => badges(t).filter((b) => b.earned).map((b) => b.id);

const PERFECT = { triageExact: 3, pat: 9, vital: 15, perfectCases: 3 };

test('rozet seti: TÜ · VU · Tİ · KV (bu sırayla); Kırmızı Nöbetçi ve Renk Gözü yok', () => {
  const list = badges(PERFECT);
  assert.deepEqual(list.map((b) => [b.id, b.name, b.monogram]), [
    ['FULL_TRIANGLE', 'Tam Üçgen', 'TÜ'],
    ['VITAL_MASTER', 'Vital Ustası', 'VU'],
    ['BULLSEYE', 'Tam İsabet', 'Tİ'],
    ['PERFECT_CASE', 'Kusursuz Vaka', 'KV']
  ]);
  assert.ok(list.every((b) => b.earned));
  assert.match(list[0].criterion, /9\/9/);
  assert.match(list[1].criterion, /15\/15/);
  assert.match(list[2].criterion, /3\/3/);
  assert.match(list[3].criterion, /En az bir vakada PDÜ, vital bulgular ve triyaj kategorisinin tamamını doğru yapmak/);
});

test('Kusursuz Vaka: en az bir kusursuz vaka yeter; diğer rozetlerden bağımsız', () => {
  // Bir vaka kusursuz, diğerlerinde hata → yalnızca KV
  assert.deepEqual(earned({ triageExact: 1, pat: 7, vital: 12, perfectCases: 1 }), ['PERFECT_CASE']);
  // Toplamlar tam ama hatalar farklı vakalarda olsa bile kusursuz vaka yoksa KV yok
  assert.deepEqual(earned({ triageExact: 3, pat: 8, vital: 14, perfectCases: 0 }), ['BULLSEYE']);
  assert.deepEqual(earned({ triageExact: 2, pat: 9, vital: 15, perfectCases: 0 }), ['FULL_TRIANGLE', 'VITAL_MASTER']);
  // Eksik / bozuk alan → kazanılmaz
  assert.ok(!earned({ triageExact: 3, pat: 9, vital: 15 }).includes('PERFECT_CASE'));
  assert.ok(!earned({ perfectCases: '' }).includes('PERFECT_CASE'));
});

test('T47 — oturum bağımsızlığı: yalnızca mevcut toplamlar; geçmiş parametresi yok', () => {
  assert.equal(ctx.computeBadges.length, 2, 'computeBadges(totals, casesPerSession)');
  // O1'de 4/4 kazanılmış olsa da O2 kartı yalnızca O2 toplamlarına bakar
  const o2 = { triageExact: 2, pat: 9, vital: 13, perfectCases: 1 };
  assert.deepEqual(earned(o2), ['FULL_TRIANGLE', 'PERFECT_CASE']);
  assert.ok(!earned(o2).includes('BULLSEYE'));
  assert.deepEqual(earned({}), []);
  assert.deepEqual(earned(null), []);
  // Güven ve süre hiçbir rozeti etkilemez
  assert.deepEqual(earned(Object.assign({ confidenceMean: 1, confidenceCounts: { 1: 3 }, totalTimeSeconds: 9999 }, PERFECT)),
    earned(PERFECT));
});

test('sessiz yeniden deneme: 3 deneme, 1–4 sn jitter ve büyüyen bekleme; yalnızca geçici kodlar', () => {
  assert.equal(ctx.RETRY_MAX, 3);
  assert.deepEqual(Object.keys(ctx.RETRY_CODES).sort(), ['E_BUSY', 'E_INTERNAL']);
  assert.deepEqual([ctx.retryDelayMs(1, 0), ctx.retryDelayMs(1, 0.5), ctx.retryDelayMs(1, 0.9999)], [1000, 2500, 4000]);
  assert.deepEqual([ctx.retryDelayMs(2, 0), ctx.retryDelayMs(2, 1)], [2000, 8000]);
  assert.deepEqual([ctx.retryDelayMs(3, 0), ctx.retryDelayMs(3, 1)], [3000, 12000]);
  // Kullanıcının düzeltmesi gereken hatalar yeniden denenmez
  ['E_DUPLICATE', 'E_PARTICIPANT_UNKNOWN', 'E_CASE_VERSION_CHANGED', 'E_SESSION_LOCKED', 'E_HONOR_REQUIRED']
    .forEach((code) => assert.ok(!ctx.RETRY_CODES[code], code));
});

test('vaka zamanlayıcısı: gizli süre, yenileme boşluğu ve okuma', () => {
  const T0 = 1000000;
  let t = j(ctx.timerStart(T0, false));
  assert.deepEqual(t, { startMs: T0, hiddenMs: 0, hiddenSince: null, lastSeenMs: T0, frozen: null });
  t = j(ctx.timerVisibility(t, T0 + 30000, true));            // 30. sn sekme gizlendi
  t = j(ctx.timerVisibility(t, T0 + 40000, true));            // gizliyken tekrar kayıt: başlangıç değişmez
  assert.equal(t.hiddenSince, T0 + 30000);
  assert.deepEqual(j(ctx.timerRead(t, T0 + 50000)), { responseTimeSeconds: 50, hiddenTimeSeconds: 20 });
  t = j(ctx.timerVisibility(t, T0 + 50000, false));           // 50. sn geri döndü
  assert.deepEqual([t.hiddenMs, t.hiddenSince], [20000, null]);
  t = j(ctx.timerVisibility(t, T0 + 60000, false));           // görünürken düzenli kayıt (lastSeenMs)
  // 60. sn'de sayfa yenilendi / kapandı, 75. sn'de aynı vakaya dönüldü: aradaki 15 sn gizli sayılır
  t = j(ctx.timerResume(t, T0 + 75000, false));
  assert.deepEqual([t.startMs, t.hiddenMs, t.lastSeenMs], [T0, 35000, T0 + 75000]);
  assert.deepEqual(j(ctx.timerRead(t, T0 + 100000)), { responseTimeSeconds: 100, hiddenTimeSeconds: 35 });
  // Gizliyken kapanan sayfa: boşluk gizlenme anından itibaren sayılır
  let u = j(ctx.timerVisibility(j(ctx.timerStart(T0, false)), T0 + 10000, true));
  u = j(ctx.timerResume(Object.assign(u, { lastSeenMs: T0 + 12000 }), T0 + 70000, false));
  assert.equal(u.hiddenMs, 60000);
  // Dondurulmuş değerler yenilemeden sonra korunur
  const frozen = { responseTimeSeconds: 42.5, hiddenTimeSeconds: 1 };
  assert.deepEqual(j(ctx.timerResume(Object.assign(j(ctx.timerStart(T0, false)), { frozen }), T0 + 5000, false)).frozen, frozen);
  // Saat geri alınırsa gizli süre toplamı aşmaz ve negatif olmaz
  assert.deepEqual(j(ctx.timerRead(j(ctx.timerStart(T0, true)), T0 - 2000)), { responseTimeSeconds: -2, hiddenTimeSeconds: 0 });
});

test('T42 — O1 ve O2 tamamlanmış: ardışık noktalar birleşir', () => {
  const m = j(ctx.learningCurveModel([
    { sessionNumber: 1, status: 'completed', triageExact: 2, pat: 7, vital: 12 },
    { sessionNumber: 2, status: 'completed', triageExact: 3, pat: 9, vital: 15 },
    { sessionNumber: 3, status: 'none' }, { sessionNumber: 4, status: 'none' }, { sessionNumber: 5, status: 'none' }
  ], 3));
  assert.deepEqual(m.completedSessions, [1, 2]);
  assert.equal(m.showSinglePointNote, false);
  assert.deepEqual(m.series.map((s) => [s.key, s.color, s.width, s.dash]), [
    ['triage', '#16577d', 3, ''], ['pat', '#1e7b4f', 2, '6 4'], ['vital', '#8a5a00', 2, '2 4']
  ]);
  const [tri, pat, vital] = m.series;
  assert.deepEqual(tri.points.map((p) => +p.value.toFixed(4)), [0.6667, 1]);
  assert.deepEqual(pat.points.map((p) => +p.value.toFixed(4)), [0.7778, 1]);
  assert.deepEqual(vital.points.map((p) => p.value), [0.8, 1]);
  m.series.forEach((s) => assert.equal(s.segments.length, 1));
});

test('T43 — O2 atlanınca O1 ve O3 birleştirilmez; yarım oturum çizilmez', () => {
  const m = j(ctx.learningCurveModel([
    { sessionNumber: 1, status: 'completed', triageExact: 2, pat: 7, vital: 12 },
    { sessionNumber: 2, status: 'none' },
    { sessionNumber: 3, status: 'completed', triageExact: 3, pat: 9, vital: 15 },
    { sessionNumber: 4, status: 'partial', triageExact: 1, pat: 3, vital: 5 }
  ], 3));
  assert.deepEqual(m.completedSessions, [1, 3]);
  m.series.forEach((s) => {
    assert.equal(s.segments.length, 0);
    assert.deepEqual(s.points.map((p) => p.session), [1, 3]);
  });
});

test('T44 — yalnızca O1: tek nokta seti ve not', () => {
  const m = j(ctx.learningCurveModel([{ sessionNumber: 1, status: 'completed', triageExact: 1, pat: 9, vital: 15 }], 3));
  assert.equal(m.showSinglePointNote, true);
  m.series.forEach((s) => { assert.equal(s.points.length, 1); assert.equal(s.segments.length, 0); });
  assert.equal(j(ctx.learningCurveModel([], 3)).showSinglePointNote, false);
});

test('biçimlendiriciler', () => {
  assert.equal(ctx.fmtDuration(412.3), '6 dk 52 sn');
  assert.equal(ctx.fmtDuration(''), '—');
  assert.equal(ctx.fmtMean(2.3), '2,3');
  assert.equal(ctx.fmtMean(2), '2,0');
  assert.equal(ctx.fmtMean(null), '—');
  assert.equal(ctx.dec(38.4), '38,4');
});
