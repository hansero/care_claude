'use strict';
// Sunucu kabul testleri (Plan §14) — sahte E-Tablo üzerinde uçtan uca.
// Çalıştırma: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCode } = require('./harness');

const j = (x) => JSON.parse(JSON.stringify(x));

/** Boş e-tabloda initializeDatabase çalıştırılmış ortam. */
function fresh(session = 1, config) {
  const g = loadCode({ session, config });
  g.ctx.initializeDatabase();
  g.env.logs.length = 0;
  return g;
}
/** Aynı e-tabloyu farklı CURRENT_SESSION / CONFIG ile kullanan yeni sürüm ("yeniden dağıtım"). */
function redeploy(g, session, config) { return loadCode({ session, config, env: g.env }); }

const SEEDS = j(loadCode().ctx.seedCases_());
const byId = Object.fromEntries(SEEDS.map((c) => [c.case_id, c]));
const ANSWERS = [
  ['user_pat_appearance', 'pat_appearance_reference'],
  ['user_pat_work_of_breathing', 'pat_work_of_breathing_reference'],
  ['user_pat_circulation_to_skin', 'pat_circulation_to_skin_reference'],
  ['user_temperature_classification', 'temperature_reference'],
  ['user_heart_rate_classification', 'heart_rate_reference'],
  ['user_respiratory_rate_classification', 'respiratory_rate_reference'],
  ['user_blood_pressure_classification', 'blood_pressure_reference'],
  ['user_spo2_classification', 'spo2_reference']
];

function payload(start, caseId, patch) {
  const c = byId[caseId];
  const p = {
    userId: start.userId, loginId: start.loginId, sessionNumber: start.sessionNumber, caseId,
    caseStartTime: new Date(Date.now() - 60000).toISOString(), responseTimeSeconds: 60.04,
    deviceType: 'desktop', honorAccepted: true
  };
  ANSWERS.forEach(([ans, ref]) => { p[ans] = c[ref]; });
  p.user_triage_level = c.reference_triage_level;
  p.user_triage_confidence = 2;
  return Object.assign(p, patch || {});
}
function sheet(g, name) { return g.env.ss.getSheetByName(name); }
function rows(g, name) { return sheet(g, name).rowObjects(); }
function login(g, uid = 'P-001', honor = true) {
  const s = g.call('startSession', uid, honor);
  assert.ok(!s.error, JSON.stringify(s));
  return s;
}
function completeSession(g, uid, patches = {}) {
  const s = login(g, uid);
  return s.cases.map((c) => g.call('submitCase', payload(s, c.case_id, patches[c.case_id])));
}

/* ---------------------------------------------------------------- Kurulum */

test('T01 — boş e-tabloda initializeDatabase: CaseDetails (15 vaka) + Session1…5 aynı başlıklarla', () => {
  const g = loadCode();
  assert.equal(g.call('initializeDatabase'), undefined, 'rapor istemciye döndürülmemeli');
  const RH = j(g.get('RESPONSE_HEADERS'));
  const CH = j(g.get('CASE_HEADERS'));
  const cs = sheet(g, 'CaseDetails');
  assert.equal(cs.getLastRow(), 16);
  assert.deepEqual(cs.getRange(1, 1, 1, CH.length).getValues()[0], CH);
  assert.equal(cs._frozen, 1);
  assert.ok(cs._bold[0].slice(0, CH.length).every(Boolean));
  const first = sheet(g, 'Session1').getRange(1, 1, 1, RH.length).getValues()[0];
  assert.deepEqual(first, RH);
  for (let n = 1; n <= 5; n++) {
    const s = sheet(g, 'Session' + n);
    assert.ok(s, 'Session' + n);
    assert.equal(s.getLastColumn(), RH.length);
    assert.deepEqual(s.getRange(1, 1, 1, RH.length).getValues()[0], first);
    assert.ok(s.getMaxRows() >= 1000);
    assert.equal(s._frozen, 1);
    j(g.get('TEXT_FORMAT_COLUMNS')).forEach((h) => {
      const col = RH.indexOf(h);
      for (let r = 1; r < s.getMaxRows(); r++) assert.equal(s._formats[r][col], '@', `Session${n} ${h} satır ${r + 1}`);
    });
    assert.equal(s._formats[1][RH.indexOf('session_number')], null);
  }
  assert.ok(sheet(g, 'Sayfa1'), 'varsayılan sayfaya dokunulmaz');
  assert.match(g.env.logs.join('\n'), /=== VAKA BANKASI DENETİMİ ===/);
});

test('T02 — initializeDatabase ikinci kez: hiçbir veri değişmez', () => {
  const g = fresh();
  const s = completeSession(g, 'P-777');
  assert.ok(s.every((r) => r.ok));
  const before = g.env.ss.snapshot();
  g.ctx.initializeDatabase();
  assert.equal(g.env.ss.snapshot(), before);
});

test('T03 — v1 CaseDetails varken E_CASE_SHEET_V1; UserInput sayfasına dokunulmaz', () => {
  const g = loadCode();
  const v1 = g.env.ss.insertSheet('CaseDetails');
  v1.getRange(1, 1, 2, 4).setValues([['case_id', 'case_order', 'ctas_level', 'case_title'], ['C1', 1, 'T2', 'x']]);
  const ui = g.env.ss.insertSheet('UserInput');
  ui.getRange(1, 1, 2, 3).setValues([['participant_id', 'case_id', 'triage'], ['P1', 'C1', 'T2']]);
  const before = g.env.ss.snapshot();
  assert.throws(() => g.ctx.initializeDatabase(), /CaseDetails sayfası eski \(v1\) yapıda/);
  assert.equal(g.env.ss.snapshot(), before);
  assert.equal(sheet(g, 'Session1'), null);
});

