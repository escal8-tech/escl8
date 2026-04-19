"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { PortalHeaderCard, PortalMetricCard } from "@/app/portal/components/PortalSurfacePrimitives";
import { PortalSelect, type PortalSelectOption } from "@/app/portal/components/PortalSelect";
import { usePhoneFilter } from "@/components/PhoneFilterContext";
import { useToast } from "@/components/ToastProvider";
import { showErrorToast, showSuccessToast } from "@/components/toast-utils";
import { trpc } from "@/utils/trpc";
import type { FlowAgentManifest, FlowModuleManifest } from "@/lib/flow-builder/registry";
import styles from "./FlowBuilder.module.css";

type FlowBuilderIdentity = {
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  botType: string | null;
};

type FlowBuilderWorkspaceViewProps = {
  agent: FlowAgentManifest | null;
  identityOptions: PortalSelectOption[];
  initialModules: FlowModuleManifest[];
  isLoadingWorkspace: boolean;
  isSavingDraft: boolean;
  lastSavedAt: string | null | undefined;
  onSaveDraft: (phoneNumberId: string, modules: FlowModuleManifest[]) => Promise<unknown>;
  onSelectIdentity: (value: string | null) => void;
  selectedIdentity: FlowBuilderIdentity | null;
  selectedPhoneNumberId: string | null;
  storageScope: string | null | undefined;
  workspaceError: string | null;
};

function cloneModules(modules: FlowModuleManifest[]): FlowModuleManifest[] {
  return modules.map((module) => ({
    ...module,
    position: { ...module.position },
    channels: [...module.channels],
    integrations: [...module.integrations],
    settings: module.settings.map((setting) => ({ ...setting })),
    debug: {
      ...module.debug,
      llmCalls: [...module.debug.llmCalls],
      stateKeys: [...module.debug.stateKeys],
      emits: [...module.debug.emits],
    },
  }));
}

function formatBotTypeLabel(value: string | null | undefined): string {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "ORDER") return "Order";
  if (normalized === "CONCIERGE") return "Concierge";
  if (normalized === "BOOKING" || normalized === "RESERVATION") return "Reservation";
  return "Agent";
}

