from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Always the repo-root .env, regardless of the process's own working directory — a relative
# "env_file=.env" resolves against cwd, which silently pointed at a second, different
# backend/.env on the VPS (bare pm2 runs the backend with cwd=backend/) instead of the same
# root .env used everywhere else (docker-compose, this repo's own docs). That let the two files
# drift for weeks with no error, just settings that looked "set" but were never actually loaded.
_REPO_ROOT_ENV = Path(__file__).resolve().parent.parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_REPO_ROOT_ENV, extra="ignore")

    postgres_host: str
    postgres_port: int
    postgres_user: str
    postgres_pass: str
    postgres_db: str

    vapid_public_key: str = ""
    vapid_private_key: str = ""
    vapid_claims_sub: str = "mailto:admin@near2far.family"

    upload_dir: str = "uploads"

    # Optional — when set, saving a member's Device ID also auto-creates the matching device in
    # Traccar via its own REST API, skipping the manual "Settings → Devices → Add" step there.
    # Blank (the default) just skips that call silently; existing installs aren't affected.
    traccar_api_url: str = ""
    traccar_admin_email: str = ""
    traccar_admin_pass: str = ""

    # Shared secret for /api/traccar/forward. Traccar's forward.type=json can't send custom
    # headers, but FORWARD_URL is entirely ours to configure — so the token travels as a query
    # param baked into that URL instead. Blank disables the check (matches this endpoint's
    # original network-only trust model) so this doesn't break an install that hasn't set it.
    traccar_forward_token: str = ""

    # Comma-separated list of allowed origins for CORS, e.g. "https://near2far.family". Empty
    # (the default) keeps the wildcard "*" this app has always used — auth here is a Bearer/
    # Basic credential in a header, not a cookie, so wildcard CORS doesn't expose a classic
    # CSRF path, but it's still broader than a single-domain PWA needs. Set this in production
    # to restrict it; left unset so this doesn't change behavior for existing installs.
    cors_origins: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        origins = [o.strip() for o in self.cors_origins.split(",") if o.strip()]
        return origins or ["*"]


settings = Settings()
