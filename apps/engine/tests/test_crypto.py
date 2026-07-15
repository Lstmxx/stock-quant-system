"""Cross-language contract tests for LLM API-key encryption."""

import pytest

from app.core.crypto import decrypt, encrypt


TEST_KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"
KNOWN_NODE_CIPHERTEXT = (
    "v1:AAECAwQFBgcICQoL:wjZy1MWVtBDV-SwoAj2UDA:NGn7b6CWtjbsMf6m2owB"
)


@pytest.fixture(autouse=True)
def encryption_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENCRYPTION_KEY", TEST_KEY)


def test_decrypts_cross_language_v1_fixed_vector() -> None:
    assert decrypt(KNOWN_NODE_CIPHERTEXT) == "sk-test-api-key"


def test_round_trip_uses_only_v1_format() -> None:
    ciphertext = encrypt("sk-live-secret")

    assert ciphertext.startswith("v1:")
    assert len(ciphertext.split(":")) == 4
    assert decrypt(ciphertext) == "sk-live-secret"


def test_missing_or_malformed_encryption_key_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ENCRYPTION_KEY")
    with pytest.raises(ValueError, match="ENCRYPTION_KEY"):
        encrypt("secret")

    monkeypatch.setenv("ENCRYPTION_KEY", "not-a-32-byte-key")
    with pytest.raises(ValueError, match="ENCRYPTION_KEY"):
        encrypt("secret")


@pytest.mark.parametrize("ciphertext", ["plain-secret", "00:11:22", ""])
def test_plaintext_and_legacy_ciphertext_are_rejected(ciphertext: str) -> None:
    with pytest.raises(ValueError, match="ciphertext"):
        decrypt(ciphertext)


def test_wrong_key_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENCRYPTION_KEY", "HyRS6kM7x9jAK9-fH_pFYltZBM0fDZJvgM6zCahDvkM")
    with pytest.raises(ValueError, match="decrypt"):
        decrypt(KNOWN_NODE_CIPHERTEXT)
