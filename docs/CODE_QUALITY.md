# Code Quality & Engineering Checklist

This document tracks the technical debt and architectural improvements required to move this project from a prototype to a production-grade system.

## 1. Testing & Reliability
- [x] **Unit Testing**: Jest tests for `emailParser.js`, `filterEngine.js`, and `replyService.js` — 60 tests across 4 suites.
- [x] **Integration Testing**: Supertest for `/webhook` and `/health` endpoints in `routes.test.js`.
- [x] **Mocking Strategy**: Jest module mocks for Firestore, Gmail, Gemini, and Secret Manager.
- [x] **CI/CD Integration**: GitHub Actions workflow at `.github/workflows/test.yml` runs on every push and PR to main.

## 2. Type Safety & Developer Experience
- [ ] **JSDoc Annotations**: Add full JSDoc types to all exported service functions.
- [ ] **TypeScript Migration**: (Optional/Recommended) Convert the project to TypeScript for compile-time safety.
- [ ] **ESLint & Prettier**: Standardize code style and catch common bugs (e.g., `eslint-config-airbnb-base`).
- [ ] **Git Hooks**: Implement `husky` and `lint-staged` to enforce quality before commits.

## 3. Architecture & Patterns
- [ ] **Dependency Injection**: Refactor services to accept clients (Gmail/Firestore) as arguments rather than using internal singletons.
- [ ] **Schema Validation**: Use `zod` or `joi` to validate incoming Pub/Sub payloads and environment variables.
- [ ] **Graceful Shutdown**: Handle `SIGTERM` and `SIGINT` to ensure clean exit and connection closing.
- [ ] **Centralized Config**: Move hardcoded constants and scopes into `config/defaultConfig.js`.

## 4. Resilience & Error Handling
- [ ] **Custom Error Classes**: Create specific classes for `APIError`, `ValidationError`, and `RetryableError`.
- [ ] **Exponential Backoff**: Implement retry logic for all external API calls (Gemini, Gmail).
- [ ] **Global Error Handler**: Add Express middleware to capture and log unhandled rejections consistently.

## 5. Security & Performance
- [ ] **Security Headers**: Integrate `helmet` middleware.
- [ ] **Rate Limiting**: Protect endpoints from accidental floods or retries.
- [ ] **Secret Validation**: Ensure all required secrets are present and valid at boot time.

## 6. Observability
- [ ] **Enhanced Logging**: Add more context (message IDs, thread IDs) to all log entries.
- [ ] **Health Check Expansion**: Update `/health` to verify connectivity to Firestore and Gemini APIs.
- [ ] **Tracing**: Integrate with Cloud Trace for end-to-end request visibility.
