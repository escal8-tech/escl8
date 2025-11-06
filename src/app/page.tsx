import Link from "next/link";

export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="hero-bg" aria-hidden />
        <div className="container hero-grid">
          <div>
            <span className="eyebrow">Elevate your sales</span>
            <h1>
              Human‑like AI sales agents — trained on your docs and brand voice
            </h1>
            <p className="lead">
              escl8 builds fully customized AI agents for WhatsApp and web. Upload
              your documents, set your tone, and go live. No generic answers — just
              fast, on‑brand conversations that convert.
            </p>
            <div className="cta-row">
              <Link className="btn btn-primary" href="/upload">
                Upload documents
              </Link>
              <Link className="btn" href="#features">
                Explore features
              </Link>
            </div>
          </div>
          <div className="glass">
            <div className="muted">Live preview</div>
            <div style={{ height: 12 }} />
            <div className="glass" style={{ padding: 16 }}>
              <div className="muted" style={{ fontSize: 12 }}>WhatsApp · Agent</div>
              <div style={{ height: 8 }} />
              <p style={{ lineHeight: 1.5 }}>
                Hey! I was reading your pricing — could you tailor a plan for our
                12‑person sales team?
              </p>
            </div>
            <div style={{ height: 10 }} />
            <div className="glass" style={{ padding: 16 }}>
              <div className="muted" style={{ fontSize: 12 }}>escl8 · AI</div>
              <div style={{ height: 8 }} />
              <p className="muted" style={{ lineHeight: 1.6 }}>
                Absolutely. Based on your team size, most customers pick our
                Growth plan with a custom onboarding playbook. I can draft it in
                your brand tone and share a WhatsApp‑ready summary.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="features">
        <div className="container">
          <div className="feature-grid">
            <div className="feature glass">
              <h3>Document‑grounded</h3>
              <p className="muted">
                Upload PDFs, docs, and knowledge base exports. We’ll index and
                tailor answers to your content — no hallucinations.
              </p>
            </div>
            <div className="feature glass">
              <h3>Human‑like tone</h3>
              <p className="muted">
                Define your voice once. Your AI agent mirrors your brand style and
                maintains context like a real rep.
              </p>
            </div>
            <div className="feature glass">
              <h3>WhatsApp‑ready</h3>
              <p className="muted">
                Built for Meta’s platform from day one with clear privacy, terms,
                and user data deletion flows.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="container glass" style={{ textAlign: "center", padding: 32 }}>
          <h3>Ready to scale conversations that convert?</h3>
          <div style={{ height: 10 }} />
          <Link className="btn btn-primary" href="/upload">
            Start by uploading your docs
          </Link>
        </div>
      </section>
    </>
  );
}
