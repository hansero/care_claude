'use strict';
// Saf fonksiyon testleri (Plan §5.4, §7, §14 "Puanlama" — 3 gruplu triyaja uyarlanmış).
// Çalıştırma: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCode } = require('./harness');

const j = (x) => JSON.parse(JSON.stringify(x));
const g = loadCode();
const C = g.ctx;
const RESPONSE_HEADERS = j(g.get('RESPONSE_HEADERS'));
const CASE_HEADERS = j(g.get('CASE_HEADERS'));
const SEEDS = j(C.seedCases_());
const byId = Object.fromEntries(SEEDS.map((c) => [c.case_id, c]));

const ANSWER_KEYS = [
  ['user_pat_appearance', 'pat_appearance_reference'],
  ['user_pat_work_of_breathing', 'pat_work_of_breathing_reference'],
  ['user_pat_circulation_to_skin', 'pat_circulation_to_skin_reference'],
  ['user_temperature_classification', 'temperature_reference'],
  ['user_heart_rate_classification', 'heart_rate_reference'],
  ['user_respiratory_rate_classification', 'respiratory_rate_reference'],
  ['user_blood_pressure_classification', 'blood_pressure_reference'],
  ['user_spo2_classification', 'spo2_reference']
];
function correctAnswers(c, triage) {
  const a = {};
  ANSWER_KEYS.forEach(([ans, ref]) => { a[ans] = c[ref]; });
  a.user_triage_level = triage || c.reference_triage_level;
  return a;
}

test('T24 — triyaj metrikleri: 3×3 test vektörlerinin tamamı', () => {
  // [referans, kullanıcı, diff, abs, exact, within1, over, under, dangerous]
  const V = [
    ['KIRMIZI', 'KIRMIZI', 0, 0, 1, 1, 0, 0, 0],
    ['KIRMIZI', 'SARI', 1, 1, 0, 1, 0, 1, 1],
    ['KIRMIZI', 'YESIL', 2, 2, 0, 0, 0, 1, 1],
    ['SARI', 'KIRMIZI', -1, 1, 0, 1, 1, 0, 0],
    ['SARI', 'SARI', 0, 0, 1, 1, 0, 0, 0],
    ['SARI', 'YESIL', 1, 1, 0, 1, 0, 1, 0],
    ['YESIL', 'KIRMIZI', -2, 2, 0, 0, 1, 0, 0],
    ['YESIL', 'SARI', -1, 1, 0, 1, 1, 0, 0],
    ['YESIL', 'YESIL', 0, 0, 1, 1, 0, 0, 0]
  ];
  V.forEach(([ref, user, diff, abs, exact, within, over, under, danger]) => {
    assert.deepEqual(j(C.triageMetrics_(user, ref)), {
      triage_exact_match: exact, triage_within_one: within,
      triage_difference: diff, triage_abs_difference: abs,
      over_triage: over, under_triage: under, dangerous_under_triage: danger
    }, ref + ' ← ' + user);
  });
  assert.throws(() => C.triageMetrics_('KIRMIZI_K1', 'KIRMIZI'));
});

test('triyaj yön metni', () => {
  assert.equal(C.triageDirectionText_(0), 'Tam uyum');
  assert.equal(C.triageDirectionText_(1), '1 basamak düşük triyaj');
  assert.equal(C.triageDirectionText_(2), '2 basamak düşük triyaj');
  assert.equal(C.triageDirectionText_(-1), '1 basamak yüksek triyaj');
  assert.equal(C.triageDirectionText_(-2), '2 basamak yüksek triyaj');
});

test('triyaj seviyeleri: yalnızca KIRMIZI / SARI / YESIL, 5 basamaklı kod kabul edilmez', () => {
  const levels = j(g.get('TRIAGE_LEVELS'));
  assert.deepEqual(levels.map((t) => [t.code, t.rank]), [['KIRMIZI', 1], ['SARI', 2], ['YESIL', 3]]);
  ['KIRMIZI_K1', 'KIRMIZI_K2', 'SARI_K1', 'SARI_K2', 'T1', 'kirmizi', '', null, undefined].forEach((code) => {
    assert.equal(C.triageByCode_(code), null, String(code));
  });
});

