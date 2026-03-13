/**
 * ServiceCard — Displays quota info for a non-Apify service (Yelp, Supabase, Google).
 *
 * Props:
 *  - title: string
 *  - icon: string (emoji)
 *  - children: React nodes for the card body
 */
export default function ServiceCard({ title, icon, children }) {
  return (
    <div className="card card-glass fade-in">
      <div className="service-card-header">
        <span className="service-icon">{icon}</span>
        <span className="service-title">{title}</span>
      </div>
      <div className="service-body">
        {children}
      </div>
    </div>
  )
}
