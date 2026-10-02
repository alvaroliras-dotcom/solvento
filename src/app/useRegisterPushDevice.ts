import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import {
  isIos,
  listenForegroundMessages,
  pushPermissionState,
  requestPushPermissionAndToken,
} from "../lib/pushMessaging";
import { savePushDevice } from "../lib/pushDevices";
import { useActiveMembership } from "./useActiveMembership";

// Registra este dispositivo para recibir avisos push.
//
// - Si el permiso ya esta concedido, se registra sin preguntar.
// - En Android y escritorio se pide el permiso al entrar, como antes.
// - En iPhone el permiso solo se puede pedir desde un boton: el hook
//   devuelve needsPermission=true y la pantalla muestra "Activar avisos".
export function useRegisterPushDevice(enabled: boolean = true) {
  const { membership, loading: membershipLoading } = useActiveMembership();
  const startedRef = useRef(false);
  const [needsPermission, setNeedsPermission] = useState(false);

  const companyId = membership?.company_id ?? null;

  const register = useCallback(async () => {
    if (!companyId) return;

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    if (!authData.user) return;

    const token = await requestPushPermissionAndToken();

    await savePushDevice({
      companyId,
      userId: authData.user.id,
      deviceToken: token,
    });
  }, [companyId]);

  useEffect(() => {
    if (!enabled) return;
    if (startedRef.current) return;
    if (membershipLoading) return;
    if (!companyId) return;

    startedRef.current = true;

    const permission = pushPermissionState();
    if (permission === "unsupported" || permission === "denied") return;

    if (permission === "default" && isIos()) {
      setNeedsPermission(true);
      return;
    }

    register().catch((error) => {
      console.warn("[push] no se pudo registrar el dispositivo", error);
    });
  }, [enabled, membershipLoading, companyId, register]);

  useEffect(() => {
    if (!enabled) return;
    let unsubscribe: (() => void) | undefined;
    listenForegroundMessages()
      .then((fn) => {
        unsubscribe = fn;
      })
      .catch(() => undefined);
    return () => unsubscribe?.();
  }, [enabled]);

  // Para llamar desde el boton "Activar avisos".
  const enable = useCallback(async () => {
    try {
      await register();
      setNeedsPermission(false);
      return true;
    } catch (error) {
      console.warn("[push] no se pudo activar", error);
      setNeedsPermission(pushPermissionState() === "default");
      return false;
    }
  }, [register]);

  return { needsPermission, enable };
}
