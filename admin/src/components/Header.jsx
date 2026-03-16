import React from 'react';

export default function Header({ title, subtitle }) {
  const formattedDate = new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className="page-header-premium">
      <div className="header-greeting-row">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="header-icon">✨</span>
          <span className="header-greeting">SavorIQ</span>
        </div>
        <span className="header-date">{formattedDate}</span>
      </div>
      <h1 className="header-title">{title}</h1>
      {subtitle && <p className="header-subtitle">{subtitle}</p>}
    </div>
  );
}
