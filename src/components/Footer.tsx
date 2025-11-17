import Link from "next/link";

export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer" style={{ width: '100%' }}>
      {/* Full-bleed separator above footer */}
      <div className="full-bleed footer-separator" aria-hidden />

      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '0 60px' }}>
        {/* Footer sections - horizontal layout */}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 80, paddingTop: 64, paddingBottom: 48 }}>
          {/* Column 1: Company */}
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, letterSpacing: '0.5px', marginBottom: 16 }}>Company</h3>
            <nav aria-label="Company" style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14 }}>
              <Link href="/" className="footer-link">Home</Link>
              <Link href="/upload" className="footer-link">Upload</Link>
            </nav>
          </div>

          {/* Column 2: Legal */}
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, letterSpacing: '0.5px', marginBottom: 16 }}>Legal</h3>
            <nav aria-label="Legal" style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14 }}>
              <Link href="/privacy" className="footer-link">Privacy Policy</Link>
              <Link href="/terms" className="footer-link">Terms of Service</Link>
              <Link href="/data-deletion" className="footer-link">Data Deletion</Link>
            </nav>
          </div>

          {/* Column 3: Contact */}
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, letterSpacing: '0.5px', marginBottom: 16 }}>Contact</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14, color: 'var(--muted)' }}>
              <span>
                Phone: <a href="tel:+18005551234" style={{ textDecoration: 'underline', textUnderlineOffset: '2px' }}>+1 (800) 555‑1234</a>
              </span>
              <span>
                Email: <a href="mailto:support@escl8.com" style={{ textDecoration: 'underline', textUnderlineOffset: '2px' }}>support@escl8.com</a>
              </span>
              <span style={{ fontSize: 13, opacity: 0.7 }}>Mon–Fri 9am–5pm (PT)</span>
            </div>
          </div>
        </div>

        {/* Copyright section - bottom left with lots of padding above */}
        <div style={{ paddingTop: 80, paddingBottom: 40, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
            © {year} Escl8 — Human‑grade AI sales and support agents.<br />
            Built with care for teams that live in WhatsApp.
          </div>
        </div>
      </div>
    </footer>
  );
}
