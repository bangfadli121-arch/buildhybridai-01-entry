# StrukKu — Buku Kas Warung dari Foto Struk

> Entri **#BuildHybridAI 2026** (Devpost) — aplikasi web Gen AI dengan
> **Firebase AI Logic hybrid inference**: ekstraksi struk jalan **on-device**
> (Gemini Nano di Chrome) bila tersedia, fallback otomatis ke **cloud**
> (Gemini) bila tidak.

## Masalah

Pemilik warung/toko kelontong di Indonesia mencatat belanja kulakan di buku tulis
— atau tidak sama sekali. Struk menumpuk, tidak pernah jadi laporan. Mereka tidak
tahu barang mana yang paling boros, kapan harga kulakan naik, atau berapa laba
bulan ini.

## Cara kerja

1. **Foto struk** dari HP/laptop.
2. **On-device (Gemini Nano):** ekstrak item, jumlah, harga satuan, dan total
   sebagai JSON terstruktur — instan, offline, dan **data keuangan tidak keluar
   dari perangkat** untuk tahap ekstraksi.
3. **Cloud (Gemini):** bila struk rusak/blur/tulisan tangan, cloud mengekstrak;
   lalu kategorisasi belanja, deteksi anomali harga, ringkasan laba-rugi, dan
   tanya-jawab soal pengeluaran.
4. **Buku kas** tersimpan di Firestore; tiap struk menampilkan badge
   "Dijawab perangkat" / "Dijawab cloud" (`response.inferenceSource`).

## Teknologi

- Firebase AI Logic — hybrid inference (`PREFER_ON_DEVICE`)
- Firebase App Check (wajib), Firestore, Auth anonim
- Vite + vanilla JS (tanpa framework, biar ringan)

## Menjalankan (lokal)

```bash
npm install
cp .env.example .env   # isi dengan Firebase config project kamu
npm run dev            # atau: npm run build && npm run preview
```

Syarat on-device: **Chrome Desktop v139+**, flag
`chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` di-Enabled.
Untuk local dev, App Check memakai debug provider — isi
`VITE_FIREBASE_APPCHECK_DEBUG_TOKEN` di `.env` dengan token yang sudah
terdaftar di Firebase console (Security > App Check > Apps > Manage debug
tokens). Tanpa Firebase config, aplikasi tetap jalan penuh dalam **mode
demo** (buku kas di IndexedDB, isi struk manual, jawaban lokal) — scan AI
dan Q&A cloud butuh config.

## Status (20 Nov 2026)

Aplikasi v1 selesai dan teruji di mode demo + sebagian dengan config asli
(project `strukku`, Spark gratis, Gemini Developer API):
- Scan hybrid on-device/cloud, koreksi per baris, buku kas, laporan
  (belanja/omzet/laba, kategori, anomali harga & duplikat), export CSV,
  Q&A — semua jalan di mode demo (uji browser 23/24 + unit 29/29).
- Dengan config asli: aplikasi terhubung ke Firebase tanpa error init;
  model cloud yang menjawab adalah `gemini-3.5-flash-lite`.
- **Belum terverifikasi di lingkungan ini:** scan AI dan Q&A cloud
  end-to-end menggantung di VM ini (App Check `getToken()` tidak pernah
  resolve walau exchange debug token HTTP 200; POST ke endpoint Google AI
  stall di setup Brave headless + egress proxy). On-device juga
  `unavailable` di Brave headless — aplikasi kini melaporkannya dengan
  jujur, bukan mengklaim "siap". Uji di Chrome desktop/HP dengan jaringan
  normal masih diperlukan sebelum demo/submit.
- **Firestore rules masih terkunci** (`allow read, write: if false`):
  sinkronisasi buku kas belum bisa jalan; app memakai IndexedDB lokal.
  Buka rules via Firebase console (dengan App Check) sebelum submit.

Lihat [`research-firebase-ai-logic.md`](../devpost-buildhybridai/research-firebase-ai-logic.md)
di folder riset untuk detail SDK.

## Lisensi

Apache License 2.0 — lihat [LICENSE](LICENSE).
