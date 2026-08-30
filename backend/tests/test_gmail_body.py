"""HTML-mail to readable text.

Regression tests for a real bug: HTML-only marketing mail rendered in the app
as walls of "&#8199;&#847;&shy;&emsp;&#8203;" because tags were stripped but
entities were never decoded, and hidden preheader blocks were never removed.
"""
import gmail


def test_entities_are_decoded():
    out = gmail._html_to_text("<p>&copy; 2026 Indeed &amp; co &mdash; Dublin</p>")
    assert "©" in out
    assert "&copy;" not in out
    assert "&amp;" not in out
    assert "&" in out


def test_nbsp_becomes_a_real_space():
    out = gmail._html_to_text("<p>D02&nbsp;HE36</p>")
    assert out == "D02 HE36"
    assert " " not in out


def test_invisible_padding_characters_are_removed():
    # The exact soup from the reported screenshot. Note &#8199; (figure space)
    # and &emsp; occupy real width, so they collapse to a single ordinary space
    # rather than vanishing and running the words together.
    out = gmail._html_to_text(
        "<p>Hello&#8199;&#847;&shy;&#8199;&#847;&shy;&emsp;&#8203;&#8203;world</p>"
    )
    assert out == "Hello world", out
    for bad in ("&#8199;", "&shy;", "&#8203;", "\u200b", "\u00ad", "\u2007"):
        assert bad not in out


def test_zero_width_chars_vanish_but_wide_spaces_become_spaces():
    # Deleting a figure space would glue "D02" and "HE36" together.
    assert gmail._strip_invisibles("D02\u2007HE36") == "D02 HE36"
    assert gmail._strip_invisibles("Hi\u200b\u00adthere") == "Hithere"


def test_hidden_preheader_block_is_dropped():
    # Senders hide the inbox preview line (and stray counters) in display:none.
    out = gmail._html_to_text(
        '<div style="display:none;max-height:0">96 hidden preheader</div><p>Real body</p>'
    )
    assert out == "Real body"


def test_script_and_style_never_reach_the_body():
    out = gmail._html_to_text(
        "<head><style>.a{color:red}</style></head><body>"
        "<script>alert(1)</script><p>Visible</p></body>"
    )
    assert out == "Visible"


def test_block_tags_become_line_breaks():
    out = gmail._html_to_text("<p>One</p><p>Two</p><br>Three")
    # Paragraphs stay separated by a blank line, as they read in the mail.
    assert [l for l in out.splitlines() if l.strip()] == ["One", "Two", "Three"]
    assert "OneTwo" not in out


def test_literal_angle_brackets_in_text_are_not_treated_as_tags():
    # Entities are decoded *after* tag stripping, so an escaped tag in the body
    # survives as text instead of being stripped as markup.
    out = gmail._html_to_text("<p>Use &lt;b&gt; for bold</p>")
    assert out == "Use <b> for bold"


def test_excess_blank_lines_are_collapsed():
    out = gmail._html_to_text("<p>A</p><div></div><div></div><div></div><p>B</p>")
    assert "\n\n\n" not in out


def test_plain_text_parts_are_cleaned_too():
    # Zero-width padding leaves no gap, exactly as a mail client renders it.
    assert gmail._clean_plain_text("Hi\u200b\u00adthere friend") == "Hithere friend"


def test_prefers_plain_text_over_html():
    import base64

    def b64(s):
        return base64.urlsafe_b64encode(s.encode()).decode().rstrip("=")

    payload = {
        "mimeType": "multipart/alternative",
        "parts": [
            {"mimeType": "text/plain", "body": {"data": b64("plain wins")}},
            {"mimeType": "text/html", "body": {"data": b64("<p>html loses</p>")}},
        ],
    }
    assert gmail._extract_body(payload) == "plain wins"


def test_falls_back_to_html_when_there_is_no_plain_part():
    import base64

    data = base64.urlsafe_b64encode(b"<p>only &amp; html</p>").decode().rstrip("=")
    payload = {"mimeType": "text/html", "body": {"data": data}}
    assert gmail._extract_body(payload) == "only & html"


def test_empty_payload_is_safe():
    assert gmail._extract_body({}) == ""
    assert gmail._extract_body(None) == ""
