"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { EmailAuthProvider, onAuthStateChanged, reauthenticateWithCredential, signOut, updatePassword } from "firebase/auth";
import dynamic from "next/dynamic";
import {
  BookOpenText,
  Bot,
  Building2,
  Calendar,
  Clock3,
  CreditCard,
  ExternalLink,
  Link2,
  Lock,
  Mail,
  MapPin,
  Palette,
  Phone,
  Settings2,
  Shield,
  Sun,
  Moon,
  User,
  Users,
  Workflow,
} from "lucide-react";
import { ConnectionsTab } from "@/app/portal/settings/components/ConnectionsTab";
import { AgentsTab } from "@/app/portal/settings/components/AgentsTab";
import UsersPermissionsPanel from "@/app/portal/settings/components/UsersPermissionsPanel";
import { PortalSelect } from "@/app/portal/components/PortalSelect";
import { usePortalTheme } from "@/app/portal/components/PortalThemeProvider";
import { fetchWithFirebaseAuth, getFirebaseIdTokenOrThrow } from "@/lib/client-auth-ops";
import { describeCompanyGmailError } from "@/lib/company-gmail";
import { recordClientBusinessEvent, shouldCaptureUnexpectedClientError } from "@/lib/client-business-monitoring";
import { DEFAULT_CUSTOMIZATION_SETTINGS } from "@/lib/customization-settings";
import { getFirebaseAuth } from "@/lib/firebaseClient";
import type { OrderDeliveryChargeType, OrderPaymentMethod } from "@/lib/order-settings";
import { buildWebsiteWidgetSnippet, normalizeWebsiteWidgetSettings } from "@/lib/website-widget";
import { showErrorToast, showSuccessToast } from "@/components/toast-utils";
import { SubscriptionContent } from "@/components/subscription/SubscriptionContent";
import { useToast } from "@/components/ToastProvider";
import { trpc } from "@/utils/trpc";

const FlowBuilderContent = dynamic(
  () => import("@/app/portal/flowbuilder/FlowBuilderContent").then((mod) => mod.FlowBuilderContent),
  {
    loading: () => <div className="p-8 text-center text-gray-500 dark:text-gray-400">Loading Flow Builder...</div>,
  },
);

type SettingsTab = "profile" | "booking" | "customization" | "connections" | "agents" | "users" | "flowbuilder" | "subscription";

const TAB_CONFIG: Array<{ id: SettingsTab; label: string; icon: React.ReactNode }> = [
  { id: "profile", label: "Profile", icon: <User className="h-5 w-5" /> },
  { id: "booking", label: "Booking", icon: <Calendar className="h-5 w-5" /> },
  { id: "customization", label: "Customization", icon: <Palette className="h-5 w-5" /> },
  { id: "connections", label: "Connections", icon: <Link2 className="h-5 w-5" /> },
  { id: "agents", label: "Agents", icon: <Bot className="h-5 w-5" /> },
  { id: "users", label: "Users & Permissions", icon: <Users className="h-5 w-5" /> },
  { id: "flowbuilder", label: "Flow Builder", icon: <Workflow className="h-5 w-5" /> },
  { id: "subscription", label: "Subscription", icon: <Shield className="h-5 w-5" /> },
];

const TAB_FEATURE_MAP: Record<SettingsTab, string> = {
  profile: "agent.settings.basic",
  booking: "agent.settings.basic",
  customization: "agent.settings.basic",
  connections: "agent.whatsapp.connect",
  agents: "agent.settings.basic",
  users: "agent.settings.basic",
  flowbuilder: "agent.messages.view",
  subscription: "agent.settings.basic",
};

function readAccessFeatures(value: unknown): Record<string, boolean> | undefined {
  if (!value || typeof value !== "object" || !("features" in value)) return undefined;
  const features = (value as { features?: unknown }).features;
  if (!features || typeof features !== "object") return undefined;
  return features as Record<string, boolean>;
}

function getRequestedSettingsTab(rawValue: string | null): SettingsTab {
  const normalized = String(rawValue || "").trim().toLowerCase();
  if (!normalized) return "profile";
  if (normalized === "tickets" || normalized === "payments") return "profile";
  return (TAB_CONFIG.find((tab) => tab.id === normalized)?.id ?? "profile") as SettingsTab;
}

function Toggle({ checked, onChange, disabled = false }: { checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-8 w-14 items-center rounded-full border transition ${
        checked ? "border-cyan-400/40 bg-cyan-400/90" : "border-white/10 bg-white/10"
      } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
    >
      <span
        className={`inline-block h-6 w-6 rounded-full bg-white shadow transition ${checked ? "translate-x-7" : "translate-x-1"}`}
      />
    </button>
  );
}

function FieldTile({ label, value, valueClassName }: { label: string; value: React.ReactNode; valueClassName?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#20324a] px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-[0.1em] text-[#8ea7c3]">{label}</div>
      <div className={`mt-2 text-base font-medium text-white ${valueClassName || ""}`}>{value}</div>
    </div>
  );
}

