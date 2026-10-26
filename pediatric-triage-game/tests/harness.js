'use strict';
/*
 * Code.gs'i Node.js'te çalıştırmak için sahte Apps Script ortamı.
 *
 * Sahte e-tablo, gerçek Google E-Tablolar'ın şu davranışlarını taklit eder:
 *  - Sayfa sınırı dışındaki getRange çağrısı hata fırlatır (yeni sayfa 1000 × 26).
 *  - setValues boyut uyuşmazlığında hata fırlatır.
 *  - Düz metin ('@') biçimli OLMAYAN hücrelere yazılan sayısal metin sayıya
 *    ('014' → 14), ISO zaman damgası Date nesnesine dönüşür.
 *  - '=' ile başlayan metin formül olarak yorumlanır ('#FORMULA:' ile işaretlenir).
 *  - insertRowsAfter ile eklenen satırlar biçimsiz gelir (en kötü durum).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const CODE_PATH = path.join(ROOT, 'Code.gs');

const BOUNDS_ERROR = 'The coordinates of the range are outside the dimensions of the sheet.';

function blankRow(n) { return new Array(n).fill(''); }
function nullRow(n) { return new Array(n).fill(null); }

class FakeRange {
  constructor(sheet, row, col, numRows, numCols) {
    if (![row, col, numRows, numCols].every(Number.isInteger) || row < 1 || col < 1 || numRows < 1 || numCols < 1) {
      throw new Error('Invalid range arguments: ' + [row, col, numRows, numCols].join(','));
    }
    if (row + numRows - 1 > sheet.getMaxRows() || col + numCols - 1 > sheet.getMaxColumns()) {
      throw new Error(BOUNDS_ERROR);
    }
    Object.assign(this, { sheet, row, col, numRows, numCols });
  }
  _cells(fn) {
    for (let r = 0; r < this.numRows; r++) {
      for (let c = 0; c < this.numCols; c++) fn(this.row - 1 + r, this.col - 1 + c, r, c);
    }
  }
  getSheet() { return this.sheet; }
  getValues() {
    this.sheet._reads++;
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      out.push(this.sheet._data[this.row - 1 + r].slice(this.col - 1, this.col - 1 + this.numCols));
    }
    return out;
  }
  getValue() { return this.getValues()[0][0]; }
  setValues(values) {
    if (!Array.isArray(values) || values.length !== this.numRows) {
      throw new Error('The number of rows in the data does not match the number of rows in the range.');
    }
    values.forEach((row) => {
      if (!Array.isArray(row) || row.length !== this.numCols) {
        throw new Error('The number of columns in the data does not match the number of columns in the range.');
      }
    });
    this._cells((r, c, i, j) => {
      this.sheet._data[r][c] = coerce(values[i][j], this.sheet._formats[r][c]);
    });
    this.sheet._ss._env.writes++;
    return this;
  }
  setValue(v) { return this.setValues(Array.from({ length: this.numRows }, () => new Array(this.numCols).fill(v))); }
  setNumberFormat(fmt) { this._cells((r, c) => { this.sheet._formats[r][c] = fmt; }); return this; }
  setFontWeight(w) { this._cells((r, c) => { this.sheet._bold[r][c] = w === 'bold'; }); return this; }
  setDataValidation(rule) { this._cells((r, c) => { this.sheet._validation[r][c] = rule; }); return this; }
}

function coerce(value, fmt) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') {
    if (value.startsWith('=')) return '#FORMULA:' + value;
    if (fmt === '@') return value;
    if (/^\s*[+-]?\d+(\.\d+)?\s*$/.test(value)) return Number(value);
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return new Date(value);
    return value;
  }
  return value;
}

class FakeSheet {
  constructor(ss, name, rows = 1000, cols = 26) {
    this._ss = ss;
    this._name = name;
    this._data = Array.from({ length: rows }, () => blankRow(cols));
    this._formats = Array.from({ length: rows }, () => nullRow(cols));
    this._bold = Array.from({ length: rows }, () => new Array(cols).fill(false));
    this._validation = Array.from({ length: rows }, () => nullRow(cols));
    this._frozen = 0;
    this._reads = 0;   // getValues çağrı sayısı (önbellek testleri için)
  }
  getName() { return this._name; }
  getMaxRows() { return this._data.length; }
  getMaxColumns() { return this._data.length ? this._data[0].length : 0; }
  getLastRow() {
    for (let i = this._data.length - 1; i >= 0; i--) {
      if (this._data[i].some((v) => v !== '')) return i + 1;
    }
    return 0;
  }
  getLastColumn() {
    let last = 0;
    this._data.forEach((row) => {
      for (let j = row.length - 1; j >= last; j--) {
        if (row[j] !== '') { last = j + 1; break; }
      }
    });
    return last;
  }
  getRange(row, col, numRows = 1, numCols = 1) { return new FakeRange(this, row, col, numRows, numCols); }
  insertRowsAfter(after, n) {
    if (after < 1 || after > this.getMaxRows()) throw new Error(BOUNDS_ERROR);
    const cols = this.getMaxColumns();
    const make = (f) => Array.from({ length: n }, () => f(cols));
    this._data.splice(after, 0, ...make(blankRow));
    this._formats.splice(after, 0, ...make(nullRow));
    this._bold.splice(after, 0, ...Array.from({ length: n }, () => new Array(cols).fill(false)));
    this._validation.splice(after, 0, ...make(nullRow));
    return this;
  }
  insertColumnsAfter(after, n) {
    if (after < 1 || after > this.getMaxColumns()) throw new Error(BOUNDS_ERROR);
    const add = (rows, fill) => rows.forEach((r) => r.splice(after, 0, ...new Array(n).fill(fill)));
    add(this._data, '');
    add(this._formats, null);
    add(this._bold, false);
    add(this._validation, null);
    return this;
  }
  setFrozenRows(n) { this._frozen = n; return this; }
  // Test yardımcıları
  rowObjects() {
    const last = this.getLastRow();
    if (last < 2) return [];
    const headers = this._data[0];
    return this._data.slice(1, last).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]]).filter(([h]) => h !== '')));
  }
  snapshot() {
    return JSON.stringify({
      name: this._name, data: this._data, formats: this._formats, bold: this._bold,
      validation: this._validation, frozen: this._frozen
    });
  }
}

class FakeSpreadsheet {
  constructor(env) {
    this._env = env;
    this._sheets = [new FakeSheet(this, 'Sayfa1')];
  }
  getSheetByName(name) { return this._sheets.find((s) => s.getName() === name) || null; }
  getSheets() { return this._sheets.slice(); }
  insertSheet(name) {
    if (this.getSheetByName(name)) throw new Error('A sheet with the name "' + name + '" already exists.');
    const s = new FakeSheet(this, name);
    this._sheets.push(s);
    return s;
  }
  snapshot() { return this._sheets.map((s) => s.snapshot()).join('\n'); }
}

function makeEnv() {
  const env = {
    logs: [], consoleErrors: [], flushes: 0, writes: 0,
    lockAvailable: true, lockHeld: false, lockErrors: [], lockAttempts: 0,
    lockFailures: 0,   // sonraki N tryLock çağrısı başarısız olur (geçici yoğunluk)
    appUrl: 'https://script.google.com/macros/s/TEST/exec',
    // Session: düzenleyicide etkin = asıl kullanıcı (sahip); anonim web ziyaretçisinde etkin e-posta boş.
    activeEmail: 'owner@example.com', effectiveEmail: 'owner@example.com'
  };
  env.ss = new FakeSpreadsheet(env);
  env.cache = makeCache();
  return env;
}

/**
 * Sahte CacheService.getScriptCache(): değerler metin olarak saklanır; 100 KB (102.400 bayt) üstü
 * değer ve 21.600 sn üstü süre gerçek hizmetteki gibi hata fırlatır. broken = true iken her çağrı hata verir.
 */
