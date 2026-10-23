import { execSync } from 'node:child_process';

// Apply migrations to the test database once before the suite.
export default function setup() {
  execSync('npx prisma migrate deploy', { stdio: 'pipe', env: process.env });
}
