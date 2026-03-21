import type { ToastController } from "@/components/ToastProvider";

type ToastClient = Pick<ToastController, "show">;

type ToastMessageInput = {
  title: string;
  message: string;
  durationMs?: number;
};

export function showSuccessToast(
  toast: ToastClient,
  input: ToastMessageInput,
): string {
  return toast.show({
    type: "success",
    title: input.title,
    message: input.message,
    durationMs: input.durationMs ?? 3200,
  });
}

export function showErrorToast(
  toast: ToastClient,
  input: ToastMessageInput,
): string {
  return toast.show({
    type: "error",
    title: input.title,
    message: input.message,
    durationMs: input.durationMs ?? 5200,
  });
}

export function showInfoToast(
  toast: ToastClient,
  input: ToastMessageInput,
): string {
  return toast.show({
    type: "info",
    title: input.title,
    message: input.message,
    durationMs: input.durationMs ?? 3600,
  });
}
