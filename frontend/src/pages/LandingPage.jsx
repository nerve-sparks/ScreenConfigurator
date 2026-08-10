import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext.jsx'
import Button from '../components/ui/Button.jsx'
import ThemeToggle from '../components/ui/ThemeToggle.jsx'
import { Eyebrow } from '../components/ui/Badge.jsx'
import {
  ArrowRight,
  Check,
  Download,
  Eye,
  FileText,
  GitBranch,
  Layers,
  Lock,
  Menu,
  Shield,
  Sparkles,
  Users,
  Wand,
  X,
  Zap,
} from '../components/ui/Icons.jsx'
import xsparksLogo from '../assets/xparks_logo.svg'
import '../landing.css'

const FEATURES = [
  {
    icon: <Wand size={20} />,
    title: 'AI-proposed screen plans',
    body:
      'Describe the agent in plain language. The model proposes an ordered plan of form and content screens — you rename, reorder, or remove before a single screen is generated.',
  },
  {
    icon: <Check size={20} />,
    title: 'Human approval on every field',
    body:
      'Nothing an LLM suggests reaches a user unreviewed. Edit, exclude, or add your own fields, and approve the layout as a whole before the screen can be published.',
  },
  {
    icon: <Layers size={20} />,
    title: 'Multi-screen journeys',
    body:
      'Up to 20 independently editable screens per agent. Single forms or multi-step wizards, with accessible ordering and a selectable start screen.',
  },
  {
    icon: <GitBranch size={20} />,
    title: 'Immutable, atomic releases',
    body:
      'Publishing snapshots every approved screen, its order, and its presentation into one numbered release. Releases are never rewritten — restore any version into fresh drafts.',
  },
  {
    icon: <Zap size={20} />,
    title: 'One agent, many endpoints',
    body:
      'Route a single journey to several agent APIs. Share screens across endpoints, or give each endpoint its own screen group so field values never cross over.',
  },
  {
    icon: <Download size={20} />,
    title: 'Exportable frontends',
    body:
      'Download any release as editable React/Vite source with a verified lockfile, plus a self-contained preview that opens in a browser without Node.js.',
  },
]

const STEPS = [
  {
    label: 'Describe',
    body: 'Name the agent, write a brief, attach shared auth and endpoints.',
  },
  {
    label: 'Plan',
    body: 'The model proposes an ordered screen plan. You edit it before anything is built.',
  },
  {
    label: 'Generate',
    body: 'Each screen is generated independently and checked against the manifest contract.',
  },
  {
    label: 'Approve',
    body: 'Review every field and layout block. Retry a failed generation without losing the rest.',
  },
  {
    label: 'Publish',
    body: 'One atomic snapshot becomes an immutable, numbered release your users can open.',
  },
]

const GUARANTEES = [
  {
    icon: <Shield size={18} />,
    title: 'Three validation layers',
    body:
      'Safety validation strips markup and identity metadata. A meta-schema enforces the audited field subset. Semantic validation checks constraints, ordering, and wizard-group ownership.',
  },
  {
    icon: <Lock size={18} />,
    title: 'Secrets stay server-side',
    body:
      'Runtime auth never reaches the browser, and exported packages ship without credentials. Preview answers and LLM reasoning are never persisted.',
  },
  {
    icon: <FileText size={18} />,
    title: 'No arbitrary markup, ever',
    body:
      'Content is allowlisted JSON blocks mapped to controlled React components. There is no path to raw HTML, JavaScript, CSS, or hand-edited JSON.',
  },
  {
    icon: <Eye size={18} />,
    title: 'Auditable by design',
    body:
      'Every release records its source revisions. Older releases stay loadable forever and can be restored without rewriting history.',
  },
]

const NAV_LINKS = [
  { href: '#features', label: 'Features' },
  { href: '#how', label: 'How it works' },
  { href: '#safety', label: 'Safety' },
]

/** Abstract product mock, drawn in markup so it themes and scales with the page. */
function ProductMock() {
  return (
    <div className="lp-mock" aria-hidden="true">
      <div className="lp-mock-chrome">
        <span className="lp-mock-dot" />
        <span className="lp-mock-dot" />
        <span className="lp-mock-dot" />
        <span className="lp-mock-url">studio / support-triage-agent</span>
      </div>

      <div className="lp-mock-body">
        <aside className="lp-mock-rail">
          <span className="lp-mock-rail-title">Screens</span>
          <span className="lp-mock-step is-done"><i>1</i>Welcome</span>
          <span className="lp-mock-step is-active"><i>2</i>Request details</span>
          <span className="lp-mock-step"><i>3</i>Attachments</span>
          <span className="lp-mock-step"><i>4</i>Review</span>
          <span className="lp-mock-rail-note">
            <Sparkles size={13} /> Plan proposed by AI
          </span>
        </aside>

        <div className="lp-mock-canvas">
          <div className="lp-mock-head">
            <span className="lp-mock-title" />
            <span className="lp-mock-sub" />
          </div>

          <div className="lp-mock-field">
            <span className="lp-mock-label" />
            <span className="lp-mock-input" />
          </div>
          <div className="lp-mock-field">
            <span className="lp-mock-label is-short" />
            <span className="lp-mock-input" />
          </div>
          <div className="lp-mock-field">
            <span className="lp-mock-label is-mid" />
            <span className="lp-mock-input is-tall" />
          </div>

          <div className="lp-mock-actions">
            <span className="lp-mock-btn is-ghost" />
            <span className="lp-mock-btn is-solid" />
          </div>
        </div>
      </div>

      <span className="lp-mock-chip lp-mock-chip-approve">
        <Check size={13} /> Field approved
      </span>
      <span className="lp-mock-chip lp-mock-chip-valid">
        <Shield size={13} /> Manifest validated
      </span>
    </div>
  )
}

