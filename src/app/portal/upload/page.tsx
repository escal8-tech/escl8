"use client";

import PortalAuthProvider from "@/components/PortalAuthProvider";
import UploadInner from "@/app/upload/UploadInner";

export default function PortalUploadPage() {
  return (
    <PortalAuthProvider>
      <UploadInner />
    </PortalAuthProvider>
  );
}
