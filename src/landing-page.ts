const HERO_VIDEO_URL =
  "https://assets.mixkit.co/active_storage/video_items/100415/1724198576/100415-video-720.mp4";
const HERO_POSTER_URL =
  "https://assets.mixkit.co/active_storage/video_items/100415/1724198576/100415-video-thumb-720-0.jpg";

export function renderLandingPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#07100e" />
  <meta
    name="description"
    content="MindMonk Digest turns favorite YouTube podcasts into personal Telegram briefings with insights, patterns, idea grading, and tailored learnings."
  />
  <title>MindMonk Digest</title>
  <style>
    :root {
      color-scheme: dark;
      --ink: #f7f3e8;
      --muted: rgba(247, 243, 232, 0.76);
      --line: rgba(247, 243, 232, 0.22);
      --shadow: rgba(3, 10, 8, 0.62);
      --moss: #a7c957;
      --river: #7bdff2;
      --soil: #d7a86e;
    }

    * {
      box-sizing: border-box;
    }

    html {
      min-height: 100%;
      background: #07100e;
    }

    body {
      min-height: 100%;
      margin: 0;
      color: var(--ink);
      background: #07100e;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }

    a {
      color: inherit;
      text-decoration: none;
    }

    .page {
      min-height: 100%;
      overflow-x: hidden;
      background:
        radial-gradient(circle at 18% 16%, rgba(167, 201, 87, 0.22), transparent 28rem),
        linear-gradient(180deg, #07100e 0%, #0d1713 64%, #12110d 100%);
    }

    .hero {
      position: relative;
      min-height: 92svh;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      isolation: isolate;
      overflow: hidden;
      padding: 1.25rem;
    }

    .hero video,
    .poster-fallback {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      z-index: -4;
    }

    .hero video {
      transform: scale(1.08);
      animation: aerial-drift 24s ease-in-out infinite alternate;
    }

    .poster-fallback {
      background-image: url("${HERO_POSTER_URL}");
      background-size: cover;
      background-position: center;
      transform: scale(1.08);
      z-index: -5;
    }

    .hero::before {
      content: "";
      position: absolute;
      inset: 0;
      z-index: -3;
      background:
        linear-gradient(90deg, rgba(3, 10, 8, 0.76) 0%, rgba(3, 10, 8, 0.28) 48%, rgba(3, 10, 8, 0.58) 100%),
        linear-gradient(180deg, rgba(3, 10, 8, 0.24) 0%, rgba(3, 10, 8, 0.1) 44%, rgba(7, 16, 14, 0.88) 100%);
    }

    .hero::after {
      content: "";
      position: absolute;
      inset: auto 0 0;
      height: 18rem;
      z-index: -2;
      background: linear-gradient(180deg, transparent, #07100e 86%);
    }

    .nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      width: min(100%, 76rem);
      margin: 0 auto;
      font-size: 0.82rem;
      font-weight: 700;
      text-transform: uppercase;
      color: rgba(247, 243, 232, 0.86);
    }

    .mark {
      display: inline-flex;
      align-items: center;
      gap: 0.7rem;
      min-width: 0;
    }

    .mark-symbol {
      width: 2.2rem;
      height: 2.2rem;
      display: grid;
      place-items: center;
      border: 1px solid var(--line);
      border-radius: 50%;
      background: rgba(247, 243, 232, 0.1);
      box-shadow: 0 1rem 3rem var(--shadow);
    }

    .mark-symbol svg {
      width: 1.25rem;
      height: 1.25rem;
      stroke: var(--ink);
    }

    .nav-links {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .nav-links a {
      opacity: 0.84;
      transition: opacity 160ms ease, transform 160ms ease;
    }

    .nav-links a:hover {
      opacity: 1;
      transform: translateY(-1px);
    }

    .hero-copy {
      width: min(100%, 76rem);
      margin: 0 auto 4.5rem;
      display: grid;
      gap: 1.8rem;
      padding-top: 10rem;
    }

    .eyebrow {
      width: fit-content;
      padding: 0.5rem 0.75rem;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: rgba(7, 16, 14, 0.42);
      backdrop-filter: blur(18px);
      color: rgba(247, 243, 232, 0.82);
      font-size: 0.78rem;
      font-weight: 800;
      text-transform: uppercase;
    }

    h1 {
      max-width: 11ch;
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      font-size: 5.7rem;
      line-height: 0.93;
      font-weight: 500;
      letter-spacing: 0;
      text-wrap: balance;
      text-shadow: 0 1.2rem 5rem rgba(0, 0, 0, 0.48);
    }

    .hero-text {
      max-width: 39rem;
      margin: 0;
      color: var(--muted);
      font-size: 1.18rem;
      line-height: 1.7;
      font-weight: 520;
    }

    .hero-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.85rem;
    }

    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.55rem;
      min-height: 3rem;
      padding: 0.78rem 1rem;
      border-radius: 999px;
      border: 1px solid rgba(247, 243, 232, 0.32);
      background: rgba(247, 243, 232, 0.12);
      backdrop-filter: blur(18px);
      color: var(--ink);
      font-size: 0.92rem;
      font-weight: 800;
      box-shadow: 0 1rem 2rem rgba(0, 0, 0, 0.24);
      transition: transform 160ms ease, background 160ms ease, border-color 160ms ease;
    }

    .button.primary {
      color: #07100e;
      background: linear-gradient(135deg, var(--ink), #d9f99d);
      border-color: rgba(247, 243, 232, 0.82);
    }

    .button:hover {
      transform: translateY(-2px);
      border-color: rgba(247, 243, 232, 0.56);
      background: rgba(247, 243, 232, 0.18);
    }

    .button.primary:hover {
      background: linear-gradient(135deg, #ffffff, #c6f56f);
    }

    .button svg {
      width: 1.05rem;
      height: 1.05rem;
      stroke-width: 2.2;
      flex: 0 0 auto;
    }

    .signal {
      width: min(100%, 76rem);
      margin: -3.4rem auto 0;
      padding: 0 1.25rem 4rem;
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 1px;
      position: relative;
      z-index: 1;
    }

    .signal-item {
      min-height: 8rem;
      display: grid;
      align-content: center;
      gap: 0.72rem;
      padding: 1.25rem;
      border-top: 1px solid var(--line);
      background: rgba(7, 16, 14, 0.48);
      backdrop-filter: blur(18px);
    }

    .signal-item:first-child {
      border-left: 1px solid var(--line);
      border-top-left-radius: 8px;
      border-bottom-left-radius: 8px;
    }

    .signal-item:last-child {
      border-right: 1px solid var(--line);
      border-top-right-radius: 8px;
      border-bottom-right-radius: 8px;
    }

    .signal-item strong {
      font-size: 0.95rem;
    }

    .signal-item span {
      color: rgba(247, 243, 232, 0.66);
      font-size: 0.9rem;
      line-height: 1.45;
    }

    .flow {
      width: min(100%, 76rem);
      margin: 0 auto;
      padding: 0 1.25rem 5rem;
      display: grid;
      grid-template-columns: 0.82fr 1.18fr;
      gap: 3rem;
      align-items: start;
    }

    .flow h2 {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      font-size: 3.1rem;
      line-height: 1;
      font-weight: 500;
      letter-spacing: 0;
    }

    .flow p {
      margin: 0;
      color: var(--muted);
      font-size: 1.05rem;
      line-height: 1.72;
    }

    .steps {
      display: grid;
      gap: 1px;
      border: 1px solid rgba(247, 243, 232, 0.18);
      border-radius: 8px;
      overflow: hidden;
      background: rgba(247, 243, 232, 0.16);
    }

    .step {
      display: grid;
      grid-template-columns: 3.2rem minmax(0, 1fr);
      gap: 1rem;
      align-items: center;
      padding: 1.15rem;
      background: rgba(247, 243, 232, 0.06);
    }

    .step-number {
      display: grid;
      place-items: center;
      width: 2.25rem;
      height: 2.25rem;
      border-radius: 50%;
      color: #07100e;
      background: var(--moss);
      font-weight: 900;
      font-size: 0.78rem;
    }

    .step strong {
      display: block;
      margin-bottom: 0.25rem;
      font-size: 1rem;
    }

    .step span {
      color: rgba(247, 243, 232, 0.68);
      line-height: 1.48;
      font-size: 0.95rem;
    }

    .footer {
      width: min(100%, 76rem);
      margin: 0 auto;
      padding: 0 1.25rem 2rem;
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      color: rgba(247, 243, 232, 0.52);
      font-size: 0.82rem;
    }

    @keyframes aerial-drift {
      0% {
        transform: scale(1.08) translate3d(-1.2%, 0, 0);
      }
      100% {
        transform: scale(1.18) translate3d(1.2%, -1.6%, 0);
      }
    }

    @media (max-width: 820px) {
      .hero {
        min-height: 91svh;
        padding: 1rem;
      }

      .nav {
        align-items: flex-start;
      }

      .nav-links {
        display: none;
      }

      .hero-copy {
        margin-bottom: 4rem;
        padding-top: 7rem;
      }

      h1 {
        max-width: 10ch;
        font-size: 4.25rem;
        line-height: 0.94;
      }

      .hero-text {
        font-size: 1.02rem;
        line-height: 1.62;
      }

      .signal {
        grid-template-columns: 1fr;
        margin-top: -2.5rem;
        padding-bottom: 3.25rem;
      }

      .signal-item,
      .signal-item:first-child,
      .signal-item:last-child {
        min-height: 6.8rem;
        border-left: 1px solid var(--line);
        border-right: 1px solid var(--line);
        border-radius: 0;
      }

      .signal-item:first-child {
        border-top-left-radius: 8px;
        border-top-right-radius: 8px;
      }

      .signal-item:last-child {
        border-bottom-left-radius: 8px;
        border-bottom-right-radius: 8px;
      }

      .flow {
        grid-template-columns: 1fr;
        gap: 1.7rem;
      }

      .flow h2 {
        font-size: 2.35rem;
      }

      .footer {
        flex-direction: column;
      }
    }

    @media (max-width: 460px) {
      h1 {
        font-size: 3.35rem;
      }

      .hero-actions {
        align-items: stretch;
      }

      .button {
        width: 100%;
      }

      .step {
        grid-template-columns: 2.6rem minmax(0, 1fr);
        padding: 1rem;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      *,
      *::before,
      *::after {
        animation-duration: 1ms !important;
        animation-iteration-count: 1 !important;
        scroll-behavior: auto !important;
      }
    }
  </style>
</head>
<body>
  <main class="page">
    <section class="hero" aria-label="MindMonk Digest">
      <div class="poster-fallback" aria-hidden="true"></div>
      <video
        id="hero-video"
        autoplay
        muted
        loop
        playsinline
        preload="metadata"
        poster="${HERO_POSTER_URL}"
        aria-hidden="true"
      >
        <source src="${HERO_VIDEO_URL}" type="video/mp4" />
      </video>

      <nav class="nav" aria-label="Primary navigation">
        <a class="mark" href="/" aria-label="MindMonk Digest home">
          <span class="mark-symbol" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M4 16.5c4.2-5 7.8-7.5 10.8-7.5 2.2 0 3.9 1.2 5.2 3.5" />
              <path d="M4 16.5c3.1-.2 5.7.2 7.8 1.2 2.4 1.1 4.7.8 7-1" />
              <path d="M8 8.5h.01" />
            </svg>
          </span>
          <span>MindMonk Digest</span>
        </a>
        <div class="nav-links">
          <a href="#flow">Flow</a>
          <a href="https://t.me/Mindmonk_gptbot">Telegram</a>
        </div>
      </nav>

      <div class="hero-copy">
        <div class="eyebrow">YouTube podcasts to personal signal</div>
        <h1>Listen less. Learn deeper.</h1>
        <p class="hero-text">
          MindMonk follows your favorite channels, reads each new transcript, grades the ideas without hype, and sends a tailored briefing to Telegram.
        </p>
        <div class="hero-actions">
          <a class="button primary" href="https://t.me/Mindmonk_gptbot">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M22 2 11 13" />
              <path d="m22 2-7 20-4-9-9-4 20-7Z" />
            </svg>
            Open Telegram
          </a>
          <a class="button" href="#flow">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M12 5v14" />
              <path d="m19 12-7 7-7-7" />
            </svg>
            See flow
          </a>
        </div>
      </div>
    </section>

    <section class="signal" aria-label="Digest sections">
      <div class="signal-item">
        <strong>Key insights</strong>
        <span>Core ideas distilled from long conversations.</span>
      </div>
      <div class="signal-item">
        <strong>Patterns</strong>
        <span>Useful behaviors separated from anti-patterns.</span>
      </div>
      <div class="signal-item">
        <strong>Idea grading</strong>
        <span>Skeptical scoring by a chosen LLM.</span>
      </div>
      <div class="signal-item">
        <strong>Personal fit</strong>
        <span>Lessons matched to your profile and goals.</span>
      </div>
    </section>

    <section class="flow" id="flow" aria-label="How MindMonk Digest works">
      <div>
        <h2>From feed noise to field notes.</h2>
        <p>
          Register the channels that matter. MindMonk watches for new uploads, turns captions into structured thinking, and delivers only the parts worth carrying forward.
        </p>
      </div>
      <div class="steps">
        <div class="step">
          <span class="step-number">01</span>
          <div>
            <strong>Track the right voices</strong>
            <span>Add YouTube channels once; the bot handles the watchlist.</span>
          </div>
        </div>
        <div class="step">
          <span class="step-number">02</span>
          <div>
            <strong>Extract the transcript</strong>
            <span>New episodes are read from available YouTube captions.</span>
          </div>
        </div>
        <div class="step">
          <span class="step-number">03</span>
          <div>
            <strong>Shape the digest</strong>
            <span>Insights, patterns, grading, and personal applications arrive in Telegram.</span>
          </div>
        </div>
      </div>
    </section>

    <footer class="footer">
      <span>MindMonk Digest</span>
      <span>Built for high-signal podcast learning.</span>
    </footer>
  </main>

  <script>
    const video = document.getElementById("hero-video");
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (prefersReducedMotion.matches && video) {
      video.pause();
      video.removeAttribute("autoplay");
    }
  </script>
</body>
</html>`;
}