test('T04 — auditCaseDataset: 5 oturumun tümü 3/3 · {1,2,3} · K/S/Y ✓; hata yok', () => {
  const g = fresh(2);
  assert.equal(g.call('auditCaseDataset'), undefined);
  const log = g.env.logs.join('\n');
  for (let n = 1; n <= 5; n++) {
    assert.match(log, new RegExp('Oturum ' + n + ': 3/3 vaka · sıra \\{1,2,3\\} · K/S/Y ✓ · Session' + n + ' ✓\\n'));
  }
  assert.doesNotMatch(log, /GEÇERSİZ|HATA|UYARI|HAZIR DEĞİL/);
  assert.match(log, /Anormal referanslar: GG 4 · Sİ 3 · CD 3 · Ateş 7 · KH 8 · SS 5 · KB 2 · SpO2 3/);
  assert.match(log, /Referans triyaj: Kırmızı 5 · Sarı 5 · Yeşil 5/);
  assert.match(log, /AKTİF OTURUM: CURRENT_SESSION = 2 → HAZIR$/m);
  assert.match(log, /Oyun bileşenleri: güven düzeyi AÇIK · Gelişimim AÇIK · rozetler AÇIK · özet yeniden açma süresi 30 dk/);
});

test('auditCaseDataset — sorunları raporlar', () => {
  const g = fresh(1);
  const cs = sheet(g, 'CaseDetails');
  const CH = j(g.get('CASE_HEADERS'));
  cs.getRange(2, CH.indexOf('reference_triage_level') + 1).setValue('KIRMIZI_K1');   // CASE-001 → geçersiz
  cs.getRange(3, CH.indexOf('clinical_category') + 1).setValue('');                 // CASE-002 → uyarı
  g.ctx.auditCaseDataset();
  const log = g.env.logs.join('\n');
  assert.match(log, /CASE-001: GEÇERSİZ reference_triage_level geçersiz/);
  assert.match(log, /CASE-002: UYARI clinical_category boş/);
  assert.match(log, /Oturum 1: 2\/3 vaka · sıra \{2,3\} · UYARI renk dağılımı K1\/S1\/Y0/);
  assert.match(log, /AKTİF OTURUM: CURRENT_SESSION = 1 → HAZIR DEĞİL/);
  g.env.logs.length = 0;
  redeploy(g, 0).ctx.auditCaseDataset();
  assert.match(g.env.logs.join('\n'), /CURRENT_SESSION = 0 → OYUN KAPALI/);
});

test('T05 — CaseDetails açılır liste kuralları', () => {
  const g = fresh();
  const cs = sheet(g, 'CaseDetails');
  const CH = j(g.get('CASE_HEADERS'));
  const ruleAt = (h, row) => cs._validation[row - 1][CH.indexOf(h)];
  const expect = {
    reference_triage_level: ['KIRMIZI', 'SARI', 'YESIL'],
    session: ['1', '2', '3', '4', '5'],
    session_order: ['1', '2', '3'],
    active_status: ['0', '1'],
    spo2_reference: ['0', '1'],
    pat_appearance_reference: ['0', '1'],
    age_unit: ['gün', 'ay', 'yaş'],
    clinical_category: ['Solunum', 'Enfeksiyon/Ateş', 'Nörolojik', 'Gastrointestinal', 'Travma'],
    difficulty_level: ['Kolay', 'Orta', 'Zor']
  };
  Object.entries(expect).forEach(([h, list]) => {
    [2, 500, cs.getMaxRows()].forEach((row) => {
      const rule = ruleAt(h, row);
      assert.ok(rule, h + ' satır ' + row);
      assert.deepEqual(j(rule.list), list);
      assert.equal(rule.allowInvalid, false);
    });
  });
  assert.equal(ruleAt('reference_triage_level', 1), null, 'başlık satırında kural olmamalı');
});

/* ---------------------------------------------------------------- Oturum kontrolü */

function bootOf(g) {
  const out = g.ctx.doGet();
  const m = out.getContent().match(/var BOOT = (\{.*?\});/);
  assert.ok(m, 'BOOT satırı');
  return { boot: JSON.parse(m[1]), out };
}

test('T06 — CURRENT_SESSION = 0: kapalı', () => {
  const g = fresh(0);
  assert.equal(bootOf(g).boot.activeSession, 0);
  assert.deepEqual(g.call('startSession', 'P-1', true), {
    status: 'closed', totalSessions: 5,
    message: 'Şu anda aktif bir oturum bulunmamaktadır. Oturum açıldığında araştırmacı tarafından bilgilendirileceksiniz.'
  });
  assert.equal(g.call('submitCase', { sessionNumber: 1 }).code, 'E_CLOSED');
  assert.equal(g.call('getSessionSummary', 'P-1').code, 'E_CLOSED');
});

test('T07 — CURRENT_SESSION = 2: CASE-004, CASE-005, CASE-006 bu sırayla', () => {
  const g = fresh(2);
  const { boot, out } = bootOf(g);
  assert.deepEqual(boot, {
    activeSession: 2, totalSessions: 5, casesPerSession: 3, appVersion: '2.2.0', requireHonor: true,
    appUrl: 'https://script.google.com/macros/s/TEST/exec'
  });
  assert.equal(out.title, 'Pediatrik Triyaj — PDÜ Değerlendirmesi');
  assert.deepEqual(out.meta, [['viewport', 'width=device-width, initial-scale=1']]);
  const s = login(g);
  assert.equal(s.status, 'active');
  assert.equal(s.sessionNumber, 2);
  assert.deepEqual(s.cases.map((c) => [c.case_id, c.session_order]), [['CASE-004', 1], ['CASE-005', 2], ['CASE-006', 3]]);
  assert.deepEqual(s.triageLevels.map((t) => t.code), ['KIRMIZI', 'SARI', 'YESIL']);
  assert.ok(s.triageLevels.every((t) => t.hint.length > 0));
  assert.match(s.loginId, /^L-[0-9a-f-]{36}$/);
});

