"""Service to track and report sync progress for restaurants."""

from dataclasses import dataclass
from typing import Dict, Optional
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

class SyncProgressManager:
    """In-memory manager for tracking sync operations."""
    
    def __init__(self):
        self._states: Dict[str, SyncState] = {}

    def start_sync(self, restaurant_id: str, status: str = "Starting..."):
        """Initialize or reset sync state for a restaurant."""
        self._states[restaurant_id] = SyncState(
            restaurant_id=restaurant_id,
            percent=0,
            status=status
        )
        logger.info(f"Sync started for {restaurant_id}")

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
            
            if state.is_cancelled:
                logger.info(f"Sync for {restaurant_id} is marked as CANCELLED")

    def get_state(self, restaurant_id: str) -> Optional[SyncState]:
        """Fetch current state."""
        return self._states.get(restaurant_id)

    def cancel_sync(self, restaurant_id: str):
        """Mark a sync as cancelled."""
        if restaurant_id in self._states:
            self._states[restaurant_id].is_cancelled = True
            self._states[restaurant_id].status = "Cancelling..."
            logger.info(f"Sync Cancellation requested for {restaurant_id}")

    def is_cancelled(self, restaurant_id: str) -> bool:
        """Check if sync should stop."""
        state = self._states.get(restaurant_id)
        return state.is_cancelled if state else False

    def finish_sync(self, restaurant_id: str, status: str = "Complete!"):
        """Mark sync as finished."""
        if restaurant_id in self._states:
            self._states[restaurant_id].percent = 100
            self._states[restaurant_id].status = status
            self._states[restaurant_id].estimated_seconds_remaining = 0
            # Keep state for a short while so UI can see 100%
            pass

    def clear_state(self, restaurant_id: str):
        """Remove state from memory."""
        if restaurant_id in self._states:
            del self._states[restaurant_id]

# Singleton instance
sync_manager = SyncProgressManager()
