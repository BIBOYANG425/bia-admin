"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createBiaBrowserClient } from "@biboyang425/bia-shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

// Dev-only password sign-in. Read at module scope so the bundler can tree-shake
// the password form out of production builds when the flag is unset.
const DEV_AUTH_ENABLED = process.env.NEXT_PUBLIC_DEV_AUTH === "true";

export default function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
        redirectTo: `${origin}/auth/callback`,
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
        emailRedirectTo: `${origin}/auth/callback`,
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

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    const supa = createBiaBrowserClient();
    setSubmitting(true);
    const { error } = await supa.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    // Sign-in OK; the cookie session is set on the supabase client.
    // Navigate into the admin app — middleware will revalidate the cookie.
    router.push(returnTo);
    router.refresh();
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

      {DEV_AUTH_ENABLED && (
        <>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <hr className="flex-1" />
            <span>dev-only</span>
            <hr className="flex-1" />
          </div>

          <form onSubmit={signInWithPassword} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="password"
                autoComplete="current-password"
              />
            </div>
            <Button
              type="submit"
              disabled={submitting || !email || !password}
              variant="secondary"
              className="w-full"
            >
              Sign in with password
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Dev-only path. Hidden when <code className="font-mono">NEXT_PUBLIC_DEV_AUTH</code> is unset.
            </p>
          </form>
        </>
      )}
    </div>
  );
}
