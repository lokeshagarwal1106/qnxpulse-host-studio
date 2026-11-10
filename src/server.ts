import { createApp } from './server/app.ts';
import { detectQnxHostEnvironment } from './server/hostBridge.ts';

const port = Number(process.env.PORT ?? 8788);
const app = createApp();
const host = detectQnxHostEnvironment();

app.listen(port, () => {
  console.log(
    `[QNXPulse Host Studio] Ready on http://localhost:${port} | Mode: ${host.executionMode} (${host.platform})`
  );
});
