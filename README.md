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
npm run dev
```

Syarat on-device: **Chrome Desktop v139+**, flag
`chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` di-Enabled.
Untuk local dev, App Check memakai debug provider — daftarkan debug token di
Firebase console (Security > App Check > Apps > Manage debug tokens).

## Status

Scaffold awal — Firebase project & config menyusul. Lihat
[`research-firebase-ai-logic.md`](../devpost-buildhybridai/research-firebase-ai-logic.md)
di folder riset untuk detail SDK.

## Lisensi

Apache License 2.0 — lihat [LICENSE](LICENSE).