function makeCache() {
  const store = new Map();
  const c = {
    store, broken: false, stats: { gets: 0, hits: 0, puts: 0, removes: 0 },
    expireAll() { store.clear(); },
    api: {
      get(key) {
        if (c.broken) throw new Error('Cache service unavailable');
        c.stats.gets++;
        const e = store.get(key);
        if (!e || e.exp <= Date.now()) { store.delete(key); return null; }
        c.stats.hits++;
        return e.value;
      },
      put(key, value, ttl) {
        if (c.broken) throw new Error('Cache service unavailable');
        if (typeof value !== 'string') throw new Error('Cache value must be a string');
        if (Buffer.byteLength(value, 'utf8') > 102400) throw new Error('Argument too large: value');
        if (!(ttl >= 1 && ttl <= 21600)) throw new Error('Invalid expiration: ' + ttl);
        c.stats.puts++;
        store.set(key, { value, exp: Date.now() + ttl * 1000 });
      },
      remove(key) { if (c.broken) throw new Error('Cache service unavailable'); c.stats.removes++; store.delete(key); },
      removeAll(keys) { if (c.broken) throw new Error('Cache service unavailable'); c.stats.removes += keys.length; keys.forEach((k) => store.delete(k)); }
    }
  };
  return c;
}

/**
 * Code.gs'i yeni bir vm bağlamında yükler.
 * @param {object} o  session: CURRENT_SESSION için JS ifadesi (ör. 2, '7', "'2'")
 *                    config: CONFIG anahtar geçersiz kılmaları
 *                    env: paylaşılan sahte ortam (aynı e-tabloyu farklı oturum ayarıyla kullanmak için)
 */