test('T25 — CASE-002, tüm yanıtlar referansla aynı', () => {
  const s = j(C.scoreResponse_(byId['CASE-002'], correctAnswers(byId['CASE-002'])));
  assert.equal(s.patScore, 3);
  assert.equal(s.completePat, 1);
  assert.equal(s.vitalScore, 5);
  assert.equal(s.triage.triage_exact_match, 1);
});

test('T26 (uyarlanmış) — CASE-006 (KIRMIZI) için kullanıcı SARI seçer', () => {
  const c = byId['CASE-006'];
  assert.equal(c.reference_triage_level, 'KIRMIZI');
  const s = j(C.scoreResponse_(c, correctAnswers(c, 'SARI')));
  assert.equal(s.triage.triage_difference, 1);
  assert.equal(s.triage.under_triage, 1);
  assert.equal(s.triage.triage_exact_match, 0);
  assert.equal(s.triage.dangerous_under_triage, 1);
});

test('puanlama: tek PDÜ ve tek vital hatası', () => {
  const c = byId['CASE-001'];
  const a = correctAnswers(c);
  a.user_pat_appearance = 1;          // referans 0
  a.user_temperature_classification = 0;   // referans 1 (yanlış negatif)
  const s = j(C.scoreResponse_(c, a));
  assert.equal(s.pat.appearance_correct, 0);
  assert.equal(s.patScore, 2);
  assert.equal(s.completePat, 0);
  assert.equal(s.vitals.temperature_correct, 0);
  assert.equal(s.vitalScore, 4);
});

test('T27 — buildRecord_: case_global_order ve sütun kümesi', () => {
  const c = byId['CASE-008'];
  const answers = Object.assign(correctAnswers(c), { user_triage_confidence: 2 });
  const rec = j(C.buildRecord_({
    n: 3, uid: 'P-014', loginId: 'L-12345678', caseStartTime: '2026-12-03T09:14:05.120Z',
    payload: { responseTimeSeconds: 131.46, hiddenTimeSeconds: 12.34, deviceType: 'mobile', honorAccepted: true },
    answers, theCase: c, score: C.scoreResponse_(c, answers),
    now: new Date('2026-12-03T09:16:16.000Z'), responseId: 'R-x'
  }));
  assert.equal(rec.case_global_order, 8);
  assert.deepEqual(Object.keys(rec).sort(), RESPONSE_HEADERS.slice().sort());
  assert.equal(rec.response_time_seconds, 131.5);
  assert.equal(rec.hidden_time_seconds, 12.3);
  assert.equal(rec.reference_triage_level, 'SARI');
  assert.equal(rec.feedback_viewed, 0);
  assert.equal(rec.feedback_viewed_time, '');
  assert.equal(rec.honor_statement_accepted, 1);
  assert.equal(rec.device_type, 'mobile');
  assert.equal(rec.case_submission_time, '2026-12-03T09:16:16.000Z');
  assert.equal(rec.user_triage_confidence, 2);
});

test('güven düzeyi puanlamaya girmez: 1 ile 3 arasında yalnızca güven sütunu değişir', () => {
  const c = byId['CASE-003'];
  const rec = (conf) => {
    const answers = Object.assign(correctAnswers(c, 'YESIL'), { user_triage_confidence: conf });
    return j(C.buildRecord_({
      n: 1, uid: 'P-1', loginId: 'L-12345678', caseStartTime: '2026-12-03T09:14:05.120Z',
      payload: { responseTimeSeconds: 50, deviceType: 'desktop', honorAccepted: true },
      answers, theCase: c, score: C.scoreResponse_(c, answers),
      now: new Date('2026-12-03T09:16:16.000Z'), responseId: 'R-x'
    }));
  };
  const a = rec(1);
  const b = rec(3);
  assert.equal(a.user_triage_confidence, 1);
  assert.equal(b.user_triage_confidence, 3);
  delete a.user_triage_confidence;
  delete b.user_triage_confidence;
  assert.deepEqual(a, b);
});

