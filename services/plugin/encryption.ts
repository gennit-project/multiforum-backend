import crypto from 'crypto'

export const ENCRYPTION_KEY = process.env.PLUGIN_SECRET_ENCRYPTION_KEY || 'your-32-char-secret-key-here!!!'
export const ALGORITHM = 'aes-256-gcm'

export const decryptSecret = (ciphertext: string): string => {
  const parts = ciphertext.split(':')
  const iv = Buffer.from(parts[0], 'hex')
  const encrypted = parts[1]
  const decipher = crypto.createDecipher(ALGORITHM, ENCRYPTION_KEY)
  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}
