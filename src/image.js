// Util gambar struk — StrukKu.
// On-device (Gemini Nano) hanya menerima JPEG/PNG, jadi semua foto
// di-downscale ke JPEG sebelum dikirim ke model.
const SUPPORTED_TYPES = ["image/jpeg", "image/png"];

/** Muat file gambar menjadi ImageBitmap (fallback: elemen <img> + object URL). */
async function loadBitmap(file) {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file);
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Gagal membaca file gambar."));
      el.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Gagal membaca file gambar."));
    reader.readAsDataURL(blob);
  });
}

/**
 * Downscale gambar ke maksimal `maxDim` px di sisi terpanjang (jaga rasio).
 * Selalu mengembalikan JPEG quality 0.85.
 * @returns {Promise<{blob: Blob, dataUrl: string, mimeType: 'image/jpeg', width: number, height: number}>}
 * @throws Error berbahasa Indonesia bila file bukan JPEG/PNG atau gagal dibaca.
 */
export async function downscaleImage(file, maxDim = 1600) {
  if (!file || !SUPPORTED_TYPES.includes(file.type)) {
    throw new Error("File harus berupa gambar JPEG atau PNG.");
  }
  const source = await loadBitmap(file);
  const srcWidth = source.width;
  const srcHeight = source.height;
  if (!srcWidth || !srcHeight) {
    throw new Error("Gagal membaca ukuran gambar.");
  }

  const scale = Math.min(1, maxDim / Math.max(srcWidth, srcHeight));
  const width = Math.max(1, Math.round(srcWidth * scale));
  const height = Math.max(1, Math.round(srcHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Browser tidak mendukung pengolahan gambar (canvas).");
  ctx.drawImage(source, 0, 0, width, height);
  if (typeof source.close === "function") source.close();

  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Gagal mengompres gambar."))),
      "image/jpeg",
      0.85,
    ),
  );
  const dataUrl = await blobToDataUrl(blob);
  return { blob, dataUrl, mimeType: "image/jpeg", width, height };
}

/**
 * Downscale file lalu kembalikan part inlineData siap kirim ke
 * generateContent([prompt, imagePart]).
 * @returns {Promise<{type: 'inlineData', inlineData: {data: string, mimeType: string}}>}
 * data = base64 tanpa prefix `data:...;base64,`.
 */
export async function fileToInlineData(file) {
  const { dataUrl, mimeType } = await downscaleImage(file);
  const base64 = dataUrl.split(",")[1];
  if (!base64) throw new Error("Gagal membaca file gambar.");
  return { type: "inlineData", inlineData: { data: base64, mimeType } };
}
