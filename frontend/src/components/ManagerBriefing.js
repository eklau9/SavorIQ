"use client";

export default function ManagerBriefing({ briefing }) {
    if (!briefing) return null;

    const { summary, insights } = briefing;

    return (
        <div className="briefing-container">
            <div className="briefing-header">
                <div className="ai-badge">AI INSIGHTS</div>
                <h2>Manager's Executive Briefing</h2>
            </div>

            <p className="briefing-summary">{summary}</p>

            <div className="insights-grid">
                {insights.map((insight, idx) => (
                    <div key={idx} className={`insight-card ${insight.type}`}>
                        <div className="insight-icon">
                            {insight.type === "win" && "🏆"}
                            {insight.type === "risk" && "⚠️"}
                            {insight.type === "action" && "⚡"}
                        </div>
                        <div className="insight-content">
                            <h4>{insight.title}</h4>
                            <p>{insight.description}</p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
