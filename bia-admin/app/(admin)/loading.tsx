export default function AdminLoading() {
  return (
    <div className="p-8 space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">加载中…</span>
      <div className="h-8 w-48 animate-pulse rounded bg-muted" />
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-12 w-full animate-pulse rounded bg-muted" />
        ))}
      </div>
    </div>
  );
}