function loadCode(o = {}) {
  const env = o.env || makeEnv();
  let src = fs.readFileSync(CODE_PATH, 'utf8');
  if (o.session !== undefined) {
    const re = /^const CURRENT_SESSION = [^;]+;/m;
    if (!re.test(src)) throw new Error('CURRENT_SESSION satırı bulunamadı');
    src = src.replace(re, 'const CURRENT_SESSION = ' + String(o.session) + ';');
  }
  Object.entries(o.config || {}).forEach(([k, v]) => {
    // Değer; virgül, satır sonu veya satır sonu yorumu (//) ile biter.
    const re = new RegExp('(\\n  ' + k + ':\\s*)[^,\\n]*?(\\s*(?:,|//|\\n))');
    if (!re.test(src)) throw new Error('CONFIG anahtarı bulunamadı: ' + k);
    src = src.replace(re, '$1' + JSON.stringify(v) + '$2');
  });

  const sandbox = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => env.ss,
      flush: () => { env.flushes++; },
      newDataValidation: () => {
        const rule = {};
        const b = {
          requireValueInList(list, dropdown) { rule.type = 'list'; rule.list = list.slice(); rule.dropdown = dropdown; return b; },
          setAllowInvalid(x) { rule.allowInvalid = x; return b; },
          build() { return Object.freeze(Object.assign({}, rule)); }
        };
        return b;
      }
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => {
          env.lockAttempts++;
          if (env.lockFailures > 0) { env.lockFailures--; return false; }
          if (!env.lockAvailable) return false;
          if (env.lockHeld) env.lockErrors.push('tryLock while held');
          env.lockHeld = true;
          return true;
        },
        releaseLock: () => {
          if (!env.lockHeld) env.lockErrors.push('releaseLock without lock');
          env.lockHeld = false;
        }
      })
    },
    Utilities: { getUuid: () => crypto.randomUUID() },
    CacheService: { getScriptCache: () => env.cache.api },
    Session: {
      getActiveUser: () => ({ getEmail: () => env.activeEmail }),
      getEffectiveUser: () => ({ getEmail: () => env.effectiveEmail })
    },
    Logger: { log: (m) => { env.logs.push(String(m)); } },
    console: {
      log: (...a) => env.logs.push(a.join(' ')),
      warn: (...a) => env.logs.push(a.join(' ')),
      error: (...a) => env.consoleErrors.push(a.join(' '))
    },
    ScriptApp: { getService: () => ({ getUrl: () => env.appUrl }) },
    HtmlService: {
      XFrameOptionsMode: { DEFAULT: 'DEFAULT', ALLOWALL: 'ALLOWALL' },
      createTemplateFromFile(name) {
        const t = {
          evaluate() {
            let html = fs.readFileSync(path.join(ROOT, name + '.html'), 'utf8');
            html = html.replace(/<\?!=\s*(\w+)\s*\?>/g, (m, key) => {
              if (!(key in t)) throw new Error('Şablon değişkeni tanımsız: ' + key);
              return String(t[key]);
            });
            if (/<\?/.test(html)) throw new Error('İşlenmemiş scriptlet kaldı');
            const out = {
              title: '', meta: [], xfo: null, content: html,
              setTitle(x) { out.title = x; return out; },
              addMetaTag(n, c) { out.meta.push([n, c]); return out; },
              setXFrameOptionsMode(m) { out.xfo = m; return out; },
              getContent() { return out.content; }
            };
            return out;
          }
        };
        return t;
      }
    }
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(src, ctx, { filename: 'Code.gs' });
  return {
    ctx, env,
    /** Bağlamdaki bir ifadeyi değerlendirir (const sabitlerine erişim için). */
    get: (expr) => vm.runInContext(expr, ctx),
    /** google.script.run gibi JSON serileştirmesiyle çağırır. */
    call: (fn, ...args) => {
      if (typeof ctx[fn] !== 'function') throw new Error('Fonksiyon yok: ' + fn);
      const res = ctx[fn](...JSON.parse(JSON.stringify(args)));
      return res === undefined ? undefined : JSON.parse(JSON.stringify(res));
    }
  };
}

