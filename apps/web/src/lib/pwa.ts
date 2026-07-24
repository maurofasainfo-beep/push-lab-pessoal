import type { PushSubscriptionDto } from "../types/domain";

export interface CompatibilityReport {
  isStandalone: boolean;
  isIos: boolean;
  supportsServiceWorker: boolean;
  supportsPush: boolean;
  supportsNotifications: boolean;
  isSecureContext: boolean;
}

export function getCompatibilityReport(): CompatibilityReport {
  const navigatorStandalone = "standalone" in navigator ? Boolean((navigator as Navigator & { standalone?: boolean }).standalone) : false;
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || navigatorStandalone;
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  return {
    isStandalone,
    isIos,
    supportsServiceWorker: "serviceWorker" in navigator,
    supportsPush: "PushManager" in window,
    supportsNotifications: "Notification" in window,
    isSecureContext: window.isSecureContext
  };
}

export function explainPwaError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("INSECURE_CONTEXT")) {
    return "Service Worker exige contexto seguro. No iPhone, nao use http://IP:5173; publique em HTTPS ou use um tunel HTTPS/domino valido.";
  }
  if (message.includes("SERVICE_WORKER_UNSUPPORTED")) {
    return "Este navegador nao disponibilizou Service Worker. Use Safari iOS 16.4+ com o app adicionado a tela inicial, ou Chrome/Edge em HTTPS no desktop.";
  }
  if (message.includes("NOTIFICATIONS_UNSUPPORTED")) {
    return "Notifications API indisponivel neste navegador/contexto.";
  }
  if (message.includes("NOTIFICATION_PERMISSION_DENIED")) {
    return "Permissao de notificacao negada. No iPhone, altere em Ajustes > Notificacoes > Avisos Pessoais.";
  }
  if (message.includes("VAPID_PUBLIC_KEY_MISSING")) {
    return "VITE_VAPID_PUBLIC_KEY nao esta configurada no frontend.";
  }
  return message;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (!window.isSecureContext) throw new Error("INSECURE_CONTEXT");
  if (!("serviceWorker" in navigator)) throw new Error("SERVICE_WORKER_UNSUPPORTED");
  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  return registration;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }
  return outputArray;
}

export async function requestPermissionAndSubscribe(registration: ServiceWorkerRegistration): Promise<PushSubscriptionDto> {
  if (!("Notification" in window)) throw new Error("NOTIFICATIONS_UNSUPPORTED");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("NOTIFICATION_PERMISSION_DENIED");

  const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!publicKey) throw new Error("VAPID_PUBLIC_KEY_MISSING");

  const existing = await registration.pushManager.getSubscription();
  const applicationServerKey = urlBase64ToUint8Array(publicKey).buffer as ArrayBuffer;
  const subscription =
    existing ||
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey
    }));

  return subscription.toJSON() as PushSubscriptionDto;
}

export async function checkForAppUpdate(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return false;
  await registration.update();
  return Boolean(registration.waiting);
}

export function activateWaitingServiceWorker(): void {
  navigator.serviceWorker.getRegistration().then((registration) => {
    registration?.waiting?.postMessage({ type: "SKIP_WAITING" });
  });
}