test('T08 — geçersiz CURRENT_SESSION → E_CONFIG; doGet yapılandırma hatası (-1)', () => {
  ['7', '-1', '1.5', "'2'", 'null', 'NaN'].forEach((v) => {
    const g = loadCode({ session: v });
    assert.equal(bootOf(g).boot.activeSession, -1, v);
    const r = g.call('startSession', 'P-1', true);
    assert.equal(r.code, 'E_CONFIG', v);
    assert.equal(r.error, 'Yapılandırma hatası: CURRENT_SESSION 0 ile 5 arasında bir tam sayı olmalıdır.');
    assert.equal(g.call('submitCase', {}).code, 'E_CONFIG');
    assert.equal(g.call('getSessionSummary', 'P-1').code, 'E_CONFIG');
  });
});

test('T09 — 2. oturum yanıtları yalnızca Session2 sayfasına yazılır', () => {
  const g = fresh(2);
  const before = [1, 3, 4, 5].map((n) => sheet(g, 'Session' + n).snapshot());
  const res = completeSession(g, 'P-009');
  assert.ok(res.every((r) => r.ok));
  assert.equal(rows(g, 'Session2').length, 3);
  assert.deepEqual([1, 3, 4, 5].map((n) => sheet(g, 'Session' + n).snapshot()), before);
  assert.ok(rows(g, 'Session2').every((r) => r.session_number === 2));
});

test('T10 — oturumda bir vaka pasifse E_SESSION_NOT_READY (beklenen 3, bulunan 2)', () => {
  const g = fresh(2);
  const CH = j(g.get('CASE_HEADERS'));
  sheet(g, 'CaseDetails').getRange(6, CH.indexOf('active_status') + 1).setValue(0);   // CASE-005
  const r = g.call('startSession', 'P-1', true);
  assert.equal(r.code, 'E_SESSION_NOT_READY');
  assert.equal(r.error, 'Oturum 2 için vaka bankası hazır değil (beklenen 3, bulunan 2). Lütfen araştırmacıyla iletişime geçin.');
});

test('oturum hazırlığı: yinelenen session_order da engeller', () => {
  const g = fresh(1);
  const CH = j(g.get('CASE_HEADERS'));
  sheet(g, 'CaseDetails').getRange(3, CH.indexOf('session_order') + 1).setValue(1);   // CASE-002 → 1
  assert.equal(g.call('startSession', 'P-1', true).code, 'E_SESSION_NOT_READY');
});

test('CaseDetails sütun sırası serbesttir (okuma başlık adına göre)', () => {
  const g = fresh(1);
  const cs = sheet(g, 'CaseDetails');
  const all = cs.getRange(1, 1, cs.getLastRow(), cs.getLastColumn()).getValues();
  const reordered = all.map((r) => r.slice().reverse());
  cs.getRange(1, 1, reordered.length, reordered[0].length).setValues(reordered);
  const s = login(g);
  assert.deepEqual(s.cases.map((c) => c.case_id), ['CASE-001', 'CASE-002', 'CASE-003']);
  assert.ok(g.call('submitCase', payload(s, 'CASE-001')).ok);
});

/* ---------------------------------------------------------------- Giriş */

test('T11 — boş kod / onur beyanı / uzunluk / formül karakteri', () => {
  const g = fresh(1);
  assert.equal(g.call('startSession', '', true).code, 'E_USER_ID_REQUIRED');
  assert.equal(g.call('startSession', '   ', true).code, 'E_USER_ID_REQUIRED');
  assert.equal(g.call('startSession', null, true).code, 'E_USER_ID_REQUIRED');
  assert.equal(g.call('startSession', 'P-1', false).code, 'E_HONOR_REQUIRED');
  assert.equal(g.call('startSession', 'P-1', 'true').code, 'E_HONOR_REQUIRED');
  assert.equal(g.call('startSession', 'P'.repeat(41), true).code, 'E_USER_ID_TOO_LONG');
  assert.equal(g.call('startSession', '=HYPERLINK("x")', true).code, 'E_USER_ID_INVALID');
});

test('T12 — "  p-014 " ve "P-014" aynı kullanıcı (user_id = P-014)', () => {
  const g = fresh(1);
  const s1 = login(g, '  p-014 ');
  assert.equal(s1.userId, 'P-014');
  assert.ok(g.call('submitCase', payload(s1, 'CASE-001', { userId: '  p-014 ' })).ok);
  const s2 = login(g, 'P-014');
  assert.deepEqual(s2.completedCaseIds, ['CASE-001']);
  assert.notEqual(s2.loginId, s1.loginId);
  assert.equal(rows(g, 'Session1')[0].user_id, 'P-014');
});

test('T13 — "014" baştaki sıfır korunarak; zaman damgaları metin olarak yazılır', () => {
  const g = fresh(1);
  const s = login(g, '014');
  assert.ok(g.call('submitCase', payload(s, 'CASE-001')).ok);
  const r = rows(g, 'Session1')[0];
  assert.equal(r.user_id, '014');
  assert.equal(typeof r.case_start_time, 'string');
  assert.equal(typeof r.case_submission_time, 'string');
  assert.equal(r.app_version, '2.2.0');
  assert.deepEqual(login(g, '014').completedCaseIds, ['CASE-001']);
});

test('satır bitince ROW_GROWTH_CHUNK kadar satır eklenir ve metin biçimi uygulanır', () => {
  const g = fresh(1, { ROW_GROWTH_CHUNK: 2 });
  const s1 = sheet(g, 'Session1');
  // Sayfayı 3 satıra küçült (başlık + 2 veri satırı) → 3. yazım büyümeyi tetikler.
  ['_data', '_formats', '_bold', '_validation'].forEach((k) => { s1[k].length = 3; });
  ['001', '002', '003', '004'].forEach((uid) => {
    const s = login(g, uid);
    const res = g.call('submitCase', payload(s, 'CASE-001'));
    assert.ok(res.ok, JSON.stringify(res));
  });
  assert.equal(s1.getMaxRows(), 5);
  assert.deepEqual(rows(g, 'Session1').map((r) => r.user_id), ['001', '002', '003', '004']);
  assert.ok(rows(g, 'Session1').every((r) => typeof r.case_submission_time === 'string'));
});

/* ---------------------------------------------------------------- Vaka akışı */

