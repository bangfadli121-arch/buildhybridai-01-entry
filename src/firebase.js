// Firebase init — StrukKu.
// Config dibaca dari import.meta.env (Vite). JANGAN hardcode config apa pun
// dan JANGAN commit file .env (sudah di .gitignore; lihat .env.example).
// Bila config belum terisi, modul ini TIDAK memanggil initializeApp sama
// sekali — aplikasi tetap jalan dalam mode "AI belum aktif" dan semua
// getter mengembalikan null.
import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getAI, GoogleAIBackend } from "firebase/ai";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Terkonfigurasi hanya bila dua key wajib terisi. Key lain boleh kosong
// (authDomain/storageBucket/dst. tidak wajib untuk AI Logic + Firestore).
export const isFirebaseConfigured = Boolean(
  import.meta.env.VITE_FIREBASE_API_KEY && import.meta.env.VITE_FIREBASE_PROJECT_ID,
);

export const firebaseApp = isFirebaseConfigured ? initializeApp(firebaseConfig) : null;

// App Check — hanya bila terkonfigurasi. Debug token DEV harus diset
// SEBELUM initializeAppCheck. Bila VITE_FIREBASE_APPCHECK_DEBUG_TOKEN
// terisi (token debug yang sudah didaftarkan di console), token itu yang
// dipakai; bila kosong, SDK generate token baru dan menampilkannya di
// console (daftarkan dulu di console sebelum dipakai). Dalam mode debug,
// getToken() memakai jalur debug dan provider tidak pernah dipanggil —
// jadi site key reCAPTCHA hanya dibutuhkan untuk produksi.
//
// Provider = reCAPTCHA ENTERPRISE (bukan v3 klasik): site key dibuat via
// reCAPTCHA Enterprise API (key 6LegPiou...G7, didaftarkan ke App Check
// recaptchaEnterpriseConfig 21 Nov 2026) karena kunci v3 klasik tidak bisa
// dibuat lewat API. SDK memuat enterprise.js untuk provider ini.
export let appCheck = null;
if (isFirebaseConfigured) {
  const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
  const debugToken = import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN;
  if (import.meta.env.DEV) {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken || true;
  }
  if (siteKey || import.meta.env.DEV) {
    appCheck = initializeAppCheck(firebaseApp, {
      provider: new ReCaptchaEnterpriseProvider(siteKey || "debug"),
      isTokenAutoRefreshEnabled: true,
    });
  } else {
    console.warn(
      "StrukKu: App Check tidak aktif — VITE_RECAPTCHA_SITE_KEY kosong. " +
        "Request AI Logic bisa ditolak bila App Check di-enforce di project ini.",
    );
  }
}

// --- Lazy singletons (dibuat hanya saat pertama dipakai, dan hanya bila
// terkonfigurasi) -----------------------------------------------------------

let aiClient = null;
let db = null;

/** Klien Firebase AI Logic (backend Gemini Developer API). Null bila belum terkonfigurasi. */
export function getAIClient() {
  if (!isFirebaseConfigured) return null;
  if (!aiClient) aiClient = getAI(firebaseApp, { backend: new GoogleAIBackend() });
  return aiClient;
}

/** Instance Firestore. Null bila belum terkonfigurasi. */
export function getDb() {
  if (!isFirebaseConfigured) return null;
  if (!db) db = getFirestore(firebaseApp);
  return db;
}

/**
 * Masuk anonim (untuk menulis buku kas ke Firestore tanpa akun).
 * Mengembalikan user, atau null bila belum terkonfigurasi / gagal.
 * Tidak pernah throw — kegagalan hanya di-log sebagai warning.
 */
export async function ensureAnonymousAuth() {
  if (!isFirebaseConfigured) return null;
  try {
    const credential = await signInAnonymously(getAuth(firebaseApp));
    return credential.user;
  } catch (err) {
    console.warn("StrukKu: gagal masuk anonim:", err?.message || err);
    return null;
  }
}
