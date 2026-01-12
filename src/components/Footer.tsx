import Link from "next/link";
import Image from "next/image";

export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer
      className="site-footer"
      style={{
        width: "100%",
        background:
          "linear-gradient(180deg, rgba(15, 23, 42, 0.6) 0%, rgba(3, 7, 18, 0.9) 100%)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderTop: "1px solid rgba(184, 134, 11, 0.2)",
      }}
    >
      {/* Gold separator line */}
      <div
        style={{
          height: 1,
          background:
            "linear-gradient(90deg, transparent, rgba(184, 134, 11, 0.5), transparent)",
        }}
        aria-hidden
      />

      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "0 60px" }}>
        {/* Footer sections - horizontal layout */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 80,
            paddingTop: 64,
            paddingBottom: 48,
          }}
        >
          {/* Column 1: Brand */}
          <div style={{ flex: 1.5 }}>
            <Link href="/" style={{ display: "inline-block", marginBottom: 24 }}>
              <Image
                src="/8.png"
                alt="Escl8 Logo"
                width={420}
                height={126}
                style={{ objectFit: "contain" }}
              />
            </Link>
            <p
              style={{
                fontSize: 15,
                color: "var(--muted)",
                lineHeight: 1.7,
                maxWidth: 320,
              }}
            >
              Human-grade AI sales and support agents for teams that live in
              WhatsApp.
            </p>
          </div>

          {/* Column 2: Company */}
          <div style={{ flex: 1 }}>
            <h3
              style={{
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                marginBottom: 16,
                color: "var(--gold-light)",
              }}
            >
              Company
            </h3>
            <nav
              aria-label="Company"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                fontSize: 14,
              }}
            >
              <Link href="/" className="footer-link">
                Home
              </Link>
              <Link href="/upload" className="footer-link">
                Upload
              </Link>
              <Link href="/portal" className="footer-link">
                Portal
              </Link>
            </nav>
          </div>

          {/* Column 3: Legal */}
          <div style={{ flex: 1 }}>
            <h3
              style={{
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                marginBottom: 16,
                color: "var(--gold-light)",
              }}
            >
              Legal
            </h3>
            <nav
              aria-label="Legal"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                fontSize: 14,
              }}
            >
              <Link href="/privacy" className="footer-link">
                Privacy Policy
              </Link>
              <Link href="/terms" className="footer-link">
                Terms of Service
              </Link>
              <Link href="/data-deletion" className="footer-link">
                Data Deletion
              </Link>
            </nav>
          </div>

          {/* Column 4: Contact */}
          <div style={{ flex: 1 }}>
            <h3
              style={{
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                marginBottom: 16,
                color: "var(--gold-light)",
              }}
            >
              Contact
            </h3>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                fontSize: 14,
                color: "var(--muted)",
              }}
            >
              <span>
                Phone:{" "}
                <a
                  href="tel:+18005551234"
                  className="footer-link"
                  style={{
                    textDecoration: "underline",
                    textUnderlineOffset: "2px",
                  }}
                >
                  +1 (800) 555‑1234
                </a>
              </span>
              <span>
                Email:{" "}
                <a
                  href="mailto:support@escl8.com"
                  className="footer-link"
                  style={{
                    textDecoration: "underline",
                    textUnderlineOffset: "2px",
                  }}
                >
                  support@escl8.com
                </a>
              </span>
              <span style={{ fontSize: 13, opacity: 0.7 }}>
                Mon–Fri 9am–5pm (PT)
              </span>
            </div>
          </div>
        </div>

        {/* Copyright section */}
        <div
          style={{
            paddingTop: 32,
            paddingBottom: 32,
            borderTop: "1px solid rgba(255, 255, 255, 0.08)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div
            style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}
          >
            © {year} Escl8 — All rights reserved.
          </div>
          <div
            style={{
              display: "flex",
              gap: 20,
              fontSize: 13,
              color: "var(--muted)",
            }}
          >
            <span
              style={{
                padding: "4px 12px",
                background: "rgba(184, 134, 11, 0.1)",
                borderRadius: 999,
                border: "1px solid rgba(184, 134, 11, 0.2)",
                color: "var(--gold-light)",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.05em",
              }}
            >
              META BUSINESS PARTNER
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
