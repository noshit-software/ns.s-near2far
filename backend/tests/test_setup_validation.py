import pytest

from app.api.setup import MAX_CONTACT_NAME_LENGTH, _normalize_phone, _validate_contact_name


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("5551234567", "5551234567"),
        ("+15551234567", "+15551234567"),
        ("(555) 123-4567", "5551234567"),
        ("555.123.4567", "5551234567"),
        ("555 123 4567", "5551234567"),
    ],
)
def test_normalize_phone_strips_punctuation(raw, expected):
    assert _normalize_phone(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "12345",  # too short (< 7 digits)
        "1" * 16,  # too long (> 15 digits)
        "not-a-number",
        "555-CALL-NOW",
        "",
    ],
)
def test_normalize_phone_rejects_invalid(raw):
    with pytest.raises(ValueError):
        _normalize_phone(raw)


def test_validate_contact_name_trims_whitespace():
    assert _validate_contact_name("  AAA  ") == "AAA"


def test_validate_contact_name_rejects_empty():
    with pytest.raises(ValueError):
        _validate_contact_name("   ")


def test_validate_contact_name_enforces_max_length():
    # Exactly at the cap is fine...
    assert _validate_contact_name("A" * MAX_CONTACT_NAME_LENGTH) == "A" * MAX_CONTACT_NAME_LENGTH
    # ...one over is not.
    with pytest.raises(ValueError):
        _validate_contact_name("A" * (MAX_CONTACT_NAME_LENGTH + 1))


def test_validate_contact_name_length_check_is_after_trim():
    # A name that's only over the limit because of surrounding whitespace should pass —
    # the cap is on the actual label, not on whatever was typed into the field.
    padded = " " + "A" * MAX_CONTACT_NAME_LENGTH + " "
    assert _validate_contact_name(padded) == "A" * MAX_CONTACT_NAME_LENGTH