test('süre normalleştirme: geçersiz değer 0 değil eksik veri (\'\') olur', () => {
  assert.equal(C.normalizeSeconds_(42.04), 42);
  assert.equal(C.normalizeSeconds_('12.36'), 12.4);
  assert.equal(C.normalizeSeconds_(0), 0);
  assert.equal(C.normalizeSeconds_(-3), '');
  assert.equal(C.normalizeSeconds_('-0.5'), '');
  assert.equal(C.normalizeSeconds_('abc'), '');
  assert.equal(C.normalizeSeconds_(undefined), '');
  assert.equal(C.normalizeSeconds_(true), '');
});

test('sütun yapıları', () => {
  assert.equal(RESPONSE_HEADERS.length, 47);
  assert.equal(RESPONSE_HEADERS.indexOf('hidden_time_seconds'), RESPONSE_HEADERS.indexOf('response_time_seconds') + 1);
  assert.equal(RESPONSE_HEADERS.indexOf('feedback_viewed_time'), RESPONSE_HEADERS.indexOf('feedback_viewed') + 1,
    'markFeedbackViewed_ iki bitişik hücreyi tek setValues ile yazar');
  assert.deepEqual(j(g.get('PARTICIPANT_HEADERS')), ['user_id', 'active_status']);
  assert.equal(new Set(RESPONSE_HEADERS).size, RESPONSE_HEADERS.length);
  assert.ok(!RESPONSE_HEADERS.some((h) => /area/.test(h)), 'renk alanı sütunu kalmamalı');
  assert.equal(RESPONSE_HEADERS.indexOf('user_triage_confidence'), RESPONSE_HEADERS.indexOf('dangerous_under_triage') + 1);
  assert.equal(RESPONSE_HEADERS.indexOf('honor_statement_accepted'), RESPONSE_HEADERS.indexOf('user_triage_confidence') + 1);
  assert.equal(CASE_HEADERS.length, 40);
  assert.equal(new Set(CASE_HEADERS).size, CASE_HEADERS.length);
  j(g.get('TEXT_FORMAT_COLUMNS')).forEach((h) => assert.ok(RESPONSE_HEADERS.includes(h), h));
});

test('Ek D — 15 yer tutucu vaka, Ek A referans deseni ile birebir', () => {
  // GG Sİ CD Ateş KH SS KB SpO2
  const EK_A = {
    'CASE-001': [1, 1, 'YESIL', 'NNNANNNN'], 'CASE-002': [1, 2, 'KIRMIZI', 'AAAAAANA'],
    'CASE-003': [1, 3, 'SARI', 'NNNNANNN'], 'CASE-004': [2, 1, 'SARI', 'NNNNANNN'],
    'CASE-005': [2, 2, 'YESIL', 'NNNNNNNN'], 'CASE-006': [2, 3, 'KIRMIZI', 'NANNAANA'],
    'CASE-007': [3, 1, 'KIRMIZI', 'ANAAAAAN'], 'CASE-008': [3, 2, 'SARI', 'NANANANA'],
    'CASE-009': [3, 3, 'YESIL', 'NNNNNNNN'], 'CASE-010': [4, 1, 'SARI', 'NNNAANNN'],
    'CASE-011': [4, 2, 'KIRMIZI', 'ANNNNNNN'], 'CASE-012': [4, 3, 'YESIL', 'NNNNNNNN'],
    'CASE-013': [5, 1, 'KIRMIZI', 'ANANAAAN'], 'CASE-014': [5, 2, 'YESIL', 'NNNANNNN'],
    'CASE-015': [5, 3, 'SARI', 'NNNAANNN']
  };
  assert.equal(SEEDS.length, 15);
  SEEDS.forEach((c) => {
    const [session, order, level, pattern] = EK_A[c.case_id];
    assert.equal(c.session, session, c.case_id);
    assert.equal(c.session_order, order, c.case_id);
    assert.equal(c.reference_triage_level, level, c.case_id);
    assert.equal(ANSWER_KEYS.map(([, ref]) => (c[ref] === 1 ? 'A' : 'N')).join(''), pattern, c.case_id);
    assert.deepEqual(Object.keys(c).sort(), CASE_HEADERS.slice().sort(), c.case_id);
    assert.deepEqual(j(C.validateCase_(c)), [], c.case_id);
    assert.deepEqual(j(C.caseWarnings_(c)), [], c.case_id);
    assert.ok(!/Kategori\s*[12]/.test(c.triage_feedback), c.case_id + ' gerekçesi 3 gruba uyarlanmalı');
    assert.match(c.triage_feedback, /: (Kırmızı|Sarı|Yeşil) Alan\.$/, c.case_id);
  });
});

