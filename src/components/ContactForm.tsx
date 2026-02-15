"use client";

import { useState, FormEvent } from "react";

export default function ContactForm() {
  const [status, setStatus] = useState<"idle"|"submitted">("idle");

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    // Demo: log; in real app we'd POST to API route
    console.log("Contact submission", data);
    setStatus("submitted");
    form.reset();
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginTop:30, display:'flex', flexDirection:'column', gap:18 }}>
      <div style={{ display:'flex', gap:18, flexWrap:'wrap' }}>
        <input required name="name" placeholder="Name" className="contact-input" />
        <input required type="email" name="email" placeholder="Email" className="contact-input" />
      </div>
      <textarea required name="message" placeholder="Message" rows={5} className="contact-input" />
      <button className="btn btn-primary" style={{ alignSelf:'flex-start' }}>Send message</button>
      {status === "submitted" && (
        <div style={{ fontSize:14, color:'var(--muted)' }}>Message sent. We&apos;ll be in touch.</div>
      )}
    </form>
  );
}
