"use client";

import { useState } from "react";

const SearchIcon = () => (
  <svg 
    width="16" 
    height="16" 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round"
  >
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

export default function SearchInput() {
  const [query, setQuery] = useState("");

  return (
    <div 
      className="portal-search"
      style={{
        background: "linear-gradient(135deg, rgba(15, 23, 42, 0.9) 0%, rgba(26, 31, 46, 0.8) 100%)",
        border: "1px solid rgba(184, 134, 11, 0.25)",
      }}
    >
      <SearchIcon />
      <input 
        type="text" 
        placeholder="Search..." 
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ color: "#f1f5f9", background: "transparent" }} 
      />
    </div>
  );
}
