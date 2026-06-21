// Tiny paid / unpaid pill for the offline-payment roster.

export function PaidPill({ paid }: { paid: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${
        paid
          ? "bg-emerald-100 text-emerald-800"
          : "bg-amber-100 text-amber-800"
      }`}
    >
      {paid ? "已收款" : "待收款"}
    </span>
  );
}
