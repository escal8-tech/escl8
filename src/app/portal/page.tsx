import type { Metadata } from "next";
import { PortalLogin } from "./components/PortalLogin";

export const metadata: Metadata = {
  title: "Portal Login",
};

export default function PortalPage() {
  return <PortalLogin />;
}
