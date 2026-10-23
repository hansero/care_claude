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

const PERFECT = { triageExact: 3, pat: 9, vital: 15, redAreaCorrect: true, greenAreaCorrect: true };

test('rozet seti: 4 rozet, tablo sırasıyla; 3 grupta "Renk Gözü" yok', () => {
  const list = badges(PERFECT);
  assert.deepEqual(list.map((b) => [b.id, b.name, b.monogram]), [
    ['RED_GUARD', 'Kırmızı Nöbetçi', 'KN'],
    ['FULL_TRIANGLE', 'Tam Üçgen', 'TÜ'],
    ['VITAL_MASTER', 'Vital Ustası', 'VU'],
    ['BULLSEYE', 'Tam İsabet', 'Tİ']
  ]);
  assert.ok(list.every((b) => b.earned));
  assert.match(list[1].criterion, /9\/9/);
  assert.match(list[2].criterion, /15\/15/);
  assert.match(list[3].criterion, /3\/3/);
});

test('T46 — her vakaya KIRMIZI veren RED_GUARD kazanamaz', () => {
  // Kırmızı vaka doğru, Yeşil vaka Kırmızı'ya atandı → yeşil yanlış
  assert.deepEqual(earned({ triageExact: 1, pat: 9, vital: 15, redAreaCorrect: true, greenAreaCorrect: false }),
    ['FULL_TRIANGLE', 'VITAL_MASTER']);
  // Tam doğru triyaj → BULLSEYE ve RED_GUARD birlikte
  assert.deepEqual(earned({ triageExact: 3, pat: 7, vital: 12, redAreaCorrect: true, greenAreaCorrect: true }),
    ['RED_GUARD', 'BULLSEYE']);
  // Oturumda Kırmızı vaka yoksa (null) RED_GUARD kazanılmaz
  assert.ok(!earned({ triageExact: 3, pat: 9, vital: 15, redAreaCorrect: null, greenAreaCorrect: true }).includes('RED_GUARD'));
});

test('T47 — oturum bağımsızlığı: yalnızca mevcut toplamlar; geçmiş parametresi yok', () => {
  assert.equal(ctx.computeBadges.length, 2, 'computeBadges(totals, casesPerSession)');
  // O1'de 4/4 kazanılmış olsa da O2 kartı yalnızca O2 toplamlarına bakar
  const o2 = { triageExact: 2, pat: 9, vital: 13, redAreaCorrect: true, greenAreaCorrect: true };
  assert.deepEqual(earned(o2), ['RED_GUARD', 'FULL_TRIANGLE']);
  assert.ok(!earned(o2).includes('BULLSEYE'));
  assert.deepEqual(earned({}), []);
  assert.deepEqual(earned(null), []);
  // Güven ve süre hiçbir rozeti etkilemez
  assert.deepEqual(earned(Object.assign({ confidenceMean: 1, confidenceCounts: { 1: 3 }, totalTimeSeconds: 9999 }, PERFECT)),
    earned(PERFECT));
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
