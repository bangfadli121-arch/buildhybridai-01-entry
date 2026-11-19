// Firebase init — StrukKu.
// Config dibaca dari import.meta.env (Vite). JANGAN hardcode config apa pun
// dan JANGAN commit file .env (sudah di .gitignore; lihat .env.example).
// Bila config belum terisi, modul ini TIDAK memanggil initializeApp sama
// sekali — aplikasi tetap jalan dalam mode "AI belum aktif" dan semua
// getter mengembalikan null.
import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
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
// SEBELUM initializeAppCheck. ReCaptchaV3Provider dipakai HANYA bila site
// key terisi; jangan pernah construct provider dengan key kosong.
export let appCheck = null;
if (isFirebaseConfigured) {
  const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
  if (siteKey) {
    if (import.meta.env.DEV) {
      // Token debug tampil di console browser; daftarkan di Firebase console
      // > Security > App Check > Apps > Manage debug tokens.
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }
    appCheck = initializeAppCheck(firebaseApp, {
      provider: new ReCaptchaV3Provider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } else if (import.meta.env.DEV) {
    console.warn(
      "StrukKu: App Check dilewati — VITE_RECAPTCHA_SITE_KEY kosong. " +
        "Isi site key reCAPTCHA v3 di .env, atau daftarkan debug token di Firebase console " +
        "bila App Check di-enforce untuk project ini.",
    );
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
