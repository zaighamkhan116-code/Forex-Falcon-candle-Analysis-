# Quotex Mobile / Railway Executor

This directory is reserved for the server-side Quotex executor so Falcon can keep running when the MacBook is off and the iPhone is locked.

Planned flow:

1. iPhone/PWA controls Falcon.
2. Railway hosts the Quotex execution service.
3. The service maintains an authenticated Quotex session using Railway secrets.
4. Falcon signals are routed to Quotex.
5. Every trade is tracked independently by signal/trade ID.
6. Settlement updates actual WIN/LOSS and realized P/L.
7. The existing Chrome extension remains a backup executor.

Do **not** commit Quotex passwords, cookies, SSIDs, session tokens, or other credentials to GitHub. Store them only in Railway environment variables/secrets.
