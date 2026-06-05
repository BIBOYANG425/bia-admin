// /api/admin/users/[id]
// GET — full student + email (auth.users) + parcels (with by-status counts) +
// course_reviews (gracefully null if that table isn't deployed). Read-only (viewer+).
// Ported from bia-roommate (Phase-3 slice 3a · users migration):
// adminHandler -> withRole, createAdminSupabaseClient -> createBiaServiceRoleClient.

import { NextResponse } from "next/server";
import { createBiaServiceRoleClient } from "@biboyang425/bia-shared/supabase/service-role";
import type { ParcelStatus } from "@biboyang425/bia-shared/shipping";
import { withRole } from "@/lib/auth/require-role";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, ctx: RouteContext) {
  return withRole("viewer", async () => {
    const { id } = await ctx.params;
    const admin = createBiaServiceRoleClient();

    const { data: student, error } = await admin
      .from("students")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: "lookup_failed", details: error.message },
        { status: 500 },
      );
    }
    if (!student) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    let email: string | null = null;
    if (student.user_id) {
      const { data: authUser } = await admin.auth.admin.getUserById(
        student.user_id,
      );
      email = authUser.user?.email ?? null;
    }

    const parcelsRes = student.user_id
      ? await admin
          .from("parcels")
          .select("*")
          .eq("user_id", student.user_id)
          .order("created_at", { ascending: false })
      : { data: [], error: null };

    // course_reviews may not be deployed to this DB; catch missing-table softly.
    const reviewsRes = student.user_id
      ? await admin
          .from("course_reviews")
          .select("*")
          .eq("user_id", student.user_id)
          .order("created_at", { ascending: false })
      : { data: [], error: null };

    const parcels = parcelsRes.data ?? [];
    const parcelsByStatus = {} as Record<ParcelStatus, number>;
    for (const p of parcels as { status: ParcelStatus }[]) {
      parcelsByStatus[p.status] = (parcelsByStatus[p.status] ?? 0) + 1;
    }

    const reviews = reviewsRes.error ? null : reviewsRes.data ?? [];
    const reviewsUnavailable =
      reviewsRes.error?.message?.includes("does not exist") ?? false;

    return NextResponse.json({
      student,
      email,
      parcels,
      parcelsByStatus,
      reviews,
      reviewsUnavailable,
    });
  });
}
