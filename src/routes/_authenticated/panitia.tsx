import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";
import { peranQuery, isStaff, bisaMemverifikasi } from "@/lib/panitia";

export const Route = createFileRoute("/_authenticated/panitia")({
  beforeLoad: async ({ context }) => {
    const peran = await context.queryClient.ensureQueryData(peranQuery(context.user.id));
    if (!isStaff(peran)) throw redirect({ to: "/akun" });
    return { peran, bisaVerifikasi: bisaMemverifikasi(peran) };
  },
  head: () => ({
    meta: [
      { title: "Panel Panitia — PPDB Bina Insani" },
      { name: "description", content: "Verifikasi pendaftaran dan berkas calon santri Bina Insani." },
      { property: "og:title", content: "Panel Panitia — PPDB Bina Insani" },
      { property: "og:description", content: "Meja verifikasi panitia PPDB Bina Insani." },
      { property: "og:type", content: "website" },
      { name: "robots", content: "noindex" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PanitiaLayout,
});

function PanitiaLayout() {
  const { bisaVerifikasi } = Route.useRouteContext();
  return (
    <div>
      <div className="border-b border-border bg-ink text-ink-foreground print:hidden">
        <div className="container-page flex flex-wrap items-center justify-between gap-3 py-3">
          <Link to="/panitia" className="eyebrow">
            Panel panitia <span className="mx-2 text-ink-muted">/</span> Verifikasi pendaftaran
          </Link>
          <span className="eyebrow text-ink-muted">{bisaVerifikasi ? "Akses panitia" : "Akses baca (pimpinan)"}</span>
        </div>
      </div>
      <Outlet />
    </div>
  );
}
