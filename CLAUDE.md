# Tape — Bar Replay & Paper Trading PWA

PWA mobile-first untuk bar replay, paper trading, dan guided drills. Semua data lokal (IndexedDB + ekspor/impor JSON), tanpa backend.

Stack: Vite + React 19 + TypeScript (strict) + Tailwind v4 + `lightweight-charts` v5 + `zustand` + `lucide-react` + `vite-plugin-pwa`.

## Perintah

- `npm run dev` — dev server (port 5173, `--host` agar bisa dibuka dari HP)
- `npm run typecheck` — wajib bersih sebelum menyatakan pekerjaan selesai
- `npm run build` — typecheck + build produksi + service worker
- `npm run drills` — membuat ulang `src/drills/scenarios.json` dari `scripts/gen-drills.mjs`
- `npm run icons` — membuat ulang ikon PWA

Tidak ada test runner. Verifikasi = typecheck + build + coba di browser. Di mode dev, `window.tape` membuka `useStore`, `getCandles`, `getDisplay`, `lastCandle`, `equity` untuk menguji logika dari console.

## Peta kode

```
src/
  store.ts               state utama (zustand): dataset, cursor replay, akun, order, jurnal, gambar, UI
  App.tsx                layout desktop/mobile, shortcut keyboard, timer auto-play, pindah view replay/drills
  lib/
    types.ts             Candle, DatasetMeta, Position, Order, Trade, Drawing
    aggregate.ts         Aggregator (TF rendah -> TF tinggi), bucketOf, pencarian indeks
    engine.ts            fill order, SL/TP, PnL — fungsi murni
    stats.ts             metrik performa + review perilaku sesi
    indicators.ts        EMA / RSI inkremental
    sampleData.ts        4 dataset sintetis ber-seed (bukan histori asli)
    csv.ts, binance.ts   impor CSV (TradingView/MT4/MT5) dan fetch klines Binance
    db.ts                key-value IndexedDB
    format.ts, theme.ts  format angka/waktu, label TF, warna untuk canvas
  components/
    ChartView.tsx        chart replay: candle, indikator, overlay gambar, drag garis SL/TP
    Replay.tsx, DrawToolbar.tsx, OrderTicket.tsx, Positions.tsx, Journal.tsx,
    Dashboard.tsx, DataModal.tsx, SettingsModal.tsx, SessionSummary.tsx, ui.tsx
    drills/DrillsView.tsx  hub, kartu misi, kartu feedback, simpan drill kustom
    drills/DrillChart.tsx  chart khusus drill (terpisah dari ChartView, sengaja)
  drills/
    types.ts, grade.ts, store.ts, scenarios.json (hasil generate — jangan diedit tangan)
```

## ATURAN 1 — No future leak (tidak boleh dilanggar)

Model datanya:

- Setiap dataset disimpan sebagai **candle dasar** pada timeframe terendahnya (`meta.baseTf`), di `candleCache` di luar state reaktif. Ambil dengan `getCandles(id)`.
- `cursor` = jumlah candle dasar yang sudah terbuka. Indeks `>= cursor` adalah masa depan yang tersembunyi.
- Chart **hanya** menerima candle dari `getDisplay()`, yang memanggil `Aggregator.get(base, key, tf, cursor)`. Candle TF tinggi yang sedang terbentuk dibangun murni dari candle dasar `[0, cursor)`.

Yang wajib dijaga saat menambah atau mengubah fitur:

