import { statusLabel, type StatusPendaftaran } from "@/lib/pendaftaran-rules";
import { cn } from "@/lib/utils";

export function StatusPill({ status }: { status: StatusPendaftaran }) {
  const tone =
    status === "perlu_perbaikan" || status === "tidak_diterima"
      ? "border-destructive/40 text-destructive"
      : status === "draf"
        ? "border-border text-muted-foreground"
        : "border-primary/40 text-primary";
  return <span className={cn("inline-flex items-center rounded-sm border px-2.5 py-1 eyebrow", tone)}>{statusLabel[status]}</span>;
}
