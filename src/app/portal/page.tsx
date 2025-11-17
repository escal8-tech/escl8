import type { Metadata } from "next";
import PortalLogin from "./PortalLogin";

export const metadata: Metadata = {
  title: "escl8 Portal Login",
};

export default function PortalPage() {
  return <PortalLogin />;
}
