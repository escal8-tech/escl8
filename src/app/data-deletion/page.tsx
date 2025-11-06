import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "User Data Deletion — escl8",
};

export default function DataDeletionPage() {
  return (
    <div className="legal-page">
      <div className="container legal">
        <h1>User Data Deletion</h1>
        <p>
          You can request deletion of your personal data or end‑user
          conversation data processed by <strong>escl8</strong>.
        </p>

        <h2>Request methods</h2>
        <p>
          • Email: <a href="mailto:privacy@escl8.com">privacy@escl8.com</a>
          <br />• Subject line: <em>Data Deletion Request</em>
          <br />• Include: the account email, company name, and (if applicable)
          conversation identifiers, phone numbers, or date ranges.
        </p>

        <h2>What we delete</h2>
        <p>
          • Account data upon account closure (subject to legal retention).<br />•
          Uploaded documents and derived indexes (on request).<br />• End‑user
          conversation logs associated with your workspace (on request).
        </p>

        <h2>Timelines</h2>
        <p>
          We aim to confirm your request within 7 days and complete deletion
          within 30 days, unless a longer period is required by law or
          reasonably necessary to fulfill legal obligations or resolve disputes.
        </p>

        <h2>Verification</h2>
        <p>
          We may require reasonable verification of your identity and
          authorization before processing deletion requests.
        </p>

        <h2>Platform-specific instructions</h2>
        <p>
          For WhatsApp users interacting with bots operated by our customers,
          please contact the business directly or email us with the phone number
          and conversation details so we can coordinate deletion with the
          appropriate customer controller.
        </p>

        <h2>Contact</h2>
        <p>
          Questions? Email <a href="mailto:privacy@escl8.com">privacy@escl8.com</a>.
        </p>
      </div>
    </div>
  );
}
