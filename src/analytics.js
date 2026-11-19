// Analitik StrukKu: ringkasan belanja/omzet, deteksi anomali, format rupiah.
// Fungsi murni (tidak menyentuh IndexedDB/Firebase) agar mudah diuji dan
// dipakai ulang oleh UI maupun modul QA (src/qa.js).
import { normalizeItemName } from "./categories.js";

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Total struk: pakai field total bila ada, kalau tidak jumlahkan subtotal item.
export function receiptTotal(receipt) {
  if (Number.isFinite(Number(receipt.total))) return Number(receipt.total);
  return (receipt.items || []).reduce((sum, it) => sum + toNumber(it.subtotal), 0);
}

function inRange(tanggal, from, to) {
  return (!from || tanggal >= from) && (!to || tanggal <= to);
}

function median(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

// Ringkasan periode. `from`/`to` berupa "YYYY-MM-DD" (opsional).
// Mengembalikan:
// { totalBelanja, totalOmzet, laba, jumlahStruk,
//   byCategory: [{ kategori, total, jumlahItem }] (urut total terbesar),
//   topItems: [{ nama, total, qty }] (top 5),
//   perHari: [{ tanggal, belanja, omzet }] (urut tanggal menaik) }
export function computeSummary(receipts, omzetList, { from, to } = {}) {
  const inPeriodReceipts = (receipts || []).filter((r) => inRange(r.tanggal, from, to));
  const inPeriodOmzet = (omzetList || []).filter((o) => inRange(o.tanggal, from, to));

  let totalBelanja = 0;
  const categoryMap = new Map();
  const itemMap = new Map();
  const belanjaPerHari = new Map();

  for (const receipt of inPeriodReceipts) {
    const total = receiptTotal(receipt);
    totalBelanja += total;
    belanjaPerHari.set(
      receipt.tanggal,
      (belanjaPerHari.get(receipt.tanggal) || 0) + total,
    );
    for (const item of receipt.items || []) {
      const subtotal = toNumber(item.subtotal);
      const kategori = item.kategori || "Lain-lain";
      const cat = categoryMap.get(kategori) || { kategori, total: 0, jumlahItem: 0 };
      cat.total += subtotal;
      cat.jumlahItem += 1;
      categoryMap.set(kategori, cat);

      const key = normalizeItemName(item.nama);
      const existing = itemMap.get(key);
      if (existing) {
        existing.total += subtotal;
        existing.qty += toNumber(item.jumlah);
      } else {
        itemMap.set(key, {
          nama: (item.nama || "").trim() || key,
          total: subtotal,
          qty: toNumber(item.jumlah),
        });
      }
    }
  }

  let totalOmzet = 0;
  const omzetPerHari = new Map();
  for (const entry of inPeriodOmzet) {
    const jumlah = toNumber(entry.jumlah);
    totalOmzet += jumlah;
    omzetPerHari.set(entry.tanggal, (omzetPerHari.get(entry.tanggal) || 0) + jumlah);
  }

  const byCategory = [...categoryMap.values()].sort((a, b) => b.total - a.total);
  const topItems = [...itemMap.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  const tanggalSet = new Set([...belanjaPerHari.keys(), ...omzetPerHari.keys()]);
  const perHari = [...tanggalSet]
    .sort()
    .map((tanggal) => ({
      tanggal,
      belanja: belanjaPerHari.get(tanggal) || 0,
      omzet: omzetPerHari.get(tanggal) || 0,
    }));

  return {
    totalBelanja,
    totalOmzet,
    laba: totalOmzet - totalBelanja,
    jumlahStruk: inPeriodReceipts.length,
    byCategory,
    topItems,
    perHari,
  };
}

// Deteksi anomali dari daftar struk. Mengembalikan array:
// { type: 'price-up' | 'duplicate', severity, message, detail }
//
// - price-up: harga_satuan pembelian terbaru suatu item > 110% dari median
//   harga item yang sama (nama dinormalisasi) pada pembelian sebelumnya,
//   dengan syarat ada >= 2 pembelian lama.
// - duplicate: dua struk (atau lebih) dengan toko + tanggal + total yang sama
//   persis dalam 24 jam (tanggal sama, karena tanggal hanya per hari).
export function detectAnomalies(receipts) {
  const anomalies = [];
  const list = [...(receipts || [])].sort((a, b) => {
    if (a.tanggal !== b.tanggal) return a.tanggal.localeCompare(b.tanggal);
    return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
  });

  // --- price-up ---
  // Kelompokkan harga satuan per nama item ternormalisasi, urut kronologis.
  const priceHistory = new Map();
  for (const receipt of list) {
    for (const item of receipt.items || []) {
      const key = normalizeItemName(item.nama);
      if (!key) continue;
      const harga = toNumber(item.harga_satuan);
      if (harga <= 0) continue;
      if (!priceHistory.has(key)) priceHistory.set(key, []);
      priceHistory.get(key).push({
        harga,
        tanggal: receipt.tanggal,
        toko: receipt.toko,
        nama: (item.nama || "").trim() || key,
      });
    }
  }
  for (const [key, history] of priceHistory) {
    if (history.length < 3) continue; // butuh >= 2 pembelian lama + 1 terbaru
    const latest = history[history.length - 1];
    const previous = history.slice(0, -1).map((h) => h.harga);
    const med = median(previous);
    if (med <= 0) continue;
    if (latest.harga > med * 1.1) {
      const kenaikan = ((latest.harga - med) / med) * 100;
      anomalies.push({
        type: "price-up",
        severity: latest.harga > med * 1.25 ? "tinggi" : "sedang",
        message:
          `Harga ${latest.nama} naik ${Math.round(kenaikan)}% ` +
          `(${formatIDR(med)} → ${formatIDR(latest.harga)}) ` +
          `pada ${latest.tanggal}${latest.toko ? ` di ${latest.toko}` : ""}.`,
        detail: {
          nama: latest.nama,
          hargaLama: med,
          hargaBaru: latest.harga,
          kenaikanPersen: Math.round(kenaikan * 10) / 10,
          toko: latest.toko,
          tanggal: latest.tanggal,
        },
      });
    }
  }

  // --- duplicate ---
  const dupGroups = new Map();
  for (const receipt of list) {
    const key = [
      normalizeItemName(receipt.toko),
      receipt.tanggal,
      receiptTotal(receipt),
    ].join("|");
    if (!dupGroups.has(key)) dupGroups.set(key, []);
    dupGroups.get(key).push(receipt);
  }
  for (const group of dupGroups.values()) {
    if (group.length < 2) continue;
    const first = group[0];
    anomalies.push({
      type: "duplicate",
      severity: "tinggi",
      message:
        `${group.length} struk identik dari ${first.toko || "toko tidak diketahui"} ` +
        `pada ${first.tanggal} dengan total ${formatIDR(receiptTotal(first))} ` +
        `— kemungkinan struk ganda, periksa sebelum dihitung dua kali.`,
      detail: {
        toko: first.toko,
        tanggal: first.tanggal,
        total: receiptTotal(first),
        jumlah: group.length,
        ids: group.map((r) => r.id),
      },
    });
  }

  return anomalies;
}

// Format rupiah tanpa desimal, pemisah ribuan titik: 12500 -> "Rp12.500".
export function formatIDR(n) {
  const value = Math.round(toNumber(n));
  const sign = value < 0 ? "-" : "";
  const digits = String(Math.abs(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `Rp${sign}${digits}`;
}
