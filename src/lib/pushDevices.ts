import { supabase } from "./supabaseClient";

type SavePushDeviceInput = {
  companyId: string;
  userId: string;
  deviceToken: string;
  deviceLabel?: string | null;
  platform?: string | null;
};

function getBrowserPlatform() {
  const ua = navigator.userAgent.toLowerCase();

  if (ua.includes("android")) return "android";
  if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ios")) return "ios";
  if (ua.includes("windows")) return "windows";
  if (ua.includes("mac os")) return "macos";
  if (ua.includes("linux")) return "linux";

  return "web";
}

function getDefaultDeviceLabel() {
  const ua = navigator.userAgent;

  if (/android/i.test(ua)) return "Móvil Android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iPhone / iPad";
  if (/Windows/i.test(ua)) return "PC Windows";
  if (/Macintosh|Mac OS X/i.test(ua)) return "Mac";
  if (/Linux/i.test(ua)) return "Linux";
  return "Navegador";
}

export async function savePushDevice(input: SavePushDeviceInput) {
  const payload = {
    company_id: input.companyId,
    user_id: input.userId,
    provider: "fcm",
    device_token: input.deviceToken,
    device_label: input.deviceLabel ?? getDefaultDeviceLabel(),
    platform: input.platform ?? getBrowserPlatform(),
    is_active: true,
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("push_devices")
    .upsert(payload, { onConflict: "provider,device_token" })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deactivatePushDevice(deviceToken: string) {
  const { error } = await supabase
    .from("push_devices")
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq("provider", "fcm")
    .eq("device_token", deviceToken);

  if (error) throw error;
}

export async function touchPushDevice(deviceToken: string) {
  const { error } = await supabase
    .from("push_devices")
    .update({
      is_active: true,
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("provider", "fcm")
    .eq("device_token", deviceToken);

  if (error) throw error;
}