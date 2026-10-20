# Pediatrik Triyaj Ciddi Oyunu v2.0 (Google Apps Script)

Plan.md v2.0.0 uyarınca yazılmıştır. **Tek fark:** triyaj ölçeği, Sağlık Bakanlığı
renk kodlu sistemin **3 grubudur** (Kırmızı · Sarı · Yeşil). Tebliğ'deki K1/K2 alt
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
| `RESPONSE_HEADERS` | 48 sütun | 45 sütun — `user_triage_area`, `reference_triage_area`, `triage_area_match` kaldırıldı (3 grupta düzey = alan olduğundan birebir kopya olurlardı) |
| `triage_difference` | −4…+4 | −2…+2 (pozitif = düşük triyaj) |
| `dangerous_under_triage` | Kırmızı alan vakası → Sarı/Yeşil | Aynı tanım: referans `KIRMIZI`, yanıt `SARI`/`YESIL` |
| Özet kutuları | Triyaj · Renk alanı · PDÜ · Vital · Süre | Triyaj · PDÜ · Vital · Süre |
| Yer tutucu vakalar (Ek D) | 5 basamaklı referans | Referans 3 gruba dönüştürüldü; gerekçe sonları "…: Kırmızı Alan." vb. Diğer tüm alanlar birebir |

## Plana eklenen küçük güvenlik / dayanıklılık önlemleri

- `initializeDatabase`, `auditCaseDataset`, `previewSession` web uygulamasından
  `google.script.run` ile de çağrılabildiği için raporlar **yalnızca Yürütme günlüğüne**
  yazılır, çağırana hiçbir şey döndürülmez (referans sızıntısı önlemi).
- `=`, `+`, `-`, `@` ile başlayan katılımcı kodu reddedilir (`E_USER_ID_INVALID`;
  e-tablo/Excel formül enjeksiyonu).
- Beklenmeyen istisnalar istemciye ayrıntı vermeden `E_INTERNAL` olarak döner.
- Yeni sayfa 26 sütunla açıldığından başlıklar yazılmadan önce sütun eklenir (40/45 sütun).
- `@OnlyCurrentDoc`: betiğin yetkisi yalnızca bağlı olduğu e-tabloyla sınırlıdır.
- BOOT değişkenleri `<?!= bootJson ?>` ile tek JSON olarak aktarılır (betik içi kaçış belirsizliği yok).
- "Sayfayı yenile", Apps Script iframe'inde güvenilir olsun diye `/exec` adresine `target="_top"` bağlantıdır.

## Testler

```bash
node --test tests/*.test.js                                  # saf fonksiyonlar + sunucu (sahte E-Tablo)
NODE_PATH="$(npm root -g)" node --test tests/ui.e2e.js       # Playwright + Chromium uçtan uca arayüz
```

`tests/harness.js`, `Code.gs`'i Node'da sahte bir Apps Script ortamında çalıştırır
(sayfa sınırı hataları, `'@'` biçimsiz hücrede `014 → 14` dönüşümü, `=` formül tespiti dahil).
Testler teslimatın parçası değildir; Apps Script'e yalnızca üç dosya yapıştırılır.
