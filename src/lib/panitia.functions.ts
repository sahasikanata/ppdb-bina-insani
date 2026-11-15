import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { jalankanPemeriksaan } from "./pemeriksaan-berkas.server";

/**
 * Runs the AI check for one uploaded file.
 * Applicants may trigger it for their own files (once per upload); panitia/super admin may re-run any file.
 */
export const periksaBerkas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ berkasId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // RLS: returns the row only to its owner or staff.
    const { data: b } = await supabase
      .from("berkas_pendaftaran")
      .select("id, pendaftaran(user_id)")
      .eq("id", data.berkasId)
      .maybeSingle();
    if (!b) throw new Error("Berkas tidak ditemukan.");

    const [panitia, superAdmin] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "panitia" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "super_admin" }),
    ]);
    const isPanitia = panitia.data === true || superAdmin.data === true;
    const isPemilik = b.pendaftaran?.user_id === userId;
    if (!isPanitia && !isPemilik) throw new Error("Anda tidak berhak memeriksa berkas ini.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return jalankanPemeriksaan(supabaseAdmin, b.id, isPanitia ? "panitia" : "pendaftar");
  });
