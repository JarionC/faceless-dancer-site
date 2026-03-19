import card1Image from "../assets/overview/card1.jpeg";
import card2Image from "../assets/overview/card2.jpeg";
import card3Image from "../assets/overview/card3.jpeg";
import narrativeImage from "../assets/overview/narrative.jpeg";

const featureCards = [
  {
    title: "Wallet-Verified Visual Drops",
    imageSrc: card1Image,
    imageAlt: "Layered character asset submission interface with wallet verification",
    copy:
      "Verified holders can submit background art and character elements for approved stream windows. Each accepted asset becomes part of the live visual identity of The Faceless Dancer.",
  },
  {
    title: "Music-Driven Performance Requests",
    imageSrc: card2Image,
    imageAlt: "Audio-driven performance visual with waveform and play interface",
    copy:
      "Holders can submit music for specific scheduled sessions, helping define the rhythm, mood, and energy of each live appearance. Audio selection becomes part of the stream’s evolving creative direction.",
  },
  {
    title: "Scheduled Holder Access",
    imageSrc: card3Image,
    imageAlt: "Approval timeline feeding into a live on-air schedule",
    copy:
      "Submissions are tied to requested usage windows, giving holders structured access to influence when assets appear on stream. Approved slots are reflected in the schedule board managed through the admin side.",
  },
];

export function OverviewSection() {
  return (
    <section id="project-overview" className="overview">
      <div className="overview__intro">
        <p className="section-kicker">Project Overview</p>
        <h2 className="section-title">
          A token-powered live stream where holders help shape the performance.
        </h2>
        <p className="section-copy">
          The Faceless Dancer is a live stream built around a single evolving performer, where verified token holders can shape the show through wallet-authenticated submissions. Holders can request time windows and submit backgrounds, character graphics, and music to be used on stream, turning ownership into direct creative participation.
        </p>
      </div>

      <div className="feature-grid">
        {featureCards.map((card, index) => (
          <article key={card.title} className={`feature-card feature-card--${index + 1}`}>
            <div className="feature-card__art">
              <img src={card.imageSrc} alt={card.imageAlt} className="feature-card__image" />
            </div>
            <h3>{card.title}</h3>
            <p>{card.copy}</p>
          </article>
        ))}
      </div>

      <div className="story-grid">
        <article className="story-panel">
          <p className="section-kicker">Placeholder Narrative</p>
          <h3>Verified holders submit. Approved windows go live. The stream evolves in public.</h3>
          <p>
            Today, The Faceless Dancer uses wallet signature verification to confirm holder access before accepting background art, character graphics, and music submissions tied to requested time windows. Over time, this system can expand into on-chain submission handling and holder voting for decisions like stream direction, validation rules, and infrastructure choices.
          </p>
        </article>

        <div className="story-visual">
          <img
            src={narrativeImage}
            alt="Narrative overview showing background, character, music, and live output"
            className="story-visual__image"
          />
        </div>
      </div>
    </section>
  );
}
