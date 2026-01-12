import Link from "next/link";

export default function PricingPage() {
  return (
    <>
      {/* Hero Section */}
      <section className="pricing-hero">
        <div className="hero-bg" aria-hidden />
        <div className="container" style={{ maxWidth: 1180, paddingTop: 160, paddingBottom: 80 }}>
          <div style={{ textAlign: 'center', maxWidth: 800, margin: '0 auto' }}>
            <span className="eyebrow">Transparent Pricing</span>
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
              Simple, Scalable Pricing for Every Stage of Growth
            </h1>
            <p className="lead" style={{ fontSize: 20, maxWidth: 600, margin: '0 auto' }}>
              Start with powerful automation. Scale with enterprise capabilities. 
              Pay only for what drives real revenue.
            </p>
          </div>
        </div>
      </section>

      {/* Pricing Cards */}
      <section className="section" style={{ paddingTop: 40, paddingBottom: 100 }}>
        <div className="container" style={{ maxWidth: 1180 }}>
          <div className="grid" style={{ display:'grid', gap:28, gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))', alignItems:'stretch' }}>
            
            {/* Starter Plan */}
            <div className="glass" style={{ display:'flex', flexDirection:'column', gap:20, padding:'36px 32px' }}>
              <div>
                <span style={{ 
                  fontSize: 12, 
                  fontWeight: 600, 
                  letterSpacing: '0.1em', 
                  textTransform: 'uppercase',
                  color: 'var(--muted)'
                }}>
                  Starter
                </span>
                <h3 style={{ fontSize: 28, marginTop: 8 }}>Launch Fast</h3>
                <p className="muted" style={{ fontSize: 15, marginTop: 12, lineHeight: 1.6 }}>
                  Perfect for businesses ready to deploy AI-powered WhatsApp automation 
                  and start converting conversations into customers.
                </p>
              </div>
              
              <ul style={{ listStyle:'none', padding:0, margin:0, display:'flex', flexDirection:'column', gap:14 }}>
                <PricingFeature>Unlimited document uploads</PricingFeature>
                <PricingFeature>Custom tone & brand voice configuration</PricingFeature>
                <PricingFeature>Intelligent guardrails & compliance</PricingFeature>
                <PricingFeature>Basic conversation analytics</PricingFeature>
                <PricingFeature>Email support</PricingFeature>
              </ul>
              
              <div style={{ marginTop:'auto', paddingTop: 20 }}>
                <div style={{ fontSize: 42, fontWeight: 700, letterSpacing: '-0.02em' }}>
                  RM250
                  <span style={{ fontSize: 16, fontWeight: 400, color: 'var(--muted)' }}> /month</span>
                </div>
                <Link href="/portal" className="btn btn-primary" style={{ marginTop: 20, width: '100%', padding: '14px 24px' }}>
                  Get Started Free
                </Link>
                <p style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', marginTop: 12 }}>
                  14-day free trial • No credit card required
                </p>
              </div>
            </div>

            {/* Growth Plan - Featured */}
            <div style={{ 
              position:'relative', 
              padding: 3, 
              background:'linear-gradient(135deg, var(--gold), var(--gold-light), var(--gold))', 
              borderRadius: 20, 
              boxShadow:'0 20px 60px rgba(184, 134, 11, 0.4), 0 10px 30px rgba(184, 134, 11, 0.3)'
            }}>
              <div className="glass" style={{ display:'flex', flexDirection:'column', gap:20, padding:'36px 32px', position:'relative', borderRadius: 17, height: '100%' }}>
                <span style={{ 
                  position:'absolute', 
                  top: -12, 
                  left: '50%', 
                  transform: 'translateX(-50%)',
                  fontSize: 11, 
                  letterSpacing:'0.1em', 
                  background:'linear-gradient(135deg, var(--gold), var(--gold-light))', 
                  padding:'6px 16px', 
                  borderRadius: 999, 
                  color:'#fff', 
                  fontWeight: 700,
                  textTransform: 'uppercase'
                }}>
                  Most Popular
                </span>
                
                <div>
                  <span style={{ 
                    fontSize: 12, 
                    fontWeight: 600, 
                    letterSpacing: '0.1em', 
                    textTransform: 'uppercase',
                    color: 'var(--gold-light)'
                  }}>
                    Growth
                  </span>
                  <h3 style={{ fontSize: 28, marginTop: 8 }}>Scale Revenue</h3>
                  <p className="muted" style={{ fontSize: 15, marginTop: 12, lineHeight: 1.6 }}>
                    For ambitious teams scaling multi-region sales with advanced 
                    analytics, booking systems, and CRM capabilities.
                  </p>
                </div>
                
                <ul style={{ listStyle:'none', padding:0, margin:0, display:'flex', flexDirection:'column', gap:14 }}>
                  <PricingFeature highlight>Everything in Starter, plus:</PricingFeature>
                  <PricingFeature>Advanced analytics dashboard</PricingFeature>
                  <PricingFeature>Intelligent booking & calendar system</PricingFeature>
                  <PricingFeature>Built-in CRM with lead scoring</PricingFeature>
                  <PricingFeature>Unified inbox for all conversations</PricingFeature>
                  <PricingFeature>Calls + SMS integration</PricingFeature>
                  <PricingFeature>Conversion analytics & exports</PricingFeature>
                  <PricingFeature>Priority support</PricingFeature>
                </ul>
                
                <div style={{ marginTop:'auto', paddingTop: 20 }}>
                  <div style={{ fontSize: 42, fontWeight: 700, letterSpacing: '-0.02em' }}>
                    RM500
                    <span style={{ fontSize: 16, fontWeight: 400, color: 'var(--muted)' }}> /month</span>
                  </div>
                  <Link href="/portal" className="btn btn-primary" style={{ marginTop: 20, width: '100%', padding: '14px 24px' }}>
                    Start Growth Plan
                  </Link>
                  <p style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', marginTop: 12 }}>
                    14-day free trial • Cancel anytime
                  </p>
                </div>
              </div>
            </div>

            {/* Scale Plan */}
            <div className="glass" style={{ display:'flex', flexDirection:'column', gap:20, padding:'36px 32px' }}>
              <div>
                <span style={{ 
                  fontSize: 12, 
                  fontWeight: 600, 
                  letterSpacing: '0.1em', 
                  textTransform: 'uppercase',
                  color: 'var(--muted)'
                }}>
                  Scale
                </span>
                <h3 style={{ fontSize: 28, marginTop: 8 }}>Enterprise Power</h3>
                <p className="muted" style={{ fontSize: 15, marginTop: 12, lineHeight: 1.6 }}>
                  For high-volume organizations requiring deep integrations, 
                  custom workflows, and dedicated enterprise support.
                </p>
              </div>
              
              <ul style={{ listStyle:'none', padding:0, margin:0, display:'flex', flexDirection:'column', gap:14 }}>
                <PricingFeature highlight>Everything in Growth, plus:</PricingFeature>
                <PricingFeature>Custom API integrations</PricingFeature>
                <PricingFeature>Multi-brand & partner usage</PricingFeature>
                <PricingFeature>Custom data retention & SLA</PricingFeature>
                <PricingFeature>Embedded compliance review</PricingFeature>
                <PricingFeature>Dedicated solutions engineer</PricingFeature>
                <PricingFeature>White-glove onboarding</PricingFeature>
                <PricingFeature>24/7 priority support</PricingFeature>
              </ul>
              
              <div style={{ marginTop:'auto', paddingTop: 20 }}>
                <div style={{ fontSize: 42, fontWeight: 700, letterSpacing: '-0.02em' }}>
                  Custom
                </div>
                <Link href="#contact" className="btn" style={{ marginTop: 20, width: '100%', padding: '14px 24px', borderColor: 'var(--border-gold)' }}>
                  Talk to Sales
                </Link>
                <p style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', marginTop: 12 }}>
                  Tailored to your needs
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Comparison Table */}
      <section className="section" style={{ paddingTop: 60, paddingBottom: 100 }}>
        <div className="container" style={{ maxWidth: 1180 }}>
          <div style={{ textAlign: 'center', marginBottom: 60 }}>
            <h2 style={{ 
              fontSize: 36, 
              letterSpacing: '-0.5px', 
              background: 'linear-gradient(135deg, var(--gold-light), var(--gold))', 
              WebkitBackgroundClip: 'text', 
              WebkitTextFillColor: 'transparent', 
              backgroundClip: 'text' 
            }}>
              Compare Plans
            </h2>
            <p className="muted" style={{ marginTop: 14, fontSize: 18 }}>
              Every feature you need to transform conversations into revenue.
            </p>
          </div>

          <div className="glass" style={{ overflow: 'hidden', padding: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '20px 24px', textAlign: 'left', fontSize: 14, fontWeight: 600, color: 'var(--foreground)' }}>Features</th>
                  <th style={{ padding: '20px 24px', textAlign: 'center', fontSize: 14, fontWeight: 600, color: 'var(--muted)' }}>Starter</th>
                  <th style={{ padding: '20px 24px', textAlign: 'center', fontSize: 14, fontWeight: 600, color: 'var(--gold-light)', background: 'rgba(184, 134, 11, 0.1)' }}>Growth</th>
                  <th style={{ padding: '20px 24px', textAlign: 'center', fontSize: 14, fontWeight: 600, color: 'var(--muted)' }}>Scale</th>
                </tr>
              </thead>
              <tbody>
                <ComparisonRow feature="Document uploads" starter="Unlimited" growth="Unlimited" scale="Unlimited" />
                <ComparisonRow feature="AI conversations/month" starter="1,000" growth="10,000" scale="Unlimited" />
                <ComparisonRow feature="Brand voice customization" starter={true} growth={true} scale={true} />
                <ComparisonRow feature="Analytics dashboard" starter="Basic" growth="Advanced" scale="Custom" />
                <ComparisonRow feature="Booking calendar" starter={false} growth={true} scale={true} />
                <ComparisonRow feature="CRM & lead scoring" starter={false} growth={true} scale={true} />
                <ComparisonRow feature="Unified inbox" starter={false} growth={true} scale={true} />
                <ComparisonRow feature="API access" starter={false} growth="Limited" scale="Full" />
                <ComparisonRow feature="Team members" starter="1" growth="5" scale="Unlimited" />
                <ComparisonRow feature="Support" starter="Email" growth="Priority" scale="24/7 Dedicated" />
                <ComparisonRow feature="Custom integrations" starter={false} growth={false} scale={true} />
                <ComparisonRow feature="SLA guarantee" starter={false} growth={false} scale={true} />
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Enterprise CTA */}
      <section className="section" style={{ paddingBottom: 120 }}>
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
              Need a Custom Solution?
            </h2>
            <p className="muted" style={{ fontSize: 18, maxWidth: 500, margin: '0 auto 32px' }}>
              Let&apos;s discuss how Escl8 can be tailored to your enterprise requirements, 
              compliance needs, and scale.
            </p>
            <Link href="/#contact" className="btn btn-primary" style={{ padding: '14px 32px', fontSize: 16 }}>
              Schedule a Demo
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

