import type { Metadata } from "next";
import PortalLogin from "./PortalLogin";

export const metadata: Metadata = {
  title: "Escl8 Portal Login",
};

export default function PortalPage() {
  return <PortalLogin />;
}
