"use client";

import { useState } from "react";

export default function ManagerBriefing({ briefing, onRefresh, isRefreshing }) {
    const [expandedTitle, setexpandedTitle] = useState(null);

    if (!briefing) return null;

    const { summary, insights } = briefing;

    const renderMarkdown = (text) => {
        if (!text) return "";
        // Handle ++Item++, --Item--, and **Item**
        const parts = text.split(/(\+\+.*?\+\+|\-\-.*?\-\-|\*\*.*?\*\*)/g);
        return parts.map((part, i) => {
            if (part?.startsWith("++") && part?.endsWith("++")) {
                return <strong key={i} className="highlight-positive">{part.slice(2, -2)}</strong>;
            }
            if (part?.startsWith("--") && part?.endsWith("--")) {
                return <strong key={i} className="highlight-negative">{part.slice(2, -2)}</strong>;
            }
            if (part?.startsWith("**") && part?.endsWith("**")) {
                return <strong key={i}>{part.slice(2, -2)}</strong>;
            }
            return part;
        });
    };

    const toggleInsight = (title) => {
        setexpandedTitle(expandedTitle === title ? null : title);
    };

    return (
        <div className="briefing-container">
            <div className="briefing-header">
                <div className="briefing-header-left">
                    <div className="ai-badge">AI INSIGHTS</div>
                    <h2>Manager's Executive Briefing</h2>
                </div>
                <button
                    className={`refresh-btn-badge ${isRefreshing ? 'spinning' : ''}`}
                    onClick={(e) => {
                        e.stopPropagation();
                        onRefresh();
                    }}
                    disabled={isRefreshing}
                    title="Refresh AI Insights"
                >
                    ↻ Refresh
                </button>
            </div>

            <p className="briefing-summary">{renderMarkdown(summary)}</p>

            <div className="insights-grid">
                {insights.map((insight) => {
                    const isExpanded = expandedTitle === insight.title;
                    return (
                        <div
                            key={insight.title}
                            className={`insight-card ${insight.type} ${isExpanded ? 'expanded' : ''}`}
                            onClick={() => toggleInsight(insight.title)}
                        >
                            <div className="insight-icon">
                                {insight.type === "win" && "🏆"}
                                {insight.type === "risk" && "⚠️"}
                                {insight.type === "action" && "⚡"}
                            </div>
                            <div className="insight-content">
                                <h4>{insight.title}</h4>
                                <p>{renderMarkdown(insight.description)}</p>

                                {isExpanded && insight.steps && (
                                    <div className="insight-steps">
                                        <h5>Improvement Steps:</h5>
                                        <ul>
                                            {insight.steps.map((step, sIdx) => (
                                                <li key={sIdx}>{step}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                            <div className="expand-hint">
                                {isExpanded ? "−" : "+"}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
