import { redirect } from "next/navigation";

export default function FlowBuilderPage() {
  redirect("/settings?tab=flowbuilder");
}
