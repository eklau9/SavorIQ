# SavorIQ PROJECT

SavorIQ is an AI-powered guest intelligence platform for high-end hospitality. It aggregates reviews from Google Maps and Yelp, applies deep sentiment analysis via Gemini AI, and provides managers with actionable operational insights.

## Project Structure

- **`backend/`**: FastAPI server handling database (PostgreSQL/Supabase), background sync via Apify, and sentiment processing.
- **`mobile/`**: React Native / Expo application for restaurant managers to view insights, manage guest intercept priorities, and track team performance.
- **`frontend/`**: Next.js web application for broader executive analytics and administrative controls.
- **`k8s/`**: Kubernetes deployment configurations for production environments.
- **`docs/`**: Additional project documentation, including PRDs and technical specs.

## Getting Started

Refer to the README in each subdirectory for specific setup and development instructions.

- [Backend Setup](backend/README.md)
- [Mobile App Setup](mobile/README.md)
- [Web Frontend Setup](frontend/README.md)

## Core Tech Stack

- **Backend**: Python 3.12, FastAPI, SQLAlchemy, PostgreSQL (Supabase), Gemini API.
- **Mobile**: TypeScript, React Native, Expo Router.
- **Web**: TypeScript, Next.js, Tailwind CSS.

## Running Tests

Detailed testing instructions are available in each sub-directory, but here is the quick start:

- **Backend**: `cd backend && source venv/bin/activate && PYTHONPATH=$(pwd) pytest`
- **Mobile**: `cd mobile && npm test`

## Maintenance & Documentation

To keep the project healthy and maintainable, follow these guidelines:

- **Keep READMEs in-sync**: Whenever you add a new feature, component, or configuration (e.g., new API keys), update the corresponding `README.md` immediately.
- **Automated Testing**: Every new feature or piece of core logic must include corresponding unit/integration tests (`pytest` for backend, `jest` for mobile). Always run the full suite before pushing changes.
- **Explain "Why", not just "How"**: Focus on the rationale behind architectural decisions.
- **Clear Commit Messages**: Use descriptive commits to track changes effectively.
