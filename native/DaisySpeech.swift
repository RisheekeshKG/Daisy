// DaisySpeech — streaming speech-to-text using Apple's on-device recognizer.
//
// This is the macOS equivalent of the Web Speech API that Chrome exposes:
// the same engine behind system dictation and Siri. Electron cannot use the
// browser API — Chromium's SpeechRecognition talks to a Google endpoint whose
// API key is compiled only into official Chrome builds, so in Electron it
// always fails with a `network` error. This helper fills that gap.
//
// Protocol: one JSON object per line on stdout.
//   {"type":"ready","onDevice":true}
//   {"type":"partial","text":"play my love"}     — live draft, may change
//   {"type":"final","text":"play my love songs"} — utterance ended
//   {"type":"state","listening":false}
//   {"type":"error","code":"denied","message":"..."}
//
// Commands: one JSON object per line on stdin.
//   {"cmd":"pause"}   — stop feeding audio (used while Daisy is talking, so
//                       she does not transcribe her own voice)
//   {"cmd":"resume"}
//   {"cmd":"quit"}
//
// Endpointing is done here rather than in JS: the recognizer streams partials
// continuously and never marks a result final on its own, so we watch for the
// transcript going quiet and close the utterance ourselves.

import AVFoundation
import Foundation
import Speech

// MARK: - Tunables

/// Silence after speech that ends an utterance. Matches the value the previous
/// Web Audio VAD used, so the felt responsiveness is unchanged.
let SILENCE_MS: Double = 900

/// Hard cap on a single utterance. Also keeps us clear of the recognizer's own
/// per-request duration limit, which fires as an error rather than a result.
let MAX_UTTERANCE_MS: Double = 20000

/// Below this we treat the buffer as noise rather than a real utterance.
let MIN_UTTERANCE_CHARS = 1

// MARK: - Line-oriented JSON output

let stdoutQueue = DispatchQueue(label: "daisy.speech.stdout")

func emit(_ payload: [String: Any]) {
    stdoutQueue.async {
        guard
            let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
            var line = String(data: data, encoding: .utf8)
        else { return }
        line += "\n"
        FileHandle.standardOutput.write(line.data(using: .utf8)!)
    }
}

func fail(_ code: String, _ message: String) -> Never {
    emit(["type": "error", "code": code, "message": message])
    // Give the async write a moment to drain before the process disappears.
    stdoutQueue.sync {}
    exit(1)
}

// MARK: - Recognizer

final class Recognizer: NSObject {
    private let engine = AVAudioEngine()
    private let recognizer: SFSpeechRecognizer
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?

    /// Serializes every mutation of the request/task pair. The audio tap runs
    /// on a realtime thread and the recognition callback on its own queue, so
    /// without this an utterance can be torn down mid-append.
    private let lock = DispatchQueue(label: "daisy.speech.state")

    private var lastTranscript = ""
    private var lastChangeAt = Date()
    private var utteranceStart = Date()
    private var speaking = false
    private var paused = false
    private var onDevice = false
    private var timer: DispatchSourceTimer?

    init(locale: String) {
        guard let r = SFSpeechRecognizer(locale: Locale(identifier: locale)) else {
            fail("unsupported-locale", "No recognizer for locale \(locale)")
        }
        recognizer = r
        super.init()
        recognizer.delegate = self
    }

    func start() {
        // On-device keeps audio off the network entirely, which is the whole
        // point of Daisy being local-first. Fall back to server recognition
        // only if this Mac genuinely cannot do it.
        onDevice = recognizer.supportsOnDeviceRecognition
        guard recognizer.isAvailable else {
            fail("unavailable", "Speech recognizer is not available right now")
        }

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0 else {
            fail("no-input", "No usable microphone input format")
        }

        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            guard let self else { return }
            self.lock.async {
                guard !self.paused else { return }
                self.request?.append(buffer)
            }
        }

        engine.prepare()
        do {
            try engine.start()
        } catch {
            fail("engine", "Could not start audio engine: \(error.localizedDescription)")
        }

