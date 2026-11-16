import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Eye, RotateCcw, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/site/form";
import { supabase } from "@/integrations/supabase/client";
import { BUCKET_BERKAS, pesanError, type BerkasRow } from "@/lib/akun";
import { formatBytes } from "@/lib/ppdb-queries";
import { periksaBerkas } from "@/lib/panitia.functions";
import type { PemeriksaanRow, TemuanRow } from "@/lib/panitia";
import {
  kategoriLabel,
  keputusanLabel,
  pemeriksaanMacet,
  tingkatLabel,
  type KategoriTemuan,
  type KeputusanTemuan,
  type TingkatTemuan,
} from "@/lib/pemeriksaan-rules";
import { waktuWIB } from "@/lib/waktu";
import { cn } from "@/lib/utils";

type Pemeriksaan = PemeriksaanRow & { temuan_berkas: TemuanRow[] };

export function BerkasTinjau({
  nama,
  wajib,
  berkas,
  pemeriksaan,
  bisaVerifikasi,
  namaStaf,
  onBerubah,
}: {
  nama: string;
  wajib: boolean;
  berkas: BerkasRow | undefined;
  pemeriksaan: Pemeriksaan | undefined;
  bisaVerifikasi: boolean;
  namaStaf: Record<string, string>;
  onBerubah: () => Promise<unknown>;
}) {
  const periksa = useServerFn(periksaBerkas);
  const [memeriksa, setMemeriksa] = useState(false);

  // A check of an older file (before it was replaced) is not shown.
  const cek = pemeriksaan && berkas && pemeriksaan.storage_path === berkas.storage_path ? pemeriksaan : undefined;
  const berjalan = memeriksa || (cek?.status === "memproses" && !pemeriksaanMacet(cek));

  async function lihat() {
    if (!berkas) return;
    const w = window.open("", "_blank");
    const { data, error } = await supabase.storage.from(BUCKET_BERKAS).createSignedUrl(berkas.storage_path, 300);
    if (error || !data) {
      w?.close();
      toast.error("Berkas tidak dapat dibuka.");
      return;
    }
    if (w) w.location.href = data.signedUrl;
  }

  async function jalankan() {
    if (!berkas) return;
    setMemeriksa(true);
    try {
      const r = await periksa({ data: { berkasId: berkas.id } });
      if (r.status === "gagal") toast.error(r.pesan ?? "Pemeriksaan gagal.");
      else if (r.status === "selesai") toast.success(r.temuan ? `${nama}: ${r.temuan} temuan.` : `${nama}: tidak ada temuan.`);
    } catch (e) {
      toast.error(pesanError(e));
    } finally {
      await onBerubah();
      setMemeriksa(false);
    }
  }

  return (
    <article className="border-b border-border py-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="font-display text-2xl leading-tight">{nama}</h3>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {berkas ? (
              <>
                {berkas.nama_file} · {formatBytes(berkas.ukuran)} · diunggah {waktuWIB(berkas.updated_at)}
              </>
            ) : wajib ? (
              <span className="text-destructive">Berkas wajib belum diunggah</span>
            ) : (
              "Opsional · tidak diunggah"
            )}
          </p>
        </div>
        {berkas ? (
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={lihat}>
              <Eye /> Lihat
            </Button>
            {bisaVerifikasi ? (
              <Button type="button" variant="ghost" size="sm" onClick={jalankan} disabled={berjalan}>
                <Sparkles /> {berjalan ? "Memeriksa…" : cek ? "Periksa ulang" : "Periksa dengan AI"}
              </Button>
            ) : null}
          </div>
        ) : null}
      </header>

      {berkas ? (
        <div className="mt-5">
          {berjalan ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="size-1.5 animate-pulse rounded-full bg-primary" /> AI sedang membaca berkas ini…
            </p>
          ) : !cek ? (
            <p className="text-sm text-muted-foreground">Belum diperiksa AI.</p>
          ) : cek.status === "gagal" || cek.status === "memproses" ? (
            <p className="text-sm text-destructive">
              {cek.status === "memproses" ? "Pemeriksaan terhenti. Jalankan ulang." : cek.pesan_galat || "Pemeriksaan gagal."}
            </p>
          ) : (
            <>
              <p className="text-sm leading-relaxed">
                <span className={cn("mr-2 eyebrow", cek.sesuai ? "text-primary" : "text-clay")}>
                  {cek.sesuai ? "AI: sesuai" : "AI: ada ketidaksesuaian"}
                </span>
                {cek.ringkasan}
              </p>
              {cek.temuan_berkas.length > 0 ? (
                <ol className="mt-4 space-y-3">
                  {cek.temuan_berkas.map((t) => (
                    <TemuanItem key={t.id} t={t} bisaVerifikasi={bisaVerifikasi} namaStaf={namaStaf} onBerubah={onBerubah} />
                  ))}
                </ol>
              ) : null}
              <p className="mt-3 font-mono text-[0.7rem] text-muted-foreground">
                Diperiksa {cek.selesai_at ? waktuWIB(cek.selesai_at) : ""} · hasil AI perlu dikonfirmasi panitia
              </p>
            </>
          )}
        </div>
      ) : null}
    </article>
  );
}

