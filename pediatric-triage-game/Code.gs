/* ============================================================================
 *  >>> ARAŞTIRMACI AYARI — AKTİF OTURUM <<<
 *
 *    0       : Oyun kapalı (katılımcılara "aktif oturum yok" mesajı gösterilir)
 *    1 … 5   : Bu oturumun 3 vakası sunulur; yanıtlar "Session<n>" sayfasına yazılır
 *
 *  Değiştirdikten sonra (ZORUNLU):
 *    Kaydet → Dağıt > Dağıtımları yönet > (mevcut web uygulaması) ✏ Düzenle
 *    → Sürüm: "Yeni sürüm" → Dağıt.   URL DEĞİŞMEZ.
 *    ("Yeni dağıtım" OLUŞTURMAYIN — yeni URL üretir.)
 * ========================================================================== */
const CURRENT_SESSION = 1;

const APP_VERSION = '2.2.0';

const CONFIG = {
  STUDY_ID: 'PEDTRI-LC-01',
  TOTAL_SESSIONS: 5,
  CASES_PER_SESSION: 3,
  CASE_SHEET: 'CaseDetails',
  SESSION_SHEET_PREFIX: 'Session',     // → Session1 … Session5
  REQUIRE_HONOR_STATEMENT: true,       // giriş ekranında onur beyanı kutusu zorunlu mu
  SHOW_TRIAGE_HINTS: true,             // triyaj kartlarının altında kısa tanım gösterilsin mi
  USER_ID_MAX_LENGTH: 40,
  LOCK_TIMEOUT_MS: 20000,
  MIN_PREFORMATTED_ROWS: 1000,         // Session sayfalarında önceden metin biçimlenecek satır sayısı
  ROW_GROWTH_CHUNK: 500,               // satır biterse bir seferde eklenecek satır sayısı
  // v2.1 oyun bileşenleri (§18) — çalışma başladıktan sonra DEĞİŞTİRİLMEZ
  ENABLE_CONFIDENCE: true,             // vaka sonunda güven düzeyi sorusu (puanlanmaz)
  ENABLE_LEARNING_CURVE: true,         // özet sayfasında "Gelişimim" kartı
  ENABLE_BADGES: true,                 // özet sayfasında "Başarımlar" kartı
  // v2.2 tamamlama kilidi (§19)
  SUMMARY_REVIEW_WINDOW_MINUTES: 30    // tamamlanan oturumun özeti, ilk görüntülemeden sonra bu süre boyunca yeniden açılabilir; sonra kilit
};

/**
 * ============================================================================
 *  Pediatrik Triyaj Ciddi Oyunu v2.2 — sunucu (Google Apps Script, V8)
 *
 *  Genel API (istemci) : doGet, startSession, submitCase, getSessionSummary
 *  Araştırmacı         : initializeDatabase, auditCaseDataset, previewSession
 *                        (Apps Script düzenleyicisinden çalıştırılır; raporlar
 *                         yalnızca Yürütme günlüğüne yazılır)
 *
 *  v2.1: güven düzeyi (puanlanmaz), Gelişimim (öğrenme eğrisi), oturum rozetleri
 *  v2.2: tamamlanan oturuma bir sonraki oturuma kadar yeniden giriş yok
 *
 *  Yetki yalnızca bu betiğin bağlı olduğu e-tabloyla sınırlıdır:
 *  @OnlyCurrentDoc
 * ============================================================================
 */


/* ============================================================================
 *  TRİYAJ SİSTEMİ — Sağlık Bakanlığı renk kodlu sistem, 3 grup
 *
 *  Kaynak: Yataklı Sağlık Tesislerinde Acil Servis Hizmetlerinin Uygulama Usul
 *  ve Esasları Hakkında Tebliğ (RG 13.09.2022, Sayı 31952). Tebliğ'deki Kırmızı
 *  K1/K2 ve Sarı K1/K2 alt kategorileri bu çalışmada kendi renk grubunda
 *  birleştirilmiştir: KIRMIZI · SARI · YESIL.
 *  rank küçüldükçe aciliyet artar. Veri sayfalarına daima `code` yazılır (ASCII).
 * ========================================================================== */
const TRIAGE_LEVELS = [
  { code: 'KIRMIZI', rank: 1, label: 'Kırmızı Alan', shortLabel: 'Kırmızı',
    hint: 'Hayatı tehdit eden veya tehdit etme olasılığı yüksek durum — eş zamanlı ya da en geç 10 dk içinde değerlendirme ve tedavi' },
  { code: 'SARI',    rank: 2, label: 'Sarı Alan',    shortLabel: 'Sarı',
    hint: 'Hayatı tehdit etme olasılığı, uzuv kaybı riski veya önemli morbidite ya da vital bulguları normalden farklı, medikal tedavi gerektiren durum' },
  { code: 'YESIL',   rank: 3, label: 'Yeşil Alan',   shortLabel: 'Yeşil',
    hint: 'Genel durumu stabil, basit sağlık sorunu' }
];


/* ============================================================================
 *  SAYFA YAPILARI
 * ========================================================================== */

/** CaseDetails: okuma başlık adına göre yapılır; sütun sırası serbesttir. */
const CASE_HEADERS = [
  'case_id', 'case_version', 'case_title', 'active_status', 'session', 'session_order',
  'age', 'age_unit', 'gender', 'chief_complaint', 'case_description',
  'temperature_value', 'temperature_unit', 'temperature_reference',
  'heart_rate_value', 'heart_rate_reference',
  'respiratory_rate_value', 'respiratory_rate_reference',
  'systolic_blood_pressure', 'diastolic_blood_pressure', 'blood_pressure_reference',
  'spo2_value', 'spo2_reference',
  'pat_appearance_reference', 'pat_work_of_breathing_reference', 'pat_circulation_to_skin_reference',
  'reference_triage_level',
  'appearance_feedback', 'work_of_breathing_feedback', 'circulation_feedback',
  'vital_signs_feedback', 'triage_feedback',
  'clinical_category', 'difficulty_level',
  'pat_appearance_text', 'pat_appearance_media_url',
  'pat_work_of_breathing_text', 'pat_work_of_breathing_media_url',
  'pat_circulation_to_skin_text', 'pat_circulation_to_skin_media_url'
];

/** Session1 … Session5: beş sayfanın başlık satırı birebir aynıdır ve aynı sıradadır. */
const RESPONSE_HEADERS = [
  // Kimlik ve oturum
  'response_id', 'study_id', 'app_version', 'session_number', 'user_id', 'login_id',
  'case_id', 'case_version', 'session_order', 'case_global_order',
  // Zamanlama
  'case_start_time', 'case_submission_time', 'response_time_seconds',
  // Kullanıcı yanıtları
  'user_pat_appearance', 'user_pat_work_of_breathing', 'user_pat_circulation_to_skin',
  'user_temperature_classification', 'user_heart_rate_classification',
  'user_respiratory_rate_classification', 'user_blood_pressure_classification',
  'user_spo2_classification',
  'user_triage_level',
  // Referans triyaj
  'reference_triage_level',
  // PDÜ doğruluğu
  'appearance_correct', 'work_of_breathing_correct', 'circulation_correct',
  'pat_total_score', 'complete_pat_correct',
  // Vital bulgu doğruluğu
  'temperature_correct', 'heart_rate_correct', 'respiratory_rate_correct',
  'blood_pressure_correct', 'spo2_correct', 'vital_sign_total_score',
  // Triyaj metrikleri
  'triage_exact_match', 'triage_within_one',
  'triage_difference', 'triage_abs_difference',
  'over_triage', 'under_triage', 'dangerous_under_triage',
  // v2.1 — güven düzeyi (§18.1; puanlanmaz)
  'user_triage_confidence',
  // Süreç
  'honor_statement_accepted', 'feedback_viewed', 'feedback_viewed_time', 'device_type'
];

/** Session sayfalarında düz metin ('@') biçimlenen sütunlar (014 → 14, ISO → tarih dönüşümünü önler). */
const TEXT_FORMAT_COLUMNS = [
  'response_id', 'study_id', 'app_version', 'user_id', 'login_id', 'case_id',
  'case_start_time', 'case_submission_time', 'user_triage_level', 'reference_triage_level',
  'feedback_viewed_time', 'device_type'
];

/** PDÜ bileşenleri: yanıt ↔ referans ↔ doğruluk sütunu ↔ gerekçe ↔ görünen ad. */
const PAT_ITEMS = [
  { key: 'appearance', answer: 'user_pat_appearance', reference: 'pat_appearance_reference',
    correct: 'appearance_correct', feedback: 'appearance_feedback',
    text: 'pat_appearance_text', media: 'pat_appearance_media_url',
    label: 'Genel Görünüm', abbr: 'GG' },
  { key: 'work_of_breathing', answer: 'user_pat_work_of_breathing', reference: 'pat_work_of_breathing_reference',
    correct: 'work_of_breathing_correct', feedback: 'work_of_breathing_feedback',
    text: 'pat_work_of_breathing_text', media: 'pat_work_of_breathing_media_url',
    label: 'Solunum İşi', abbr: 'Sİ' },
  { key: 'circulation', answer: 'user_pat_circulation_to_skin', reference: 'pat_circulation_to_skin_reference',
    correct: 'circulation_correct', feedback: 'circulation_feedback',
    text: 'pat_circulation_to_skin_text', media: 'pat_circulation_to_skin_media_url',
    label: 'Cilt Dolaşımı', abbr: 'CD' }
];

/** Vital bulgular: yanıt ↔ referans ↔ doğruluk sütunu ↔ görünen ad. */
const VITAL_ITEMS = [
  { key: 'temperature', answer: 'user_temperature_classification', reference: 'temperature_reference',
    correct: 'temperature_correct', label: 'Ateş', abbr: 'Ateş' },
  { key: 'heart_rate', answer: 'user_heart_rate_classification', reference: 'heart_rate_reference',
    correct: 'heart_rate_correct', label: 'Kalp hızı', abbr: 'KH' },
  { key: 'respiratory_rate', answer: 'user_respiratory_rate_classification', reference: 'respiratory_rate_reference',
    correct: 'respiratory_rate_correct', label: 'Solunum sayısı', abbr: 'SS' },
  { key: 'blood_pressure', answer: 'user_blood_pressure_classification', reference: 'blood_pressure_reference',
    correct: 'blood_pressure_correct', label: 'Kan basıncı', abbr: 'KB' },
  { key: 'spo2', answer: 'user_spo2_classification', reference: 'spo2_reference',
    correct: 'spo2_correct', label: 'SpO₂', abbr: 'SpO2' }
];

const ANSWER_FIELDS = PAT_ITEMS.concat(VITAL_ITEMS).map(function (it) { return it.answer; });
/** Triyaj kararına güven düzeyi: 1 = Emin değilim, 2 = Orta, 3 = Kesinlikle eminim. Hiçbir puana girmez. */
const CONFIDENCE_FIELD = 'user_triage_confidence';
const REFERENCE_FIELDS = PAT_ITEMS.concat(VITAL_ITEMS).map(function (it) { return it.reference; });
const FEEDBACK_FIELDS = ['appearance_feedback', 'work_of_breathing_feedback', 'circulation_feedback',
  'vital_signs_feedback', 'triage_feedback'];
const NUMERIC_VITAL_FIELDS = ['temperature_value', 'heart_rate_value', 'respiratory_rate_value',
  'systolic_blood_pressure', 'diastolic_blood_pressure', 'spo2_value'];

const AGE_UNITS = ['gün', 'ay', 'yaş'];
const CLINICAL_CATEGORIES = ['Solunum', 'Enfeksiyon/Ateş', 'Nörolojik', 'Gastrointestinal', 'Travma'];
const DIFFICULTY_LEVELS = ['Kolay', 'Orta', 'Zor'];
const DEVICE_TYPES = ['mobile', 'tablet', 'desktop'];


/* ============================================================================
 *  HATA KODLARI VE MESAJLARI
 *  {n} {k} {m} {field} çağrıda; {total} ve {max} CONFIG'ten doldurulur.
 * ========================================================================== */
