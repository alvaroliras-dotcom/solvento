import { createClient } from "@supabase/supabase-js";
import { env, assertEnv } from "./env";

assertEnv();

export const supabase = createClient(
  env.supabaseUrl,
  env.supabaseAnonKey
);