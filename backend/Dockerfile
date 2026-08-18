FROM python:3.12-slim
WORKDIR /app
RUN pip install uv
COPY pyproject.toml uv.lock ./
# --frozen: install exactly what's in uv.lock, fail loudly if it's out of sync with
# pyproject.toml instead of silently re-resolving — every build gets the same dependency
# versions instead of whatever satisfies ">=" happens to be newest that day.
RUN uv sync --no-dev --frozen
COPY app/ ./app/

# Runs as root by default otherwise. Fixed UID/GID (not just `useradd`'s auto-assigned one) so
# ownership is predictable and matches across rebuilds/hosts. /app/uploads is created here (not
# just left to main.py's runtime mkdir) so a *fresh* named volume — Docker copies the image's
# existing directory content/ownership into an empty volume on first mount — comes up writable
# by this user with no extra steps; an *existing* volume from before this change still has
# root-owned files and needs a one-time `chown` on the host (see README).
RUN groupadd -g 1000 appuser && useradd -u 1000 -g appuser -m appuser \
    && mkdir -p /app/uploads && chown -R appuser:appuser /app /home/appuser
USER appuser

CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
