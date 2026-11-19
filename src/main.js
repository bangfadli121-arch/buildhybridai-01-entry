// StrukKu — bootstrap UI (4 tab: Scan, Buku Kas, Laporan, Tanya).
// Semua angka uang memakai formatIDR. Semua teks berbahasa Indonesia.
// Data contoh SELALU berlabel "CONTOH — bukan hasil AI"; hasil AI tidak pernah dikarang.
// Namespace import untuk firebase.js/ai.js: build tetap lolos walau subagent
// pemilik modul itu belum menambahkan semua ekspor kontrak; pemakaian di bawah
// selalu mengecek ketersediaan fungsi sebelum memanggilnya.
import * as firebaseMod from "./firebase.js";
import * as ai from "./ai.js";
import {
  saveReceipt,
  listReceipts,
  getReceipt,
  deleteReceipt,
  saveOmzet,
  listOmzet,
} from "./store.js";
import { computeSummary, detectAnomalies, formatIDR } from "./analytics.js";
import { receiptsToCSV, downloadCSV } from "./csv.js";
import { buildLedgerContext, answerLocally } from "./qa.js";
import { CATEGORIES, categorizeItemName } from "./categories.js";

const $ = (id) => document.getElementById(id);

// ---------- State ----------
let configured = false; // Firebase terkonfigurasi (AI tersedia)
let deviceReady = false;
let currentFilter = "all"; // today | 7 | 30 | all
let currentSource = "MANUAL"; // ON_DEVICE | IN_CLOUD | MANUAL
let currentIsSample = false;
let currentReceipts = []; // struk pada filter aktif (dipakai laporan + export)
let currentOmzet = [];
let chatHistory = []; // { role: 'user' | 'ai', text, sourceLabel }

// ---------- Util ----------
const todayStr = () => {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
};

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
};

const fmtDateID = (iso) => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Ambil field pertama yang ada (tahan terhadap variasi nama field dari modul lain).
const pick = (obj, names, fallback = 0) => {
  if (!obj || typeof obj !== "object") return fallback;
  for (const n of names) {
    if (obj[n] !== undefined && obj[n] !== null) return obj[n];
  }
  return fallback;
};

const money = (n) => {
  try {
    return formatIDR(num(n));
  } catch {
    return `Rp${num(n).toLocaleString("id-ID")}`;
  }
};

let toastTimer = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.hidden = true;
  }, 3000);
}

function sourceBadgeInfo(source) {
  if (source === "ON_DEVICE") return { text: "Dijawab perangkat", cls: "badge-device" };
  if (source === "IN_CLOUD") return { text: "Dijawab cloud", cls: "badge-cloud" };
  return { text: "Manual", cls: "badge-manual" };
}

function setSourceBadge(source) {
  const b = $("sourceBadge");
  const info = sourceBadgeInfo(source);
  b.textContent = info.text;
  b.className = `badge ${info.cls}`;
}

function rangeForFilter(filter) {
  const to = todayStr();
  if (filter === "today") return { from: to, to, label: "hari ini" };
  if (filter === "7") return { from: addDays(to, -6), to, label: "7 hari terakhir" };
  if (filter === "30") return { from: addDays(to, -29), to, label: "30 hari terakhir" };
  return { from: undefined, to: undefined, label: "semua periode" };
}

async function loadLedgerData() {
  const { from, to } = rangeForFilter(currentFilter);
  const params = from ? { from, to } : {};
  currentReceipts = (await listReceipts(params)) || [];
  currentOmzet = (await listOmzet(params)) || [];
}

// ---------- Navigasi tab ----------
function showTab(name) {
  for (const tab of ["scan", "kas", "laporan", "tanya"]) {
    $(`tab-${tab}`).hidden = tab !== name;
  }
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === name);
  });
  if (name === "kas") renderKas();
  if (name === "laporan") renderLaporan();
  window.scrollTo({ top: 0 });
}

// ---------- TAB SCAN ----------
function setDemoMode() {
  $("modeBadge").textContent = "Mode demo — tanpa Firebase config";
  $("modeBadge").className = "badge badge-muted";
  $("demoNotice").hidden = false;
  $("setupBtn").disabled = true;
  $("setupBtn").textContent = "Siapkan model perangkat (butuh Firebase config)";
  $("scanBtn").disabled = true;
  $("scanStatus").textContent =
    "Mode demo: AI butuh Firebase config — kamu tetap bisa isi struk manual atau lihat contoh hasil scan.";
  $("chatHint").textContent =
    "Mode demo: jawaban memakai data bukumu secara lokal — tanpa AI.";
}

