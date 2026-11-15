-- ===== Requirement guide per document kind =====
ALTER TABLE public.jenis_berkas ADD COLUMN panduan_pemeriksaan text;
UPDATE public.jenis_berkas SET panduan_pemeriksaan = CASE kode
  WHEN 'ktp' THEN 'KTP elektronik milik pendaftar sendiri. Nama, NIK, tempat dan tanggal lahir, serta jenis kelamin harus sama dengan formulir. Sisi depan terlihat utuh, tidak terpotong, tidak buram, tulisan terbaca.'
  WHEN 'ktm' THEN 'Kartu Tanda Mahasiswa atau surat keterangan aktif kuliah atas nama pendaftar. Nama, NIM, perguruan tinggi, dan program studi harus sama dengan formulir. Surat keterangan harus lengkap seluruh halamannya, bertanggal, serta memuat tanda tangan dan stempel kampus.'
  WHEN 'foto' THEN 'Pas foto 3x4 pendaftar seorang diri, wajah menghadap depan dan terlihat jelas, latar polos, berpakaian rapi. Bukan foto dokumen, bukan foto bersama, bukan tangkapan layar.'
  WHEN 'kk' THEN 'Kartu Keluarga yang mencantumkan pendaftar sebagai anggota keluarga dengan nama dan NIK yang sama dengan formulir. Seluruh lembar terlihat utuh, termasuk bagian bawah berisi tanggal penerbitan dan tanda tangan pejabat.'
  WHEN 'sertifikat' THEN 'Sertifikat tahfidz atau prestasi atas nama pendaftar. Nama harus sama dengan formulir. Seluruh halaman terlihat, penerbit dan tanggal jelas.'
  ELSE NULL END;

-- ===== Enums =====
CREATE TYPE public.status_pemeriksaan AS ENUM ('memproses', 'selesai', 'gagal');
CREATE TYPE public.keputusan_temuan AS ENUM ('menunggu', 'dikonfirmasi', 'diabaikan');

-- ===== AI check per uploaded file =====
CREATE TABLE public.pemeriksaan_berkas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  berkas_id uuid NOT NULL UNIQUE REFERENCES public.berkas_pendaftaran(id) ON DELETE CASCADE,
  pendaftaran_id uuid NOT NULL REFERENCES public.pendaftaran(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  status public.status_pemeriksaan NOT NULL DEFAULT 'memproses',
  sesuai boolean,
  ringkasan text,
  kode_galat text,
  pesan_galat text,
  model text,
  dimulai_at timestamptz NOT NULL DEFAULT now(),
  selesai_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pemeriksaan_berkas_pendaftaran_idx ON public.pemeriksaan_berkas (pendaftaran_id);
GRANT SELECT ON public.pemeriksaan_berkas TO authenticated;
GRANT ALL ON public.pemeriksaan_berkas TO service_role;
ALTER TABLE public.pemeriksaan_berkas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read pemeriksaan" ON public.pemeriksaan_berkas
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

-- ===== AI findings, confirmed or dismissed by staff =====
CREATE TABLE public.temuan_berkas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pemeriksaan_id uuid NOT NULL REFERENCES public.pemeriksaan_berkas(id) ON DELETE CASCADE,
  pendaftaran_id uuid NOT NULL REFERENCES public.pendaftaran(id) ON DELETE CASCADE,
  kode_berkas text NOT NULL,
  kategori text NOT NULL CHECK (kategori IN ('nama_tidak_cocok', 'data_tidak_cocok', 'halaman_kurang', 'dokumen_salah', 'tidak_terbaca', 'tidak_lengkap', 'lainnya')),
  tingkat text NOT NULL DEFAULT 'sedang' CHECK (tingkat IN ('tinggi', 'sedang', 'rendah')),
  judul text NOT NULL,
  detail text NOT NULL DEFAULT '',
  urutan smallint NOT NULL DEFAULT 0,
  keputusan public.keputusan_temuan NOT NULL DEFAULT 'menunggu',
  catatan_panitia text,
  ditinjau_oleh uuid,
  ditinjau_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX temuan_berkas_pendaftaran_idx ON public.temuan_berkas (pendaftaran_id);
CREATE INDEX temuan_berkas_pemeriksaan_idx ON public.temuan_berkas (pemeriksaan_id);
GRANT SELECT ON public.temuan_berkas TO authenticated;
GRANT UPDATE (keputusan, catatan_panitia) ON public.temuan_berkas TO authenticated;
GRANT ALL ON public.temuan_berkas TO service_role;
ALTER TABLE public.temuan_berkas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read temuan" ON public.temuan_berkas
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "Panitia review temuan" ON public.temuan_berkas
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'panitia') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'panitia') OR public.has_role(auth.uid(), 'super_admin'));

