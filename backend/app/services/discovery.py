"""Menu Discovery service — uses Gemini to extract menu items from reviews."""

from __future__ import annotations

import json
import logging
import re
from typing import List

from app.config import settings
from app.services.gemini_tracker import record_gemini_request

logger = logging.getLogger(__name__)

DISCOVERY_PROMPT = """You are a menu extraction expert. I will provide you with a list of customer reviews for a restaurant. 
Your task is to identify the most common food and drink items mentioned.

For each item:
1. Provide a clean display name (e.g., "Matcha Latte").
2. Assign a category: "food" or "drink".
3. Provide 3-5 keywords or aliases that customers use to refer to this item (e.g., "matcha", "green tea latte", "iced matcha").
4. Ensure items are distinct and significant to the restaurant's identity.

Return ONLY valid JSON in this exact format:
[
  {
    "name": "Item Name",
    "category": "food",
    "keywords": "alias1, alias2, alias3"
  }
]

REVIEWS:
"""

async def discover_menu_items(reviews: List[str]) -> List[dict]:
    """Uses Gemini to identify menu items from review text."""
    if not reviews:
        return []

    # Limit to first 50 reviews to stay within token limits and keep it focused
    pool = reviews[:50]
    reviews_text = "\n---\n".join(pool)

    try:
        import google.generativeai as genai
        
        if not settings.GEMINI_API_KEY:
            raise ValueError("Gemini API key not configured")

        # Record request to internal tracker
        record_gemini_request()

        genai.configure(api_key=settings.GEMINI_API_KEY)
        model = genai.GenerativeModel(settings.GEMINI_MODEL)

        prompt = DISCOVERY_PROMPT + reviews_text
        response = await model.generate_content_async(prompt)
        text = response.text.strip()

        # Extract JSON
        if "```" in text:
            json_match = re.search(r'```(?:json)?\s*(.*?)```', text, re.DOTALL)
            if json_match:
                text = json_match.group(1).strip()

        discovered = json.loads(text)
        logger.info(f"AI Discovery found {len(discovered)} items from reviews.")
        return discovered

    except Exception as e:
        logger.error(f"Menu discovery failed: {e}")
        return []


VISION_PROMPT = """You are a restaurant menu extraction expert. I will provide you with a photo of a restaurant menu.

Your task is to extract EVERY menu item visible in the image.

For each item:
1. "name": The exact item name as shown on the menu (preserve original spelling/casing).
2. "category": Either "food" or "drink".
3. "price": The price as a number (e.g., 15.99). Use null if not visible.
4. "keywords": 3-5 lowercase aliases that a customer might use in a review to refer to this item.
   Example: for "Spicy Pork Belly BBQ" → "pork belly, pork, spicy pork, bbq pork"

Return ONLY valid JSON array:
[
  {
    "name": "Item Name",
    "category": "food",
    "price": 15.99,
    "keywords": "alias1, alias2, alias3"
  }
]

IMPORTANT: Extract ALL items. Do not skip any. Include appetizers, mains, sides, desserts, drinks, everything visible."""


async def extract_menu_from_image(image_base64: str) -> List[dict]:
    """Uses Gemini Vision to extract menu items from a photo of a menu."""
    try:
        import google.generativeai as genai
        import base64

        if not settings.GEMINI_API_KEY:
            raise ValueError("Gemini API key not configured")

        record_gemini_request()

        genai.configure(api_key=settings.GEMINI_API_KEY)
        model = genai.GenerativeModel(settings.GEMINI_MODEL)

        # Decode the base64 image
        image_data = base64.b64decode(image_base64)

        response = await model.generate_content_async([
            VISION_PROMPT,
            {"mime_type": "image/jpeg", "data": image_data}
        ])
        text = response.text.strip()

        # Extract JSON
        if "```" in text:
            json_match = re.search(r'```(?:json)?\s*(.*?)```', text, re.DOTALL)
            if json_match:
                text = json_match.group(1).strip()

        discovered = json.loads(text)
        logger.info(f"Vision extracted {len(discovered)} items from menu photo.")
        return discovered

    except Exception as e:
        logger.error(f"Menu photo extraction failed: {e}")
        raise

