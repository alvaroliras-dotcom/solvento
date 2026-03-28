export const env = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL as string,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
};

export function assertEnv() {
  const missing: string[] = [];

  if (!env.supabaseUrl) missing.push("VITE_SUPABASE_URL");
  if (!env.supabaseAnonKey) missing.push("VITE_SUPABASE_ANON_KEY");

  if (missing.length) {
    throw new Error("Missing env vars: " + missing.join(", "));
  }
}