/** Test kurulumu: CaseDetails'teki tüm vakaları aktif yapar (yer tutucular v2.3'ten beri pasif yüklenir). */
function activateAllCases(env) {
  const s = env.ss.getSheetByName('CaseDetails');
  const col = s._data[0].indexOf('active_status');
  for (let r = 1; r < s.getLastRow(); r++) s._data[r][col] = 1;
}

/** Participants sayfasına kod ekler (sayfa yoksa oluşturur); kodlar düz metin hücreye yazılır. */
function addParticipants(env, ids, status = 1) {
  let s = env.ss.getSheetByName('Participants');
  if (!s) {
    s = env.ss.insertSheet('Participants');
    s.getRange(1, 1, 1, 2).setValues([['user_id', 'active_status']]);
  }
  const start = s.getLastRow() + 1;
  const need = start + ids.length - 1;
  if (need > s.getMaxRows()) s.insertRowsAfter(s.getMaxRows(), need - s.getMaxRows());
  ids.forEach((id, i) => { s._formats[start - 1 + i][0] = '@'; });
  s.getRange(start, 1, ids.length, 2).setValues(ids.map((id) => [id, status]));
  return s;
}

/** Testlerde kullanılan kodlar: P-0…P-99, P-000…P-999, 000…099, TEST-1…TEST-9 ve birkaç adlandırılmış kod. */
const TEST_PARTICIPANTS = [].concat(
  Array.from({ length: 100 }, (_, i) => 'P-' + i),
  Array.from({ length: 1000 }, (_, i) => 'P-' + String(i).padStart(3, '0')),
  Array.from({ length: 100 }, (_, i) => String(i).padStart(3, '0')),
  Array.from({ length: 9 }, (_, i) => 'TEST-' + (i + 1)),
  ['P-A', 'P-B', 'P-H', 'P-L', 'P-X', 'P-ONE', 'P-SKIP', 'P-HALF', 'P-OTHER']
);

module.exports = { loadCode, makeEnv, FakeSheet, ROOT, activateAllCases, addParticipants, TEST_PARTICIPANTS };
