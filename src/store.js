// Penyimpanan lokal StrukKu — IndexedDB (vanilla API, tanpa library).
// Berjalan 100% tanpa Firebase config. Sinkron ke Firestore bersifat
// best-effort dan tidak pernah memblokir pemanggil: bila Firebase belum
// terkonfigurasi (getDb() null / export belum ada), sync dilewati diam-diam.
import { categorizeItemName } from "./categories.js";

const DB_NAME = "strukku";
const DB_VERSION = 1;
const RECEIPTS_STORE = "receipts";
const OMZET_STORE = "omzet";

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RECEIPTS_STORE)) {
        db.createObjectStore(RECEIPTS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(OMZET_STORE)) {
        db.createObjectStore(OMZET_STORE, { keyPath: "tanggal" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("IndexedDB diblokir tab lain"));
  });
  return dbPromise;
}

function txPromise(storeName, mode, run) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        let result;
        try {
          result = run(store);
        } catch (err) {
          reject(err);
          return;
        }
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("Transaksi dibatalkan"));
      }),
  );
}

function requestPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeReceipt(receipt) {
  const copy = { ...receipt };
  if (!copy.id) copy.id = newId();
  if (!copy.createdAt) copy.createdAt = new Date().toISOString();
  if (!Array.isArray(copy.items)) copy.items = [];
  copy.items = copy.items.map((item) => {
    const it = { ...item };
    it.jumlah = Number(it.jumlah) || 0;
    it.harga_satuan = Number(it.harga_satuan) || 0;
    if (!Number.isFinite(Number(it.subtotal))) {
      it.subtotal = it.jumlah * it.harga_satuan;
    } else {
      it.subtotal = Number(it.subtotal);
    }
    if (!it.kategori) it.kategori = categorizeItemName(it.nama);
    return it;
  });
  if (!Number.isFinite(Number(copy.total))) {
    copy.total = copy.items.reduce((sum, it) => sum + (Number(it.subtotal) || 0), 0);
  } else {
    copy.total = Number(copy.total);
  }
  return copy;
}

// --- Sinkron Firestore (best-effort, fire-and-forget) -----------------------
// firebase.js saat ini mengekspor firebaseApp/appCheck; getDb dan
// ensureAnonymousAuth ditambahkan belakangan oleh modul Firebase. Bila export
// belum ada atau getDb() mengembalikan null (config kosong), sync dilewati.
// Error sync tidak pernah dilempar ke pemanggil.
async function syncReceiptToFirestore(receipt) {
  try {
    const mod = await import("./firebase.js");
    if (typeof mod.getDb !== "function") return;
    if (typeof mod.ensureAnonymousAuth === "function") {
      await mod.ensureAnonymousAuth();
    }
    const db = mod.getDb();
    if (!db) return;
    const { doc, setDoc } = await import("firebase/firestore");
    await setDoc(doc(db, "receipts", receipt.id), receipt, { merge: true });
  } catch {
    // Best-effort: data lokal sudah tersimpan, sync boleh gagal diam-diam.
  }
}

async function syncReceiptDeleteToFirestore(id) {
  try {
    const mod = await import("./firebase.js");
    if (typeof mod.getDb !== "function") return;
    if (typeof mod.ensureAnonymousAuth === "function") {
      await mod.ensureAnonymousAuth();
    }
    const db = mod.getDb();
    if (!db) return;
    const { doc, deleteDoc } = await import("firebase/firestore");
    await deleteDoc(doc(db, "receipts", id));
  } catch {
    // Best-effort.
  }
}

async function syncOmzetToFirestore(entry) {
  try {
    const mod = await import("./firebase.js");
    if (typeof mod.getDb !== "function") return;
    if (typeof mod.ensureAnonymousAuth === "function") {
      await mod.ensureAnonymousAuth();
    }
    const db = mod.getDb();
    if (!db) return;
    const { doc, setDoc } = await import("firebase/firestore");
    await setDoc(doc(db, "omzet", entry.tanggal), entry, { merge: true });
  } catch {
    // Best-effort.
  }
}

// --- Receipts ----------------------------------------------------------------

export async function saveReceipt(receipt) {
  const normalized = normalizeReceipt(receipt);
  await txPromise(RECEIPTS_STORE, "readwrite", (store) =>
    requestPromise(store.put(normalized)),
  );
  // Sync Firestore tanpa await — tidak memblokir pemanggil.
  void syncReceiptToFirestore(normalized);
  return normalized;
}

export async function listReceipts({ from, to } = {}) {
  const all = await txPromise(RECEIPTS_STORE, "readonly", (store) =>
    requestPromise(store.getAll()),
  );
  return all
    .filter((r) => (!from || r.tanggal >= from) && (!to || r.tanggal <= to))
    .sort((a, b) => {
      if (a.tanggal !== b.tanggal) return b.tanggal.localeCompare(a.tanggal);
      return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    });
}

export async function getReceipt(id) {
  const result = await txPromise(RECEIPTS_STORE, "readonly", (store) =>
    requestPromise(store.get(id)),
  );
  return result === undefined ? null : result;
}

export async function deleteReceipt(id) {
  await txPromise(RECEIPTS_STORE, "readwrite", (store) =>
    requestPromise(store.delete(id)),
  );
  void syncReceiptDeleteToFirestore(id);
}

// --- Omzet -------------------------------------------------------------------

export async function saveOmzet({ tanggal, jumlah }) {
  const entry = { tanggal, jumlah: Number(jumlah) || 0 };
  await txPromise(OMZET_STORE, "readwrite", (store) =>
    requestPromise(store.put(entry)),
  );
  void syncOmzetToFirestore(entry);
  return entry;
}

export async function listOmzet({ from, to } = {}) {
  const all = await txPromise(OMZET_STORE, "readonly", (store) =>
    requestPromise(store.getAll()),
  );
  return all
    .filter((o) => (!from || o.tanggal >= from) && (!to || o.tanggal <= to))
    .sort((a, b) => a.tanggal.localeCompare(b.tanggal));
}

// --- Util --------------------------------------------------------------------

export async function clearAll() {
  await txPromise(RECEIPTS_STORE, "readwrite", (store) =>
    requestPromise(store.clear()),
  );
  await txPromise(OMZET_STORE, "readwrite", (store) =>
    requestPromise(store.clear()),
  );
}
