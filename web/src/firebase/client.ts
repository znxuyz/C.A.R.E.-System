/**
 * Firebase 用戶端初始化
 *
 * - 前端僅持有公開設定（apiKey 等），安全性由 Firestore 規則與
 *   Cloud Functions 授權把關。
 * - 未提供設定（例如 GitHub Pages 純 UI 預覽）時回傳 null，
 *   由 lib/api.ts 切換為模擬資料層。
 * - Functions 區域須與後端 setGlobalOptions 一致（預設 asia-east1）。
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { DEFAULT_FIREBASE_CONFIG } from './config.js';

const env = import.meta.env;

/** 環境變數優先，未設定時採用 config.ts 的預設專案 */
export const firebaseConfig = {
  apiKey: (env.VITE_FIREBASE_API_KEY as string) || DEFAULT_FIREBASE_CONFIG.apiKey,
  authDomain: (env.VITE_FIREBASE_AUTH_DOMAIN as string) || DEFAULT_FIREBASE_CONFIG.authDomain,
  projectId: (env.VITE_FIREBASE_PROJECT_ID as string) || DEFAULT_FIREBASE_CONFIG.projectId,
  storageBucket:
    (env.VITE_FIREBASE_STORAGE_BUCKET as string) || DEFAULT_FIREBASE_CONFIG.storageBucket,
  messagingSenderId:
    (env.VITE_FIREBASE_MESSAGING_SENDER_ID as string) ||
    DEFAULT_FIREBASE_CONFIG.messagingSenderId,
  appId: (env.VITE_FIREBASE_APP_ID as string) || DEFAULT_FIREBASE_CONFIG.appId,
};

export const USE_MOCK =
  String(env.VITE_USE_MOCK).toLowerCase() === 'true' || !firebaseConfig.apiKey;

interface FirebaseBundle {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
}

let bundle: FirebaseBundle | null = null;

export function firebase(): FirebaseBundle | null {
  if (USE_MOCK) return null;
  if (!bundle) {
    const app = initializeApp(firebaseConfig as Required<typeof firebaseConfig>);
    bundle = { app, auth: getAuth(app), db: getFirestore(app) };
  }
  return bundle;
}
