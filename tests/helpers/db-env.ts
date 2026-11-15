// Entorno de las pruebas con base: apunta siempre a la base temporal y usa valores ficticios (nunca .env ni credenciales reales).
process.env.DATABASE_URL = process.env.TEST_APP_URL;
process.env.TELEGRAM_BOT_TOKEN = "123456:TEST-bot-token";
process.env.TELEGRAM_WEBHOOK_SECRET = "test-webhook-secret";
// Claves ficticias de 32 bytes en base64 (D-078), solo para pruebas.
process.env.IDENTITY_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.IDENTITY_HASH_KEY = Buffer.alloc(32, 9).toString("base64");
process.env.PRINCIPAL_ADMIN_TELEGRAM_ID = "900000099";
delete process.env.RATE_LIMITS;
delete process.env.BOT_SENSITIVE_DRAFT_TTL_SECONDS;
