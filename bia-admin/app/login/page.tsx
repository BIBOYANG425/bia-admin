import { Suspense } from "react";
import Link from "next/link";
import SignInForm from "@/components/auth/SignInForm";

export default function LoginPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6">
      <Suspense>
        <SignInForm />
      </Suspense>
      <Link
        href="/privacy"
        className="mt-8 text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
      >
        Privacy notice · 隐私声明
      </Link>
    </main>
  );
}
