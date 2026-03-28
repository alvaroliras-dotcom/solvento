import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCheckIn,
  createCheckOut,
  getOpenEntry,
} from "./timeEntries.api";
import { supabase } from "../../lib/supabaseClient";

type GeoInput = {
  lat: number;
  lng: number;
  accuracy: number | null;
  capturedAt: string;
};

export function useOpenEntry(companyId: string | null, userId: string | null) {
  return useQuery({
    queryKey: ["time_entries", "open", companyId, userId],
    queryFn: () => getOpenEntry(companyId!, userId!),
    enabled: !!companyId && !!userId,
  });
}

export function useCheckIn(companyId: string | null, userId: string | null) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (geo?: any) => {
      if (!companyId || !userId) {
        throw new Error("No se puede fichar: falta empresa o usuario");
      }

      return createCheckIn(companyId, userId, geo);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["time_entries"] });
    },
  });
}

export function useCheckOut() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: { entryId: string; geo?: GeoInput | null }) => {
      return createCheckOut(input.entryId, input.geo ?? null);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["time_entries"] });
    },
  });
}

export function useCreateAdjustment() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      timeEntryId: string;
      proposedCheckOut: string;
      reason: string;
    }) => {
      const { timeEntryId, proposedCheckOut, reason } = input;

      const { error } = await supabase.rpc("request_time_entry_adjustment", {
        p_time_entry_id: timeEntryId,
        p_proposed_check_out: proposedCheckOut,
        p_reason: reason,
      });

      if (error) throw error;

      return true;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["time_entries"] });
    },
  });
}