const MSG = {
  E_CONFIG: 'Yapılandırma hatası: CURRENT_SESSION 0 ile {total} arasında bir tam sayı olmalıdır.',
  E_CLOSED: 'Şu anda aktif bir oturum bulunmamaktadır. Oturum açıldığında araştırmacı tarafından bilgilendirileceksiniz.',
  E_USER_ID_REQUIRED: 'Lütfen katılımcı kodunuzu girin.',
  E_USER_ID_TOO_LONG: 'Katılımcı kodu en fazla {max} karakter olabilir.',
  E_USER_ID_INVALID: 'Katılımcı kodu =, +, - veya @ karakteriyle başlayamaz.',
  E_HONOR_REQUIRED: 'Başlamadan önce onur beyanını onaylamanız gerekmektedir.',
  E_SESSION_NOT_READY: 'Oturum {n} için vaka bankası hazır değil (beklenen {k}, bulunan {m}). Lütfen araştırmacıyla iletişime geçin.',
  E_SHEET_MISSING: '"Session{n}" sayfası bulunamadı. Araştırmacının initializeDatabase() fonksiyonunu çalıştırması gerekir.',
  E_SHEET_HEADERS: '"Session{n}" sayfasının başlık satırı beklenen yapıyla uyuşmuyor.',
  E_CASE_SHEET_V1: 'CaseDetails sayfası eski (v1) yapıda. Eski sayfayı "CaseDetails_v1" olarak yeniden adlandırıp initializeDatabase() fonksiyonunu tekrar çalıştırın.',
  E_SESSION_CHANGED: 'Bu oturum kapanmış veya değişmiştir. Lütfen sayfayı yenileyin.',
  E_MISSING_FIELD: 'Eksik gönderim: {field} alanı eksik.',
  E_INVALID_BINARY: 'Geçersiz yanıt değeri: {field} yalnızca 0 veya 1 olabilir.',
  E_INVALID_TRIAGE: 'Geçersiz triyaj kategorisi.',
  E_INVALID_CONFIDENCE: 'Geçersiz güven düzeyi: 1, 2 veya 3 olmalıdır.',
  E_CASE_NOT_IN_SESSION: 'Bu vaka mevcut oturuma ait değil.',
  E_DUPLICATE: 'Bu vaka daha önce gönderilmiş olup değiştirilemez.',
  E_OUT_OF_ORDER: 'Vakalar sırayla yanıtlanmalıdır. Lütfen sayfayı yenileyin.',
  E_BUSY: 'Sunucu şu anda yoğun. Lütfen birkaç saniye sonra tekrar deneyin.',
  E_SUMMARY_LOCKED: 'Geri bildirim, oturumdaki üç vakanın tamamı gönderildikten sonra görüntülenebilir.',
  E_SESSION_LOCKED: 'Bu oturumu (Oturum {n}) tamamladınız; yanıtlarınız kaydedildi. Bir sonraki oturum açıldığında aynı katılımcı kodunuzla giriş yapabilirsiniz.',
  E_INTERNAL: 'Beklenmeyen bir sunucu hatası oluştu. Lütfen tekrar deneyin; sorun sürerse araştırmacıyla iletişime geçin.'
};

/** Saf. `{ error: <mesaj>, code: <kod> }` üretir. */
function err_(code, vars) {
  const known = Object.prototype.hasOwnProperty.call(MSG, code);
  const v = Object.assign({ total: CONFIG.TOTAL_SESSIONS, max: CONFIG.USER_ID_MAX_LENGTH }, vars || {});
  const text = (known ? MSG[code] : MSG.E_INTERNAL).replace(/\{(\w+)\}/g, function (m, k) {
    return v[k] !== undefined ? String(v[k]) : m;
  });
  return { error: text, code: known ? code : 'E_INTERNAL' };
}

/** Uygulama hatası fırlatır; genel fonksiyonlar bunu err_ nesnesine çevirir. */
function fail_(code, vars) {
  const e = new Error(err_(code, vars).error);
  e.appCode = code;
  e.appVars = vars || {};
  throw e;
}

function toClientError_(e) {
  if (e && e.appCode) return err_(e.appCode, e.appVars);
  console.error('Beklenmeyen hata: ' + (e && e.stack ? e.stack : e));
  return err_('E_INTERNAL');
}


/* ============================================================================
 *  GENEL API — web uygulaması / istemci
 * ========================================================================== */

function doGet() {
  const t = HtmlService.createTemplateFromFile('index');
  // İstemciye yalnızca yapılandırma sabitleri gider; '<' kaçışı </script> kırılmasını önler.
  t.bootJson = JSON.stringify({
    activeSession: getActiveSessionSafe_(),   // geçersiz yapılandırmada -1
    totalSessions: CONFIG.TOTAL_SESSIONS,
    casesPerSession: CONFIG.CASES_PER_SESSION,
    appVersion: APP_VERSION,
    requireHonor: CONFIG.REQUIRE_HONOR_STATEMENT === true,
    appUrl: webAppUrl_()
  }).replace(/</g, '\\u003c');
  return t.evaluate()
    .setTitle('Pediatrik Triyaj — PDÜ Değerlendirmesi')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/**
 * Girişi doğrular, aktif oturumun vakalarını (referanssız) döndürür.
 * status: 'active' (devam) | 'summary' (tamamlandı, özet penceresi açık) | 'locked' (§19) | 'closed'
 * @return {{status:string}|{error:string, code:string}}
 */
function startSession(userId, honorAccepted) {
  try {
    const n = getActiveSession_();
    if (n === 0) return { status: 'closed', message: MSG.E_CLOSED, totalSessions: CONFIG.TOTAL_SESSIONS };

    const uid = requireUserId_(userId);
    if (CONFIG.REQUIRE_HONOR_STATEMENT && honorAccepted !== true) return err_('E_HONOR_REQUIRED');

    const cases = getSessionCases_(n);
    assertSessionReady_(n, cases);
    const sheet = getSessionSheet_(n);
    const progress = sessionProgress_(sheet, uid, cases);

    let status = 'active';
    if (progress.done.length >= cases.length) {
      // Tamamlama kilidi: özet yalnızca ilk görüntülemeden sonraki kısa pencerede yeniden açılır.
      // Kilitliyken vaka, triyaj tanımı veya loginId DÖNMEZ.
      if (!isSummaryWindowOpen_(progress.rows, new Date())) {
        return {
          status: 'locked',
          sessionNumber: n,
          totalSessions: CONFIG.TOTAL_SESSIONS,
          userId: uid,
          message: err_('E_SESSION_LOCKED', { n: n }).error
        };
      }
      status = 'summary';
    }

    return {
      status: status,
      sessionNumber: n,
      totalSessions: CONFIG.TOTAL_SESSIONS,
      casesPerSession: CONFIG.CASES_PER_SESSION,
      userId: uid,
      loginId: 'L-' + Utilities.getUuid(),
      honorAccepted: honorAccepted === true,
      confidenceEnabled: CONFIG.ENABLE_CONFIDENCE === true,
      learningCurveEnabled: CONFIG.ENABLE_LEARNING_CURVE === true,
      badgesEnabled: CONFIG.ENABLE_BADGES === true,
      triageLevels: clientTriageLevels_(),
      completedCaseIds: progress.done,
      cases: cases.map(clientCase_)
    };
  } catch (e) {
    return toClientError_(e);
  }
}

/**
 * Tek vakayı puanlar ve Session<n> sayfasına bir satır yazar.
 * Yanıt doğruluk, referans, puan veya geri bildirim metni İÇERMEZ.
 */
function submitCase(payload) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.LOCK_TIMEOUT_MS)) return err_('E_BUSY');
  try {
    const p = (payload && typeof payload === 'object') ? payload : {};

    const n = getActiveSession_();
    if (n === 0) return err_('E_CLOSED');
    if (Number(p.sessionNumber) !== n) return err_('E_SESSION_CHANGED');

    const required = ['userId', 'loginId', 'sessionNumber', 'caseId', 'caseStartTime']
      .concat(ANSWER_FIELDS, ['user_triage_level']);
    for (let i = 0; i < required.length; i++) {
      if (isBlank_(p[required[i]])) return err_('E_MISSING_FIELD', { field: required[i] });
    }

    const answers = {};
    for (let i = 0; i < ANSWER_FIELDS.length; i++) {
      const v = parseBinary_(p[ANSWER_FIELDS[i]]);
      if (v === null) return err_('E_INVALID_BINARY', { field: ANSWER_FIELDS[i] });
      answers[ANSWER_FIELDS[i]] = v;
    }
    if (CONFIG.ENABLE_CONFIDENCE) {
      if (isBlank_(p[CONFIDENCE_FIELD])) return err_('E_MISSING_FIELD', { field: CONFIDENCE_FIELD });
      const confidence = parseConfidence_(p[CONFIDENCE_FIELD]);
      if (confidence === null) return err_('E_INVALID_CONFIDENCE');
      answers[CONFIDENCE_FIELD] = confidence;
    }
    const level = triageByCode_(p.user_triage_level);
    if (!level) return err_('E_INVALID_TRIAGE');
    answers.user_triage_level = level.code;

    const uid = requireUserId_(p.userId);
    if (CONFIG.REQUIRE_HONOR_STATEMENT && p.honorAccepted !== true) return err_('E_HONOR_REQUIRED');

    const loginId = String(p.loginId).trim();
    if (!/^L-[0-9A-Za-z-]{8,64}$/.test(loginId)) return err_('E_MISSING_FIELD', { field: 'loginId' });
    const caseStartTime = toIsoOrNull_(p.caseStartTime);
    if (!caseStartTime) return err_('E_MISSING_FIELD', { field: 'caseStartTime' });

    const cases = getSessionCases_(n);
    assertSessionReady_(n, cases);
    const theCase = cases.find(function (c) { return String(c.case_id) === String(p.caseId); });
    if (!theCase) return err_('E_CASE_NOT_IN_SESSION');

    const sheet = getSessionSheet_(n);
    const done = sessionProgress_(sheet, uid, cases).done;
    if (done.indexOf(String(theCase.case_id)) !== -1) return err_('E_DUPLICATE');

    const order = Number(theCase.session_order);
    const earlierMissing = cases.some(function (c) {
      return Number(c.session_order) < order && done.indexOf(String(c.case_id)) === -1;
    });
    if (earlierMissing) return err_('E_OUT_OF_ORDER');

    const score = scoreResponse_(theCase, answers);
    const record = buildRecord_({
      n: n, uid: uid, loginId: loginId, caseStartTime: caseStartTime,
      payload: p, answers: answers, theCase: theCase, score: score,
      now: new Date(), responseId: 'R-' + Utilities.getUuid()
    });
    writeRecord_(sheet, record);
    SpreadsheetApp.flush();   // kilit bırakılmadan önce yazımın görünür olması için

    const completed = done.length + 1;
    return {
      ok: true,
      caseId: String(theCase.case_id),
      sessionOrder: order,
      completedCount: completed,
      casesPerSession: CONFIG.CASES_PER_SESSION,
      sessionComplete: completed >= CONFIG.CASES_PER_SESSION
    };
  } catch (e) {
    return toClientError_(e);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Oturumun tüm vakaları gönderilmişse ve özet penceresi açıksa toplu geri bildirimi
 * döndürür; feedback_viewed / feedback_viewed_time sütunlarını günceller.
 */
function getSessionSummary(userId) {
  try {
    const n = getActiveSession_();
    if (n === 0) return err_('E_CLOSED');
    const uid = requireUserId_(userId);

    const cases = getSessionCases_(n);
    assertSessionReady_(n, cases);
    const sheet = getSessionSheet_(n);

    const progress = sessionProgress_(sheet, uid, cases);
    if (progress.duplicates.length) {
      Logger.log('UYARI: ' + uid + ' için aynı vakaya birden fazla satır var (ilk satır kullanıldı): ' +
        progress.duplicates.join(', '));
    }
    if (progress.done.length < cases.length) return err_('E_SUMMARY_LOCKED');
    if (!isSummaryWindowOpen_(progress.rows, new Date())) return err_('E_SESSION_LOCKED', { n: n });

    const caseFeedback = cases.map(function (c, i) { return buildCaseFeedback_(progress.rows[i], c); });

    markFeedbackViewed_(sheet, uid, cases);

    const k = CONFIG.CASES_PER_SESSION;
    const result = {
      sessionNumber: n,
      totalSessions: CONFIG.TOTAL_SESSIONS,
      casesPerSession: k,
      userId: uid,
      totals: Object.assign(
        { triageMax: k, patMax: k * PAT_ITEMS.length, vitalMax: k * VITAL_ITEMS.length },
        summarizeRows_(progress.rows)),
      cases: caseFeedback
    };
    if (CONFIG.ENABLE_LEARNING_CURVE) result.history = getUserHistory_(uid);
    return result;
  } catch (e) {
    return toClientError_(e);
  }
}


/* ============================================================================
 *  ARAŞTIRMACI FONKSİYONLARI — Apps Script düzenleyicisinden çalıştırın
 *
 *  Not: Bu fonksiyonlar da teknik olarak google.script.run ile çağrılabilir.
 *  Referans sızıntısını önlemek için raporlar YALNIZCA Logger'a yazılır ve
 *  çağırana hiçbir şey döndürülmez. Sonuçları "Yürütme günlüğü"nde görürsünüz.
 * ========================================================================== */

/** Sayfaları oluşturur/doğrular, boş vaka bankasına 15 yer tutucu vakayı yükler. İdempotenttir. */
function initializeDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let caseSheet = ss.getSheetByName(CONFIG.CASE_SHEET);
  if (!caseSheet || caseSheet.getLastRow() === 0) {
    caseSheet = caseSheet || ss.insertSheet(CONFIG.CASE_SHEET);
    setupCaseSheet_(caseSheet);
  } else {
    // Var olan vaka bankasına DOKUNULMAZ; yalnızca başlıklar denetlenir.
    const headers = headerRow_(caseSheet);
    const missingHeaders = CASE_HEADERS.filter(function (h) { return headers.indexOf(h) === -1; });
    if (missingHeaders.length) {
      Logger.log('CaseDetails eksik sütunlar: ' + missingHeaders.join(', '));
      fail_('E_CASE_SHEET_V1');
    }
  }

  for (let n = 1; n <= CONFIG.TOTAL_SESSIONS; n++) {
    let sheet = ss.getSheetByName(sessionSheetName_(n));
    if (!sheet || sheet.getLastRow() === 0) {
      sheet = sheet || ss.insertSheet(sessionSheetName_(n));
      setupSessionSheet_(sheet);
    } else {
      try {
        assertResponseHeaders_(sheet, n);
      } catch (e) {
        Logger.log('İPUCU: ' + sessionSheetName_(n) + ' başlıkları bu sürümle uyuşmuyor (v2.1 ile "' +
          CONFIDENCE_FIELD + '" sütunu eklendi). Sayfada yalnızca test verisi varsa sayfayı silip ' +
          'initializeDatabase() fonksiyonunu yeniden çalıştırın.');
        throw e;
      }
    }
  }

  SpreadsheetApp.flush();
  Logger.log('initializeDatabase tamamlandı.');
  auditCaseDataset();
}