function PricingFeature({ children, highlight = false }: { children: React.ReactNode; highlight?: boolean }) {
  return (
    <li style={{ 
      display: 'flex', 
      alignItems: 'flex-start', 
      gap: 12,
      fontSize: 14,
      color: highlight ? 'var(--gold-light)' : 'var(--foreground)',
      fontWeight: highlight ? 600 : 400
    }}>
      <svg 
        width="18" 
        height="18" 
        viewBox="0 0 24 24" 
        fill="none" 
        stroke={highlight ? "var(--gold)" : "var(--success)"} 
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

function ComparisonRow({ 
  feature, 
  starter, 
  growth, 
  scale 
}: { 
  feature: string; 
  starter: boolean | string; 
  growth: boolean | string; 
  scale: boolean | string;
}) {
  const renderCell = (value: boolean | string, isGrowth = false) => {
    if (typeof value === 'boolean') {
      return value ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      );
    }
    return <span style={{ color: isGrowth ? 'var(--gold-light)' : 'var(--foreground)' }}>{value}</span>;
  };

  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      <td style={{ padding: '16px 24px', fontSize: 14, color: 'var(--foreground)' }}>{feature}</td>
      <td style={{ padding: '16px 24px', textAlign: 'center' }}>{renderCell(starter)}</td>
      <td style={{ padding: '16px 24px', textAlign: 'center', background: 'rgba(184, 134, 11, 0.05)' }}>{renderCell(growth, true)}</td>
      <td style={{ padding: '16px 24px', textAlign: 'center' }}>{renderCell(scale)}</td>
    </tr>
  );
}