function TemuanItem({
  t,
  bisaVerifikasi,
  namaStaf,
  onBerubah,
}: {
  t: TemuanRow;
  bisaVerifikasi: boolean;
  namaStaf: Record<string, string>;
  onBerubah: () => Promise<unknown>;
}) {
  const [sibuk, setSibuk] = useState(false);
  const [catatan, setCatatan] = useState(t.catatan_panitia ?? "");
  const keputusan = t.keputusan as KeputusanTemuan;
  const tingkat = t.tingkat as TingkatTemuan;

  async function simpan(patch: { keputusan?: KeputusanTemuan; catatan_panitia?: string | null }) {
    setSibuk(true);
    const { error } = await supabase.from("temuan_berkas").update(patch).eq("id", t.id);
    if (error) toast.error(pesanError(error));
    await onBerubah();
    setSibuk(false);
  }

  return (
    <li
      className={cn(
        "border-l-2 bg-card px-4 py-3",
        keputusan === "diabaikan"
          ? "border-border opacity-70"
          : keputusan === "dikonfirmasi"
            ? "border-destructive"
            : tingkat === "tinggi"
              ? "border-clay"
              : "border-sand",
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="eyebrow text-muted-foreground">
          {kategoriLabel[t.kategori as KategoriTemuan] ?? t.kategori} · tingkat {tingkatLabel[tingkat]?.toLowerCase()}
        </p>
        <p
          className={cn(
            "eyebrow",
            keputusan === "dikonfirmasi" ? "text-destructive" : keputusan === "diabaikan" ? "text-muted-foreground" : "text-clay",
          )}
        >
          {keputusanLabel[keputusan]}
          {t.ditinjau_oleh && keputusan !== "menunggu" ? ` · ${namaStaf[t.ditinjau_oleh] ?? "Panitia"}` : ""}
        </p>
      </div>
      <p className={cn("mt-1.5 font-medium", keputusan === "diabaikan" && "line-through decoration-1")}>{t.judul}</p>
      {t.detail ? <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t.detail}</p> : null}

      {bisaVerifikasi ? (
        keputusan === "menunggu" ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" disabled={sibuk} onClick={() => simpan({ keputusan: "dikonfirmasi" })}>
              <Check /> Benar, konfirmasi
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={sibuk} onClick={() => simpan({ keputusan: "diabaikan" })}>
              <X /> Keliru, abaikan
            </Button>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            {keputusan === "dikonfirmasi" ? (
              <TextInput
                aria-label={`Catatan temuan: ${t.judul}`}
                placeholder="Catatan untuk pendaftar (opsional)"
                value={catatan}
                maxLength={500}
                onChange={(e) => setCatatan(e.target.value)}
                onBlur={() => {
                  if ((t.catatan_panitia ?? "") !== catatan.trim()) void simpan({ catatan_panitia: catatan.trim() || null });
                }}
                className="h-9 text-sm sm:flex-1"
              />
            ) : null}
            <Button type="button" size="sm" variant="ghost" disabled={sibuk} onClick={() => simpan({ keputusan: "menunggu" })}>
              <RotateCcw /> Batalkan keputusan
            </Button>
          </div>
        )
      ) : null}
    </li>
  );
}
