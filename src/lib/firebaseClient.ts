"use client";

import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

let app: FirebaseApp | null = null;

const FIREBASE_PUBLIC_CONFIG = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
} as const;

export function hasFirebaseConfig() {
  return Boolean(
    FIREBASE_PUBLIC_CONFIG.apiKey &&
      FIREBASE_PUBLIC_CONFIG.authDomain &&
      FIREBASE_PUBLIC_CONFIG.projectId &&
      FIREBASE_PUBLIC_CONFIG.storageBucket &&
      FIREBASE_PUBLIC_CONFIG.messagingSenderId &&
      FIREBASE_PUBLIC_CONFIG.appId,
  );
}

export function getFirebaseApp() {
  if (typeof window === "undefined") return null;
  if (app) return app;
  if (!hasFirebaseConfig()) return null;

  const config = {
    apiKey: FIREBASE_PUBLIC_CONFIG.apiKey!,
    authDomain: FIREBASE_PUBLIC_CONFIG.authDomain!,
    projectId: FIREBASE_PUBLIC_CONFIG.projectId!,
    storageBucket: FIREBASE_PUBLIC_CONFIG.storageBucket!,
    messagingSenderId: FIREBASE_PUBLIC_CONFIG.messagingSenderId!,
    appId: FIREBASE_PUBLIC_CONFIG.appId!,
    measurementId: FIREBASE_PUBLIC_CONFIG.measurementId,
  };

  app = getApps()[0] ?? initializeApp(config);
  return app;
}

export function getFirebaseAuth(): Auth | null {
  const firebaseApp = getFirebaseApp();
  if (!firebaseApp) return null;
  return getAuth(firebaseApp);
}
