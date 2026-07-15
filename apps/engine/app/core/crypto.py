"""Strict cross-language encryption for persisted LLM API keys."""

import base64
import binascii
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


_VERSION = "v1"
_AAD = b"stock-quant:llm-api-key:v1"
_IV_LENGTH = 12
_AUTH_TAG_LENGTH = 16


def _decode_base64url(value: str, label: str) -> bytes:
    if not value or any(
        character
        not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
        for character in value
    ):
        raise ValueError(f"{label} must be unpadded base64url")
    padding = "=" * ((4 - len(value) % 4) % 4)
    try:
        return base64.urlsafe_b64decode(value + padding)
    except (ValueError, binascii.Error) as error:
        raise ValueError(f"{label} must be unpadded base64url") from error


def _encode_base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _get_secret_key() -> bytes:
    encoded = os.environ.get("ENCRYPTION_KEY")
    if not encoded:
        raise ValueError("ENCRYPTION_KEY is required")
    key = _decode_base64url(encoded, "ENCRYPTION_KEY")
    if len(key) != 32:
        raise ValueError("ENCRYPTION_KEY must decode to exactly 32 bytes")
    return key


def validate_encryption_key() -> None:
    """Validate the required process-level secret at an LLM execution boundary."""
    _get_secret_key()


def encrypt(text: str) -> str:
    """Encrypt a non-empty secret using the only supported v1 wire format."""
    if not text:
        raise ValueError("Cannot encrypt an empty secret")

    iv = os.urandom(_IV_LENGTH)
    encrypted_with_tag = AESGCM(_get_secret_key()).encrypt(iv, text.encode(), _AAD)
    ciphertext = encrypted_with_tag[:-_AUTH_TAG_LENGTH]
    auth_tag = encrypted_with_tag[-_AUTH_TAG_LENGTH:]
    return ":".join(
        (
            _VERSION,
            _encode_base64url(iv),
            _encode_base64url(auth_tag),
            _encode_base64url(ciphertext),
        )
    )


def decrypt(value: str) -> str:
    """Decrypt a v1 ciphertext or fail closed without legacy fallbacks."""
    parts = value.split(":")
    if len(parts) != 4 or parts[0] != _VERSION:
        raise ValueError("Invalid LLM API key ciphertext format")

    iv = _decode_base64url(parts[1], "ciphertext IV")
    auth_tag = _decode_base64url(parts[2], "ciphertext auth tag")
    ciphertext = _decode_base64url(parts[3], "ciphertext payload")
    if len(iv) != _IV_LENGTH or len(auth_tag) != _AUTH_TAG_LENGTH or not ciphertext:
        raise ValueError("Invalid LLM API key ciphertext lengths")

    try:
        plaintext = AESGCM(_get_secret_key()).decrypt(iv, ciphertext + auth_tag, _AAD)
    except (InvalidTag, ValueError) as error:
        raise ValueError("Failed to decrypt LLM API key") from error
    return plaintext.decode()
