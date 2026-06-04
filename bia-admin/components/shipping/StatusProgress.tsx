// Generic horizontal status stepper — parcels (5 steps), shipments (8 steps),
// or any linear lifecycle. Branch statuses (lost/returned) render as a single
// off-path node on the right. Server-safe (no hooks). shadcn-flavored colors.

interface Step {
  key: string;
  label: string;
}

interface Props {
  steps: Step[];
  current: string;
  /** End-states that aren't on the happy path (e.g. lost/returned). */
  branches?: Step[];
}

export function StatusProgress({ steps, current, branches }: Props) {
  const currentIdx = steps.findIndex((s) => s.key === current);
  const onBranch = branches?.some((b) => b.key === current) ?? false;

  return (
    <div className="w-full overflow-x-auto">
      <ol className="flex min-w-max items-start gap-0">
        {steps.map((step, i) => {
          const past = !onBranch && currentIdx > i;
          const active = !onBranch && currentIdx === i;
          const circle = past
            ? "border-emerald-600 bg-emerald-600 text-white"
            : active
              ? "border-amber-500 bg-amber-100 text-amber-900"
              : "border-zinc-300 bg-white text-zinc-400";
          const connector = past ? "bg-emerald-600" : "bg-zinc-200";
          return (
            <li key={step.key} className="flex min-w-[72px] flex-1 items-start">
              <div className="flex w-full flex-col items-center">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-full border text-sm font-medium ${circle}`}
                >
                  {past ? "✓" : i + 1}
                </div>
                <p
                  className={`mt-1 px-1 text-center text-[11px] leading-tight ${
                    active
                      ? "font-semibold text-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  {step.label}
                </p>
              </div>
              {i < steps.length - 1 && (
                <div
                  className={`mt-4 h-0.5 flex-1 ${connector}`}
                  style={{ minWidth: "12px" }}
                />
              )}
            </li>
          );
        })}

        {onBranch && branches && (
          <li className="ml-3 flex items-start border-l border-zinc-300 pl-3">
            <div className="flex flex-col items-center">
              <div className="flex h-9 w-9 items-center justify-center rounded-full border border-rose-600 bg-rose-600 text-sm font-medium text-white">
                !
              </div>
              <p className="mt-1 px-1 text-center text-[11px] font-semibold leading-tight text-rose-700">
                {branches.find((b) => b.key === current)?.label ?? current}
              </p>
            </div>
          </li>
        )}
      </ol>
    </div>
  );
}
