importScripts("https://www.gstatic.com/firebasejs/12.2.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.2.1/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyAKZ0uzohxoERpxzjz3VkNG2RTW75oY9WY",
  authDomain: "cerbero-push.firebaseapp.com",
  projectId: "cerbero-push",
  storageBucket: "cerbero-push.firebasestorage.app",
  messagingSenderId: "252052401751",
  appId: "1:252052401751:web:fa7af060efd416d037bd12",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  if (payload?.notification) {
    return;
  }

  const notificationTitle =
    payload?.data?.title || "Cerbero";

  const notificationOptions = {
  body:
    payload?.data?.body || "Tienes una notificación pendiente.",
  icon: "/pwa-192x192.png",
  badge: "/pwa-192x192.png",
  requireInteraction: true,
  silent: false,
  data: {
    url: payload?.data?.url || "/worker",
  },
};

  self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification?.data?.url || "/worker";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});