import crypto from 'node:crypto';

const algorithm = 'aes-256-gcm';
// 使用环境变量 ENCRYPTION_KEY 或默认的 fallback key
const secretKey = process.env.ENCRYPTION_KEY 
    ? crypto.createHash('sha256').update(process.env.ENCRYPTION_KEY).digest()
    : crypto.createHash('sha256').update('stock-quant-default-secret-key-32b').digest();

export function encrypt(text: string): string {
    if (!text) return text;
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, secretKey, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decrypt(text: string): string {
    if (!text) return text;
    try {
        const parts = text.split(':');
        // 如果不是加密格式（例如旧数据），直接返回
        if (parts.length !== 3) return text; 
        
        const iv = Buffer.from(parts[0], 'hex');
        const authTag = Buffer.from(parts[1], 'hex');
        const encryptedText = parts[2];
        
        const decipher = crypto.createDecipheriv(algorithm, secretKey, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (e) {
        console.error("Decryption failed", e);
        return "";
    }
}
