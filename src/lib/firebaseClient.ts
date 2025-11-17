"use client";

import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth } from "firebase/auth";

let app: FirebaseApp | undefined;

export function getFirebaseApp() {
  if (!getApps().length) {
    app = initializeApp({
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "demo",
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "demo.firebaseapp.com",
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "demo-project",
    });
  }
  return app!;
}

export function getFirebaseAuth() {
  const app = getFirebaseApp();
  return getAuth(app);
}
