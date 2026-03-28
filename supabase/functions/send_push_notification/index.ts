import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SignJWT, importPKCS8 } from "https://esm.sh/jose@5.9.6";

type PushPayload = {
  company_id: string;
  user_id: string;
  notification_type: string;
  reference_date: string;
  reference_slot: string;
  title: string;
  body: string;
};

type PushDeviceRow = {
  id: string;
  device_token: string;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FIREBASE_PROJECT_ID = Deno.env.get("FIREBASE_PROJECT_ID")!;
const FIREBASE_CLIENT_EMAIL = Deno.env.get("FIREBASE_CLIENT_EMAIL")!;
const FIREBASE_PRIVATE_KEY = Deno.env.get("FIREBASE_PRIVATE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function jsonResponse(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function validatePayload(payload: Partial<PushPayload>): payload is PushPayload {
  return !!(
    payload.company_id &&
    payload.user_id &&
    payload.notification_type &&
    payload.reference_date &&
    payload.reference_slot &&
    payload.title &&
    payload.body
  );
}

async function getGoogleAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const privateKey = FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n");
  const alg = "RS256";
  const pkcs8 = await importPKCS8(privateKey, alg);

  const jwt = await new SignJWT({
    scope: "https://www.googleapis.com/auth/firebase.messaging",
  })
    .setProtectedHeader({ alg, typ: "JWT" })
    .setIssuer(FIREBASE_CLIENT_EMAIL)
    .setSubject(FIREBASE_CLIENT_EMAIL)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(pkcs8);

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Failed to get Google access token: ${text}`);
  }

  const tokenJson = await tokenRes.json();
  return tokenJson.access_token as string;
}

function isInvalidTokenError(errorPayload: unknown): boolean {
  const text = JSON.stringify(errorPayload || {});
  return (
    text.includes("UNREGISTERED") ||
    text.includes("registration-token-not-registered") ||
    text.includes("Requested entity was not found") ||
    text.includes("invalid registration token") ||
    text.includes("Invalid registration token")
  );
}

async function sendToFcm(
  accessToken: string,
  deviceToken: string,
  payload: PushPayload,
) {
  const endpoint =
    `https://fcm.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/messages:send`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        token: deviceToken,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: {
          company_id: payload.company_id,
          user_id: payload.user_id,
          notification_type: payload.notification_type,
          reference_date: payload.reference_date,
          reference_slot: payload.reference_slot,
        },
      },
    }),
  });

  const text = await res.text();
  let parsed: unknown = null;

  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  return {
    ok: res.ok,
    status: res.status,
    data: parsed,
  };
}

serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return jsonResponse(405, { ok: false, error: "Method not allowed" });
    }

    const payload = await req.json();

    if (!validatePayload(payload)) {
      return jsonResponse(400, {
        ok: false,
        error: "Missing required fields",
      });
    }

    const {
      company_id,
      user_id,
      notification_type,
      reference_date,
      reference_slot,
      title,
      body,
    } = payload;

    const { data: alreadySent, error: alreadySentError } = await supabase.rpc(
      "push_already_sent",
      {
        p_company_id: company_id,
        p_user_id: user_id,
        p_notification_type: notification_type,
        p_reference_date: reference_date,
        p_reference_slot: reference_slot,
      },
    );

    if (alreadySentError) {
      throw new Error(`push_already_sent failed: ${alreadySentError.message}`);
    }

    if (alreadySent === true) {
      return jsonResponse(200, {
        ok: true,
        skipped: true,
        reason: "already_sent",
      });
    }

    const { data: devices, error: devicesError } = await supabase
      .from("push_devices")
      .select("id, device_token")
      .eq("company_id", company_id)
      .eq("user_id", user_id)
      .eq("provider", "fcm")
      .eq("is_active", true);

    if (devicesError) {
      throw new Error(`Failed to load push devices: ${devicesError.message}`);
    }

    const activeDevices = (devices ?? []) as PushDeviceRow[];

    if (activeDevices.length === 0) {
      return jsonResponse(200, {
        ok: false,
        reason: "no_active_devices",
        sent_count: 0,
        failed_count: 0,
        logged: false,
      });
    }

    const accessToken = await getGoogleAccessToken();

    let sentCount = 0;
    let failedCount = 0;
    const invalidDeviceIds: string[] = [];

    for (const device of activeDevices) {
      const result = await sendToFcm(accessToken, device.device_token, {
        company_id,
        user_id,
        notification_type,
        reference_date,
        reference_slot,
        title,
        body,
      });

      if (result.ok) {
        sentCount += 1;
      } else {
        failedCount += 1;

        if (isInvalidTokenError(result.data)) {
          invalidDeviceIds.push(device.id);
        }
      }
    }

    if (invalidDeviceIds.length > 0) {
      const { error: deactivateError } = await supabase
        .from("push_devices")
        .update({ is_active: false })
        .in("id", invalidDeviceIds);

      if (deactivateError) {
        throw new Error(
          `Failed to deactivate invalid tokens: ${deactivateError.message}`,
        );
      }
    }

    let logged = false;
    let log_id: string | null = null;

    if (sentCount > 0) {
      const { data: logId, error: logError } = await supabase.rpc(
        "log_push_notification",
        {
          p_company_id: company_id,
          p_user_id: user_id,
          p_notification_type: notification_type,
          p_reference_date: reference_date,
          p_reference_slot: reference_slot,
        },
      );

      if (logError) {
        throw new Error(`log_push_notification failed: ${logError.message}`);
      }

      logged = true;
      log_id = logId ?? null;
    }

    return jsonResponse(200, {
      ok: sentCount > 0,
      sent_count: sentCount,
      failed_count: failedCount,
      logged,
      log_id,
      invalidated_devices: invalidDeviceIds.length,
    });
  } catch (error) {
    return jsonResponse(500, {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});