function setConfiguredMode() {
  $("modeBadge").textContent = "Siap — Firebase terhubung";
  $("modeBadge").className = "badge badge-ok";
  $("demoNotice").hidden = true;
  $("chatHint").textContent =
    "Jawaban memakai AI (perangkat dulu, cloud bila perlu) dengan konteks dari buku kasmu.";
}

async function initMode() {
  try {
    configured = Boolean(firebaseMod.isFirebaseConfigured);
  } catch {
    configured = false;
  }
  try {
    if (typeof ai.getDeviceStatus === "function") {
      const status = ai.getDeviceStatus();
      if (status && typeof status.configured === "boolean") {
        configured = status.configured;
        deviceReady = Boolean(status.ready);
      }
    }
  } catch {
    // getDeviceStatus belum tersedia — pakai isFirebaseConfigured saja.
  }
  if (configured) {
    setConfiguredMode();
    if (deviceReady) {
      $("deviceBadge").textContent = "Model perangkat: siap";
      $("deviceBadge").className = "badge badge-device";
      $("setupStatus").textContent = "Model perangkat sudah siap.";
    }
  } else {
    setDemoMode();
  }
}

async function onSetupModel() {
  if (!configured) {
    $("setupStatus").textContent =
      "Mode demo: AI butuh Firebase config — model perangkat tidak bisa disiapkan.";
    return;
  }
  $("setupBtn").disabled = true;
  $("setupProgressWrap").hidden = false;
  $("setupStatus").textContent = "Menyiapkan model perangkat… 0%";
  if (typeof ai.setupDeviceModel !== "function") {
    $("setupStatus").textContent =
      "Model perangkat belum tersedia — scan akan memakai cloud bila tersedia.";
    $("setupBtn").disabled = false;
    return;
  }
  try {
    const result = await ai.setupDeviceModel((pct) => {
      const p = Math.max(0, Math.min(100, num(pct)));
      $("setupProgressBar").style.width = `${p}%`;
      $("setupProgressText").textContent = `${p}%`;
      $("setupStatus").textContent = `Menyiapkan model perangkat… ${p}%`;
    });
    const status = result && result.status ? result.status : "ready";
    if (status === "unavailable") {
      // Jujur: Prompt API menyatakan on-device tidak tersedia di browser ini.
      deviceReady = false;
      $("setupStatus").textContent =
        "Model perangkat tidak tersedia di browser ini — scan akan memakai cloud bila ada internet.";
      $("deviceBadge").textContent = "Model perangkat: tidak tersedia";
      $("deviceBadge").className = "badge badge-muted";
      toast("Model perangkat tidak tersedia — pakai cloud.");
    } else if (status === "downloading") {
      deviceReady = true;
      $("setupStatus").textContent =
        "Model perangkat sedang diunduh — scan pertama mungkin lambat, selanjutnya offline.";
      $("deviceBadge").textContent = "Model perangkat: mengunduh";
      $("deviceBadge").className = "badge badge-device";
      toast("Model perangkat sedang diunduh.");
    } else {
      deviceReady = true;
      $("setupStatus").textContent = "Model perangkat siap — scan bisa jalan offline.";
      $("deviceBadge").textContent = "Model perangkat: siap";
      $("deviceBadge").className = "badge badge-device";
      toast("Model perangkat siap.");
    }
  } catch (err) {
    console.error(err);
    $("setupStatus").textContent =
      "Model perangkat gagal disiapkan — scan akan memakai cloud bila tersedia.";
    $("deviceBadge").textContent = "Model perangkat: gagal disiapkan";
    toast("Model perangkat gagal disiapkan.");
  } finally {
    $("setupBtn").disabled = false;
  }
}

// ----- Form koreksi -----
function blankItem() {
  return { nama: "", jumlah: 1, harga_satuan: 0, subtotal: 0 };
}

