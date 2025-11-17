import Link from "next/link";
import Image from "next/image";
import ChatBubbles from "@/components/ChatBubbles";
import ContactForm from "@/components/ContactForm";

export default function Home() {
  return (
    <>
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
          <div className="glass ring-gradient neon-shadow" style={{ padding: 0, overflow: "hidden" }}>
            <Image src="/whatsapp-hero.svg" alt="Chat preview" width={480} height={380} priority />
          </div>
        </div>
      </section>

      <section id="features" className="section" style={{ overflow: 'hidden' }}>
        <ChatBubbles
          startSide="left"
          items={[
            { text: "WhatsApp native — Optimized for sales flows: replies, follow‑ups, catalog prompts, payments hand‑offs." },
            { text: "Document‑grounded — Upload PDFs, docs, and KB exports. Answers stay on‑brand and on‑fact." },
            { text: "Human‑like tone — Define your voice once. The agent maintains context like a real rep." },
          ]}
        />
      </section>

      

      <section className="section" style={{ overflow: 'hidden' }}>
        <ChatBubbles
          startSide="right"
          items={[
            { text: "1. Upload your docs — Pricing, playbooks, FAQs, catalog — we’ll index it for retrieval." },
            { text: "2. Set your tone — Choose voice and guardrails; add sales scripts and CTAs." },
            { text: "3. Go live on WhatsApp — Connect your Business Account and start converting conversations." },
          ]}
        />
      </section>

      {/* Why use section */}
      <section className="section" style={{ paddingTop: 80, paddingBottom: 80 }}>
        {/* Top separator line - full width */}
        <div style={{ width: '100vw', height: 1, background: 'rgba(255,255,255,0.15)', marginBottom: 60, marginLeft: 'calc(-50vw + 50%)' }} />
        
        <div className="container" style={{ maxWidth: 1180 }}>
          <div style={{ textAlign: 'center', marginBottom: 60 }}>
            <h2 style={{ fontSize: '38px', letterSpacing: '-0.5px' }}>Why teams choose Escl8?</h2>
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

        {/* Bottom separator line - full width */}
        <div style={{ width: '100vw', height: 1, background: 'rgba(255,255,255,0.15)', marginTop: 60, marginLeft: 'calc(-50vw + 50%)' }} />
      </section>

      {/* Pricing cards */}
      <section id="pricing" className="section" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0))' }}>
        <div className="container" style={{ maxWidth: 1180 }}>
          <div style={{ textAlign:'center', marginBottom:46 }}>
            <h2 style={{ fontSize:'40px', letterSpacing:'-1px' }}>Pricing</h2>
            <p className="muted" style={{ marginTop:12 }}>Simple plans to start—scale when the agent becomes a top closer.</p>
          </div>
          <div className="grid" style={{ display:'grid', gap:28, gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))' }}>
            <div className="glass neon-shadow" style={{ display:'flex', flexDirection:'column', gap:16, padding:'28px 26px' }}>
              <h3>Starter</h3>
              <p className="muted" style={{ fontSize:14 }}>Launch fast with core WhatsApp automation.</p>
              <ul style={{ listStyle:'none', padding:0, margin:0, display:'flex', flexDirection:'column', gap:10 }}>
                <li>Up to 5 source docs</li>
                <li>Tone + guardrails</li>
                <li>Basic analytics</li>
              </ul>
              <div style={{ marginTop:'auto' }}>
                <div style={{ fontSize:28, fontWeight:600 }}>$59<span style={{ fontSize:14, fontWeight:400 }}> /mo</span></div>
                <Link href="/upload" className="btn btn-primary" style={{ marginTop:14 }}>Get started</Link>
              </div>
            </div>
            <div className="glass ring-gradient" style={{ display:'flex', flexDirection:'column', gap:16, padding:'28px 26px', position:'relative' }}>
              <span style={{ position:'absolute', top:12, right:16, fontSize:12, letterSpacing:'0.7px', background:'linear-gradient(135deg,var(--brand),var(--brand-2))', padding:'4px 10px', borderRadius:999, color:'#fff' }}>POPULAR</span>
              <h3>Growth</h3>
              <p className="muted" style={{ fontSize:14 }}>For teams scaling multi‑region sales conversations.</p>
              <ul style={{ listStyle:'none', padding:0, margin:0, display:'flex', flexDirection:'column', gap:10 }}>
                <li>Unlimited docs</li>
                <li>Advanced retrieval tuning</li>
                <li>Conversion analytics + exports</li>
                <li>Priority support</li>
              </ul>
              <div style={{ marginTop:'auto' }}>
                <div style={{ fontSize:30, fontWeight:600 }}>$199<span style={{ fontSize:14, fontWeight:400 }}> /mo</span></div>
                <Link href="/upload" className="btn btn-primary" style={{ marginTop:14 }}>Start Growth</Link>
              </div>
            </div>
            <div className="glass" style={{ display:'flex', flexDirection:'column', gap:16, padding:'28px 26px' }}>
              <h3>Scale</h3>
              <p className="muted" style={{ fontSize:14 }}>High‑volume orgs needing deep integrations.</p>
              <ul style={{ listStyle:'none', padding:0, margin:0, display:'flex', flexDirection:'column', gap:10 }}>
                <li>All Growth features</li>
                <li>Custom retention & SLA</li>
                <li>Embedded compliance review</li>
                <li>Dedicated solutions engineer</li>
              </ul>
              <div style={{ marginTop:'auto' }}>
                <div style={{ fontSize:26, fontWeight:600 }}>Custom</div>
                <Link href="#contact" className="btn" style={{ marginTop:14 }}>Talk to us</Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Contact section */}
      <section id="contact" className="section">
        <div className="container" style={{ maxWidth:900 }}>
          <div className="glass" style={{ padding:'50px 46px', position:'relative' }}>
            <h2 style={{ fontSize:'36px', letterSpacing:'-0.5px' }}>Contact us</h2>
            <p className="muted" style={{ marginTop:12 }}>Have a unique catalog or compliance need? Send a quick note.</p>
            <ContactForm />
          </div>
        </div>
      </section>
    </>
  );
}

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
