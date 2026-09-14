import { hash, verify } from "@node-rs/argon2";

/**
 * Password hashing — Argon2id via @node-rs/argon2 (Rust/NAPI bindings,
 * prebuilt binaries, no native toolchain required).
 *
 * Better Auth owns the credential lifecycle but delegates password hashing
 * to this vetted Argon2id primitive so migrated credentials remain valid.
 * Cryptography stays isolated from UI and business-domain code.
 */
export async function hashPassword(plainPassword: string): Promise<string> {
  return hash(plainPassword);
}

export async function verifyPassword(
  plainPassword: string,
  storedHash: string,
): Promise<boolean> {
  return verify(storedHash, plainPassword);
}