function addItemRow(item = blankItem()) {
  const editor = $("itemsEditor");
  const row = document.createElement("div");
  row.className = "item-row";

  const nama = document.createElement("input");
  nama.type = "text";
  nama.className = "item-nama";
  nama.placeholder = "Nama barang";
  nama.value = item.nama || "";
  nama.setAttribute("aria-label", "Nama barang");

  const jumlah = document.createElement("input");
  jumlah.type = "number";
  jumlah.className = "item-jumlah";
  jumlah.min = "0";
  jumlah.step = "any";
  jumlah.inputMode = "decimal";
  jumlah.value = num(item.jumlah) || "";
  jumlah.placeholder = "Jml";
  jumlah.setAttribute("aria-label", "Jumlah");

  const harga = document.createElement("input");
  harga.type = "number";
  harga.className = "item-harga";
  harga.min = "0";
  harga.step = "1";
  harga.inputMode = "numeric";
  harga.value = num(item.harga_satuan) || "";
  harga.placeholder = "Harga";
  harga.setAttribute("aria-label", "Harga satuan");

  const subtotal = document.createElement("input");
  subtotal.type = "number";
  subtotal.className = "item-subtotal";
  subtotal.min = "0";
  subtotal.step = "1";
  subtotal.inputMode = "numeric";
  subtotal.value = num(item.subtotal) || "";
  subtotal.placeholder = "Subtotal";
  subtotal.setAttribute("aria-label", "Subtotal");

  const del = document.createElement("button");
  del.type = "button";
  del.className = "item-del";
  del.textContent = "✕";
  del.setAttribute("aria-label", "Hapus baris");
  del.addEventListener("click", () => {
    row.remove();
    recalcTotal();
  });

  const syncSubtotal = () => {
    subtotal.value = num(jumlah.value) * num(harga.value) || "";
    recalcTotal();
  };
  jumlah.addEventListener("input", syncSubtotal);
  harga.addEventListener("input", syncSubtotal);
  subtotal.addEventListener("input", recalcTotal);

  row.append(nama, jumlah, harga, subtotal, del);
  editor.appendChild(row);
  return row;
}

function readItemsFromEditor() {
  const items = [];
  for (const row of document.querySelectorAll("#itemsEditor .item-row")) {
    const nama = row.querySelector(".item-nama").value.trim();
    const jumlah = num(row.querySelector(".item-jumlah").value);
    const harga_satuan = num(row.querySelector(".item-harga").value);
    let subtotal = num(row.querySelector(".item-subtotal").value);
    if (!subtotal && (jumlah || harga_satuan)) subtotal = jumlah * harga_satuan;
    if (!nama && !subtotal) continue; // baris kosong dilewati
    let kategori = "Lainnya";
    try {
      kategori = categorizeItemName(nama) || "Lainnya";
    } catch {
      kategori = "Lainnya";
    }
    if (Array.isArray(CATEGORIES) && CATEGORIES.length && !CATEGORIES.includes(kategori)) {
      kategori = "Lainnya";
    }
    items.push({ nama: nama || "Tanpa nama", jumlah, harga_satuan, subtotal, kategori });
  }
  return items;
}

function recalcTotal() {
  const items = readItemsFromEditor();
  const total = items.reduce((s, it) => s + num(it.subtotal), 0);
  if (total > 0) $("corrTotal").value = total;
}

