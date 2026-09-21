/**
 * Firebase 網頁設定
 *
 * ⚠️ 這些值**本來就是公開資訊**，不是秘密：
 *   應用程式部署後，瀏覽器下載的 JS 檔一定會包含它們（Google 官方文件亦如此說明）。
 *   因此用 GitHub Secrets 隱藏並無實質保護效果，直接寫在原始碼反而方便部署。
 *
 * 真正的防線有三層：
 *   1. Firestore 安全規則（本專案的唯一防線，含 27 項自動化測試）
 *   2. Authentication → 已授權網域（限制哪些網址可以登入）
 *   3. Google Cloud Console → API 金鑰的 HTTP 參照網址限制（限制金鑰可被哪些網站使用）
 *
 * 若要用在別的 Firebase 專案（例如另開一個測試環境），
 * 設定 VITE_FIREBASE_* 環境變數即可覆蓋以下預設值。
 */
export const DEFAULT_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyB0tFUA4Doqn4Bb-06wAoKzngizS3ibXRY',
  authDomain: 'caresystem-1ba4b.firebaseapp.com',
  projectId: 'caresystem-1ba4b',
  storageBucket: 'caresystem-1ba4b.firebasestorage.app',
  messagingSenderId: '6606040539',
  appId: '1:6606040539:web:01f94948357c455b060bfe',
} as const;
