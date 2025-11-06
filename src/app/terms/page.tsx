import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — escl8",
};

export default function TermsPage() {
  return (
    <div className="legal-page">
      <div className="container legal">
        <h1>Terms of Service</h1>
        <p>Last updated: {new Date().toLocaleDateString()}</p>

        <p>
          These Terms of Service ("Terms") govern your access to and use of
          <strong> escl8</strong> (the "Service"). By using the Service, you
          agree to these Terms.
        </p>

        <h2>1. The Service</h2>
        <p>
          escl8 enables you to create and operate customized AI chatbots that
          can be connected to WhatsApp and web channels. You can upload
          materials ("Content") to tailor responses and define your brand tone.
        </p>

        <h2>2. Your Account & Responsibilities</h2>
        <p>
          You are responsible for your account, the Content you upload, and for
          complying with applicable laws. You must obtain necessary rights and
          permissions to process end-user data and to use third-party platforms
          (e.g., Meta/WhatsApp).
        </p>

        <h2>3. Acceptable Use</h2>
        <p>
          You may not use the Service to engage in unlawful, misleading, or
          harmful activities; to infringe others’ rights; to distribute malware;
          or to violate platform policies (including Meta’s terms for WhatsApp).
        </p>

        <h2>4. Subscriptions & Billing</h2>
        <p>
          Paid plans are billed in advance on a subscription basis and are
          non-refundable except where required by law. We may change prices with
          prior notice.
        </p>

        <h2>5. Intellectual Property</h2>
        <p>
          You retain ownership of your Content. We and our licensors retain all
          rights to the Service. You grant us a limited license to process your
          Content solely to provide the Service.
        </p>

        <h2>6. Disclaimers</h2>
        <p>
          The Service is provided "as is" without warranties of any kind. AI
          outputs may be inaccurate or incomplete. You are responsible for
          reviewing outputs before relying on them.
        </p>

        <h2>7. Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by law, escl8 will not be liable for
          indirect, incidental, special, consequential, or punitive damages, or
          loss of profits, data, or goodwill.
        </p>

        <h2>8. Termination</h2>
        <p>
          You may stop using the Service at any time. We may suspend or
          terminate access if you breach these Terms. Upon termination, your
          right to use the Service ceases immediately.
        </p>

        <h2>9. Changes</h2>
        <p>
          We may modify these Terms. Updates take effect upon posting. Your
          continued use of the Service constitutes acceptance.
        </p>

        <h2>10. Governing Law</h2>
        <p>
          These Terms are governed by applicable laws of your place of
          establishment or, if none, the laws of the jurisdiction where escl8 is
          organized, without regard to conflict of law principles.
        </p>

        <h2>Contact</h2>
        <p>
          For questions about these Terms, contact <a href="mailto:legal@escl8.com">legal@escl8.com</a>.
        </p>
      </div>
    </div>
  );
}