test('formatVital_ — ondalık virgül, %, mmHg', () => {
  const c = byId['CASE-001'];
  assert.equal(C.formatVital_('temperature', c), '38,4 °C');
  assert.equal(C.formatVital_('heart_rate', c), '115/dk');
  assert.equal(C.formatVital_('respiratory_rate', c), '24/dk');
  assert.equal(C.formatVital_('blood_pressure', c), '98/60 mmHg');
  assert.equal(C.formatVital_('spo2', c), '%99');
  assert.equal(C.formatVital_('temperature', Object.assign({}, c, { temperature_value: 101.1, temperature_unit: 'Fahrenheit' })), '101,1 °F');
});

test('normalizeUserId_ ve requireUserId_', () => {
  assert.equal(C.normalizeUserId_('  p-014 '), 'P-014');
  assert.equal(C.normalizeUserId_('p 014'), 'P014');
  assert.equal(C.normalizeUserId_(null), '');
  assert.equal(C.normalizeUserId_(14), '14');
  assert.equal(C.requireUserId_(' 014 '), '014');
  const code = (raw) => { try { C.requireUserId_(raw); return 'OK'; } catch (e) { return e.appCode; } };
  assert.equal(code('   '), 'E_USER_ID_REQUIRED');
  assert.equal(code('x'.repeat(41)), 'E_USER_ID_TOO_LONG');
  assert.equal(code('x'.repeat(40)), 'OK');
  ['=1+1', '+905', '-14', '@cmd'].forEach((raw) => assert.equal(code(raw), 'E_USER_ID_INVALID', raw));
});

test('parseBinary_ — yalnızca 0/1 ve "0"/"1"', () => {
  assert.equal(C.parseBinary_(0), 0);
  assert.equal(C.parseBinary_(1), 1);
  assert.equal(C.parseBinary_('0'), 0);
  assert.equal(C.parseBinary_('1'), 1);
  [2, '2', true, false, '', null, undefined, ' 1', '01', 0.5, NaN].forEach((v) => assert.equal(C.parseBinary_(v), null, String(v)));
});

test('safeUrl_', () => {
  assert.equal(C.safeUrl_('https://example.com/a.png'), 'https://example.com/a.png');
  assert.equal(C.safeUrl_('  http://example.com/x  '), 'http://example.com/x');
  ['javascript:alert(1)', 'data:image/png;base64,xx', 'https://a b', 'https://x/"onerror=1', 'ftp://x', '', null].forEach((u) => {
    assert.equal(C.safeUrl_(u), '', String(u));
  });
});

test('validateCase_ — engelleyici hatalar', () => {
  const base = byId['CASE-004'];
  const errs = (patch) => j(C.validateCase_(Object.assign({}, base, patch)));
  assert.match(errs({ reference_triage_level: 'SARI_K2' }).join(), /reference_triage_level geçersiz.*KIRMIZI, SARI, YESIL/);
  assert.match(errs({ session: 6 }).join(), /session 1–5/);
  assert.match(errs({ session_order: 4 }).join(), /session_order 1–3/);
  assert.match(errs({ age: -1 }).join(), /age/);
  assert.match(errs({ age_unit: 'yil' }).join(), /age_unit/);
  assert.match(errs({ chief_complaint: '  ' }).join(), /chief_complaint boş/);
  assert.match(errs({ spo2_reference: 2 }).join(), /spo2_reference 0 veya 1/);
  assert.match(errs({ heart_rate_value: '145/dk' }).join(), /heart_rate_value sayı/);
  assert.match(errs({ case_version: 0 }).join(), /case_version/);
  assert.deepEqual(errs({ session: '2', session_order: '1', spo2_reference: '0', age: '3' }), []);
  // Değerlendirilecek her PDÜ bileşeni için metin veya geçerli medya zorunlu
  const ev = /pat_appearance_text boş ve geçerli pat_appearance_media_url yok/;
  assert.match(errs({ pat_appearance_text: '', pat_appearance_media_url: '' }).join(), ev);
  assert.match(errs({ pat_appearance_text: ' ', pat_appearance_media_url: 'javascript:alert(1)' }).join(), ev);
  assert.deepEqual(errs({ pat_appearance_text: '', pat_appearance_media_url: 'https://example.org/gorunum.jpg' }), []);
});