function fillCorrectionForm({ toko, tanggal, items, total, confidence, source, isSample }) {
  currentSource = source || "MANUAL";
  currentIsSample = Boolean(isSample);
  $("sampleNotice").hidden = !currentIsSample;
  $("corrToko").value = toko || "";
  $("corrTanggal").value = tanggal || todayStr();
  $("corrTotal").value = num(total) || "";
  if (confidence !== undefined && confidence !== null && confidence !== "") {
    $("corrConfidenceWrap").hidden = false;
    const pct = num(confidence);
    $("corrConfidence").textContent =
      pct > 0 && pct <= 1 ? `${Math.round(pct * 100)}%` : `${pct}%`;
  } else {
    $("corrConfidenceWrap").hidden = true;
  }
  $("itemsEditor").innerHTML = "";
  const rows = Array.isArray(items) && items.length ? items : [blankItem()];
  for (const it of rows) addItemRow(it);
  setSourceBadge(currentSource);
  $("correctionForm").hidden = false;
  $("correctionForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

function onManualFill() {
  fillCorrectionForm({
    toko: "",
    tanggal: todayStr(),
    items: [blankItem()],
    total: "",
    confidence: null,
    source: "MANUAL",
    isSample: false,
  });
  $("scanStatus").textContent = "Isi struk secara manual, lalu simpan ke buku kas.";
  $("corrToko").focus();
}

// CONTOH — bukan hasil AI. Dipakai hanya untuk mencoba form koreksi di mode demo.
const SAMPLE_RECEIPT = {
  toko: "CONTOH — Toko Kelontong Sari",
  tanggal: todayStr(),
  items: [
    { nama: "Beras 5 kg", jumlah: 2, harga_satuan: 65000, subtotal: 130000 },
    { nama: "Gula pasir 1 kg", jumlah: 5, harga_satuan: 17500, subtotal: 87500 },
    { nama: "Minyak goreng 2 L", jumlah: 3, harga_satuan: 42000, subtotal: 126000 },
    { nama: "Kopi sachet (renceng)", jumlah: 4, harga_satuan: 12000, subtotal: 48000 },
  ],
  total: 391500,
  confidence: null,
};

function onSampleFill() {
  fillCorrectionForm({ ...SAMPLE_RECEIPT, source: "MANUAL", isSample: true });
  $("scanStatus").textContent =
    "Ini DATA CONTOH — bukan hasil AI. Edit sepuasnya, lalu simpan untuk mencoba buku kas.";
}

async function onScan() {
  if (!configured) {
    $("scanStatus").textContent =
      "Mode demo: AI butuh Firebase config — pakai tombol Isi manual atau Lihat contoh hasil scan.";
    return;
  }
  const file = $("receiptInput").files[0];
  if (!file) {
    $("scanStatus").textContent = "Pilih dulu foto struk (JPEG/PNG) atau foto langsung dari kamera.";
    return;
  }
  if (!["image/jpeg", "image/png"].includes(file.type)) {
    $("scanStatus").textContent = "Format foto harus JPEG atau PNG.";
    return;
  }
  $("scanBtn").disabled = true;
  $("scanStatus").textContent = "Membaca struk… mohon tunggu.";
  if (typeof ai.scanReceipt !== "function") {
    $("scanStatus").textContent =
      "Fitur scan belum tersedia — isi struk secara manual untuk sementara.";
    $("scanBtn").disabled = !configured;
    return;
  }
  try {
    const result = await ai.scanReceipt(file);
    const data = result && result.data ? result.data : null;
    const source = (result && result.source) || "IN_CLOUD";
    if (!data || !Array.isArray(data.items) || data.items.length === 0) {
      $("scanStatus").textContent =
        "Struk tidak terbaca — coba foto ulang dengan cahaya lebih terang dan struk yang rata. Kamu juga bisa isi manual.";
      onManualFill();
      return;
    }
    currentSource = source;
    fillCorrectionForm({
      toko: data.toko || "",
      tanggal: data.tanggal || todayStr(),
      items: data.items,
      total: data.total,
      confidence: data.confidence,
      source,
      isSample: false,
    });
    const info = sourceBadgeInfo(source);
    $("scanStatus").textContent =
      `Selesai dibaca (${info.text.toLowerCase()})` +
      (result.retried ? " — sempat dicoba ulang." : "") +
      " Periksa dan koreksi sebelum disimpan.";
  } catch (err) {
    console.error(err);
    // Tampilkan pesan error spesifik (mis. timeout 120 detik) bila ada —
    // pesan generik "periksa koneksi" menyesatkan saat panggilan AI yang macet.
    $("scanStatus").textContent =
      (err && err.message) ||
      "Gagal membaca struk. Periksa koneksi internetmu, lalu coba lagi — atau isi struk secara manual.";
  } finally {
    $("scanBtn").disabled = !configured;
  }
}

async function onSaveReceipt(event) {
  event.preventDefault();
  const items = readItemsFromEditor();
  if (!items.length) {
    $("saveStatus").textContent = "Isi dulu minimal satu item belanja.";
    return;
  }
  const total = num($("corrTotal").value) || items.reduce((s, it) => s + num(it.subtotal), 0);
  const receipt = {
    id:
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `struk-${Date.now()}`,
    toko: $("corrToko").value.trim() || "Tanpa nama toko",
    tanggal: $("corrTanggal").value || todayStr(),
    items,
    total,
    source: currentIsSample ? "MANUAL" : currentSource,
    confidence:
      $("corrConfidenceWrap").hidden || currentIsSample
        ? null
        : num($("corrConfidence").textContent.replace("%", "")) || null,
    createdAt: new Date().toISOString(),
  };
  try {
    await saveReceipt(receipt);
    $("saveStatus").textContent = "";
    $("correctionForm").hidden = true;
    $("sampleNotice").hidden = true;
    $("receiptInput").value = "";
    $("fileInfo").textContent = "";
    toast(`Struk ${receipt.toko} (${money(total)}) tersimpan.`);
    showTab("kas");
  } catch (err) {
    console.error(err);
    $("saveStatus").textContent = "Gagal menyimpan struk. Coba lagi.";
  }
}

// ---------- TAB BUKU KAS ----------
function renderKas() {
  loadLedgerData()
    .then(() => {
      const list = $("receiptList");
      list.innerHTML = "";
      $("receiptDetail").hidden = true;
      $("kasEmpty").hidden = currentReceipts.length > 0;
      const sorted = [...currentReceipts].sort((a, b) =>
        String(b.tanggal || "").localeCompare(String(a.tanggal || "")),
      );
      for (const r of sorted) {
        const li = document.createElement("li");
        li.className = "receipt-item";
        const info = sourceBadgeInfo(r.source);
        const left = document.createElement("div");
        const toko = document.createElement("div");
        toko.className = "r-toko";
        toko.textContent = r.toko || "Tanpa nama toko";
        const meta = document.createElement("div");
        meta.className = "r-meta";
        meta.textContent = `${fmtDateID(r.tanggal)} · ${(r.items || []).length} item`;
        const badge = document.createElement("span");
        badge.className = `badge ${info.cls}`;
        badge.textContent = info.text;
        left.append(toko, meta, badge);
        const actions = document.createElement("div");
        actions.className = "r-actions";
        const total = document.createElement("span");
        total.className = "r-total";
        total.textContent = money(r.total);
        const del = document.createElement("button");
        del.type = "button";
        del.className = "btn-del";
        del.textContent = "Hapus";
        del.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          if (!window.confirm(`Hapus struk ${r.toko || ""} (${money(r.total)})?`)) return;
          try {
            await deleteReceipt(r.id);
            toast("Struk dihapus.");
            renderKas();
          } catch (err) {
            console.error(err);
            toast("Gagal menghapus struk.");
          }
        });
        actions.append(total, del);
        li.append(left, actions);
        li.addEventListener("click", () => showReceiptDetail(r.id));
        list.appendChild(li);
      }
    })
    .catch((err) => {
      console.error(err);
      $("kasEmpty").hidden = false;
      $("kasEmpty").textContent = "Gagal memuat buku kas. Coba buka lagi tab ini.";
    });
}