/** Vaka bankası ve oturum hazırlık raporunu Yürütme günlüğüne yazar. */
function auditCaseDataset() {
  Logger.log(auditReport_());
}

/** n. oturumun vakalarını referanslarıyla günlüğe yazar (n boşsa CURRENT_SESSION). */
function previewSession(n) {
  Logger.log(previewReport_(n));
}


/* ============================================================================
 *  OTURUM VE SAYFA YARDIMCILARI
 * ========================================================================== */

function getActiveSession_() {
  const n = CURRENT_SESSION;
  if (!(Number.isInteger(n) && n >= 0 && n <= CONFIG.TOTAL_SESSIONS)) fail_('E_CONFIG');
  return n;
}

function getActiveSessionSafe_() {
  try {
    return getActiveSession_();
  } catch (e) {
    return -1;
  }
}

function webAppUrl_() {
  try {
    return ScriptApp.getService().getUrl() || '';
  } catch (e) {
    return '';
  }
}

function sessionSheetName_(n) {
  return CONFIG.SESSION_SHEET_PREFIX + n;
}

function getSessionSheet_(n) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sessionSheetName_(n));
  if (!sheet) fail_('E_SHEET_MISSING', { n: n });
  assertResponseHeaders_(sheet, n);
  return sheet;
}

/** Başlık satırı RESPONSE_HEADERS ile birebir (aynı sırada, fazla sütun olmadan) aynı değilse hata fırlatır. */
function assertResponseHeaders_(sheet, n) {
  const headers = headerRow_(sheet);
  const ok = headers.length === RESPONSE_HEADERS.length &&
    RESPONSE_HEADERS.every(function (h, i) { return headers[i] === h; });
  if (!ok) {
    const num = n !== undefined ? n : sheet.getName().slice(CONFIG.SESSION_SHEET_PREFIX.length);
    fail_('E_SHEET_HEADERS', { n: num });
  }
}

function headerRow_(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1 || sheet.getLastRow() < 1) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
}

/** active_status == 1, session == n ve geçerli vakalar; session_order'a göre sıralı. */
function getSessionCases_(n) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.CASE_SHEET);
  if (!sheet) return [];
  return filterSessionCases_(readRows_(sheet), n);
}

function assertSessionReady_(n, cases) {
  if (sessionProblems_(cases).length) {
    fail_('E_SESSION_NOT_READY', { n: n, k: CONFIG.CASES_PER_SESSION, m: cases.length });
  }
}

/**
 * Kullanıcının bu oturumdaki ilerlemesi (oturum sırasıyla):
 * done = tamamlanan case_id'ler, rows = vaka başına ilk yanıt satırı, duplicates = yinelenen case_id'ler.
 */
function sessionProgress_(sheet, uid, cases) {
  const found = userRowsByCase_(readRowsWithIndex_(sheet), uid, cases);
  const hits = cases
    .map(function (c) { return found.byCase[String(c.case_id)]; })
    .filter(function (x) { return !!x; });
  return {
    done: hits.map(function (x) { return String(x.row.case_id); }),
    rows: hits.map(function (x) { return x.row; }),
    duplicates: found.duplicates
  };
}

/**
 * "Gelişimim" için kullanıcının tüm oturumlardaki SAYISAL özeti.
 * case_id, başlık, referans veya metin döndürmez; eksik/bozuk sayfa 'none' sayılır.
 */
function getUserHistory_(uid) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const out = [];
  for (let s = 1; s <= CONFIG.TOTAL_SESSIONS; s++) {
    const sheet = ss.getSheetByName(sessionSheetName_(s));
    let rows = [];
    if (sheet) {
      try {
        assertResponseHeaders_(sheet, s);
        rows = uniqueUserRows_(readRows_(sheet), uid);
      } catch (e) {
        Logger.log('Gelişimim: ' + sessionSheetName_(s) + ' okunamadı (' + e.message + ')');
      }
    }
    if (!rows.length) {
      out.push({ sessionNumber: s, status: 'none' });
      continue;
    }
    const status = rows.length >= CONFIG.CASES_PER_SESSION ? 'completed' : 'partial';
    out.push(Object.assign({ sessionNumber: s, status: status }, summarizeRows_(rows)));
  }
  return out;
}

function readRows_(sheet) {
  return readRowsWithIndex_(sheet).map(function (x) { return x.row; });
}

/** [{ row: {başlık: değer}, rowNumber: n }] — tamamen boş satırlar atlanır. */
function readRowsWithIndex_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = values[0].map(function (h) { return String(h).trim(); });
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (r.every(function (v) { return v === '' || v === null; })) continue;
    const obj = {};
    headers.forEach(function (h, j) { if (h) obj[h] = r[j]; });
    out.push({ row: obj, rowNumber: i + 1 });
  }
  return out;
}

/** §6.3 kurallarıyla tek satır yazar (appendRow kullanılmaz). */
function writeRecord_(sheet, record) {
  assertResponseHeaders_(sheet);
  const row = RESPONSE_HEADERS.map(function (h) { return record[h] !== undefined ? record[h] : ''; });
  const target = sheet.getLastRow() + 1;
  if (target > sheet.getMaxRows()) {
    sheet.insertRowsAfter(sheet.getMaxRows(), CONFIG.ROW_GROWTH_CHUNK);
    applyTextFormat_(sheet, target, CONFIG.ROW_GROWTH_CHUNK);
  }
  sheet.getRange(target, 1, 1, row.length).setValues([row]);
}

function applyTextFormat_(sheet, startRow, numRows) {
  if (numRows < 1) return;
  TEXT_FORMAT_COLUMNS.forEach(function (h) {
    sheet.getRange(startRow, RESPONSE_HEADERS.indexOf(h) + 1, numRows, 1).setNumberFormat('@');
  });
}

function ensureSheetSize_(sheet, minRows, minCols) {
  if (sheet.getMaxRows() < minRows) {
    sheet.insertRowsAfter(sheet.getMaxRows(), minRows - sheet.getMaxRows());
  }
  if (sheet.getMaxColumns() < minCols) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), minCols - sheet.getMaxColumns());
  }
}

function setupCaseSheet_(sheet) {
  const seeds = seedCases_();
  ensureSheetSize_(sheet, seeds.length + 1, CASE_HEADERS.length);
  sheet.getRange(1, 1, 1, CASE_HEADERS.length).setValues([CASE_HEADERS]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  const rows = seeds.map(function (c) {
    return CASE_HEADERS.map(function (h) { return c[h] !== undefined ? c[h] : ''; });
  });
  sheet.getRange(2, 1, rows.length, CASE_HEADERS.length).setValues(rows);
  applyCaseValidation_(sheet);
}

/** Açılır liste kuralları (2. satırdan sayfa sonuna, geçersiz giriş reddedilir). */
function applyCaseValidation_(sheet) {
  const numRows = sheet.getMaxRows() - 1;
  const range = function (k) {
    const out = [];
    for (let i = 1; i <= k; i++) out.push(String(i));
    return out;
  };
  const rules = [
    [['active_status'].concat(REFERENCE_FIELDS), ['0', '1']],
    [['session'], range(CONFIG.TOTAL_SESSIONS)],
    [['session_order'], range(CONFIG.CASES_PER_SESSION)],
    [['reference_triage_level'], TRIAGE_LEVELS.map(function (t) { return t.code; })],
    [['age_unit'], AGE_UNITS],
    [['clinical_category'], CLINICAL_CATEGORIES],
    [['difficulty_level'], DIFFICULTY_LEVELS]
  ];
  rules.forEach(function (r) {
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(r[1], true)
      .setAllowInvalid(false)
      .build();
    r[0].forEach(function (h) {
      sheet.getRange(2, CASE_HEADERS.indexOf(h) + 1, numRows, 1).setDataValidation(rule);
    });
  });
}

function setupSessionSheet_(sheet) {
  ensureSheetSize_(sheet, CONFIG.MIN_PREFORMATTED_ROWS, RESPONSE_HEADERS.length);
  sheet.getRange(1, 1, 1, RESPONSE_HEADERS.length).setValues([RESPONSE_HEADERS]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  applyTextFormat_(sheet, 2, sheet.getMaxRows() - 1);
}

/** Özet ilk kez görüntülendiğinde feedback_viewed = 1 ve zaman damgası yazılır; sonrakilerde değişmez. */
function markFeedbackViewed_(sheet, uid, cases) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.LOCK_TIMEOUT_MS)) {
    Logger.log('UYARI: kilit alınamadı; ' + uid + ' için feedback_viewed güncellemesi atlandı.');
    return;
  }
  try {
    const found = userRowsByCase_(readRowsWithIndex_(sheet), uid, cases);
    const colViewed = RESPONSE_HEADERS.indexOf('feedback_viewed') + 1;
    const colTime = RESPONSE_HEADERS.indexOf('feedback_viewed_time') + 1;
    const nowIso = new Date().toISOString();
    Object.keys(found.byCase).forEach(function (id) {
      const hit = found.byCase[id];
      if (Number(hit.row.feedback_viewed) === 1) return;
      sheet.getRange(hit.rowNumber, colViewed).setValue(1);
      sheet.getRange(hit.rowNumber, colTime).setValue(nowIso);
    });
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}


/* ============================================================================
 *  RAPORLAR (araştırmacı)
 * ========================================================================== */

function auditReport_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const k = CONFIG.CASES_PER_SESSION;
  const lines = ['=== VAKA BANKASI DENETİMİ ==='];

  const caseSheet = ss.getSheetByName(CONFIG.CASE_SHEET);
  let rows = [];
  if (!caseSheet) {
    lines.push('HATA: "' + CONFIG.CASE_SHEET + '" sayfası yok — initializeDatabase() çalıştırın.');
  } else {
    const headers = headerRow_(caseSheet);
    const missingHeaders = CASE_HEADERS.filter(function (h) { return headers.indexOf(h) === -1; });
    if (missingHeaders.length) lines.push('HATA: CaseDetails eksik sütun(lar): ' + missingHeaders.join(', '));
    rows = readRowsWithIndex_(caseSheet);
  }

  // 1) Vaka bazında
  let caseIssues = 0;
  const seen = {};
  rows.forEach(function (x) {
    const c = x.row;
    const id = isBlank_(c.case_id) ? '(satır ' + x.rowNumber + ')' : String(c.case_id).trim();
    const tag = Number(c.active_status) === 1 ? '' : ' (pasif)';
    const errors = validateCase_(c);
    const warnings = caseWarnings_(c);
    if (errors.length) lines.push(id + tag + ': GEÇERSİZ ' + errors.join('; '));
    warnings.forEach(function (w) { lines.push(id + tag + ': UYARI ' + w); });
    caseIssues += errors.length + warnings.length;
    if (!isBlank_(c.case_id)) (seen[id] = seen[id] || []).push(x.rowNumber);
  });
  Object.keys(seen).forEach(function (id) {
    if (seen[id].length > 1) {
      lines.push(id + ': HATA tekrarlanan case_id (satırlar ' + seen[id].join(', ') + ')');
      caseIssues++;
    }
  });
  if (caseSheet && !caseIssues) lines.push('Vaka düzeyinde hata veya uyarı yok (' + rows.length + ' satır).');

  // 2) Oturum bazında
  lines.push('');
  const plain = rows.map(function (x) { return x.row; });
  const sessionStatus = {};
  for (let n = 1; n <= CONFIG.TOTAL_SESSIONS; n++) {
    const cases = filterSessionCases_(plain, n);
    const problems = sessionProblems_(cases);
    const orders = cases.map(function (c) { return Number(c.session_order); }).sort(function (a, b) { return a - b; });
    const dist = triageDistribution_(cases);
    const colors = (dist.KIRMIZI === 1 && dist.SARI === 1 && dist.YESIL === 1)
      ? 'K/S/Y ✓'
      : 'UYARI renk dağılımı K' + dist.KIRMIZI + '/S' + dist.SARI + '/Y' + dist.YESIL + ' (önerilen 1/1/1)';
    const sheetState = sessionSheetState_(ss, n);
    lines.push('Oturum ' + n + ': ' + cases.length + '/' + k + ' vaka · sıra {' + orders.join(',') + '} · ' +
      colors + ' · ' + sessionSheetName_(n) + ' ' + sheetState +
      (problems.length ? ' → HAZIR DEĞİL: ' + problems.join('; ') : ''));
    sessionStatus[n] = problems.concat(sheetState === '✓' ? [] : [sessionSheetName_(n) + ' ' + sheetState]);
  }

  // 3) Denge (aktif + geçerli vakalar)
  lines.push('');
  const pool = plain.filter(function (c) { return Number(c.active_status) === 1 && validateCase_(c).length === 0; });
  lines.push('Anormal referanslar: ' + PAT_ITEMS.concat(VITAL_ITEMS).map(function (it) {
    return it.abbr + ' ' + pool.filter(function (c) { return Number(c[it.reference]) === 1; }).length;
  }).join(' · ') + '  (' + pool.length + ' vaka)');
  const dist = triageDistribution_(pool);
  lines.push('Referans triyaj: ' + TRIAGE_LEVELS.map(function (t) { return t.shortLabel + ' ' + dist[t.code]; }).join(' · '));
  const cats = {};
  pool.forEach(function (c) {
    const cat = isBlank_(c.clinical_category) ? '(boş)' : String(c.clinical_category).trim();
    cats[cat] = (cats[cat] || 0) + 1;
  });
  lines.push('Klinik kategori: ' + Object.keys(cats).map(function (cat) { return cat + ' ' + cats[cat]; }).join(' · '));

  // 4) Oyun bileşenleri (çalışma boyunca sabit kalmalı) ve aktif oturum
  lines.push('');
  const onOff = function (v) { return v ? 'AÇIK' : 'KAPALI'; };
  lines.push('Oyun bileşenleri: güven düzeyi ' + onOff(CONFIG.ENABLE_CONFIDENCE) +
    ' · Gelişimim ' + onOff(CONFIG.ENABLE_LEARNING_CURVE) +
    ' · rozetler ' + onOff(CONFIG.ENABLE_BADGES) +
    ' · özet yeniden açma süresi ' + CONFIG.SUMMARY_REVIEW_WINDOW_MINUTES + ' dk');
  const active = getActiveSessionSafe_();
  if (active === -1) {
    lines.push('AKTİF OTURUM: CURRENT_SESSION = ' + String(CURRENT_SESSION) + ' → YAPILANDIRMA HATASI (0–' +
      CONFIG.TOTAL_SESSIONS + ' arası tam sayı olmalı)');
  } else if (active === 0) {
    lines.push('AKTİF OTURUM: CURRENT_SESSION = 0 → OYUN KAPALI');
  } else {
    const reasons = sessionStatus[active];
    lines.push('AKTİF OTURUM: CURRENT_SESSION = ' + active + ' → ' +
      (reasons.length ? 'HAZIR DEĞİL: ' + reasons.join('; ') : 'HAZIR'));
  }
  return lines.join('\n');
}

