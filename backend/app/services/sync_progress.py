"""Service to track and report sync progress for restaurants.

Supports per-platform tracking so Google + Yelp can run concurrently
while the frontend sees smooth, monotonically-increasing progress.
"""

from dataclasses import dataclass, field
from typing import Dict, Optional
import asyncio
import logging

logger = logging.getLogger(__name__)


@dataclass
class PlatformProgress:
    """Progress state for a single platform (google or yelp)."""
    percent: int = 0
    status: str = "Waiting..."
    processed_count: int = 0
    total_count: int = 0
    estimated_seconds_remaining: Optional[int] = None
    finished: bool = False
    new_ingested: int = 0


@dataclass
class SyncState:
    restaurant_id: str
    percent: int
    status: str
    processed_count: int = 0
    total_count: int = 0
    estimated_seconds_remaining: Optional[int] = None
    is_cancelled: bool = False
    new_ingested: int = 0
    platform: Optional[str] = None
    # Per-platform tracking for concurrent syncs
    _platform_states: Dict[str, PlatformProgress] = field(default_factory=dict)

    def _recompute_combined(self):
        """Recompute combined percent/status from per-platform states."""
        if not self._platform_states:
            return

        platforms = self._platform_states
        total_pct = sum(p.percent for p in platforms.values())
        avg_pct = total_pct // len(platforms)

        # Monotonic guard: never go backward
        self.percent = min(100, max(self.percent, avg_pct))

        # Build combined status showing each platform
        parts = []
        for name, p in sorted(platforms.items()):
            label = name.capitalize()
            if p.finished:
                parts.append(f"{label}: ✓ Done")
            else:
                parts.append(f"{label}: {p.status}")
        self.status = " • ".join(parts)

        # Sum processed/total across platforms
        self.processed_count = sum(p.processed_count for p in platforms.values())
        self.total_count = sum(p.total_count for p in platforms.values())

        # ETA: use the max remaining across platforms (slowest determines overall ETA)
        etas = [p.estimated_seconds_remaining for p in platforms.values()
                if p.estimated_seconds_remaining is not None and not p.finished]
        self.estimated_seconds_remaining = max(etas) if etas else None

        # Total new ingested
        self.new_ingested = sum(p.new_ingested for p in platforms.values())


class SyncProgressManager:
    """In-memory manager for tracking sync operations."""
    
    def __init__(self):
        self._states: Dict[str, SyncState] = {}
        self._tasks: Dict[str, asyncio.Task] = {}

    def start_sync(self, restaurant_id: str, status: str = "Starting..."):
        """Initialize or reset sync state for a restaurant."""
        self._states[restaurant_id] = SyncState(
            restaurant_id=restaurant_id,
            percent=0,
            status=status
        )
        logger.info(f"Sync started for {restaurant_id}")

    def register_task(self, restaurant_id: str, task: asyncio.Task):
        """Store the asyncio task so it can be cancelled later."""
        self._tasks[restaurant_id] = task

    def update_progress(self, restaurant_id: str, percent: int, status: str, 
                        processed_count: Optional[int] = None, 
                        total_count: Optional[int] = None,
                        est_remaining: Optional[int] = None,
                        platform: Optional[str] = None):
        """Update progress metrics. If platform is provided, tracks per-platform."""
        if restaurant_id not in self._states:
            return

        state = self._states[restaurant_id]

        if platform:
            # Per-platform tracking
            if platform not in state._platform_states:
                state._platform_states[platform] = PlatformProgress()
            
            ps = state._platform_states[platform]
            ps.percent = min(100, max(ps.percent, percent))
            ps.status = status
            if processed_count is not None:
                ps.processed_count = processed_count
            if total_count is not None:
                ps.total_count = total_count
            if est_remaining is not None:
                ps.estimated_seconds_remaining = est_remaining

            state._recompute_combined()
        else:
            # Legacy single-platform tracking (monotonic guard)
            state.percent = min(100, max(state.percent, percent))
            state.status = status
            
            if processed_count is not None:
                state.processed_count = processed_count
            if total_count is not None:
                state.total_count = total_count
                
            if est_remaining is not None:
                state.estimated_seconds_remaining = est_remaining

    def get_state(self, restaurant_id: str) -> Optional[SyncState]:
        """Fetch current state."""
        return self._states.get(restaurant_id)

    def cancel_sync(self, restaurant_id: str):
        """Cancel a sync by cancelling its asyncio task."""
        if restaurant_id in self._states:
            self._states[restaurant_id].is_cancelled = True
            self._states[restaurant_id].status = "Cancelling..."
        if restaurant_id in self._tasks:
            self._tasks[restaurant_id].cancel()
            logger.info(f"Task.cancel() sent for {restaurant_id}")
        else:
            logger.info(f"Cancellation flagged for {restaurant_id} (no task ref)")

    def is_cancelled(self, restaurant_id: str) -> bool:
        """Check if sync should stop."""
        state = self._states.get(restaurant_id)
        return state.is_cancelled if state else False

    def finish_platform(self, restaurant_id: str, platform: str,
                        new_ingested: int = 0, status: str = "Done"):
        """Mark a single platform as finished within a concurrent sync."""
        if restaurant_id not in self._states:
            return
        
        state = self._states[restaurant_id]
        if platform in state._platform_states:
            ps = state._platform_states[platform]
            ps.percent = 100
            ps.status = status
            ps.finished = True
            ps.new_ingested = new_ingested
            ps.estimated_seconds_remaining = 0
            state._recompute_combined()

    def finish_sync(self, restaurant_id: str, status: str = "Complete!", new_ingested: int = 0, platform: Optional[str] = None):
        """Mark sync as finished."""
        if restaurant_id in self._states:
            self._states[restaurant_id].percent = 100
            self._states[restaurant_id].status = status
            self._states[restaurant_id].estimated_seconds_remaining = 0
            self._states[restaurant_id].new_ingested = new_ingested
            if platform:
                self._states[restaurant_id].platform = platform
        self._tasks.pop(restaurant_id, None)

    def cancel_all(self):
        """Cancel ALL active syncs via task.cancel()."""
        cancelled = []
        for rid, state in self._states.items():
            if state.percent < 100 and not state.is_cancelled:
                state.is_cancelled = True
                state.status = "Cancelling..."
                cancelled.append(rid)
                if rid in self._tasks:
                    self._tasks[rid].cancel()
        logger.info(f"Cancelled all active syncs: {cancelled}")
        return cancelled

    def clear_state(self, restaurant_id: str):
        """Remove state and task from memory."""
        self._states.pop(restaurant_id, None)
        self._tasks.pop(restaurant_id, None)

# Singleton instance
sync_manager = SyncProgressManager()
