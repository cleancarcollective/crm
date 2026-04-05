type StatusBadgeProps = {
  status: string;
};

const STATUS_CLASS_MAP: Record<string, string> = {
  confirmed: "statusBadge statusConfirmed",
  pending: "statusBadge statusPending",
  completed: "statusBadge statusCompleted",
  cancelled: "statusBadge statusCancelled",
  no_show: "statusBadge statusCancelled",
  reminder_sent: "statusBadge statusInfo"
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const className = STATUS_CLASS_MAP[status] ?? "statusBadge statusInfo";

  return <span className={className}>{status.replaceAll("_", " ")}</span>;
}
