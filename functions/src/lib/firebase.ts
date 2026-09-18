/** Firebase Admin SDK 單例初始化 */
import { initializeApp, getApps, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

let app: App | undefined;

export function getApp(): App {
  if (!app) {
    app = getApps()[0] ?? initializeApp();
  }
  return app;
}

export function db(): Firestore {
  const instance = getFirestore(getApp());
  return instance;
}

export const auth = () => getAuth(getApp());
export const messaging = () => getMessaging(getApp());
