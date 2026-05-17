import { Link } from "react-router-dom";

const cards = [
  {
    to: "/request",
    title: "Requester",
    desc: "Place an order by selecting MO and component fields from the inventory test data.",
    tag: "Order parts",
  },
  {
    to: "/pick",
    title: "Picker",
    desc: "See who ordered what, when it was ordered, and the key inventory fields needed for picking.",
    tag: "Pick orders",
  },
  {
    to: "/audit",
    title: "Auditor",
    desc: "Review tamper-evident audit log entries, import latest inventory CSV, and export on-site inventory.",
    tag: "Audit & inventory I/O",
  },
  {
    to: "/inventory",
    title: "Inventory",
    desc: "View seeded inventory parts (test data) with MO/component fields for UI testing.",
    tag: "Open inventory",
  },
];

export function LandingPage() {
  return (
    <div className="page landing">
      <div className="ui-card ui-card--padded landing__welcome">
        <p className="landing__eyebrow">CostPoint Parts Management</p>
        <p className="landing__lede">
          Request parts, pick from stock, and audit activity—optimized for tablets in the warehouse.
        </p>
      </div>

      <section className="landing__grid" aria-label="Workspaces">
        {cards.map((c) => (
          <article key={c.to} className="role-card">
            <span className="role-card__label">{c.title}</span>
            <h2 className="role-card__title">{c.tag}</h2>
            <p className="role-card__desc">{c.desc}</p>
            <Link to={c.to} className="role-card__cta">
              Open
            </Link>
          </article>
        ))}
      </section>
    </div>
  );
}
