"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the error for debugging; the boundary keeps the shell intact.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">出错了</h2>
        <p className="text-sm text-muted-foreground">
          页面加载失败，请重试。
          {error.digest ? (
            <span className="ml-1 font-mono text-xs">({error.digest})</span>
          ) : null}
        </p>
      </div>
      <Button onClick={reset}>重试</Button>
    </div>
  );
}