CREATE OR REPLACE FUNCTION public.temuan_before_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  NEW.catatan_panitia := nullif(left(btrim(coalesce(NEW.catatan_panitia, '')), 500), '');
  IF NEW.keputusan IS DISTINCT FROM OLD.keputusan OR NEW.catatan_panitia IS DISTINCT FROM OLD.catatan_panitia THEN
    IF NEW.keputusan = 'menunggu' THEN
      NEW.ditinjau_oleh := NULL;
      NEW.ditinjau_at := NULL;
    ELSE
      NEW.ditinjau_oleh := auth.uid();
      NEW.ditinjau_at := now();
    END IF;
  ELSE
    NEW.ditinjau_oleh := OLD.ditinjau_oleh;
    NEW.ditinjau_at := OLD.ditinjau_at;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER temuan_before_update BEFORE UPDATE ON public.temuan_berkas
  FOR EACH ROW EXECUTE FUNCTION public.temuan_before_update();

-- Replacing a file discards the AI check of the old file.
CREATE OR REPLACE FUNCTION public.berkas_after_replace()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.pemeriksaan_berkas WHERE berkas_id = NEW.id AND storage_path <> NEW.storage_path;
  RETURN NEW;
END;
$$;
CREATE TRIGGER berkas_after_replace AFTER UPDATE OF storage_path ON public.berkas_pendaftaran
  FOR EACH ROW WHEN (OLD.storage_path IS DISTINCT FROM NEW.storage_path)
  EXECUTE FUNCTION public.berkas_after_replace();

-- ===== Verification history =====
CREATE TABLE public.riwayat_verifikasi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pendaftaran_id uuid NOT NULL REFERENCES public.pendaftaran(id) ON DELETE CASCADE,
  status_sebelum public.status_pendaftaran NOT NULL,
  status_baru public.status_pendaftaran NOT NULL,
  catatan text,
  oleh uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX riwayat_verifikasi_pendaftaran_idx ON public.riwayat_verifikasi (pendaftaran_id, created_at DESC);
GRANT SELECT ON public.riwayat_verifikasi TO authenticated;
GRANT ALL ON public.riwayat_verifikasi TO service_role;
ALTER TABLE public.riwayat_verifikasi ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff or owner read riwayat" ON public.riwayat_verifikasi
  FOR SELECT TO authenticated USING (
    public.is_staff(auth.uid())
    OR EXISTS (SELECT 1 FROM public.pendaftaran p WHERE p.id = pendaftaran_id AND p.user_id = auth.uid())
  );

