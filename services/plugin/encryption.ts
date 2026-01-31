import crypto from 'crypto'

// Key must be 32 bytes for AES-256
const getEncryptionKey = (): Buffer => {
  const key = process.env.PLUGIN_SECRET_ENCRYPTION_KEY || 'your-32-char-secret-key-here!!!'
  // Ensure key is exactly 32 bytes
  return Buffer.from(key.padEnd(32, '0').slice(0, 32))
}

export const ALGORITHM = 'aes-256-gcm'

export const encryptSecret = (plaintext: string): string => {
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(12) // 12 bytes for GCM
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  const authTag = cipher.getAuthTag()

  // Format: iv:authTag:encrypted
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`
}

export const decryptSecret = (ciphertext: string): string => {
  const parts = ciphertext.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid ciphertext format')
  }

  const iv = Buffer.from(parts[0], 'hex')
  const authTag = Buffer.from(parts[1], 'hex')
  const encrypted = parts[2]

  const key = getEncryptionKey()
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')

  return decrypted
}
