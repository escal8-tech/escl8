import Link from "next/link";

export default function FAQPage() {
  return (
    <>
      {/* Hero Section */}
      <section className="faq-hero">
        <div className="hero-bg" aria-hidden />
        <div className="container" style={{ maxWidth: 1180, paddingTop: 160, paddingBottom: 60 }}>
          <div style={{ textAlign: 'center', maxWidth: 800, margin: '0 auto' }}>
            <span className="eyebrow">Support</span>
            <h1 style={{ 
              fontSize: 'clamp(2.5rem, 5vw, 3.5rem)', 
              fontWeight: 700, 
              letterSpacing: '-0.03em',
              lineHeight: 1.1,
              marginBottom: 24,
              background: 'linear-gradient(135deg, var(--foreground) 0%, var(--gold-light) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text'
            }}>
              Frequently Asked Questions
            </h1>
            <p className="lead" style={{ fontSize: 20, maxWidth: 600, margin: '0 auto' }}>
              Everything you need to know about deploying AI sales agents that 
              feel human and drive real revenue.
            </p>
          </div>
        </div>
      </section>

      {/* FAQ Categories */}
      <section className="section" style={{ paddingTop: 40, paddingBottom: 100 }}>
        <div className="container" style={{ maxWidth: 900 }}>
          
          {/* Getting Started */}
          <FAQCategory title="Getting Started">
            <FAQItem 
              question="How quickly can I deploy my first AI sales agent?"
              answer="Most businesses have their AI agent live within 15-30 minutes. Simply upload your product documents, configure your brand voice, and connect your WhatsApp Business account. Our intelligent document processing handles the rest—no technical expertise required."
            />
            <FAQItem 
              question="What types of documents can I upload to train the AI?"
              answer="Escl8 accepts PDFs, Word documents, text files, and direct URL imports. This includes product catalogs, pricing sheets, FAQs, policy documents, and knowledge base exports. The more comprehensive your documentation, the more accurate and helpful your AI agent becomes."
            />
            <FAQItem 
              question="Do I need a WhatsApp Business API account?"
              answer="We handle everything. As a Meta Business Partner, we streamline the entire WhatsApp Business API setup process. During onboarding, we'll guide you through verification and connection—typically completed within 24 hours."
            />
            <FAQItem 
              question="Is there a free trial available?"
              answer="Yes! Every plan includes a 14-day free trial with full access to all features. No credit card required to start. This gives you ample time to train your AI agent, run real conversations, and measure results before committing."
            />
          </FAQCategory>

          {/* AI & Accuracy */}
          <FAQCategory title="AI Intelligence & Accuracy">
            <FAQItem 
              question="How accurate are the AI responses?"
              answer="Our AI agents achieve 95%+ accuracy rates when properly trained with comprehensive documentation. The system is 'grounded' in your specific content—meaning it only responds based on information you've provided, preventing hallucinations and off-brand messaging."
            />
            <FAQItem 
              question="What happens when the AI doesn't know an answer?"
              answer="You have full control over fallback behavior. Configure your agent to gracefully acknowledge uncertainty, collect customer details for follow-up, or seamlessly escalate to a human team member. Every interaction maintains your brand's professionalism."
            />
            <FAQItem 
              question="Can the AI handle multiple languages?"
              answer="Absolutely. Escl8 supports 50+ languages out of the box. The AI automatically detects customer language preference and responds accordingly—perfect for multi-regional sales operations."
            />
            <FAQItem 
              question="How does the AI maintain my brand voice?"
              answer="During setup, you define your tone parameters: formal vs. casual, technical vs. simple, warm vs. direct. You can also provide example responses. The AI consistently applies these guidelines across every conversation, ensuring brand consistency at scale."
            />
          </FAQCategory>

          {/* Features & Capabilities */}
          <FAQCategory title="Features & Capabilities">
            <FAQItem 
              question="What's included in the analytics dashboard?"
              answer="The dashboard provides real-time visibility into conversation volumes, response accuracy, customer satisfaction scores, conversion rates, and revenue attribution. Growth and Scale plans include advanced analytics with custom date ranges, exportable reports, and trend analysis."
            />
            <FAQItem 
              question="How does the booking calendar system work?"
              answer="Available on Growth and Scale plans, the booking system lets your AI agent schedule meetings, demos, and consultations directly within WhatsApp. Customers select from available slots, receive confirmations, and automatic reminders—all without human intervention."
            />
            <FAQItem 
              question="What is the CRM with lead scoring?"
              answer="Every conversation is automatically logged with customer details, interaction history, and AI-powered lead scoring. High-intent buyers are flagged for priority follow-up. You can segment audiences, send batch messages for promotions, and track the full customer journey."
            />
            <FAQItem 
              question="Can I view and manage conversations in real-time?"
              answer="Yes. The unified inbox gives you a complete view of all WhatsApp conversations. Monitor AI responses, intervene when needed, and take over conversations seamlessly. Everything happens in one dashboard—no switching between apps."
            />
          </FAQCategory>

          {/* Security & Compliance */}
          <FAQCategory title="Security & Compliance">
            <FAQItem 
              question="How is my data protected?"
              answer="We implement enterprise-grade security: end-to-end encryption, SOC 2 Type II compliance, and GDPR-ready data handling. Customer conversation data is encrypted at rest and in transit. You maintain full ownership of all data."
            />
            <FAQItem 
              question="Where is data stored?"
              answer="Data is stored in secure, geographically distributed cloud infrastructure. Enterprise customers can specify data residency requirements for compliance with regional regulations."
            />
            <FAQItem 
              question="Can I set guardrails on what the AI says?"
              answer="Absolutely. Define explicit boundaries on topics, competitors, pricing disclosures, and sensitive information. The AI strictly adheres to these guardrails, ensuring every response aligns with your policies."
            />
            <FAQItem 
              question="Is Escl8 compliant with WhatsApp's policies?"
              answer="As a verified Meta Business Partner, we maintain full compliance with WhatsApp Business API policies, messaging templates, and user consent requirements. Our platform is built to keep your business in good standing."
            />
          </FAQCategory>

          {/* Pricing & Plans */}
          <FAQCategory title="Pricing & Plans">
            <FAQItem 
              question="What's the difference between plans?"
              answer="Starter is perfect for launching your first AI agent with core automation. Growth adds the analytics dashboard, booking calendar, CRM, and unified inbox for scaling teams. Scale includes everything plus custom APIs, dedicated support, and enterprise SLAs."
            />
            <FAQItem 
              question="Are there any hidden fees or conversation limits?"
              answer="No hidden fees. Starter includes 1,000 AI conversations/month, Growth includes 10,000, and Scale is unlimited. Additional conversations are available at transparent per-message rates if you exceed your plan."
            />
            <FAQItem 
              question="Can I upgrade or downgrade my plan?"
              answer="Yes, change your plan anytime from your dashboard. Upgrades take effect immediately with prorated billing. Downgrades apply at the next billing cycle. No penalties or lock-in periods."
            />
            <FAQItem 
              question="Do you offer annual billing discounts?"
              answer="Yes, annual billing saves you 20% compared to monthly payments. Contact our team for custom enterprise pricing on multi-year agreements."
            />
          </FAQCategory>

          {/* Support & Onboarding */}
          <FAQCategory title="Support & Onboarding">
            <FAQItem 
              question="What support is included?"
              answer="Starter plans include email support with 24-hour response times. Growth plans get priority support with 4-hour response. Scale plans receive 24/7 dedicated support with a named account manager and 1-hour critical response."
            />
            <FAQItem 
              question="Do you provide onboarding assistance?"
              answer="All plans include self-serve onboarding with video tutorials and documentation. Growth plans include a 1-hour kickoff call. Scale plans receive white-glove onboarding with a dedicated solutions engineer guiding your entire setup."
            />
            <FAQItem 
              question="Can you help migrate from other platforms?"
              answer="Yes. Our team can assist with migrating conversation history, document imports, and workflow configurations from other chatbot or CRM platforms. Scale customers receive complimentary migration services."
            />
            <FAQItem 
              question="Is there a community or resource center?"
              answer="Yes! Access our knowledge base, video tutorials, best practices guides, and template library. We also host monthly webinars on AI sales strategies and platform tips."
            />
          </FAQCategory>

        </div>
      </section>

      {/* Still Have Questions CTA */}
      <section className="section" style={{ paddingTop: 20, paddingBottom: 120 }}>
        <div className="container" style={{ maxWidth: 900 }}>
          <div className="glass" style={{ padding: '60px 50px', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
            <div style={{
              position: 'absolute',
              inset: 0,
              background: 'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(184, 134, 11, 0.15), transparent)',
              pointerEvents: 'none'
            }} />
            <h2 style={{ 
              fontSize: 32, 
              marginBottom: 16,
              background: 'linear-gradient(135deg, var(--foreground), var(--gold-light))',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text'
            }}>
              Still Have Questions?
            </h2>
            <p className="muted" style={{ fontSize: 18, maxWidth: 500, margin: '0 auto 32px' }}>
              Our team is here to help. Schedule a personalized demo or reach out 
              directly—we&apos;d love to show you what Escl8 can do for your business.
            </p>
            <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link href="/#contact" className="btn btn-primary" style={{ padding: '14px 32px', fontSize: 16 }}>
                Contact Us
              </Link>
              <Link href="/pricing" className="btn" style={{ padding: '14px 32px', fontSize: 16, borderColor: 'var(--border-gold)' }}>
                View Pricing
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function FAQCategory({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 60 }}>
      <h2 style={{ 
        fontSize: 24, 
        marginBottom: 24,
        paddingBottom: 12,
        borderBottom: '1px solid var(--border-gold)',
        color: 'var(--gold-light)'
      }}>
        {title}
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {children}
      </div>
    </div>
  );
}

function FAQItem({ question, answer }: { question: string; answer: string }) {
  return (
    <details className="faq-item glass" style={{ padding: '20px 24px', cursor: 'pointer' }}>
      <summary style={{ 
        fontSize: 16, 
        fontWeight: 600, 
        color: 'var(--foreground)',
        listStyle: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16
      }}>
        {question}
        <svg 
          className="faq-chevron"
          width="20" 
          height="20" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="var(--muted)" 
          strokeWidth="2" 
          strokeLinecap="round" 
          strokeLinejoin="round"
          style={{ flexShrink: 0, transition: 'transform 0.2s ease' }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </summary>
      <p style={{ 
        marginTop: 16, 
        fontSize: 15, 
        lineHeight: 1.7, 
        color: 'var(--muted)',
        paddingRight: 36
      }}>
        {answer}
      </p>
    </details>
  );
}