function formatSavedAt(value: string | null | undefined): string {
  if (!value) return "Not saved yet";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not saved yet";
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function FlowBuilderWorkspaceView({
  agent,
  identityOptions,
  initialModules,
  isLoadingWorkspace,
  isSavingDraft,
  lastSavedAt,
  onSaveDraft,
  onSelectIdentity,
  selectedIdentity,
  selectedPhoneNumberId,
  storageScope,
  workspaceError,
}: FlowBuilderWorkspaceViewProps) {
  const [modules, setModules] = useState<FlowModuleManifest[]>(() => cloneModules(initialModules));
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const selectedModule = useMemo(
    () => modules.find((module) => module.id === selectedModuleId) ?? null,
    [modules, selectedModuleId],
  );
  const editableSettingCount = useMemo(
    () => modules.reduce((total, module) => total + module.settings.filter((setting) => setting.editable).length, 0),
    [modules],
  );
  const liveCount = useMemo(
    () => modules.filter((module) => module.status === "live").length,
    [modules],
  );
  const llmCallCount = useMemo(
    () => modules.reduce((total, module) => total + module.debug.llmCalls.length, 0),
    [modules],
  );

  const handleSettingChange = (moduleId: string, settingLabel: string, value: string) => {
    setModules((current) =>
      current.map((module) =>
        module.id === moduleId
          ? {
              ...module,
              settings: module.settings.map((setting) =>
                setting.label === settingLabel ? { ...setting, value } : setting,
              ),
            }
          : module,
      ),
    );
    setDirty(true);
  };

  const handleSaveDraft = async () => {
    if (!selectedIdentity || !modules.length) return;
    try {
      await onSaveDraft(selectedIdentity.phoneNumberId, modules);
      setDirty(false);
    } catch {
      // Toast handled by parent mutation hooks.
    }
  };

  return (
    <div className="portal-page-shell">
      <div className="portal-page-stack">
        <PortalHeaderCard
          title="Flow Builder"
          description="Edit one WhatsApp identity at a time. Drafts save under this business and selected number only."
          controls={
            <>
              <PortalSelect
                value={selectedIdentity?.phoneNumberId ?? selectedPhoneNumberId ?? ""}
                onValueChange={(value) => onSelectIdentity(value || null)}
                options={identityOptions}
                placeholder="Select identity"
                disabled={!identityOptions.length}
                ariaLabel="Select WhatsApp identity for flow builder"
                className="portal-toolbar-select portal-toolbar-select--header"
                style={{ width: "220px" }}
              />
              <button
                type="button"
                className="btn btn-primary"
                disabled={!selectedIdentity || isSavingDraft || !dirty}
                onClick={() => void handleSaveDraft()}
              >
                {isSavingDraft ? "Saving..." : dirty ? "Save Draft" : "Saved"}
              </button>
            </>
          }
        />

        <div className="portal-summary-grid">
          <PortalMetricCard
            label="WhatsApp Identity"
            value={selectedIdentity?.displayPhoneNumber || selectedIdentity?.phoneNumberId || "-"}
            hint={storageScope || "No identity selected"}
            tone="blue"
          />
          <PortalMetricCard
            label="Bot Type"
            value={formatBotTypeLabel(selectedIdentity?.botType)}
            hint={agent?.name || "No flow loaded"}
            tone="gold"
          />
          <PortalMetricCard
            label="Modules"
            value={String(modules.length)}
            hint={`${liveCount} live / ${llmCallCount} LLM calls`}
            tone="amber"
          />
          <PortalMetricCard
            label="Last Saved"
            value={formatSavedAt(lastSavedAt)}
            hint={`${editableSettingCount} editable settings`}
            tone="rose"
          />
        </div>

        <div className={styles.surface}>
          {isLoadingWorkspace ? (
            <div className={styles.emptyState}>
              <div className="empty-state-title">Loading flow workspace</div>
              <div className="text-muted">Fetching the selected WhatsApp identity and its saved draft.</div>
            </div>
          ) : workspaceError ? (
            <div className={styles.emptyState}>
              <div className="empty-state-title">Could not load flow builder</div>
              <div className="text-muted">{workspaceError}</div>
            </div>
          ) : !selectedIdentity || !agent ? (
            <div className={styles.emptyState}>
              <div className="empty-state-title">No WhatsApp identity available</div>
              <div className="text-muted">Connect a business number first to configure its bot flow.</div>
            </div>
          ) : (
            <>
              <div className={styles.surfaceHeader}>
                <div>
                  <div className={styles.kicker}>Scoped Flow</div>
                  <h2>{agent.name}</h2>
                  <p>{agent.description}</p>
                </div>
                <div className={styles.headerMeta}>
                  <span className={styles.metaChip}>Business scoped</span>
                  <span className={styles.metaChip}>{selectedIdentity.displayPhoneNumber || selectedIdentity.phoneNumberId}</span>
                  <span className={styles.metaChip}>{formatBotTypeLabel(selectedIdentity.botType)}</span>
                </div>
              </div>

              <div className={styles.routeRail}>
                {(agent.routes ?? []).map((route) => (
                  <div key={route.name} className={styles.routeChip}>
                    <strong>{route.name}</strong>
                    <span>{route.from} {"->"} {route.to}</span>
                  </div>
                ))}
              </div>

              <div className={styles.flowShell}>
                <div className={styles.flowRail}>
                  {modules.map((module, index) => (
                    <Fragment key={module.id}>
                      <button
                        type="button"
                        className={`${styles.moduleCard}${selectedModuleId === module.id ? ` ${styles.moduleCardActive}` : ""}`}
                        onClick={() => setSelectedModuleId(module.id)}
                      >
                        <div className={styles.moduleHeader}>
                          <span className={`${styles.statusPill} ${styles[`status${module.status[0].toUpperCase()}${module.status.slice(1)}`]}`}>{module.status}</span>
                          <span className={styles.moduleType}>{module.type}</span>
                        </div>
                        <div className={styles.moduleTitle}>{module.title}</div>
                        <div className={styles.moduleSummary}>{module.summary}</div>
                        <div className={styles.moduleMeta}>
                          <span>{module.debug.phase}</span>
                          <span>{module.debug.llmCalls.length} llm</span>
                          <span>{module.debug.stateKeys.length} state</span>
                        </div>
                        <div className={styles.moduleRuntime}>{module.runtimeKey}</div>
                      </button>
                      {index < modules.length - 1 ? (
                        <div className={styles.connector} aria-hidden="true">
                          <span className={styles.connectorLine} />
                          <span className={styles.connectorArrow}>{">"}</span>
                        </div>
                      ) : null}
                    </Fragment>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {selectedModule ? (
        <>
          <div className="drawer-backdrop open" onClick={() => setSelectedModuleId(null)} />
          <div className="drawer open portal-drawer-shell">
            <div className="drawer-header">
              <div className="portal-drawer-heading">
                <div>
                  <div className="portal-drawer-eyebrow">Module Details</div>
                  <div className="portal-drawer-title">{selectedModule.title}</div>
                  <div className="portal-drawer-copy">{selectedModule.summary}</div>
                </div>
              </div>
              <button className="portal-drawer-close" onClick={() => setSelectedModuleId(null)} aria-label="Close module drawer">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>

            <div className="drawer-body">
              <div className="portal-drawer-tags">
                <span className={`${styles.statusPill} ${styles[`status${selectedModule.status[0].toUpperCase()}${selectedModule.status.slice(1)}`]}`}>{selectedModule.status}</span>
                <span className="portal-pill portal-pill--neutral">{selectedModule.type}</span>
              </div>

              <div className="portal-drawer-metrics">
                <div className="portal-drawer-metric">
                  <div className="portal-drawer-metric__label">Phase</div>
                  <div className="portal-drawer-metric__value">{selectedModule.debug.phase}</div>
                </div>
                <div className="portal-drawer-metric">
                  <div className="portal-drawer-metric__label">Channels</div>
                  <div className="portal-drawer-metric__value">{selectedModule.channels.join(", ") || "-"}</div>
                </div>
                <div className="portal-drawer-metric">
                  <div className="portal-drawer-metric__label">Runtime Key</div>
                  <div className="portal-drawer-metric__value">{selectedModule.runtimeKey}</div>
                </div>
              </div>

              <div className={styles.drawerSection}>
                <div className={styles.drawerSectionTitle}>Settings</div>
                <div className={styles.settingList}>
                  {selectedModule.settings.map((setting) => (
                    <label key={setting.label} className="portal-field">
                      <span className="portal-field-label">{setting.label}</span>
                      {setting.editable ? (
                        <input
                          value={setting.value}
                          onChange={(event) => handleSettingChange(selectedModule.id, setting.label, event.target.value)}
                        />
                      ) : (
                        <div className={styles.readOnlyValue}>{setting.value}</div>
                      )}
                    </label>
                  ))}
                </div>
              </div>

              <div className={styles.drawerSection}>
                <div className={styles.drawerSectionTitle}>Runtime Debug</div>
                <div className={styles.debugBlock}>
                  <div>
                    <div className={styles.debugLabel}>LLM Calls</div>
                    <div className={styles.debugList}>{selectedModule.debug.llmCalls.join(", ") || "-"}</div>
                  </div>
                  <div>
                    <div className={styles.debugLabel}>State Keys</div>
                    <div className={styles.debugList}>{selectedModule.debug.stateKeys.join(", ") || "-"}</div>
                  </div>
                  <div>
                    <div className={styles.debugLabel}>Emits</div>
                    <div className={styles.debugList}>{selectedModule.debug.emits.join(", ") || "-"}</div>
                  </div>
                  <div>
                    <div className={styles.debugLabel}>Integrations</div>
                    <div className={styles.debugList}>{selectedModule.integrations.join(", ") || "-"}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="portal-drawer-footer">
              <div className="portal-drawer-footer__label">
                {dirty ? "Unsaved changes for this identity" : "Saved for this business and WhatsApp identity"}
              </div>
              <div className="portal-drawer-footer__actions">
                <button type="button" className="btn btn-secondary" onClick={() => setSelectedModuleId(null)}>
                  Close
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!dirty || isSavingDraft || !selectedIdentity}
                  onClick={() => void handleSaveDraft()}
                >
                  {isSavingDraft ? "Saving..." : "Save Draft"}
                </button>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function FlowBuilderContent() {
  const toast = useToast();
  const utils = trpc.useUtils();
  const { selectedPhoneNumberId, setSelectedPhoneNumberId } = usePhoneFilter();
  const workspaceQuery = trpc.flowBuilder.getWorkspace.useQuery(
    { phoneNumberId: selectedPhoneNumberId ?? undefined },
    {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  );
  const saveDraft = trpc.flowBuilder.saveDraft.useMutation({
    onSuccess: async () => {
      await utils.flowBuilder.getWorkspace.invalidate();
      showSuccessToast(toast, {
        title: "Flow draft saved",
        message: "This flow is now saved only for the selected business and WhatsApp identity.",
      });
    },
    onError: (error) => {
      showErrorToast(toast, {
        title: "Could not save flow",
        message: error.message || "Flow draft save failed.",
      });
    },
  });

  const workspace = workspaceQuery.data;
  const isLoadingWorkspace = workspaceQuery.isLoading && !workspace;
  const workspaceError = workspaceQuery.error?.message || null;
  const selectedIdentity = workspace?.selectedIdentity ?? null;
  const agent = workspace?.agent ?? null;

  useEffect(() => {
    if (selectedIdentity?.phoneNumberId && selectedIdentity.phoneNumberId !== selectedPhoneNumberId) {
      setSelectedPhoneNumberId(selectedIdentity.phoneNumberId);
    }
  }, [selectedIdentity?.phoneNumberId, selectedPhoneNumberId, setSelectedPhoneNumberId]);

  const identityOptions = useMemo(
    () =>
      (workspace?.identities ?? []).map((identity) => ({
        value: identity.phoneNumberId,
        label: identity.displayPhoneNumber || identity.phoneNumberId.slice(-8),
      })),
    [workspace?.identities],
  );
  const initialModules = workspace?.modules ? cloneModules(workspace.modules) : [];
  const workspaceResetKey = `${selectedIdentity?.phoneNumberId ?? "none"}:${workspace?.lastSavedAt ?? "none"}`;

  return (
    <FlowBuilderWorkspaceView
      key={workspaceResetKey}
      agent={agent}
      identityOptions={identityOptions}
      initialModules={initialModules}
      isLoadingWorkspace={isLoadingWorkspace}
      isSavingDraft={saveDraft.isPending}
      lastSavedAt={workspace?.lastSavedAt}
      onSaveDraft={(phoneNumberId, modules) =>
        saveDraft.mutateAsync({
          phoneNumberId,
          modules,
        })
      }
      onSelectIdentity={setSelectedPhoneNumberId}
      selectedIdentity={selectedIdentity}
      selectedPhoneNumberId={selectedPhoneNumberId}
      storageScope={workspace?.storageScope}
      workspaceError={workspaceError}
    />
  );
}
