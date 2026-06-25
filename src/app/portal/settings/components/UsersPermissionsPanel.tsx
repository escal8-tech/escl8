"use client";

import { useMemo, useState } from "react";
import { trpc } from "@/utils/trpc";
import { PortalSelect } from "@/app/portal/components/PortalSelect";

type AccessLevel = "admin" | "manager" | "staff";

const ACCESS_OPTIONS: Array<{ value: AccessLevel; label: string; helper: string }> = [
  { value: "staff", label: "Standard", helper: "Can use the workspace without admin controls." },
  { value: "manager", label: "Manager", helper: "Operational access. Stored as member until finer agent roles are added." },
  { value: "admin", label: "Admin", helper: "Can invite users and manage permissions." },
];

function accessLabel(value: string | null | undefined) {
  return ACCESS_OPTIONS.find((option) => option.value === value)?.label || "Standard";
}

function errorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return fallback;
}

export default function UsersPermissionsPanel() {
  const utils = trpc.useContext();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteAccess, setInviteAccess] = useState<AccessLevel>("staff");
  const [latestInviteUrl, setLatestInviteUrl] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const teamQuery = trpc.user.listTeam.useQuery(undefined, { refetchOnWindowFocus: false });
  const invitesQuery = trpc.user.listInvites.useQuery(undefined, { refetchOnWindowFocus: false });
  const team = useMemo(() => teamQuery.data ?? [], [teamQuery.data]);
  const invites = useMemo(() => invitesQuery.data ?? [], [invitesQuery.data]);
  const adminCount = team.filter((member) => member.accessLevel === "admin" && member.isActive).length;

  const refresh = async () => {
    await utils.user.listTeam.invalidate();
    await utils.user.listInvites.invalidate();
  };

  const inviteMutation = trpc.user.invite.useMutation({
    onSuccess: async (data) => {
      setInviteEmail("");
      setInviteAccess("staff");
      setLatestInviteUrl(data.inviteUrl);
      setMessage(data.emailSent ? "Invite email sent from the connected Gmail account." : "Invite link created. Gmail is not connected, so send the link manually.");
      await refresh();
    },
    onError: (error) => setMessage(errorMessage(error, "Invite failed.")),
  });

  const cancelInviteMutation = trpc.user.cancelInvite.useMutation({
    onSuccess: async () => {
      setMessage("Invite cancelled.");
      await refresh();
    },
    onError: (error) => setMessage(errorMessage(error, "Invite could not be cancelled.")),
  });

  const setRoleMutation = trpc.user.setMemberRole.useMutation({
    onSuccess: async () => {
      setMessage("Permissions updated.");
      await refresh();
    },
    onError: (error) => setMessage(errorMessage(error, "Permissions could not be updated.")),
  });

  const removeMemberMutation = trpc.user.removeMember.useMutation({
    onSuccess: async () => {
      setMessage("Team member removed.");
      await refresh();
    },
    onError: (error) => setMessage(errorMessage(error, "Team member could not be removed.")),
  });

  const loading = teamQuery.isLoading || invitesQuery.isLoading;
  const failed = teamQuery.isError || invitesQuery.isError;

  return (
    <div className="space-y-6 bg-[var(--settings-page-bg)] p-6">
      <section className="overflow-hidden rounded-[28px] border border-white/10 bg-[#1A2332]/95 shadow-[0_18px_44px_rgba(2,6,23,0.22)]">
        <div className="flex flex-col gap-4 p-6 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-[22px] font-semibold text-white">Users & Permissions</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
              Invite teammates directly. Users cannot pick a business from a selector; they either own a new business or join through an invite.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-300">{team.length} users</span>
            <span className="rounded-full border border-[#d8b45a]/35 bg-[#d8b45a]/12 px-3 py-1 text-[#d8b45a]">{adminCount} admins</span>
            <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-emerald-300">{invites.length} invites</span>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[28px] border border-white/10 bg-[#1A2332]/95 shadow-[0_18px_44px_rgba(2,6,23,0.22)]">
        <div className="border-b border-white/10 p-6">
          <h3 className="text-xl font-semibold text-white">Invite Teammate</h3>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            The invite link binds the user to this workspace. If Gmail is connected, the system sends the email automatically.
          </p>
        </div>

        <div className="space-y-5 p-6">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const email = inviteEmail.trim().toLowerCase();
              if (!email) {
                setMessage("Enter an email address first.");
                return;
              }
              inviteMutation.mutate({ email, accessLevel: inviteAccess });
            }}
            className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_220px_220px]"
          >
            <input
              className="h-12 rounded-xl border border-[#45607d] bg-[#14304b] px-4 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#5c7ba0] focus:ring-2 focus:ring-[#2f6bb2]/30"
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="teammate@example.com"
            />
            <PortalSelect
              value={inviteAccess}
              onValueChange={(value) => setInviteAccess(value as AccessLevel)}
              options={ACCESS_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
              ariaLabel="Invite access level"
              style={{ minHeight: 48, borderRadius: 14 }}
            />
            <button
              className="inline-flex h-12 items-center justify-center rounded-xl bg-[#c7a64f] px-5 text-sm font-semibold text-[#0f172a] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
              type="submit"
              disabled={inviteMutation.isPending}
            >
              {inviteMutation.isPending ? "Sending..." : "Send Invite"}
            </button>
          </form>

          {message ? (
            <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
              {message}
            </div>
          ) : null}

          {latestInviteUrl ? (
            <div className="rounded-xl border border-[#d8b45a]/20 bg-[#d8b45a]/8 p-4">
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-[#d8b45a]">Latest invite link</label>
              <input
                className="h-11 w-full rounded-xl border border-white/10 bg-[#13263c] px-4 text-xs text-slate-200 outline-none"
                value={latestInviteUrl}
                readOnly
                onFocus={(event) => event.currentTarget.select()}
              />
            </div>
          ) : null}

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-semibold text-white">Pending Invites</h4>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">{invites.length}</span>
            </div>
            {loading ? <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-sm text-slate-400">Loading users...</div> : null}
            {failed ? <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-6 text-sm text-red-300">User permissions could not be loaded.</div> : null}
            {!loading && !failed && invites.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-6 text-center text-sm text-slate-400">
                No pending invites right now.
              </div>
            ) : null}
            {!loading && !failed && invites.map((invite) => (
              <div key={invite.id} className="rounded-2xl border border-white/10 bg-[#20324a] p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="font-medium text-white">{invite.email}</div>
                    <div className="mt-1 text-sm text-slate-400">
                      {accessLabel(invite.role === "admin" ? "admin" : "staff")} access · expires {new Date(invite.expiresAt).toLocaleDateString()}
                    </div>
                  </div>
                  <button
                    className="inline-flex h-10 items-center justify-center rounded-xl border border-red-400/20 bg-red-400/10 px-4 text-sm font-medium text-red-300 transition hover:bg-red-400/15 disabled:cursor-not-allowed disabled:opacity-60"
                    type="button"
                    onClick={() => cancelInviteMutation.mutate({ id: invite.id })}
                    disabled={cancelInviteMutation.isPending}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[28px] border border-white/10 bg-[#1A2332]/95 shadow-[0_18px_44px_rgba(2,6,23,0.22)]">
        <div className="border-b border-white/10 p-6">
          <h3 className="text-xl font-semibold text-white">Active Team</h3>
        </div>

        <div className="space-y-3 p-6">
          {!loading && !failed && team.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-6 text-center text-sm text-slate-400">
              No team members found.
            </div>
          ) : null}

          {team.map((member) => {
            const isLastAdmin = member.accessLevel === "admin" && adminCount <= 1;
            return (
              <div key={member.id} className="rounded-2xl border border-white/10 bg-[#20324a] p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="truncate text-lg font-semibold text-white">{member.email}</div>
                    <div className="mt-2 text-sm text-slate-400">
                      {member.isCurrentUser ? "Current user" : "Team member"} · {accessLabel(member.accessLevel)}
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 lg:min-w-[260px] lg:items-end">
                    <div className="w-full lg:max-w-[250px]">
                      <PortalSelect
                        value={member.accessLevel}
                        onValueChange={(value) => setRoleMutation.mutate({ id: member.id, accessLevel: value as AccessLevel })}
                        options={ACCESS_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                        ariaLabel={`Access level for ${member.email}`}
                        disabled={setRoleMutation.isPending || isLastAdmin}
                        style={{ minHeight: 48, borderRadius: 14 }}
                      />
                    </div>
                    <button
                      className="inline-flex h-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-medium text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                      type="button"
                      disabled={removeMemberMutation.isPending || member.isCurrentUser || isLastAdmin}
                      onClick={() => removeMemberMutation.mutate({ id: member.id })}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
