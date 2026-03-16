"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import RestaurantSwitcher from "./RestaurantSwitcher";

export default function Sidebar() {
    const pathname = usePathname();

    useEffect(() => {
        if (typeof window !== "undefined") {
            window.name = "savoriq-app";
        }
    }, []);

    const navItems = [
        {
            section: "Main",
            items: [
                { name: "Dashboard", href: "/", icon: "📊" },
            ],
        },
        {
            section: "Intelligence",
            items: [
                { name: "Priority Inbox", href: "/intercepts", icon: "🚨" },
                { name: "Guest Registry", href: "/guests", icon: "👤" },
                { name: "Reviews", href: "/reviews", icon: "💬" },
            ],
        },
        {
            section: "Analysis",
            items: [
                { name: "Sentiment", href: "/sentiment", icon: "🎯" },
                { name: "Analytics", href: "/analytics", icon: "📈" },
            ],
        },
        {
            section: "Data Sources",
            items: [
                { name: "Review Sync", href: "/sync", icon: "🔄" },
            ],
        },
    ];

    const isActive = (href) => {
        if (href === "/") {
            return pathname === "/";
        }
        return pathname.startsWith(href);
    };


    return (
        <aside className="sidebar">
            <div className="sidebar-logo">
                <div className="logo-icon">🧠</div>
                <div>
                    <h1>SavorIQ</h1>
                    <span className="subtitle">Guest Intelligence</span>
                </div>
            </div>

            <RestaurantSwitcher />

            {navItems.map((section) => (
                <div className="nav-section" key={section.section}>
                    <div className="nav-section-title">{section.section}</div>
                    {section.items.map((item) => (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={`nav-link ${isActive(item.href) ? "active" : ""}`}
                        >
                            <span className="icon">{item.icon}</span> {item.name}
                        </Link>
                    ))}
                </div>
            ))}

            {process.env.NODE_ENV === "development" && (
                <div className="nav-section">
                    <div className="nav-section-title">System</div>
                    <a
                        href="http://localhost:5174"
                        target="savoriq-admin"
                        rel="opener"
                        className="nav-link"
                    >
                        <span className="icon">🛠️</span> Admin Dashboard
                    </a>
                </div>
            )}
        </aside>
    );
}
