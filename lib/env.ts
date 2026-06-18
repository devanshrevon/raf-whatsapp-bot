function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string): string | undefined {
  return process.env[name] || undefined;
}

export const env = {
  // Lazily read so the app can boot (e.g. show /login) even if some
  // integration-specific vars aren't set yet during early development.
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get sessionSecret() {
    return required("SESSION_SECRET");
  },
  get adminUsername() {
    return required("ADMIN_USERNAME");
  },
  get adminPasswordHash() {
    return required("ADMIN_PASSWORD_HASH");
  },
  get internalCronSecret() {
    return required("INTERNAL_CRON_SECRET");
  },
  get appVersion() {
    return optional("APP_VERSION") ?? "dev";
  },
  get appBaseUrl() {
    return optional("APP_BASE_URL") ?? "http://localhost:3000";
  },
  twilio: {
    get accountSid() {
      return required("TWILIO_ACCOUNT_SID");
    },
    get authToken() {
      return required("TWILIO_AUTH_TOKEN");
    },
    get whatsappNumber() {
      return required("TWILIO_WHATSAPP_NUMBER");
    }
  },
  openai: {
    get apiKey() {
      return required("OPENAI_API_KEY");
    },
    get model() {
      return optional("OPENAI_MODEL") ?? "gpt-4o";
    }
  },
  google: {
    get clientId() {
      return required("GOOGLE_CLIENT_ID");
    },
    get clientSecret() {
      return required("GOOGLE_CLIENT_SECRET");
    },
    get redirectUri() {
      return required("GOOGLE_REDIRECT_URI");
    },
    get refreshToken() {
      return required("GOOGLE_REFRESH_TOKEN");
    },
    get calendarId() {
      return required("GOOGLE_CALENDAR_ID");
    }
  }
};
