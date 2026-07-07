"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MoreHorizontal, Plus } from "lucide-react";
import type { Role, AdminUser, AdminInvitation } from "@biboyang425/bia-shared";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface Props {
  currentUserId: string;
  currentRole: Role;
  admins: AdminUser[];
  invitations: AdminInvitation[];
}

/** Human-readable age of a pending invite, e.g. "today", "3 days ago". */
function inviteAge(createdAt: string): string {
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return "";
  const days = Math.floor((Date.now() - created) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

/** Human-readable label for each role in the "Set to…" menu. */
const ROLE_LABELS: Record<Role, string> = {
  viewer: "Set to viewer",
  editor: "Set to editor",
  super_admin: "Set to super admin",
};

export default function MembersClient({
  currentUserId,
  currentRole,
  admins,
  invitations,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("viewer");
  const [submitting, setSubmitting] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);

  const canManage = currentRole === "super_admin";

  async function submitInvite(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/members/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "invite_failed");
        return;
      }
      toast.success("Invitation sent");
      setInviteOpen(false);
      setInviteEmail("");
      setInviteRole("viewer");
      startTransition(() => router.refresh());
    } finally {
      setSubmitting(false);
    }
  }

  async function mutate(
    path: string,
    init: RequestInit,
    okMsg: string,
    errFallback = "request_failed"
  ): Promise<void> {
    const res = await fetch(path, init);
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error ?? errFallback);
      return;
    }
    toast.success(okMsg);
    startTransition(() => router.refresh());
  }

  async function changeRole(id: string, role: Role) {
    await mutate(
      `/api/admin/members/${id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      },
      "Role updated",
      "update_failed"
    );
  }

  async function removeAdmin(id: string) {
    await mutate(
      `/api/admin/members/${id}`,
      { method: "DELETE" },
      "Admin removed",
      "delete_failed"
    );
  }

  async function revokeInvitation(id: string) {
    await mutate(
      `/api/admin/members/invitations/${id}`,
      { method: "DELETE" },
      "Invitation revoked",
      "revoke_failed"
    );
  }

  async function resendInvitation(id: string) {
    setResendingId(id);
    try {
      await mutate(
        `/api/admin/members/invitations/${id}`,
        { method: "POST" },
        "Invitation re-sent",
        "resend_failed"
      );
    } finally {
      setResendingId(null);
    }
  }

  return (
    <div className="space-y-8">
      {canManage && (
        <div className="flex justify-end">
          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Invite admin
              </Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={submitInvite}>
                <DialogHeader>
                  <DialogTitle>Invite a new admin</DialogTitle>
                  <DialogDescription>
                    They will receive an email with a sign-in link.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="invite-email">Email</Label>
                    <Input
                      id="invite-email"
                      type="email"
                      required
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="officer@example.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="invite-role">Role</Label>
                    <Select
                      value={inviteRole}
                      onValueChange={(v) => setInviteRole(v as Role)}
                    >
                      <SelectTrigger id="invite-role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="viewer">Viewer</SelectItem>
                        <SelectItem value="editor">Editor</SelectItem>
                        <SelectItem value="super_admin">
                          Super admin
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setInviteOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? "Sending..." : "Send invitation"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Active admins</CardTitle>
          <CardDescription>
            {admins.length} {admins.length === 1 ? "admin" : "admins"} with
            dashboard access.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {admins.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.email}</TableCell>
                  <TableCell>{a.role}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(a.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    {canManage && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">Open menu</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {(
                            ["viewer", "editor", "super_admin"] as Role[]
                          ).map((role) => (
                            <DropdownMenuItem
                              key={role}
                              disabled={
                                a.id === currentUserId || a.role === role
                              }
                              onSelect={() => changeRole(a.id, role)}
                            >
                              {ROLE_LABELS[role]}
                            </DropdownMenuItem>
                          ))}
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <DropdownMenuItem
                                disabled={a.id === currentUserId}
                                className="text-destructive"
                                onSelect={(e) => e.preventDefault()}
                              >
                                Remove admin
                              </DropdownMenuItem>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  Remove this admin?
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  {a.email} will lose dashboard access. This
                                  action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => removeAdmin(a.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Remove
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pending invites</CardTitle>
          <CardDescription>
            {invitations.length}{" "}
            {invitations.length === 1 ? "invitation" : "invitations"} awaiting
            acceptance.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {invitations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No pending invitations.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead className="w-44" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">{inv.email}</TableCell>
                    <TableCell>{inv.role}</TableCell>
                    <TableCell className="text-muted-foreground">
                      <span>{new Date(inv.created_at).toLocaleDateString()}</span>
                      <span className="ml-1 text-xs">
                        ({inviteAge(inv.created_at)})
                      </span>
                    </TableCell>
                    <TableCell>
                      {canManage && (
                        <div className="flex gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={resendingId === inv.id}
                            onClick={() => resendInvitation(inv.id)}
                          >
                            {resendingId === inv.id ? "Sending..." : "Resend"}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => revokeInvitation(inv.id)}
                          >
                            Revoke
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
