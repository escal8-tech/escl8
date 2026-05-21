"use client";

import { useMemo, useState } from "react";
import { trpc } from "@/utils/trpc";

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

const cardStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 16,
  background: "linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.015))",
  padding: 24,
};

const rowStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 14,
  padding: 16,
  display: "flex",
  gap: 16,
  alignItems: "center",
  justifyContent: "space-between",
  flexWrap: "wrap",
};

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
    <div style={{ display: "grid", gap: 18 }}>
      <section style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 18 }}>
          <div>
            <h2 style={{ margin: 0, color: "var(--foreground)", fontSize: 22 }}>Users & Permissions</h2>
            <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 14, lineHeight: 1.5 }}>
              Invite teammates directly. Users cannot pick a business from a selector; they either own a new business or join through an invite.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
            <span className="badge">{team.length} users</span>
            <span className="badge">{adminCount} admins</span>
            <span className="badge">{invites.length} invites</span>
          </div>
        </div>

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
          style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}
        >
          <input className="contact-input" type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="teammate@example.com" />
          <select className="contact-input" value={inviteAccess} onChange={(event) => setInviteAccess(event.target.value as AccessLevel)}>
            {ACCESS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <button className="btn btn-primary" type="submit" disabled={inviteMutation.isPending}>
            {inviteMutation.isPending ? "Sending..." : "Send invite"}
          </button>
        </form>

        {message ? <p style={{ margin: "14px 0 0", color: "var(--muted)", fontSize: 13 }}>{message}</p> : null}
        {latestInviteUrl ? (
          <div style={{ marginTop: 14 }}>
            <label style={{ display: "block", color: "var(--muted)", fontSize: 12, marginBottom: 6 }}>Latest invite link</label>
            <input className="contact-input" value={latestInviteUrl} readOnly onFocus={(event) => event.currentTarget.select()} />
          </div>
        ) : null}
      </section>

      <section style={cardStyle}>
        <h3 style={{ margin: "0 0 14px", color: "var(--foreground)", fontSize: 18 }}>Pending Invites</h3>
        {loading ? <p style={{ color: "var(--muted)" }}>Loading users...</p> : null}
        {failed ? <p style={{ color: "var(--danger)" }}>User permissions could not be loaded.</p> : null}
        {!loading && !failed && invites.length === 0 ? <p style={{ color: "var(--muted)" }}>No pending invites.</p> : null}
        <div style={{ display: "grid", gap: 10 }}>
          {invites.map((invite) => (
            <div key={invite.id} style={rowStyle}>
              <div>
                <strong style={{ color: "var(--foreground)" }}>{invite.email}</strong>
                <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 13 }}>
                  {accessLabel(invite.role === "admin" ? "admin" : "staff")} access · expires {new Date(invite.expiresAt).toLocaleDateString()}
                </p>
              </div>
              <button className="btn" type="button" onClick={() => cancelInviteMutation.mutate({ id: invite.id })} disabled={cancelInviteMutation.isPending}>
                Cancel
              </button>
            </div>
          ))}
        </div>
      </section>

      <section style={cardStyle}>
        <h3 style={{ margin: "0 0 14px", color: "var(--foreground)", fontSize: 18 }}>Active Team</h3>
        {!loading && !failed && team.length === 0 ? <p style={{ color: "var(--muted)" }}>No team members found.</p> : null}
        <div style={{ display: "grid", gap: 10 }}>
          {team.map((member) => {
            const isLastAdmin = member.accessLevel === "admin" && adminCount <= 1;
            return (
              <div key={member.id} style={rowStyle}>
                <div>
                  <strong style={{ color: "var(--foreground)" }}>{member.email}</strong>
                  <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 13 }}>
                    {member.isCurrentUser ? "Current user" : "Team member"} · {accessLabel(member.accessLevel)}
                  </p>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <select
                    className="contact-input"
                    style={{ minWidth: 160 }}
                    value={member.accessLevel}
                    disabled={setRoleMutation.isPending || isLastAdmin}
                    onChange={(event) => setRoleMutation.mutate({ id: member.id, accessLevel: event.target.value as AccessLevel })}
                  >
                    {ACCESS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <button
                    className="btn"
                    type="button"
                    disabled={removeMemberMutation.isPending || member.isCurrentUser || isLastAdmin}
                    onClick={() => removeMemberMutation.mutate({ id: member.id })}
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
