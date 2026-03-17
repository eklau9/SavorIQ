"""Service to track and report sync progress for restaurants."""

from dataclasses import dataclass
from typing import Dict, Optional
import asyncio
import logging

logger = logging.getLogger(__name__)

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
                        est_remaining: Optional[int] = None):
        """Update progress metrics."""
        if restaurant_id in self._states:
            state = self._states[restaurant_id]
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