test('T15 — startSession yanıtında referans / gerekçe / başlık yok', () => {
  const g = fresh(1);
  const s = login(g);
  const text = JSON.stringify(s);
  assert.doesNotMatch(text, /reference|feedback|case_title|clinical_category|difficulty|_correct|active_status/);
  SEEDS.forEach((c) => {
    [c.case_title, c.triage_feedback, c.appearance_feedback, c.work_of_breathing_feedback,
      c.circulation_feedback, c.vital_signs_feedback].forEach((secret) => assert.ok(!text.includes(secret), c.case_id));
  });
});

test('T17 — submitCase yanıtı yalnızca izinli alanları içerir', () => {
  const g = fresh(1);
  const s = login(g);
  const r = g.call('submitCase', payload(s, 'CASE-001'));
  assert.deepEqual(r, { ok: true, caseId: 'CASE-001', sessionOrder: 1, completedCount: 1, casesPerSession: 3, sessionComplete: false });
});

test('T18 — 2 vaka sonrası yeniden giriş: kalan vaka 3', () => {
  const g = fresh(1);
  const s = login(g);
  assert.ok(g.call('submitCase', payload(s, 'CASE-001')).ok);
  assert.ok(g.call('submitCase', payload(s, 'CASE-002')).ok);
  const again = login(g);
  assert.equal(again.status, 'active');
  assert.deepEqual(again.completedCaseIds, ['CASE-001', 'CASE-002']);
});

test('T19 — aynı vaka ikinci kez → E_DUPLICATE, ikinci satır yazılmaz', () => {
  const g = fresh(1);
  const s = login(g);
  assert.ok(g.call('submitCase', payload(s, 'CASE-001')).ok);
  const r = g.call('submitCase', payload(s, 'CASE-001', { user_triage_level: 'KIRMIZI' }));
  assert.equal(r.code, 'E_DUPLICATE');
  assert.equal(r.error, 'Bu vaka daha önce gönderilmiş olup değiştirilemez.');
  assert.equal(rows(g, 'Session1').length, 1);
});

test('T20 — sırasız gönderim → E_OUT_OF_ORDER', () => {
  const g = fresh(1);
  const s = login(g);
  assert.equal(g.call('submitCase', payload(s, 'CASE-003')).code, 'E_OUT_OF_ORDER');
  assert.ok(g.call('submitCase', payload(s, 'CASE-001')).ok);
  assert.equal(g.call('submitCase', payload(s, 'CASE-003')).code, 'E_OUT_OF_ORDER');
  assert.equal(rows(g, 'Session1').length, 1);
});

test('T21 — başka oturumun vakası → E_CASE_NOT_IN_SESSION', () => {
  const g = fresh(1);
  const s = login(g);
  assert.equal(g.call('submitCase', payload(s, 'CASE-004')).code, 'E_CASE_NOT_IN_SESSION');
  assert.equal(g.call('submitCase', Object.assign(payload(s, 'CASE-001'), { caseId: 'CASE-999' })).code, 'E_CASE_NOT_IN_SESSION');
});

test('T22 — katı ikili yanıt ve triyaj beyaz listesi', () => {
  const g = fresh(1);
  const s = login(g);
  const bad = (patch) => g.call('submitCase', payload(s, 'CASE-001', patch));
  assert.deepEqual(bad({ user_pat_appearance: 2 }), {
    error: 'Geçersiz yanıt değeri: user_pat_appearance yalnızca 0 veya 1 olabilir.', code: 'E_INVALID_BINARY'
  });
  assert.equal(bad({ user_spo2_classification: true }).code, 'E_INVALID_BINARY');
  assert.equal(bad({ user_spo2_classification: 'evet' }).code, 'E_INVALID_BINARY');
  ['T1', 'KIRMIZI_K1', 'SARI_K2', 'kirmizi', 'Yeşil'].forEach((lvl) => {
    assert.equal(bad({ user_triage_level: lvl }).code, 'E_INVALID_TRIAGE', lvl);
  });
  assert.deepEqual(bad({ user_heart_rate_classification: null }), {
    error: 'Eksik gönderim: user_heart_rate_classification alanı eksik.', code: 'E_MISSING_FIELD'
  });
  assert.equal(bad({ loginId: 'hack' }).code, 'E_MISSING_FIELD');
  assert.equal(bad({ caseStartTime: 'dün' }).code, 'E_MISSING_FIELD');
  assert.equal(bad({ honorAccepted: false }).code, 'E_HONOR_REQUIRED');
  assert.equal(rows(g, 'Session1').length, 0);
  assert.ok(bad({ user_pat_appearance: '0' }).ok, '"0" metni kabul edilir');
});

test('T23 — oturum değiştiğinde gönderim → E_SESSION_CHANGED', () => {
  const g = fresh(1);
  const s = login(g);
  const g2 = redeploy(g, 2);
  assert.equal(g2.call('submitCase', payload(s, 'CASE-001')).code, 'E_SESSION_CHANGED');
  assert.equal(rows(g, 'Session1').length + rows(g, 'Session2').length, 0);
});

/* ---------------------------------------------------------------- Puanlama (satır düzeyi) */

test('T25 — CASE-002 tüm yanıtlar doğru → satır puanları', () => {
  const g = fresh(1);
  const s = login(g);
  g.call('submitCase', payload(s, 'CASE-001'));
  g.call('submitCase', payload(s, 'CASE-002'));
  const r = rows(g, 'Session1')[1];
  assert.equal(r.case_id, 'CASE-002');
  assert.equal(r.pat_total_score, 3);
  assert.equal(r.complete_pat_correct, 1);
  assert.equal(r.vital_sign_total_score, 5);
  assert.equal(r.triage_exact_match, 1);
  assert.equal(r.case_global_order, 2);
});

