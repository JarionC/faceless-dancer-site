import type { SiteSettings } from "../lib/api";
import heroMainImage from "../assets/hero/hero_main.png";
import heroMainBgImage from "../assets/hero/hero-main-bg.jpeg";
import logoImage from "../assets/hero/logo.png";

interface Props {
  settings: SiteSettings;
}

export function HeroSection({ settings }: Props) {
  const tokenAddressLabel = settings.tokenAddress || "Soon";
  const socialLinks = [
    { label: "X / Twitter", href: settings.twitterUrl, visible: settings.showTwitter },
    { label: "YouTube", href: settings.youtubeUrl, visible: settings.showYoutube },
    { label: "Telegram", href: settings.telegramUrl, visible: settings.showTelegram },
    { label: "DexScreener", href: settings.dexscreenerUrl, visible: settings.showDexscreener },
  ].filter((link) => link.visible && link.href);

  return (
    <section className="hero">
      <div className="hero__content">
        <div className="hero__eyebrow">
          <img className="hero__logo" src={logoImage} alt="The Faceless Dancer logo" />
          <span>The mysterious dancer who never stops</span>
        </div>

        <h1 className="hero__title">The Faceless Dancer</h1>
        <p className="hero__tagline">
          A dark-stage character project where holders shape the visual world,
          soundtrack, and stream schedule from the shadows. Just how far will his dancing take him?
        </p>

        <div className="hero__actions">
          {settings.pumpFunUrl ? (
            <a
              className="cta-button"
              href={settings.pumpFunUrl}
              target="_blank"
              rel="noreferrer"
            >
              Buy On pump.fun
            </a>
          ) : null}
          <a className="ghost-link" href="#project-overview">
            Explore The Project
          </a>
        </div>

        <div className="social-row">
          {socialLinks.map((link) => (
            <a
              key={link.label}
              className="social-pill"
              href={link.href}
              target="_blank"
              rel="noreferrer"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="hero__token">
          <span className="section-kicker">Token Address</span>
          <code>{tokenAddressLabel}</code>
        </div>
      </div>

      <div className="hero__visual">
        <div className="hero__visual-frame">
          <img className="hero__main-bg" src={heroMainBgImage} alt="" aria-hidden="true" />
          <img className="hero__main-image" src={heroMainImage} alt="The Faceless Dancer hero artwork" />
        </div>
      </div>
    </section>
  );
}
