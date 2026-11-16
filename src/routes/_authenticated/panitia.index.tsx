import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import { FormAlert, SelectInput, TextInput } from "@/components/site/form";
import { StatusPill } from "@/components/site/StatusPill";
import { daftarPendaftarQuery, type PendaftarRingkas } from "@/lib/panitia";
import { pesanError } from "@/lib/akun";
import { tanggalWIB } from "@/lib/waktu";
import { temuanTerbuka } from "@/lib/pemeriksaan-rules";
import type { StatusPendaftaran } from "@/lib/pendaftaran-rules";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/panitia/")({
  component: DaftarPendaftar,
});

const saringan = [
  { id: "menunggu_verifikasi", label: "Menunggu verifikasi" },
  { id: "perlu_perbaikan", label: "Perlu perbaikan" },
  { id: "terverifikasi", label: "Terverifikasi" },
  { id: "semua", label: "Semua" },
] as const;
type Saringan = (typeof saringan)[number]["id"];

function DaftarPendaftar() {
  const q = useQuery(daftarPendaftarQuery);
  const [status, setStatus] = useState<Saringan>("menunggu_verifikasi");
  const [gelombang, setGelombang] = useState("");
  const [cari, setCari] = useState("");

  const rows = q.data ?? [];
  const gelombangList = useMemo(() => {
    const m = new Map<string, { id: string; nama: string; urutan: number }>();
    for (const r of rows) if (r.gelombang) m.set(r.gelombang.id, r.gelombang);
    return [...m.values()].sort((a, b) => a.urutan - b.urutan);
  }, [rows]);

  const hitung = (s: Saringan) => (s === "semua" ? rows.length : rows.filter((r) => r.status === s).length);
  const totalTemuan = rows.reduce((n, r) => n + temuanTerbuka(r.temuan_berkas), 0);

  const term = cari.trim().toLowerCase();
  const tampil = rows.filter(
    (r) =>
      (status === "semua" || r.status === status) &&
      (!gelombang || r.gelombang?.id === gelombang) &&
      (!term ||
        [r.nama_lengkap, r.nomor_pendaftaran, r.nik, r.kampus].some((v) => (v ?? "").toLowerCase().includes(term))),
  );

  return (
    <div className="container-page py-12 md:py-16">
      <div className="grid gap-8 md:grid-cols-12 md:items-end">
        <div className="md:col-span-7">
          <p className="eyebrow text-muted-foreground">Tahap verifikasi</p>
          <h1 className="mt-4 font-display-tight text-4xl md:text-5xl">Periksa tiap pendaftaran, satu per satu.</h1>
        </div>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-4 md:col-span-5">
          <div>
            <dt className="eyebrow text-muted-foreground">Antre</dt>
            <dd className="mt-1 font-display-tight text-4xl">{hitung("menunggu_verifikasi")}</dd>
          </div>
          <div>
            <dt className="eyebrow text-muted-foreground">Temuan AI terbuka</dt>
            <dd className={cn("mt-1 font-display-tight text-4xl", totalTemuan > 0 && "text-clay")}>{totalTemuan}</dd>
          </div>
        </dl>
      </div>

      <div className="mt-12 flex flex-col gap-4 border-t border-foreground/80 pt-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="-mx-1 flex flex-wrap gap-1" role="tablist" aria-label="Saring status">
          {saringan.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={status === s.id}
              onClick={() => setStatus(s.id)}
              className={cn(
                "rounded-sm px-3 py-1.5 text-sm transition-colors",
                status === s.id ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s.label} <span className="ml-1 font-mono text-xs opacity-70">{hitung(s.id)}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <SelectInput
            aria-label="Gelombang"
            value={gelombang}
            onChange={(e) => setGelombang(e.target.value)}
            className="h-10 sm:w-44"
          >
            <option value="">Semua gelombang</option>
            {gelombangList.map((g) => (
              <option key={g.id} value={g.id}>
                {g.nama}
              </option>
            ))}
          </SelectInput>
          <div className="relative sm:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <TextInput
              type="search"
              aria-label="Cari pendaftar"
              placeholder="Nama, nomor, NIK, kampus"
              value={cari}
              onChange={(e) => setCari(e.target.value)}
              className="h-10 pl-9"
            />
          </div>
        </div>
      </div>

      <div className="mt-6">
        {q.isPending ? (
          <p className="py-16 eyebrow text-muted-foreground">Memuat…</p>
        ) : q.isError ? (
          <FormAlert>{pesanError(q.error)}</FormAlert>
        ) : tampil.length === 0 ? (
          <p className="border-y border-border py-16 text-center text-muted-foreground">
            {rows.length === 0 ? "Belum ada pendaftaran yang diajukan." : "Tidak ada pendaftar yang cocok dengan saringan ini."}
          </p>
        ) : (
          <ul className="border-t border-border">
            {tampil.map((r) => (
              <Baris key={r.id} r={r} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Baris({ r }: { r: PendaftarRingkas }) {
  const terbuka = temuanTerbuka(r.temuan_berkas);
  const memproses = r.pemeriksaan_berkas.some((p) => p.status === "memproses");
  return (
    <li className="border-b border-border">
      <Link
        to="/panitia/$id"
        params={{ id: r.id }}
        className="group grid gap-3 py-5 transition-colors hover:bg-card md:grid-cols-12 md:items-center md:gap-6 md:px-3"
      >
        <span className="font-mono text-sm md:col-span-2">{r.nomor_pendaftaran ?? "—"}</span>
        <span className="md:col-span-4">
          <span className="block text-lg leading-snug">{r.nama_lengkap || "Tanpa nama"}</span>
          <span className="block text-sm text-muted-foreground">
            {[r.kampus, r.prodi].filter(Boolean).join(" · ") || "—"}
          </span>
        </span>
        <span className="text-sm text-muted-foreground md:col-span-2">
          {r.gelombang?.nama}
          {r.diajukan_at ? <span className="block font-mono text-xs">{tanggalWIB(r.diajukan_at)}</span> : null}
        </span>
        <span className="text-sm md:col-span-2">
          {memproses ? (
            <span className="text-muted-foreground">AI memeriksa…</span>
          ) : terbuka > 0 ? (
            <span className="text-clay">{terbuka} temuan terbuka</span>
          ) : r.pemeriksaan_berkas.length > 0 ? (
            <span className="text-muted-foreground">Tidak ada temuan</span>
          ) : (
            <span className="text-muted-foreground">Belum diperiksa AI</span>
          )}
        </span>
        <span className="flex items-center justify-between gap-3 md:col-span-2 md:justify-end">
          <StatusPill status={r.status as StatusPendaftaran} />
          <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </span>
      </Link>
    </li>
  );
}