test('caseWarnings_ — engellemeyen uyarılar', () => {
  const w = j(C.caseWarnings_(Object.assign({}, byId['CASE-004'], {
    triage_feedback: '', clinical_category: 'Kardiyoloji', case_title: '',
    pat_appearance_text: '', pat_appearance_media_url: '',
    pat_work_of_breathing_media_url: 'javascript:alert(1)'
  }))).join(' | ');
  assert.match(w, /triage_feedback boş/);
  assert.match(w, /clinical_category izinli listede değil/);
  assert.doesNotMatch(w, /pat_appearance_text/, 'kanıtsız bileşen artık engelleyici hata (validateCase_)');
  assert.match(w, /pat_work_of_breathing_media_url geçerli bir http\(s\) bağlantısı değil/);
  assert.match(w, /case_title boş/);
});

test('clientCase_ — referans, gerekçe, başlık ve kategori asla gitmez', () => {
  const allowed = ['case_id', 'case_version', 'session_order', 'age', 'age_unit', 'gender', 'chief_complaint',
    'case_description', 'temperature_value', 'temperature_unit', 'heart_rate_value', 'respiratory_rate_value',
    'systolic_blood_pressure', 'diastolic_blood_pressure', 'spo2_value',
    'pat_appearance_text', 'pat_appearance_media_url', 'pat_work_of_breathing_text', 'pat_work_of_breathing_media_url',
    'pat_circulation_to_skin_text', 'pat_circulation_to_skin_media_url'];
  SEEDS.forEach((c) => {
    const out = j(C.clientCase_(c));
    assert.deepEqual(Object.keys(out).sort(), allowed.slice().sort());
    const text = JSON.stringify(out);
    [c.case_title, c.triage_feedback, c.appearance_feedback, c.vital_signs_feedback].forEach((secret) => {
      assert.ok(!text.includes(secret), c.case_id);
    });
  });
  const withMedia = j(C.clientCase_(Object.assign({}, byId['CASE-001'], {
    pat_appearance_media_url: 'javascript:alert(1)', pat_work_of_breathing_media_url: 'https://youtu.be/dQw4w9WgXcQ'
  })));
  assert.equal(withMedia.pat_appearance_media_url, '');
  assert.equal(withMedia.pat_work_of_breathing_media_url, 'https://youtu.be/dQw4w9WgXcQ');
});

test('err_ — mesaj yer tutucuları', () => {
  assert.deepEqual(j(C.err_('E_CONFIG')), {
    error: 'Yapılandırma hatası: CURRENT_SESSION 0 ile 5 arasında bir tam sayı olmalıdır.', code: 'E_CONFIG'
  });
  assert.equal(C.err_('E_USER_ID_TOO_LONG').error, 'Katılımcı kodu en fazla 40 karakter olabilir.');
  assert.equal(C.err_('E_SESSION_NOT_READY', { n: 2, k: 3, m: 2 }).error,
    'Oturum 2 için vaka bankası hazır değil (beklenen 3, bulunan 2). Lütfen araştırmacıyla iletişime geçin.');
  assert.equal(C.err_('E_MISSING_FIELD', { field: 'caseId' }).error, 'Eksik gönderim: caseId alanı eksik.');
  assert.equal(C.err_('NOPE').code, 'E_INTERNAL');
});

