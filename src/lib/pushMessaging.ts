import { getToken, onMessage } from "firebase/messaging";
import { getFirebaseMessaging, vapidKey } from "./firebase";

export function pushPermissionState(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

// iPhone/iPad solo deja pedir permiso de notificaciones desde un gesto del
// usuario (pulsar un boton). Pedirlo al cargar fallaba en silencio y esos
// trabajadores nunca recibian avisos.
export function isIos() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

async function tokenFromGrantedPermission() {
  const messaging = await getFirebaseMessaging();

  if (!messaging) {
    throw new Error("Firebase Messaging no está soportado en este navegador.");
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

export async function requestPushPermissionAndToken() {
  if (pushPermissionState() === "unsupported") {
    throw new Error("Este navegador no soporta notificaciones.");
  }

  const permission = await Notification.requestPermission();

  if (permission !== "granted") {
    throw new Error("Permiso de notificaciones denegado.");
  }

  return tokenFromGrantedPermission();
}

// Token de este dispositivo sin volver a pedir permiso (para darlo de baja
// al cerrar sesion). Devuelve null si nunca se concedio.
export async function getCurrentPushToken() {
  if (pushPermissionState() !== "granted") return null;
  try {
    return await tokenFromGrantedPermission();
  } catch {
    return null;
  }
}

// Con la app abierta, Firebase no muestra el aviso por su cuenta: se
// perdian los recordatorios de fichar. Aqui se pinta igual que en segundo
// plano.
export async function listenForegroundMessages() {
  const messaging = await getFirebaseMessaging();
  if (!messaging) return () => undefined;

  return onMessage(messaging, async (payload) => {
    const title =
      payload?.notification?.title || payload?.data?.title || "Cerbero";
    const body =
      payload?.notification?.body ||
      payload?.data?.body ||
      "Tienes una notificación pendiente.";

    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(title, {
        body,
        icon: "/cerbero-icon-512.png",
        data: { url: payload?.data?.url || "/worker" },
      });
    } catch {
      // sin service worker no hay forma de mostrarlo
    }
  });
}