1. Apa pun yang ditampilkan atau dihitung untuk pengguna (candle, indikator, legenda, marker, statistik, harga "saat ini") harus berasal dari `getDisplay()` atau `lastCandle()`. Jangan pernah membaca `getCandles(id)` melewati `cursor` untuk keperluan tampilan atau keputusan.
2. Jangan menyimpan candle TF tinggi yang sudah jadi (pre-aggregated) lalu memotongnya berdasarkan waktu — high/low/close candle terakhir akan membocorkan masa depan. TF tinggi selalu diagregasi ulang dari candle dasar.
3. Indikator dihitung dari array hasil `getDisplay()` saja.
4. Marker trade di chart difilter dengan `exitTime <= lastCandle().time` (penting setelah mundur atau lompat).
5. `stepForward` membuka candle dasar satu per satu sampai bucket TF yang tampil lengkap, dan memanggil `processCandle` untuk **setiap** candle dasar. Jangan memproses order per candle TF tinggi; akurasi fill intrabar bergantung pada ini.
6. Bucket TF memakai `bucketOf(time, tf)` (lantai UTC). Pakai fungsi itu, jangan menghitung ulang sendiri.
7. Timeframe yang tersedia untuk sebuah dataset datang dari `tfOptions(baseTf)` — hanya kelipatan bersih dari TF dasar.

Satu-satunya pengecualian yang sah: `buildCustomDrill` di `src/drills/store.ts` membaca candle masa depan untuk dijadikan bagian *reveal* sebuah drill. Data itu tidak ditampilkan sampai pengguna menekan Submit. Bagian pertanyaan hanya berisi candle TF yang sudah lengkap.

Cara menguji setelah menyentuh replay/agregasi: di console, majukan beberapa langkah pada TF tinggi dan bandingkan candle terakhir `getDisplay()` dengan agregasi manual candle dasar `[.., cursor)` pada bucket yang sama. Harus identik.

## ATURAN 2 — Mesin order (`lib/engine.ts`)

Fungsi murni, tanpa akses store. Asumsi fill yang sudah ditetapkan — jangan diubah diam-diam:

- Harga chart = mid. Setiap fill digeser setengah spread melawan trader. Komisi = % notional per sisi, dipotong saat trade ditutup.
- Candle yang gap melewati level terisi di harga open.
- Jika satu candle menyentuh SL dan TP, SL dianggap kena lebih dulu.
- Posisi yang terbuka di dalam sebuah candle bisa kena SL di candle itu juga, tetapi baru TP jika candle itu *close* melewati target.
- R dihitung dari `initialSl`. Menggeser SL menjauh (atau menghapusnya) menyalakan `slWidened` untuk review sesi.

Step back memakai tumpukan snapshot `history` di `store.ts` (satu entri per langkah maju). Aksi apa pun yang memindahkan cursor selain satu langkah maju (cut, jump, random, ganti dataset, impor, hapus trade) harus mengosongkan `history` dan melewati `confirmDiscard()` bila ada posisi terbuka.

## ATURAN 3 — Layout responsif HP / laptop

- Satu breakpoint: `768px`. Pakai hook `useIsDesktop()` dari `components/ui.tsx` untuk percabangan struktur, dan kelas `md:` Tailwind untuk penyesuaian kecil. Jangan menambah breakpoint struktur lain.
- **Desktop (>=768px):** top bar (simbol, TF, kontrol replay, indikator), toolbar gambar vertikal di kiri, chart, panel kanan 340px yang bisa disembunyikan. Label tombol top bar disembunyikan di bawah `xl`.
- **Mobile (<768px):** chart layar penuh, `DrawFloat` dan `ReplayFloat` mengambang di atas chart, navigasi bawah, dan `Drawer` (bottom sheet) untuk Trade / Open / Journal / Stats / Indicators.
- Setiap fitur baru harus punya tempat di kedua layout. Konten panel ditulis sekali (mis. `OrderTicket`) lalu dipasang di `SidePanel` dan `Drawer` lewat `PanelBody`.
- Target sentuh minimal 36px (lebih baik 40–44px di mobile). Hit-test canvas memakai toleransi lebih besar untuk `pointerType === 'touch'`.
- Hormati `env(safe-area-inset-bottom)` pada elemen yang menempel di bawah.

## ATURAN 4 — Interaksi chart

