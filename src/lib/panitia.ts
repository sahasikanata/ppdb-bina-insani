import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type AppRole = Database["public"]["Enums"]["app_role"];
export type PemeriksaanRow = Database["public"]["Tables"]["pemeriksaan_berkas"]["Row"];
export type TemuanRow = Database["public"]["Tables"]["temuan_berkas"]["Row"];
export type RiwayatRow = Database["public"]["Tables"]["riwayat_verifikasi"]["Row"];

export const peranQuery = (userId: string) =>
  queryOptions({
    queryKey: ["peran", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
      return data.map((r) => r.role);
    },
    staleTime: 5 * 60_000,
  });

export const isStaff = (roles: AppRole[]) =>
  roles.some((r) => r === "panitia" || r === "pimpinan" || r === "super_admin");
export const bisaMemverifikasi = (roles: AppRole[]) =>
  roles.some((r) => r === "panitia" || r === "super_admin");

async function ambilDaftarPendaftar() {
  const { data, error } = await supabase
    .from("pendaftaran")
    .select(
      "id, nomor_pendaftaran, nama_lengkap, nik, kampus, prodi, status, diajukan_at, updated_at, gelombang(id, nama, urutan), temuan_berkas(keputusan), pemeriksaan_berkas(status)",
    )
    .neq("status", "draf")
    .order("diajukan_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data;
}
export const daftarPendaftarQuery = queryOptions({
  queryKey: ["panitia", "pendaftar"],
  queryFn: ambilDaftarPendaftar,
});
export type PendaftarRingkas = Awaited<ReturnType<typeof ambilDaftarPendaftar>>[number];

async function ambilDetailPendaftar(id: string) {
  const { data: p, error } = await supabase
    .from("pendaftaran")
    .select("*, gelombang(*), berkas_pendaftaran(*)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!p) return null;
  const [pem, riw, prof] = await Promise.all([
    supabase.from("pemeriksaan_berkas").select("*, temuan_berkas(*)").eq("pendaftaran_id", id),
    supabase
      .from("riwayat_verifikasi")
      .select("*")
      .eq("pendaftaran_id", id)
      .order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, nama, email, whatsapp").eq("id", p.user_id).maybeSingle(),
  ]);
  if (pem.error) throw new Error(pem.error.message);
  if (riw.error) throw new Error(riw.error.message);
  const pemeriksaan = (pem.data ?? []).map((x) => ({
    ...x,
    temuan_berkas: [...(x.temuan_berkas ?? [])].sort((a, b) => a.urutan - b.urutan),
  }));
  const staffIds = new Set<string>();
  for (const r of riw.data ?? []) staffIds.add(r.oleh);
  for (const x of pemeriksaan)
    for (const t of x.temuan_berkas) if (t.ditinjau_oleh) staffIds.add(t.ditinjau_oleh);
  const staf = staffIds.size
    ? ((
        await supabase
          .from("profiles")
          .select("id, nama")
          .in("id", [...staffIds])
      ).data ?? [])
    : [];
  return {
    pendaftaran: p,
    akun: prof.data,
    pemeriksaan,
    riwayat: riw.data ?? [],
    namaStaf: Object.fromEntries(staf.map((s) => [s.id, s.nama || "Panitia"])) as Record<
      string,
      string
    >,
  };
}
export const detailPendaftarQuery = (id: string) =>
  queryOptions({ queryKey: ["panitia", "pendaftar", id], queryFn: () => ambilDetailPendaftar(id) });
export type DetailPendaftar = NonNullable<Awaited<ReturnType<typeof ambilDetailPendaftar>>>;
