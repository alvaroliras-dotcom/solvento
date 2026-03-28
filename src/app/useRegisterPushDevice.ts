import { useEffect, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import { requestPushPermissionAndToken } from "../lib/pushMessaging";
import { savePushDevice } from "../lib/pushDevices";
import { useActiveMembership } from "./useActiveMembership";

export function useRegisterPushDevice(enabled: boolean = true) {
  const { membership, loading: membershipLoading } = useActiveMembership();
  const startedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    if (startedRef.current) return;
    if (membershipLoading) return;
    if (!membership?.company_id) return;

    const companyId = membership.company_id;

    let cancelled = false;
    startedRef.current = true;

    async function run() {
      try {
        const { data: authData, error: authError } = await supabase.auth.getUser();

        if (authError) throw authError;
        if (!authData.user) return;

        const token = await requestPushPermissionAndToken();

        if (cancelled) return;

        await savePushDevice({
          companyId,
          userId: authData.user.id,
          deviceToken: token,
        });
      } catch (error) {
        console.warn("[push] no se pudo registrar el dispositivo", error);
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [enabled, membershipLoading, membership?.company_id]);
}