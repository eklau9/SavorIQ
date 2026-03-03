"use client";

import { useEffect, useState } from "react";
import GuestPriorityCard from "@/components/GuestPriorityCard";
import { fetchGuestPriorities } from "@/lib/api";

export default function PriorityInboxPage() {
    const [priorities, setPriorities] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        setLoading(true);
        try {
            const priorityData = await fetchGuestPriorities();
            setPriorities(priorityData || []);
        } catch (err) {
            console.error("Failed to load priorities:", err);
            setPriorities([]);
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return (
            <div className="loading-state">
                <div className="loading-spinner" />
            </div>
        );
    }

    return (
        <div className="priority-inbox-page">
            <div className="page-header">
                <h2>🚨 Priority Inbox</h2>
                <p className="subtitle">
                    Smart Intercepts — Prioritized guest issues requiring manager attention
                </p>
            </div>

            {priorities.length === 0 ? (
                <div className="empty-state">
                    <div className="icon">✅</div>
                    <p>No high-priority guest issues at the moment. Good job!</p>
                </div>
            ) : (
                <div className="priority-section">
                    <div className="section-header" style={{ marginBottom: 20 }}>
                        <span className="priority-count">{priorities.length} issues needing attention</span>
                    </div>
                    <div className="priority-grid">
                        {priorities.map((p) => (
                            <GuestPriorityCard key={p.guest.id} item={p} />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
