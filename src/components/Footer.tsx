import Link from "next/link";

export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="grid grid-cols-3 gap-10 items-start py-10">
          {/* Column 1: Company */}
          <div>
            <h3 className="text-sm font-semibold tracking-wide">Company</h3>
            <nav aria-label="Company" className="mt-3 flex flex-col gap-2 text-sm text-gray-700 dark:text-gray-200">
              <Link href="/">Home</Link>
              <Link href="/upload">Upload</Link>
            </nav>
          </div>

          {/* Column 2: Legal */}
          <div>
            <h3 className="text-sm font-semibold tracking-wide">Legal</h3>
            <nav aria-label="Legal" className="mt-3 flex flex-col gap-2 text-sm text-gray-700 dark:text-gray-200">
              <Link href="/privacy">Privacy Policy</Link>
              <Link href="/terms">Terms of Service</Link>
              <Link href="/data-deletion">Data Deletion</Link>
            </nav>
          </div>

          {/* Column 3: Contact */}
          <div>
            <h3 className="text-sm font-semibold tracking-wide">Contact</h3>
            <div className="mt-3 flex flex-col gap-2 text-sm text-gray-700 dark:text-gray-200">
              <span>Phone: <a href="tel:+18005551234">+1 (800) 555‑1234</a></span>
              <span>Email: <a href="mailto:support@escl8.com">support@escl8.com</a></span>
              <span className="text-gray-500 dark:text-gray-400">Mon–Fri 9am–5pm (PT)</span>
            </div>
          </div>
        </div>

        <div className="mt-10 pt-6 pb-4 border-t border-[color:var(--border)] text-xs text-gray-500 dark:text-gray-400">
          © {year} escl8 — Human‑grade AI sales and support agents.
        </div>
      </div>
    </footer>
  );
}
