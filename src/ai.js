// Firebase AI Logic — hybrid inference wrapper (StrukKu).
// On-device (Gemini Nano) bila tersedia, fallback cloud (Gemini) bila tidak.
// - receiptModel: PREFER_ON_DEVICE — scan struk (single-turn, teks + gambar).
// - cloudModel:   ONLY_IN_CLOUD — tanya-jawab buku kas (multi-turn, dirangkum
//   manual jadi satu prompt karena on-device hanya single-turn).
// response.inferenceSource ("ON_DEVICE" | "IN_CLOUD") dipakai sebagai badge
// di UI — bukti hybrid inference benar-benar jalan.
// JANGAN log isi struk / prompt ke console (privasi).
import {
  getGenerativeModel,
  InferenceMode,
  Schema,
} from "firebase/ai";
import { getAIClient } from "./firebase.js";
import { fileToInlineData } from "./image.js";

const NO_CONFIG_MSG =
  "AI belum aktif: isi .env dengan Firebase config (VITE_FIREBASE_API_KEY dan VITE_FIREBASE_PROJECT_ID), lalu jalankan ulang aplikasi.";

// --- Model (lazy, hanya bila terkonfigurasi) --------------------------------

// Batas waktu panggilan model: tanpa ini, generateContent yang menggantung
// (mis. jaringan ke endpoint AI macet) membuat tombol tetap disabled dan
// status "Membaca struk…" selamanya tanpa error apa pun.
const SCAN_TIMEOUT_MS = 120_000;
const CHAT_TIMEOUT_MS = 90_000;

function withTimeout(promise, ms, message) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Structured output: responseSchema DIDUKUNG SDK yang terinstall
// (firebase 13.4.0 — diverifikasi dari node_modules: class Schema dengan
// helper statis object/string/integer/number/array). Dipakai di receiptModel
// agar model menjawab JSON sesuai skema; parsing manual tetap dipertahankan
// sebagai pengaman bila teks keluar dari skema.
// PENTING (QA 20 Nov 2026): pada mode hybrid, generationConfig TIDAK BOLEH
// di top-level — SDK v13 mengabaikannya dan memberi warning
// ("...must be done separately in inCloudParams and onDeviceParams").
// Karena itu responseMimeType + responseSchema ditaruh di inCloudParams.
// Model cloud default SDK v13 = gemini-3.5-flash-lite (terverifikasi dari
// URL request yang diabort SDK saat timeout di Brave headless).
const RECEIPT_SCHEMA = Schema.object({
  description: "Hasil ekstraksi struk belanja Indonesia.",
  properties: {
    toko: Schema.string({ description: "Nama toko/merchant, atau null bila tidak terbaca.", nullable: true }),
    tanggal: Schema.string({
      description: "Tanggal struk format YYYY-MM-DD, atau null bila tidak terbaca.",
      nullable: true,
    }),
    items: Schema.array({
      description: "Baris barang pada struk.",
      items: Schema.object({
        properties: {
          nama: Schema.string({ description: "Nama barang." }),
          jumlah: Schema.number({ description: "Jumlah/kuantitas barang." }),
          harga_satuan: Schema.number({ description: "Harga satuan dalam Rupiah (angka saja)." }),
          subtotal: Schema.number({ description: "Jumlah x harga_satuan dalam Rupiah." }),
        },
      }),
    }),
    total: Schema.number({
      description: "Total bayar dalam Rupiah (angka saja), atau null bila tidak terbaca.",
      nullable: true,
    }),
    confidence: Schema.number({
      description: "Keyakinan keseluruhan ekstraksi, 0 sampai 1.",
    }),
  },
  optionalProperties: ["toko", "tanggal", "total"],
});

let receiptModel = null;
let cloudModel = null;

function getReceiptModel() {
  const ai = getAIClient();
  if (!ai) return null;
  if (!receiptModel) {
    receiptModel = getGenerativeModel(ai, {
      mode: InferenceMode.PREFER_ON_DEVICE,
      // Model cloud fallback: default SDK v13 = gemini-3.5-flash-lite.
      // Nama model WAJIB ditulis eksplisit di sini: bila inCloudParams ada
      // tapi tanpa `model`, SDK throw "Must provide a model name"
      // (default hanya dipakai bila inCloudParams tidak ada sama sekali).
      inCloudParams: {
        model: "gemini-3.5-flash-lite",
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: RECEIPT_SCHEMA,
        },
      },
    });
  }
  return receiptModel;
}

function getCloudModel() {
  const ai = getAIClient();
  if (!ai) return null;
  if (!cloudModel) {
    cloudModel = getGenerativeModel(ai, {
      mode: InferenceMode.ONLY_IN_CLOUD,
      // Model cloud default SDK v13 = gemini-3.5-flash-lite.
    });
  }
  return cloudModel;
}

// --- Setup model on-device --------------------------------------------------

