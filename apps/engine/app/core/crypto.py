"""
app/core/crypto.py
===================
AES-256-GCM encryption/decryption — mirrors apps/api/src/lib/crypto.ts exactly.

Key sharing convention
-----------------------
Both this module and the Node.js API read ``ENCRYPTION_KEY`` from the **root**
``.env`` file (engine picks it up via pydantic-settings ``env_file="../../.env"``).

- If ``ENCRYPTION_KEY`` is **not set**, both sides fall back to the same hardcoded
  string ``'stock-quant-default-secret-key-32b'``.
- To use a real key: add ``ENCRYPTION_KEY="<your-secret>"`` to the root ``.env``.
  Both services will pick it up automatically on next restart.

Wire format (Node.js compatible)
----------------------------------
``<iv_hex>:<auth_tag_hex>:<ciphertext_hex>``

- IV:       16 random bytes  → 32 hex chars
- Auth tag: 16 bytes GCM tag → 32 hex chars
- Ciphertext: variable length hex
"""
import hashlib
import os
import secrets

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def _get_secret_key() -> bytes:
    """Derive a 32-byte AES key from ENCRYPTION_KEY env var (SHA-256 digest)."""
    raw = os.environ.get("ENCRYPTION_KEY", "stock-quant-default-secret-key-32b")
    return hashlib.sha256(raw.encode()).digest()


def encrypt(text: str) -> str:
    """Encrypt *text* and return ``iv:authTag:ciphertext`` hex string."""
    if not text:
        return text
    key = _get_secret_key()
    iv = secrets.token_bytes(16)
    aesgcm = AESGCM(key)
    # AESGCM.encrypt returns ciphertext + 16-byte auth tag appended
    ct_with_tag = aesgcm.encrypt(iv, text.encode(), None)
    ciphertext = ct_with_tag[:-16]
    auth_tag = ct_with_tag[-16:]
    return f"{iv.hex()}:{auth_tag.hex()}:{ciphertext.hex()}"


def decrypt(text: str) -> str:
    """Decrypt a ``iv:authTag:ciphertext`` hex string produced by :func:`encrypt` or the Node.js counterpart.

    Returns the original plaintext string, or *text* unchanged if it does not
    look like an encrypted value (legacy / plain-text fallback, matching Node.js behaviour).
    """
    if not text:
        return text
    parts = text.split(":")
    if len(parts) != 3:
        # Not in encrypted format — return as-is (same as Node.js decrypt)
        return text
    try:
        iv = bytes.fromhex(parts[0])
        auth_tag = bytes.fromhex(parts[1])
        ciphertext = bytes.fromhex(parts[2])
        key = _get_secret_key()
        aesgcm = AESGCM(key)
        # cryptography lib expects ciphertext+tag concatenated
        plaintext_bytes = aesgcm.decrypt(iv, ciphertext + auth_tag, None)
        return plaintext_bytes.decode()
    except Exception:
        return ""
