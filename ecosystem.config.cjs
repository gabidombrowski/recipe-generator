/**
 * pm2 configuration.
 *
 * This is the primary deployment path, mirroring the existing Next app on the
 * same server: build to `.next/standalone`, rsync it over, restart under pm2.
 * `deploy.yml` runs exactly this.
 *
 * Environment values are NOT set here — this file is committed, and the app's
 * secrets are not. pm2 reads them from the shell it is started in, or from an
 * `.env` on the server that the operator sources first. `--update-env` on
 * restart is what picks up a change.
 */
module.exports = {
  apps: [
    {
      name: "recipe-generator",
      // The standalone build's own entrypoint; `next start` is not used.
      script: "server.js",
      cwd: process.env.APP_PATH || __dirname,
      instances: 1,
      // Must stay 1: SQLite is a single file and the cron must fire once.
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "20s",
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
        PORT: process.env.PORT || 3200,
        HOSTNAME: "127.0.0.1",
      },
      out_file: "~/.pm2/logs/recipe-generator-out.log",
      error_file: "~/.pm2/logs/recipe-generator-error.log",
      // pino already emits JSON with its own timestamps.
      time: false,
    },
  ],
};