function sessionSheetState_(ss, n) {
  const sheet = ss.getSheetByName(sessionSheetName_(n));
  if (!sheet) return 'YOK';
  try {
    assertResponseHeaders_(sheet, n);
    return '✓';
  } catch (e) {
    return 'BAŞLIK HATALI';
  }
}

function previewReport_(n) {
  const s = isBlank_(n) ? CURRENT_SESSION : Number(n);
  if (!(Number.isInteger(s) && s >= 1 && s <= CONFIG.TOTAL_SESSIONS)) {
    return 'Önizleme: geçersiz oturum numarası (' + String(n === undefined ? CURRENT_SESSION : n) +
      '). 1–' + CONFIG.TOTAL_SESSIONS + ' arası bir oturum verin.';
  }
  const nb = function (v) { return Number(v) === 1 ? 'A' : 'N'; };
  const cases = getSessionCases_(s);
  const lines = ['=== OTURUM ' + s + ' ÖNİZLEME (N = Normal, A = Anormal) ==='];
  cases.forEach(function (c) {
    const level = triageByCode_(c.reference_triage_level);
    lines.push(c.session_order + '. ' + c.case_id + ' (v' + c.case_version + ') · ' + c.case_title +
      ' · Referans: ' + c.reference_triage_level + (level ? ' (' + level.label + ')' : ''));
    lines.push('   PDÜ   ' + PAT_ITEMS.map(function (it) { return it.abbr + ' ' + nb(c[it.reference]); }).join(' · '));
    lines.push('   Vital ' + VITAL_ITEMS.map(function (it) {
      return it.abbr + ' ' + formatVital_(it.key, c) + ' ' + nb(c[it.reference]);
    }).join(' · '));
  });
  const problems = sessionProblems_(cases);
  lines.push(problems.length ? 'Durum: HAZIR DEĞİL — ' + problems.join('; ') : 'Durum: vaka bankası hazır.');
  return lines.join('\n');
}


/* ============================================================================
 *  SAF FONKSİYONLAR — SpreadsheetApp'e dokunmaz (Node.js'te test edilebilir)
 * ========================================================================== */

function normalizeUserId_(raw) {
  return String(raw == null ? '' : raw).trim().replace(/\s+/g, '').toUpperCase();
}

/** Normalleştirir ve doğrular; geçersizse uygulama hatası fırlatır. */
function requireUserId_(raw) {
  const uid = normalizeUserId_(raw);
  if (!uid) fail_('E_USER_ID_REQUIRED');
  if (uid.length > CONFIG.USER_ID_MAX_LENGTH) fail_('E_USER_ID_TOO_LONG');
  // E-tablo/Excel formül enjeksiyonunu önler.
  if (/^[=+\-@]/.test(uid)) fail_('E_USER_ID_INVALID');
  return uid;
}

/** Yalnızca 0/1 (sayı) veya '0'/'1' (metin) kabul edilir; aksi halde null. */
function parseBinary_(v) {
  if (v === 0 || v === 1) return v;
  if (v === '0' || v === '1') return Number(v);
  return null;
}

/** Güven düzeyi: yalnızca 1/2/3 (sayı) veya '1'/'2'/'3' (metin); aksi halde null. */
function parseConfidence_(v) {
  if (v === 1 || v === 2 || v === 3) return v;
  if (v === '1' || v === '2' || v === '3') return Number(v);
  return null;
}

function triageByCode_(code) {
  return TRIAGE_LEVELS.find(function (t) { return t.code === String(code); }) || null;
}

/** u = kullanıcının, r = referansın rank'i. Pozitif fark = düşük triyaj. */
function triageMetrics_(userCode, refCode) {
  const u = triageByCode_(userCode);
  const r = triageByCode_(refCode);
  if (!u || !r) throw new Error('triageMetrics_: geçersiz triyaj kodu (' + userCode + ', ' + refCode + ')');
  const diff = u.rank - r.rank;
  return {
    triage_exact_match: diff === 0 ? 1 : 0,
    triage_within_one: Math.abs(diff) <= 1 ? 1 : 0,
    triage_difference: diff,
    triage_abs_difference: Math.abs(diff),
    over_triage: diff < 0 ? 1 : 0,
    under_triage: diff > 0 ? 1 : 0,
    dangerous_under_triage: (r.code === 'KIRMIZI' && u.code !== 'KIRMIZI') ? 1 : 0
  };
}

function triageDirectionText_(diff) {
  if (diff === 0) return 'Tam uyum';
  return Math.abs(diff) + ' basamak ' + (diff > 0 ? 'düşük' : 'yüksek') + ' triyaj';
}

/**
 * answers: { user_pat_appearance: 0|1, …, user_spo2_classification: 0|1, user_triage_level: 'SARI' }
 * caseRow: CaseDetails satırı (referanslar 0/1, reference_triage_level geçerli kod).
 */
function scoreResponse_(caseRow, answers) {
  const pat = {};
  const vitals = {};
  let patScore = 0;
  let vitalScore = 0;
  PAT_ITEMS.forEach(function (it) {
    const ok = Number(answers[it.answer]) === Number(caseRow[it.reference]) ? 1 : 0;
    pat[it.correct] = ok;
    patScore += ok;
  });
  VITAL_ITEMS.forEach(function (it) {
    const ok = Number(answers[it.answer]) === Number(caseRow[it.reference]) ? 1 : 0;
    vitals[it.correct] = ok;
    vitalScore += ok;
  });
  return {
    pat: pat,
    vitals: vitals,
    patScore: patScore,
    completePat: patScore === PAT_ITEMS.length ? 1 : 0,
    vitalScore: vitalScore,
    triage: triageMetrics_(answers.user_triage_level, caseRow.reference_triage_level)
  };
}

/** RESPONSE_HEADERS anahtarlı kayıt nesnesi. ctx.now ve ctx.responseId dışarıdan verilir. */
function buildRecord_(ctx) {
  const c = ctx.theCase;
  const p = ctx.payload;
  const s = ctx.score;
  const order = Number(c.session_order);
  const rec = {
    response_id: ctx.responseId,
    study_id: CONFIG.STUDY_ID,
    app_version: APP_VERSION,
    session_number: ctx.n,
    user_id: ctx.uid,
    login_id: ctx.loginId,
    case_id: String(c.case_id),
    case_version: Number(c.case_version),
    session_order: order,
    case_global_order: (ctx.n - 1) * CONFIG.CASES_PER_SESSION + order,
    case_start_time: ctx.caseStartTime,
    case_submission_time: ctx.now.toISOString(),
    response_time_seconds: normalizeResponseTime_(p.responseTimeSeconds),
    user_triage_level: ctx.answers.user_triage_level,
    reference_triage_level: String(c.reference_triage_level),
    pat_total_score: s.patScore,
    complete_pat_correct: s.completePat,
    vital_sign_total_score: s.vitalScore,
    user_triage_confidence: CONFIG.ENABLE_CONFIDENCE ? ctx.answers[CONFIDENCE_FIELD] : '',
    honor_statement_accepted: (CONFIG.REQUIRE_HONOR_STATEMENT && p.honorAccepted === true) ? 1 : 0,
    feedback_viewed: 0,
    feedback_viewed_time: '',
    device_type: DEVICE_TYPES.indexOf(String(p.deviceType)) !== -1 ? String(p.deviceType) : ''
  };
  ANSWER_FIELDS.forEach(function (f) { rec[f] = ctx.answers[f]; });
  Object.assign(rec, s.pat, s.vitals, s.triage);
  return rec;
}

/** Bir vakanın özet geri bildirimi. Puanlanan değerler satırdan, metinler CaseDetails'ten. */
function buildCaseFeedback_(row, c) {
  const userCode = String(row.user_triage_level);
  const refCode = String(row.reference_triage_level);
  const u = triageByCode_(userCode);
  const r = triageByCode_(refCode);
  const diff = Number(row.triage_difference);
  const item = function (it, extra) {
    const user = Number(row[it.answer]);
    const isCorrect = Number(row[it.correct]) === 1;
    return Object.assign({ user: user, correct: isCorrect ? user : 1 - user, isCorrect: isCorrect }, extra);
  };
  return {
    sessionOrder: Number(c.session_order),
    caseId: String(c.case_id),
    caseTitle: plain_(c.case_title),
    age: Number(c.age),
    ageUnit: plain_(c.age_unit).trim(),
    gender: plain_(c.gender),
    chiefComplaint: plain_(c.chief_complaint),
    responseTimeSeconds: isNum_(row.response_time_seconds) ? Number(row.response_time_seconds) : null,
    pat: PAT_ITEMS.map(function (it) {
      return item(it, { component: it.label, explanation: plain_(c[it.feedback]) });
    }),
    vitals: VITAL_ITEMS.map(function (it) {
      return item(it, { sign: it.label, value: formatVital_(it.key, c) });
    }),
    vitalSignsNote: plain_(c.vital_signs_feedback),
    confidence: parseConfidence_(row[CONFIDENCE_FIELD]),
    triage: {
      user: userCode,
      userLabel: u ? u.label : userCode,
      reference: refCode,
      referenceLabel: r ? r.label : refCode,
      exactMatch: Number(row.triage_exact_match) === 1,
      difference: diff,
      directionText: triageDirectionText_(diff),
      dangerousUnderTriage: Number(row.dangerous_under_triage) === 1,
      explanation: plain_(c.triage_feedback)
    }
  };
}

/**
 * Ortak oturum özetleyici (toplu geri bildirim, Gelişimim ve rozetler aynı sayıları kullanır).
 * rows: tek kullanıcının tek oturumdaki yanıt satırları (case_id'ye göre tekilleştirilmiş).
 * Güven düzeyi yalnızca sayılır ve ortalaması alınır; hiçbir doğruluk ölçüsüyle birleştirilmez.
 */
function summarizeRows_(rows) {
  const sum = function (field) {
    return rows.reduce(function (acc, r) { return acc + (isNum_(r[field]) ? Number(r[field]) : 0); }, 0);
  };
  const confidences = rows
    .map(function (r) { return parseConfidence_(r[CONFIDENCE_FIELD]); })
    .filter(function (v) { return v !== null; });
  const counts = { '1': 0, '2': 0, '3': 0 };
  confidences.forEach(function (v) { counts[String(v)]++; });
  const mean = confidences.length
    ? Math.round(confidences.reduce(function (a, b) { return a + b; }, 0) / confidences.length * 10) / 10
    : null;
  return {
    casesDone: rows.length,
    triageExact: sum('triage_exact_match'),
    pat: sum('pat_total_score'),
    vital: sum('vital_sign_total_score'),
    dangerousUnderTriage: sum('dangerous_under_triage'),
    totalTimeSeconds: Math.round(sum('response_time_seconds') * 10) / 10,
    confidenceCounts: counts,
    confidenceMean: mean,
    redAreaCorrect: areaCorrect_(rows, 'KIRMIZI'),
    greenAreaCorrect: areaCorrect_(rows, 'YESIL')
  };
}

/**
 * Referansı `code` olan tüm vakalar o koda mı atanmış? (3 grupta kategori = renk alanı)
 * Böyle vaka yoksa null.
 */
function areaCorrect_(rows, code) {
  const ref = rows.filter(function (r) { return String(r.reference_triage_level) === code; });
  if (!ref.length) return null;
  return ref.every(function (r) { return String(r.user_triage_level) === code; });
}

/**
 * Tamamlama kilidi (§19). mine: kullanıcının mevcut oturumdaki yanıt satırları; now: Date.
 * Özet hiç görüntülenmemişse açık; aksi halde ilk görüntülemeden itibaren
 * SUMMARY_REVIEW_WINDOW_MINUTES dakika boyunca açık.
 */
