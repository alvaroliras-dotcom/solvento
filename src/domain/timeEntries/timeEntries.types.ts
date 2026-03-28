export type TimeEntry = {
  id: string;
  company_id: string;
  user_id: string;

  check_in_at: string;
  check_out_at: string | null;

  status: string | null;

  workflow_status: "auto" | "pending" | "adjusted" | "requires_new_proposal";
  flags: Record<string, any> | null;

  check_in_geo_lat?: number | null;
  check_in_geo_lng?: number | null;
  check_in_geo_accuracy_m?: number | null;
  check_in_geo_captured_at?: string | null;

  check_out_geo_lat?: number | null;
  check_out_geo_lng?: number | null;
  check_out_geo_accuracy_m?: number | null;
  check_out_geo_captured_at?: string | null;

  created_at?: string;
};