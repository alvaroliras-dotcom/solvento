import { supabase } from "../../lib/supabaseClient";

export const getUserMemberships = async (userId: string) => {
  const { data, error } = await supabase
    .from("memberships")
    .select("company_id")
    .eq("user_id", userId);

  if (error) throw error;
  return data;
};