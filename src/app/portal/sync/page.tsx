import { redirect } from "next/navigation";

export default function SyncPage() {
  redirect("/settings?tab=integrations");
}
