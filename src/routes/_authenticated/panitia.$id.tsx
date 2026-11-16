import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, Sparkles, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormAlert, TextArea } from "@/components/site/form";
import { StatusPill } from "@/components/site/StatusPill";
import { BerkasTinjau } from "@/components/panitia/BerkasTinjau";
import { supabase } from "@/integrations/supabase/client";
import { pesanError } from "@/lib/akun";
import { detailPendaftarQuery, type DetailPendaftar } from "@/lib/panitia";
import { periksaBerkas } from "@/lib/panitia.functions";
import { jenisBerkasQuery } from "@/lib/ppdb-queries";
import { tanggalPanjang } from "@/lib/gelombang";
import {
  alasanTolakVerifikasi,
  MAKS_CATATAN,
  pemeriksaanMacet,
  susunCatatanDariTemuan,
  temuanTerbuka,
  type KeputusanTemuan,
} from "@/lib/pemeriksaan-rules";
import { statusLabel, tampilNomorHp, type StatusPendaftaran } from "@/lib/pendaftaran-rules";
import { waktuWIB } from "@/lib/waktu";

export const Route = createFileRoute("/_authenticated/panitia/$id")({
  component: DetailPage,
});

function DetailPage() {
  const { id } = Route.useParams();
  const { bisaVerifikasi } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const q = useQuery({
    ...detailPendaftarQuery(id),
    // Keep polling while an AI check is running.
    refetchInterval: (query) =>
      query.state.data?.pemeriksaan.some((p) => p.status === "memproses" && !pemeriksaanMacet(p)) ? 4000 : false,
  });
  const jenis = useQuery(jenisBerkasQuery);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["panitia", "pendaftar", id] }),
      queryClient.invalidateQueries({ queryKey: ["panitia", "pendaftar"], exact: true }),
    ]);

  if (q.isPending || jenis.isPending) return <div className="container-page py-20 eyebrow text-muted-foreground">Memuat…</div>;
  if (q.isError) return <div className="container-page py-16"><FormAlert>{pesanError(q.error)}</FormAlert></div>;
  if (!q.data)
    return (
      <div className="container-page py-16">
        <FormAlert tone="info">Pendaftaran tidak ditemukan.</FormAlert>
      </div>
    );

  return <Detail d={q.data} jenisList={jenis.data ?? []} bisaVerifikasi={bisaVerifikasi} refresh={refresh} />;
}

