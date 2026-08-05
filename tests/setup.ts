// Bun test setup file
// This file runs before each test file
import { setDefaultTimeout, beforeAll, afterAll } from 'bun:test';

// Set test timeout to 30 seconds
setDefaultTimeout(30000);

// Add any global test setup here
beforeAll(() => {
  // Setup code that runs before all tests
});

afterAll(() => {
  // Cleanup code that runs after all tests
});
