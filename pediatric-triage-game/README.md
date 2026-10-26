# Pediatrik Triyaj Ciddi Oyunu v2.3.1 (Google Apps Script)

Plan.md v2.2.0 (23.10.2026) uyarınca yazılmıştır: v2.0 temeli + §18 (güven düzeyi, Gelişimim,
rozetler) + §19 (tamamlama kilidi). v2.3, dış incelemelerden gelen veri bütünlüğü ve güvenlik
düzeltmelerini ve araştırmacının rozet revizyonunu içerir (aşağıda). **Araştırmacı kararıyla:**
triyaj ölçeği, Sağlık Bakanlığı renk kodlu sistemin **3 grubudur** (Kırmızı · Sarı · Yeşil);
Tebliğ'deki K1/K2 alt kategorileri kendi renk grubunda birleştirilmiştir.

| Dosya | Apps Script'te |
|---|---|
| `Code.gs` | `Code.gs` (sunucu) |
| `index.html` | HTML dosyası, adı **`index`** |
| `appsscript.json` | Proje Ayarları → "appsscript.json manifest dosyasını düzenleyicide göster" |

## 3 gruplu triyaj ve araştırmacı kararları nedeniyle plandan sapmalar

| Konu | Plan (5 basamak) | Bu sürüm |
|---|---|---|
| Kodlar | `KIRMIZI_K1`, `KIRMIZI_K2`, `SARI_K1`, `SARI_K2`, `YESIL` | `KIRMIZI` (rank 1), `SARI` (2), `YESIL` (3) |
| `RESPONSE_HEADERS` | 49 sütun | 47 sütun — `*_triage_area` / `triage_area_match` yok (3 grupta kategori = renk alanı). `user_triage_confidence` (v2.1) ve `hidden_time_seconds` (v2.3) var. |
| `triage_difference` | −4…+4 | −2…+2 (pozitif = düşük triyaj) |
| `dangerous_under_triage` | Kırmızı alan vakası → Sarı/Yeşil | Aynı tanım: referans `KIRMIZI`, yanıt `SARI`/`YESIL` |
| Özet kutuları | Triyaj · Renk alanı · PDÜ · Vital · Süre · Güven dağılımı | Triyaj · PDÜ · Vital · Süre · Güven dağılımı |
| Gelişimim tablosu | "Renk alanı" satırı var | Yok (triyaj kategorisi satırıyla aynı olurdu) |
| Rozetler | 5 (`RED_GUARD`, `FULL_TRIANGLE`, `VITAL_MASTER`, `BULLSEYE`, `COLOR_EYE`) | 4 (araştırmacı revizyonu): `FULL_TRIANGLE` Tam Üçgen · `VITAL_MASTER` Vital Ustası · `BULLSEYE` Tam İsabet · `PERFECT_CASE` **Kusursuz Vaka**. Kırmızı Nöbetçi ve Renk Gözü yok; kart başlığı `· x/4` |
| Rozet toplamları | `redAreaCorrect`, `greenAreaCorrect` | Kaldırıldı. Yerine `perfectCases`: PDÜ 3/3, vital 5/5 ve triyaj birebir doğru vaka sayısı (mevcut puan sütunlarından; yeni sütun yok) |
| Yer tutucu vakalar (Ek D) | 5 basamaklı referans | Referans 3 gruba dönüştürüldü; gerekçe sonları "…: Kırmızı Alan." vb. v2.3'ten beri **pasif** yüklenir |

Tehlikeli düşük triyaj özet ekranında ve Gelişimim tablosunda gösterilmeye devam eder.

## v2.3 — katılımcılar, veri tanımları ve işletim kuralları

### Katılımcı listesi (`Participants`)
- `initializeDatabase()` boş bir `Participants` sayfası oluşturur: `user_id` | `active_status` (ek sütunlar serbest).
- Yalnızca listede `active_status = 1` olan kodlar giriş yapabilir; `startSession`, `submitCase` ve
  `getSessionSummary` her çağrıda doğrular. Tanınmayan kodda genel bir mesaj gösterilir.
- Eşleştirmede büyük/küçük harf, boşluk ve noktalama yok sayılır: `p014`, `P 014` → listedeki **`P-014`**
  olarak kaydedilir. Baştaki sıfır anlamlıdır (`P-14` ≠ `P-014`).
- Çalışmadan ayrılan katılımcı için `active_status = 0`.
- Tahmin edilebilir kodlarda (P-014, P-015 …) biri başkasının kodunu deneyebilir; gerçek sahibi oturumunu
  "tamamlanmış" bulacağı için durum fark edilir. Ek güvenlik için kodlara rastgele bir sonek ekleyebilirsiniz
  (ör. `P-014-7KQ`).