test('summarizeRows_ — ortak oturum özetleyici (§18.2.1)', () => {
  const row = (ref, user, extra) => Object.assign({
    reference_triage_level: ref, user_triage_level: user,
    triage_exact_match: ref === user ? 1 : 0, pat_total_score: 3, vital_sign_total_score: 5,
    dangerous_under_triage: ref === 'KIRMIZI' && user !== 'KIRMIZI' ? 1 : 0
  }, extra);
  const t = j(C.summarizeRows_([
    row('YESIL', 'YESIL', { pat_total_score: 3, vital_sign_total_score: 5, response_time_seconds: 60.2, user_triage_confidence: 3 }),
    row('KIRMIZI', 'SARI', { pat_total_score: 2, vital_sign_total_score: 4, response_time_seconds: '', user_triage_confidence: 1 }),
    row('SARI', 'SARI', { pat_total_score: 1, vital_sign_total_score: 3, response_time_seconds: 30.1, user_triage_confidence: '3' })
  ]));
  assert.deepEqual(t, {
    casesDone: 3, triageExact: 2, pat: 6, vital: 12, dangerousUnderTriage: 1, totalTimeSeconds: 90.3,
    confidenceCounts: { 1: 1, 2: 0, 3: 2 }, confidenceMean: 2.3,
    perfectCases: 1
  });
  // Güven yoksa ortalama null
  const none = j(C.summarizeRows_([row('SARI', 'SARI', { user_triage_confidence: '' })]));
  assert.equal(none.confidenceMean, null);
  assert.deepEqual(none.confidenceCounts, { 1: 0, 2: 0, 3: 0 });
  // Kusursuz vaka: PDÜ 3/3 + vital 5/5 + triyaj birebir; biri eksikse sayılmaz
  const perfect = (rows) => C.summarizeRows_(rows).perfectCases;
  assert.equal(perfect([row('SARI', 'SARI'), row('YESIL', 'YESIL'), row('KIRMIZI', 'KIRMIZI')]), 3);
  assert.equal(perfect([row('SARI', 'SARI', { vital_sign_total_score: 4 })]), 0);
  assert.equal(perfect([row('SARI', 'SARI', { pat_total_score: 2 })]), 0);
  assert.equal(perfect([row('KIRMIZI', 'SARI')]), 0);
  assert.equal(perfect([row('SARI', 'SARI', { pat_total_score: '3', vital_sign_total_score: '5', triage_exact_match: '1' })]), 1);
  assert.equal(perfect([]), 0);
  assert.ok(!('redAreaCorrect' in t) && !('greenAreaCorrect' in t), 'yalnızca Kırmızı Nöbetçi için tutulan toplamlar kaldırıldı');
});

test('katılımcı izin listesi — eşleştirme anahtarı, kanonik kod, denetim', () => {
  const list = [
    { user_id: 'P-014', active_status: 1 }, { user_id: 'P-015', active_status: 0 },
    { user_id: '  p-020 ', active_status: '1' }, { user_id: '-016', active_status: 1 }, { user_id: 'P-021', active_status: '' }
  ];
  assert.equal(C.participantKey_(' p-0 14 '), 'P014');
  assert.equal(C.participantKey_('Ş-01'), 'Ş01');
  assert.equal(C.findParticipant_(list, 'P014'), 'P-014');
  assert.equal(C.findParticipant_(list, 'P-014'), 'P-014');
  assert.equal(C.findParticipant_(list, 'P-020'), 'P-020', 'listedeki değer normalleştirilerek döner');
  assert.equal(C.findParticipant_(list, 'P-015'), null, 'pasif');
  assert.equal(C.findParticipant_(list, 'P-021'), null, 'active_status boş = pasif');
  assert.equal(C.findParticipant_(list, '016'), null, 'listedeki geçersiz kod eşleşmez');
  assert.equal(C.findParticipant_(list, 'P-14'), null, 'baştaki sıfır farklı koddur');
  assert.equal(C.findParticipant_(list, ''), null);
  const a = j(C.participantAudit_(list.concat([{ user_id: 'p014', active_status: 1 }]).map((row, i) => ({ row, rowNumber: i + 2 }))));
  assert.deepEqual([a.active, a.inactive], [3, 2]);
  const text = a.lines.join('\n');
  assert.match(text, /HATA satır 5: geçersiz kod \("-016"\)/);
  assert.match(text, /UYARI P-021 \(satır 6\): active_status 0 veya 1 değil → pasif sayılır/);
  assert.match(text, /HATA aynı kabul edilen kodlar: P-014 \(satır 2\), P014 \(satır 7\)/);
});