test('T26 (uyarlanmış) — CASE-006 (KIRMIZI) için SARI seçimi satıra doğru yazılır', () => {
  const g = fresh(2);
  const s = login(g);
  g.call('submitCase', payload(s, 'CASE-004'));
  g.call('submitCase', payload(s, 'CASE-005'));
  const res = g.call('submitCase', payload(s, 'CASE-006', { user_triage_level: 'SARI' }));
  assert.equal(res.sessionComplete, true);
  const r = rows(g, 'Session2')[2];
  assert.equal(r.triage_difference, 1);
  assert.equal(r.under_triage, 1);
  assert.equal(r.over_triage, 0);
  assert.equal(r.triage_exact_match, 0);
  assert.equal(r.triage_within_one, 1);
  assert.equal(r.dangerous_under_triage, 1);
  assert.equal(r.reference_triage_level, 'KIRMIZI');
  assert.equal(r.user_triage_level, 'SARI');
  assert.equal(r.case_global_order, 6);
});

test('T27 — case_global_order (CASE-008 → 8) ve satır sütunları', () => {
  const g = fresh(3);
  const s = login(g, 'P-27');
  g.call('submitCase', payload(s, 'CASE-007'));
  g.call('submitCase', payload(s, 'CASE-008', { responseTimeSeconds: 131.46, deviceType: 'tablet' }));
  const r = rows(g, 'Session3')[1];
  assert.equal(r.case_global_order, 8);
  assert.equal(r.response_time_seconds, 131.5);
  assert.equal(r.device_type, 'tablet');
  assert.equal(r.study_id, 'PEDTRI-LC-01');
  assert.equal(r.honor_statement_accepted, 1);
  assert.equal(r.feedback_viewed, 0);
  assert.equal(r.feedback_viewed_time, '');
  assert.match(r.response_id, /^R-[0-9a-f-]{36}$/);
  assert.match(r.login_id, /^L-[0-9a-f-]{36}$/);
  assert.deepEqual(Object.keys(r), j(g.get('RESPONSE_HEADERS')));
});

/* ---------------------------------------------------------------- Toplu geri bildirim */

test('T28 — 3. vakadan sonra özet; toplamlar satırlarla tutarlı, sıra korunur', () => {
  const g = fresh(1);
  const res = completeSession(g, 'P-028', {
    'CASE-001': { user_pat_appearance: 1, responseTimeSeconds: 61.2 },         // PDÜ 1 hata
    'CASE-002': { user_triage_level: 'SARI', responseTimeSeconds: 70.4 },      // tehlikeli düşük triyaj
    'CASE-003': { user_spo2_classification: 1, user_triage_level: 'KIRMIZI', responseTimeSeconds: 90 }
  });
  assert.deepEqual(res.map((r) => [r.completedCount, r.sessionComplete]), [[1, false], [2, false], [3, true]]);
  const sum = g.call('getSessionSummary', 'p-028');
  const rs = rows(g, 'Session1');
  const total = (f) => rs.reduce((a, r) => a + Number(r[f]), 0);
  assert.deepEqual(sum.totals, {
    triageMax: 3, patMax: 9, vitalMax: 15, casesDone: 3,
    triageExact: total('triage_exact_match'),
    pat: total('pat_total_score'),
    vital: total('vital_sign_total_score'),
    dangerousUnderTriage: 1, totalTimeSeconds: 221.6,
    confidenceCounts: { 1: 0, 2: 3, 3: 0 }, confidenceMean: 2,
    redAreaCorrect: false, greenAreaCorrect: true
  });
  assert.ok(sum.cases.every((c) => c.confidence === 2));
  assert.deepEqual([sum.totals.triageExact, sum.totals.pat, sum.totals.vital], [1, 8, 14]);
  assert.deepEqual(sum.cases.map((c) => [c.sessionOrder, c.caseId]), [[1, 'CASE-001'], [2, 'CASE-002'], [3, 'CASE-003']]);
  const c1 = sum.cases[0];
  assert.equal(c1.caseTitle, byId['CASE-001'].case_title);
  assert.deepEqual(c1.pat[0], {
    user: 1, correct: 0, isCorrect: false, component: 'Genel Görünüm', explanation: byId['CASE-001'].appearance_feedback
  });
  assert.deepEqual(c1.vitals[0], { user: 1, correct: 1, isCorrect: true, sign: 'Ateş', value: '38,4 °C' });
  assert.equal(sum.cases[2].triage.directionText, '1 basamak yüksek triyaj');
  assert.equal(sum.cases[2].triage.referenceLabel, 'Sarı Alan');
  assert.equal(sum.cases[2].vitals[4].isCorrect, false);
});

test('T29 — 2 vaka tamamken özet kilitli, referans dönmez', () => {
  const g = fresh(1);
  const s = login(g);
  g.call('submitCase', payload(s, 'CASE-001'));
  g.call('submitCase', payload(s, 'CASE-002'));
  assert.deepEqual(g.call('getSessionSummary', s.userId), {
    error: 'Geri bildirim, oturumdaki üç vakanın tamamı gönderildikten sonra görüntülenebilir.', code: 'E_SUMMARY_LOCKED'
  });
  assert.ok(rows(g, 'Session1').every((r) => r.feedback_viewed === 0));
});

test('T30 — feedback_viewed ilk açılışta 1 olur; zaman damgası sonra değişmez', async () => {
  const g = fresh(1);
  completeSession(g, 'P-030');
  completeSession(g, 'P-031');
  g.call('getSessionSummary', 'P-030');
  const first = rows(g, 'Session1').filter((r) => r.user_id === 'P-030');
  assert.ok(first.every((r) => r.feedback_viewed === 1 && /^\d{4}-\d{2}-\d{2}T/.test(r.feedback_viewed_time)));
  assert.equal(typeof first[0].feedback_viewed_time, 'string');
  assert.ok(rows(g, 'Session1').filter((r) => r.user_id === 'P-031').every((r) => r.feedback_viewed === 0));
  await new Promise((resolve) => setTimeout(resolve, 15));
  g.call('getSessionSummary', 'P-030');
  const second = rows(g, 'Session1').filter((r) => r.user_id === 'P-030');
  assert.deepEqual(second.map((r) => r.feedback_viewed_time), first.map((r) => r.feedback_viewed_time));
});

