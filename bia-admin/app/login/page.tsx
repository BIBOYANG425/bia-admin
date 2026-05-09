import { Suspense } from "react";
import SignInForm from "@/components/auth/SignInForm";

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <Suspense>
        <SignInForm />
      </Suspense>
    </main>
  );
}
