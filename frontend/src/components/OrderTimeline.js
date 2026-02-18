export default function OrderTimeline({ orders }) {
    if (!orders || orders.length === 0) {
        return (
            <div className="empty-state">
                <div className="icon">📋</div>
                <p>No orders yet</p>
            </div>
        );
    }

    return (
        <div className="order-timeline">
            {orders.map((order) => (
                <div className="order-item" key={order.id}>
                    <div className={`order-dot ${order.category}`} />
                    <div className="order-details">
                        <div className="item-name">{order.item_name}</div>
                        <div className="order-meta">
                            {order.category} · {new Date(order.ordered_at).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                            })}
                            {order.quantity > 1 && ` · ×${order.quantity}`}
                        </div>
                    </div>
                    <div className="order-price">
                        ${(order.price * order.quantity).toFixed(2)}
                    </div>
                </div>
            ))}
        </div>
    );
}
