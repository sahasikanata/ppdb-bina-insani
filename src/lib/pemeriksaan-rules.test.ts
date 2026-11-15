import { describe, expect, it } from "vitest";
import { alasanTolakVerifikasi, perluPemeriksaan, susunCatatanDariTemuan, temuanTerbuka } from "./pemeriksaan-rules";

const now = Date.parse("2026-11-15T10:00:00Z");
const menit = (m: number) => new Date(now - m * 60_000).toISOString();

describe("perluPemeriksaan", () => {
  it("checks a file that has never been checked", () => {
    expect(perluPemeriksaan(null, "a.pdf", "pendaftar", now)).toBe(true);
  });
  it("checks a replaced file even if the old one was checked", () => {
    expect(perluPemeriksaan({ status: "selesai", storage_path: "old.pdf", dimulai_at: menit(1) }, "new.pdf", "pendaftar", now)).toBe(true);
  });
  it("does not let an applicant re-run a finished check of the same file", () => {
    expect(perluPemeriksaan({ status: "selesai", storage_path: "a.pdf", dimulai_at: menit(1) }, "a.pdf", "pendaftar", now)).toBe(false);
    expect(perluPemeriksaan({ status: "gagal", storage_path: "a.pdf", dimulai_at: menit(1) }, "a.pdf", "pendaftar", now)).toBe(false);
  });
  it("lets panitia re-run a finished or failed check", () => {
    expect(perluPemeriksaan({ status: "selesai", storage_path: "a.pdf", dimulai_at: menit(1) }, "a.pdf", "panitia", now)).toBe(true);
  });
  it("never duplicates a check in progress, until it stalls after 5 minutes", () => {
    expect(perluPemeriksaan({ status: "memproses", storage_path: "a.pdf", dimulai_at: menit(4) }, "a.pdf", "panitia", now)).toBe(false);
    expect(perluPemeriksaan({ status: "memproses", storage_path: "a.pdf", dimulai_at: menit(6) }, "a.pdf", "pendaftar", now)).toBe(true);
  });
});

describe("verification", () => {
  it("blocks Terverifikasi while findings are unreviewed or confirmed", () => {
    const t = [{ keputusan: "menunggu" as const }, { keputusan: "dikonfirmasi" as const }, { keputusan: "diabaikan" as const }];
    expect(temuanTerbuka(t)).toBe(2);
    expect(alasanTolakVerifikasi("terverifikasi", "", t)).toMatch(/2 temuan/);
    expect(alasanTolakVerifikasi("terverifikasi", "", [{ keputusan: "diabaikan" }])).toBeNull();
  });
  it("requires a fix note of at least 10 characters for Perlu Perbaikan", () => {
    expect(alasanTolakVerifikasi("perlu_perbaikan", "ganti", [])).not.toBeNull();
    expect(alasanTolakVerifikasi("perlu_perbaikan", "Ganti foto KTP", [])).toBeNull();
  });
  it("drafts the note only from confirmed findings", () => {
    const note = susunCatatanDariTemuan(
      [
        { keputusan: "dikonfirmasi", kode_berkas: "ktp", judul: "Nama tidak cocok", catatan_panitia: null },
        { keputusan: "diabaikan", kode_berkas: "kk", judul: "Halaman kurang", catatan_panitia: null },
      ],
      (k) => k.toUpperCase(),
    );
    expect(note).toContain("- KTP: Nama tidak cocok");
    expect(note).not.toContain("KK");
  });
});
