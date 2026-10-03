// =====================================================================
// Altas, bajas, reactivaciones y cambios de PIN desde el panel.
//
// Antes cada alta se hacia a mano con SQL en Supabase (crear el usuario,
// confirmar el correo, el perfil y la membresia). Ahora lo hace
// administracion desde la pantalla de Empleados y esta funcion se encarga
// de todo con permisos de servidor.
//
// Seguridad: solo responde a un owner/admin con alta activa, y solo actua
// sobre trabajadores (rol employee) de su misma empresa. Cada accion queda
// apuntada en employee_changes. Los fichajes nunca se borran: la baja solo
// quita el acceso (obligacion legal de conservar el registro 4 años).
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Los errores de negocio se devuelven con 200 y ok:false para que el panel
// pueda mostrar el mensaje tal cual.
function responder(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function fallo(mensaje: string) {
  return responder({ ok: false, error: mensaje });
}

const BAN_PARA_SIEMPRE = "876000h"; // 100 años

function pinValido(pin: unknown): pin is string {
  return typeof pin === "string" && /^\d{4,8}$/.test(pin);
}

function traducirErrorAuth(mensaje: string) {
  const m = mensaje.toLowerCase();
  if (m.includes("at least")) {
    return "El PIN es demasiado corto para la configuración de seguridad. Usa al menos 6 cifras.";
  }
  if (m.includes("already") && m.includes("registered")) {
    return "Ya existe un usuario con ese correo.";
  }
  if (m.includes("invalid") && m.includes("email")) {
    return "El correo no es válido.";
  }
  return mensaje;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return responder({ ok: false, error: "Método no permitido" }, 405);

  try {
    // ---------- Quien llama ----------
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: quien, error: errorQuien } = await admin.auth.getUser(token);
    if (errorQuien || !quien?.user) {
      return responder({ ok: false, error: "Tienes que iniciar sesión." }, 401);
    }
    const adminId = quien.user.id;

    const { data: miAlta } = await admin
      .from("memberships")
      .select("company_id, role")
      .eq("user_id", adminId)
      .eq("status", "active")
      .in("role", ["owner", "admin"])
      .limit(1)
      .maybeSingle();

    if (!miAlta) {
      return responder({ ok: false, error: "Solo administración puede gestionar trabajadores." }, 403);
    }
    const companyId = miAlta.company_id as string;

    const body = await req.json().catch(() => ({}));
    const accion = String(body.action ?? "");

    async function apuntar(userId: string, action: string, details: Record<string, unknown>) {
      await admin.from("employee_changes").insert({
        company_id: companyId,
        user_id: userId,
        action,
        performed_by: adminId,
        details,
      });
    }

    // Trabajador de esta empresa (cualquier estado). Solo se gestionan
    // empleados: a owners y admins no se les toca desde aqui.
    async function trabajadorDeLaEmpresa(userId: string) {
      const { data } = await admin
        .from("memberships")
        .select("id, user_id, role, status")
        .eq("company_id", companyId)
        .eq("user_id", userId)
        .maybeSingle();
      return data;
    }

    // ================= ALTA =================
    if (accion === "alta") {
      const nombre = String(body.full_name ?? "").trim();
      const email = String(body.email ?? "").trim().toLowerCase();
      const pin = body.pin;

      if (nombre.length < 3) return fallo("Escribe el nombre y apellidos del trabajador.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fallo("El correo no es válido.");
      if (!pinValido(pin)) return fallo("El PIN tiene que tener entre 4 y 8 cifras.");

      const { data: perfil } = await admin
        .from("profiles")
        .select("id")
        .eq("email", email)
        .maybeSingle();

      let userId: string;
      let reactivado = false;

      if (perfil) {
        // Ese correo ya tiene usuario: si ya trabaja aqui no se duplica; si
        // es un antiguo trabajador, se reactiva con el PIN nuevo.
        userId = perfil.id as string;
        const alta = await trabajadorDeLaEmpresa(userId);

        if (alta && alta.status === "active") {
          return fallo("Ese trabajador ya está dado de alta.");
        }
        if (alta && alta.role !== "employee") {
          return fallo("Ese correo pertenece a un administrador.");
        }

        const { error: errorPin } = await admin.auth.admin.updateUserById(userId, {
          password: pin,
          ban_duration: "none",
          email_confirm: true,
        });
        if (errorPin) return fallo(traducirErrorAuth(errorPin.message));

        if (alta) {
          const { error } = await admin
            .from("memberships")
            .update({ status: "active", ended_at: null, end_reason: null })
            .eq("id", alta.id);
          if (error) return fallo(error.message);
          reactivado = true;
        } else {
          const { error } = await admin.from("memberships").insert({
            company_id: companyId,
            user_id: userId,
            role: "employee",
            job_type: "fixed",
            margen_tolerancia_minutos: 15,
            status: "active",
          });
          if (error) return fallo(error.message);
        }
      } else {
        const { data: creado, error: errorAlta } = await admin.auth.admin.createUser({
          email,
          password: pin,
          email_confirm: true,
          user_metadata: { full_name: nombre },
        });
        if (errorAlta || !creado?.user) {
          return fallo(traducirErrorAuth(errorAlta?.message ?? "No se pudo crear el usuario."));
        }
        userId = creado.user.id;

        const { error } = await admin.from("memberships").insert({
          company_id: companyId,
          user_id: userId,
          role: "employee",
          job_type: "fixed",
          margen_tolerancia_minutos: 15,
          status: "active",
        });
        if (error) {
          // Sin membresia el usuario no sirve para nada: se deshace.
          await admin.auth.admin.deleteUser(userId);
          return fallo("No se pudo completar el alta: " + error.message);
        }
      }

      // El perfil lo crea la base de datos al crear el usuario; aqui se
      // le pone el nombre.
      await admin.from("profiles").upsert({ id: userId, email, full_name: nombre });

      await apuntar(userId, reactivado ? "reactivacion" : "alta", { nombre, email });

      return responder({ ok: true, user_id: userId, reactivado });
    }

    // Para el resto de acciones hace falta el trabajador.
    const userId = String(body.user_id ?? "");
    if (!userId) return fallo("Falta el trabajador.");
    if (userId === adminId) return fallo("No puedes hacer esto sobre tu propio usuario.");

    const alta = await trabajadorDeLaEmpresa(userId);
    if (!alta) return fallo("Ese trabajador no pertenece a esta empresa.");
    if (alta.role !== "employee") return fallo("A los administradores no se les gestiona desde aquí.");

    // ================= BAJA =================
    if (accion === "baja") {
      if (alta.status !== "active") return fallo("Ese trabajador ya estaba de baja.");

      const motivo = String(body.reason ?? "").trim() || "Baja del trabajador";

      const { data: abierta } = await admin
        .from("time_entries")
        .select("id, check_in_at")
        .eq("company_id", companyId)
        .eq("user_id", userId)
        .is("check_out_at", null)
        .limit(1)
        .maybeSingle();

      if (abierta) {
        return fallo(
          "Tiene una jornada sin cerrar. Ciérrala antes desde su ficha (con la hora real de salida) y vuelve a darle de baja.",
        );
      }

      const { error } = await admin
        .from("memberships")
        .update({ status: "inactive", ended_at: new Date().toISOString(), end_reason: motivo })
        .eq("id", alta.id);
      if (error) return fallo(error.message);

      // Sin acceso: no puede entrar aunque recuerde el PIN, y su movil deja
      // de recibir avisos.
      await admin.auth.admin.updateUserById(userId, { ban_duration: BAN_PARA_SIEMPRE });
      await admin.from("push_devices").update({ is_active: false }).eq("user_id", userId);

      await apuntar(userId, "baja", { motivo });
      return responder({ ok: true });
    }

    // ================= REACTIVAR =================
    if (accion === "reactivar") {
      if (alta.status === "active") return fallo("Ese trabajador ya está de alta.");
      const pin = body.pin;
      if (!pinValido(pin)) return fallo("El PIN tiene que tener entre 4 y 8 cifras.");

      const { error: errorPin } = await admin.auth.admin.updateUserById(userId, {
        password: pin,
        ban_duration: "none",
      });
      if (errorPin) return fallo(traducirErrorAuth(errorPin.message));

      const { error } = await admin
        .from("memberships")
        .update({ status: "active", ended_at: null, end_reason: null })
        .eq("id", alta.id);
      if (error) return fallo(error.message);

      await apuntar(userId, "reactivacion", {});
      return responder({ ok: true });
    }

    // ================= CAMBIAR PIN =================
    if (accion === "cambiar_pin") {
      if (alta.status !== "active") return fallo("Ese trabajador está de baja. Reactívalo con un PIN nuevo.");
      const pin = body.pin;
      if (!pinValido(pin)) return fallo("El PIN tiene que tener entre 4 y 8 cifras.");

      const { error } = await admin.auth.admin.updateUserById(userId, { password: pin });
      if (error) return fallo(traducirErrorAuth(error.message));

      await apuntar(userId, "cambio_pin", {});
      return responder({ ok: true });
    }

    return fallo("Acción no reconocida.");
  } catch (error) {
    return responder(
      { ok: false, error: error instanceof Error ? error.message : "Error inesperado" },
      500,
    );
  }
});
