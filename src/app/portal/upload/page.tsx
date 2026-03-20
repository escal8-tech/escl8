"use client";

import PortalAuthProvider from "@/components/PortalAuthProvider";
import { UploadContent } from "./components/UploadContent";

export default function PortalUploadPage() {
  return (
    <PortalAuthProvider>
      <UploadContent />
    </PortalAuthProvider>
  );
}