        lock.async { self.beginUtterance() }
        startTimer()
        emit(["type": "ready", "onDevice": onDevice])
    }

    /// Opens a fresh recognition request. Must be called on `lock`.
    private func beginUtterance() {
        task?.cancel()
        task = nil

        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        if onDevice { req.requiresOnDeviceRecognition = true }
        // Nudges the recognizer toward the words Daisy actually acts on.
        req.contextualStrings = [
            "Daisy", "Spotify", "playlist", "shuffle", "repeat",
            "calendar", "reminder", "timer", "alarm", "volume",
        ]
        request = req

        lastTranscript = ""
        lastChangeAt = Date()
        utteranceStart = Date()
        speaking = false

        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            guard let self else { return }
            self.lock.async {
                if let result {
                    let text = result.bestTranscription.formattedString
                    if text != self.lastTranscript {
                        self.lastTranscript = text
                        self.lastChangeAt = Date()
                        self.speaking = !text.isEmpty
                        if !text.isEmpty {
                            emit(["type": "partial", "text": text])
                        }
                    }
                }
                if error != nil || (result?.isFinal ?? false) {
                    // A cancelled request surfaces here too; only the text we
                    // have already accumulated is worth reporting.
                    self.closeUtterance()
                }
            }
        }
    }

    /// Emits whatever we have and rearms for the next utterance. On `lock`.
    private func closeUtterance() {
        let text = lastTranscript.trimmingCharacters(in: .whitespacesAndNewlines)
        request?.endAudio()
        request = nil
        task?.cancel()
        task = nil

        if text.count >= MIN_UTTERANCE_CHARS {
            emit(["type": "final", "text": text])
        }
        beginUtterance()
    }

    /// Watches for the transcript going quiet — the recognizer streams forever
    /// and will not decide an utterance is over on its own.
    private func startTimer() {
        let t = DispatchSource.makeTimerSource(queue: lock)
        t.schedule(deadline: .now() + .milliseconds(150), repeating: .milliseconds(150))
        t.setEventHandler { [weak self] in
            guard let self, !self.paused else { return }
            let now = Date()
            let quietMs = now.timeIntervalSince(self.lastChangeAt) * 1000
            let ageMs = now.timeIntervalSince(self.utteranceStart) * 1000

            if self.speaking && quietMs >= SILENCE_MS {
                self.closeUtterance()
            } else if ageMs >= MAX_UTTERANCE_MS {
                // Recycle even when idle so a long-lived request never trips
                // the recognizer's internal duration limit.
                if self.speaking { self.closeUtterance() } else { self.beginUtterance() }
            }
        }
        t.resume()
        timer = t
    }

    func setPaused(_ value: Bool) {
        lock.async {
            guard self.paused != value else { return }
            self.paused = value
            if value {
                // Drop the in-flight utterance: audio captured while Daisy is
                // speaking is her own voice, not a command.
                self.request?.endAudio()
                self.request = nil
                self.task?.cancel()
                self.task = nil
                self.lastTranscript = ""
                self.speaking = false
            } else {
                self.beginUtterance()
            }
            emit(["type": "state", "listening": !value])
        }
    }

    func stop() {
        lock.sync {
            timer?.cancel()
            timer = nil
            request?.endAudio()
            request = nil
            task?.cancel()
            task = nil
        }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
    }
}

extension Recognizer: SFSpeechRecognizerDelegate {
    func speechRecognizer(_ recognizer: SFSpeechRecognizer, availabilityDidChange available: Bool) {
        emit(["type": "state", "available": available])
    }
}

// MARK: - Entry point

let locale = ProcessInfo.processInfo.environment["DAISY_SPEECH_LOCALE"] ?? "en-US"
var recognizer: Recognizer?

SFSpeechRecognizer.requestAuthorization { status in
    DispatchQueue.main.async {
        switch status {
        case .authorized:
            let r = Recognizer(locale: locale)
            recognizer = r
            r.start()
        case .denied:
            fail("denied", "Speech recognition permission was denied")
        case .restricted:
            fail("restricted", "Speech recognition is restricted on this Mac")
        case .notDetermined:
            fail("not-determined", "Speech recognition permission was not granted")
        @unknown default:
            fail("unknown", "Unexpected authorization status")
        }
    }
}

// Read commands from stdin on a background thread; the main thread has to stay
// free to run the audio engine's run loop.
DispatchQueue.global(qos: .utility).async {
    while let line = readLine(strippingNewline: true) {
        guard
            let data = line.data(using: .utf8),
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let cmd = obj["cmd"] as? String
        else { continue }

        switch cmd {
        case "pause": recognizer?.setPaused(true)
        case "resume": recognizer?.setPaused(false)
        case "quit":
            recognizer?.stop()
            stdoutQueue.sync {}
            exit(0)
        default: break
        }
    }
    // stdin closed — the parent went away, so we should too.
    recognizer?.stop()
    exit(0)
}

RunLoop.main.run()