async function showReceiptDetail(id) {
  let r = currentReceipts.find((x) => x.id === id);
  if (!r) {
    try {
      r = await getReceipt(id);
    } catch (err) {
      console.error(err);
    }
  }
  if (!r) return;
  const info = sourceBadgeInfo(r.source);
  $("detailTitle").textContent = r.toko || "Tanpa nama toko";
  $("detailMeta").textContent =
    `${fmtDateID(r.tanggal)} · ${info.text}` +
    (r.confidence ? ` · keyakinan AI ${Math.round(num(r.confidence) * 100)}%` : "");
  const tbody = $("detailItems");
  tbody.innerHTML = "";
  for (const it of r.items || []) {
    const tr = document.createElement("tr");
    const tdNama = document.createElement("td");
    tdNama.textContent = it.nama || "Tanpa nama";
    const tdJml = document.createElement("td");
    tdJml.textContent = String(num(it.jumlah));
    const tdHarga = document.createElement("td");
    tdHarga.textContent = money(it.harga_satuan);
    const tdSub = document.createElement("td");
    tdSub.textContent = money(it.subtotal);
    tr.append(tdNama, tdJml, tdHarga, tdSub);
    tbody.appendChild(tr);
  }
  $("detailTotal").textContent = money(r.total);
  $("receiptDetail").hidden = false;
  $("receiptDetail").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- TAB LAPORAN ----------
async function renderLaporan() {
  const { from, to, label } = rangeForFilter(currentFilter);
  $("reportPeriodLabel").textContent = label;
  try {
    await loadLedgerData();
    const params = from ? { from, to } : {};
    const summary = computeSummary(currentReceipts, currentOmzet, params) || {};
    $("sumBelanja").textContent = money(
      pick(summary, ["totalBelanja", "total_belanja", "belanja", "totalPengeluaran"], 0),
    );
    $("sumOmzet").textContent = money(
      pick(summary, ["totalOmzet", "total_omzet", "omzet"], 0),
    );
    $("sumLaba").textContent = money(pick(summary, ["laba", "profit", "totalLaba"], 0));
    $("sumCount").textContent = String(
      pick(summary, ["jumlahStruk", "jumlah_struk", "count", "totalStruk"], currentReceipts.length),
    );

    // Breakdown per kategori (bar horizontal CSS).
    const byCat = new Map();
    for (const r of currentReceipts) {
      for (const it of r.items || []) {
        const cat = it.kategori || "Lainnya";
        byCat.set(cat, (byCat.get(cat) || 0) + num(it.subtotal));
      }
    }
    const catRows = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
    const breakdown = $("categoryBreakdown");
    breakdown.innerHTML = "";
    $("categoryEmpty").hidden = catRows.length > 0;
    const maxCat = catRows.length ? catRows[0][1] : 0;
    for (const [cat, total] of catRows) {
      const row = document.createElement("div");
      row.className = "breakdown-row";
      const top = document.createElement("div");
      top.className = "breakdown-top";
      const name = document.createElement("span");
      name.textContent = cat;
      const val = document.createElement("strong");
      val.textContent = money(total);
      top.append(name, val);
      const bar = document.createElement("div");
      bar.className = "breakdown-bar";
      const fill = document.createElement("div");
      fill.className = "breakdown-fill";
      fill.style.width = maxCat ? `${Math.round((total / maxCat) * 100)}%` : "0%";
      bar.appendChild(fill);
      row.append(top, bar);
      breakdown.appendChild(row);
    }

    // Top 5 item paling boros.
    const byItem = new Map();
    for (const r of currentReceipts) {
      for (const it of r.items || []) {
        const key = (it.nama || "Tanpa nama").trim();
        byItem.set(key, (byItem.get(key) || 0) + num(it.subtotal));
      }
    }
    const top = [...byItem.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const topList = $("topItems");
    topList.innerHTML = "";
    $("topEmpty").hidden = top.length > 0;
    for (const [nama, total] of top) {
      const li = document.createElement("li");
      const n = document.createElement("span");
      n.textContent = nama;
      const v = document.createElement("span");
      v.className = "t-amount";
      v.textContent = money(total);
      li.append(n, v);
      topList.appendChild(li);
    }

    // Anomali: harga naik & duplikat.
    let anomalies = [];
    try {
      anomalies = (await detectAnomalies(currentReceipts)) || [];
    } catch (err) {
      console.error(err);
    }
    const anomList = $("anomalyList");
    anomList.innerHTML = "";
    $("anomalyEmpty").hidden = anomalies.length > 0;
    for (const a of anomalies) {
      const li = document.createElement("li");
      li.textContent =
        typeof a === "string"
          ? a
          : pick(a, ["pesan", "message", "text", "deskripsi"], "") ||
            JSON.stringify(a);
      anomList.appendChild(li);
    }
  } catch (err) {
    console.error(err);
    toast("Gagal memuat laporan.");
  }
}

async function onSaveOmzet() {
  const tanggal = $("omzetTanggal").value || todayStr();
  const jumlah = num($("omzetJumlah").value);
  if (!jumlah || jumlah <= 0) {
    $("omzetStatus").textContent = "Masukkan jumlah omzet (lebih dari Rp0).";
    return;
  }
  try {
    await saveOmzet({ tanggal, jumlah });
    $("omzetStatus").textContent = `Omzet ${fmtDateID(tanggal)} sebesar ${money(jumlah)} tersimpan.`;
    $("omzetJumlah").value = "";
    toast("Omzet tersimpan.");
    renderLaporan();
  } catch (err) {
    console.error(err);
    $("omzetStatus").textContent = "Gagal menyimpan omzet. Coba lagi.";
  }
}

async function onExportCsv() {
  try {
    await loadLedgerData();
    if (!currentReceipts.length) {
      $("exportStatus").textContent = "Belum ada struk untuk di-export.";
      return;
    }
    const csv = receiptsToCSV(currentReceipts);
    downloadCSV(`strukku-${todayStr()}.csv`, csv);
    $("exportStatus").textContent = `CSV ${currentReceipts.length} struk berhasil diunduh.`;
    toast("CSV berhasil diunduh.");
  } catch (err) {
    console.error(err);
    $("exportStatus").textContent = "Gagal membuat CSV. Coba lagi.";
  }
}

// ---------- TAB TANYA ----------
function pushChat(role, text, sourceLabel) {
  chatHistory.push({ role, text, sourceLabel });
  renderChat();
}

function renderChat() {
  const history = $("chatHistory");
  history.innerHTML = "";
  $("chatEmpty").hidden = chatHistory.length > 0;
  for (const msg of chatHistory) {
    const div = document.createElement("div");
    div.className = `chat-msg ${msg.role}`;
    div.textContent = msg.text;
    if (msg.role === "ai" && msg.sourceLabel) {
      const badge = document.createElement("span");
      badge.className = "badge badge-muted";
      badge.style.display = "inline-block";
      badge.textContent = msg.sourceLabel;
      div.appendChild(document.createElement("br"));
      div.appendChild(badge);
    }
    history.appendChild(div);
  }
  history.scrollTop = history.scrollHeight;
}

function localAnswer(question) {
  // answerLocally boleh mengembalikan string atau { answer, source }.
  const res = answerLocally(question, { receipts: currentReceipts, omzetList: currentOmzet });
  if (typeof res === "string") return res;
  return (res && (res.answer || res.text)) || "Maaf, aku belum bisa menjawab dari data bukumu.";
}

async function onAskQuestion(event) {
  event.preventDefault();
  const question = $("chatInput").value.trim();
  if (!question) return;
  $("chatInput").value = "";
  pushChat("user", question);
  const sendBtn = $("chatSendBtn");
  sendBtn.disabled = true;
  try {
    await loadLedgerData();
    if (!configured) {
      pushChat("ai", localAnswer(question), "Jawaban lokal — tanpa AI");
      return;
    }
    try {
      const ledgerContext = buildLedgerContext(currentReceipts, currentOmzet);
      // Kirim maks 6 pesan terakhir sebagai riwayat ke AI.
      const history = chatHistory
        .slice(-6)
        .map((m) => ({ role: m.role === "ai" ? "assistant" : "user", text: m.text }));
      if (typeof ai.askQuestion !== "function") {
        throw new Error("askQuestion belum tersedia");
      }
      const result = await ai.askQuestion(history, question, ledgerContext);
      const answer =
        typeof result === "string"
          ? result
          : (result && (result.answer || result.text)) || "Maaf, tidak ada jawaban.";
      const source = result && result.source ? result.source : "IN_CLOUD";
      const info = sourceBadgeInfo(source);
      pushChat("ai", answer, info.text);
    } catch (err) {
      console.error(err);
      // Fallback ke jawaban lokal bila AI gagal.
      pushChat("ai", localAnswer(question), "Jawaban lokal — tanpa AI (AI gagal dihubungi)");
    }
  } finally {
    sendBtn.disabled = false;
  }
}

// ---------- Bootstrap ----------
function bindEvents() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => showTab(btn.dataset.tab));
  });
  $("setupBtn").addEventListener("click", onSetupModel);
  $("manualBtn").addEventListener("click", onManualFill);
  $("sampleBtn").addEventListener("click", onSampleFill);
  $("scanBtn").addEventListener("click", onScan);
  $("receiptInput").addEventListener("change", (ev) => {
    const file = ev.target.files[0];
    $("fileInfo").textContent = file
      ? `Dipilih: ${file.name} (${Math.round(file.size / 1024)} KB)`
      : "";
  });
  $("addItemBtn").addEventListener("click", () => addItemRow());
  $("correctionForm").addEventListener("submit", onSaveReceipt);
  $("resetFormBtn").addEventListener("click", () => {
    $("correctionForm").hidden = true;
    $("sampleNotice").hidden = true;
    $("scanStatus").textContent = "";
  });
  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.dataset.range;
      renderKas();
    });
  });
  $("detailCloseBtn").addEventListener("click", () => {
    $("receiptDetail").hidden = true;
  });
  $("omzetBtn").addEventListener("click", onSaveOmzet);
  $("exportCsvBtn").addEventListener("click", onExportCsv);
  $("chatForm").addEventListener("submit", onAskQuestion);
}

function initDefaults() {
  $("corrTanggal").value = todayStr();
  $("omzetTanggal").value = todayStr();
  bindEvents();
  initMode();
  showTab("scan");
}

initDefaults();
