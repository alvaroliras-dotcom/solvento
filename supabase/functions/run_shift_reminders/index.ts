// Recordatorios antiguos. Ya no los lanza ninguna tarea programada (los
// avisos los manda run_long_open_shift_checks). Se conserva protegida:
// solo el propio servidor puede invocarla.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type ReminderRow = {
  user_id: string;
  company_id: string;
  reference_date: string;
  reference_slot: string;
  notification_type: string;
};

type PushResponse = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  sent_count?: number;
  failed_count?: number;
  logged?: boolean;
  log_id?: string | null;
  invalidated_devices?: number;
  error?: string;
};

function buildMessage(notificationType: string) {
  switch (notificationType) {
    case "missing_checkin_warning_1":
      return {
        title: "Aviso de fichaje",
        body: "Aún no has fichado la entrada de la mañana.",
      };

    case "missing_checkin_warning_2":
      return {
        title: "Segundo aviso de fichaje",
        body: "Sigues sin fichar la entrada de la mañana.",
      };

    case "missing_lunch_checkout_warning_1":
      return {
        title: "Aviso de fichaje",
        body: "Aún no has fichado la salida de comida.",
      };

    case "missing_lunch_checkout_warning_2":
      return {
        title: "Segundo aviso de fichaje",
        body: "Sigues sin fichar la salida de comida.",
      };

    case "missing_lunch_checkin_warning_1":
      return {
        title: "Aviso de fichaje",
        body: "Aún no has fichado la vuelta de comida.",
      };

    case "missing_lunch_checkin_warning_2":
      return {
        title: "Segundo aviso de fichaje",
        body: "Sigues sin fichar la vuelta de comida.",
      };

    case "missing_final_checkout_warning_1":
      return {
        title: "Aviso de fichaje",
        body: "Aún no has fichado la salida final.",
      };

    case "missing_final_checkout_warning_2":
      return {
        title: "Segundo aviso de fichaje",
        body: "Sigues sin fichar la salida final.",
      };

    default:
      return {
        title: "Aviso de fichaje",
        body: "Tienes un fichaje pendiente.",
      };
  }
}

async function callReminderFunction(
  supabase: ReturnType<typeof createClient>,
  functionName: string,
  companyId: string,
) {
  const { data, error } = await supabase.rpc(functionName, {
    p_company_id: companyId,
  });

  if (error) {
    throw new Error(`${functionName} failed: ${error.message}`);
  }

  return (data ?? []) as ReminderRow[];
}

Deno.serve(async (req) => {
  const auth = req.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`) {
    return new Response(JSON.stringify({ ok: false, error: "No autorizado" }),
      { status: 401, headers: { "Content-Type": "application/json" } });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const companyId = "6f41257b-f20e-4e33-9cd1-b4109d02ffb8"; // Solvento

    const allReminders: ReminderRow[] = [];

    const morning = await callReminderFunction(
      supabase,
      "get_morning_checkin_reminders",
      companyId,
    );

    const lunchCheckout = await callReminderFunction(
      supabase,
      "get_lunch_checkout_reminders",
      companyId,
    );

    const lunchCheckin = await callReminderFunction(
      supabase,
      "get_lunch_checkin_reminders",
      companyId,
    );

    const finalCheckout = await callReminderFunction(
      supabase,
      "get_final_checkout_reminders",
      companyId,
    );

    allReminders.push(
      ...morning,
      ...lunchCheckout,
      ...lunchCheckin,
      ...finalCheckout,
    );

    const results: Array<Record<string, unknown>> = [];

    for (const reminder of allReminders) {
      const message = buildMessage(reminder.notification_type);

      const pushRes = await fetch(
        `${Deno.env.get("SUPABASE_URL")!}/functions/v1/send_push_notification`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
          },
          body: JSON.stringify({
            company_id: reminder.company_id,
            user_id: reminder.user_id,
            notification_type: reminder.notification_type,
            reference_date: reminder.reference_date,
            reference_slot: reminder.reference_slot,
            title: message.title,
            body: message.body,
          }),
        },
      );

      const pushJson = (await pushRes.json()) as PushResponse;

      results.push({
        user_id: reminder.user_id,
        notification_type: reminder.notification_type,
        reference_slot: reminder.reference_slot,
        push_result: pushJson,
      });
    }

    return new Response(
      JSON.stringify(
        {
          ok: true,
          company_id: companyId,
          reminders_found: allReminders.length,
          results,
        },
        null,
        2,
      ),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify(
        {
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        null,
        2,
      ),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
});
