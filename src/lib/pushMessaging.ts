import { getToken } from "firebase/messaging";
import { getFirebaseMessaging, vapidKey } from "./firebase";

export async function requestPushPermissionAndToken() {
  if (typeof window === "undefined") {
    throw new Error("Entorno no compatible con notificaciones.");
  }

  if (!("Notification" in window)) {
    throw new Error("Este navegador no soporta notificaciones.");
  }

  const messaging = await getFirebaseMessaging();

  if (!messaging) {
    throw new Error("Firebase Messaging no está soportado en este navegador.");
  }

  const permission = await Notification.requestPermission();

  if (permission !== "granted") {
    throw new Error("Permiso de notificaciones denegado.");
  }

  const registration = await navigator.serviceWorker.ready;

  const token = await getToken(messaging, {
    vapidKey,
    serviceWorkerRegistration: registration,
  });

  if (!token) {
    throw new Error("No se pudo obtener token push.");
  }

  return token;
}