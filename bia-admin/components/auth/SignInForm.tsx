"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { createBiaBrowserClient } from "@bia/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function SignInForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const denied = searchParams.get("denied");
  const returnTo = searchParams.get("return_to") ?? "/admin";

  async function signInWithGoogle() {
    const supa = createBiaBrowserClient();
    const origin = window.location.origin;
    setSubmitting(true);
    const { error } = await supa.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(returnTo)}`,
      },
    });
    if (error) {
      toast.error(error.message);
      setSubmitting(false);
    }
    // On success the browser is redirected to Google.
  }

  async function signInWithMagicLink(e: React.FormEvent) {
    e.preventDefault();
    const supa = createBiaBrowserClient();
    const origin = window.location.origin;
    setSubmitting(true);
    const { error } = await supa.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(returnTo)}`,
        shouldCreateUser: true,
      },
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Check your inbox for the magic link.");
  }

  return (
    <div className="w-full max-w-sm space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">BIA Admin</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Sign in to access the admin dashboard.
        </p>
      </div>

      {denied === "not-invited" && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          That email is not on the admin invite list. Ask Bobby to invite you.
        </div>
      )}

      {denied === "auth_error" && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Authentication failed. Please try again.
        </div>
      )}

      <Button
        onClick={signInWithGoogle}
        disabled={submitting}
        className="w-full"
        variant="outline"
      >
        Continue with Google
      </Button>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <hr className="flex-1" />
        <span>or</span>
        <hr className="flex-1" />
      </div>

      <form onSubmit={signInWithMagicLink} className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>
        <Button type="submit" disabled={submitting || !email} className="w-full">
          Send magic link
        </Button>
      </form>
    </div>
  );
}
