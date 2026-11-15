// Shared rules for AI document checks and panitia verification.
// The database enforces verification (verifikasi_pendaftaran); these mirror it for UI feedback
// and decide when the server may (re)run an AI check.

export const KATEGORI_TEMUAN = [
  "nama_tidak_cocok",
  "data_tidak_cocok",
  "halaman_kurang",
  "dokumen_salah",
  "tidak_terbaca",
  "tidak_lengkap",
  "lainnya",
] as const;
export type KategoriTemuan = (typeof KATEGORI_TEMUAN)[number];

export const kategoriLabel: Record<KategoriTemuan, string> = {
  nama_tidak_cocok: "Nama tidak cocok",
  data_tidak_cocok: "Data tidak cocok",
  halaman_kurang: "Halaman kurang",
  dokumen_salah: "Dokumen salah",
  tidak_terbaca: "Tidak terbaca",
  tidak_lengkap: "Tidak lengkap",
  lainnya: "Lainnya",
};

export const TINGKAT_TEMUAN = ["tinggi", "sedang", "rendah"] as const;
export type TingkatTemuan = (typeof TINGKAT_TEMUAN)[number];
export const tingkatLabel: Record<TingkatTemuan, string> = { tinggi: "Tinggi", sedang: "Sedang", rendah: "Rendah" };

export type KeputusanTemuan = "menunggu" | "dikonfirmasi" | "diabaikan";
export const keputusanLabel: Record<KeputusanTemuan, string> = {
  menunggu: "Belum ditinjau",
  dikonfirmasi: "Dikonfirmasi",
  diabaikan: "Diabaikan",
};

/** A check still "memproses" after this long is treated as stalled and may be run again. */
export const BATAS_MACET_MS = 5 * 60_000;

/** After a credit/permission failure, applicant-triggered checks pause for this long. */
export const JEDA_SETELAH_KREDIT_MS = 60 * 60_000;

export type PemeriksaanRingkas = { status: "memproses" | "selesai" | "gagal"; storage_path: string; dimulai_at: string };

export function pemeriksaanMacet(p: Pick<PemeriksaanRingkas, "status" | "dimulai_at">, now = Date.now()) {
  return p.status === "memproses" && now - Date.parse(p.dimulai_at) > BATAS_MACET_MS;
}

/**
 * Whether a new AI check should run for this file.
 * - A new or replaced file is always checked.
 * - A check in progress is never duplicated (unless stalled).
 * - Applicants trigger at most one check per uploaded file; panitia may re-run any time.
 */
export function perluPemeriksaan(
  existing: PemeriksaanRingkas | null | undefined,
  storagePath: string,
  oleh: "pendaftar" | "panitia",
  now = Date.now(),
) {
  if (!existing || existing.storage_path !== storagePath) return true;
  if (existing.status === "memproses" && !pemeriksaanMacet(existing, now)) return false;
  if (existing.status === "memproses") return true;
  return oleh === "panitia";
}

/** Findings that still block "Terverifikasi": not reviewed yet, or confirmed as a real problem. */
export function temuanTerbuka(temuan: { keputusan: KeputusanTemuan }[]) {
  return temuan.filter((t) => t.keputusan === "menunggu" || t.keputusan === "dikonfirmasi").length;
}

export const MIN_CATATAN_PERBAIKAN = 10;
export const MAKS_CATATAN = 2000;

/** Mirrors verifikasi_pendaftaran: returns the reason a decision is not allowed, or null. */
export function alasanTolakVerifikasi(
  keputusan: "terverifikasi" | "perlu_perbaikan",
  catatan: string,
  temuan: { keputusan: KeputusanTemuan }[],
) {
  const c = catatan.trim();
  if (c.length > MAKS_CATATAN) return `Catatan terlalu panjang (maksimal ${MAKS_CATATAN} karakter).`;
  if (keputusan === "perlu_perbaikan" && c.length < MIN_CATATAN_PERBAIKAN)
    return "Tulis catatan perbaikan agar pendaftar tahu apa yang harus diperbaiki.";
  if (keputusan === "terverifikasi") {
    const n = temuanTerbuka(temuan);
    if (n > 0) return `Masih ada ${n} temuan berkas yang belum selesai. Abaikan temuan yang keliru, atau minta perbaikan.`;
  }
  return null;
}

/** Drafts a fix note for the applicant from findings panitia confirmed. */
export function susunCatatanDariTemuan(
  temuan: { keputusan: KeputusanTemuan; kode_berkas: string; judul: string; catatan_panitia: string | null }[],
  namaBerkas: (kode: string) => string,
) {
  const baris = temuan
    .filter((t) => t.keputusan === "dikonfirmasi")
    .map((t) => `- ${namaBerkas(t.kode_berkas)}: ${t.catatan_panitia?.trim() || t.judul}`);
  if (baris.length === 0) return "";
  return `Mohon perbaiki berkas berikut, lalu ajukan kembali:\n${baris.join("\n")}`;
}
