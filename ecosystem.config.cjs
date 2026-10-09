module.exports = {
  apps: [
    {
      name: "vehicle-inspect-api",
      cwd: __dirname,
      script: "server.mjs",
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 3010,
        HOST: "0.0.0.0",
        VEHICLE_PROVIDER: "carinfo-public",
      },
    },
  ],
};
