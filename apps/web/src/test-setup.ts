import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}

import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
afterEach(() => cleanup());

import { configure } from "@testing-library/react";
// PBKDF2 and full-app renders are slow when test files run in parallel.
configure({ asyncUtilTimeout: 5000 });