test('T31 — oturumu tamamlayan katılımcı yeniden girer → status completed', () => {
  const g = fresh(1);
  completeSession(g, 'P-031');
  const s = login(g, 'p-031');
  assert.equal(s.status, 'summary');
  assert.deepEqual(s.completedCaseIds, ['CASE-001', 'CASE-002', 'CASE-003']);
});

test('T32 — tehlikeli düşük triyaj (KIRMIZI → YESIL)', () => {
  const g = fresh(1);
  completeSession(g, 'P-032', { 'CASE-002': { user_triage_level: 'YESIL' } });
  const sum = g.call('getSessionSummary', 'P-032');
  assert.equal(sum.totals.dangerousUnderTriage, 1);
  const t = sum.cases[1].triage;
  assert.equal(t.dangerousUnderTriage, true);
  assert.equal(t.directionText, '2 basamak düşük triyaj');
  assert.equal(t.userLabel, 'Yeşil Alan');
  assert.equal(t.referenceLabel, 'Kırmızı Alan');
  assert.equal(rows(g, 'Session1')[1].triage_within_one, 0);
});

/* ---------------------------------------------------------------- Güvenlik ve dayanıklılık */

test('araştırmacı fonksiyonları istemciye hiçbir şey döndürmez (referans sızıntısı yok)', () => {
  const g = fresh(1);
  assert.equal(g.call('previewSession', 3), undefined);
  assert.equal(g.call('auditCaseDataset'), undefined);
  assert.equal(g.call('initializeDatabase'), undefined);
  const log = g.env.logs.join('\n');
  assert.match(log, /=== OTURUM 3 ÖNİZLEME/);
  assert.match(log, /1\. CASE-007 \(v1\) · Septik şok \(peteşiyal döküntü\) · Referans: KIRMIZI \(Kırmızı Alan\)/);
  assert.match(log, /Vital Ateş 39,7 °C A · KH 190\/dk A/);
  g.env.logs.length = 0;
  g.ctx.previewSession();   // düzenleyiciden argümansız → CURRENT_SESSION
  assert.match(g.env.logs.join('\n'), /=== OTURUM 1 ÖNİZLEME/);
});

test('kilit alınamazsa E_BUSY; kilit her yolda dengeli bırakılır', () => {
  const g = fresh(1);
  const s = login(g);
  g.env.lockAvailable = false;
  assert.deepEqual(g.call('submitCase', payload(s, 'CASE-001')), {
    error: 'Sunucu şu anda yoğun. Lütfen birkaç saniye sonra tekrar deneyin.', code: 'E_BUSY'
  });
  g.env.lockAvailable = true;
  assert.equal(g.call('submitCase', payload(s, 'CASE-003')).code, 'E_OUT_OF_ORDER');
  assert.ok(g.call('submitCase', payload(s, 'CASE-001')).ok);
  assert.equal(g.env.lockHeld, false);
  assert.deepEqual(g.env.lockErrors, []);
});

test('özet: kilit alınamazsa yine döner, güncelleme atlanır ve günlüğe yazılır', () => {
  const g = fresh(1);
  completeSession(g, 'P-040');
  g.env.lockAvailable = false;
  const sum = g.call('getSessionSummary', 'P-040');
  assert.equal(sum.cases.length, 3);
  assert.ok(rows(g, 'Session1').every((r) => r.feedback_viewed === 0));
  assert.match(g.env.logs.join('\n'), /feedback_viewed güncellemesi atlandı/);
});

