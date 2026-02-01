import assert from "node:assert/strict";
import { encryptSecret, decryptSecret, ALGORITHM } from "./encryption.js";

// Test encrypt/decrypt round-trip with simple text
async function testEncryptDecryptRoundTrip() {
  const plaintext = "my-secret-api-key";
  const encrypted = encryptSecret(plaintext);
  const decrypted = decryptSecret(encrypted);

  assert.equal(decrypted, plaintext, "Decrypted text should match original plaintext");
}

// Test encrypt/decrypt with empty string
async function testEncryptDecryptEmptyString() {
  const plaintext = "";
  const encrypted = encryptSecret(plaintext);
  const decrypted = decryptSecret(encrypted);

  assert.equal(decrypted, plaintext, "Should handle empty string");
}

// Test encrypt/decrypt with special characters
async function testEncryptDecryptSpecialCharacters() {
  const plaintext = "p@$$w0rd!#$%^&*()_+-=[]{}|;':\",./<>?";
  const encrypted = encryptSecret(plaintext);
  const decrypted = decryptSecret(encrypted);

  assert.equal(decrypted, plaintext, "Should handle special characters");
}

// Test encrypt/decrypt with unicode characters
async function testEncryptDecryptUnicode() {
  const plaintext = "密码 пароль 🔐 パスワード";
  const encrypted = encryptSecret(plaintext);
  const decrypted = decryptSecret(encrypted);

  assert.equal(decrypted, plaintext, "Should handle unicode characters");
}

// Test encrypt/decrypt with long text
async function testEncryptDecryptLongText() {
  const plaintext = "a".repeat(10000);
  const encrypted = encryptSecret(plaintext);
  const decrypted = decryptSecret(encrypted);

  assert.equal(decrypted, plaintext, "Should handle long text");
}

// Test encrypted format has three parts separated by colons
async function testEncryptedFormat() {
  const plaintext = "test-secret";
  const encrypted = encryptSecret(plaintext);
  const parts = encrypted.split(":");

  assert.equal(parts.length, 3, "Encrypted format should have 3 parts (iv:authTag:encrypted)");
  assert.equal(parts[0].length, 24, "IV should be 12 bytes (24 hex chars)");
  assert.equal(parts[1].length, 32, "Auth tag should be 16 bytes (32 hex chars)");
  assert.ok(parts[2].length > 0, "Encrypted data should not be empty");
}

// Test each encryption produces unique output (due to random IV)
async function testEncryptionProducesUniqueOutput() {
  const plaintext = "same-secret";
  const encrypted1 = encryptSecret(plaintext);
  const encrypted2 = encryptSecret(plaintext);

  assert.notEqual(encrypted1, encrypted2, "Same plaintext should produce different ciphertext due to random IV");

  // But both should decrypt to the same value
  const decrypted1 = decryptSecret(encrypted1);
  const decrypted2 = decryptSecret(encrypted2);

  assert.equal(decrypted1, plaintext, "First encryption should decrypt correctly");
  assert.equal(decrypted2, plaintext, "Second encryption should decrypt correctly");
}

// Test decryption with invalid format (missing parts)
async function testDecryptInvalidFormatMissingParts() {
  const invalidCiphertext = "only-one-part";

  assert.throws(
    () => decryptSecret(invalidCiphertext),
    { message: "Invalid ciphertext format" },
    "Should throw error for invalid format"
  );
}

// Test decryption with invalid format (too many parts)
async function testDecryptInvalidFormatTooManyParts() {
  const invalidCiphertext = "part1:part2:part3:part4";

  assert.throws(
    () => decryptSecret(invalidCiphertext),
    { message: "Invalid ciphertext format" },
    "Should throw error when too many parts"
  );
}

// Test decryption with tampered ciphertext
async function testDecryptTamperedCiphertext() {
  const plaintext = "original-secret";
  const encrypted = encryptSecret(plaintext);
  const parts = encrypted.split(":");

  // Tamper with the encrypted data
  const tamperedEncrypted = parts[2].replace(/[0-9a-f]/, "0");
  const tamperedCiphertext = `${parts[0]}:${parts[1]}:${tamperedEncrypted}`;

  // This should throw because GCM authentication will fail
  assert.throws(
    () => decryptSecret(tamperedCiphertext),
    /Unsupported state or unable to authenticate data/,
    "Should throw error when ciphertext is tampered"
  );
}

// Test decryption with tampered auth tag
async function testDecryptTamperedAuthTag() {
  const plaintext = "original-secret";
  const encrypted = encryptSecret(plaintext);
  const parts = encrypted.split(":");

  // Tamper with the auth tag
  const tamperedAuthTag = "0".repeat(32);
  const tamperedCiphertext = `${parts[0]}:${tamperedAuthTag}:${parts[2]}`;

  assert.throws(
    () => decryptSecret(tamperedCiphertext),
    /Unsupported state or unable to authenticate data/,
    "Should throw error when auth tag is tampered"
  );
}

// Test that ALGORITHM constant is correct
async function testAlgorithmConstant() {
  assert.equal(ALGORITHM, "aes-256-gcm", "Algorithm should be aes-256-gcm");
}

// Test encrypt/decrypt with JSON content (common use case for secrets)
async function testEncryptDecryptJsonContent() {
  const secretConfig = {
    apiKey: "sk-abc123",
    endpoint: "https://api.example.com",
    options: { timeout: 5000 }
  };
  const plaintext = JSON.stringify(secretConfig);
  const encrypted = encryptSecret(plaintext);
  const decrypted = decryptSecret(encrypted);

  assert.equal(decrypted, plaintext, "Should handle JSON content");
  assert.deepEqual(JSON.parse(decrypted), secretConfig, "Decrypted JSON should match original");
}

// Test encrypt/decrypt with newlines and whitespace
async function testEncryptDecryptWithNewlines() {
  const plaintext = "line1\nline2\r\nline3\ttabbed";
  const encrypted = encryptSecret(plaintext);
  const decrypted = decryptSecret(encrypted);

  assert.equal(decrypted, plaintext, "Should preserve newlines and whitespace");
}

// Run all tests
async function run() {
  // Basic round-trip tests
  await testEncryptDecryptRoundTrip();
  await testEncryptDecryptEmptyString();
  await testEncryptDecryptSpecialCharacters();
  await testEncryptDecryptUnicode();
  await testEncryptDecryptLongText();

  // Format and uniqueness tests
  await testEncryptedFormat();
  await testEncryptionProducesUniqueOutput();

  // Error handling tests
  await testDecryptInvalidFormatMissingParts();
  await testDecryptInvalidFormatTooManyParts();
  await testDecryptTamperedCiphertext();
  await testDecryptTamperedAuthTag();

  // Constant and special content tests
  await testAlgorithmConstant();
  await testEncryptDecryptJsonContent();
  await testEncryptDecryptWithNewlines();

  console.log("encryption tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