### Veri sözlüğü notları
- `response_time_seconds`: vakanın ilk açılışından **ilk** "Yanıtı Gönder" tıklamasına geçen süre. Sayfa
  yenilense veya sekme kapanıp aynı vakaya dönülse de başlangıç korunur; ağ hatası sonrası yeniden denemeler
  süreyi değiştirmez.
- `hidden_time_seconds`: bu sürenin sayfa gizli (başka sekme/uygulama) veya kapalıyken geçen kısmı.
  **Etkin süre = `response_time_seconds − hidden_time_seconds`.** Bölünmüş ekranda "görünür ama odaksız"
  süre ayırt edilmez. Tarayıcı depolaması kapalıysa (ör. gizli mod) yenilemede süre yeniden başlar.
- Geçersiz (negatif / sayısal olmayan) süreler 0 değil **boş** (eksik veri) yazılır.
- `case_start_time` katılımcının cihaz saatidir; `case_submission_time` sunucu saatidir.
- `feedback_viewed` / `feedback_viewed_time`: sunucunun toplu geri bildirimi **verdiği** an (30 dk
  yeniden açma penceresinin başlangıcı). Geri bildirimin okunduğunu kanıtlamaz.

### Vaka bankası dondurma kuralı
- Açık oturumun vakaları düzenlenmez. Düzenlenirse gönderim `E_CASE_VERSION_CHANGED` ile reddedilir ve
  katılımcı vakayı yeni sürümle yeniden yanıtlar (görülmeyen sürüme göre puanlama yapılmaz).
- Gelecek oturumlarda düzeltme yaparken `case_version` değerini artırın.
- Her oturum açılışında E-Tablolar'da Dosya → Sürüm geçmişi → "Geçerli sürümü adlandır" ile arşiv alın.
- Yer tutucu vakalar pasif yüklenir; denetim raporu, metni yer tutucuyla aynı kalan aktif vakaları
  "gözden geçirilmemiş yer tutucu" olarak uyarır.

### Oturum açma / kapatma
- Kod varsayılan olarak `CURRENT_SESSION = 0` (kapalı) gelir. **Kodun yeni sürümünü yapıştırdığınızda
  değeri yürüyen oturuma göre yeniden ayarlayın.**
- Kapatmadan önce `auditCaseDataset()` çalıştırın: "Oturum n durumu" satırında **vakası eksik** ve
  **özet penceresi açık** 0 olmalı ya da son gönderimin üzerinden en az 30 dk geçmiş olmalı. Aksi halde
  oturumu bitirmek üzere olan katılımcılar geri bildirimlerini göremez.

### Yük ve eşzamanlılık (100 hekim) — v2.3.1
Apps Script bir kullanıcı adına en fazla **30 eşzamanlı yürütmeye** izin verir. Web uygulaması
"benim olarak" çalıştığı için tüm katılımcıların çağrıları bu 30'u paylaşır; sınırı aşan çağrı hiç
başlamaz ve tarayıcıya hata döner (sunucudan `E_BUSY` gelmez). Ayrıca yanıt yazımı, betik kilidiyle
sıraya girer.

- **Sessiz yeniden deneme (`index.html`, `callServer`):** giriş, gönderim ve özet çağrıları;
  sunucu `E_BUSY` / `E_INTERNAL` döndürürse **ya da çağrı hiç çalışamazsa** kullanıcıya hata
  göstermeden en fazla 3 kez yeniden denenir. Bekleme rastgeledir: 1–4 sn, sonra 2–8 sn, sonra 3–12 sn.
  Bu sırada "Yanıtınız kaydediliyor…" ekranda kalır. Tekrar güvenlidir: aynı vakanın ikinci kaydı
  `E_DUPLICATE` ile reddedilir ve istemci bunu başarı sayar; dondurulmuş süreler değişmez. Deneme hakkı
  bitince mesaj her zamanki gibi gösterilir.
- **Önbellek (`Code.gs`, `CacheService`):** hazır bir oturumun vakaları ve aktif katılımcı kodları
  `CACHE_TTL_SECONDS` (300 sn) boyunca önbellekten okunur. `Session1…5` yanıt sayfaları **asla**
  önbelleğe alınmaz (yineleme ve sıra denetimleri her zaman taze veriyle yapılır).
  - `CaseDetails` veya `Participants` el ile düzenlenince `onEdit` önbelleği hemen boşaltır;
    `auditCaseDataset()` / `previewSession()` çalıştırmak da boşaltır.
  - Listeye yeni eklenen kod **hemen** geçerlidir (önbellekte bulunmayan kod için liste yeniden okunur).
  - Hücre düzenlemesi olmadan yapılan değişiklikler (ör. sayfa silme/yeniden adlandırma) en geç 5 dk
    içinde yansır. `CACHE_TTL_SECONDS: 0` önbelleği kapatır.
  - CacheService'e erişilemezse hata verilmez; sayfalar doğrudan okunur.
