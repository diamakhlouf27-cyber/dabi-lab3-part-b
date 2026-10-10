# DABI Lab 3 — Part B (Yapily AIS)

This is a small Express web app implementing the course flow:

**Institutions → Modelo → bank consent → callback → accounts + consent duration**

It is AISP/AIS only. There are no payment endpoints or Pay/Send Money buttons.

## 1. Requirements

- Node.js 18+
- A Yapily application with `modelo-sandbox` registered
- Application ID and Application Secret

## 2. Configure

Copy `.env.example` to `.env`.

Set:

```env
YAPILY_APPLICATION_ID=...
YAPILY_APPLICATION_SECRET=...
CALLBACK_URL=https://YOUR-DEPLOYED-APP/callback
APPLICATION_USER_ID=student-001
INSTITUTION_ID=modelo-sandbox
PORT=3000
```

**Never send the secret to ChatGPT, put it in HTML/JavaScript, or commit `.env`.**

## 3. Install and run

```bash
npm install
npm start
```

For local development the server listens on port 3000. Because Yapily Console rejected `http://localhost:3000/callback` in the student's setup, the recommended demo setup is to deploy this app to an HTTPS host (for example Render) and use that deployed callback in both:

1. Yapily Console → Application → Open Banking redirect URL
2. `.env` → `CALLBACK_URL`

They must be exactly the same.

## 4. Demo flow

1. Open the app.
2. It calls `GET /institutions`.
3. Select `modelo-sandbox`.
4. The server calls `POST /account-auth-requests` with `applicationUserId`, `institutionId`, callback and a one-time-token request.
5. Browser opens Yapily/Modelo `authorisationUrl`.
6. Login with sandbox credentials `mits` / `mits`.
7. Yapily redirects to `/callback`.
8. Server exchanges the one-time token for the real consent token when one is supplied.
9. Server calls `GET /accounts` with the `consent` header.
10. Server calls `GET /consents/{consentId}` when a consent ID is available.
11. Browser displays accounts and `authorizedAt`, `expiresAt`, `reconfirmBy`.

The consent token is deliberately kept server-side and is not returned by `/api/session/:flowId`.

## 5. Important deployment note

The in-memory `flows` Map is for a classroom demonstration. It is not a production session store. A production application should use a secure server-side session/database and HTTPS.

## 6. Lab deliverable checklist

- [ ] Postman screenshots: A1, B5, F1
- [ ] App recording/screenshot: institution list → bank login → callback → accounts + consent expiry
- [ ] Submit the prompt used
- [ ] Submit the callback URL registered in Yapily Console
- [ ] Half-page explanation of services behind `GET /accounts` and ownership