function Detail({
  d,
  jenisList,
  bisaVerifikasi,
  refresh,
}: {
  d: DetailPendaftar;
  jenisList: { kode: string; nama: string; wajib: boolean }[];
  bisaVerifikasi: boolean;
  refresh: () => Promise<unknown>;
}) {
  const p = d.pendaftaran;
  const status = p.status as StatusPendaftaran;
  const berkas = p.berkas_pendaftaran ?? [];
  const periksa = useServerFn(periksaBerkas);
  const [periksaSemua, setPeriksaSemua] = useState(false);

  // Active requirements, plus any uploaded kind no longer listed publicly.
  const daftarJenis = [
    ...jenisList,
    ...berkas.filter((b) => !jenisList.some((j) => j.kode === b.kode)).map((b) => ({ kode: b.kode, nama: b.kode.toUpperCase(), wajib: false })),
  ];
  const namaBerkas = (kode: string) => daftarJenis.find((j) => j.kode === kode)?.nama ?? kode;

  // Only findings on the current version of each file count.
  const pemeriksaanAktif = d.pemeriksaan.filter((x) => berkas.some((b) => b.id === x.berkas_id && b.storage_path === x.storage_path));
  const semuaTemuan = pemeriksaanAktif.flatMap((x) => x.temuan_berkas).map((t) => ({ ...t, keputusan: t.keputusan as KeputusanTemuan }));
  const belumDiperiksa = berkas.filter((b) => {
    const x = pemeriksaanAktif.find((y) => y.berkas_id === b.id);
    return !x || x.status === "gagal" || pemeriksaanMacet(x);
  });

  async function jalankanSemua() {
    setPeriksaSemua(true);
    let gagal = 0;
    // One at a time keeps the AI request rate gentle.
    for (const b of belumDiperiksa) {
      try {
        const r = await periksa({ data: { berkasId: b.id } });
        if (r.status === "gagal") gagal++;
      } catch {
        gagal++;
      }
      await refresh();
    }
    setPeriksaSemua(false);
    if (gagal) toast.error(`${gagal} berkas gagal diperiksa. Lihat keterangannya di tiap berkas.`);
    else toast.success("Semua berkas selesai diperiksa AI.");
  }

  const data: [string, string | number | null][] = [
    ["Nama lengkap", p.nama_lengkap],
    ["NIK", p.nik],
    ["Tempat, tanggal lahir", [p.tempat_lahir, p.tanggal_lahir ? tanggalPanjang(p.tanggal_lahir) : null].filter(Boolean).join(", ")],
    ["Jenis kelamin", p.jenis_kelamin === "L" ? "Laki-laki" : p.jenis_kelamin === "P" ? "Perempuan" : null],
    ["Alamat", p.alamat],
    ["Perguruan tinggi", p.kampus],
    ["Program studi", [p.prodi, p.semester ? `semester ${p.semester}` : null].filter(Boolean).join(", ")],
    ["NIM", p.nim],
    ["Orang tua / wali", [p.wali_nama, p.wali_hubungan ? `(${p.wali_hubungan})` : null].filter(Boolean).join(" ")],
    ["Telepon wali", p.wali_telepon ? tampilNomorHp(p.wali_telepon) : null],
  ];

  return (
    <div className="container-page py-10 md:py-14">
      <Link to="/panitia" className="inline-flex items-center gap-2 text-sm link-quiet">
        <ArrowLeft className="size-4" /> Semua pendaftar
      </Link>

      <header className="mt-8 grid gap-6 border-b border-foreground/80 pb-8 md:grid-cols-12 md:items-end">
        <div className="md:col-span-8">
          <p className="font-mono text-sm text-muted-foreground">{p.nomor_pendaftaran ?? "Belum bernomor"}</p>
          <h1 className="mt-2 font-display-tight text-4xl md:text-5xl">{p.nama_lengkap || "Tanpa nama"}</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {p.gelombang?.nama} · {p.tahun_ajaran}
            {p.diajukan_at ? ` · diajukan ${waktuWIB(p.diajukan_at)}` : ""}
            {d.akun ? ` · ${d.akun.email}` : ""}
            {d.akun?.whatsapp ? ` · WA ${tampilNomorHp(d.akun.whatsapp)}` : ""}
          </p>
        </div>
        <div className="md:col-span-4 md:text-right">
          <StatusPill status={status} />
        </div>
      </header>

      <div className="mt-4 grid gap-12 lg:grid-cols-12">
        <section className="lg:col-span-7" aria-labelledby="judul-berkas">
          <div className="flex flex-wrap items-center justify-between gap-4 pt-6">
            <h2 id="judul-berkas" className="eyebrow text-muted-foreground">
              Berkas · {temuanTerbuka(semuaTemuan)} temuan terbuka
            </h2>
            {bisaVerifikasi && belumDiperiksa.length > 0 ? (
              <Button type="button" size="sm" variant="outline" onClick={jalankanSemua} disabled={periksaSemua}>
                <Sparkles /> {periksaSemua ? "Memeriksa…" : `Periksa ${belumDiperiksa.length} berkas dengan AI`}
              </Button>
            ) : null}
          </div>
          <div>
            {daftarJenis.map((j) => {
              const b = berkas.find((x) => x.kode === j.kode);
              if (!b && !j.wajib) return null;
              return (
                <BerkasTinjau
                  key={j.kode}
                  nama={j.nama}
                  wajib={j.wajib}
                  berkas={b}
                  pemeriksaan={b ? d.pemeriksaan.find((x) => x.berkas_id === b.id) : undefined}
                  bisaVerifikasi={bisaVerifikasi}
                  namaStaf={d.namaStaf}
                  onBerubah={refresh}
                />
              );
            })}
          </div>
        </section>

        <aside className="space-y-10 lg:col-span-5 lg:pt-6">
          <section aria-labelledby="judul-data">
            <h2 id="judul-data" className="eyebrow text-muted-foreground">
              Data formulir
            </h2>
            <dl className="mt-4 border-t border-border">
              {data.map(([k, v]) => (
                <div key={k} className="grid grid-cols-[9rem_1fr] gap-3 border-b border-border py-2.5 text-sm">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className={k === "NIK" || k === "NIM" ? "font-mono" : undefined}>{v || <span className="text-muted-foreground">—</span>}</dd>
                </div>
              ))}
            </dl>
          </section>

          <Keputusan
            id={p.id}
            status={status}
            catatanSekarang={p.catatan_panitia}
            temuan={semuaTemuan}
            namaBerkas={namaBerkas}
            bisaVerifikasi={bisaVerifikasi}
            refresh={refresh}
          />

          {d.riwayat.length > 0 ? (
            <section aria-labelledby="judul-riwayat">
              <h2 id="judul-riwayat" className="eyebrow text-muted-foreground">
                Riwayat verifikasi
              </h2>
              <ol className="mt-4 border-t border-border">
                {d.riwayat.map((r) => (
                  <li key={r.id} className="border-b border-border py-3 text-sm">
                    <p>
                      <span className="font-medium">{statusLabel[r.status_baru as StatusPendaftaran]}</span>
                      <span className="text-muted-foreground"> · {d.namaStaf[r.oleh] ?? "Panitia"} · {waktuWIB(r.created_at)}</span>
                    </p>
                    {r.catatan ? <p className="mt-1 whitespace-pre-line text-muted-foreground">{r.catatan}</p> : null}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function Keputusan({
  id,
  status,
  catatanSekarang,
  temuan,
  namaBerkas,
  bisaVerifikasi,
  refresh,
}: {
  id: string;
  status: StatusPendaftaran;
  catatanSekarang: string | null;
  temuan: { keputusan: KeputusanTemuan; kode_berkas: string; judul: string; catatan_panitia: string | null }[];
  namaBerkas: (kode: string) => string;
  bisaVerifikasi: boolean;
  refresh: () => Promise<unknown>;
}) {
  const [catatan, setCatatan] = useState("");
  const [galat, setGalat] = useState<string | null>(null);
  const bisaDiputus = status === "menunggu_verifikasi" || status === "terverifikasi";

  const putuskan = useMutation({
    mutationFn: async (k: "terverifikasi" | "perlu_perbaikan") => {
      const alasan = alasanTolakVerifikasi(k, catatan, temuan);
      if (alasan) throw new Error(alasan);
      const { error } = await supabase.rpc("verifikasi_pendaftaran", { _id: id, _status: k, _catatan: catatan.trim() });
      if (error) throw error;
      return k;
    },
    onMutate: () => setGalat(null),
    onSuccess: async (k) => {
      setCatatan("");
      await refresh();
      toast.success(k === "terverifikasi" ? "Pendaftaran ditandai terverifikasi." : "Catatan perbaikan terkirim ke pendaftar.");
    },
    onError: (e) => setGalat(pesanError(e)),
  });

  const saran = susunCatatanDariTemuan(temuan, namaBerkas);

  return (
    <section aria-labelledby="judul-keputusan" className="border border-foreground/80 bg-card p-6">
      <h2 id="judul-keputusan" className="eyebrow text-muted-foreground">
        Keputusan verifikasi
      </h2>

      {status === "perlu_perbaikan" ? (
        <div className="mt-4">
          <p className="font-display text-2xl">Menunggu perbaikan dari pendaftar.</p>
          {catatanSekarang ? (
            <p className="mt-3 whitespace-pre-line border-l-2 border-destructive pl-4 text-sm leading-relaxed">{catatanSekarang}</p>
          ) : null}
          <p className="mt-3 text-sm text-muted-foreground">Pendaftaran akan kembali ke antrean setelah pendaftar mengajukan ulang.</p>
        </div>
      ) : !bisaDiputus ? (
        <p className="mt-4 text-sm text-muted-foreground">Pendaftaran berstatus {statusLabel[status]} dan tidak lagi di tahap verifikasi.</p>
      ) : !bisaVerifikasi ? (
        <p className="mt-4 text-sm text-muted-foreground">Hanya panitia yang dapat memutuskan verifikasi.</p>
      ) : (
        <div className="mt-4 space-y-4">
          {status === "terverifikasi" ? (
            <p className="flex items-center gap-2 text-sm text-primary">
              <CheckCircle2 className="size-4" /> Sudah terverifikasi. Anda masih bisa meminta perbaikan bila ada yang terlewat.
            </p>
          ) : null}
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor="catatan-perbaikan" className="text-sm font-medium">
                Catatan untuk pendaftar
              </label>
              {saran ? (
                <button type="button" className="text-sm link-quiet" onClick={() => setCatatan(saran)}>
                  Isi dari temuan dikonfirmasi
                </button>
              ) : null}
            </div>
            <TextArea
              id="catatan-perbaikan"
              rows={5}
              maxLength={MAKS_CATATAN}
              value={catatan}
              onChange={(e) => setCatatan(e.target.value)}
              placeholder="Contoh: Nama pada KTM berbeda dengan formulir. Unggah KTM atau surat aktif kuliah atas nama Anda."
            />
            <p className="text-xs text-muted-foreground">Wajib diisi bila meminta perbaikan. Pendaftar melihat catatan ini di halaman status.</p>
          </div>
          {galat ? <FormAlert>{galat}</FormAlert> : null}
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="destructive" disabled={putuskan.isPending} onClick={() => putuskan.mutate("perlu_perbaikan")}>
              <Undo2 /> Minta perbaikan
            </Button>
            {status === "menunggu_verifikasi" ? (
              <Button type="button" disabled={putuskan.isPending} onClick={() => putuskan.mutate("terverifikasi")}>
                <CheckCircle2 /> Tandai terverifikasi
              </Button>
            ) : null}
          </div>
          {status === "menunggu_verifikasi" && temuanTerbuka(temuan) > 0 ? (
            <p className="text-xs text-muted-foreground">
              Tandai terverifikasi setelah semua temuan AI ditinjau dan tidak ada yang dikonfirmasi.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