function isSummaryWindowOpen_(mine, now) {
  const viewed = mine
    .map(function (r) {
      const iso = toIsoOrNull_(plain_(r.feedback_viewed_time));
      return iso ? new Date(iso).getTime() : null;
    })
    .filter(function (t) { return t !== null; });
  if (!viewed.length) return true;
  const first = Math.min.apply(null, viewed);
  return now.getTime() - first <= Number(CONFIG.SUMMARY_REVIEW_WINDOW_MINUTES) * 60000;
}

/** 38,4 °C · 128/dk · 96/58 mmHg · %98 (ondalık ayırıcı virgül). */
function formatVital_(sign, c) {
  const dec = function (v) { return String(v).replace('.', ','); };
  switch (sign) {
    case 'temperature':
      return dec(c.temperature_value) + (/^f/i.test(String(c.temperature_unit || '').trim()) ? ' °F' : ' °C');
    case 'heart_rate':
      return dec(c.heart_rate_value) + '/dk';
    case 'respiratory_rate':
      return dec(c.respiratory_rate_value) + '/dk';
    case 'blood_pressure':
      return dec(c.systolic_blood_pressure) + '/' + dec(c.diastolic_blood_pressure) + ' mmHg';
    case 'spo2':
      return '%' + dec(c.spo2_value);
    default:
      return '';
  }
}

/** Engelleyici hatalar; boş dizi = vaka geçerli. */
function validateCase_(c) {
  const e = [];
  const k = CONFIG.CASES_PER_SESSION;
  const total = CONFIG.TOTAL_SESSIONS;
  if (isBlank_(c.case_id)) e.push('case_id boş');
  if (!isInt_(c.case_version) || Number(c.case_version) < 1) e.push('case_version ≥1 tam sayı olmalı');
  if (parseBinary_(c.active_status) === null) e.push('active_status 0 veya 1 olmalı');
  if (!isInt_(c.session) || Number(c.session) < 1 || Number(c.session) > total) {
    e.push('session 1–' + total + ' arası tam sayı olmalı');
  }
  if (!isInt_(c.session_order) || Number(c.session_order) < 1 || Number(c.session_order) > k) {
    e.push('session_order 1–' + k + ' arası tam sayı olmalı');
  }
  if (!isNum_(c.age) || Number(c.age) < 0) e.push('age ≥0 sayı olmalı');
  if (AGE_UNITS.indexOf(plain_(c.age_unit).trim()) === -1) e.push('age_unit gün/ay/yaş olmalı');
  ['gender', 'chief_complaint', 'case_description'].forEach(function (f) {
    if (isBlank_(c[f])) e.push(f + ' boş');
  });
  if (!triageByCode_(c.reference_triage_level)) {
    e.push('reference_triage_level geçersiz ("' + plain_(c.reference_triage_level) + '"; izinli: ' +
      TRIAGE_LEVELS.map(function (t) { return t.code; }).join(', ') + ')');
  }
  REFERENCE_FIELDS.forEach(function (f) {
    if (parseBinary_(c[f]) === null) e.push(f + ' 0 veya 1 olmalı');
  });
  NUMERIC_VITAL_FIELDS.forEach(function (f) {
    if (!isNum_(c[f])) e.push(f + ' sayı olmalı');
  });
  return e;
}

/** Engellemeyen uyarılar. */
function caseWarnings_(c) {
  const w = [];
  FEEDBACK_FIELDS.forEach(function (f) {
    if (isBlank_(c[f])) w.push(f + ' boş');
  });
  if (isBlank_(c.clinical_category)) {
    w.push('clinical_category boş');
  } else if (CLINICAL_CATEGORIES.indexOf(plain_(c.clinical_category).trim()) === -1) {
    w.push('clinical_category izinli listede değil ("' + plain_(c.clinical_category) + '")');
  }
  PAT_ITEMS.forEach(function (it) {
    if (isBlank_(c[it.text]) && isBlank_(c[it.media])) w.push(it.text + ' ve ' + it.media + ' ikisi de boş');
    if (!isBlank_(c[it.media]) && !safeUrl_(c[it.media])) w.push(it.media + ' geçerli bir http(s) bağlantısı değil');
  });
  if (isBlank_(c.case_title)) w.push('case_title boş');
  if (!isBlank_(c.temperature_unit) && !/^(celsius|fahrenheit)$/i.test(plain_(c.temperature_unit).trim())) {
    w.push('temperature_unit Celsius veya Fahrenheit olmalı');
  }
  if (!isBlank_(c.difficulty_level) && DIFFICULTY_LEVELS.indexOf(plain_(c.difficulty_level).trim()) === -1) {
    w.push('difficulty_level izinli listede değil ("' + plain_(c.difficulty_level) + '")');
  }
  return w;
}

