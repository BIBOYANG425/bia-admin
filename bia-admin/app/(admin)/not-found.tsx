import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function AdminNotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">页面不存在</h2>
        <p className="text-sm text-muted-foreground">找不到这个页面。</p>
      </div>
      <Button asChild>
        <Link href="/admin">返回首页</Link>
      </Button>
    </div>
  );
}
