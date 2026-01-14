"use client";

import { createContext, useContext, useState, ReactNode } from "react";

interface PhoneFilterContextType {
  selectedPhoneNumberId: string | null; // null means "All"
  setSelectedPhoneNumberId: (id: string | null) => void;
}

const PhoneFilterContext = createContext<PhoneFilterContextType | undefined>(undefined);

export function PhoneFilterProvider({ children }: { children: ReactNode }) {
  const [selectedPhoneNumberId, setSelectedPhoneNumberId] = useState<string | null>(null);

  return (
    <PhoneFilterContext.Provider value={{ selectedPhoneNumberId, setSelectedPhoneNumberId }}>
      {children}
    </PhoneFilterContext.Provider>
  );
}

export function usePhoneFilter() {
  const context = useContext(PhoneFilterContext);
  if (context === undefined) {
    throw new Error("usePhoneFilter must be used within a PhoneFilterProvider");
  }
  return context;
}
