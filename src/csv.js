// Export CSV untuk StrukKu: satu baris per item struk.
// Header: tanggal,toko,item,jumlah,harga_satuan,subtotal,kategori,sumber

const CSV_HEADER = "tanggal,toko,item,jumlah,harga_satuan,subtotal,kategori,sumber";

// Escape satu field CSV standar (RFC 4180): bila mengandung koma, petik,
// atau baris baru, bungkus dengan petik ganda dan gandakan petik di dalamnya.
export function escapeCSV(value) {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function receiptsToCSV(receipts) {
  const lines = [CSV_HEADER];
  for (const receipt of receipts || []) {
    for (const item of receipt.items || []) {
      lines.push(
        [
          receipt.tanggal || "",
          receipt.toko || "",
          item.nama || "",
          item.jumlah ?? "",
          item.harga_satuan ?? "",
          item.subtotal ?? "",
          item.kategori || "",
          receipt.source || "",
        ]
          .map(escapeCSV)
          .join(","),
      );
    }
  }
  return lines.join("\n");
}

// Unduh string CSV sebagai file lewat Blob + klik anchor sementara (browser).
export function downloadCSV(filename, csvString) {
  const blob = new Blob([csvString], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "strukku.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
