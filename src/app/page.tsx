import Link from "next/link";
import Image from "next/image";
import ChatBubbles from "@/components/ChatBubbles";
import ContactForm from "@/components/ContactForm";

export default function Home() {
  return (
    <>
      {/* Hero Section */}
      <section className="hero">
        <div className="hero-bg" aria-hidden />
        <div className="container hero-grid">
          <div>
            <span className="eyebrow">WhatsApp first</span>
            <h1>
              Human‑like AI sales agents for WhatsApp — powered by your content
            </h1>
            <p className="lead">
              Train on your docs. Set your brand tone. Launch a revenue‑driving AI sales agent where your customers already are.
            </p>
            <div className="cta-row" style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <Link className="btn btn-primary" href="/portal">
                Create your agent
              </Link>
              <span
                className="badge"
                style={{
                  padding: 6,
                  borderRadius: 10,
                  background: "#fff",
                  boxShadow: "0 8px 20px rgba(15, 23, 42, 0.18)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "1px solid rgba(148, 163, 184, 0.25)",
                }}
              >
                <Image
                  src="/meta-business-partner.png"
                  alt="Meta Business Partner"
                  width={130}
                  height={52}
                />
              </span>
            </div>
          </div>
          <div style={{ position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <Image
              src="/mobile.png"
              alt="WhatsApp AI Agent Demo - 24/7 Customer Support"
              width={540}
              height={700}
              priority
              style={{ 
                display: 'block', 
                maxWidth: '100%',
                height: 'auto',
                filter: 'drop-shadow(0 25px 50px rgba(0, 0, 0, 0.4))',
                transform: 'translate(15px, -20px)',
              }}
            />
          </div>
        </div>
      </section>

      {/* Chat bubbles section - appears on scroll */}
      <section id="features" className="section" style={{ overflow: 'visible', paddingTop: 60, paddingBottom: 60 }}>
        <ChatBubbles
          startSide="left"
          items={[
            { text: "WhatsApp native — Optimized for sales flows: replies, follow‑ups, catalog prompts, payments hand‑offs." },
            { text: "Document‑grounded — Upload PDFs, docs, and KB exports. Answers stay on‑brand and on‑fact." },
            { text: "Human‑like tone — Define your voice once. The agent maintains context like a real rep." },
          ]}
        />
      </section>

      {/* Why use section */}
      <section className="section" style={{ paddingTop: 80, paddingBottom: 80 }}>
        {/* Top separator line - full width */}
        <div style={{ width: '100vw', height: 1, background: 'rgba(255,255,255,0.15)', marginBottom: 0, marginLeft: 'calc(-50vw + 50%)' }} />

        {/* Frosted band background fills the entire area between the two lines */}
        <div className="full-bleed frost-band" style={{ padding: '90px 0' }}>
          <div className="container" style={{ maxWidth: 1180 }}>
            <div style={{ textAlign: 'center', marginBottom: 60 }}>
              <h2 style={{ fontSize: '38px', letterSpacing: '-0.5px', background: 'linear-gradient(135deg, var(--gold-light), var(--gold))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Why teams choose Escl8?</h2>
              <p className="muted" style={{ marginTop: 14, fontSize: 18 }}>Three reasons brands deploy AI sales agents that feel human day one.</p>
            </div>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap: 40 }}>
              <div style={{ flex:1, display:'flex', flexDirection:'column', gap:14 }}>
                <IconSpark />
                <h3>Instant activation</h3>
                <p className="muted">Upload your canon docs and you have a trained agent in minutes—not weeks.</p>
              </div>
              <div style={{ width: 1, height: '75%', background: 'rgba(255,255,255,0.4)', borderRadius: 999, flexShrink: 0 }} />
              <div style={{ flex:1, display:'flex', flexDirection:'column', gap:14 }}>
                <IconShield />
                <h3>On‑brand + safe</h3>
                <p className="muted">Tone + guardrails ensure every reply matches voice and policy compliance.</p>
              </div>
              <div style={{ width: 1, height: '75%', background: 'rgba(255,255,255,0.4)', borderRadius: 999, flexShrink: 0 }} />
              <div style={{ flex:1, display:'flex', flexDirection:'column', gap:14 }}>
                <IconChart />
                <h3>Revenue focus</h3>
                <p className="muted">Designed around conversion flows: qualification, follow‑ups, offer summaries.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom separator line - full width */}
        <div style={{ width: '100vw', height: 1, background: 'rgba(255,255,255,0.15)', marginTop: 0, marginLeft: 'calc(-50vw + 50%)' }} />
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════════
          FEATURE SECTION 1: Dashboard - Image Right, Fading Out
          ═══════════════════════════════════════════════════════════════════════════ */}
      <section className="section feature-section" style={{ paddingTop: 100, paddingBottom: 100, overflow: 'hidden' }}>
        <div className="container" style={{ maxWidth: 1400 }}>
          <div className="feature-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 80, alignItems: 'center' }}>
            {/* Content - Left */}
            <div className="feature-content">
              <span className="eyebrow" style={{ marginBottom: 16 }}>Intelligent Analytics</span>
              <h2 style={{ 
                fontSize: 'clamp(2rem, 4vw, 2.8rem)', 
                fontWeight: 700, 
                letterSpacing: '-0.03em',
                lineHeight: 1.15,
                marginBottom: 24,
                background: 'linear-gradient(135deg, var(--foreground) 0%, var(--gold-light) 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text'
              }}>
                Command Center Dashboard
              </h2>
              <p style={{ fontSize: 18, color: 'var(--muted)', lineHeight: 1.75, marginBottom: 28 }}>
                Stop drowning in hundreds of conversations. Our intelligent dashboard delivers 
                <strong style={{ color: 'var(--foreground)' }}> real-time visibility</strong> into 
                your AI agent&apos;s performance—accuracy metrics, conversation summaries, sentiment 
                analysis, and status tracking—all in one unified view.
              </p>
              <ul className="feature-list" style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 32 }}>
                <FeaturePoint>Live conversation monitoring with AI-generated summaries</FeaturePoint>
                <FeaturePoint>Bot accuracy scores and response quality metrics</FeaturePoint>
                <FeaturePoint>Customer sentiment tracking across all interactions</FeaturePoint>
                <FeaturePoint>Exportable reports for team reviews and optimization</FeaturePoint>
              </ul>
              <Link href="/portal" className="btn btn-primary" style={{ padding: '14px 28px' }}>
                Explore Dashboard
              </Link>
            </div>
            
            {/* Screenshot - Right, Fading Out to Edge */}
            <div className="feature-image-wrapper feature-image-right" style={{ position: 'relative', marginRight: '-25%' }}>
              <div className="screenshot-container" style={{
                position: 'relative',
                borderRadius: 16,
                overflow: 'visible',
              }}>
                <Image
                  src="/screenshot.png"
                  alt="Escl8 Analytics Dashboard"
                  width={900}
                  height={560}
                  style={{ 
                    display: 'block',
                    borderRadius: 12,
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                  }}
                />
                {/* Fade overlay - right edge, full fade to invisible */}
                <div style={{
                  position: 'absolute',
                  top: 0,
                  right: 0,
                  bottom: 0,
                  width: '70%',
                  background: 'linear-gradient(to right, transparent 0%, transparent 20%, rgba(3, 7, 18, 0.3) 40%, rgba(3, 7, 18, 0.7) 60%, var(--background) 85%, var(--background) 100%)',
                  pointerEvents: 'none',
                }} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════════
          FEATURE SECTION 2: Unified Inbox - Image Left
          ═══════════════════════════════════════════════════════════════════════════ */}
      <section className="section feature-section" style={{ paddingTop: 100, paddingBottom: 100, overflow: 'hidden', background: 'rgba(15, 23, 42, 0.3)' }}>
        <div className="container" style={{ maxWidth: 1400 }}>
          <div className="feature-grid" style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 120, alignItems: 'center' }}>
            {/* Screenshot - Left, Fading Out to Edge */}
            <div className="feature-image-wrapper feature-image-left" style={{ position: 'relative', marginLeft: '-25%' }}>
              <div className="screenshot-container" style={{
                position: 'relative',
                borderRadius: 16,
                overflow: 'visible',
              }}>
                <Image
                  src="/screenshot.png"
                  alt="Escl8 Unified Inbox"
                  width={900}
                  height={560}
                  style={{ 
                    display: 'block',
                    borderRadius: 12,
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                  }}
                />
                {/* Fade overlay - left edge, full fade to match lighter section background */}
                <div style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  bottom: 0,
                  width: '70%',
                  background: 'linear-gradient(to left, transparent 0%, transparent 20%, rgba(8, 12, 24, 0.5) 40%, rgba(8, 12, 24, 0.85) 60%, #080c18 85%, #080c18 100%)',
                  pointerEvents: 'none',
                }} />
              </div>
            </div>
            
            {/* Content - Right */}
            <div className="feature-content" style={{ paddingRight: '5%' }}>
              <span className="eyebrow" style={{ marginBottom: 16 }}>All-in-One Platform</span>
              <h2 style={{ 
                fontSize: 'clamp(2rem, 4vw, 2.8rem)', 
                fontWeight: 700, 
                letterSpacing: '-0.03em',
                lineHeight: 1.15,
                marginBottom: 24,
                background: 'linear-gradient(135deg, var(--foreground) 0%, var(--gold-light) 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text'
              }}>
                Unified Inbox & Thread Management
              </h2>
              <p style={{ fontSize: 18, color: 'var(--muted)', lineHeight: 1.75, marginBottom: 28 }}>
                View every conversation, message, and customer interaction in 
                <strong style={{ color: 'var(--foreground)' }}> one powerful dashboard</strong>. 
                No more switching between apps. Monitor AI responses in real-time, take over 
                conversations when needed, and manage your entire operation with dramatically 
                fewer resources and human touchpoints.
              </p>
              <ul className="feature-list" style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 32 }}>
                <FeaturePoint>Real-time thread viewing and message history</FeaturePoint>
                <FeaturePoint>Seamless human takeover when AI escalates</FeaturePoint>
                <FeaturePoint>Smart filters and search across all conversations</FeaturePoint>
                <FeaturePoint>Team collaboration with notes and assignments</FeaturePoint>
              </ul>
              <Link href="/portal" className="btn btn-primary" style={{ padding: '14px 28px' }}>
                Try Unified Inbox
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════════
          FEATURE SECTION 3: CRM System - Image Right
          ═══════════════════════════════════════════════════════════════════════════ */}
      <section className="section feature-section" style={{ paddingTop: 100, paddingBottom: 100, overflow: 'hidden' }}>
        <div className="container" style={{ maxWidth: 1400 }}>
          <div className="feature-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: 120, alignItems: 'center' }}>
            {/* Content - Left */}
            <div className="feature-content" style={{ paddingLeft: '5%' }}>
              <span className="eyebrow" style={{ marginBottom: 16 }}>Customer Intelligence</span>
              <h2 style={{ 
                fontSize: 'clamp(2rem, 4vw, 2.8rem)', 
                fontWeight: 700, 
                letterSpacing: '-0.03em',
                lineHeight: 1.15,
                marginBottom: 24,
                background: 'linear-gradient(135deg, var(--foreground) 0%, var(--gold-light) 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text'
              }}>
                Built-in CRM & Lead Scoring
              </h2>
              <p style={{ fontSize: 18, color: 'var(--muted)', lineHeight: 1.75, marginBottom: 28 }}>
                Know exactly who your 
                <strong style={{ color: 'var(--foreground)' }}> highest-value leads</strong> are. 
                Every conversation is automatically enriched with AI-powered insights: buyer intent, 
                purchase history, and engagement scoring. Identify hot prospects instantly and 
                reach out with targeted offers at scale.
              </p>
              <ul className="feature-list" style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 32 }}>
                <FeaturePoint>AI-powered lead scoring and priority ranking</FeaturePoint>
                <FeaturePoint>Complete conversation history per contact</FeaturePoint>
                <FeaturePoint>Batch messaging for promotions and follow-ups</FeaturePoint>
                <FeaturePoint>Segment audiences by behavior and engagement</FeaturePoint>
              </ul>
              <Link href="/portal" className="btn btn-primary" style={{ padding: '14px 28px' }}>
                Discover CRM Features
              </Link>
            </div>
            
            {/* Screenshot - Right, Fading Out to Edge */}
            <div className="feature-image-wrapper feature-image-right" style={{ position: 'relative', marginRight: '-25%' }}>
              <div className="screenshot-container" style={{
                position: 'relative',
                borderRadius: 16,
                overflow: 'visible',
              }}>
                <Image
                  src="/screenshot.png"
                  alt="Escl8 CRM System"
                  width={900}
                  height={560}
                  style={{ 
                    display: 'block',
                    borderRadius: 12,
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                  }}
                />
                {/* Fade overlay - right edge, full fade to invisible */}
                <div style={{
                  position: 'absolute',
                  top: 0,
                  right: 0,
                  bottom: 0,
                  width: '70%',
                  background: 'linear-gradient(to right, transparent 0%, transparent 20%, rgba(3, 7, 18, 0.3) 40%, rgba(3, 7, 18, 0.7) 60%, var(--background) 85%, var(--background) 100%)',
                  pointerEvents: 'none',
                }} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════════
          SOCIAL PROOF / STATS SECTION
          ═══════════════════════════════════════════════════════════════════════════ */}
      <section className="section" style={{ paddingTop: 80, paddingBottom: 80 }}>
        <div className="full-bleed frost-band" style={{ padding: '80px 0' }}>
          <div className="container" style={{ maxWidth: 1180 }}>
            <div style={{ textAlign: 'center', marginBottom: 50 }}>
              <h2 style={{ 
                fontSize: '32px', 
                letterSpacing: '-0.5px', 
                background: 'linear-gradient(135deg, var(--gold-light), var(--gold))', 
                WebkitBackgroundClip: 'text', 
                WebkitTextFillColor: 'transparent', 
                backgroundClip: 'text' 
              }}>
                Trusted by Growing Teams
              </h2>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 40, textAlign: 'center' }}>
              <StatCard number="95%" label="Response Accuracy" />
              <StatCard number="10x" label="Faster Response Time" />
              <StatCard number="50%" label="Cost Reduction" />
              <StatCard number="24/7" label="Always Available" />
            </div>
          </div>
        </div>
      </section>

      {/* Contact section */}
      <section id="contact" className="section">
        <div className="container" style={{ maxWidth:1180 }}>
          <div className="glass" style={{ padding:'50px 46px', position:'relative' }}>
            <h2 style={{ fontSize:'36px', letterSpacing:'-0.5px', background: 'linear-gradient(135deg, var(--gold-light), var(--gold))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Contact us</h2>
            <p className="muted" style={{ marginTop:12 }}>Have a unique catalog or compliance need? Send a quick note.</p>
            <ContactForm />
          </div>
        </div>
      </section>
    </>
  );
}