- **Kısa kilit:** `submitCase` doğrulamaları (katılımcı, vaka, yanıt biçimi) kilitten önce yapar;
  kilit yalnızca `Session<n>` okuma-yazma bölümünü kapsar.
- **Kalan sınırlar:** sayfanın ilk açılışı (`doGet`) da 30 sınırına sayılır ve istemci kodu henüz
  yüklenmediği için otomatik denenemez; nadiren "sayfa açılmadı" görülürse sayfayı yenilemek yeter.
  Gerçek yükü veri toplamadan önce 5–10 meslektaşla aynı anda deneyen kısa bir pilotla doğrulayın.

### Araştırmacı fonksiyonları
`initializeDatabase`, `auditCaseDataset`, `previewSession` yalnızca **betik sahibi** tarafından
düzenleyiciden çalıştırılabilir (web uygulamasından `google.script.run` ile çağrılırsa hata verir).
Adlarının sonunda `_` yoktur, çünkü `_` ile biten fonksiyonlar Çalıştır menüsünde görünmez. Bu kontrol
için `userinfo.email` kapsamı gerekir. `appsscript.json` kapsamları açıkça sabitler:
`spreadsheets.currentonly` (yalnızca bu e-tablo) ve `userinfo.email`.

## v2.2'den yükseltme
1. `Session1…5` sayfalarında **yalnızca test verisi** varsa bu beş sayfayı silin (`hidden_time_seconds`
   sütunu eklendi; 47 sütun). Aksi halde `E_SHEET_HEADERS` alınır ve Yürütme günlüğüne ipucu yazılır.
2. Üç dosyayı yapıştırın (`appsscript.json` dahil) ve `initializeDatabase()` çalıştırın: Session sayfaları
   ve `Participants` oluşturulur, `CaseDetails` korunur. Yeni kapsam için bir kez yetki verin.
3. `Participants`'a kodları girin; gözden geçirilmiş vakaları aktif yapın; `CURRENT_SESSION` değerini ayarlayın.
4. Dağıt → Dağıtımları yönet → ✏ → **Yeni sürüm** → Dağıt.

## Canlı test kontrol listesi (gerçek Apps Script ortamı)
- Yetki ekranında yalnızca "bu e-tablo" ve "e-posta adresi" izinleri görünmeli.
- `Participants`'a `TEST-1` ekleyin, bir oturumun 3 vakasını aktif yapın, `CURRENT_SESSION = 1`, Yeni sürüm.
- `/exec` adresini **gizli pencerede, Google hesabı olmadan** ve telefonda WhatsApp içinden açın:
  - `TEST-1` ile 3 vaka ve özet; uydurma bir kodla ret;
  - vaka ortasında sayfa yenilenince süre baştan başlamamalı (satırdaki `case_start_time`);
  - özet ilk açılıştan 30 dk sonra yeniden açılınca kilit ekranı;
  - "Sayfayı yenile" düğmesi.
- Tarayıcı konsolunda `google.script.run.initializeDatabase()` hata vermeli.
- Önbellek: oturum açıkken bir vakanın `case_version` hücresini el ile değiştirin; o vakayı yanıtlamakta
  olan katılımcının gönderimi "vaka güncellendi" mesajı almalı (onEdit önbelleği boşaltıyor demektir).
  Almazsa önbellek en geç 5 dk sonra yenilenir; değişiklikten sonra `auditCaseDataset()` çalıştırın.
- Medya bağlantılarını araştırmacı hesabıyla oturum açılmamış bir tarayıcıda test edin (Drive dosyaları
  "bağlantıya sahip olan herkes" ile paylaşılmalı).

## Testler

```bash
node --test tests/*.test.js                                  # saf fonksiyonlar, istemci saf bölümü, sunucu (sahte E-Tablo)
NODE_PATH="$(npm root -g)" node --test tests/ui.e2e.js       # Playwright + Chromium uçtan uca arayüz
```

`tests/harness.js`, `Code.gs`'i Node'da sahte bir Apps Script ortamında çalıştırır
(sayfa sınırı hataları, `'@'` biçimsiz hücrede `014 → 14` dönüşümü, `=` formül tespiti, sahip/anonim
`Session` kipleri dahil). `tests/client-pure.test.js`, `index.html` içindeki `@pure-begin … @pure-end`
bölümünü (`computeBadges`, `learningCurveModel`, vaka zamanlayıcısı) Node'da çalıştırır.
Testler teslimatın parçası değildir; Apps Script'e yalnızca üç dosya yapıştırılır.
