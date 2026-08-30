"""Unit tests for the STT transcript-cleaning logic.

These deliberately don't load the real Whisper model (multi-hundred-MB
download, seconds per call) — _clean_transcript is pure text filtering over
segment objects, so it's tested directly with fakes.
"""
from dataclasses import dataclass

import main


@dataclass
class FakeSegment:
    text: str
    no_speech_prob: float = 0.0
    avg_logprob: float = -0.2


def test_clean_transcript_joins_real_speech():
    segments = [FakeSegment("Daisy,"), FakeSegment(" play some jazz.")]
    assert main._clean_transcript(segments) == "Daisy, play some jazz."


def test_clean_transcript_drops_low_confidence_noise():
    segments = [FakeSegment("hmm", no_speech_prob=0.9, avg_logprob=-1.2)]
    assert main._clean_transcript(segments) == ""


def test_clean_transcript_drops_hallucinated_phrases():
    segments = [FakeSegment("thank you.")]
    assert main._clean_transcript(segments) == ""


def test_clean_transcript_keeps_hard_but_confident_speech():
    # A single weak signal is not enough to drop a segment — the soft gate needs
    # both, so a quiet-but-clear utterance survives.
    segments = [FakeSegment("what's on my calendar", no_speech_prob=0.4, avg_logprob=-0.3)]
    assert main._clean_transcript(segments) == "what's on my calendar"


def test_clean_transcript_drops_hallucinations_that_report_zero_no_speech():
    """Regression: mlx large-v3-turbo reports no_speech_prob as a flat 0.00
    even on pure silence, so the soft (AND) gate can never fire for it. Before
    the hard avg_logprob gate, feeding silence to /api/stt returned invented
    phrases like "address." and "We'll see you next time." — measured, not
    hypothetical.
    """
    for text, logprob in [
        ("address.", -2.85),
        ("comment.", -2.68),
        ("final music.", -3.03),
        ("We'll see you next time.", -0.92),
    ]:
        seg = FakeSegment(text, no_speech_prob=0.0, avg_logprob=logprob)
        assert main._clean_transcript([seg]) == "", f"{text!r} leaked through"


def test_non_english_scripts_are_dropped():
    """large-v3-turbo is multilingual: language="en" biases decoding but does
    not restrict the output alphabet. Feeding it 60Hz mains hum produced
    "окiem question." — so English is enforced on the output, not assumed.
    """
    for text in [
        "окiem question.",  # the actual observed hallucination
        "这是什么",
        "привет как дела",
        "こんにちは",
        "안녕하세요",
        "مرحبا",
        "नमस्ते",
        "Γειά σου",
    ]:
        seg = FakeSegment(text, no_speech_prob=0.0, avg_logprob=-0.2)  # high confidence
        assert main._clean_transcript([seg]) == "", f"{text!r} leaked through"


def test_english_with_accented_borrowings_is_kept():
    # The filter targets non-Latin *scripts*, not non-ASCII characters, so
    # ordinary borrowed words must survive.
    for text in ["add a note about the café meeting", "email my résumé", "naïve approach"]:
        seg = FakeSegment(text, no_speech_prob=0.0, avg_logprob=-0.2)
        assert main._clean_transcript([seg]) == text, f"{text!r} was wrongly dropped"


def test_is_english_helper():
    assert main._is_english("play some jazz")
    assert main._is_english("café résumé naïve")
    assert not main._is_english("mixed окiem question")


def test_clean_transcript_keeps_worst_observed_real_speech():
    # The hard gate must clear the weakest real utterance measured on either
    # engine (faster-whisper bottoms out around -0.58) with margin.
    seg = FakeSegment("send an email to the design team", no_speech_prob=0.0, avg_logprob=-0.58)
    assert main._clean_transcript([seg]) == "send an email to the design team"


def test_stt_empty_body_short_circuits_without_loading_whisper(client, monkeypatch):
    def fail_if_called():
        raise AssertionError("get_whisper() should not be called for an empty body")

    monkeypatch.setattr(main, "get_whisper", fail_if_called)
    res = client.post("/api/stt", content=b"", headers={"Content-Type": "audio/wav"})
    assert res.status_code == 200
    assert res.json() == {"text": ""}


# --- engine selection + WAV decoding ---------------------------------------


def _wav_bytes(samples, rate=16000, channels=1):
    """Build an in-memory 16-bit PCM WAV, the format the frontend posts."""
    import io
    import wave

    import numpy as np

    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes((np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes())
    return buf.getvalue()


def test_engine_can_be_forced_either_way(monkeypatch):
    monkeypatch.setattr(main, "STT_ENGINE", "faster-whisper")
    assert main.use_mlx() is False
    monkeypatch.setattr(main, "STT_ENGINE", "mlx")
    assert main.use_mlx() is True


def test_mlx_is_not_selected_off_apple_silicon(monkeypatch):
    monkeypatch.setattr(main, "STT_ENGINE", "")
    monkeypatch.setattr(main.sys, "platform", "win32")
    assert main.use_mlx() is False


def test_decode_wav_returns_mono_float32_at_16k():
    import numpy as np

    tone = np.sin(np.linspace(0, 20, 16000)).astype(np.float32)
    audio = main._decode_wav(_wav_bytes(tone))
    assert audio.dtype == np.float32
    assert len(audio) == 16000
    assert abs(float(audio.max())) <= 1.0


def test_decode_wav_downmixes_stereo_and_resamples():
    import numpy as np

    # 8kHz stereo must come back as 16kHz mono, since mlx-whisper requires it.
    stereo = np.zeros(2000, dtype=np.float32)
    audio = main._decode_wav(_wav_bytes(stereo, rate=8000, channels=2))
    assert audio.ndim == 1
    assert len(audio) == 2000  # 1000 frames at 8kHz -> 2000 at 16kHz


def test_stt_falls_back_to_cpu_when_mlx_raises(client, monkeypatch):
    """A GPU/model failure must not take voice input down when a working CPU
    engine is available."""
    monkeypatch.setattr(main, "use_mlx", lambda: True)

    def boom(_data):
        raise RuntimeError("simulated MLX failure")

    calls = []

    def fake_cpu(_data):
        calls.append(True)
        return [type("S", (), {"text": "fell back", "no_speech_prob": 0.0, "avg_logprob": -0.1})()]

    monkeypatch.setattr(main, "_transcribe_mlx", boom)
    monkeypatch.setattr(main, "_transcribe_faster_whisper", fake_cpu)

    res = client.post("/api/stt", content=b"not-a-real-wav", headers={"Content-Type": "audio/wav"})
    assert res.status_code == 200
    assert res.json()["text"] == "fell back"
    assert calls, "CPU fallback was never invoked"


def test_initial_prompt_covers_command_verbs():
    # Listing the verbs Daisy acts on (not just nouns) measurably cut WER and
    # fixed "skip this song" being heard as "let's hit this song".
    for verb in ("play", "pause", "skip", "shuffle", "remind", "schedule"):
        assert verb in main.STT_INITIAL_PROMPT
