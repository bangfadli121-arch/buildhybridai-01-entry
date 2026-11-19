# Fixture struk sintetis (QA saja)

Gambar di folder ini **digambar dengan PIL, bukan foto struk asli**. Dipakai
hanya untuk menguji alur UI/manual dan logika analitik lokal StrukKu.

**Bukan** bukti akurasi AI scan — scan AI asli butuh Firebase config dan
tidak diuji di sini.

- `struk-bersih.png` — TOKO KELONTONG SUMBER REZEKI, 20/11/2026 09:15,
  Beras 5kg Rp62.500, Gula Pasir 1kg Rp17.500, Minyak Goreng 2L Rp38.000,
  Mie Instan 10x Rp28.000, Kopi Sachet Rp12.000. Total **Rp158.000**.
- `struk-harga-naik.png` — toko & tanggal sama, beras **Rp72.500**
  (naik 16% dari Rp62.500 "minggu lalu"). Total **Rp168.000**.
  Dipakai untuk uji deteksi anomali `price-up`.
- `struk-duplikat.png` — identik dengan `struk-bersih.png` (toko + tanggal +
  total sama persis). Dipakai untuk uji deteksi anomali `duplicate`.
