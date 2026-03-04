import Link from 'next/link';

const SEGMENT_METADATA = {
  VIP_AT_RISK: { label: 'At-Risk VIP', color: '#ff4d4f', icon: '🚨' },
  LOST_REGULAR: { label: 'Lost Regular', color: '#faad14', icon: '⏳' },
  NEW_BIG_SPENDER: { label: 'New High-Value', color: '#52c41a', icon: '💎' },
  PROMOTER: { label: 'Promoter', color: '#1890ff', icon: '📣' },
};

export default function GuestPriorityCard({ item, onAction }) {
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

        {item.current_status === 'actioned' && item.current_action?.notes && (
          <div className="manager-notes">
            <span className="label">Notes:</span> {item.current_action.notes}
          </div>
        )}
      </div>

      <div className="priority-actions">
        {item.current_status === 'open' && (
          <button
            className="btn-action actioned"
            onClick={() => onAction(guest.id, segment, 'actioned')}
          >
            Mark as Actioned
          </button>
        )}
        <button
          className="btn-action resolve"
          onClick={() => onAction(guest.id, segment, 'resolved')}
        >
          Resolve Issue
        </button>
      </div>

      <div className="priority-footer">
        <span className="meta-item">📝 {item.review_count} reviews</span>
        <span className="meta-item">📍 Last visit {last_visit_days_ago} days ago</span>
        <span className="status-indicator">
          <span className={`dot ${item.current_status || 'open'}`} />
          {item.current_status?.toUpperCase() || 'OPEN'}
        </span>
      </div>

      <style jsx>{`
        .priority-card {
          background: rgba(255, 255, 255, 0.04);
          border-radius: 12px;
          padding: 24px;
          margin-bottom: 20px;
          transition: all 0.2s ease-in-out;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
          position: relative;
        }
        .priority-card:hover {
          transform: translateY(-2px);
          background: rgba(255, 255, 255, 0.06);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
        }
        .priority-header {
          display: flex;
          align-items: center;
          gap: 16px;
          margin-bottom: 20px;
        }
        .priority-icon {
          font-size: 2rem;
          background: rgba(255, 255, 255, 0.05);
          width: 56px;
          height: 56px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 14px;
        }
        .priority-titles {
          display: flex;
          flex-direction: column;
        }
        .guest-link {
          font-weight: 700;
          font-size: 1.2rem;
          color: #fff;
          text-decoration: none;
        }
        .guest-link:hover {
          color: #7c3aed;
        }
        .segment-badge {
          font-size: 0.65rem;
          padding: 3px 10px;
          border-radius: 6px;
          width: fit-content;
          text-transform: uppercase;
          font-weight: 800;
          margin-top: 6px;
          letter-spacing: 0.8px;
          color: #fff;
        }
        .priority-body {
          font-size: 0.95rem;
          color: #e0e0e0;
          margin-bottom: 24px;
          line-height: 1.6;
        }
        .reason, .action {
          margin: 12px 0;
        }
        .manager-notes {
            margin-top: 12px;
            padding: 12px;
            background: rgba(124, 58, 237, 0.08);
            border-radius: 8px;
            font-style: italic;
            border-left: 2px solid #7c3aed;
        }
        .label {
          font-weight: 700;
          color: #64748b;
          text-transform: uppercase;
          font-size: 0.7rem;
          margin-right: 12px;
          display: inline-block;
          width: 80px;
        }
        .priority-actions {
            display: flex;
            gap: 12px;
            margin-bottom: 24px;
        }
        .btn-action {
            flex: 1;
            padding: 10px;
            border-radius: 8px;
            border: 1px solid rgba(255,255,255,0.1);
            background: rgba(255,255,255,0.05);
            color: #fff;
            font-size: 0.85rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
        }
        .btn-action:hover {
            background: rgba(255,255,255,0.1);
        }
        .btn-action.actioned:hover {
            border-color: #faad14;
            color: #faad14;
        }
        .btn-action.resolve:hover {
            border-color: #52c41a;
            color: #52c41a;
        }
        .priority-footer {
          display: flex;
          align-items: center;
          gap: 24px;
          font-size: 0.75rem;
          color: #64748b;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
          padding-top: 16px;
        }
        .meta-item {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .status-indicator {
            margin-left: auto;
            display: flex;
            align-items: center;
            gap: 8px;
            font-weight: 700;
            letter-spacing: 0.5px;
            font-size: 0.7rem;
        }
        .dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
        }
        .dot.open { background: #ff4d4f; box-shadow: 0 0 8px #ff4d4f; }
        .dot.actioned { background: #faad14; box-shadow: 0 0 8px #faad14; }
        .dot.resolved { background: #52c41a; }
        .dot.dismissed { background: #8c8c8c; }
      `}</style>
    </div>
  );
}
