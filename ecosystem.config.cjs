/**
 * PM2 Ecosystem — BintuNet Controller
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 reload ecosystem.config.cjs --update-env
 *   pm2 save && pm2 startup
 */

const path = require("path");
const envFile = path.resolve(__dirname, ".env.production");

module.exports = {
  apps: [
    {
      name: "bintunet-api",
      script: "node",
      args: "--enable-source-maps ./artifacts/api-server/dist/index.mjs",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1536M",
      env_file: envFile,
      env: {
        NODE_ENV: "production",
        PORT: "8080",
      },
    },
  ],
};
