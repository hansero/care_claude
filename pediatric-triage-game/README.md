# Pediatrik Triyaj Ciddi Oyunu v2.2 (Google Apps Script)

Plan.md v2.2.0 (23.10.2026) uyarınca yazılmıştır: v2.0 temeli + §18 (güven düzeyi, Gelişimim,
rozetler) + §19 (tamamlama kilidi). **Araştırmacı kararıyla tek fark:** triyaj ölçeği, Sağlık
Bakanlığı renk kodlu sistemin **3 grubudur** (Kırmızı · Sarı · Yeşil); Tebliğ'deki K1/K2 alt
kategorileri kendi renk grubunda birleştirilmiştir.

| Dosya | Apps Script'te |
|---|---|
| `Code.gs` | `Code.gs` (sunucu) |
| `index.html` | HTML dosyası, adı **`index`** |
| `appsscript.json` | Proje Ayarları → "appsscript.json manifest dosyasını düzenleyicide göster" |

## 3 gruplu triyaj nedeniyle plandan sapmalar

| Konu | Plan (5 basamak) | Bu sürüm (3 grup) |
|---|---|---|
| Kodlar | `KIRMIZI_K1`, `KIRMIZI_K2`, `SARI_K1`, `SARI_K2`, `YESIL` | `KIRMIZI` (rank 1), `SARI` (2), `YESIL` (3) |
| `RESPONSE_HEADERS` | 49 sütun | 46 sütun — `user_triage_area`, `reference_triage_area`, `triage_area_match` yok (3 grupta kategori = renk alanı; birebir kopya olurlardı). `user_triage_confidence` var. |
| `triage_difference` | −4…+4 | −2…+2 (pozitif = düşük triyaj) |
| `dangerous_under_triage` | Kırmızı alan vakası → Sarı/Yeşil | Aynı tanım: referans `KIRMIZI`, yanıt `SARI`/`YESIL` |
| Özet kutuları | Triyaj · Renk alanı · PDÜ · Vital · Süre · Güven dağılımı | Triyaj · PDÜ · Vital · Süre · Güven dağılımı |
| Gelişimim tablosu | "Renk alanı" satırı var | Yok (triyaj kategorisi satırıyla aynı olurdu) |
| Rozetler | 5 (`COLOR_EYE` dahil) | 4 — `COLOR_EYE` "Renk Gözü" yok (`BULLSEYE` "Tam İsabet" ile birebir aynı olurdu); kart başlığı `· x/4` |
| `redAreaCorrect` / `greenAreaCorrect` | `*_triage_area` sütunlarından | `*_triage_level` = `KIRMIZI` / `YESIL` üzerinden (aynı anlam) |
| Yer tutucu vakalar (Ek D) | 5 basamaklı referans | Referans 3 gruba dönüştürüldü; gerekçe sonları "…: Kırmızı Alan." vb. Diğer tüm alanlar birebir |

## Plana eklenen küçük önlemler

- `initializeDatabase`, `auditCaseDataset`, `previewSession` web uygulamasından
  `google.script.run` ile de çağrılabildiği için raporlar **yalnızca Yürütme günlüğüne**
  yazılır, çağırana hiçbir şey döndürülmez (referans sızıntısı önlemi). Denetim raporu ayrıca
  oyun bileşeni bayraklarını ve özet penceresi süresini gösterir.
- `=`, `+`, `-`, `@` ile başlayan katılımcı kodu reddedilir (`E_USER_ID_INVALID`; formül enjeksiyonu).
- Beklenmeyen istisnalar istemciye ayrıntı vermeden `E_INTERNAL` olarak döner.
- `@OnlyCurrentDoc`: betiğin yetkisi yalnızca bağlı olduğu e-tabloyla sınırlıdır.
- **Gelişimim grafiği:** masaüstünde planın `viewBox="0 0 640 280"` geometrisi; 560 px'ten dar
  ekranlarda etiketler okunur kalsın diye yaklaşık 1:1 ölçekli `340×220` geometri (ekran
  döndürülünce yeniden çizilir). Mevcut oturumun değer etiketi triyaj noktasının yanında, beyaz
  haleyle; üç seri üst üste binmesin diye noktalar ±5 birim kaydırılır.
- Güven seçenekleri mobilde alt alta dizilir.

## v2.0'dan yükseltme

v2.1 ile `Session` sayfalarına `user_triage_confidence` sütunu eklendi. v2.0 ile oluşturulmuş
`Session1…5` sayfalarında **yalnızca test verisi** varsa bu sayfaları silip `initializeDatabase()`
fonksiyonunu yeniden çalıştırın (`CaseDetails` korunur). Aksi halde başlık uyuşmazlığı
(`E_SHEET_HEADERS`) alınır ve Yürütme günlüğünde bu ipucu yazılır.

## Testler

```bash
node --test tests/*.test.js                                  # saf fonksiyonlar, istemci saf bölümü, sunucu (sahte E-Tablo)
NODE_PATH="$(npm root -g)" node --test tests/ui.e2e.js       # Playwright + Chromium uçtan uca arayüz
```

`tests/harness.js`, `Code.gs`'i Node'da sahte bir Apps Script ortamında çalıştırır
(sayfa sınırı hataları, `'@'` biçimsiz hücrede `014 → 14` dönüşümü, `=` formül tespiti dahil).
`tests/client-pure.test.js`, `index.html` içindeki `@pure-begin … @pure-end` bölümünü
(`computeBadges`, `learningCurveModel`) Node'da çalıştırır.
Testler teslimatın parçası değildir; Apps Script'e yalnızca üç dosya yapıştırılır.