function SectionCard({
  icon,
  title,
  description,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-white/10 bg-[#1c2839]/95 shadow-[0_12px_28px_rgba(2,6,23,0.16)]">
      <div className="flex flex-col gap-4 px-6 pb-4 pt-5 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#d8b45a]/10 text-[#d8b45a]">{icon}</div>
          <div>
            <h2 className="text-[18px] font-semibold text-white">{title}</h2>
            <p className="mt-1 text-sm leading-6 text-slate-400">{description}</p>
          </div>
        </div>
        {action}
      </div>
      <div className="px-6 pb-6 pt-1">{children}</div>
    </section>
  );
}

function ModalShell({
  title,
  eyebrow,
  description,
  onClose,
  children,
  footer,
  widthClassName = "max-w-4xl",
}: {
  title: string;
  eyebrow?: string;
  description: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
  widthClassName?: string;
}) {
  return (
    <div className="fixed inset-0 z-[5000] grid place-items-center bg-slate-950/65 p-4 backdrop-blur-md">
      <div className={`w-full ${widthClassName} overflow-hidden rounded-xl border border-white/10 bg-[#1A2332] shadow-[0_24px_80px_rgba(0,0,0,0.42)]`}>
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div>
            {eyebrow ? <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#d8b45a]">{eyebrow}</div> : null}
            <h2 className="mt-2 text-[34px] font-semibold leading-none text-white">{title}</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">{description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#45607d] bg-[#20324a] text-2xl leading-none text-slate-300 transition hover:text-white"
          >
            ×
          </button>
        </div>
        <div className="max-h-[calc(100vh-240px)] overflow-y-auto p-6">{children}</div>
        <div className="flex items-center justify-end gap-3 border-t border-white/10 px-6 py-5">{footer}</div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const auth = getFirebaseAuth();
  const toast = useToast();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { theme, setTheme } = usePortalTheme();

  const [email, setEmail] = useState<string | null>(null);

  const [unitCapacity, setUnitCapacity] = useState(1);
  const [timeslotMinutes, setTimeslotMinutes] = useState(60);
  const [openTime, setOpenTime] = useState("");
  const [closeTime, setCloseTime] = useState("");
  const [bookingsEnabled, setBookingsEnabled] = useState(false);
  const [timezone, setTimezone] = useState("UTC");

  const [orderPaymentMethod, setOrderPaymentMethod] = useState<OrderPaymentMethod>("manual");
  const [paymentProofAiEnabled, setPaymentProofAiEnabled] = useState(true);
  const [paymentSlipRequired, setPaymentSlipRequired] = useState(true);
  const [orderCurrency, setOrderCurrency] = useState("LKR");
  const [deliveryChargeEnabled, setDeliveryChargeEnabled] = useState(false);
  const [deliveryChargeType, setDeliveryChargeType] = useState<OrderDeliveryChargeType>("fixed");
  const [deliveryChargeValue, setDeliveryChargeValue] = useState("0");
  const [qrBlobPath, setQrBlobPath] = useState("");
  const [bankQrImageUrl, setBankQrImageUrl] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountInstructions, setAccountInstructions] = useState("");

  const [customBusinessName, setCustomBusinessName] = useState("");
  const [customLogoBlobPath, setCustomLogoBlobPath] = useState("");
  const [customLogoContainer, setCustomLogoContainer] = useState("");
  const [customLogoUrl, setCustomLogoUrl] = useState("");
  const [customPrimaryColor, setCustomPrimaryColor] = useState(DEFAULT_CUSTOMIZATION_SETTINGS.primaryColor);
  const [customSecondaryColor, setCustomSecondaryColor] = useState(DEFAULT_CUSTOMIZATION_SETTINGS.secondaryColor);
  const [customAddress, setCustomAddress] = useState("");
  const [customPhone, setCustomPhone] = useState("");
  const [customEmail, setCustomEmail] = useState("");
  const [customWebsite, setCustomWebsite] = useState("");
  const [customInvoiceFooterNote, setCustomInvoiceFooterNote] = useState(DEFAULT_CUSTOMIZATION_SETTINGS.invoiceFooterNote);

  const [gmailConnectPending, setGmailConnectPending] = useState(false);
  const [qrUploadPending, setQrUploadPending] = useState(false);
  const [logoUploadPending, setLogoUploadPending] = useState(false);

  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [brandingModalOpen, setBrandingModalOpen] = useState(false);
  const [widgetModalOpen, setWidgetModalOpen] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);

  const [widgetSnippet, setWidgetSnippet] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordPending, setPasswordPending] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");

  useEffect(() => {
    if (!auth) return;
    const unsub = onAuthStateChanged(auth, (user) => setEmail(user?.email ?? null));
    return () => unsub();
  }, [auth]);

  const businessQuery = trpc.business.getMine.useQuery({ email: email ?? "" }, { enabled: !!email });
  const phoneNumbersQuery = trpc.business.listPhoneNumbers.useQuery(undefined, { enabled: !!email });
  const accessStatusQuery = trpc.user.getAccessStatus.useQuery({ email: email ?? "" }, { enabled: !!email });
  const ensureWebsiteWidget = trpc.business.ensureWebsiteWidget.useMutation();
  const updateBooking = trpc.business.updateBookingConfig.useMutation();
  const updateTimezone = trpc.business.updateTimezone.useMutation();
  const updateOrderSettings = trpc.business.updateOrderSettings.useMutation();
  const updateCustomizationSettings = trpc.business.updateCustomizationSettings.useMutation();
  const disconnectGmail = trpc.business.disconnectGmailConnection.useMutation();

  const accessFeatures = readAccessFeatures(accessStatusQuery.data);
  const visibleTabs = useMemo(
    () =>
      TAB_CONFIG.filter((tab) => (
        accessFeatures ? accessFeatures[TAB_FEATURE_MAP[tab.id]] !== false : true
      )),
    [accessFeatures],
  );

  const requestedTab = getRequestedSettingsTab(searchParams?.get("tab"));
  const customizationPreviewQuery = trpc.business.getCustomizationPreview.useQuery(undefined, {
    enabled: !!email && activeTab === "customization",
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    const nextTab = visibleTabs.some((tab) => tab.id === requestedTab) ? requestedTab : (visibleTabs[0]?.id ?? "profile");
    setActiveTab((current) => (current === nextTab ? current : nextTab));
  }, [requestedTab, visibleTabs]);

  useEffect(() => {
    if (!businessQuery.data) return;
    setUnitCapacity(businessQuery.data.bookingUnitCapacity ?? 1);
    setTimeslotMinutes(businessQuery.data.bookingTimeslotMinutes ?? 60);
    setOpenTime(businessQuery.data.bookingOpenTime ?? "");
    setCloseTime(businessQuery.data.bookingCloseTime ?? "");
    setBookingsEnabled(businessQuery.data.bookingsEnabled ?? false);

    const settingsTz = (businessQuery.data.settings as Record<string, unknown> | null | undefined)?.timezone;
    const businessTz = String((businessQuery.data as { timezone?: unknown }).timezone ?? "").trim();
    setTimezone(businessTz || (typeof settingsTz === "string" ? settingsTz : "") || "UTC");

    const orderSettings = businessQuery.data.orderSettings;
    setOrderPaymentMethod((orderSettings?.paymentMethod as OrderPaymentMethod | undefined) ?? "manual");
    setPaymentProofAiEnabled(orderSettings?.paymentProofAiEnabled ?? true);
    setPaymentSlipRequired(orderSettings?.paymentSlipRequired ?? true);
    setOrderCurrency(orderSettings?.currency ?? "LKR");
    setDeliveryChargeEnabled(orderSettings?.deliveryCharge?.enabled ?? false);
    setDeliveryChargeType((orderSettings?.deliveryCharge?.type as OrderDeliveryChargeType | undefined) ?? "fixed");
    setDeliveryChargeValue(orderSettings?.deliveryCharge?.value ?? "0");
    setQrBlobPath(orderSettings?.bankQr?.qrBlobPath ?? "");
    setBankQrImageUrl(orderSettings?.bankQr?.qrImageUrl ?? "");
    setBankName(orderSettings?.bankQr?.bankName ?? "");
    setAccountName(orderSettings?.bankQr?.accountName ?? "");
    setAccountNumber(orderSettings?.bankQr?.accountNumber ?? "");
    setAccountInstructions(orderSettings?.bankQr?.accountInstructions ?? "");

    const customization = businessQuery.data.customizationSettings;
    setCustomBusinessName(customization?.businessName || businessQuery.data.name || "");
    setCustomLogoBlobPath(customization?.logoBlobPath ?? "");
    setCustomLogoContainer(customization?.logoContainer ?? "");
    setCustomLogoUrl(customization?.logoUrl ?? "");
    setCustomPrimaryColor(customization?.primaryColor ?? DEFAULT_CUSTOMIZATION_SETTINGS.primaryColor);
    setCustomSecondaryColor(customization?.secondaryColor ?? DEFAULT_CUSTOMIZATION_SETTINGS.secondaryColor);
    setCustomAddress(customization?.address ?? "");
    setCustomPhone(customization?.phone ?? "");
    setCustomEmail(customization?.email ?? "");
    setCustomWebsite(customization?.website ?? "");
    setCustomInvoiceFooterNote(customization?.invoiceFooterNote ?? DEFAULT_CUSTOMIZATION_SETTINGS.invoiceFooterNote);
  }, [businessQuery.data]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const gmail = String(url.searchParams.get("gmail") || "").trim().toLowerCase();
    if (!gmail) return;
    if (gmail === "connected") {
      showSuccessToast(toast, {
        title: "Gmail connected",
        message: "Order emails will now be sent from the connected Gmail account.",
      });
      void businessQuery.refetch();
    } else {
      const messageMap: Record<string, string> = {
        auth_required: "Sign in again before connecting the company Gmail account.",
        forbidden: "You do not have permission to connect Gmail for this business.",
        env_missing: "Google OAuth is not configured on the server.",
        token_error: "Google rejected the Gmail connection during token exchange.",
        token_missing: "Google did not return the Gmail refresh token. Try connecting again.",
        email_missing: "Google did not return the Gmail sender address.",
        error: "The Gmail connection could not be completed.",
      };
      showErrorToast(toast, {
        title: "Gmail connection failed",
        message: messageMap[gmail] || "The Gmail connection could not be completed.",
      });
    }
    url.searchParams.delete("gmail");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, [businessQuery, toast]);

  const handleTabSelect = (tab: SettingsTab) => {
    setActiveTab(tab);
    const params = new URLSearchParams(searchParams?.toString() || "");
    if (tab === "profile") {
      params.delete("tab");
    } else {
      params.set("tab", tab);
    }
    const nextQuery = params.toString();
    router.replace(`${pathname}${nextQuery ? `?${nextQuery}` : ""}`, { scroll: false });
  };

  const handleLogout = async () => {
    if (!auth) {
      recordClientBusinessEvent({
        event: "auth.logout_failed",
        action: "portal-logout",
        area: "auth",
        captureInSentry: true,
        error: new Error("Firebase auth is not configured. Add NEXT_PUBLIC_FIREBASE_* env vars."),
        level: "error",
        outcome: "config_missing",
        route: "/settings",
      });
      window.location.href = "/";
      return;
    }
    try {
      await signOut(auth);
      window.location.href = "/";
    } catch (err: unknown) {
      const captureInSentry = shouldCaptureUnexpectedClientError(err);
      recordClientBusinessEvent({
        event: "auth.logout_failed",
        action: "portal-logout",
        area: "auth",
        captureInSentry,
        error: err,
        level: captureInSentry ? "error" : "warn",
        outcome: captureInSentry ? "unexpected_failure" : "handled_failure",
        route: "/settings",
      });
      throw err;
    }
  };

  const handleChangePassword = async () => {
    const user = auth?.currentUser;
    const userEmail = user?.email || email;
    if (!user || !userEmail) {
      setPasswordError("Sign in again before changing the password.");
      return;
    }
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError("Enter your current password and the new password twice.");
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError("The new password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("The new passwords do not match.");
      return;
    }

    setPasswordPending(true);
    setPasswordError(null);
    try {
      const credential = EmailAuthProvider.credential(userEmail, currentPassword);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPassword);
      showSuccessToast(toast, {
        title: "Password changed",
        message: "Use the new password the next time you sign in.",
      });
      setPasswordModalOpen(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Password could not be changed.";
      setPasswordError(message.includes("auth/invalid-credential") ? "The current password is incorrect." : message);
      showErrorToast(toast, {
        title: "Password update failed",
        message: "Check the current password and try again.",
      });
    } finally {
      setPasswordPending(false);
    }
  };

  const handleSaveBookingSettings = async () => {
    if (!email || !businessQuery.data?.id) return;
    if (bookingsEnabled && (!openTime || !closeTime)) {
      showErrorToast(toast, {
        title: "Booking hours missing",
        message: "Set both opening and closing times before saving booking settings.",
      });
      return;
    }
    try {
      await updateBooking.mutateAsync({
        email,
        businessId: businessQuery.data.id,
        bookingsEnabled,
        unitCapacity,
        timeslotMinutes,
        openTime: openTime || "09:00",
        closeTime: closeTime || "17:00",
      });
      await businessQuery.refetch();
      setBookingModalOpen(false);
      showSuccessToast(toast, {
        title: "Settings updated",
        message: "Booking settings saved successfully.",
      });
    } catch {
      showErrorToast(toast, {
        title: "Save failed",
        message: "Booking settings could not be saved.",
      });
    }
  };

  const handleSaveProfileDetails = async () => {
    if (!email || !businessQuery.data?.id) return;
    try {
      await updateCustomizationSettings.mutateAsync({
        email,
        businessId: businessQuery.data.id,
        businessName: customBusinessName.trim(),
        logoBlobPath: customLogoBlobPath.trim(),
        logoContainer: customLogoContainer.trim(),
        logoUrl: customLogoUrl.trim(),
        primaryColor: customPrimaryColor.trim() || DEFAULT_CUSTOMIZATION_SETTINGS.primaryColor,
        secondaryColor: customSecondaryColor.trim() || DEFAULT_CUSTOMIZATION_SETTINGS.secondaryColor,
        address: customAddress.trim(),
        phone: customPhone.trim(),
        emailAddress: customEmail.trim(),
        website: customWebsite.trim(),
        invoiceFooterNote: customInvoiceFooterNote.trim(),
      });
      await updateTimezone.mutateAsync({
        email,
        businessId: businessQuery.data.id,
        timezone,
      });
      await businessQuery.refetch();
      await customizationPreviewQuery.refetch();
      setProfileModalOpen(false);
      showSuccessToast(toast, {
        title: "Profile updated",
        message: "Business details and timezone were saved successfully.",
      });
    } catch {
      showErrorToast(toast, {
        title: "Save failed",
        message: "Business profile details could not be saved.",
      });
    }
  };

  const handleSaveOrderSettings = async () => {
    if (!email || !businessQuery.data?.id) return;
    const normalizedBankName = bankName.trim();
    const normalizedAccountName = accountName.trim();
    const normalizedAccountNumber = accountNumber.trim();
    const normalizedInstructions = accountInstructions.trim();
    const hasQr = Boolean(qrBlobPath.trim() || bankQrImageUrl.trim());
    const hasBankDetails = Boolean(
      normalizedBankName || normalizedAccountName || normalizedAccountNumber || normalizedInstructions,
    );

    try {
      await updateOrderSettings.mutateAsync({
        email,
        businessId: businessQuery.data.id,
        ticketToOrderEnabled: true,
        paymentMethod: orderPaymentMethod,
        paymentProofAiEnabled,
        paymentSlipRequired,
        currency: orderCurrency.trim() || "LKR",
        deliveryCharge: {
          enabled: deliveryChargeEnabled,
          type: deliveryChargeEnabled ? deliveryChargeType : "fixed",
          value: deliveryChargeEnabled ? deliveryChargeValue.trim() || "0" : "0",
        },
        bankQr: {
          showQr: orderPaymentMethod === "bank_qr" && hasQr,
          showBankDetails: orderPaymentMethod === "bank_qr" && hasBankDetails,
          qrBlobPath: qrBlobPath.trim(),
          qrImageUrl: bankQrImageUrl.trim(),
          bankName: normalizedBankName,
          accountName: normalizedAccountName,
          accountNumber: normalizedAccountNumber,
          accountInstructions: normalizedInstructions,
        },
      });
      await businessQuery.refetch();
      setPaymentModalOpen(false);
      showSuccessToast(toast, {
        title: "Payment settings updated",
        message: "Order payment settings were saved successfully.",
      });
    } catch {
      showErrorToast(toast, {
        title: "Save failed",
        message: "Payment settings could not be saved.",
      });
    }
  };

  const handleSaveBranding = async () => {
    if (!email || !businessQuery.data?.id) return;
    try {
      await updateCustomizationSettings.mutateAsync({
        email,
        businessId: businessQuery.data.id,
        businessName: customBusinessName.trim(),
        logoBlobPath: customLogoBlobPath.trim(),
        logoContainer: customLogoContainer.trim(),
        logoUrl: customLogoUrl.trim(),
        primaryColor: customPrimaryColor.trim() || DEFAULT_CUSTOMIZATION_SETTINGS.primaryColor,
        secondaryColor: customSecondaryColor.trim() || DEFAULT_CUSTOMIZATION_SETTINGS.secondaryColor,
        address: customAddress.trim(),
        phone: customPhone.trim(),
        emailAddress: customEmail.trim(),
        website: customWebsite.trim(),
        invoiceFooterNote: customInvoiceFooterNote.trim(),
      });
      await businessQuery.refetch();
      await customizationPreviewQuery.refetch();
      setBrandingModalOpen(false);
      showSuccessToast(toast, {
        title: "Customization updated",
        message: "Invoice branding was saved successfully.",
      });
    } catch {
      showErrorToast(toast, {
        title: "Save failed",
        message: "Invoice branding could not be saved.",
      });
    }
  };

  const handleUploadQrImage = async (file: File) => {
    if (!file) return;
    setQrUploadPending(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetchWithFirebaseAuth(
        "/api/settings/order-flow/qr-upload",
        { method: "POST", body: form },
        { action: "settings-upload-order-qr", area: "business", route: "/settings" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload?.error || "QR upload failed."));
      setQrBlobPath(String(payload?.qrBlobPath || "").trim());
      setBankQrImageUrl(String(payload?.qrImageUrl || "").trim());
      showSuccessToast(toast, {
        title: "QR image uploaded",
        message: "The QR image is ready to be used in payment instructions.",
      });
    } catch (error) {
      showErrorToast(toast, {
        title: "Upload failed",
        message: error instanceof Error ? error.message : "QR image upload failed.",
      });
    } finally {
      setQrUploadPending(false);
    }
  };

  const handleUploadLogoImage = async (file: File) => {
    if (!file) return;
    setLogoUploadPending(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetchWithFirebaseAuth(
        "/api/settings/customization/logo-upload",
        { method: "POST", body: form },
        { action: "settings-upload-custom-logo", area: "business", route: "/settings" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload?.error || "Logo upload failed."));
      setCustomLogoBlobPath(String(payload?.logoBlobPath || "").trim());
      setCustomLogoContainer(String(payload?.logoContainer || "").trim());
      setCustomLogoUrl(String(payload?.logoUrl || "").trim());
      showSuccessToast(toast, {
        title: "Logo uploaded",
        message: "The invoice logo is ready for previews and PDFs.",
      });
    } catch (error) {
      showErrorToast(toast, {
        title: "Upload failed",
        message: error instanceof Error ? error.message : "Logo upload failed.",
      });
    } finally {
      setLogoUploadPending(false);
    }
  };

  const handleConnectGmail = async () => {
    if (gmailConnectPending) return;
    setGmailConnectPending(true);
    try {
      const idToken = await getFirebaseIdTokenOrThrow({
        action: "settings-connect-gmail",
        area: "business",
        route: "/settings",
      });
      const nextUrl = new URL("/api/auth/gmail/connect", window.location.origin);
      nextUrl.searchParams.set("idToken", idToken);
      nextUrl.searchParams.set("returnTo", "/settings");
      window.location.assign(nextUrl.toString());
    } catch (error) {
      showErrorToast(toast, {
        title: "Gmail connection failed",
        message: error instanceof Error ? error.message : "Could not start Gmail connection.",
      });
      setGmailConnectPending(false);
    }
  };

  const handleDisconnectGmail = async () => {
    if (!email || !businessQuery.data?.id) return;
    try {
      await disconnectGmail.mutateAsync({ email, businessId: businessQuery.data.id });
      await businessQuery.refetch();
      showSuccessToast(toast, {
        title: "Gmail disconnected",
        message: "Order emails will pause until a company Gmail account is connected again.",
      });
    } catch {
      showErrorToast(toast, {
        title: "Disconnect failed",
        message: "The Gmail connection could not be removed.",
      });
    }
  };

  const openWebsiteWidgetModal = async () => {
    if (!email || !businessQuery.data?.id) {
      showErrorToast(toast, {
        title: "Unable to prepare widget",
        message: "Your business session is missing. Refresh and try again.",
      });
      return;
    }
    try {
      const result = await ensureWebsiteWidget.mutateAsync({ email, businessId: businessQuery.data.id });
      if (!result.key) throw new Error("Widget key was not generated.");
      setWidgetSnippet(buildWebsiteWidgetSnippet(window.location.origin, result.key));
      setWidgetModalOpen(true);
    } catch (error) {
      showErrorToast(toast, {
        title: "Widget setup failed",
        message: error instanceof Error ? error.message : "Could not generate widget snippet.",
      });
    }
  };

  const copyWidgetSnippet = async () => {
    try {
      await navigator.clipboard.writeText(widgetSnippet);
      showSuccessToast(toast, {
        title: "Snippet copied",
        message: "Paste it into your website or Wix custom code block.",
      });
    } catch {
      showErrorToast(toast, {
        title: "Copy failed",
        message: "Copy the snippet manually from the code box.",
      });
    }
  };

  const business = businessQuery.data;
  const gmailConnected = Boolean(business?.gmailConnected);
  const gmailAddress = String(business?.gmailEmail || "").trim();
  const gmailError = describeCompanyGmailError(business?.gmailError);
  const websiteWidget = (business as { websiteWidgetSettings?: ReturnType<typeof normalizeWebsiteWidgetSettings> } | undefined)
    ?.websiteWidgetSettings ?? normalizeWebsiteWidgetSettings(business?.settings);
  const whatsappConnected = (phoneNumbersQuery.data?.length ?? 0) > 0;
  const whatsappConnectBlocked = Boolean(accessStatusQuery.data && !accessStatusQuery.data.canConnectWhatsapp);
  const whatsappConnectReason = whatsappConnectBlocked
    ? "WhatsApp connection is blocked until this tenant has an active paid plan, demo grant, or partner grant."
    : null;

  const paymentMethodLabel = {
    manual: "Manual review",
    bank_qr: "Bank / QR",
    cod: "Cash on delivery",
  }[orderPaymentMethod];

  const profileDisplayName = customBusinessName || business?.name || "Business";
  const profilePhone = customPhone || "No phone";
  const profileEmail = customEmail || email || "No email";
  const profileAddress = customAddress || "No address";
  const bookingWindow = openTime && closeTime ? `${openTime} - ${closeTime}` : "Not configured";
  const customizationPreviewUrl = customizationPreviewQuery.data?.invoicePreviewUrl || "";
  const trackingPreviewUrl = customizationPreviewQuery.data?.trackingPreviewUrl || "";

  const renderProfileTab = () => (
    <div className="space-y-6 p-6">
      <SectionCard
        icon={<User className="h-5 w-5" />}
        title="Account Details"
        description="Profile access, password, and sign-out controls."
        action={
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex rounded-lg bg-[#20324a] p-1">
              {(["light", "dark"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setTheme(option)}
                  className={`inline-flex min-h-10 items-center gap-2 rounded-md px-4 text-sm font-semibold transition ${
                    theme === option ? "bg-[#c7a64f] text-[#0f172a]" : "text-slate-300 hover:text-white"
                  }`}
                >
                  {option === "light" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                  {option === "light" ? "Light" : "Dark"}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setPasswordModalOpen(true)}
              className="inline-flex h-11 items-center justify-center rounded-lg border border-white/10 bg-white/5 px-5 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              <Lock className="mr-2 h-4 w-4" />
              Change Password
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex h-11 items-center justify-center rounded-lg border border-red-400/25 bg-red-400/10 px-5 text-sm font-semibold text-red-300 transition hover:bg-red-400/15"
            >
              Sign Out
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="grid gap-3 xl:grid-cols-[1fr_1fr]">
            <div className="rounded-xl border border-[#35516f] bg-[#20324a] p-4">
              <label className="mb-2 block text-xs font-medium text-slate-400">Display Name</label>
              <div className="flex items-center gap-3">
                <input
                  readOnly
                  value={email?.split("@")[0] || "User"}
                  className="h-10 flex-1 rounded-[10px] border border-[#35516f] bg-[#14304b] px-4 text-sm text-slate-200 outline-none"
                />
                <button
                  type="button"
                  onClick={() => setProfileModalOpen(true)}
                  className="inline-flex h-10 items-center justify-center rounded-md bg-[#1656d8] px-4 text-sm font-semibold text-white transition hover:brightness-110"
                >
                  Edit
                </button>
              </div>
            </div>
            <div className="rounded-xl border border-[#35516f] bg-[#20324a] p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-white">Company Access</div>
                  <div className="mt-1 text-sm text-slate-400">Currently connected to {business?.name || "your business"}.</div>
                </div>
                <button
                  type="button"
                  disabled
                  className="inline-flex h-10 items-center justify-center rounded-md border border-[#45607d] bg-transparent px-4 text-sm font-semibold text-slate-300 opacity-80"
                >
                  Current Workspace
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-[#35516f] bg-[#20324a] px-4 py-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-sm font-semibold text-white">Company Gmail Invoice Sender</div>
                <div className="mt-1 text-sm text-slate-400">
                  {gmailConnected
                    ? `Connected for this company as ${gmailAddress || "the connected Gmail account"}`
                    : "No company Gmail connected for invoice updates yet."}
                </div>
                {gmailError ? <div className="mt-2 text-sm text-red-300">{gmailError}</div> : null}
              </div>
              <div className="flex flex-wrap gap-3">
                {gmailConnected ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleConnectGmail()}
                      disabled={gmailConnectPending}
                      className="inline-flex h-10 items-center justify-center rounded-md bg-[#1656d8] px-4 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
                    >
                      {gmailConnectPending ? "Connecting..." : "Reconnect"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDisconnectGmail()}
                      disabled={disconnectGmail.isPending}
                      className="inline-flex h-10 items-center justify-center rounded-md border border-red-400/25 bg-red-400/10 px-4 text-sm font-semibold text-red-300 transition hover:bg-red-400/15 disabled:opacity-60"
                    >
                      {disconnectGmail.isPending ? "Disconnecting..." : "Disconnect"}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleConnectGmail()}
                    disabled={gmailConnectPending}
                    className="inline-flex h-10 items-center justify-center rounded-md bg-[#1656d8] px-4 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
                  >
                    {gmailConnectPending ? "Connecting..." : "Connect Gmail"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <section className="rounded-xl border border-white/10 bg-[#1c2839]/95 p-5 shadow-[0_12px_28px_rgba(2,6,23,0.16)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#d8b45a]/10 text-[#d8b45a]">
                <Building2 className="h-5 w-5" />
              </div>
              <h2 className="mt-4 text-lg font-semibold text-white">Business profile</h2>
              <p className="mt-1 text-sm text-slate-400">Customer-facing identity and contact details.</p>
            </div>
            <button
              type="button"
              onClick={() => setProfileModalOpen(true)}
              className="rounded-full border border-[#d8b45a]/35 px-3 py-2 text-sm font-semibold text-[#d8b45a] transition hover:bg-[#d8b45a]/10"
            >
              Edit
            </button>
          </div>
          <div className="mt-5 space-y-3 text-sm">
            <div className="flex items-start gap-3">
              <Building2 className="mt-0.5 h-4 w-4 text-slate-500" />
              <div>
                <p className="font-semibold text-white">{profileDisplayName}</p>
                <p className="text-slate-400">Agent concierge workspace</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <MapPin className="mt-0.5 h-4 w-4 text-slate-500" />
              <p className="text-slate-300">{profileAddress}</p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="flex items-center gap-2 rounded-lg bg-[#20324a] px-3 py-2">
                <Phone className="h-4 w-4 text-slate-500" />
                <span className="truncate text-slate-300">{profilePhone}</span>
              </div>
              <div className="flex items-center gap-2 rounded-lg bg-[#20324a] px-3 py-2">
                <Mail className="h-4 w-4 text-slate-500" />
                <span className="truncate text-slate-300">{profileEmail}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-white/10 bg-[#1c2839]/95 p-5 shadow-[0_12px_28px_rgba(2,6,23,0.16)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#d8b45a]/10 text-[#d8b45a]">
                <Clock3 className="h-5 w-5" />
              </div>
              <h2 className="mt-4 text-lg font-semibold text-white">Business hours</h2>
              <p className="mt-1 text-sm text-slate-400">Opening window used by the widget and calendar.</p>
            </div>
            <button
              type="button"
              onClick={() => setBookingModalOpen(true)}
              className="rounded-full border border-[#d8b45a]/35 px-3 py-2 text-sm font-semibold text-[#d8b45a] transition hover:bg-[#d8b45a]/10"
            >
              Edit
            </button>
          </div>
          <div className="mt-5 rounded-xl border border-white/10 bg-[#20324a] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Open window</p>
            <p className="mt-2 text-2xl font-semibold text-white">{bookingWindow}</p>
            <p className="mt-2 text-sm text-slate-400">{bookingsEnabled ? "Bookings follow the configured concierge intake window." : "Bookings are disabled right now."}</p>
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
              <span
                key={day}
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                  bookingsEnabled
                    ? "bg-emerald-400/10 text-emerald-300"
                    : "bg-[#20324a] text-slate-500"
                }`}
              >
                {day}
              </span>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-white/10 bg-[#1c2839]/95 p-5 shadow-[0_12px_28px_rgba(2,6,23,0.16)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#d8b45a]/10 text-[#d8b45a]">
                <Settings2 className="h-5 w-5" />
              </div>
              <h2 className="mt-4 text-lg font-semibold text-white">Workspace defaults</h2>
              <p className="mt-1 text-sm text-slate-400">Timezone, flow, payment, and invoice basics.</p>
            </div>
            <button
              type="button"
              onClick={() => setPaymentModalOpen(true)}
              className="rounded-full border border-[#d8b45a]/35 px-3 py-2 text-sm font-semibold text-[#d8b45a] transition hover:bg-[#d8b45a]/10"
            >
              Edit
            </button>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <div className="rounded-xl bg-[#20324a] p-3">
              <p className="text-xs text-slate-400">Timezone</p>
              <p className="mt-1 truncate font-semibold text-white">{timezone}</p>
            </div>
            <div className="rounded-xl bg-[#20324a] p-3">
              <p className="text-xs text-slate-400">Slot length</p>
              <p className="mt-1 font-semibold text-white">{timeslotMinutes} min</p>
            </div>
            <div className="rounded-xl bg-[#20324a] p-3">
              <p className="text-xs text-slate-400">Flow</p>
              <p className="mt-1 font-semibold text-white">Order queue</p>
            </div>
            <div className="rounded-xl bg-[#20324a] p-3">
              <p className="text-xs text-slate-400">Invoices</p>
              <p className="mt-1 font-semibold text-white">Enabled</p>
            </div>
            <div className="rounded-xl bg-[#20324a] p-3">
              <p className="text-xs text-slate-400">Payment</p>
              <p className="mt-1 font-semibold text-white">{paymentMethodLabel}</p>
            </div>
            <div className="rounded-xl bg-[#20324a] p-3">
              <p className="text-xs text-slate-400">Delivery charge</p>
              <p className="mt-1 font-semibold text-white">{deliveryChargeEnabled ? "Enabled" : "Disabled"}</p>
            </div>
          </div>
        </section>
      </div>

      <SectionCard
        icon={<CreditCard className="h-5 w-5" />}
        title="Payment Setup"
        description="Collection mode, currency, bank details, QR asset, and delivery charging rules used in order checkout."
        action={
          <button
            type="button"
            onClick={() => setPaymentModalOpen(true)}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-[#c7a64f] px-4 text-sm font-semibold text-[#0f172a] transition hover:brightness-105"
          >
            Save Payment
          </button>
        }
      >
        <div className="space-y-5">
          <div className="grid gap-4 xl:grid-cols-[220px_1fr]">
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Currency</div>
              <div className="rounded-xl border border-white/10 bg-[#20324a] px-4 py-3 text-white">{orderCurrency || "LKR"}</div>
            </div>
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Collection method</div>
              <div className="grid gap-3 md:grid-cols-3">
                {[
                  { id: "manual", label: "Manual review", desc: "Let staff confirm cash, POS, or custom payment notes manually." },
                  { id: "bank_qr", label: "Bank / QR", desc: "Show transfer instructions, bank details, and optional QR in checkout." },
                  { id: "cod", label: "No upfront collection", desc: "Let customers complete the order without payment instructions." },
                ].map((option) => {
                  const active = orderPaymentMethod === option.id;
                  return (
                    <div
                      key={option.id}
                      className={`rounded-xl border p-4 ${
                        active ? "border-[#d8b45a] bg-[#d8b45a]/10" : "border-white/10 bg-[#20324a]"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-white">{option.label}</div>
                          <div className="mt-2 text-sm leading-6 text-slate-400">{option.desc}</div>
                        </div>
                        <span className={`mt-1 h-3 w-3 rounded-full border ${active ? "border-[#d8b45a] bg-[#d8b45a]" : "border-[#6482a8]"}`} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-emerald-400/12 bg-[#15363b]/95 p-4">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <div className="text-lg font-semibold text-white">Bank / QR details</div>
                <div className="mt-1 text-sm text-slate-400">These instructions are shown when customers choose Bank / QR.</div>
              </div>
              <button
                type="button"
                onClick={() => setPaymentModalOpen(true)}
                className="rounded-full border border-[#d8b45a]/35 px-3 py-2 text-sm font-semibold text-[#d8b45a] transition hover:bg-[#d8b45a]/10"
              >
                Edit
              </button>
            </div>
            <div className="grid gap-4 xl:grid-cols-3">
              <FieldTile label="Bank" value={bankName || "Not set"} />
              <FieldTile label="Account Name" value={accountName || "Not set"} />
              <FieldTile label="Account Number" value={accountNumber || "Not set"} />
            </div>
            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              <FieldTile label="QR Image" value={bankQrImageUrl ? "Uploaded" : "Not uploaded"} />
              <FieldTile label="Instructions" value={accountInstructions || "No transfer instructions configured."} />
            </div>
          </div>
        </div>
      </SectionCard>

    </div>
  );

  const renderBookingTab = () => (
    <div className="space-y-6 p-6">
      <SectionCard
        icon={<Calendar className="h-5 w-5" />}
        title="Booking Configuration"
        description="Toggle concierge booking intake here. Shared defaults stay in the profile workspace cards."
        action={
          <button
            type="button"
            onClick={() => setBookingModalOpen(true)}
            className="inline-flex h-11 items-center justify-center rounded-lg border border-[#d8b45a]/35 bg-[#d8b45a]/12 px-5 text-sm font-semibold text-[#d8b45a] transition hover:bg-[#d8b45a]/18"
          >
            Edit
          </button>
        }
      >
        <div className="flex items-center justify-between rounded-xl border border-white/10 bg-[#20324a] px-4 py-4">
          <div>
            <div className="text-base font-semibold text-white">Enable Bookings</div>
            <div className="mt-1 text-sm text-slate-400">Allow customers to book appointments through WhatsApp.</div>
          </div>
          <Toggle checked={bookingsEnabled} onChange={setBookingsEnabled} />
        </div>
        <div className="mt-4 rounded-xl border border-white/10 bg-[#20324a] px-4 py-5 text-sm leading-6 text-slate-400">
          {bookingsEnabled
            ? "Booking intake is active. Use the shared cards on the Profile tab to review the current slot window and workspace defaults."
            : "Bookings are disabled. Enable them here, then adjust slot length and opening window from the shared profile cards."}
        </div>
      </SectionCard>
    </div>
  );

  const renderCustomizationTab = () => (
    <div className="space-y-6 p-6">
      <SectionCard
        icon={<Palette className="h-5 w-5" />}
        title="Customization"
        description="Keep the branding summary lightweight here, then open the editor modal to update logo and palette."
        action={
          <button
            type="button"
            onClick={() => setBrandingModalOpen(true)}
            className="inline-flex h-11 items-center justify-center rounded-lg border border-[#d8b45a]/35 bg-[#d8b45a]/12 px-5 text-sm font-semibold text-[#d8b45a] transition hover:bg-[#d8b45a]/18"
          >
            Edit Branding
          </button>
        }
      >
        <div className="space-y-5">
          <div>
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Tracking link preview</div>
            <div className="flex flex-col gap-3 lg:flex-row">
              <input
                readOnly
                value={trackingPreviewUrl || "Generating tracking preview..."}
                className="h-12 flex-1 rounded-xl border border-white/10 bg-[#14304b] px-4 text-sm text-slate-200 outline-none"
              />
              <a
                href={trackingPreviewUrl || undefined}
                target="_blank"
                rel="noreferrer"
                className={`inline-flex h-12 items-center justify-center rounded-lg px-5 text-sm font-semibold transition ${
                  trackingPreviewUrl ? "bg-[#1656d8] text-white hover:brightness-110" : "pointer-events-none bg-white/10 text-slate-500"
                }`}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Open Preview
              </a>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-[#1A2332]/95 p-5 shadow-[0_12px_28px_rgba(2,6,23,0.16)]">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 overflow-hidden rounded-xl border border-white/10 bg-[#20324a]">
                  {customLogoUrl ? (
                    <Image src={customLogoUrl} alt="Brand logo" width={64} height={64} unoptimized className="h-full w-full object-contain" />
                  ) : (
                    <div className="grid h-full w-full place-items-center text-xs text-slate-500">No logo</div>
                  )}
                </div>
                <div>
                  <div className="text-xl font-semibold text-white">{profileDisplayName}</div>
                  <div className="mt-2 text-sm text-slate-400">/track/orders/preview/{business?.id || "workspace"}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setBrandingModalOpen(true)}
                className="inline-flex h-11 items-center justify-center rounded-md bg-[#c7a64f] px-5 text-sm font-semibold text-[#0f172a] transition hover:brightness-105"
              >
                Edit branding
              </button>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <FieldTile
                label="Primary"
                value={<div className="flex items-center gap-3"><span className="h-6 w-6 rounded-md border border-white/10" style={{ backgroundColor: customPrimaryColor }} />{customPrimaryColor}</div>}
              />
              <FieldTile
                label="Accent"
                value={<div className="flex items-center gap-3"><span className="h-6 w-6 rounded-md border border-white/10" style={{ backgroundColor: customSecondaryColor }} />{customSecondaryColor}</div>}
              />
              <FieldTile label="Assets" value={customLogoUrl ? "Logo set" : "No logo"} />
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        icon={<BookOpenText className="h-5 w-5" />}
        title="Invoice Preview"
        description="This uses the real invoice generator with sample order data and the current workspace branding."
      >
        <div className="space-y-4">
          <div className="flex justify-end">
            <a
              href={customizationPreviewUrl || undefined}
              target="_blank"
              rel="noreferrer"
              className={`inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-semibold transition ${
                customizationPreviewUrl ? "bg-[#1656d8] text-white hover:brightness-110" : "pointer-events-none bg-white/10 text-slate-500"
              }`}
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              Open PDF
            </a>
          </div>
          <div className="overflow-hidden rounded-xl border border-white/10 bg-[#102034]">
            {customizationPreviewQuery.isLoading ? (
              <div className="grid min-h-[720px] place-items-center text-sm text-slate-400">Generating invoice preview...</div>
            ) : customizationPreviewUrl ? (
              <iframe
                title="Invoice preview PDF"
                src={`${customizationPreviewUrl}#toolbar=0&navpanes=0&scrollbar=1`}
                className="h-[920px] w-full bg-white"
              />
            ) : (
              <div className="grid min-h-[720px] place-items-center text-sm text-slate-400">Invoice preview could not be generated.</div>
            )}
          </div>
        </div>
      </SectionCard>
    </div>
  );

  const renderTabContent = () => {
    switch (activeTab) {
      case "profile":
        return renderProfileTab();
      case "booking":
        return renderBookingTab();
      case "customization":
        return renderCustomizationTab();
      case "connections":
        return (
          <ConnectionsTab
            businessQuery={businessQuery}
            email={email}
            whatsappConnected={whatsappConnected}
            whatsappConnectBlocked={whatsappConnectBlocked}
            whatsappConnectReason={whatsappConnectReason}
            phoneNumbersQuery={phoneNumbersQuery}
            openWebsiteWidgetModal={openWebsiteWidgetModal}
            websiteWidget={websiteWidget}
            ensureWebsiteWidget={ensureWebsiteWidget}
          />
        );
      case "agents":
        return <AgentsTab />;
      case "users":
        return <UsersPermissionsPanel />;
      case "flowbuilder":
        return <FlowBuilderContent />;
      case "subscription":
        return <SubscriptionContent />;
      default:
        return null;
    }
  };

  if (!email) {
    return (
      <div className="grid h-full place-items-center bg-[var(--settings-page-bg)] text-slate-300">
        Loading settings...
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--settings-page-bg)]">
      {passwordModalOpen ? (
        <ModalShell
          eyebrow="Account"
          title="Change password"
          description="Confirm your current password, then set a new one for this account."
          onClose={() => !passwordPending && setPasswordModalOpen(false)}
          widthClassName="max-w-2xl"
          footer={
            <>
              <button
                type="button"
                onClick={() => setPasswordModalOpen(false)}
                disabled={passwordPending}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-5 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleChangePassword()}
                disabled={passwordPending}
                className="inline-flex h-11 items-center justify-center rounded-xl bg-[#c7a64f] px-5 text-sm font-semibold text-[#0f172a] transition hover:brightness-105 disabled:opacity-60"
              >
                {passwordPending ? "Updating..." : "Update Password"}
              </button>
            </>
          }
        >
          <div className="grid gap-4">
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9db7d3]">Current Password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                className="h-12 w-full rounded-xl border border-[#45607d] bg-[#14304b] px-4 text-sm text-white outline-none transition focus:border-[#5c7ba0] focus:ring-2 focus:ring-[#2f6bb2]/30"
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9db7d3]">New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className="h-12 w-full rounded-xl border border-[#45607d] bg-[#14304b] px-4 text-sm text-white outline-none transition focus:border-[#5c7ba0] focus:ring-2 focus:ring-[#2f6bb2]/30"
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9db7d3]">Confirm New Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="h-12 w-full rounded-xl border border-[#45607d] bg-[#14304b] px-4 text-sm text-white outline-none transition focus:border-[#5c7ba0] focus:ring-2 focus:ring-[#2f6bb2]/30"
              />
            </div>
            {passwordError ? (
              <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-300">{passwordError}</div>
            ) : null}
          </div>
        </ModalShell>
      ) : null}

      {profileModalOpen ? (
        <ModalShell
          eyebrow="Profile"
          title="Edit business profile"
          description="Keep the profile page clean by editing business details, invoice contact information, and timezone here."
          onClose={() => setProfileModalOpen(false)}
          footer={
            <>
              <button
                type="button"
                onClick={() => setProfileModalOpen(false)}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-5 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSaveProfileDetails()}
                disabled={updateCustomizationSettings.isPending || updateTimezone.isPending}
                className="inline-flex h-11 items-center justify-center rounded-xl bg-[#c7a64f] px-5 text-sm font-semibold text-[#0f172a] transition hover:brightness-105 disabled:opacity-60"
              >
                Save Profile
              </button>
            </>
          }
        >
          <div className="grid gap-5 xl:grid-cols-2">
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9db7d3]">Business Name</label>
              <input value={customBusinessName} onChange={(e) => setCustomBusinessName(e.target.value)} className="h-12 w-full rounded-xl border border-[#45607d] bg-[#14304b] px-4 text-sm text-white outline-none transition focus:border-[#5c7ba0] focus:ring-2 focus:ring-[#2f6bb2]/30" />
            </div>
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9db7d3]">Business Timezone (IANA)</label>
              <input value={timezone} onChange={(e) => setTimezone(e.target.value)} className="h-12 w-full rounded-xl border border-[#45607d] bg-[#14304b] px-4 text-sm text-white outline-none transition focus:border-[#5c7ba0] focus:ring-2 focus:ring-[#2f6bb2]/30" />
            </div>
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9db7d3]">Phone</label>
              <input value={customPhone} onChange={(e) => setCustomPhone(e.target.value)} className="h-12 w-full rounded-xl border border-[#45607d] bg-[#14304b] px-4 text-sm text-white outline-none transition focus:border-[#5c7ba0] focus:ring-2 focus:ring-[#2f6bb2]/30" />
            </div>
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9db7d3]">Email</label>
              <input value={customEmail} onChange={(e) => setCustomEmail(e.target.value)} className="h-12 w-full rounded-xl border border-[#45607d] bg-[#14304b] px-4 text-sm text-white outline-none transition focus:border-[#5c7ba0] focus:ring-2 focus:ring-[#2f6bb2]/30" />
            </div>
            <div className="xl:col-span-2">
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9db7d3]">Website</label>
              <input value={customWebsite} onChange={(e) => setCustomWebsite(e.target.value)} className="h-12 w-full rounded-xl border border-[#45607d] bg-[#14304b] px-4 text-sm text-white outline-none transition focus:border-[#5c7ba0] focus:ring-2 focus:ring-[#2f6bb2]/30" />
            </div>
            <div className="xl:col-span-2">
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9db7d3]">Address</label>
              <textarea value={customAddress} onChange={(e) => setCustomAddress(e.target.value)} className="min-h-[120px] w-full rounded-xl border border-[#45607d] bg-[#14304b] px-4 py-3 text-sm text-white outline-none transition focus:border-[#5c7ba0] focus:ring-2 focus:ring-[#2f6bb2]/30" />
            </div>
            <div className="xl:col-span-2">
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9db7d3]">Invoice Footer Note</label>
              <textarea value={customInvoiceFooterNote} onChange={(e) => setCustomInvoiceFooterNote(e.target.value)} className="min-h-[120px] w-full rounded-xl border border-[#45607d] bg-[#14304b] px-4 py-3 text-sm text-white outline-none transition focus:border-[#5c7ba0] focus:ring-2 focus:ring-[#2f6bb2]/30" />
            </div>
          </div>
        </ModalShell>
      ) : null}

      {bookingModalOpen ? (
        <ModalShell
          eyebrow="Booking"
          title="Edit booking configuration"
          description="Adjust appointment intake rules without exposing all controls on the main page."
          onClose={() => setBookingModalOpen(false)}
          footer={
            <>
              <button type="button" onClick={() => setBookingModalOpen(false)} className="inline-flex h-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-5 text-sm font-semibold text-white transition hover:bg-white/10">
                Cancel
              </button>
              <button type="button" onClick={() => void handleSaveBookingSettings()} disabled={updateBooking.isPending} className="inline-flex h-11 items-center justify-center rounded-xl bg-[#c7a64f] px-5 text-sm font-semibold text-[#0f172a] transition hover:brightness-105 disabled:opacity-60">
                Save Changes
              </button>
            </>
          }
        >
          <div className="space-y-6">
            <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-[#20324a] px-4 py-4">
              <div>
                <div className="text-base font-semibold text-white">Enable Bookings</div>
                <div className="mt-1 text-sm text-slate-400">Allow customers to book appointments through WhatsApp.</div>
              </div>
              <Toggle checked={bookingsEnabled} onChange={setBookingsEnabled} />
            </div>
            {bookingsEnabled ? (
              <>
                <div className="grid gap-5 xl:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9db7d3]">Slot Capacity</label>
                    <input type="number" min={1} value={unitCapacity} onChange={(e) => setUnitCapacity(parseInt(e.target.value, 10) || 1)} className="h-12 w-full rounded-xl border border-[#45607d] bg-[#14304b] px-4 text-sm text-white outline-none transition focus:border-[#5c7ba0] focus:ring-2 focus:ring-[#2f6bb2]/30" />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9db7d3]">Slot Length</label>
                    <PortalSelect
                      value={String(timeslotMinutes)}
                      onValueChange={(value) => setTimeslotMinutes(parseInt(value, 10))}
                      options={[
                        { value: "15", label: "15 minutes" },
                        { value: "30", label: "30 minutes" },
                        { value: "45", label: "45 minutes" },
                        { value: "60", label: "1 hour" },
                        { value: "90", label: "1.5 hours" },
                        { value: "120", label: "2 hours" },
                      ]}
                      ariaLabel="Timeslot duration"
                      style={{ minHeight: 48, borderRadius: 14 }}
                    />
                  </div>
                </div>
                <div className="grid gap-5 xl:grid-cols-[1fr_auto_1fr] xl:items-end">
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9db7d3]">Opening Time</label>
                    <input type="time" value={openTime} onChange={(e) => setOpenTime(e.target.value)} className="h-12 w-full rounded-xl border border-[#45607d] bg-[#14304b] px-4 text-sm text-white outline-none transition focus:border-[#5c7ba0] focus:ring-2 focus:ring-[#2f6bb2]/30" />
                  </div>
                  <div className="pb-3 text-sm font-semibold text-slate-400">to</div>
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9db7d3]">Closing Time</label>
                    <input type="time" value={closeTime} onChange={(e) => setCloseTime(e.target.value)} className="h-12 w-full rounded-xl border border-[#45607d] bg-[#14304b] px-4 text-sm text-white outline-none transition focus:border-[#5c7ba0] focus:ring-2 focus:ring-[#2f6bb2]/30" />
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-[#20324a] px-4 py-5 text-sm leading-6 text-slate-400">
                Turn bookings on to configure appointment capacity, time slot duration, and operating hours.
              </div>
            )}
          </div>
        </ModalShell>
      ) : null}

      {paymentModalOpen ? (
        <ModalShell
          eyebrow="Payment Setup"
          title="Set up payment collection"
          description="Keep the main settings page simple while editing collection mode, bank details, QR image, and checkout rules here."
          onClose={() => setPaymentModalOpen(false)}
          footer={
            <>
              <button type="button" onClick={() => setPaymentModalOpen(false)} className="inline-flex h-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-5 text-sm font-semibold text-white transition hover:bg-white/10">
                Cancel
              </button>
              <button type="button" onClick={() => void handleSaveOrderSettings()} disabled={updateOrderSettings.isPending || qrUploadPending} className="inline-flex h-11 items-center justify-center rounded-xl bg-[#c7a64f] px-5 text-sm font-semibold text-[#0f172a] transition hover:brightness-105 disabled:opacity-60">
                Use {paymentMethodLabel}
              </button>
            </>
          }
        >
          <div className="space-y-6">
            <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9db7d3]">Currency</label>
                <input value={orderCurrency} onChange={(e) => setOrderCurrency(e.target.value.toUpperCase())} className="h-12 w-full rounded-xl border border-[#45607d] bg-[#14304b] px-4 text-sm text-white outline-none transition focus:border-[#5c7ba0] focus:ring-2 focus:ring-[#2f6bb2]/30" />
              </div>
              <div>
                <label className="mb-3 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9db7d3]">Collection Method</label>
                <div className="grid gap-4 xl:grid-cols-3">
                  {[
                    { value: "manual", title: "Manual review", copy: "Let staff confirm cash, POS, or custom payment notes manually." },
                    { value: "bank_qr", title: "Bank / QR", copy: "Show transfer instructions, bank details, and optional QR in checkout." },
                    { value: "cod", title: "Cash on delivery", copy: "Let customers pay when the delivered order reaches them." },
                  ].map((option) => {
                    const active = orderPaymentMethod === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setOrderPaymentMethod(option.value as OrderPaymentMethod)}
                        className={`rounded-2xl border px-5 py-4 text-left transition ${active ? "border-[#d8b45a] bg-[#d8b45a]/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]" : "border-white/10 bg-[#20324a] hover:border-white/20"}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-lg font-semibold text-white">{option.title}</div>
                          <span className={`h-4 w-4 rounded-full border ${active ? "border-[#d8b45a] bg-[#d8b45a]" : "border-slate-500"}`} />
                        </div>
                        <div className="mt-3 text-sm leading-6 text-slate-400">{option.copy}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="rounded-[24px] border border-white/10 bg-[#173244] p-5">
              <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-4">
                <div>
                  <div className="text-lg font-semibold text-white">Delivery Charge</div>
                  <div className="mt-1 text-sm text-slate-400">Disabled means checkout still asks delivery or pickup, but delivery stays free.</div>
                </div>
                <Toggle
                  checked={deliveryChargeEnabled}
                  onChange={(checked) => {
                    setDeliveryChargeEnabled(checked);
                    if (checked) {
                      setDeliveryChargeType("fixed");
                      setDeliveryChargeValue("0");
                    }
                  }}
                />
              </div>
              {deliveryChargeEnabled ? (
                <div className="mt-5 grid gap-5 xl:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9db7d3]">Delivery Cost Type</label>
                    <PortalSelect
                      value={deliveryChargeType}
                      onValueChange={(value) => setDeliveryChargeType(value as OrderDeliveryChargeType)}
                      options={[
                        { value: "fixed", label: "Fixed Amount" },
                        { value: "percentage", label: "Percentage" },
                      ]}
                      ariaLabel="Delivery charge type"
                      style={{ minHeight: 48, borderRadius: 14 }}
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9db7d3]">
                      {deliveryChargeType === "percentage" ? "Delivery Percentage" : "Delivery Amount"}
                    </label>
                    <input value={deliveryChargeValue} onChange={(e) => setDeliveryChargeValue(e.target.value)} className="h-12 w-full rounded-xl border border-[#45607d] bg-[#14304b] px-4 text-sm text-white outline-none transition focus:border-[#5c7ba0] focus:ring-2 focus:ring-[#2f6bb2]/30" />
                  </div>
                </div>
              ) : null}
            </div>

            {orderPaymentMethod === "bank_qr" ? (
              <>
                <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
                  <div className="rounded-[24px] border border-white/10 bg-[#20324a] p-5">
                    <div className="text-lg font-semibold text-white">QR Payment</div>
                    <div className="mt-2 text-sm leading-6 text-slate-400">
                      Upload the QR image once. It is stored privately and can be reused in payment instructions.
                    </div>
                    <div className="mt-5 space-y-4">
                      <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-[#14304b] px-4 py-4">
                        <div>
                          <div className="font-medium text-white">Payment Proof AI Check</div>
                          <div className="mt-1 text-sm text-slate-400">Check uploaded bank slips with AI before staff review.</div>
                        </div>
                        <Toggle checked={paymentProofAiEnabled} onChange={setPaymentProofAiEnabled} />
                      </div>
                      <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-[#14304b] px-4 py-4">
                        <div>
                          <div className="font-medium text-white">Require Payment Slip</div>
                          <div className="mt-1 text-sm text-slate-400">Customers must send a payment slip image or PDF.</div>
                        </div>
                        <Toggle checked={paymentSlipRequired} onChange={setPaymentSlipRequired} />
                      </div>
                      <div className="rounded-2xl border border-dashed border-white/10 bg-[#14304b] p-4">
                        {bankQrImageUrl ? (
                          <Image src={bankQrImageUrl} alt="Uploaded QR" width={260} height={260} unoptimized className="mx-auto rounded-2xl border border-white/10 bg-white object-contain" />
                        ) : (
                          <div className="grid min-h-[220px] place-items-center text-sm text-slate-500">No QR image uploaded yet.</div>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-3">
                        <label className="inline-flex h-11 cursor-pointer items-center justify-center rounded-xl bg-[#1656d8] px-5 text-sm font-semibold text-white transition hover:brightness-110">
                          {qrUploadPending ? "Uploading..." : bankQrImageUrl ? "Replace QR" : "Upload QR"}
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/jpg,image/webp"
                            className="hidden"
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              if (file) void handleUploadQrImage(file);
                              event.currentTarget.value = "";
                            }}
                          />
                        </label>
                        {(bankQrImageUrl || qrBlobPath) ? (
                          <button
                            type="button"
                            onClick={() => {
                              setQrBlobPath("");
                              setBankQrImageUrl("");
                            }}
                            className="inline-flex h-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-5 text-sm font-semibold text-white transition hover:bg-white/10"
                          >
                            Remove QR
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-white/10 bg-[#20324a] p-5">
                    <div className="text-lg font-semibold text-white">Bank Transfer Details</div>
                    <div className="mt-2 text-sm leading-6 text-slate-400">
                      These details are included with payment instructions whenever Bank / QR is selected.
                    </div>
                    <div className="mt-5 grid gap-5 xl:grid-cols-2">
                      <div>
                        <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9db7d3]">Bank Name</label>
                        <input value={bankName} onChange={(e) => setBankName(e.target.value)} className="h-12 w-full rounded-xl border border-[#45607d] bg-[#14304b] px-4 text-sm text-white outline-none transition focus:border-[#5c7ba0] focus:ring-2 focus:ring-[#2f6bb2]/30" />
                      </div>
                      <div>
                        <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9db7d3]">Account Name</label>
                        <input value={accountName} onChange={(e) => setAccountName(e.target.value)} className="h-12 w-full rounded-xl border border-[#45607d] bg-[#14304b] px-4 text-sm text-white outline-none transition focus:border-[#5c7ba0] focus:ring-2 focus:ring-[#2f6bb2]/30" />
                      </div>
                      <div className="xl:col-span-2">
                        <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9db7d3]">Account Number</label>
                        <input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} className="h-12 w-full rounded-xl border border-[#45607d] bg-[#14304b] px-4 text-sm text-white outline-none transition focus:border-[#5c7ba0] focus:ring-2 focus:ring-[#2f6bb2]/30" />
                      </div>
                      <div className="xl:col-span-2">
                        <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9db7d3]">Transfer Instructions</label>
                        <textarea value={accountInstructions} onChange={(e) => setAccountInstructions(e.target.value)} className="min-h-[120px] w-full rounded-xl border border-[#45607d] bg-[#14304b] px-4 py-3 text-sm text-white outline-none transition focus:border-[#5c7ba0] focus:ring-2 focus:ring-[#2f6bb2]/30" />
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : null}

            {orderPaymentMethod === "manual" ? (
              <div className="rounded-2xl border border-white/10 bg-[#20324a] px-4 py-5 text-sm leading-6 text-slate-400">
                Staff will confirm payment manually from the operations queue. No QR or bank instructions will be sent.
              </div>
            ) : null}

            {orderPaymentMethod === "cod" ? (
              <div className="rounded-2xl border border-white/10 bg-[#20324a] px-4 py-5 text-sm leading-6 text-slate-400">
                Customers will pay when the order is delivered. Bank instructions stay hidden in this flow.
              </div>
            ) : null}
          </div>
        </ModalShell>
      ) : null}

      {brandingModalOpen ? (
        <ModalShell
          eyebrow="Customization"
          title="Edit invoice branding"
          description="Only branding controls stay here. Business identity and invoice contact details now live in the business profile section."
          onClose={() => setBrandingModalOpen(false)}
          footer={
            <>
              <button type="button" onClick={() => setBrandingModalOpen(false)} className="inline-flex h-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-5 text-sm font-semibold text-white transition hover:bg-white/10">
                Cancel
              </button>
              <button type="button" onClick={() => void handleSaveBranding()} disabled={updateCustomizationSettings.isPending || logoUploadPending} className="inline-flex h-11 items-center justify-center rounded-xl bg-[#c7a64f] px-5 text-sm font-semibold text-[#0f172a] transition hover:brightness-105 disabled:opacity-60">
                Save Branding
              </button>
            </>
          }
        >
          <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
            <div className="space-y-5">
              <div className="grid gap-5 xl:grid-cols-2">
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9db7d3]">Primary Color</label>
                  <div className="flex gap-3">
                    <input type="color" value={customPrimaryColor} onChange={(e) => setCustomPrimaryColor(e.target.value)} className="h-12 w-14 rounded-xl border border-[#45607d] bg-[#14304b]" />
                    <input value={customPrimaryColor} onChange={(e) => setCustomPrimaryColor(e.target.value)} className="h-12 flex-1 rounded-xl border border-[#45607d] bg-[#14304b] px-4 text-sm text-white outline-none transition focus:border-[#5c7ba0] focus:ring-2 focus:ring-[#2f6bb2]/30" />
                  </div>
                </div>
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9db7d3]">Secondary Color</label>
                  <div className="flex gap-3">
                    <input type="color" value={customSecondaryColor} onChange={(e) => setCustomSecondaryColor(e.target.value)} className="h-12 w-14 rounded-xl border border-[#45607d] bg-[#14304b]" />
                    <input value={customSecondaryColor} onChange={(e) => setCustomSecondaryColor(e.target.value)} className="h-12 flex-1 rounded-xl border border-[#45607d] bg-[#14304b] px-4 text-sm text-white outline-none transition focus:border-[#5c7ba0] focus:ring-2 focus:ring-[#2f6bb2]/30" />
                  </div>
                </div>
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#9db7d3]">Logo</label>
                <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-white/10 bg-[#20324a] p-4">
                  <div className="grid h-24 w-24 place-items-center overflow-hidden rounded-2xl border border-white/10 bg-[#13263c]">
                    {customLogoUrl ? (
                      <Image src={customLogoUrl} alt="Invoice logo" width={96} height={96} unoptimized className="h-full w-full object-contain" />
                    ) : (
                      <span className="text-xs text-slate-500">No logo</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <label className="inline-flex h-11 cursor-pointer items-center justify-center rounded-xl bg-[#1656d8] px-5 text-sm font-semibold text-white transition hover:brightness-110">
                      {logoUploadPending ? "Uploading..." : customLogoUrl ? "Replace Logo" : "Upload Logo"}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/jpg,image/webp"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void handleUploadLogoImage(file);
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                    {(customLogoUrl || customLogoBlobPath) ? (
                      <button
                        type="button"
                        onClick={() => {
                          setCustomLogoBlobPath("");
                          setCustomLogoContainer("");
                          setCustomLogoUrl("");
                        }}
                        className="inline-flex h-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-5 text-sm font-semibold text-white transition hover:bg-white/10"
                      >
                        Remove Logo
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
            <div className="rounded-[28px] border border-white/10 bg-[#102034] p-6">
              <div className="h-2 rounded-full" style={{ background: `linear-gradient(90deg, ${customPrimaryColor}, ${customSecondaryColor})` }} />
              <div className="mt-5 flex items-center gap-4">
                <div className="h-16 w-16 overflow-hidden rounded-2xl border border-white/10 bg-[#1A2332]">
                  {customLogoUrl ? (
                    <Image src={customLogoUrl} alt="Brand logo preview" width={64} height={64} unoptimized className="h-full w-full object-contain" />
                  ) : (
                    <div className="grid h-full w-full place-items-center text-xs text-slate-500">Logo</div>
                  )}
                </div>
                <div>
                  <div className="text-xl font-semibold text-white">{profileDisplayName}</div>
                  <div className="mt-2 text-sm text-slate-400">Tracking and invoice previews reuse this branding.</div>
                </div>
              </div>
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <FieldTile
                  label="Primary"
                  value={<div className="flex items-center gap-3"><span className="h-6 w-6 rounded-md border border-white/10" style={{ backgroundColor: customPrimaryColor }} />{customPrimaryColor}</div>}
                />
                <FieldTile
                  label="Accent"
                  value={<div className="flex items-center gap-3"><span className="h-6 w-6 rounded-md border border-white/10" style={{ backgroundColor: customSecondaryColor }} />{customSecondaryColor}</div>}
                />
              </div>
            </div>
          </div>
        </ModalShell>
      ) : null}

      {widgetModalOpen ? (
        <ModalShell
          eyebrow="Connections"
          title="Website widget snippet"
          description="Paste this script into your website or Wix custom code block to load the floating AI chat widget."
          onClose={() => setWidgetModalOpen(false)}
          widthClassName="max-w-4xl"
          footer={
            <>
              <div className="mr-auto text-sm text-slate-400">This snippet injects the floating chat bubble directly into the site. No iframe is required.</div>
              <button
                type="button"
                onClick={() => void copyWidgetSnippet()}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-5 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Copy Snippet
              </button>
            </>
          }
        >
          <textarea
            readOnly
            value={widgetSnippet}
            className="min-h-[180px] w-full rounded-2xl border border-white/10 bg-[#071124] p-4 font-mono text-sm leading-7 text-sky-100 outline-none"
          />
        </ModalShell>
      ) : null}

      <div className="bg-[var(--settings-page-bg)] px-6 pb-4 pt-3">
        <div className="flex w-fit max-w-full flex-wrap gap-1.5 rounded-xl bg-[#243b53] p-1">
          {visibleTabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabSelect(tab.id)}
                className={`flex min-h-11 items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                  active ? "bg-[#1a2332] text-white shadow-sm" : "text-slate-300 hover:text-white"
                }`}
              >
                <span className={active ? "opacity-100" : "opacity-60"}>{tab.icon}</span>
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">{renderTabContent()}</div>
    </div>
  );
}