export default function LandingPage() {
  const { user } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Close the mobile menu when the viewport grows past the breakpoint.
  useEffect(() => {
    if (!menuOpen) return undefined
    const query = window.matchMedia('(min-width: 861px)')
    const onChange = (event) => { if (event.matches) setMenuOpen(false) }
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [menuOpen])

  const primaryCta = user
    ? { to: '/library', label: 'Open the library' }
    : { to: '/login', label: 'Sign in to Studio' }

  return (
    <div className="lp">
      <a className="lp-skip" href="#main">Skip to content</a>

      <header className={`lp-nav ${scrolled ? 'is-scrolled' : ''}`.trim()}>
        <div className="lp-nav-inner">
          <Link className="lp-brand" to="/" aria-label="Agent Screen Studio home">
            <img src={xsparksLogo} alt="NerveSparks" width={190} height={32} />
          </Link>

          <nav className="lp-nav-links" aria-label="Primary">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href}>{link.label}</a>
            ))}
          </nav>

          <div className="lp-nav-actions">
            <ThemeToggle />
            <Button variant="ghost" size="sm" to={primaryCta.to} className="lp-nav-signin">
              {user ? 'Library' : 'Sign in'}
            </Button>
            <Button
              variant="primary"
              size="sm"
              to={user ? '/studio/agents/new' : '/login'}
              iconRight={<ArrowRight size={15} />}
            >
              {user ? 'New agent' : 'Get started'}
            </Button>
            <button
              type="button"
              className="lp-nav-toggle"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        {menuOpen ? (
          <div className="lp-nav-drawer">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} onClick={() => setMenuOpen(false)}>
                {link.label}
              </a>
            ))}
            <Link to={primaryCta.to} onClick={() => setMenuOpen(false)}>
              {primaryCta.label}
            </Link>
          </div>
        ) : null}
      </header>

      <main id="main">
        {/* ---------------------------------------------------------- HERO */}
        <section className="lp-hero">
          <div className="lp-hero-glow" aria-hidden="true" />
          <div className="lp-container lp-hero-inner">
            <div className="lp-hero-copy">
              <Eyebrow icon={<Sparkles size={13} />}>Agent Screen Studio</Eyebrow>

              <h1>
                Turn a sentence about your agent into a
                {' '}
                <span className="lp-underline">production input experience</span>
              </h1>

              <p className="lp-lede">
                Agent Screen Studio designs the screens people fill in before your
                agent runs — proposed by AI, approved by a human, validated by the
                backend, and shipped as an immutable release.
              </p>

              <div className="lp-hero-actions">
                <Button
                  variant="primary"
                  size="lg"
                  to={primaryCta.to}
                  iconRight={<ArrowRight size={17} />}
                >
                  {primaryCta.label}
                </Button>
                <Button variant="secondary" size="lg" href="#how">
                  See how it works
                </Button>
              </div>

              <ul className="lp-hero-points">
                <li><Check size={15} /> No raw HTML, scripts, or CSS — ever</li>
                <li><Check size={15} /> Human approval before publish</li>
                <li><Check size={15} /> Releases you can restore, not rewrite</li>
              </ul>
            </div>

            <div className="lp-hero-visual">
              <ProductMock />
            </div>
          </div>
        </section>

        {/* --------------------------------------------------------- STATS */}
        <section className="lp-stats">
          <div className="lp-container lp-stats-grid">
            {[
              { value: '20', label: 'screens per agent project' },
              { value: '3', label: 'validation layers before publish' },
              { value: '0', label: 'lines of raw HTML accepted' },
              { value: '1-click', label: 'frontend export per release' },
            ].map((stat) => (
              <div className="lp-stat" key={stat.label}>
                <strong>{stat.value}</strong>
                <span>{stat.label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------------ FEATURES */}
        <section className="lp-section" id="features">
          <div className="lp-container">
            <div className="lp-section-head">
              <Eyebrow icon={<Layers size={13} />}>Capabilities</Eyebrow>
              <h2>Everything between “we built an agent” and “people can use it”</h2>
              <p>
                Building input forms by hand for every agent is slow, inconsistent,
                and easy to get wrong. Studio makes that step repeatable.
              </p>
            </div>

            <div className="lp-feature-grid">
              {FEATURES.map((feature) => (
                <article className="lp-feature" key={feature.title}>
                  <span className="lp-feature-icon">{feature.icon}</span>
                  <h3>{feature.title}</h3>
                  <p>{feature.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ----------------------------------------------------- HOW IT WORKS */}
        <section className="lp-section lp-section-alt" id="how">
          <div className="lp-container">
            <div className="lp-section-head">
              <Eyebrow icon={<Wand size={13} />}>Workflow</Eyebrow>
              <h2>The model proposes. A human decides.</h2>
              <p>
                Five steps from a plain-language brief to a release your users can
                open. Nothing skips the approval gate.
              </p>
            </div>

            <ol className="lp-steps">
              {STEPS.map((step, index) => (
                <li className="lp-step" key={step.label}>
                  <span className="lp-step-index">{index + 1}</span>
                  <h3>{step.label}</h3>
                  <p>{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* --------------------------------------------------- AUDIENCE SPLIT */}
        <section className="lp-section">
          <div className="lp-container lp-split">
            <div className="lp-split-copy">
              <Eyebrow icon={<Users size={13} />}>Who it&rsquo;s for</Eyebrow>
              <h2>One workflow, three audiences</h2>
              <p>
                Creators stay in control of what users see. Engineers keep control of
                where the answers go. End users get a guided journey instead of a raw
                API or a chat dump.
              </p>
              <Button
                variant="outline"
                to={primaryCta.to}
                iconRight={<ArrowRight size={15} />}
              >
                {primaryCta.label}
              </Button>
            </div>

            <div className="lp-audience-list">
              {[
                {
                  role: 'Product & ops teams',
                  body: 'Describe an agent, approve the generated screens, publish a release — without writing code.',
                },
                {
                  role: 'Engineers',
                  body: 'Attach endpoint URLs, shared auth, and scorecard contracts. Export a release as real source you own.',
                },
                {
                  role: 'End users',
                  body: 'Open a published link and complete a clear, branded journey with validation at every step.',
                },
              ].map((item) => (
                <div className="lp-audience" key={item.role}>
                  <h3>{item.role}</h3>
                  <p>{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* --------------------------------------------------------- SAFETY */}
        <section className="lp-section lp-section-alt" id="safety">
          <div className="lp-container">
            <div className="lp-section-head">
              <Eyebrow icon={<Shield size={13} />}>Safety &amp; governance</Eyebrow>
              <h2>Deliberately strict about what it will let you ship</h2>
              <p>
                The manifest is the contract shared by the model, the backend, and the
                frontend — and it is enforced on the server, not in the browser.
              </p>
            </div>

            <div className="lp-guarantee-grid">
              {GUARANTEES.map((item) => (
                <article className="lp-guarantee" key={item.title}>
                  <span className="lp-guarantee-icon">{item.icon}</span>
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.body}</p>
                  </div>
                </article>
              ))}
            </div>

            <div className="lp-scope">
              <h3>What Studio deliberately does not do</h3>
              <ul>
                <li>Run or host your agent&rsquo;s logic</li>
                <li>Replace your agent-builder or pipeline platform</li>
                <li>Generate result dashboards from an output schema</li>
                <li>Embed a separate backend for every agent</li>
                <li>Bypass validation to ship unapproved screens</li>
              </ul>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ CTA */}
        <section className="lp-cta">
          <div className="lp-container lp-cta-inner">
            <h2>Ship the input experience your agent deserves</h2>
            <p>
              Describe an agent, approve its screens, and publish a release in a
              single sitting.
            </p>
            <div className="lp-cta-actions">
              <Button
                variant="primary"
                size="lg"
                to={primaryCta.to}
                iconRight={<ArrowRight size={17} />}
              >
                {primaryCta.label}
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-container lp-footer-inner">
          <div className="lp-footer-brand">
            <img src={xsparksLogo} alt="NerveSparks" width={170} height={28} />
            <p>
              Agent Screen Studio turns a plain-language agent description into an
              approved, versioned, multi-screen experience.
            </p>
          </div>

          <nav className="lp-footer-links" aria-label="Footer">
            <div>
              <h4>Product</h4>
              <a href="#features">Features</a>
              <a href="#how">How it works</a>
              <a href="#safety">Safety</a>
            </div>
            <div>
              <h4>Studio</h4>
              <Link to="/login">Sign in</Link>
              <Link to="/library">Agent library</Link>
              <Link to="/studio/agents/new">New agent</Link>
            </div>
          </nav>
        </div>

        <div className="lp-container lp-footer-base">
          <span>&copy; {new Date().getFullYear()} NerveSparks. All rights reserved.</span>
          <span>Built for teams shipping AI agents.</span>
        </div>
      </footer>
    </div>
  )
}
