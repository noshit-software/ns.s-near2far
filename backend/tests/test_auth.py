from app.auth import hash_password, verify_password


def test_verify_correct_password():
    stored = hash_password("correct horse battery staple")
    assert verify_password("correct horse battery staple", stored) is True


def test_verify_wrong_password():
    stored = hash_password("correct horse battery staple")
    assert verify_password("wrong password", stored) is False


def test_hash_is_salted_differently_each_time():
    a = hash_password("same password")
    b = hash_password("same password")
    assert a != b
    # ...but both still verify correctly against their own stored hash.
    assert verify_password("same password", a) is True
    assert verify_password("same password", b) is True


def test_verify_empty_password_against_real_hash_fails():
    stored = hash_password("a real password")
    assert verify_password("", stored) is False


def test_stored_hash_format_is_salt_dollar_digest():
    stored = hash_password("x")
    salt_hex, sep, digest_hex = stored.partition("$")
    assert sep == "$"
    assert len(bytes.fromhex(salt_hex)) == 16
    assert len(bytes.fromhex(digest_hex)) == 32  # sha256 digest length