// Feature Point Component
function FeaturePoint({ children }: { children: React.ReactNode }) {
  return (
    <li style={{ display: 'flex', alignItems: 'flex-start', gap: 12, fontSize: 16, color: 'var(--foreground)' }}>
      <svg 
        width="22" 
        height="22" 
        viewBox="0 0 24 24" 
        fill="none" 
        stroke="var(--gold)" 
        strokeWidth="2.5" 
        strokeLinecap="round" 
        strokeLinejoin="round"
        style={{ flexShrink: 0, marginTop: 2 }}
      >
        <path d="M20 6L9 17l-5-5" />
      </svg>
      {children}
    </li>
  );
}

// Stat Card Component
function StatCard({ number, label }: { number: string; label: string }) {
  return (
    <div>
      <div style={{ 
        fontSize: 48, 
        fontWeight: 700, 
        letterSpacing: '-0.02em',
        background: 'linear-gradient(135deg, var(--foreground), var(--gold-light))',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text'
      }}>
        {number}
      </div>
      <div style={{ fontSize: 14, color: 'var(--muted)', marginTop: 8 }}>{label}</div>
    </div>
  );
}

// Icon Components
function IconSpark() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2v4" />
      <path d="M12 18v4" />
      <path d="M4.93 4.93l2.83 2.83" />
      <path d="M16.24 16.24l2.83 2.83" />
      <path d="M2 12h4" />
      <path d="M18 12h4" />
      <path d="M4.93 19.07l2.83-2.83" />
      <path d="M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

function IconShield() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function IconChart() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 3v18h18" />
      <path d="M7 14l4-4 4 3 5-7" />
    </svg>
  );
}
