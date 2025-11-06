import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — escl8",
};

export default function PrivacyPage() {
  return (
    <div className="legal-page">
      <div className="container legal">
        <h1>Privacy Policy</h1>
        <p>Last updated: {new Date().toLocaleDateString()}</p>

        <p>
          This Privacy Policy explains how <strong>escl8</strong> ("we", "us",
          or "our") collects, uses, and protects information when you use our
          services to create and operate customized AI chatbots for WhatsApp and
          web channels.
        </p>

        <h2>Information we collect</h2>
        <p>
          • Business content you provide (e.g., documents, PDFs, knowledge base
          exports, prompts, and configuration).<br />• Account and billing
          details (e.g., email, company name, subscription info).<br />• Usage
          data and logs (e.g., requests, responses, timestamps, device info).<br />•
          End-user conversation data processed on your behalf when interacting
          with your bot via WhatsApp or web.
        </p>

        <h2>How we use information</h2>
        <p>
          We use the information to provide and improve our services, including:
          (i) indexing your documents for retrieval; (ii) generating responses in
          your defined tone; (iii) enforcing safety and usage limits; and (iv)
          analytics to help you measure performance. We do not sell personal
          data.
        </p>

        <h2>Data processing on your behalf</h2>
        <p>
          For end-user conversations, we act as a processor, processing data on
          your instructions. You are responsible for obtaining necessary
          permissions and providing notices to your end users.
        </p>

        <h2>Retention</h2>
        <p>
          We retain account data for the duration of your account and as
          required by law. Conversation logs and uploaded content are retained as
          long as needed to provide the service and can be deleted upon request
          or via your account controls when available.
        </p>

        <h2>Security</h2>
        <p>
          We implement technical and organizational safeguards appropriate to the
          risk. No method of transmission or storage is 100% secure; we cannot
          guarantee absolute security.
        </p>

        <h2>Third parties</h2>
        <p>
          We may use third-party processors (e.g., hosting providers, NLP/LLM
          infrastructure, WhatsApp Business API providers) to deliver the
          service. These providers are bound by contractual obligations and may
          change over time.
        </p>

        <h2>Your rights</h2>
        <p>
          Depending on your location, you may have rights to access, correct,
          delete, or port your personal data, or object to certain processing.
          To exercise rights, see the Data Deletion page or contact us.
        </p>

        <h2>Children</h2>
        <p>
          Our services are not directed to children under 13 (or the applicable
          age of consent). We do not knowingly collect data from children.
        </p>

        <h2>Changes</h2>
        <p>
          We may update this Policy from time to time. Material changes will be
          posted here with an updated date.
        </p>

        <h2>Contact</h2>
        <p>
          For privacy inquiries, please contact <a href="mailto:privacy@escl8.com">privacy@escl8.com</a>.
        </p>
      </div>
    </div>
  );
}
