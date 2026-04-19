import { redirect } from "next/navigation";

export default function PortalUploadPage() {
  redirect("/settings?tab=documents");
}
