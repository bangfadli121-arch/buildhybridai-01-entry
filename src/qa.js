// Tanya-jawab StrukKu: konteks ringkas untuk AI cloud + jawaban lokal
// tanpa AI untuk pertanyaan umum yang bisa dihitung langsung dari data.
import { computeSummary, detectAnomalies, formatIDR } from "./analytics.js";

const MAX_CONTEXT_CHARS = 1200;
const DAYS = 30;

function todayStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function lastNDaysRange(n) {
  const to = todayStr();
  return { from: addDays(to, -(n - 1)), to };
}

// Ringkasan teks kompak berbahasa Indonesia untuk konteks AI (maks ~1200
// karakter): total belanja 30 hari terakhir, 5 kategori terbesar, 5 item
// paling boros, anomali terbaru (maks 3), total omzet & laba 30 hari.
export function buildLedgerContext(receipts, omzetList) {
  const { from, to } = lastNDaysRange(DAYS);
  const summary = computeSummary(receipts, omzetList, { from, to });
  const anomalies = detectAnomalies(receipts || []).slice(0, 3);

  const lines = [];
  lines.push(`Ringkasan buku kas warung 30 hari terakhir (${from} s/d ${to}):`);
  lines.push(
    `Total belanja ${formatIDR(summary.totalBelanja)} dari ${summary.jumlahStruk} struk. ` +
      `Total omzet ${formatIDR(summary.totalOmzet)}, laba ${formatIDR(summary.laba)}.`,
  );
  if (summary.byCategory.length > 0) {
    const cats = summary.byCategory
      .slice(0, 5)
      .map((c) => `${c.kategori} ${formatIDR(c.total)}`)
      .join("; ");
    lines.push(`Kategori terbesar: ${cats}.`);
  }
  if (summary.topItems.length > 0) {
    const items = summary.topItems
      .map((it) => `${it.nama} ${formatIDR(it.total)}`)
      .join("; ");
    lines.push(`Item paling boros: ${items}.`);
  }
  if (anomalies.length > 0) {
    lines.push(`Anomali terbaru: ${anomalies.map((a) => a.message).join(" ")}`);
  } else {
    lines.push("Tidak ada anomali harga atau struk ganda yang terdeteksi.");
  }

  const text = lines.join("\n");
  return text.length > MAX_CONTEXT_CHARS
    ? text.slice(0, MAX_CONTEXT_CHARS - 3) + "..."
    : text;
}

// --- Jawaban lokal tanpa AI --------------------------------------------------

function detectPeriod(question) {
  if (question.includes("hari ini")) {
    const today = todayStr();
    return { from: today, to: today, label: "hari ini" };
  }
  if (question.includes("minggu ini") || question.includes("seminggu")) {
    const { from, to } = lastNDaysRange(7);
    return { from, to, label: "7 hari terakhir" };
  }
  if (question.includes("bulan ini")) {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
    return { from: `${y}-${m}-01`, to: `${y}-${m}-${String(lastDay).padStart(2, "0")}`, label: "bulan ini" };
  }
  if (
    question.includes("30 hari") ||
    question.includes("sebulan") ||
    question.includes("satu bulan")
  ) {
    const { from, to } = lastNDaysRange(30);
    return { from, to, label: "30 hari terakhir" };
  }
  return null;
}

function containsAny(question, phrases) {
  return phrases.some((p) => question.includes(p));
}

// Jawab pertanyaan umum TANPA AI dari data lokal. Mengembalikan string
// jawaban berbahasa Indonesia, atau null bila pertanyaan tidak dikenali.
export function answerLocally(question, { receipts = [], omzetList = [] } = {}) {
  const q = String(question || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!q) return null;

  const period = detectPeriod(q) || { ...lastNDaysRange(30), label: "30 hari terakhir" };
  const summary = computeSummary(receipts, omzetList, {
    from: period.from,
    to: period.to,
  });

  // Total belanja
  if (containsAny(q, ["total belanja", "berapa belanja", "belanja berapa", "pengeluaran"])) {
    return (
      `Total belanja ${period.label} adalah ${formatIDR(summary.totalBelanja)} ` +
      `dari ${summary.jumlahStruk} struk.`
    );
  }

  // Item paling boros / paling mahal
  if (containsAny(q, ["paling boros", "paling mahal", "boros", "belanja apa yang paling"])) {
    if (summary.topItems.length === 0) {
      return `Belum ada data belanja ${period.label}.`;
    }
    const top = summary.topItems[0];
    return (
      `Item paling boros ${period.label} adalah ${top.nama} ` +
      `dengan total ${formatIDR(top.total)} (${top.qty} pcs).`
    );
  }

  // Laba / untung
  if (containsAny(q, ["laba", "untung", "keuntungan", "profit"])) {
    return (
      `Laba ${period.label} adalah ${formatIDR(summary.laba)} ` +
      `(omzet ${formatIDR(summary.totalOmzet)} dikurangi belanja ${formatIDR(summary.totalBelanja)}).`
    );
  }

  // Omzet
  if (containsAny(q, ["omzet", "pendapatan", "pemasukan", "penjualan"])) {
    return `Total omzet ${period.label} adalah ${formatIDR(summary.totalOmzet)}.`;
  }

  // Harga naik / anomali
  if (containsAny(q, ["harga naik", "anomali", "harga mahal", "naik harga"])) {
    const anomalies = detectAnomalies(receipts);
    if (anomalies.length === 0) {
      return "Tidak ada anomali harga atau struk ganda yang terdeteksi.";
    }
    const shown = anomalies.slice(0, 3).map((a) => `- ${a.message}`).join("\n");
    return `Ditemukan ${anomalies.length} anomali:\n${shown}`;
  }

  return null;
}
