// Firebase init + App Check (debug provider untuk local dev).
// Config dibaca dari import.meta.env (Vite) — JANGAN commit file .env.
// Lihat .env.example untuk daftar key yang dibutuhkan.
import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseApp = initializeApp(firebaseConfig);

// Local dev: App Check debug provider. Di production (hosted) ganti ke
// ReCaptchaV3Provider dengan site key, dan JANGAN set debug token.
if (import.meta.env.DEV) {
  // Token debug akan tampil di console browser; daftarkan di
  // Firebase console > Security > App Check > Apps > Manage debug tokens.
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}

export const appCheck = initializeAppCheck(firebaseApp, {
  provider: new ReCaptchaV3Provider(import.meta.env.VITE_RECAPTCHA_SITE_KEY),
  isTokenAutoRefreshEnabled: true,
});
