"""Unit tests for registry helpers that need no database (Step 5).

save_manifest/get_manifest/list_agents are exercised against a live
MongoDB by the Step 5 "Done when" flow; slugify is pure and testable here.
(Importing db is safe without MongoDB running -- the client is lazy.)

Run directly (no test framework needed):
    python test_db.py
Or, if you prefer pytest:
    pytest test_db.py
"""

from db import slugify


def test_slugify_basic():
    assert slugify("Email Agent") == "email-agent"


def test_slugify_collapses_punctuation_and_spaces():
    assert (
        slugify("  An agent -- that sends   e-mails! ")
        == "an-agent-that-sends-e-mails"
    )


def test_slugify_keeps_digits():
    assert slugify("PDF Agent 2") == "pdf-agent-2"


def test_slugify_no_usable_characters_gives_empty():
    assert slugify("!!! ???") == ""


def test_slugify_caps_length():
    assert len(slugify("word " * 50)) <= 64


if __name__ == "__main__":
    tests = [
        value
        for name, value in sorted(globals().items())
        if name.startswith("test_") and callable(value)
    ]
    for test in tests:
        test()
        print(f"PASS {test.__name__}")
    print(f"\nAll {len(tests)} tests passed.")
