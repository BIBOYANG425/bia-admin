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
    // Invite-only console: never auto-mint an auth.users row for an arbitrary
    // email. Already-invited users are recognized in /auth/callback, which
    // accepts the pending invitation via the accept_invitation RPC. A
    // not-yet-invited email simply gets "user not found" (we surface the same
    // not-on-the-list guidance below regardless).
    const { error } = await supa.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${origin}/auth/callback`,
        shouldCreateUser: false,
      },
    });
    setSubmitting(false);
    if (error) {
      // With shouldCreateUser:false, Supabase reports a not-yet-invited email as
      // an "otp_disabled" / "user not found" style error. Don't leak that raw
      // string — show the same role-neutral "not on the invite list" guidance.
      const code = (error as { code?: string }).code;
      if (
        code === "otp_disabled" ||
        /signups? not allowed|not found/i.test(error.message)
      ) {
        toast.error(
          "That email is not on the admin invite list. Ask a BIA super-admin to invite you. / 该邮箱不在管理员邀请名单中，请联系 BIA 超级管理员添加。",
        );
        return;
      }
      toast.error(error.message);
      return;
    }
    toast.success("Check your inbox for the magic link. / 请查收邮箱中的登录链接。");
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
          That email is not on the admin invite list. Ask a BIA super-admin to
          invite you.
          <span className="block text-muted-foreground">
            该邮箱不在管理员邀请名单中，请联系 BIA 超级管理员为你添加。
          </span>
        </div>
      )}

      {denied === "invite_failed" && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          We found your invitation but couldn&apos;t finish setting up your
          account. Please try the link again. If it keeps failing, ask a BIA
          super-admin to re-send your invite.
          <span className="block text-muted-foreground">
            我们找到了你的邀请，但未能完成账号创建。请重新点击登录链接重试；如果仍然失败，请联系
            BIA 超级管理员重新发送邀请。
          </span>
        </div>
      )}

      {denied === "auth_error" && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Authentication failed. Please try again.
          <span className="block text-muted-foreground">
            登录验证失败，请重试。
          </span>
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
