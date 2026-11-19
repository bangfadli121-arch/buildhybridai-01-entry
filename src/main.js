// Bootstrap UI minimal (scaffold). Logika buku kas (Firestore) menyusul.
import { setupDeviceModel, scanReceipt } from "./ai.js";

const $ = (id) => document.getElementById(id);

$("setupBtn").addEventListener("click", async () => {
  $("setupStatus").textContent = "menyiapkan model perangkat… 0%";
  try {
    await setupDeviceModel((pct) => {
      $("setupStatus").textContent = `menyiapkan model perangkat… ${pct}%`;
    });
    $("setupStatus").textContent = "model perangkat siap";
  } catch (err) {
    $("setupStatus").textContent = "model perangkat gagal disiapkan (akan pakai cloud)";
    console.error(err);
  }
});

$("scanBtn").addEventListener("click", async () => {
  const file = $("receiptInput").files[0];
  if (!file) {
    $("status").textContent = "Pilih dulu foto struk (JPEG/PNG).";
    return;
  }
  $("status").textContent = "Membaca struk…";
  try {
    const { data, source } = await scanReceipt(file);
    $("sourceBadge").textContent =
      source === "ON_DEVICE" ? "Dijawab perangkat" : source === "IN_CLOUD" ? "Dijawab cloud" : source;
    $("result").textContent = JSON.stringify(data, null, 2);
    $("status").textContent = "Selesai.";
  } catch (err) {
    $("status").textContent = "Gagal membaca struk: " + err.message;
    console.error(err);
  }
});