test('yer tutucu tespiti ve oturum kapatma durumu', () => {
  assert.deepEqual(j(C.placeholderIds_([byId['CASE-001'], Object.assign({}, byId['CASE-002'], { case_description: 'Gözden geçirildi.' })])), ['CASE-001']);
  const now = new Date('2026-12-03T10:00:00.000Z');
  const r = (uid, caseId, extra) => Object.assign({ user_id: uid, case_id: caseId, case_submission_time: '2026-12-03T09:20:00.000Z',
    feedback_viewed: 0, feedback_viewed_time: '' }, extra);
  const viewed = (min) => ({ feedback_viewed: 1, feedback_viewed_time: new Date(now.getTime() - min * 60000).toISOString() });
  const a = j(C.sessionActivity_([
    r('P-1', 'C1'), r('P-1', 'C2'),                                                   // vakası eksik
    r('P-2', 'C1', viewed(10)), r('P-2', 'C2', viewed(10)), r('p-2 ', 'C3', viewed(10)), // pencere açık (normalleştirilmiş kod)
    r('P-3', 'C1', viewed(40)), r('P-3', 'C2', viewed(40)), r('P-3', 'C3', viewed(40)), // pencere kapandı
    r('P-4', 'C1'), r('P-4', 'C2'), r('P-4', 'C3', { case_submission_time: '2026-12-03T09:48:30.000Z' }) // özet hiç verilmedi
  ], now));
  assert.deepEqual(a, { participants: 4, inProgress: 1, windowOpen: 1, neverViewed: 1, minutesSinceLastSubmission: 11 });
  assert.equal(C.sessionActivity_([], now).minutesSinceLastSubmission, null);
});

test('parseConfidence_ — yalnızca 1/2/3', () => {
  [1, 2, 3].forEach((v) => assert.equal(C.parseConfidence_(v), v));
  ['1', '2', '3'].forEach((v) => assert.equal(C.parseConfidence_(v), Number(v)));
  [0, 4, '4', '', null, undefined, true, 2.5, ' 2', '02'].forEach((v) => assert.equal(C.parseConfidence_(v), null, String(v)));
});

test('isSummaryWindowOpen_ — tamamlama kilidi penceresi (§19.2)', () => {
  const now = new Date('2026-12-03T10:00:00.000Z');
  const ago = (min) => new Date(now.getTime() - min * 60000).toISOString();
  assert.equal(C.isSummaryWindowOpen_([{ feedback_viewed_time: '' }, {}], now), true, 'hiç görülmedi');
  assert.equal(C.isSummaryWindowOpen_([{ feedback_viewed_time: ago(10) }], now), true);
  assert.equal(C.isSummaryWindowOpen_([{ feedback_viewed_time: ago(30) }], now), true, 'sınır dahil');
  assert.equal(C.isSummaryWindowOpen_([{ feedback_viewed_time: ago(31) }], now), false);
  // En erken görüntüleme esas alınır
  assert.equal(C.isSummaryWindowOpen_([{ feedback_viewed_time: ago(5) }, { feedback_viewed_time: ago(45) }], now), false);
  // Date nesnesi de okunur; bozuk değer yok sayılır
  assert.equal(C.isSummaryWindowOpen_([{ feedback_viewed_time: new Date(ago(10)) }, { feedback_viewed_time: 'bozuk' }], now), true);
  const zero = loadCode({ config: { SUMMARY_REVIEW_WINDOW_MINUTES: 0 } }).ctx;
  assert.equal(zero.isSummaryWindowOpen_([{ feedback_viewed_time: '' }], now), true, 'pencere 0: ilk görüntüleme serbest');
  assert.equal(zero.isSummaryWindowOpen_([{ feedback_viewed_time: ago(1) }], now), false);
});

test('T40 — kodda güvene dayalı puan/çarpan tanımlayıcısı yok', () => {
  const fs = require('fs');
  const path = require('path');
  const { ROOT } = require('./harness');
  ['Code.gs', 'index.html'].forEach((f) => {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(src, /wager|game_?points|calibration|kalibrasyon/i, f);
  });
});