test('eksik / bozuk Session sayfası', () => {
  const g = fresh(1);
  sheet(g, 'Session1').getRange(1, 5).setValue('participant_id');
  assert.deepEqual(g.call('startSession', 'P-1', true), {
    error: '"Session1" sayfasının başlık satırı beklenen yapıyla uyuşmuyor.', code: 'E_SHEET_HEADERS'
  });
  assert.throws(() => g.ctx.initializeDatabase(), /Session1" sayfasının başlık satırı/);
  sheet(g, 'Session1')._name = 'Session1_eski';
  assert.equal(g.call('startSession', 'P-1', true).code, 'E_SHEET_MISSING');
});

test('beklenmeyen istisna → E_INTERNAL (istemciye ayrıntı sızmaz)', () => {
  const g = fresh(1);
  g.ctx.SpreadsheetApp.getActiveSpreadsheet = () => { throw new Error('gizli iç ayrıntı'); };
  const r = g.call('startSession', 'P-1', true);
  assert.equal(r.code, 'E_INTERNAL');
  assert.doesNotMatch(r.error, /gizli/);
  assert.match(g.env.consoleErrors.join('\n'), /gizli iç ayrıntı/);
});

test('REQUIRE_HONOR_STATEMENT = false ve SHOW_TRIAGE_HINTS = false', () => {
  const g = fresh(1, { REQUIRE_HONOR_STATEMENT: false, SHOW_TRIAGE_HINTS: false });
  assert.equal(bootOf(g).boot.requireHonor, false);
  const s = login(g, 'P-50', false);
  assert.ok(s.triageLevels.every((t) => t.hint === ''));
  assert.ok(g.call('submitCase', payload(s, 'CASE-001', { honorAccepted: false })).ok);
  assert.equal(rows(g, 'Session1')[0].honor_statement_accepted, 0);
});

test('boş Session sayfası initializeDatabase ile kurulur; ad başka sayfayla çakışmaz', () => {
  const g = loadCode();
  g.env.ss.insertSheet('Session3');
  g.ctx.initializeDatabase();
  assert.equal(sheet(g, 'Session3').getLastColumn(), j(g.get('RESPONSE_HEADERS')).length);
  assert.equal(g.env.ss.getSheets().filter((s) => s.getName() === 'Session3').length, 1);
});

/* ---------------------------------------------------------------- v2.1 — güven düzeyi ve Gelişimim (§18) */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Kullanıcının satırlarında feedback_viewed_time'ı "dakika önce"ye çeker (zaman yolculuğu yerine). */
function setViewedAgo(g, name, uid, minutes) {
  const sh = sheet(g, name);
  const RH = j(g.get('RESPONSE_HEADERS'));
  const iso = new Date(Date.now() - minutes * 60000).toISOString();
  for (let r = 2; r <= sh.getLastRow(); r++) {
    if (sh.getRange(r, RH.indexOf('user_id') + 1).getValue() === uid) {
      sh.getRange(r, RH.indexOf('feedback_viewed_time') + 1).setValue(iso);
    }
  }
}

test('§18.5 — startSession bileşen bayraklarını döndürür', () => {
  const g = fresh(1);
  const s = login(g);
  assert.equal(s.confidenceEnabled, true);
  assert.equal(s.learningCurveEnabled, true);
  assert.equal(s.badgesEnabled, true);
});

test('T38 — güven düzeyi zorunlu ve yalnızca 1–3; geçersizde satır yazılmaz', () => {
  const g = fresh(1);
  const s = login(g);
  assert.deepEqual(g.call('submitCase', payload(s, 'CASE-001', { user_triage_confidence: 4 })), {
    error: 'Geçersiz güven düzeyi: 1, 2 veya 3 olmalıdır.', code: 'E_INVALID_CONFIDENCE'
  });
  [0, '0', 2.5, true, 'emin', '4'].forEach((v) => {
    assert.equal(g.call('submitCase', payload(s, 'CASE-001', { user_triage_confidence: v })).code, 'E_INVALID_CONFIDENCE', String(v));
  });
  const missing = payload(s, 'CASE-001');
  delete missing.user_triage_confidence;
  assert.deepEqual(g.call('submitCase', missing), {
    error: 'Eksik gönderim: user_triage_confidence alanı eksik.', code: 'E_MISSING_FIELD'
  });
  assert.equal(g.call('submitCase', payload(s, 'CASE-001', { user_triage_confidence: '' })).code, 'E_MISSING_FIELD');
  assert.equal(rows(g, 'Session1').length, 0);
  assert.ok(g.call('submitCase', payload(s, 'CASE-001', { user_triage_confidence: '3' })).ok);
  assert.equal(rows(g, 'Session1')[0].user_triage_confidence, 3);
});

test('T39 — güven 1 ve 3 veren iki kullanıcının satırları yalnızca kimlik/zaman/güven alanlarında farklı', () => {
  const g = fresh(1);
  const a = login(g, 'P-A');
  const b = login(g, 'P-B');
  assert.ok(g.call('submitCase', payload(a, 'CASE-001', { user_triage_confidence: 1 })).ok);
  assert.ok(g.call('submitCase', payload(b, 'CASE-001', { user_triage_confidence: 3, responseTimeSeconds: 99 })).ok);
  const [ra, rb] = rows(g, 'Session1');
  const differ = ['response_id', 'user_id', 'login_id', 'case_start_time', 'case_submission_time',
    'response_time_seconds', 'user_triage_confidence'];
  j(g.get('RESPONSE_HEADERS')).filter((h) => !differ.includes(h)).forEach((h) => assert.deepEqual(ra[h], rb[h], h));
  assert.deepEqual([ra.user_triage_confidence, rb.user_triage_confidence], [1, 3]);
});

test('T42/T45 — Gelişimim: O1 ve O2 tamamlanmış; yalnızca sayısal alanlar, başka kullanıcı sayılmaz', () => {
  const g = fresh(1);
  completeSession(g, 'P-H');
  completeSession(g, 'P-OTHER', { 'CASE-001': { user_triage_level: 'KIRMIZI' }, 'CASE-003': { user_triage_level: 'YESIL' } });
  const g2 = redeploy(g, 2);
  completeSession(g2, 'P-H', { 'CASE-004': { user_triage_level: 'KIRMIZI', user_triage_confidence: 3 } });
  completeSession(g2, 'P-OTHER');
  const sum = g2.call('getSessionSummary', 'P-H');
  assert.deepEqual(sum.history.map((h) => [h.sessionNumber, h.status]),
    [[1, 'completed'], [2, 'completed'], [3, 'none'], [4, 'none'], [5, 'none']]);
  const [h1, h2] = sum.history;
  assert.deepEqual([h1.casesDone, h1.triageExact, h1.pat, h1.vital, h1.dangerousUnderTriage], [3, 3, 9, 15, 0]);
  assert.deepEqual([h2.casesDone, h2.triageExact, h2.pat, h2.vital], [3, 2, 9, 15]);
  assert.equal(h2.confidenceMean, 2.3);
  assert.deepEqual(h2.confidenceCounts, { 1: 0, 2: 2, 3: 1 });
  // T45: yalnızca sayısal özet; vaka kimliği, başlık, referans veya metin yok
  const allowed = ['sessionNumber', 'status', 'casesDone', 'triageExact', 'pat', 'vital', 'dangerousUnderTriage',
    'totalTimeSeconds', 'confidenceCounts', 'confidenceMean', 'redAreaCorrect', 'greenAreaCorrect'];
  sum.history.forEach((h) => Object.keys(h).forEach((k) => assert.ok(allowed.includes(k), k)));
  const text = JSON.stringify(sum.history);
  assert.doesNotMatch(text, /CASE-|case_|reference|feedback|title/i);
  SEEDS.forEach((c) => assert.ok(!text.includes(c.case_title)));
});

test('T43 — O2 atlanır: O1 ve O3 tamamlanmış, O2 "none"; yarım oturum "partial"', () => {
  const g = fresh(1);
  completeSession(g, 'P-SKIP');
  const half = login(g, 'P-HALF');
  g.call('submitCase', payload(half, 'CASE-001'));
  g.call('submitCase', payload(half, 'CASE-002'));
  const g3 = redeploy(g, 3);
  completeSession(g3, 'P-SKIP');
  completeSession(g3, 'P-HALF');
  assert.deepEqual(g3.call('getSessionSummary', 'P-SKIP').history.map((h) => h.status),
    ['completed', 'none', 'completed', 'none', 'none']);
  const hh = g3.call('getSessionSummary', 'P-HALF').history;
  assert.equal(hh[0].status, 'partial');
  assert.equal(hh[0].casesDone, 2);
});

test('T44 — yalnızca O1 tamamlanmış kullanıcının geçmişi', () => {
  const g = fresh(1);
  completeSession(g, 'P-ONE');
  const h = g.call('getSessionSummary', 'P-ONE').history;
  assert.deepEqual(h.map((x) => x.status), ['completed', 'none', 'none', 'none', 'none']);
});

test('T48 — bayraklar ayrı ayrı kapatılabilir', () => {
  const gc = fresh(1, { ENABLE_CONFIDENCE: false });
  const s = login(gc);
  assert.equal(s.confidenceEnabled, false);
  const p = payload(s, 'CASE-001');
  delete p.user_triage_confidence;
  assert.ok(gc.call('submitCase', p).ok, 'güvensiz 9 seçimle gönderim');
  assert.ok(gc.call('submitCase', payload(s, 'CASE-002', { user_triage_confidence: 3 })).ok, 'gelen güven yok sayılır');
  assert.deepEqual(rows(gc, 'Session1').map((r) => r.user_triage_confidence), ['', '']);

  const gl = fresh(1, { ENABLE_LEARNING_CURVE: false });
  completeSession(gl, 'P-L');
  const sl = login(gl, 'P-L');
  assert.equal(sl.learningCurveEnabled, false);
  assert.equal(sl.badgesEnabled, true);
  const sum = gl.call('getSessionSummary', 'P-L');
  assert.ok(!('history' in sum));
  assert.equal(sum.totals.redAreaCorrect, true, 'rozet toplamları yine döner');

  const gb = fresh(1, { ENABLE_BADGES: false });
  assert.equal(login(gb).badgesEnabled, false);
});

/* ---------------------------------------------------------------- v2.2 — tamamlama kilidi (§19) */

test('T49 — özeti gören kullanıcı 10 dk sonra yeniden girer → özet açılır', () => {
  const g = fresh(2);
  completeSession(g, 'P-49');
  assert.ok(g.call('getSessionSummary', 'P-49').cases);
  setViewedAgo(g, 'Session2', 'P-49', 10);
  const s = login(g, 'P-49');
  assert.equal(s.status, 'summary');
  assert.equal(g.call('getSessionSummary', 'P-49').cases.length, 3);
});

test('T50 — ilk görüntülemeden 30 dk sonra kilit; yanıtta vaka, triyaj ve loginId yok', async () => {
  const g = fresh(2);
  completeSession(g, 'P-50');
  g.call('getSessionSummary', 'P-50');
  setViewedAgo(g, 'Session2', 'P-50', 31);
  assert.deepEqual(g.call('startSession', 'p-50', true), {
    status: 'locked', sessionNumber: 2, totalSessions: 5, userId: 'P-50',
    message: 'Bu oturumu (Oturum 2) tamamladınız; yanıtlarınız kaydedildi. Bir sonraki oturum açıldığında aynı katılımcı kodunuzla giriş yapabilirsiniz.'
  });
  // Pencere 0: özet yalnızca hiç görüntülenmemişken açılır
  const g0 = fresh(2, { SUMMARY_REVIEW_WINDOW_MINUTES: 0 });
  completeSession(g0, 'P-0');
  assert.equal(login(g0, 'P-0').status, 'summary');
  assert.ok(g0.call('getSessionSummary', 'P-0').cases);
  await sleep(5);
  assert.equal(g0.call('startSession', 'P-0', true).status, 'locked');
});

test('T51 — kilitliyken getSessionSummary → E_SESSION_LOCKED, özet verisi dönmez', () => {
  const g = fresh(2);
  completeSession(g, 'P-51');
  g.call('getSessionSummary', 'P-51');
  setViewedAgo(g, 'Session2', 'P-51', 45);
  assert.deepEqual(g.call('getSessionSummary', 'P-51'), {
    error: 'Bu oturumu (Oturum 2) tamamladınız; yanıtlarınız kaydedildi. Bir sonraki oturum açıldığında aynı katılımcı kodunuzla giriş yapabilirsiniz.',
    code: 'E_SESSION_LOCKED'
  });
  assert.equal(g.call('submitCase', payload(login(fresh(2), 'P-X'), 'CASE-004')).ok, true, 'başka ortam etkilenmez');
});

test('T52 — özet hiç yüklenmeden kopan kullanıcı sonraki girişte özeti görür; pencere o anda başlar', () => {
  const g = fresh(2);
  completeSession(g, 'P-52');
  assert.ok(rows(g, 'Session2').every((r) => r.feedback_viewed_time === ''));
  assert.equal(login(g, 'P-52').status, 'summary');
  const before = Date.now();
  assert.ok(g.call('getSessionSummary', 'P-52').cases);
  assert.ok(rows(g, 'Session2').every((r) => Date.parse(r.feedback_viewed_time) >= before - 1));
});

test('T53 — 2 vaka gönderip çıkan kullanıcı kilitlenmez, 3. vakadan devam eder', () => {
  const g = fresh(2);
  const s = login(g, 'P-53');
  g.call('submitCase', payload(s, 'CASE-004'));
  g.call('submitCase', payload(s, 'CASE-005'));
  const again = login(g, 'P-53');
  assert.equal(again.status, 'active');
  assert.deepEqual(again.completedCaseIds, ['CASE-004', 'CASE-005']);
  assert.equal(g.call('getSessionSummary', 'P-53').code, 'E_SUMMARY_LOCKED');
});

test('T54 — sonraki oturum açılınca kilitli kullanıcı yeni oturumun 1. vakasıyla başlar', () => {
  const g = fresh(2);
  completeSession(g, 'P-54');
  g.call('getSessionSummary', 'P-54');
  setViewedAgo(g, 'Session2', 'P-54', 60);
  assert.equal(g.call('startSession', 'P-54', true).status, 'locked');
  const g3 = redeploy(g, 3);
  const s = login(g3, 'P-54');
  assert.equal(s.status, 'active');
  assert.deepEqual(s.completedCaseIds, []);
  assert.equal(s.cases[0].case_id, 'CASE-007');
});