- `lightweight-charts` mendengarkan event mouse/touch, bukan pointer. Untuk mengambil alih gestur (menggambar, menggeser garis), tangkap `pointerdown` di fase capture, set flag `intercept`, lalu telan `mousedown`/`touchstart` berikutnya. Pola ini ada di `ChartView.tsx` dan `DrillChart.tsx`; ikuti, jangan membuat mekanisme lain.
- `timeScale().logicalToCoordinate()` hanya menerima indeks bulat. Untuk posisi pecahan, interpolasi antara dua indeks tetangga (lihat `xOf` di `ChartView.tsx`).
- Elemen chart punya `z-index` sendiri; wadah chart harus `isolate` agar overlay DOM tampil di atasnya.
- Gambar disimpan sebagai `{ waktu unix, harga }`, bukan piksel, dan dipetakan lewat indeks bar agar tetap benar saat ganti TF dan pada data yang berjeda (akhir pekan, jam bursa).
- Overlay digambar di canvas dengan loop `requestAnimationFrame` yang melewatkan frame jika tidak ada perubahan.
- API v5: `chart.addSeries(CandlestickSeries, opts, paneIndex)`, `createSeriesMarkers(series, [])`. Jangan memakai API v4 (`addCandlestickSeries`).

## ATURAN 5 — State & persistensi

- Satu store utama (`useStore`) dan satu store drill (`useDrills`). Array candle tidak pernah masuk state reaktif.
- Persistensi lewat `lib/db.ts`: kunci `state` (di-debounce 500 ms dari subscribe store), `candles:<id>` per dataset impor, `drills`.
- Field baru yang harus bertahan setelah reload: tambahkan ke daftar di blok persistensi di akhir `store.ts`, dan ke `exportJson` / `importJson` bila harus ikut backup. (Drill kustom saat ini belum ikut backup JSON.)
- Dataset `sample` selalu dibuat ulang saat start dan tidak disimpan.
- Selector zustand harus mengembalikan nilai primitif atau referensi stabil; jangan mengembalikan objek/array baru dari selector.

## ATURAN 6 — Gaya UI

- Dark mode saja. Token warna di `@theme` pada `src/index.css` (`bg`, `panel`, `raised`, `line`, `ink`, `text`, `muted`, `up`, `down`, `amber`, `blue`); salinannya untuk canvas ada di `lib/theme.ts`. Kalau satu diubah, ubah keduanya.
- Font: IBM Plex Sans untuk teks, IBM Plex Mono (`.num`) untuk semua angka.
- Pakai kelas komponen yang ada: `.btn`, `.btn-ghost`, `.input`, `.seg`, `.chip`, `.card`, `.label`. Amber = aksi utama/aktif, hijau/merah hanya untuk naik/turun dan untung/rugi.
- Tanpa gradien dekoratif, glassmorphism, atau emoji. Ikon dari `lucide-react`.
- Teks UI dalam bahasa Inggris, singkat, dan menjelaskan alasan saat menolak aksi (lihat pesan validasi di `placeOrder`).

## Data & kejujuran label

- Dataset bawaan dan 12 drill bawaan adalah **sintetis / pola buatan**. UI menyatakannya; pertahankan label itu dan jangan menyebutnya histori asli.
- Parser CSV membaca waktu sebagai UTC dan menentukan TF dasar dari jarak antar-bar yang paling sering.
- Fetch Binance mencoba `data-api.binance.vision` lebih dulu, lalu `api.binance.com`.
- Tidak ada konversi mata uang maupun batas margin; simbol mata uang akun hanya label.

## Menambah fitur — daftar periksa

1. Apakah fitur membaca candle? Lewat `getDisplay()` / `lastCandle()` saja (Aturan 1).
2. Apakah fitur memindahkan cursor? Kosongkan `history`, panggil `confirmDiscard()`.
3. Apakah ada tempatnya di layout desktop dan mobile? (Aturan 3)
4. Apakah datanya perlu bertahan / ikut backup? (Aturan 5)
5. `npm run typecheck` dan `npm run build` bersih, lalu coba di browser pada lebar desktop dan 375px.
6. Jangan menulis ulang file yang sudah berjalan untuk fitur yang bisa ditambahkan di sampingnya.
