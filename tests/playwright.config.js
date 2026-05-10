// Config Playwright : émule Android (Pixel 5) et iPhone (iPhone 13).
// Lance un serveur statique local (http.server Python) sur le port 8765
// pendant la durée des tests, puis le coupe.
const { defineConfig, devices } = require('@playwright/test');

const PORT = 8765;
const BASE_URL = `http://127.0.0.1:${PORT}`;

module.exports = defineConfig({
  testDir: '.',
  testMatch: '*.spec.js',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['html', { outputFolder: 'tests/playwright-report', open: 'never' }], ['list']],
  outputDir: 'tests/test-results',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'android',
      use: {
        ...devices['Pixel 5 landscape'],
        // Permet le play() audio sans gesture user (pour tester les flux audio)
        launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
      },
    },
    {
      name: 'iphone',
      use: {
        ...devices['iPhone 13 landscape'],
        launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
      },
    },
  ],
  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1`,
    url: BASE_URL,
    cwd: __dirname + '/..',
    reuseExistingServer: !process.env.CI,
    timeout: 30 * 1000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
