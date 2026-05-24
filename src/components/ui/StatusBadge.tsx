// src/components/ui/StatusBadge.tsx

interface StatusBadgeProps {
  status?: string | null;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const displayStatus = status?.trim() || "Unknown";
  const normalized = displayStatus.toLowerCase();

  let className = "badge badge-blue";

  if (
    normalized.includes("confirm") ||
    normalized.includes("accepted") ||
    normalized.includes("complete") ||
    normalized.includes("generated") ||
    normalized.includes("assigned") ||
    normalized === "yes"
  ) {
    className = "badge badge-green";
  }

  if (
    normalized.includes("pending") ||
    normalized.includes("incomplete") ||
    normalized.includes("not generated") ||
    normalized.includes("not confirmed") ||
    normalized.includes("tbc") ||
    normalized === "no"
  ) {
    className = "badge badge-amber";
  }

  if (
    normalized.includes("reject") ||
    normalized.includes("error") ||
    normalized.includes("failed") ||
    normalized.includes("missing") ||
    normalized.includes("empty")
  ) {
    className = "badge badge-red";
  }

  return <span className={className}>{displayStatus}</span>;
}
