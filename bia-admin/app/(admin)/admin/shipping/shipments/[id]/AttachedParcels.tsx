"use client";

// Attached-parcels table. Lists the parcels on this batch with a link, status
// pill and weight. The per-row "移出" (detach, SR-7) button shows only when the
// parcel is `in_transit` and `canDetach` (batch still at the warehouse); the
// confirm + POST /detach live in the page (`onDetach`) so they flip the shared
// `saving`. Rendered only when there is at least one parcel.
//
// Header last reviewed: 2026-07-07

import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ParcelStatusPill } from "@/components/shipping/ParcelStatusPill";
import { type Parcel } from "@biboyang425/bia-shared/shipping";

export function AttachedParcels({
  parcels,
  canDetach,
  saving,
  onDetach,
}: {
  parcels: Parcel[];
  canDetach: boolean;
  saving: boolean;
  onDetach: (p: Parcel) => Promise<void> | void;
}) {
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="px-4">Member</TableHead>
            <TableHead className="px-4">Description</TableHead>
            <TableHead className="w-32 px-4">Status</TableHead>
            <TableHead className="w-24 px-4">重量</TableHead>
            {canDetach && <TableHead className="w-20 px-4"></TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {parcels.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="px-4 py-2">
                <Link
                  href={`/admin/shipping/parcels/${p.id}`}
                  className="font-medium hover:underline"
                >
                  {p.member_id}
                </Link>
              </TableCell>
              <TableCell className="max-w-[220px] truncate px-4 py-2">
                {p.description}
              </TableCell>
              <TableCell className="px-4 py-2">
                <ParcelStatusPill status={p.status} size="sm" />
              </TableCell>
              <TableCell className="px-4 py-2 text-xs text-muted-foreground">
                {p.weight_grams
                  ? `${(p.weight_grams / 1000).toFixed(1)} kg`
                  : "—"}
              </TableCell>
              {canDetach && (
                <TableCell className="px-4 py-2">
                  {p.status === "in_transit" && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={saving}
                      onClick={() => void onDetach(p)}
                    >
                      移出
                    </Button>
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
