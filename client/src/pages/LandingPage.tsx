import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { hasAnyRole, type AppRole } from "../auth/roles";

type WorkspaceCard = {
  to: string;
  title: string;
  desc: string;
  tag: string;
  roles: AppRole[];
};

const cards: WorkspaceCard[] = [
  {
    to: "/request",
    title: "Requester",
    desc: "Place an order by selecting MO and component fields from the inventory test data.",
    tag: "Order parts",
    roles: ["Requester"],
  },
  {
    to: "/pick",
    title: "Picker",
    desc: "See who ordered what, when it was ordered, and the key inventory fields needed for picking.",
    tag: "Pick orders",
    roles: ["Picker"],
  },
  {
    to: "/history",
    title: "History",
    desc: "See pick tickets you requested and tickets you completed as picker.",
    tag: "My activity",
    roles: ["Requester", "Picker"],
  },
  {
    to: "/audit",
    title: "Auditor",
    desc: "Review tamper-evident audit log entries, import latest inventory CSV, and export on-site inventory.",
    tag: "Audit & inventory I/O",
    roles: ["Auditor"],
  },
  {
    to: "/inventory",
    title: "Inventory",
    desc: "View seeded inventory parts (test data) with MO/component fields for UI testing.",
    tag: "Open inventory",
    roles: ["Auditor"],
  },
];

export function LandingPage() {
  const { roles } = useAuth();
  const visibleCards = cards.filter((card) => hasAnyRole(roles, card.roles));

  return (
    <div className="page landing">
      <div className="ui-card ui-card--padded landing__welcome">
        <img className="landing__logo" src="/brand/msi-picker-logo.png" alt="MSI Picker" />
        <div className="landing__welcome-copy">
          <p className="landing__eyebrow">CostPoint Parts Management</p>
          <p className="landing__lede">
            Request parts, pick from stock, and audit activity—optimized for tablets in the warehouse.
          </p>
        </div>
      </div>

      <section className="landing__grid" aria-label="Workspaces">
        {visibleCards.length === 0 ? (
          <article className="role-card">
            <span className="role-card__label">Access</span>
            <h2 className="role-card__title">No workspaces assigned</h2>
            <p className="role-card__desc">
              Sign out and back in after your MSI Picker role assignment is updated.
            </p>
          </article>
        ) : null}
        {visibleCards.map((c) => (
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