-- ===== Staff may no longer change workflow columns directly =====
CREATE OR REPLACE FUNCTION public.pendaftaran_before_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g public.gelombang;
BEGIN
  NEW.updated_at := now();
  NEW.created_at := OLD.created_at;
  NEW.user_id := OLD.user_id;

  -- Internal transitions (ajukan_pendaftaran, verifikasi_pendaftaran) may change workflow columns.
  IF coalesce(current_setting('ppdb.internal', true), '') = 'on' THEN
    PERFORM public.pendaftaran_validasi_format(NEW);
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.nomor_pendaftaran IS DISTINCT FROM OLD.nomor_pendaftaran
     OR NEW.catatan_panitia IS DISTINCT FROM OLD.catatan_panitia
     OR NEW.diajukan_at IS DISTINCT FROM OLD.diajukan_at THEN
    RAISE EXCEPTION 'Status pendaftaran hanya dapat diubah melalui verifikasi panitia.';
  END IF;

  IF public.has_role(auth.uid(), 'panitia') OR public.has_role(auth.uid(), 'super_admin') THEN
    NEW.tahun_ajaran := OLD.tahun_ajaran;
    NEW.gelombang_id := OLD.gelombang_id;
    PERFORM public.pendaftaran_validasi_format(NEW);
    RETURN NEW;
  END IF;

  IF NEW.gelombang_id IS DISTINCT FROM OLD.gelombang_id THEN
    IF OLD.status <> 'draf' THEN
      RAISE EXCEPTION 'Gelombang tidak dapat diganti setelah pendaftaran diajukan.';
    END IF;
    SELECT * INTO g FROM public.gelombang WHERE id = NEW.gelombang_id;
    IF NOT FOUND OR NOT public.gelombang_dibuka(NEW.gelombang_id) THEN
      RAISE EXCEPTION 'Gelombang yang dipilih sedang tidak dibuka.';
    END IF;
    IF g.tahun_ajaran <> OLD.tahun_ajaran THEN
      RAISE EXCEPTION 'Gelombang harus pada tahun ajaran yang sama.';
    END IF;
  END IF;
  NEW.tahun_ajaran := OLD.tahun_ajaran;

  PERFORM public.pendaftaran_validasi_format(NEW);
  RETURN NEW;
END;
$$;

-- ===== Verification RPC =====
CREATE OR REPLACE FUNCTION public.verifikasi_pendaftaran(_id uuid, _status public.status_pendaftaran, _catatan text)
RETURNS public.pendaftaran LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p public.pendaftaran;
  c text := nullif(btrim(coalesce(_catatan, '')), '');
  terbuka integer;
  sebelum public.status_pendaftaran;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'panitia') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Hanya panitia yang dapat memverifikasi pendaftaran.';
  END IF;
  IF _status NOT IN ('terverifikasi', 'perlu_perbaikan') THEN
    RAISE EXCEPTION 'Keputusan verifikasi tidak valid.';
  END IF;

  SELECT * INTO p FROM public.pendaftaran WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pendaftaran tidak ditemukan.'; END IF;
  IF p.status NOT IN ('menunggu_verifikasi', 'terverifikasi') THEN
    RAISE EXCEPTION 'Pendaftaran ini tidak sedang menunggu verifikasi.';
  END IF;
  IF p.status = _status THEN
    RAISE EXCEPTION 'Pendaftaran ini sudah terverifikasi.';
  END IF;
  IF c IS NOT NULL AND length(c) > 2000 THEN
    RAISE EXCEPTION 'Catatan terlalu panjang (maksimal 2000 karakter).';
  END IF;

  IF _status = 'perlu_perbaikan' AND (c IS NULL OR length(c) < 10) THEN
    RAISE EXCEPTION 'Tulis catatan perbaikan (minimal 10 karakter) agar pendaftar tahu apa yang harus diperbaiki.';
  END IF;

  IF _status = 'terverifikasi' THEN
    SELECT count(*) INTO terbuka FROM public.temuan_berkas t
      WHERE t.pendaftaran_id = p.id AND t.keputusan IN ('menunggu', 'dikonfirmasi');
    IF terbuka > 0 THEN
      RAISE EXCEPTION 'Masih ada % temuan berkas yang belum selesai. Abaikan temuan yang keliru, atau minta perbaikan.', terbuka;
    END IF;
  END IF;

  sebelum := p.status;
  PERFORM set_config('ppdb.internal', 'on', true);
  UPDATE public.pendaftaran
     SET status = _status,
         catatan_panitia = CASE WHEN _status = 'perlu_perbaikan' THEN c ELSE NULL END
   WHERE id = p.id
   RETURNING * INTO p;
  PERFORM set_config('ppdb.internal', 'off', true);

  INSERT INTO public.riwayat_verifikasi (pendaftaran_id, status_sebelum, status_baru, catatan, oleh)
  VALUES (p.id, sebelum, _status, c, auth.uid());
  RETURN p;
END;
$$;
REVOKE ALL ON FUNCTION public.verifikasi_pendaftaran(uuid, public.status_pendaftaran, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verifikasi_pendaftaran(uuid, public.status_pendaftaran, text) TO authenticated;