// Firebase AI Logic — hybrid inference wrapper (StrukKu).
// On-device (Gemini Nano) bila tersedia, fallback cloud (Gemini) bila tidak.
// PREFER_ON_DEVICE adalah mode yang dipakai; response.inferenceSource
// ("ON_DEVICE" | "IN_CLOUD") ditampilkan sebagai badge di UI.
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from "firebase/ai";
import { firebaseApp } from "./firebase.js";

const ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });

export const receiptModel = getGenerativeModel(ai, {
  mode: InferenceMode.PREFER_ON_DEVICE,
  // Model cloud fallback: default SDK v13 = gemini-3.5-flash-lite.
  // Bila memakai SDK < v13, set model cloud eksplisit di sini.
});

// WAJIB dipanggil setelah/di atas interaksi user (klik tombol) dan SEBELUM
// generateContent() pertama. Menampilkan progres unduhan model on-device.
export function setupDeviceModel(onProgress) {
  return receiptModel.initializeDeviceModel((val) => {
    if (onProgress) onProgress(Math.round(val * 10000) / 100);
  });
}

const RECEIPT_SCHEMA_PROMPT = `Ekstrak struk belanja ini sebagai JSON dengan format persis:
{"toko": "...", "tanggal": "YYYY-MM-DD atau null", "items": [{"nama": "...", "jumlah": 0, "harga_satuan": 0, "subtotal": 0}], "total": 0}
Harga dalam Rupiah (angka saja, tanpa titik/koma pemisah). Bila suatu field tidak terbaca, isi null (items kosong bila tidak ada yang terbaca). Jawab HANYA dengan JSON, tanpa teks lain.`;

function fileToGenerativePart(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () =>
      resolve({
        type: "inlineData",
        inlineData: { data: reader.result.split(",")[1], mimeType: file.type },
      });
    reader.readAsDataURL(file);
  });
}

// Scan satu file struk (JPEG/PNG). Mengembalikan { data, source }.
// source = "ON_DEVICE" | "IN_CLOUD" — dari response.inferenceSource.
export async function scanReceipt(file) {
  const imagePart = await fileToGenerativePart(file);
  const result = await receiptModel.generateContent([RECEIPT_SCHEMA_PROMPT, imagePart]);
  const response = result.response;
  let data = null;
  try {
    data = JSON.parse(response.text());
  } catch {
    data = { raw: response.text() };
  }
  return { data, source: response.inferenceSource || "UNKNOWN" };
}
