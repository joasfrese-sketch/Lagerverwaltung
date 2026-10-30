import { supabase, unwrap } from './supabase.js';
import { state } from '../state.js';

const KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const pushConfigured = () => !!KEY;

const toBytes = (b64) => {
  const s = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
};

export async function registerServiceWorker() {
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    try { await navigator.serviceWorker.register('/sw.js'); } catch (e) { console.warn('SW:', e); }
  }
}

export async function pushActive() {
  if (!pushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(reg && (await reg.pushManager.getSubscription()) && Notification.permission === 'granted');
}

export async function enablePush() {
  if (!pushSupported()) throw new Error('Push wird hier nicht unterstützt (iPhone: App zuerst zum Home-Bildschirm hinzufügen).');
  if (!KEY) throw new Error('VAPID-Schlüssel fehlt (VITE_VAPID_PUBLIC_KEY).');
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Benachrichtigungen wurden im Browser nicht erlaubt.');
  await registerServiceWorker();
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(KEY) }));
  const j = sub.toJSON();
  // evtl. altes Abo desselben Geräts (anderer Nutzer) entfernen, dann neu speichern
  await supabase.from('push_subscriptions').delete().eq('endpoint', j.endpoint);
  unwrap(await supabase.from('push_subscriptions').insert({ user_id: state.user.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }));
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && (await reg.pushManager.getSubscription());
  if (sub) {
    await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    await sub.unsubscribe();
  }
}
