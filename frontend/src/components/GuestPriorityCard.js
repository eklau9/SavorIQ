import Link from 'next/link';

const SEGMENT_METADATA = {
    VIP_AT_RISK: { label: 'At-Risk VIP', color: '#ff4d4f', icon: '🚨' },
    LOST_REGULAR: { label: 'Lost Regular', color: '#faad14', icon: '⏳' },
    NEW_BIG_SPENDER: { label: 'New High-Value', color: '#52c41a', icon: '💎' },
    PROMOTER: { label: 'Promoter', color: '#1890ff', icon: '📣' },
};

export default function GuestPriorityCard({ item }) {
    const { guest, segment, reason, recommended_action, last_visit_days_ago, total_spend } = item;
    const meta = SEGMENT_METADATA[segment] || { label: segment.replace(/_/g, ' '), color: '#8c8c8c', icon: '👤' };

    return (
        <div className="priority-card" style={{ borderLeft: `6px solid ${meta.color}` }}>
            <div className="priority-header">
                <span className="priority-icon">{meta.icon}</span>
                <div className="priority-titles">
                    <Link href={`/guest/${guest.id}`} className="guest-link">
                        {guest.name}
                    </Link>
                    <span className="segment-badge" style={{ backgroundColor: meta.color }}>
                        {meta.label}
                    </span>
                </div>
            </div>

            <div className="priority-body">
                <p className="reason"><span className="label">Insight:</span> {reason}</p>
                <p className="action"><span className="label">Playbook:</span> {recommended_action}</p>
            </div>

            <div className="priority-footer">
                <span className="meta-item">📍 Last seen {last_visit_days_ago} days ago</span>
                <span className="meta-item">💰 ${total_spend.toFixed(2)} total spend</span>
            </div>

            <style jsx>{`
        .priority-card {
          background: rgba(255, 255, 255, 0.04);
          border-radius: 12px;
          padding: 20px;
          margin-bottom: 16px;
          transition: all 0.2s ease-in-out;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }
        .priority-card:hover {
          transform: translateY(-2px) translateX(4px);
          background: rgba(255, 255, 255, 0.08);
          box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
        }
        .priority-header {
          display: flex;
          align-items: center;
          gap: 16px;
          margin-bottom: 16px;
        }
        .priority-icon {
          font-size: 2rem;
          background: rgba(255, 255, 255, 0.05);
          width: 48px;
          height: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 12px;
        }
        .priority-titles {
          display: flex;
          flex-direction: column;
        }
        .guest-link {
          font-weight: 700;
          font-size: 1.1rem;
          color: #fff;
          text-decoration: none;
        }
        .guest-link:hover {
          color: #1890ff;
        }
        .segment-badge {
          font-size: 0.7rem;
          padding: 3px 10px;
          border-radius: 6px;
          width: fit-content;
          text-transform: uppercase;
          font-weight: 800;
          margin-top: 6px;
          letter-spacing: 0.5px;
          color: #fff;
        }
        .priority-body {
          font-size: 0.95rem;
          color: #e0e0e0;
          margin-bottom: 16px;
          line-height: 1.5;
        }
        .reason, .action {
          margin: 8px 0;
        }
        .label {
          font-weight: 600;
          color: #888;
          text-transform: uppercase;
          font-size: 0.75rem;
          margin-right: 8px;
          display: inline-block;
          width: 80px;
        }
        .priority-footer {
          display: flex;
          gap: 24px;
          font-size: 0.85rem;
          color: #777;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
          padding-top: 16px;
        }
        .meta-item {
          display: flex;
          align-items: center;
          gap: 6px;
        }
      `}</style>
        </div>
    );
}
