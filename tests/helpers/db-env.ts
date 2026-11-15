// Entorno de las pruebas con base: apunta siempre a la base temporal y usa valores ficticios (nunca .env ni credenciales reales).
process.env.DATABASE_URL = process.env.TEST_APP_URL;
process.env.TELEGRAM_BOT_TOKEN = "123456:TEST-bot-token";
process.env.TELEGRAM_WEBHOOK_SECRET = "test-webhook-secret";
