module.exports = {
  apps: [
    {
      name: "near2far",
      cwd: "./backend",
      script: "uv",
      args: "run uvicorn app.main:app --host 0.0.0.0 --port 5101",
      interpreter: "none",
      autorestart: true,
      // Reads backend/.env via pydantic-settings — see backend/.env.example.
    },
  ],
}