/** Yalnızca http(s) bağlantıları geçer; aksi halde boş metin. */
function safeUrl_(v) {
  const s = plain_(v).trim();
  return /^https?:\/\/[^\s"'<>`]+$/i.test(s) ? s : '';
}

function filterSessionCases_(rows, n) {
  return rows
    .filter(function (c) {
      return Number(c.active_status) === 1 && Number(c.session) === n && validateCase_(c).length === 0;
    })
    .sort(function (a, b) { return Number(a.session_order) - Number(b.session_order); });
}

/** Oturumun sunulabilirliğini engelleyen sorunlar (boş dizi = hazır). */
function sessionProblems_(cases) {
  const k = CONFIG.CASES_PER_SESSION;
  const problems = [];
  if (cases.length !== k) problems.push('aktif ve geçerli vaka sayısı ' + cases.length + ' (beklenen ' + k + ')');
  const orders = cases.map(function (c) { return Number(c.session_order); }).sort(function (a, b) { return a - b; });
  const expected = [];
  for (let i = 1; i <= k; i++) expected.push(i);
  if (orders.join(',') !== expected.join(',')) {
    problems.push('session_order {' + orders.join(',') + '} (beklenen {' + expected.join(',') + '})');
  }
  const ids = cases.map(function (c) { return String(c.case_id).trim(); });
  const dupes = ids.filter(function (id, i) { return ids.indexOf(id) !== i; });
  if (dupes.length) problems.push('tekrarlanan case_id: ' + dupes.join(', '));
  return problems;
}

function triageDistribution_(cases) {
  const dist = {};
  TRIAGE_LEVELS.forEach(function (t) { dist[t.code] = 0; });
  cases.forEach(function (c) {
    if (Object.prototype.hasOwnProperty.call(dist, String(c.reference_triage_level))) {
      dist[String(c.reference_triage_level)]++;
    }
  });
  return dist;
}

/** Kullanıcının satırları, case_id başına ilk satır (Gelişimim için). */
function uniqueUserRows_(rows, uid) {
  const seen = Object.create(null);
  return rows.filter(function (r) {
    if (String(r.user_id) !== uid) return false;
    const id = String(r.case_id);
    if (seen[id]) return false;
    seen[id] = true;
    return true;
  });
}

/** { byCase: { case_id: {row, rowNumber} (ilk satır) }, duplicates: [case_id…] } */
function userRowsByCase_(indexedRows, uid, cases) {
  const wanted = Object.create(null);
  cases.forEach(function (c) { wanted[String(c.case_id)] = true; });
  const byCase = Object.create(null);
  const duplicates = [];
  indexedRows.forEach(function (x) {
    const id = String(x.row.case_id);
    if (String(x.row.user_id) !== uid || !wanted[id]) return;
    if (byCase[id]) duplicates.push(id);
    else byCase[id] = x;
  });
  return { byCase: byCase, duplicates: duplicates };
}

/** İstemciye giden vaka nesnesi — referans, gerekçe, başlık ve kategori ASLA eklenmez. */
function clientCase_(c) {
  return {
    case_id: plain_(c.case_id),
    case_version: Number(c.case_version),
    session_order: Number(c.session_order),
    age: Number(c.age),
    age_unit: plain_(c.age_unit).trim(),
    gender: plain_(c.gender),
    chief_complaint: plain_(c.chief_complaint),
    case_description: plain_(c.case_description),
    temperature_value: Number(c.temperature_value),
    temperature_unit: plain_(c.temperature_unit).trim() || 'Celsius',
    heart_rate_value: Number(c.heart_rate_value),
    respiratory_rate_value: Number(c.respiratory_rate_value),
    systolic_blood_pressure: Number(c.systolic_blood_pressure),
    diastolic_blood_pressure: Number(c.diastolic_blood_pressure),
    spo2_value: Number(c.spo2_value),
    pat_appearance_text: plain_(c.pat_appearance_text),
    pat_appearance_media_url: safeUrl_(c.pat_appearance_media_url),
    pat_work_of_breathing_text: plain_(c.pat_work_of_breathing_text),
    pat_work_of_breathing_media_url: safeUrl_(c.pat_work_of_breathing_media_url),
    pat_circulation_to_skin_text: plain_(c.pat_circulation_to_skin_text),
    pat_circulation_to_skin_media_url: safeUrl_(c.pat_circulation_to_skin_media_url)
  };
}

function clientTriageLevels_() {
  return TRIAGE_LEVELS.map(function (t) {
    return {
      code: t.code, rank: t.rank, label: t.label, shortLabel: t.shortLabel,
      hint: CONFIG.SHOW_TRIAGE_HINTS ? t.hint : ''
    };
  });
}

function normalizeResponseTime_(x) {
  if (!isNum_(x)) return '';
  return Math.max(0, Math.round(Number(x) * 10) / 10);
}

function toIsoOrNull_(v) {
  if (isBlank_(v) || (typeof v !== 'string' && typeof v !== 'number')) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Hücre değerini düz metne çevirir (Date nesneleri google.script.run ile taşınamaz). */
function plain_(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? '' : v.toISOString();
  return String(v);
}

function isBlank_(v) {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

function isNum_(v) {
  if (typeof v === 'number') return isFinite(v);
  return typeof v === 'string' && v.trim() !== '' && isFinite(Number(v));
}

function isInt_(v) {
  return isNum_(v) && Number.isInteger(Number(v));
}


/* ============================================================================
 *  YER TUTUCU VAKA BANKASI (Plan Ek D)
 *
 *  LLM tarafından üretilmiş 15 yer tutucu vaka; klinik içerik ve referans
 *  yanıtlar araştırmacı gözden geçirmeden gerçek veri toplamada KULLANILMAMALIDIR.
 *  Referans triyaj 3 gruba dönüştürülmüştür: Kırmızı K1/K2 → KIRMIZI,
 *  Sarı K1/K2 → SARI, Yeşil → YESIL.
 *  Yalnızca CaseDetails sayfası yokken (veya tamamen boşken) yüklenir.
 * ========================================================================== */
function seedCases_() {
  return [
    {
      "case_id": "CASE-001",
      "case_version": 1,
      "case_title": "Ateşli kulak ağrısı (akut otitis media şüphesi)",
      "active_status": 1,
      "session": 1,
      "session_order": 1,
      "age": 4,
      "age_unit": "yaş",
      "gender": "Kız",
      "chief_complaint": "1 gündür sağ kulak ağrısı ve ateş",
      "case_description": "Annesi tarafından gece başlayan sağ kulak ağrısı ve ateş nedeniyle getirildi. Evde bir kez ateş düşürücü almış. Sıvı ve gıda alımı iyi, kusma yok. Bekleme alanında annesinin kucağında tablet ile oynuyor.",
      "temperature_value": 38.4,
      "temperature_unit": "Celsius",
      "temperature_reference": 1,
      "heart_rate_value": 115,
      "heart_rate_reference": 0,
      "respiratory_rate_value": 24,
      "respiratory_rate_reference": 0,
      "systolic_blood_pressure": 98,
      "diastolic_blood_pressure": 60,
      "blood_pressure_reference": 0,
      "spo2_value": 99,
      "spo2_reference": 0,
      "pat_appearance_reference": 0,
      "pat_work_of_breathing_reference": 0,
      "pat_circulation_to_skin_reference": 0,
      "reference_triage_level": "YESIL",
      "appearance_feedback": "Uyanık, çevreyle ilgili ve sakinleştirilebilir: Genel Görünüm normaldir.",
      "work_of_breathing_feedback": "Artmış solunum eforuna ait bulgu (retraksiyon, burun kanadı solunumu, anormal ses, anormal pozisyon) yok: Solunum İşi normaldir.",
      "circulation_feedback": "Solukluk, kutis marmoratus veya siyanoz yok: Cilt Dolaşımı normaldir.",
      "vital_signs_feedback": "Tek anormal bulgu 38,4 °C ateştir. 4 yaş için kalp hızı (80–120/dk), solunum sayısı (20–28/dk), kan basıncı ve SpO2 normal sınırlardadır.",
      "triage_feedback": "PDÜ normal, genel durumu stabil, yalnızca ateşi olan ve basit bir sağlık sorunuyla başvuran çocuk: Yeşil Alan.",
      "clinical_category": "Enfeksiyon/Ateş",
      "difficulty_level": "Kolay",
      "pat_appearance_text": "Uyanık, çevresiyle ilgileniyor, göz teması kuruyor; annesi tarafından kolayca sakinleştiriliyor.",
      "pat_appearance_media_url": "",
      "pat_work_of_breathing_text": "Rahat soluyor; retraksiyon, burun kanadı solunumu veya duyulabilir anormal ses yok.",
      "pat_work_of_breathing_media_url": "",
      "pat_circulation_to_skin_text": "Cilt pembe ve sıcak; solukluk, kutis marmoratus veya siyanoz yok.",
      "pat_circulation_to_skin_media_url": ""
    },
    {
      "case_id": "CASE-002",
      "case_version": 1,
      "case_title": "Devam eden ateşli konvülziyon (status epileptikus)",
      "active_status": 1,
      "session": 1,
      "session_order": 2,
      "age": 8,
      "age_unit": "ay",
      "gender": "Erkek",
      "chief_complaint": "Yaklaşık 15 dakikadır süren nöbet",
      "case_description": "Ailesi tarafından kucakta getirildi. Evde ateşi olduğu ve yaklaşık 15 dakika önce tüm vücutta kasılmalarla başlayan nöbetin hâlâ devam ettiği öğrenildi. Başvuruda kollarda ve bacaklarda ritmik kasılmalar sürüyor.",
      "temperature_value": 38.6,
      "temperature_unit": "Celsius",
      "temperature_reference": 1,
      "heart_rate_value": 185,
      "heart_rate_reference": 1,
      "respiratory_rate_value": 22,
      "respiratory_rate_reference": 1,
      "systolic_blood_pressure": 90,
      "diastolic_blood_pressure": 55,
      "blood_pressure_reference": 0,
      "spo2_value": 88,
      "spo2_reference": 1,
      "pat_appearance_reference": 1,
      "pat_work_of_breathing_reference": 1,
      "pat_circulation_to_skin_reference": 1,
      "reference_triage_level": "KIRMIZI",
      "appearance_feedback": "Uyarana yanıtsızlık ve devam eden nöbet aktivitesi: Genel Görünüm anormaldir.",
      "work_of_breathing_feedback": "Düzensiz, yüzeysel solunum ve hava yolu tıkanıklığını düşündüren gurgling sesi: Solunum İşi anormaldir.",
      "circulation_feedback": "Perioral siyanoz: Cilt Dolaşımı anormaldir.",
      "vital_signs_feedback": "8 aylık bebekte kalp hızı 185/dk (normal 100–180), solunum sayısı 22/dk (normal 30–53), SpO2 %88 ve ateş (38,6 °C) anormaldir; kan basıncı yaşa göre normaldir.",
      "triage_feedback": "PDÜ'nün üç bileşeninin de anormal olduğu, hipoksemi ile seyreden ve devam eden nöbet hayatı tehdit eder; eş zamanlı değerlendirme ve tedavi gerektirir: Kırmızı Alan.",
      "clinical_category": "Nörolojik",
      "difficulty_level": "Kolay",
      "pat_appearance_text": "Gözler yukarı kaymış, çevreyle etkileşimi yok; sesli ve dokunsal uyarana yanıt vermiyor; ekstremitelerde ritmik kasılmalar sürüyor.",
      "pat_appearance_media_url": "",
      "pat_work_of_breathing_text": "Düzensiz ve yüzeysel solunum; ağızdan gurgling (gargara benzeri) ses duyuluyor.",
      "pat_work_of_breathing_media_url": "",
      "pat_circulation_to_skin_text": "Dudak çevresinde morarma (perioral siyanoz).",
      "pat_circulation_to_skin_media_url": ""
    },
    {
      "case_id": "CASE-003",
      "case_version": 1,
      "case_title": "Düşme sonrası önkol deformitesi (kapalı deplase kırık şüphesi)",
      "active_status": 1,
      "session": 1,
      "session_order": 3,
      "age": 11,
      "age_unit": "yaş",
      "gender": "Erkek",
      "chief_complaint": "Bisikletten düşme sonrası sol önkolda ağrı ve şekil bozukluğu",
      "case_description": "Yaklaşık 1 saat önce bisikletten sol kolunun üzerine düşmüş. Kafa travması ve bilinç kaybı yok. Sol önkolda belirgin açılanma ve şişlik var, cilt bütünlüğü korunmuş. Parmaklarını hareket ettirebiliyor, his kaybı tariflemiyor. Ağrı şiddetini 8/10 olarak belirtiyor.",
      "temperature_value": 36.8,
      "temperature_unit": "Celsius",
      "temperature_reference": 0,
      "heart_rate_value": 128,
      "heart_rate_reference": 1,
      "respiratory_rate_value": 22,
      "respiratory_rate_reference": 0,
      "systolic_blood_pressure": 116,
      "diastolic_blood_pressure": 72,
      "blood_pressure_reference": 0,
      "spo2_value": 99,
      "spo2_reference": 0,
      "pat_appearance_reference": 0,
      "pat_work_of_breathing_reference": 0,
      "pat_circulation_to_skin_reference": 0,
      "reference_triage_level": "SARI",
      "appearance_feedback": "Ağrıya bağlı huzursuzluk olsa da bilinç ve etkileşim korunmuş: Genel Görünüm normaldir.",
      "work_of_breathing_feedback": "Artmış solunum eforuna ait bulgu (retraksiyon, burun kanadı solunumu, anormal ses, anormal pozisyon) yok: Solunum İşi normaldir.",
      "circulation_feedback": "Solukluk veya kutis marmoratus yok; distal dolaşım korunmuş: Cilt Dolaşımı normaldir.",
      "vital_signs_feedback": "11 yaş için kalp hızı 128/dk (normal 75–118) ağrıya bağlı taşikardi olarak anormaldir; diğer vital bulgular normaldir.",
      "triage_feedback": "Hayatı hemen tehdit etmeyen ancak uzuv fonksiyonunu etkileyebilecek, önemli morbidite riski taşıyan deplase kırık şüphesi; ağrı kontrolü ve nörovasküler izlem gerektirir: Sarı Alan.",
      "clinical_category": "Travma",
      "difficulty_level": "Orta",
      "pat_appearance_text": "Ağrılı, zaman zaman ağlıyor ancak uyanık; sorulara uygun yanıt veriyor ve babasıyla iletişim kuruyor.",
      "pat_appearance_media_url": "",
      "pat_work_of_breathing_text": "Rahat soluyor; retraksiyon, burun kanadı solunumu veya duyulabilir anormal ses yok.",
      "pat_work_of_breathing_media_url": "",
      "pat_circulation_to_skin_text": "Cilt pembe; sol el parmakları pembe ve sıcak.",
      "pat_circulation_to_skin_media_url": ""
    },
    {
      "case_id": "CASE-004",
      "case_version": 1,
      "case_title": "Akut gastroenterit, hafif-orta dehidratasyon",
      "active_status": 1,
      "session": 2,
      "session_order": 1,
      "age": 3,
      "age_unit": "yaş",
      "gender": "Kız",
      "chief_complaint": "1 gündür kusma ve ishal",
      "case_description": "Dünden beri 6 kez kusma ve 8 kez sulu ishal olmuş; ishalde kan yok. Son 6 saatte idrar çıkışı azalmış. Sıvıları içmeye istekli ancak bir kısmını kusuyor. Ağız mukozası kuru.",
      "temperature_value": 37.4,
      "temperature_unit": "Celsius",
      "temperature_reference": 0,
      "heart_rate_value": 145,
      "heart_rate_reference": 1,
      "respiratory_rate_value": 26,
      "respiratory_rate_reference": 0,
      "systolic_blood_pressure": 96,
      "diastolic_blood_pressure": 58,
      "blood_pressure_reference": 0,
      "spo2_value": 98,
      "spo2_reference": 0,
      "pat_appearance_reference": 0,
      "pat_work_of_breathing_reference": 0,
      "pat_circulation_to_skin_reference": 0,
      "reference_triage_level": "SARI",
      "appearance_feedback": "Yorgun olsa da uyanık ve etkileşimli: Genel Görünüm normaldir.",
      "work_of_breathing_feedback": "Artmış solunum eforuna ait bulgu (retraksiyon, burun kanadı solunumu, anormal ses, anormal pozisyon) yok: Solunum İşi normaldir.",
      "circulation_feedback": "Cilt rengi normal: Cilt Dolaşımı normaldir. Mukoza kuruluğu dehidratasyon bulgusudur ancak PDÜ'nün cilt dolaşımı bileşeninin parçası değildir.",
      "vital_signs_feedback": "3 yaş için kalp hızı 145/dk (normal 80–120) dehidratasyonla uyumlu taşikardi olarak anormaldir; ateş, solunum sayısı, kan basıncı ve SpO2 normaldir.",
      "triage_feedback": "Genel durumu korunmuş, ancak vital bulgusu normalden farklı olan ve rehidratasyon tedavisi gerektiren çocuk: Sarı Alan.",
      "clinical_category": "Gastrointestinal",
      "difficulty_level": "Orta",
      "pat_appearance_text": "Yorgun görünüyor ancak uyanık; annesine tepki veriyor, kendisine uzatılan oyuncağı alıyor.",
      "pat_appearance_media_url": "",
      "pat_work_of_breathing_text": "Rahat soluyor; retraksiyon, burun kanadı solunumu veya duyulabilir anormal ses yok.",
      "pat_work_of_breathing_media_url": "",
      "pat_circulation_to_skin_text": "Cilt rengi normal; solukluk, kutis marmoratus veya siyanoz yok.",
      "pat_circulation_to_skin_media_url": ""
    },
    {
      "case_id": "CASE-005",
      "case_version": 1,
      "case_title": "Ayak bileği burkulması",
      "active_status": 1,
      "session": 2,
      "session_order": 2,
      "age": 7,
      "age_unit": "yaş",
      "gender": "Erkek",
      "chief_complaint": "Futbol oynarken sağ ayak bileğini burkma",
      "case_description": "2 saat önce okulda futbol oynarken sağ ayak bileğini içe doğru burkmuş. Topallayarak yürüyebiliyor. Dış malleol çevresinde hafif şişlik var; deformite, açık yara veya his kaybı yok.",
      "temperature_value": 36.7,
      "temperature_unit": "Celsius",
      "temperature_reference": 0,
      "heart_rate_value": 92,
      "heart_rate_reference": 0,
      "respiratory_rate_value": 20,
      "respiratory_rate_reference": 0,
      "systolic_blood_pressure": 104,
      "diastolic_blood_pressure": 66,
      "blood_pressure_reference": 0,
      "spo2_value": 99,
      "spo2_reference": 0,
      "pat_appearance_reference": 0,
      "pat_work_of_breathing_reference": 0,
      "pat_circulation_to_skin_reference": 0,
      "reference_triage_level": "YESIL",
      "appearance_feedback": "Uyanık, sakin ve etkileşimli: Genel Görünüm normaldir.",
      "work_of_breathing_feedback": "Artmış solunum eforuna ait bulgu (retraksiyon, burun kanadı solunumu, anormal ses, anormal pozisyon) yok: Solunum İşi normaldir.",
      "circulation_feedback": "Solukluk, kutis marmoratus veya siyanoz yok: Cilt Dolaşımı normaldir.",
      "vital_signs_feedback": "7 yaş için tüm vital bulgular normal sınırlardadır.",
      "triage_feedback": "PDÜ ve vital bulguları normal, yürüyebilen, izole hafif yumuşak doku yaralanması: Yeşil Alan.",
      "clinical_category": "Travma",
      "difficulty_level": "Kolay",
      "pat_appearance_text": "Uyanık, sakin; sorulara uygun yanıt veriyor, annesiyle şakalaşıyor.",
      "pat_appearance_media_url": "",
      "pat_work_of_breathing_text": "Rahat soluyor; retraksiyon, burun kanadı solunumu veya duyulabilir anormal ses yok.",
      "pat_work_of_breathing_media_url": "",
      "pat_circulation_to_skin_text": "Cilt pembe; solukluk, kutis marmoratus veya siyanoz yok.",
      "pat_circulation_to_skin_media_url": ""
    },
    {
      "case_id": "CASE-006",
      "case_version": 1,
      "case_title": "Ağır astım atağı",
      "active_status": 1,
      "session": 2,
      "session_order": 3,
      "age": 14,
      "age_unit": "yaş",
      "gender": "Kız",
      "chief_complaint": "Nefes darlığı ve hırıltı",
      "case_description": "Astım tanılı. Üst solunum yolu enfeksiyonunu izleyen 2 gündür artan nefes darlığı var. Evde son 2 saatte 3 kez kısa etkili bronkodilatör kullanmış, yanıt alınamamış. Ancak kelime kelime konuşabiliyor.",
      "temperature_value": 36.9,
      "temperature_unit": "Celsius",
      "temperature_reference": 0,
      "heart_rate_value": 132,
      "heart_rate_reference": 1,
      "respiratory_rate_value": 36,
      "respiratory_rate_reference": 1,
      "systolic_blood_pressure": 118,
      "diastolic_blood_pressure": 74,
      "blood_pressure_reference": 0,
      "spo2_value": 89,
      "spo2_reference": 1,
      "pat_appearance_reference": 0,
      "pat_work_of_breathing_reference": 1,
      "pat_circulation_to_skin_reference": 0,
      "reference_triage_level": "KIRMIZI",
      "appearance_feedback": "Kaygılı olsa da bilinci açık ve etkileşimi korunmuş: Genel Görünüm normaldir.",
      "work_of_breathing_feedback": "Tripod pozisyonu, çekilmeler, yardımcı solunum kası kullanımı ve hışıltı: Solunum İşi anormaldir.",
      "circulation_feedback": "Solukluk, kutis marmoratus veya siyanoz yok: Cilt Dolaşımı normaldir.",
      "vital_signs_feedback": "14 yaş için kalp hızı 132/dk (normal 60–100), solunum sayısı 36/dk (normal 12–20) ve SpO2 %89 anormaldir; ateş ve kan basıncı normaldir.",
      "triage_feedback": "Yardımcı solunum kaslarının kullanıldığı, hipoksemi ile seyreden ve tedaviye yanıtsız ağır astım atağı; hayatı tehdit etme olasılığı yüksektir ve 10 dakika içinde tedavi gerektirir: Kırmızı Alan.",
      "clinical_category": "Solunum",
      "difficulty_level": "Orta",
      "pat_appearance_text": "Uyanık, kaygılı; göz teması kuruyor ve sorulara kısa yanıtlarla uygun cevap veriyor.",
      "pat_appearance_media_url": "",
      "pat_work_of_breathing_text": "Öne eğilerek oturuyor (tripod pozisyonu); suprasternal ve interkostal çekilmeler, boyun kaslarının solunuma katılması ve kulakla duyulabilen ekspiratuvar hışıltı.",
      "pat_work_of_breathing_media_url": "",
      "pat_circulation_to_skin_text": "Cilt pembe; solukluk, kutis marmoratus veya siyanoz yok.",
      "pat_circulation_to_skin_media_url": ""
    },
    {
      "case_id": "CASE-007",
      "case_version": 1,
      "case_title": "Septik şok (peteşiyal döküntü)",
      "active_status": 1,
      "session": 3,
      "session_order": 1,
      "age": 2,
      "age_unit": "yaş",
      "gender": "Erkek",
      "chief_complaint": "Yüksek ateş ve uyandırmakta güçlük",
      "case_description": "24 saattir yüksek ateşi var; son saatlerde uykuya meyil giderek artmış. Bugün hiç idrar yapmamış. Gövdede ve bacaklarda bası ile solmayan küçük kırmızı-mor döküntüler fark edilmiş.",
      "temperature_value": 39.7,
      "temperature_unit": "Celsius",
      "temperature_reference": 1,
      "heart_rate_value": 190,
      "heart_rate_reference": 1,
      "respiratory_rate_value": 45,
      "respiratory_rate_reference": 1,
      "systolic_blood_pressure": 64,
      "diastolic_blood_pressure": 32,
      "blood_pressure_reference": 1,
      "spo2_value": 95,
      "spo2_reference": 0,
      "pat_appearance_reference": 1,
      "pat_work_of_breathing_reference": 0,
      "pat_circulation_to_skin_reference": 1,
      "reference_triage_level": "KIRMIZI",
      "appearance_feedback": "Letarji, azalmış tonus ve zayıf etkileşim: Genel Görünüm anormaldir.",
      "work_of_breathing_feedback": "Retraksiyon veya anormal ses olmaksızın hızlı solunum: PDÜ'de solunum işi eforla değerlendirilir, hızla değil; Solunum İşi normaldir.",
      "circulation_feedback": "Kutis marmoratus ve soğuk ekstremiteler: Cilt Dolaşımı anormaldir.",
      "vital_signs_feedback": "2 yaş için kalp hızı 190/dk (normal 98–140), solunum sayısı 45/dk (normal 22–37), kan basıncı 64/32 mmHg (hipotansiyon sınırı: 70 + 2 × yaş = 74 mmHg) ve ateş anormaldir; SpO2 %95 normaldir.",
      "triage_feedback": "Anormal Genel Görünüm ve Cilt Dolaşımı ile hipotansiyon dekompanse şokla uyumludur; eş zamanlı resüsitasyon gerektirir: Kırmızı Alan.",
      "clinical_category": "Enfeksiyon/Ateş",
      "difficulty_level": "Orta",
      "pat_appearance_text": "Uykuya meyilli, uyandırılması güç; annesinin sesine zayıf yanıt veriyor, kas tonusu azalmış.",
      "pat_appearance_media_url": "",
      "pat_work_of_breathing_text": "Hızlı ancak zorlanmasız solunum; retraksiyon, burun kanadı solunumu veya anormal ses yok.",
      "pat_work_of_breathing_media_url": "",
      "pat_circulation_to_skin_text": "Gövde ve ekstremitelerde kutis marmoratus (alacalı görünüm); el ve ayaklar soğuk.",
      "pat_circulation_to_skin_media_url": ""
    },
    {
      "case_id": "CASE-008",
      "case_version": 1,
      "case_title": "Bronşiyolit, orta derecede solunum sıkıntısı",
      "active_status": 1,
      "session": 3,
      "session_order": 2,
      "age": 9,
      "age_unit": "ay",
      "gender": "Kız",
      "chief_complaint": "3 gündür öksürük, burun akıntısı ve hızlı nefes alma",
      "case_description": "3 gündür burun akıntısı ve öksürüğü var; dünden beri hızlı nefes alıyor. Beslenmesi her zamankinin yaklaşık yarısına düşmüş, idrar çıkışı korunuyor. Ablasında da benzer şikâyetler var.",
      "temperature_value": 38.3,
      "temperature_unit": "Celsius",
      "temperature_reference": 1,
      "heart_rate_value": 160,
      "heart_rate_reference": 0,
      "respiratory_rate_value": 58,
      "respiratory_rate_reference": 1,
      "systolic_blood_pressure": 92,
      "diastolic_blood_pressure": 56,
      "blood_pressure_reference": 0,
      "spo2_value": 92,
      "spo2_reference": 1,
      "pat_appearance_reference": 0,
      "pat_work_of_breathing_reference": 1,
      "pat_circulation_to_skin_reference": 0,
      "reference_triage_level": "SARI",
      "appearance_feedback": "Uyanık, çevreyi takip ediyor ve sakinleştirilebiliyor: Genel Görünüm normaldir.",
      "work_of_breathing_feedback": "Çekilmeler, burun kanadı solunumu ve hışıltı artmış solunum eforunu gösterir: Solunum İşi anormaldir.",
      "circulation_feedback": "Solukluk, kutis marmoratus veya siyanoz yok: Cilt Dolaşımı normaldir.",
      "vital_signs_feedback": "9 aylık bebekte solunum sayısı 58/dk (normal 30–53), SpO2 %92 ve ateş (38,3 °C) anormaldir; kalp hızı 160/dk bu yaş için normal sınırlardadır.",
      "triage_feedback": "İzole anormal Solunum İşi ve hafif hipoksemi; oksijen ihtiyacı nedeniyle önemli morbidite riski taşır, ancak görünüm ve dolaşım korunmuştur: Sarı Alan.",
      "clinical_category": "Solunum",
      "difficulty_level": "Zor",
      "pat_appearance_text": "Uyanık, muayene edeni gözleriyle takip ediyor; annesinin kucağında sakinleşiyor.",
      "pat_appearance_media_url": "",
      "pat_work_of_breathing_text": "Subkostal ve interkostal çekilmeler, burun kanadı solunumu; kulakla duyulabilen hışıltı.",
      "pat_work_of_breathing_media_url": "",
      "pat_circulation_to_skin_text": "Cilt pembe; solukluk, kutis marmoratus veya siyanoz yok.",
      "pat_circulation_to_skin_media_url": ""
    },
    {
      "case_id": "CASE-009",
      "case_version": 1,
      "case_title": "Gerilim tipi baş ağrısı",
      "active_status": 1,
      "session": 3,
      "session_order": 3,
      "age": 12,
      "age_unit": "yaş",
      "gender": "Kız",
      "chief_complaint": "2 gündür alında baskı tarzında baş ağrısı",
      "case_description": "Sınav haftasında başlayan, alın bölgesinde bant tarzında, gün içinde artıp azalan baş ağrısı. Kusma, ateş, görme bozukluğu, güçsüzlük veya uykudan uyandıran ağrı tariflemiyor. Ağrı şiddeti 4/10.",
      "temperature_value": 36.6,
      "temperature_unit": "Celsius",
      "temperature_reference": 0,
      "heart_rate_value": 84,
      "heart_rate_reference": 0,
      "respiratory_rate_value": 16,
      "respiratory_rate_reference": 0,
      "systolic_blood_pressure": 114,
      "diastolic_blood_pressure": 70,
      "blood_pressure_reference": 0,
      "spo2_value": 99,
      "spo2_reference": 0,
      "pat_appearance_reference": 0,
      "pat_work_of_breathing_reference": 0,
      "pat_circulation_to_skin_reference": 0,
      "reference_triage_level": "YESIL",
      "appearance_feedback": "Uyanık, sakin ve akıcı konuşuyor: Genel Görünüm normaldir.",
      "work_of_breathing_feedback": "Artmış solunum eforuna ait bulgu (retraksiyon, burun kanadı solunumu, anormal ses, anormal pozisyon) yok: Solunum İşi normaldir.",
      "circulation_feedback": "Solukluk, kutis marmoratus veya siyanoz yok: Cilt Dolaşımı normaldir.",
      "vital_signs_feedback": "12 yaş için tüm vital bulgular normal sınırlardadır.",
      "triage_feedback": "Alarm bulgusu olmayan, PDÜ ve vital bulguları normal baş ağrısı: Yeşil Alan.",
      "clinical_category": "Nörolojik",
      "difficulty_level": "Kolay",
      "pat_appearance_text": "Uyanık, sakin; sorulara akıcı ve uygun yanıt veriyor.",
      "pat_appearance_media_url": "",
      "pat_work_of_breathing_text": "Rahat soluyor; retraksiyon, burun kanadı solunumu veya duyulabilir anormal ses yok.",
      "pat_work_of_breathing_media_url": "",
      "pat_circulation_to_skin_text": "Cilt pembe; solukluk, kutis marmoratus veya siyanoz yok.",
      "pat_circulation_to_skin_media_url": ""
    },
    {
      "case_id": "CASE-010",
      "case_version": 1,
      "case_title": "Akut apandisit şüphesi",
      "active_status": 1,
      "session": 4,
      "session_order": 1,
      "age": 10,
      "age_unit": "yaş",
      "gender": "Erkek",
      "chief_complaint": "Göbek çevresinden sağ alt kadrana yerleşen karın ağrısı",
      "case_description": "Dün akşam göbek çevresinde başlayan, bu sabah sağ alt kadrana yerleşen karın ağrısı; 2 kez kusma ve iştahsızlık eşlik ediyor. Yürürken ve öksürürken ağrısı artıyor.",
      "temperature_value": 38.4,
      "temperature_unit": "Celsius",
      "temperature_reference": 1,
      "heart_rate_value": 124,
      "heart_rate_reference": 1,
      "respiratory_rate_value": 22,
      "respiratory_rate_reference": 0,
      "systolic_blood_pressure": 110,
      "diastolic_blood_pressure": 68,
      "blood_pressure_reference": 0,
      "spo2_value": 98,
      "spo2_reference": 0,
      "pat_appearance_reference": 0,
      "pat_work_of_breathing_reference": 0,
      "pat_circulation_to_skin_reference": 0,
      "reference_triage_level": "SARI",
      "appearance_feedback": "Ağrılı olsa da uyanık ve etkileşimli: Genel Görünüm normaldir.",
      "work_of_breathing_feedback": "Artmış solunum eforuna ait bulgu (retraksiyon, burun kanadı solunumu, anormal ses, anormal pozisyon) yok: Solunum İşi normaldir.",
      "circulation_feedback": "Solukluk, kutis marmoratus veya siyanoz yok: Cilt Dolaşımı normaldir.",
      "vital_signs_feedback": "10 yaş için kalp hızı 124/dk (normal 75–118) ve ateş (38,4 °C) anormaldir; solunum sayısı, kan basıncı ve SpO2 normaldir.",
      "triage_feedback": "Hayatı hemen tehdit etmeyen, ancak cerrahi değerlendirme gerektiren ve gecikmesi halinde (perforasyon) önemli morbiditeye yol açabilecek akut karın: Sarı Alan.",
      "clinical_category": "Gastrointestinal",
      "difficulty_level": "Orta",
      "pat_appearance_text": "Ağrılı yüz ifadesi; hareket etmekten kaçınıyor ancak uyanık ve sorulara uygun yanıt veriyor.",
      "pat_appearance_media_url": "",
      "pat_work_of_breathing_text": "Rahat soluyor; retraksiyon, burun kanadı solunumu veya duyulabilir anormal ses yok.",
      "pat_work_of_breathing_media_url": "",
      "pat_circulation_to_skin_text": "Cilt pembe; solukluk, kutis marmoratus veya siyanoz yok.",
      "pat_circulation_to_skin_media_url": ""
    },
    {
      "case_id": "CASE-011",
      "case_version": 1,
      "case_title": "Bilinç değişikliği ile seyreden kafa travması",
      "active_status": 1,
      "session": 4,
      "session_order": 2,
      "age": 5,
      "age_unit": "yaş",
      "gender": "Kız",
      "chief_complaint": "Yüksekten düşme sonrası kusma ve uykuya meyil",
      "case_description": "Yaklaşık 2 saat önce balkon korkuluğundan (yaklaşık 1,5 m) beton zemine başüstü düşmüş. Kısa süreli ağlama sonrası 2 kez kusmuş; son 1 saatte uykuya meyil giderek artmış. Sağ parietal bölgede büyük şişlik var.",
      "temperature_value": 36.8,
      "temperature_unit": "Celsius",
      "temperature_reference": 0,
      "heart_rate_value": 88,
      "heart_rate_reference": 0,
      "respiratory_rate_value": 22,
      "respiratory_rate_reference": 0,
      "systolic_blood_pressure": 108,
      "diastolic_blood_pressure": 66,
      "blood_pressure_reference": 0,
      "spo2_value": 98,
      "spo2_reference": 0,
      "pat_appearance_reference": 1,
      "pat_work_of_breathing_reference": 0,
      "pat_circulation_to_skin_reference": 0,
      "reference_triage_level": "KIRMIZI",
      "appearance_feedback": "Uykuya meyil ve yavaşlamış yanıtlar bilinç değişikliğini gösterir: Genel Görünüm anormaldir.",
      "work_of_breathing_feedback": "Artmış solunum eforuna ait bulgu (retraksiyon, burun kanadı solunumu, anormal ses, anormal pozisyon) yok: Solunum İşi normaldir.",
      "circulation_feedback": "Solukluk, kutis marmoratus veya siyanoz yok: Cilt Dolaşımı normaldir.",
      "vital_signs_feedback": "5 yaş için tüm vital bulgular normal sınırlardadır; normal vital bulgular, yüksek riskli mekanizma ve anormal görünüm varlığında aciliyeti azaltmaz.",
      "triage_feedback": "Yüksek riskli travma mekanizması, tekrarlayan kusma ve bilinç değişikliği intrakraniyal yaralanma açısından hayatı tehdit etme olasılığı yüksek bir tablodur; 10 dakika içinde değerlendirme gerektirir: Kırmızı Alan.",
      "clinical_category": "Travma",
      "difficulty_level": "Zor",
      "pat_appearance_text": "Uykuya meyilli; sesli uyaranla gözlerini açıyor ancak yeniden uykuya dalıyor, sorulara yavaş ve kısa yanıt veriyor.",
      "pat_appearance_media_url": "",
      "pat_work_of_breathing_text": "Düzenli ve rahat solunum; retraksiyon veya anormal ses yok.",
      "pat_work_of_breathing_media_url": "",
      "pat_circulation_to_skin_text": "Cilt pembe; solukluk, kutis marmoratus veya siyanoz yok.",
      "pat_circulation_to_skin_media_url": ""
    },
    {
      "case_id": "CASE-012",
      "case_version": 1,
      "case_title": "Üst solunum yolu enfeksiyonu",
      "active_status": 1,
      "session": 4,
      "session_order": 3,
      "age": 18,
      "age_unit": "ay",
      "gender": "Erkek",
      "chief_complaint": "3 gündür burun akıntısı ve öksürük",
      "case_description": "3 gündür burun akıntısı ve kuru öksürüğü var. Ateş ölçülmemiş. Beslenmesi ve idrar çıkışı normal; kreşte benzer şikâyetleri olan çocuklar var.",
      "temperature_value": 37.2,
      "temperature_unit": "Celsius",
      "temperature_reference": 0,
      "heart_rate_value": 125,
      "heart_rate_reference": 0,
      "respiratory_rate_value": 30,
      "respiratory_rate_reference": 0,
      "systolic_blood_pressure": 94,
      "diastolic_blood_pressure": 56,
      "blood_pressure_reference": 0,
      "spo2_value": 98,
      "spo2_reference": 0,
      "pat_appearance_reference": 0,
      "pat_work_of_breathing_reference": 0,
      "pat_circulation_to_skin_reference": 0,
      "reference_triage_level": "YESIL",
      "appearance_feedback": "Uyanık, oyuncaklarla ilgili; yabancıya karşı annesine sığınması yaşına uygundur: Genel Görünüm normaldir.",
      "work_of_breathing_feedback": "Burun tıkanıklığına bağlı üst hava yolu sesi tek başına artmış solunum eforu göstermez; retraksiyon, burun kanadı solunumu, hışıltı veya stridor yok: Solunum İşi normaldir.",
      "circulation_feedback": "Solukluk, kutis marmoratus veya siyanoz yok: Cilt Dolaşımı normaldir.",
      "vital_signs_feedback": "18 aylık çocuk için tüm vital bulgular normal sınırlardadır.",
      "triage_feedback": "PDÜ ve vital bulguları normal, basit üst solunum yolu enfeksiyonu: Yeşil Alan.",
      "clinical_category": "Solunum",
      "difficulty_level": "Orta",
      "pat_appearance_text": "Uyanık, oyuncaklarla ilgileniyor; yabancıya karşı annesine sığınıyor.",
      "pat_appearance_media_url": "",
      "pat_work_of_breathing_text": "Burun tıkanıklığına bağlı hafif hırıltılı burun sesi dışında rahat soluyor; retraksiyon veya burun kanadı solunumu yok.",
      "pat_work_of_breathing_media_url": "",
      "pat_circulation_to_skin_text": "Cilt pembe; solukluk, kutis marmoratus veya siyanoz yok.",
      "pat_circulation_to_skin_media_url": ""
    },
    {
      "case_id": "CASE-013",
      "case_version": 1,
      "case_title": "Ağır dehidratasyon ve hipovolemik şok",
      "active_status": 1,
      "session": 5,
      "session_order": 1,
      "age": 11,
      "age_unit": "ay",
      "gender": "Erkek",
      "chief_complaint": "3 gündür ishal ve kusma, son saatlerde uyuşukluk",
      "case_description": "3 gündür günde 10'dan fazla sulu ishal ve sık kusması var. Son 12 saattir idrarı olmamış. Son saatlerde emmeyi bırakmış ve giderek uyuşuklaşmış. Gözler ve ön fontanel çökük.",
      "temperature_value": 37.6,
      "temperature_unit": "Celsius",
      "temperature_reference": 0,
      "heart_rate_value": 192,
      "heart_rate_reference": 1,
      "respiratory_rate_value": 56,
      "respiratory_rate_reference": 1,
      "systolic_blood_pressure": 66,
      "diastolic_blood_pressure": 34,
      "blood_pressure_reference": 1,
      "spo2_value": 97,
      "spo2_reference": 0,
      "pat_appearance_reference": 1,
      "pat_work_of_breathing_reference": 0,
      "pat_circulation_to_skin_reference": 1,
      "reference_triage_level": "KIRMIZI",
      "appearance_feedback": "Uyuşukluk, ilgisizlik ve zayıf ağlama: Genel Görünüm anormaldir.",
      "work_of_breathing_feedback": "Takipne metabolik asidoza kompansatuvar olabilir; retraksiyon veya anormal ses olmadığından Solunum İşi normaldir.",
      "circulation_feedback": "Belirgin solukluk ve kutis marmoratus: Cilt Dolaşımı anormaldir.",
      "vital_signs_feedback": "11 aylık bebekte kalp hızı 192/dk (normal 100–180), solunum sayısı 56/dk (normal 30–53) ve kan basıncı 66/34 mmHg (hipotansiyon sınırı <70 mmHg) anormaldir; ateş ve SpO2 normaldir.",
      "triage_feedback": "Anormal Genel Görünüm ve Cilt Dolaşımı ile hipotansiyon dekompanse hipovolemik şoku gösterir; eş zamanlı resüsitasyon gerektirir: Kırmızı Alan.",
      "clinical_category": "Gastrointestinal",
      "difficulty_level": "Orta",
      "pat_appearance_text": "Uyuşuk, çevreye ilgisiz; ağrılı uyarana zayıf ağlama ile yanıt veriyor, kas tonusu azalmış.",
      "pat_appearance_media_url": "",
      "pat_work_of_breathing_text": "Hızlı ancak zorlanmasız solunum; retraksiyon veya anormal ses yok.",
      "pat_work_of_breathing_media_url": "",
      "pat_circulation_to_skin_text": "Belirgin solukluk ve gövdede kutis marmoratus; el ve ayaklar soğuk.",
      "pat_circulation_to_skin_media_url": ""
    },
    {
      "case_id": "CASE-014",
      "case_version": 1,
      "case_title": "Akut tonsillofarenjit",
      "active_status": 1,
      "session": 5,
      "session_order": 2,
      "age": 8,
      "age_unit": "yaş",
      "gender": "Erkek",
      "chief_complaint": "Boğaz ağrısı ve ateş",
      "case_description": "Dünden beri boğaz ağrısı ve ateşi var. Yutkunurken ağrısı artıyor ancak sıvıları içebiliyor ve tükürüğünü yutabiliyor. Ses değişikliği, ağız açmada kısıtlılık veya nefes darlığı yok.",
      "temperature_value": 38.2,
      "temperature_unit": "Celsius",
      "temperature_reference": 1,
      "heart_rate_value": 110,
      "heart_rate_reference": 0,
      "respiratory_rate_value": 22,
      "respiratory_rate_reference": 0,
      "systolic_blood_pressure": 102,
      "diastolic_blood_pressure": 64,
      "blood_pressure_reference": 0,
      "spo2_value": 99,
      "spo2_reference": 0,
      "pat_appearance_reference": 0,
      "pat_work_of_breathing_reference": 0,
      "pat_circulation_to_skin_reference": 0,
      "reference_triage_level": "YESIL",
      "appearance_feedback": "Uyanık, etkileşimli ve sakin: Genel Görünüm normaldir.",
      "work_of_breathing_feedback": "Artmış solunum eforuna ait bulgu (retraksiyon, burun kanadı solunumu, anormal ses, anormal pozisyon) yok: Solunum İşi normaldir.",
      "circulation_feedback": "Solukluk, kutis marmoratus veya siyanoz yok: Cilt Dolaşımı normaldir.",
      "vital_signs_feedback": "Tek anormal bulgu 38,2 °C ateştir; 8 yaş için diğer vital bulgular normal sınırlardadır.",
      "triage_feedback": "Hava yolu tehlike bulgusu (salya akması, stridor, ses değişikliği) olmayan, genel durumu iyi ateşli çocuk: Yeşil Alan.",
      "clinical_category": "Enfeksiyon/Ateş",
      "difficulty_level": "Kolay",
      "pat_appearance_text": "Uyanık, sakin; sorulara uygun yanıt veriyor.",
      "pat_appearance_media_url": "",
      "pat_work_of_breathing_text": "Rahat soluyor; retraksiyon, burun kanadı solunumu veya duyulabilir anormal ses yok.",
      "pat_work_of_breathing_media_url": "",
      "pat_circulation_to_skin_text": "Cilt pembe; solukluk, kutis marmoratus veya siyanoz yok.",
      "pat_circulation_to_skin_media_url": ""
    },
    {
      "case_id": "CASE-015",
      "case_version": 1,
      "case_title": "Basit febril nöbet sonrası",
      "active_status": 1,
      "session": 5,
      "session_order": 3,
      "age": 4,
      "age_unit": "yaş",
      "gender": "Kız",
      "chief_complaint": "Evde 2 dakika süren nöbet, şu an kendine gelmiş",
      "case_description": "Bir saat önce evde ateşli iken 2 dakika süren, tüm vücutta kasılmalarla seyreden nöbet geçirmiş; nöbet kendiliğinden durmuş. Aile tarafından getirildi. Şu an tamamen kendine gelmiş, annesini tanıyor. 1 gündür burun akıntısı var. 2 yaşında da benzer bir ateşli nöbet öyküsü mevcut.",
      "temperature_value": 39.1,
      "temperature_unit": "Celsius",
      "temperature_reference": 1,
      "heart_rate_value": 130,
      "heart_rate_reference": 1,
      "respiratory_rate_value": 24,
      "respiratory_rate_reference": 0,
      "systolic_blood_pressure": 100,
      "diastolic_blood_pressure": 62,
      "blood_pressure_reference": 0,
      "spo2_value": 98,
      "spo2_reference": 0,
      "pat_appearance_reference": 0,
      "pat_work_of_breathing_reference": 0,
      "pat_circulation_to_skin_reference": 0,
      "reference_triage_level": "SARI",
      "appearance_feedback": "Postiktal dönem sona ermiş; uyanık ve etkileşimli: Genel Görünüm normaldir.",
      "work_of_breathing_feedback": "Artmış solunum eforuna ait bulgu (retraksiyon, burun kanadı solunumu, anormal ses, anormal pozisyon) yok: Solunum İşi normaldir.",
      "circulation_feedback": "Ateşe bağlı yüz kızarıklığı anormal cilt dolaşımı bulgusu değildir; solukluk veya kutis marmoratus yok: Cilt Dolaşımı normaldir.",
      "vital_signs_feedback": "4 yaş için ateş (39,1 °C) ve kalp hızı 130/dk (normal 80–120) anormaldir; taşikardi ateşle uyumludur. Diğer vital bulgular normaldir.",
      "triage_feedback": "Nöbeti sona ermiş, genel durumu iyi; ancak vital bulguları normalden farklı olan ve ateş düşürücü tedavi ile ateş odağı değerlendirmesi gerektiren çocuk: Sarı Alan.",
      "clinical_category": "Nörolojik",
      "difficulty_level": "Orta",
      "pat_appearance_text": "Uyanık, annesinin kucağında oturuyor, çevresiyle ilgileniyor; adını söyleyebiliyor.",
      "pat_appearance_media_url": "",
      "pat_work_of_breathing_text": "Rahat soluyor; retraksiyon, burun kanadı solunumu veya duyulabilir anormal ses yok.",
      "pat_work_of_breathing_media_url": "",
      "pat_circulation_to_skin_text": "Yanaklar ateşe bağlı kızarık; solukluk, kutis marmoratus veya siyanoz yok.",
      "pat_circulation_to_skin_media_url": ""
    }
  ];
}
