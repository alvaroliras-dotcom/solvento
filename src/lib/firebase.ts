import { initializeApp } from "firebase/app";
import { getMessaging, isSupported, type Messaging } from "firebase/messaging";

const firebaseConfig = {
  apiKey: "AIzaSyAKZ0uzohxoERpxzjz3VkNG2RTW75oY9WY",
  authDomain: "cerbero-push.firebaseapp.com",
  projectId: "cerbero-push",
  storageBucket: "cerbero-push.firebasestorage.app",
  messagingSenderId: "252052401751",
  appId: "1:252052401751:web:fa7af060efd416d037bd12",
};

const app = initializeApp(firebaseConfig);

export const vapidKey =
  "BLK9HBy7G4BnqKSxVQvX5YdcUrAutGpzpAskhRIerRQljxpfqSIQ-VCjrMyhjXEiWJ2rk6yNBHNIH-cTYRosAxI";

export async function getFirebaseMessaging(): Promise<Messaging | null> {
  const supported = await isSupported().catch(() => false);
  if (!supported) return null;

  try {
    return getMessaging(app);
  } catch {
    return null;
  }
}