let deviceReady = false;
let deviceAvailability = null; // 'available' | 'downloading' | 'downloadable' | 'unavailable' | null (tak diketahui)

/**
 * Cek ketersediaan Prompt API (Gemini Nano) secara jujur bila browser
 * menyediakannya. Mengembalikan null bila API tidak ada (tidak diketahui).
 * PENTING: initializeDeviceModel() SDK bisa resolve "ready" walau on-device
 * sebenarnya tidak tersedia (terbukti di Brave headless: availability()
 * = "unavailable" tapi setup tetap resolve) — jadi klaim "siap" HANYA boleh
 * ditampilkan bila availability() menyatakan available/downloading.
 */
async function checkOnDeviceAvailability() {
  try {
    const LM = globalThis.LanguageModel;
    if (!LM || typeof LM.availability !== "function") return null;
    const status = await LM.availability();
    deviceAvailability = status;
    return status;
  } catch {
    return null;
  }
}

/**
 * WAJIB dipanggil setelah/di atas interaksi user (klik tombol) dan SEBELUM
 * generateContent() pertama. Mengunduh model on-device bila belum ada.
 * @param {(pct: number) => void} [onProgress] — progres 0..100.
 * @returns {Promise<{status: 'ready'|'downloading'|'unavailable'|'no-config', availability: string|null}>}
 * @throws Error berbahasa Indonesia bila unduhan/setup gagal.
 */
export async function setupDeviceModel(onProgress) {
  const model = getReceiptModel();
  if (!model) return { status: "no-config", availability: null };
  const availability = await checkOnDeviceAvailability();
  if (availability === "unavailable") {
    // JANGAN klaim siap: perangkat ini tidak bisa menjalankan model on-device.
    // Scan tetap bisa jalan lewat cloud (PREFER_ON_DEVICE fallback).
    deviceReady = false;
    return { status: "unavailable", availability };
  }
  try {
    await model.initializeDeviceModel((val) => {
      if (onProgress) onProgress(Math.round(val * 10000) / 100);
    });
    deviceReady = true;
    const status =
      availability === "downloading" || availability === "downloadable"
        ? "downloading"
        : "ready";
    return { status, availability };
  } catch (err) {
    throw new Error(
      "Gagal menyiapkan model perangkat: " +
        (err?.message || "perangkat tidak mendukung model on-device") +
        ". Scan tetap bisa jalan lewat cloud bila ada internet.",
    );
  }
}

/** @returns {{configured: boolean, ready: boolean, availability: string|null}} */
export function getDeviceStatus() {
  return {
    configured: getAIClient() !== null,
    ready: deviceReady,
    availability: deviceAvailability,
  };
}

// --- Scan struk -------------------------------------------------------------

const RECEIPT_PROMPT = `Ekstrak struk belanja Indonesia pada foto ini sebagai JSON persis mengikuti skema berikut:
{"toko": "nama toko atau null", "tanggal": "YYYY-MM-DD atau null", "items": [{"nama": "...", "jumlah": 1, "harga_satuan": 0, "subtotal": 0}], "total": 0, "confidence": 0.0}
Aturan:
- Semua harga dalam Rupiah, angka saja (tanpa titik, koma, "Rp", atau simbol lain).
- subtotal = jumlah x harga_satuan. total = jumlah semua subtotal.
- tanggal dalam format YYYY-MM-DD; bila tidak terbaca, isi null.
- Bila suatu field tidak terbaca, isi null (items kosong bila tidak ada barang terbaca).
- confidence: keyakinanmu 0 sampai 1 atas keseluruhan hasil ekstraksi ini.
- Jawab HANYA dengan JSON, tanpa teks lain.`;

function toNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Parse JSON secara robust: coba langsung, lalu cari blok {...} pertama-terakhir. */
function parseJsonRobust(text) {
  const trimmed = (text || "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

/** Normalisasi hasil mentah model ke bentuk baku. Mengembalikan null bila tidak valid. */
function normalizeReceipt(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const itemsRaw = Array.isArray(raw.items) ? raw.items : [];
  const items = itemsRaw
    .filter((it) => it && typeof it === "object")
    .map((it) => {
      const jumlah = toNumber(it.jumlah, 1) ?? 1;
      const hargaSatuan = toNumber(it.harga_satuan, null);
      const subtotal = toNumber(it.subtotal, null);
      return {
        nama: typeof it.nama === "string" ? it.nama.trim() : "",
        jumlah,
        harga_satuan: hargaSatuan ?? (subtotal !== null && jumlah ? subtotal / jumlah : 0),
        subtotal: subtotal ?? (hargaSatuan !== null ? hargaSatuan * jumlah : 0),
      };
    })
    .filter((it) => it.nama !== "");
  const totalFromItems = items.reduce((sum, it) => sum + (it.subtotal || 0), 0);
  let total = toNumber(raw.total, null);
  if (total === null) total = totalFromItems;
  let confidence = toNumber(raw.confidence, 0) ?? 0;
  confidence = Math.min(1, Math.max(0, confidence));
  return {
    toko: typeof raw.toko === "string" && raw.toko.trim() ? raw.toko.trim() : null,
    tanggal:
      typeof raw.tanggal === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.tanggal.trim())
        ? raw.tanggal.trim()
        : null,
    items,
    total,
    confidence,
  };
}

/**
 * Scan satu file struk (JPEG/PNG).
 * @returns {Promise<{data: {toko: string|null, tanggal: string|null, items: Array, total: number, confidence: number}, source: 'ON_DEVICE'|'IN_CLOUD', retried: boolean}>}
 * @throws Error berbahasa Indonesia bila AI belum aktif atau hasil tidak bisa dibaca.
 */
export async function scanReceipt(file) {
  const model = getReceiptModel();
  if (!model) throw new Error(NO_CONFIG_MSG);

  const imagePart = await fileToInlineData(file);
  let result;
  try {
    result = await withTimeout(
      model.generateContent([RECEIPT_PROMPT, imagePart]),
      SCAN_TIMEOUT_MS,
      "Waktu scan habis (120 detik) — periksa koneksimu, lalu coba lagi.",
    );
  } catch (err) {
    throw new Error("Gagal membaca struk: " + (err?.message || "model tidak merespons"));
  }
  let data = normalizeReceipt(parseJsonRobust(result.response.text()));
  let source = result.response.inferenceSource || "ON_DEVICE";
  let retried = false;

  // Retry SEKALI via cloud bila hasil lemah: confidence rendah, parse gagal,
  // atau tidak ada barang terbaca.
  if (!data || data.confidence < 0.7 || data.items.length === 0) {
    const cloud = getCloudModel();
    if (cloud) {
      try {
        const cloudResult = await withTimeout(
          cloud.generateContent([RECEIPT_PROMPT, imagePart]),
          SCAN_TIMEOUT_MS,
          "Waktu retry cloud habis (120 detik).",
        );
        const cloudData = normalizeReceipt(parseJsonRobust(cloudResult.response.text()));
        if (cloudData) {
          data = cloudData;
          source = cloudResult.response.inferenceSource || "IN_CLOUD";
        }
        retried = true;
      } catch (err) {
        // Retry cloud gagal: pakai hasil pertama bila ada, kalau tidak ada
        // sama sekali, lempar error di bawah.
        console.warn("StrukKu: retry cloud gagal:", err?.message || err);
        retried = true;
      }
    }
  }

  if (!data || data.items.length === 0) {
    throw new Error(
      "Struk tidak bisa dibaca — coba foto ulang dengan pencahayaan lebih terang dan struk memenuhi bingkai.",
    );
  }
  return { data, source, retried };
}

// --- Tanya-jawab buku kas (cloud only) --------------------------------------

/**
 * Jawab pertanyaan tentang buku kas. Cloud ONLY — on-device hanya single-turn
 * dan tidak dipakai untuk chat.
 * @param {Array<{role: 'user'|'assistant', text: string}>} history — maks 6 pesan terakhir dipakai.
 * @param {string} question
 * @param {string} [ledgerContext] — ringkasan buku kas (transaksi, saldo, dsb.).
 * @returns {Promise<{answer: string, source: 'IN_CLOUD'}>}
 */
export async function askQuestion(history, question, ledgerContext = "") {
  const model = getCloudModel();
  if (!model) throw new Error(NO_CONFIG_MSG);
  if (!question || !question.trim()) throw new Error("Pertanyaan tidak boleh kosong.");

  const recent = Array.isArray(history) ? history.slice(-6) : [];
  const historyText = recent
    .map((m) => `${m.role === "assistant" ? "Asisten" : "User"}: ${m.text}`)
    .join("\n");

  const prompt = `Kamu adalah asisten buku kas warung "StrukKu". Jawab dalam Bahasa Indonesia yang singkat dan jelas, dengan angka Rupiah bila relevan.

Konteks buku kas:
${ledgerContext || "(belum ada data buku kas)"}
${historyText ? `\nRiwayat percakapan terakhir:\n${historyText}\n` : ""}
Pertanyaan: ${question.trim()}

Jawab langsung pertanyaan di atas berdasarkan konteks buku kas. Bila data tidak cukup, katakan terus terang dan sebut data apa yang kurang — jangan mengarang angka.`;

  let result;
  try {
    result = await withTimeout(
      model.generateContent(prompt),
      CHAT_TIMEOUT_MS,
      "Waktu menjawab habis (90 detik) — periksa koneksimu, lalu coba lagi.",
    );
  } catch (err) {
    throw new Error("Gagal menjawab pertanyaan: " + (err?.message || "model tidak merespons"));
  }
  const answer = (result.response.text() || "").trim();
  if (!answer) throw new Error("Model tidak memberikan jawaban. Coba ulangi pertanyaanmu.");
  return { answer, source: "IN_CLOUD" };
}
